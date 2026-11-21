import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { BoardError, BOARD_LIMITS, MANAGED_ASSET_ROOT, validateBoard, validVaultPath, sameContext, persistedAppearance, boardCards, cardMetadata, canonicalJSON } from '../shared/board-schema.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const fail = (message, code = 'INVALID_BOARD', status = 400, detail) => { throw new BoardError(message, code, status, detail); };
const digestPattern = /^[a-f\d]{64}$/;
export function managedAssetPath(asset) { return `${MANAGED_ASSET_ROOT}/${asset.sha256}.${extension[asset.mimeType]}`; }
function boardPath(value) {
  if (!validVaultPath(value) || !/\.board$/i.test(value)) fail('Choose a valid .board path.');
  return value;
}
function notePath(value) {
  if (!validVaultPath(value) || !/\.md$/i.test(value)) fail('Choose a valid Markdown note path.');
  return value;
}
function base64Bytes(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(BOARD_LIMITS.assetBytes / 3) * 4 || !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)) fail('Invalid board image data.');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > BOARD_LIMITS.assetBytes) fail('Board image exceeds 8 MiB.', 'ASSET_TOO_LARGE', 413);
  return bytes;
}
function rejectAnimation(bytes, format) {
  if (format === 'png') for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) fail('Invalid PNG chunk.');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') fail('Animated board images are not supported.');
    offset = end;
  }
  if (format === 'webp') for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4), end = offset + 8 + length;
    if (end > bytes.length) fail('Invalid WebP chunk.');
    const kind = bytes.toString('ascii', offset, offset + 4);
    if (kind === 'ANIM' || kind === 'ANMF' || kind === 'VP8X' && length > 0 && bytes[offset + 8] & 2) fail('Animated board images are not supported.');
    offset = end + (length % 2);
  }
}
export async function inspectBoardImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > BOARD_LIMITS.assetBytes) fail('Invalid board image size.');
  const image = sharp(bytes, { limitInputPixels: BOARD_LIMITS.pixels, animated: true, failOn: 'warning' });
  let metadata;
  try {
    metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height || metadata.width > BOARD_LIMITS.dimension || metadata.height > BOARD_LIMITS.dimension || metadata.width * metadata.height > BOARD_LIMITS.pixels) fail('Only bounded, static PNG, JPEG, and WebP images are supported.');
    rejectAnimation(bytes, metadata.format);
    await image.clone().raw().toBuffer(); // Decode before accepting; headers alone are insufficient.
  } catch (error) { if (error instanceof BoardError) throw error; fail('Could not decode the board image.'); }
  return { sha256: hash(bytes), mimeType: `image/${metadata.format}`, byteLength: bytes.length, width: metadata.width, height: metadata.height };
}

