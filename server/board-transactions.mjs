import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';

export const BOARD_TRANSACTION_LIMITS = Object.freeze({ documents: 100, stagedBytes: 128 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024, reserveBytes: 16 * 1024 * 1024 });
const journalName = '.notesprig/board-transactions';
const digestPattern = /^[a-f\d]{64}$/;
const transactionPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
export const boardContentHash = (value) => createHash('sha256').update(value).digest('hex');

export class BoardTransactionError extends Error {
  constructor(code, message, status = 400, cause) { super(message, { cause }); this.code = code; this.status = status; }
}
const fail = (code, message, status = 400, cause) => new BoardTransactionError(code, message, status, cause);

export function normalizeBoardTransactionPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw fail('INVALID_PATH', 'Invalid transaction path.');
  const parts = value.split('/');
  if (parts.some((part, index) => !part || part !== part.trim() || /[<>:"|?*\u0000-\u001f]/.test(part) || part.startsWith('.') && !(index === 0 && ['.notesprig', '.trash'].includes(part)))) throw fail('INVALID_PATH', 'Blocked transaction path.');
  if (value === '.notesprig' || value === '.trash' || value === journalName || value.startsWith(`${journalName}/`)) throw fail('INVALID_PATH', 'Transaction data cannot overwrite its own journal or internal root.');
  return parts.join('/');
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function writeDurable(file, bytes) {
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function copyDurable(source, destination) {
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const handle = await open(destination, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Internal single-process primitive. Callers enforce document/managed-asset policies. */
export class BoardTransactions {
  constructor(root, { limits = {}, fault = async () => {} } = {}) {
    this.root = path.resolve(root); this.limits = { ...BOARD_TRANSACTION_LIMITS, ...limits };
    this.fault = fault; this.queue = Promise.resolve(); this.ready = false; this.failure = null;
    this.scope = new AsyncLocalStorage();
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 0) throw fail('INVALID_LIMIT', 'Invalid transaction limit.');
  }
  async initialize() {
    await mkdir(this.root, { recursive: true }); this.root = await realpath(this.root);
    await this.safeDirectory(path.join(this.root, journalName));
    this.journalRoot = path.join(this.root, journalName);
    await this.recover(); this.ready = true; return this;
  }
  enqueue(action) {
    if (this.scope.getStore()?.active) return Promise.resolve().then(action);
    const task = this.queue.then(() => this.scope.run({ active: true, mutating: false }, async () => {
      try { return await action(); } finally { this.scope.getStore().active = false; }
    }));
    this.queue = task.catch(() => {}); return task;
  }
  assertAvailable() {
    if (!this.ready || this.failure) throw fail('BOARD_RECOVERY_REQUIRED', 'Board storage is unavailable until transaction recovery completes.', 503, this.failure);
  }
  read(action) { return this.enqueue(async () => { this.assertAvailable(); return action(); }); }
  run(build) { return this.enqueue(async () => {
    this.assertAvailable(); const scope = this.scope.getStore();
    if (scope.mutating) throw fail('NESTED_TRANSACTION', 'A transaction builder cannot start another transaction.', 500);
    scope.mutating = true;
    try { const spec = typeof build === 'function' ? await build() : build; return await this.execute(spec); }
    finally { scope.mutating = false; }
  }); }
  async inspectDirectory(relative) {
    const normalized = normalizeBoardTransactionPath(relative); let cursor = this.root;
    for (const segment of normalized.split('/')) {
      cursor = path.join(cursor, segment);
      const info = await lstat(cursor).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) return false;
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail('INVALID_PATH', 'A transaction directory contains a symbolic link or non-directory.');
    }
    return true;
  }
  async safeDirectory(directory) {
    const relative = path.relative(this.root, directory);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw fail('INVALID_PATH', 'Directory is outside the vault.');
    let cursor = this.root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      let info = await lstat(cursor).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) { await mkdir(cursor, { mode: 0o700 }); await syncDirectory(path.dirname(cursor)); info = await lstat(cursor); }
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail('INVALID_PATH', 'Transaction directory contains a symbolic link or non-directory.');
    }
  }
  async inspect(relative) {
    const normalized = normalizeBoardTransactionPath(relative); let cursor = this.root;
    for (const segment of normalized.split('/')) {
      cursor = path.join(cursor, segment);
      const info = await lstat(cursor).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) return null;
      if (info.isSymbolicLink()) throw fail('INVALID_PATH', 'Symbolic links are not allowed in transaction paths.');
      if (cursor !== path.join(this.root, normalized) && !info.isDirectory()) throw fail('INVALID_PATH', 'A transaction ancestor is not a directory.');
      if (cursor === path.join(this.root, normalized)) {
        if (!info.isFile() || info.nlink !== 1) throw fail('INVALID_PATH', 'Transaction target must be a regular, unshared file.');
        return { absolute: cursor, bytes: info.size, hash: await hashFile(cursor) };
      }
    }
    return null;
  }
  async preflight(spec) {
    if (!spec || typeof spec !== 'object') throw fail('INVALID_TRANSACTION', 'A transaction specification is required.');
    const writes = spec.writes || [], deletes = spec.deletes || [], directories = spec.directories || [];
    if (!Array.isArray(writes) || !Array.isArray(deletes) || !Array.isArray(directories) || writes.length + deletes.length + directories.length > this.limits.documents) throw fail('TRANSACTION_BUDGET', 'Too many affected transaction documents.', 413);
    const entries = [], sources = [], seen = new Set(); let total = 0, largestPost = 0;
    for (const [index, item] of [...writes.map((item) => ({ ...item, op: 'write' })), ...deletes.map((item) => typeof item === 'string' ? { path: item, op: 'delete' } : { ...item, op: 'delete' })].entries()) {
      const relative = normalizeBoardTransactionPath(item.path);
      if (seen.has(relative)) throw fail('INVALID_TRANSACTION', 'A transaction cannot contain the same path twice.');
      seen.add(relative);
      const before = await this.inspect(relative);
      if (item.createOnly && before) throw fail('BOARD_CONFLICT', 'The transaction target already exists.', 409);
      if (item.expectedHash !== undefined && (item.expectedHash !== null && !digestPattern.test(item.expectedHash) || (before?.hash ?? null) !== item.expectedHash)) throw fail('BOARD_CONFLICT', 'The transaction target changed.', 409);
      if (before && before.bytes > this.limits.stagedBytes) throw fail('TRANSACTION_BUDGET', 'Transaction staging budget exceeded.', 413);
      const entry = { path: relative, op: item.op, before: before ? { file: `${index}.before`, bytes: before.bytes, sha256: before.hash } : null, after: null };
      let content;
      if (item.op === 'write') {
        if (typeof item.content !== 'string' && !(item.content instanceof Uint8Array)) throw fail('INVALID_TRANSACTION', 'Transaction content must be text or bytes.');
        content = Buffer.from(item.content); largestPost = Math.max(largestPost, content.length);
        entry.after = { file: `${index}.after`, bytes: content.length, sha256: boardContentHash(content) };
      }
      total += (entry.before?.bytes || 0) + (entry.after?.bytes || 0);
      if (total > this.limits.stagedBytes) throw fail('TRANSACTION_BUDGET', 'Transaction staging budget exceeded.', 413);
      entries.push(entry); sources.push({ before: before?.absolute, content });
    }
    const directoryEntries = [];
    for (const item of directories) {
      const relative = normalizeBoardTransactionPath(item.path);
      if (seen.has(relative) || !['create', 'remove'].includes(item.op)) throw fail('INVALID_TRANSACTION', 'Invalid or duplicate transaction directory.');
      seen.add(relative); const before = await this.inspectDirectory(relative);
      if (item.expectedExists !== undefined && item.expectedExists !== before) throw fail('BOARD_CONFLICT', 'The transaction directory changed.', 409);
      directoryEntries.push({ path: relative, op: item.op, before });
    }
    const removedDirectories = new Set(directoryEntries.filter((entry) => entry.op === 'remove').map((entry) => entry.path));
    const removedFiles = new Set(entries.filter((entry) => entry.op === 'delete').map((entry) => entry.path));
    for (const entry of directoryEntries.filter((entry) => entry.op === 'remove')) {
      if (entries.some((file) => file.op === 'write' && file.path.startsWith(`${entry.path}/`)) || directoryEntries.some((child) => child.op === 'create' && child.path.startsWith(`${entry.path}/`))) throw fail('INVALID_TRANSACTION', 'A removed directory cannot contain transaction destinations.');
      if (entry.before) for (const child of await readdir(path.join(this.root, entry.path), { withFileTypes: true })) {
        const relative = `${entry.path}/${child.name}`;
        if (child.isSymbolicLink() || !(child.isDirectory() ? removedDirectories.has(relative) : child.isFile() && removedFiles.has(relative))) throw fail('INVALID_TRANSACTION', 'Every member of a removed directory must be included in the transaction.');
      }
    }
    const manifest = { version: 1, id: randomUUID(), entries, directories: directoryEntries }, bytes = Buffer.from(JSON.stringify(manifest));
    if (bytes.length > this.limits.manifestBytes) throw fail('TRANSACTION_BUDGET', 'Transaction manifest budget exceeded.', 413);
    const space = await statfs(this.root, { bigint: true });
    if (space.bavail * space.bsize < BigInt(total + largestPost + bytes.length + this.limits.reserveBytes)) throw fail('INSUFFICIENT_STORAGE', 'Insufficient free space for a recoverable transaction.', 507);
    return { manifest, bytes, sources };
  }
  async execute(spec) {
    const prepared = await this.preflight(spec), { manifest, bytes, sources } = prepared;
    const directory = path.join(this.journalRoot, manifest.id); let commitAttempted = false;
    await this.fault('after-preflight', { id: manifest.id });
    await mkdir(directory, { mode: 0o700 }); await syncDirectory(this.journalRoot);
    try {
      for (const [index, entry] of manifest.entries.entries()) {
        if (entry.before) { await copyDurable(sources[index].before, path.join(directory, entry.before.file)); if (await hashFile(path.join(directory, entry.before.file)) !== entry.before.sha256) throw fail('BOARD_CONFLICT', 'A source changed during transaction staging.', 409); }
        if (entry.after) await writeDurable(path.join(directory, entry.after.file), sources[index].content);
        await this.fault('after-stage-file', { id: manifest.id, index, path: entry.path });
      }
      await writeDurable(path.join(directory, 'manifest.json'), bytes); await syncDirectory(directory);
      await this.fault('after-manifest', { id: manifest.id });
      // Revalidate immediately before the common decision. External writers remain unsupported.
      for (const entry of manifest.entries) if ((await this.inspect(entry.path))?.hash !== (entry.before?.sha256)) throw fail('BOARD_CONFLICT', 'A target changed before transaction commit.', 409);
      for (const entry of manifest.directories) if (await this.inspectDirectory(entry.path) !== entry.before) throw fail('BOARD_CONFLICT', 'A directory changed before transaction commit.', 409);
      await this.fault('before-commit', { id: manifest.id });
      commitAttempted = true;
      await writeDurable(path.join(directory, 'COMMIT'), Buffer.from(JSON.stringify({ version: 1, manifestSha256: boardContentHash(bytes) })));
      await syncDirectory(directory); await this.fault('after-commit', { id: manifest.id });
      await this.apply(await this.loadCommitted(directory, manifest.id), directory, true);
      await this.fault('before-cleanup', { id: manifest.id });
      await this.cleanup(directory, true); await this.fault('after-cleanup', { id: manifest.id });
      await this.fault('before-ack', { id: manifest.id });
      return { id: manifest.id, result: spec.result, hashes: Object.fromEntries(manifest.entries.filter((entry) => entry.after).map((entry) => [entry.path, entry.after.sha256])) };
    } catch (error) {
      if (!commitAttempted) {
        try { await this.cleanup(directory); } catch (cleanupError) { this.failure = cleanupError; }
        throw error;
      }
      this.failure = error;
      throw fail('BOARD_RECOVERY_REQUIRED', 'A committed board transaction requires recovery before further reads or writes.', 503, error);
    }
  }
  async apply(manifest, directory, inject = false) {
    for (const entry of (manifest.directories || []).filter((entry) => entry.op === 'create').sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
      await this.safeDirectory(path.join(this.root, entry.path));
      if (inject) await this.fault('after-apply-directory', { id: manifest.id, path: entry.path, op: entry.op });
    }
    for (const [index, entry] of manifest.entries.entries()) {
      if (inject) await this.fault('before-apply', { id: manifest.id, index, path: entry.path });
      const current = await this.inspect(entry.path);
      if (entry.after && current?.hash === entry.after.sha256) continue;
      if (!entry.after && !current) continue;
      if ((current?.hash ?? null) !== (entry.before?.sha256 ?? null)) throw fail('RECOVERY_TARGET_CHANGED', 'A transaction target changed outside the committed operation.', 503);
      const destination = path.join(this.root, entry.path);
      if (entry.after) {
        await this.safeDirectory(path.dirname(destination));
        const temporary = path.join(path.dirname(destination), `.notesprig-board-${randomUUID()}.tmp`);
        try { await copyDurable(path.join(directory, entry.after.file), temporary); await rename(temporary, destination); await syncDirectory(path.dirname(destination)); }
        finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
      } else { await unlink(destination); await syncDirectory(path.dirname(destination)); }
      if (inject) await this.fault('after-apply', { id: manifest.id, index, path: entry.path });
    }
    for (const entry of (manifest.directories || []).filter((entry) => entry.op === 'remove').sort((a, b) => b.path.split('/').length - a.path.split('/').length)) {
      if (await this.inspectDirectory(entry.path)) { await rmdir(path.join(this.root, entry.path)); await syncDirectory(path.dirname(path.join(this.root, entry.path))); }
      if (inject) await this.fault('after-apply-directory', { id: manifest.id, path: entry.path, op: entry.op });
    }
    if (inject) await this.fault('after-apply-all', { id: manifest.id });
  }
  async cleanup(directory, committed = false) {
    // Make completed journals distinguishable before deleting any staged bytes.
    // A crash partway through recursive deletion must not look like a corrupt
    // still-active COMMIT whose postimages have disappeared.
    if (committed) {
      const completed = path.join(this.journalRoot, `completed-${path.basename(directory)}`);
      await rename(directory, completed); await syncDirectory(this.journalRoot); directory = completed;
    }
    await rm(directory, { recursive: true, force: true }); await syncDirectory(this.journalRoot);
  }
  async loadCommitted(directory, id) {
    const manifestInfo = await lstat(path.join(directory, 'manifest.json'));
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > this.limits.manifestBytes) throw fail('CORRUPT_TRANSACTION', 'Invalid recovery manifest.', 503);
    const bytes = await readFile(path.join(directory, 'manifest.json'));
    const commitInfo = await lstat(path.join(directory, 'COMMIT'));
    if (!commitInfo.isFile() || commitInfo.isSymbolicLink() || commitInfo.size > 1024) throw fail('CORRUPT_TRANSACTION', 'Invalid transaction decision.', 503);
    const commit = JSON.parse(await readFile(path.join(directory, 'COMMIT'), 'utf8'));
    const manifest = JSON.parse(bytes);
    if (commit.version !== 1 || commit.manifestSha256 !== boardContentHash(bytes) || manifest.version !== 1 || manifest.id !== id || !Array.isArray(manifest.entries) || manifest.directories !== undefined && !Array.isArray(manifest.directories) || manifest.entries.length + (manifest.directories?.length || 0) > this.limits.documents) throw fail('CORRUPT_TRANSACTION', 'Recovery decision does not match its manifest.', 503);
    let total = 0; const seen = new Set();
    for (const [index, entry] of manifest.entries.entries()) {
      normalizeBoardTransactionPath(entry.path);
      if (seen.has(entry.path) || !['write', 'delete'].includes(entry.op) || entry.op === 'write' && !entry.after || entry.op === 'delete' && entry.after) throw fail('CORRUPT_TRANSACTION', 'Invalid recovery operation.', 503);
      seen.add(entry.path);
      for (const [name, image] of [['before', entry.before], ['after', entry.after]]) if (image) {
        if (image.file !== `${index}.${name}` || !Number.isSafeInteger(image.bytes) || image.bytes < 0 || !digestPattern.test(image.sha256)) throw fail('CORRUPT_TRANSACTION', 'Invalid staged image descriptor.', 503);
        total += image.bytes; if (total > this.limits.stagedBytes) throw fail('CORRUPT_TRANSACTION', 'Recovery budget exceeded.', 503);
        const staged = path.join(directory, image.file), info = await lstat(staged);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== image.bytes || await hashFile(staged) !== image.sha256) throw fail('CORRUPT_TRANSACTION', 'Staged recovery bytes failed verification.', 503);
      }
    }
    for (const entry of manifest.directories || []) {
      normalizeBoardTransactionPath(entry.path);
      if (seen.has(entry.path) || !['create', 'remove'].includes(entry.op) || typeof entry.before !== 'boolean') throw fail('CORRUPT_TRANSACTION', 'Invalid recovery directory.', 503);
      seen.add(entry.path);
    }
    return manifest;
  }
  recover() {
    return this.enqueue(async () => {
      try {
        if (!this.journalRoot) throw fail('BOARD_RECOVERY_REQUIRED', 'Initialize board storage before recovery.', 503);
        const entries = await readdir(this.journalRoot, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) throw fail('CORRUPT_TRANSACTION', 'Unexpected transaction recovery entry.', 503);
          const directory = path.join(this.journalRoot, entry.name);
          if (entry.name.startsWith('completed-') && transactionPattern.test(entry.name.slice('completed-'.length))) { await this.cleanup(directory); continue; }
          if (!transactionPattern.test(entry.name)) throw fail('CORRUPT_TRANSACTION', 'Unexpected transaction recovery entry.', 503);
          const committed = await lstat(path.join(directory, 'COMMIT')).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
          if (committed) await this.apply(await this.loadCommitted(directory, entry.name), directory);
          await this.cleanup(directory, committed);
        }
        this.failure = null; this.ready = true;
      } catch (error) { this.failure = error; this.ready = false; throw fail('BOARD_RECOVERY_REQUIRED', 'Board transaction recovery failed; data was preserved for inspection.', 503, error); }
    });
  }
}