/** Board reads/writes share Vault's reference coordinator; no note resolution outside its guard. */
export class Boards {
  constructor(vault) { this.vault = vault; this.checkpoints = new Map(); }
  get transactions() { return this.vault.boardTransactions; }
  get references() { return this.vault.boardReferences; }
  context() { return this.references.getContext(); }
  async readUnlocked(relative) {
    boardPath(relative);
    const info = await this.transactions.inspect(relative);
    if (!info) fail('Board not found.', 'BOARD_NOT_FOUND', 404);
    if (info.bytes > BOARD_LIMITS.bytes) fail('Board exceeds 4 MiB.', 'BOARD_TOO_LARGE', 413);
    const content = await readFile(info.absolute, 'utf8');
    return { path: relative, board: validateBoard(content), hash: info.hash };
  }
  read(relative, context) { return this.references.readGuarded(context, () => this.readUnlocked(relative), { referenceEpoch: false }); }
  async checkAssets(board) {
    for (const asset of Object.values(board.assets)) {
      const info = await this.transactions.inspect(managedAssetPath(asset));
      if (!info || info.bytes !== asset.byteLength || info.hash !== asset.sha256) fail('A required board image is missing or changed.', 'MISSING_ASSET', 422);
      const decoded = await inspectBoardImage(await readFile(info.absolute));
      if (Object.keys(decoded).some(key => decoded[key] !== asset[key])) fail('Board image metadata does not match its bytes.', 'INVALID_ASSET', 422);
    }
  }
  async historyPlan(relative, board, reason, force = false) {
    const now = Date.now(), content = canonicalJSON(board), digest = hash(content);
    const directory = `.notesprig/history/${hash(relative)}`;
    const exists = await this.transactions.inspectDirectory(directory);
    const names = exists ? (await readdir(path.join(this.vault.root, directory))).filter(name => /^[\d]+-[a-f\d-]{36}\.json$/.test(name)).sort() : [];
    let last;
    if (names.length) {
      const info = await this.transactions.inspect(`${directory}/${names.at(-1)}`);
      if (!info || info.bytes > BOARD_LIMITS.bytes * 2 + 4096) fail('Invalid board history checkpoint.', 'INVALID_HISTORY', 503);
      last = JSON.parse(await readFile(info.absolute, 'utf8'));
    }
    const previous = Math.max(this.checkpoints.get(relative) || 0, Number.isSafeInteger(last?.createdAt) ? last.createdAt : 0);
    if (last?.hash === digest || !force && previous && now - previous < 45000) return { writes: [], deletes: [] };
    const timestamp = Math.max(now, (Number.isSafeInteger(last?.createdAt) ? last.createdAt : 0) + 1), id = `${timestamp}-${randomUUID()}`;
    const deletes = [];
    for (const name of names.slice(0, Math.max(0, names.length - 99))) {
      const relative = `${directory}/${name}`, info = await this.transactions.inspect(relative);
      deletes.push({ path: relative, expectedHash: info.hash });
    }
    // Checkpoint and board are included in the same durable decision.
    return { writes: [{ path: `${directory}/${id}.json`, content: JSON.stringify({ id, path: relative, content, hash: digest, createdAt: timestamp, size: Buffer.byteLength(content), reason }), createOnly: true }], deletes };
  }
  async save({ path: relative, board: input, baseHash, context, create = false }) {
    boardPath(relative);
    const board = validateBoard(input);
    if (!sameContext(board.referenceContext, context)) fail('References changed; review bindings before continuing.', 'REFERENCE_REVIEW_REQUIRED', 409);
    board.scene.appState = persistedAppearance(board.scene.appState);
    const content = canonicalJSON(board), digest = hash(content);
    const result = await this.references.runGuarded(context, async () => {
      const before = await this.transactions.inspect(relative);
      if (before) {
        const current = await this.readUnlocked(relative);
        if (current.board.boardId !== board.boardId) fail('The board identity at this path differs. Keep this draft and save a new copy.', 'BOARD_CONFLICT', 409);
        if (before.hash === digest) { await this.checkAssets(board); return { writes: [], result: { path: relative, board, hash: digest, checkpoint: false } }; }
        if (!sameContext(current.board.referenceContext, context)) fail('Review this board’s saved reference bindings before saving a new context.', 'REFERENCE_REVIEW_REQUIRED', 409);
      }
      if (create ? Boolean(before) : !before || before.hash !== baseHash) fail('The board changed elsewhere. Keep this draft and reload or save a copy.', 'BOARD_CONFLICT', 409);
      if (create) for (const file of (await this.vault.listFiles()).filter(file => file.kind === 'board' && file.path !== relative)) {
        const existing = await this.readUnlocked(file.path);
        if (existing.board.boardId === board.boardId) fail('A board copy needs a new board identity.', 'DUPLICATE_BOARD_ID', 409);
      }
      await this.checkAssets(board);
      const history = await this.historyPlan(relative, board, create ? 'create' : 'checkpoint', create);
      return { writes: [{ path: relative, content, expectedHash: create ? null : baseHash }, ...history.writes], deletes: history.deletes, result: { path: relative, board, hash: digest, checkpoint: history.writes.length > 0 } };
    });
    if (result.result.checkpoint) this.checkpoints.set(relative, Date.now());
    return result.result;
  }
  async assetUpload({ base64, context }) {
    const bytes = base64Bytes(base64), asset = await inspectBoardImage(bytes), relative = managedAssetPath(asset);
    const result = await this.references.runGuarded(context, async () => {
      const existing = await this.transactions.inspect(relative);
      if (existing && (existing.hash !== asset.sha256 || existing.bytes !== bytes.length)) fail('Managed asset integrity check failed.', 'INVALID_ASSET', 503);
      return { writes: existing ? [] : [{ path: relative, content: bytes, createOnly: true }], result: asset };
    });
    return result.result;
  }
  asset({ sha256, mimeType, context }) {
    if (!digestPattern.test(sha256 || '') || !extension[mimeType]) fail('Invalid board asset.');
    return this.references.readGuarded(context, async () => {
      const info = await this.transactions.inspect(managedAssetPath({ sha256, mimeType }));
      if (!info || info.hash !== sha256 || info.bytes > BOARD_LIMITS.assetBytes) fail('Board image unavailable.', 'MISSING_ASSET', 404);
      return { base64: (await readFile(info.absolute)).toString('base64'), sha256, mimeType };
    }, { referenceEpoch: false });
  }
  preview({ path: relative, fragment, context }) {
    notePath(relative);
    return this.references.readGuarded(context, async () => {
      const note = await this.vault.read(relative);
      const body = parseFrontmatter(note.content).content;
      let excerpt = body;
      if (typeof fragment === 'string' && fragment && !fragment.startsWith('^')) {
        const normalized = fragment.replace(/^#/, '').toLocaleLowerCase();
        const lines = body.split('\n'), start = lines.findIndex(line => line.replace(/^#{1,6}\s+/, '').trim().toLocaleLowerCase() === normalized);
        if (start >= 0) excerpt = lines.slice(start, start + 40).join('\n');
      }
      return { title: note.title.slice(0, 256), excerpt: excerpt.slice(0, 2000), status: 'ready', revision: note.hash };
    });
  }
  async restore({ path: relative, id, baseHash, context }) {
    boardPath(relative);
    const result = await this.references.runGuarded(context, async () => {
      const current = await this.readUnlocked(relative);
      if (current.hash !== baseHash) fail('The board changed while history was open.', 'BOARD_CONFLICT', 409);
      const version = await this.vault.version(relative, id);
      if (typeof version.content !== 'string' || version.hash !== hash(version.content) || version.id !== id || version.path !== relative) fail('The history checkpoint failed verification.', 'INVALID_HISTORY', 422);
      const board = validateBoard(version.content);
      if (board.boardId !== current.board.boardId) fail('This historical version belongs to another board. Import it as a new copy.', 'BOARD_CONFLICT', 409);
      await this.checkAssets(board);
      const history = await this.historyPlan(relative, current.board, 'before-restore', true), content = canonicalJSON(board);
      // Preserve the historical context. Replacing it with today's context would
      // silently bless references after a rename, restore, or occupied-path reuse.
      return { writes: [{ path: relative, content, expectedHash: baseHash }, ...history.writes], deletes: history.deletes, result: { path: relative, board, hash: hash(content), checkpoint: history.writes.length > 0 } };
    }, { referenceEpoch: false });
    if (result.result.checkpoint) this.checkpoints.set(relative, Date.now());
    return result.result;
  }
  async review({ path: relative, baseHash, context, previousContext, bindings }) {
    if (!Array.isArray(bindings) || bindings.length > BOARD_LIMITS.cards) fail('Invalid reference review.');
    if (bindings.some(binding => !binding || typeof binding.elementId !== 'string' || !['bound', 'unbound'].includes(binding.state) || binding.fragment !== undefined && typeof binding.fragment !== 'string')) fail('Invalid reference review.');
    const result = await this.references.runGuarded(context, async () => {
      const current = await this.readUnlocked(relative);
      if (baseHash !== current.hash || !sameContext(current.board.referenceContext, previousContext)) fail('The board changed while references were being reviewed.', 'BOARD_CONFLICT', 409);
      // A review is explicit for every live card. No path-exists shortcut.
      const cards = boardCards(current.board), choices = new Map(bindings.map(binding => [binding.elementId, binding]));
      if (choices.size !== cards.length || bindings.length !== cards.length) fail('Review every live note card before continuing.');
      for (const element of cards) {
        const choice = choices.get(element.id); if (!choice || !['bound', 'unbound'].includes(choice.state)) fail('Invalid reference review choice.');
        const metadata = cardMetadata(element);
        if (choice.state === 'bound') {
          notePath(choice.path);
          if (!(await this.transactions.inspect(choice.path))) fail('A selected note no longer exists.', 'REFERENCE_REVIEW_REQUIRED', 409);
          metadata.binding = { state: 'bound', path: choice.path, ...(choice.fragment ? { fragment: String(choice.fragment).slice(0, 1024) } : {}) };
        } else metadata.binding = { state: 'unbound', path: metadata.binding.path };
      }
      // Deleted historical cards remain unbound; undo cannot silently resurrect a stale binding.
      for (const element of boardCards(current.board, true).filter(element => element.isDeleted)) cardMetadata(element).binding.state = 'unbound';
      current.board.referenceContext = { ...context };
      const board = validateBoard(current.board), content = canonicalJSON(board);
      const history = await this.historyPlan(relative, board, 'reference-review', true);
      return { writes: [{ path: relative, content, expectedHash: baseHash }, ...history.writes], deletes: history.deletes, result: { path: relative, board, hash: hash(content) } };
    });
    this.checkpoints.set(relative, Date.now());
    return result.result;
  }
}
