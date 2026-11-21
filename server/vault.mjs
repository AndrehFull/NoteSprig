import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { parseFrontmatter } from './frontmatter.mjs';
import { stringify as yamlStringify } from 'yaml';
import { migrateVaultMetadata } from './legacy.mjs';
import { BoardTransactions, normalizeBoardTransactionPath } from './board-transactions.mjs';
import { BoardReferenceState } from './board-reference-state.mjs';
import { isManagedPath, protectsManagedPath, validateBoard, boardCards, cardMetadata, sameContext } from '../shared/board-schema.mjs';
import { kindForPath, documentLimit, documentTitle, isDocumentPath } from '../shared/document-kinds.mjs';
const maxNoteBytes = 2 * 1024 * 1024;
const maxFileBytes = 50 * 1024 * 1024;
const allowedExtensions = new Set(['.md', '.canvas', '.base', '.board', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.pdf', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.txt', '.csv', '.json', '.zip']);
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8' };
const hash = (content) => createHash('sha256').update(content).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const stem = (value) => value.replace(/\.md$/i, '');
const basename = (value) => path.posix.basename(stem(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
export class Vault {
    constructor(root, boardOptions = {}) { this.root = path.resolve(root); this.queue = Promise.resolve(); this.boardOptions = boardOptions; }
    async initialize() {
        await mkdir(this.root, { recursive: true });
        this.root = await realpath(this.root);
        await migrateVaultMetadata(this.root);
        await this.internalDirectory('.notesprig');
        await this.internalDirectory('.trash');
        await this.recoverTransaction();
        this.boardTransactions = await new BoardTransactions(this.root, this.boardOptions).initialize();
        this.boardReferences = new BoardReferenceState(this.root, this.boardTransactions);
        await this.boardReferences.initialize((await this.list()).map((note) => note.path));
    }
    isInside(candidate) { const relative = path.relative(this.root, candidate); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
    normalizeRelative(relative, directory = false) {
        if (typeof relative !== 'string' || !relative.trim() || relative.includes('\0') || relative.startsWith('/') || relative.includes('\\'))
            throw fail("Invalid path.");
        const parts = relative.split('/');
        if (parts.some((part) => !part.trim() || part !== part.trim() || part.startsWith('.') || /[<>:"|?*\u0000-\u001f]/.test(part)))
            throw fail("The path contains a blocked segment.");
        const absolute = path.resolve(this.root, ...parts);
        if (!this.isInside(absolute))
            throw fail("Path is outside the vault.");
        if (!directory && !allowedExtensions.has(path.posix.extname(relative).toLowerCase()))
            throw fail("Unsupported file format.");
        return { relative: parts.join('/'), absolute };
    }
    async ensureSafeDirectory(directory) {
        if (directory !== this.root && !this.isInside(directory))
            throw fail("Folder is outside the vault.");
        let cursor = this.root;
        for (const segment of path.relative(this.root, directory).split(path.sep).filter(Boolean)) {
            cursor = path.join(cursor, segment);
            await mkdir(cursor).catch((error) => { if (error.code !== 'EEXIST')
                throw error; });
            const info = await lstat(cursor);
            if (!info.isDirectory() || info.isSymbolicLink())
                throw fail("The folder contains a symbolic link.");
        }
    }
    async internalDirectory(name) {
        const target = path.join(this.root, name);
        await this.ensureSafeDirectory(target);
        const info = await lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw fail("Invalid internal data directory.");
        return target;
    }
    async checkedExistingPath(relative, directory = false) {
        return this.barrier(async () => {
        const file = this.normalizeRelative(relative, directory);
        let cursor = this.root;
        for (const segment of file.relative.split('/')) {
            cursor = path.join(cursor, segment);
            const info = await lstat(cursor).catch((error) => { if (error.code === 'ENOENT')
                throw fail("File not found.", 404); throw error; });
            if (info.isSymbolicLink())
                throw fail("Symbolic links are not allowed.");
        }
        const info = await stat(file.absolute);
        if (!info.isFile() && !(directory && info.isDirectory()))
            throw fail("The path is not a file.");
        return { ...file, info };

        });
    }
    mutate(action) {
        if (this.boardTransactions) return this.boardTransactions.read(action);
        const task = this.queue.then(action);
        this.queue = task.catch(() => { });
        return task;
    }
    barrier(action) { return this.boardTransactions ? this.boardTransactions.read(action) : action(); }
    protectManaged(relative, ancestor = false) {
        if ((ancestor ? protectsManagedPath : isManagedPath)(relative)) throw Object.assign(fail('Managed board assets are immutable. Use the board asset API.', 403), { code: 'MANAGED_BOARD_ASSET' });
    }
    rejectGenericBoard(relative) {
        if (kindForPath(relative) === 'board') throw Object.assign(fail('Use the dedicated board API for board documents.', 400), { code: 'BOARD_API_REQUIRED' });
    }
    async historyPlan(requests) {
        const writes = [], deletes = [], groups = new Map();
        for (const request of requests) {
            const directory = `.notesprig/history/${hash(request.path)}`;
            let group = groups.get(directory);
            if (!group) {
                const exists = await this.boardTransactions.inspectDirectory(directory);
                const names = exists ? (await readdir(path.join(this.root, directory))).filter((name) => /^[\d]+-[a-f\d-]{36}\.json$/.test(name)).sort() : [];
                let lastHash;
                if (names.length) { await this.boardTransactions.inspect(`${directory}/${names.at(-1)}`); lastHash = JSON.parse(await readFile(path.join(this.root, directory, names.at(-1)), 'utf8')).hash; }
                group = { names, lastHash, added: 0 }; groups.set(directory, group);
            }
            const digest = hash(request.content); if (group.lastHash === digest) continue;
            this.historyClock = Math.max(Date.now(), (this.historyClock || 0) + 1);
            const id = `${this.historyClock}-${randomUUID()}`, record = { id, path: request.path, content: request.content, hash: digest, createdAt: this.historyClock, size: Buffer.byteLength(request.content), reason: request.reason || 'edit' };
            writes.push({ path: `${directory}/${id}.json`, content: JSON.stringify(record), expectedHash: null }); group.lastHash = digest; group.added++;
        }
        for (const [directory, group] of groups) for (const name of group.names.slice(0, Math.max(0, group.names.length + group.added - 100))) {
            const relative = `${directory}/${name}`; deletes.push({ path: relative, expectedHash: (await this.boardTransactions.inspect(relative)).hash });
        }
        return { writes, deletes };
    }
    async collectTree(relative) {
        normalizeBoardTransactionPath(relative);
        const files = [], directories = []; let bytes = 0, count = 0;
        const walk = async (entry) => {
            normalizeBoardTransactionPath(entry); let cursor = this.root, info;
            for (const segment of entry.split('/')) {
                cursor = path.join(cursor, segment); info = await lstat(cursor);
                if (info.isSymbolicLink()) throw fail('Symbolic links are not allowed.');
                if (cursor !== path.join(this.root, entry) && !info.isDirectory()) throw fail('A path ancestor is not a directory.');
            }
            if (++count > this.boardTransactions.limits.documents) throw fail('Too many affected transaction documents.', 413);
            if (info.isDirectory()) { directories.push(entry); for (const child of await readdir(cursor)) await walk(`${entry}/${child}`); }
            else {
                if (!info.isFile() || info.nlink !== 1) throw fail('Only regular, unshared files can be moved.');
                bytes += info.size; if (bytes > this.boardTransactions.limits.stagedBytes / 2) throw fail('Transaction staging budget exceeded.', 413);
                files.push({ path: entry, data: await readFile(cursor) });
            }
        };
        await walk(relative); return { files, directories };
    }
    async listFiles() {
        return this.barrier(async () => {
        const result = [];
        const referenceState = this.boardReferences ? await this.boardReferences.loadUnlocked() : null;
        const walk = async (directory, prefix = '') => {
            const entries = await readdir(directory, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
                    continue;
                const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
                const absolute = path.join(directory, entry.name);
                try {
                    const info = await stat(absolute);
                    if (entry.isDirectory()) {
                        result.push({ path: relative, title: entry.name, kind: 'folder', aliases: [], tags: [], links: [], mtime: info.mtimeMs, size: 0 });
                        await walk(absolute, relative);
                    }
                    else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
                        const kind = kindForPath(relative);
                        const metadata = kind === 'markdown' && info.size <= maxNoteBytes ? parseMetadata(await readFile(absolute, 'utf8'), relative) : { title: documentTitle(relative), aliases: [], tags: [], links: [] };
                        if (kind === 'board' && info.size <= documentLimit(relative)) {
                            const content = await readFile(absolute, 'utf8'); let board;
                            try { board = validateBoard(content); } catch (error) { if (error.name !== 'BoardError' && !(error instanceof SyntaxError)) throw error; }
                            if (board && referenceState && sameContext(board.referenceContext, referenceState)) metadata.links = [...new Set(boardCards(board).map(cardMetadata).filter((card) => card.binding.state === 'bound').map((card) => card.binding.path))].map((target) => ({ target, embed: true, kind: 'wiki' }));
                        }
                        result.push({ ...metadata, path: relative, kind, mtime: info.mtimeMs, size: info.size });
                    }
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
        };
        await walk(this.root);
        // Card bindings are exact Markdown paths. A removed target is not a
        // graph edge, even if an older board scene has not yet been reviewed.
        const markdownPaths = new Set(result.filter((entry) => entry.kind === 'markdown').map((entry) => entry.path));
        for (const entry of result) if (entry.kind === 'board') entry.links = entry.links.filter((link) => markdownPaths.has(link.target));
        return result;

        });
    }
    async list() { return (await this.listFiles()).filter((file) => file.kind === 'markdown'); }
    async read(relative) {
        return this.barrier(async () => {
        const file = await this.checkedExistingPath(relative);
        if (!isDocumentPath(relative))
            throw fail("This file is an attachment.");
        if (file.info.size > documentLimit(relative))
            throw fail(`The document exceeds ${documentLimit(relative) / 1024 ** 2} MB.`);
        const content = await readFile(file.absolute, 'utf8');
        if (kindForPath(relative) === 'board') validateBoard(content);
        const parsed = /\.md$/i.test(relative) ? parseFrontmatter(content) : { content, data: {} };
        return { ...parseMetadata(/\.md$/i.test(relative) ? content : '', file.relative), path: file.relative, kind: kindForPath(relative), content, body: parsed.content, properties: parsed.data, hash: hash(content), mtime: file.info.mtimeMs, size: file.info.size };

        });
    }
    validateContent(relative, content) {
        this.rejectGenericBoard(relative);
        if (!isDocumentPath(relative)) throw fail('Use the attachment upload API for this file format.');
        if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxNoteBytes)
            throw fail("The document must be text of up to 2 MB.");
        if (/\.canvas$/i.test(relative))
            validateCanvas(JSON.parse(content));
        return content;
    }
    snapshot(relative, content, reason = 'edit') { return this.mutate(async () => { this.normalizeRelative(relative); this.protectManaged(relative); this.rejectGenericBoard(relative); const history = await this.historyPlan([{ path: relative, content, reason }]); await this.boardTransactions.run(history); }); }
    create(relative, content) {
        return this.mutate(async () => {
            const file = this.normalizeRelative(relative); this.protectManaged(file.relative); this.validateContent(relative, content);
            const history = await this.historyPlan([{ path: relative, content, reason: 'create' }]);
            await this.boardReferences.runChange({ createPaths: /\.md$/i.test(relative) ? [relative] : [] }, () => ({ writes: [{ path: file.relative, content, expectedHash: null }, ...history.writes], deletes: history.deletes }));
            return this.read(relative);
        });
    }
    update(relative, content, baseHash, referenceContext) {
        return this.mutate(async () => {
            this.protectManaged(relative); this.validateContent(relative, content);
            if (referenceContext !== undefined) await this.boardReferences.assertContext(referenceContext);
            const file = await this.checkedExistingPath(relative), current = await readFile(file.absolute, 'utf8');
            if (current === content) return { conflict: false, note: await this.read(relative) };
            if (typeof baseHash !== 'string' || baseHash !== hash(current)) return { conflict: true, current: await this.read(relative) };
            const history = await this.historyPlan([{ path: relative, content: current }, { path: relative, content }]);
            await this.boardTransactions.run({ writes: [{ path: file.relative, content, expectedHash: baseHash }, ...history.writes], deletes: history.deletes });
            return { conflict: false, note: await this.read(relative) };
        });
    }
    async versions(relative) {
        return this.barrier(async () => {
        this.normalizeRelative(relative);
        const directory = path.join(this.root, '.notesprig/history', hash(relative));
        if (this.boardTransactions) await this.boardTransactions.inspectDirectory(`.notesprig/history/${hash(relative)}`);
        const names = await readdir(directory).catch((error) => { if (error.code === 'ENOENT')
            return []; throw error; });
        const result = [];
        for (const name of names.filter((name) => /^[\d]+-[a-f\d-]{36}\.json$/.test(name)).sort().reverse()) {
            if (this.boardTransactions) await this.boardTransactions.inspect(`.notesprig/history/${hash(relative)}/${name}`);
            const { content, ...metadata } = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
            result.push(metadata);
        }
        return result;

        });
    }
    async version(relative, id) {
        return this.barrier(async () => {
        this.normalizeRelative(relative);
        if (!/^[\d]+-[a-f\d-]{36}$/.test(id))
            throw fail("Invalid version.");
        if (this.boardTransactions) await this.boardTransactions.inspect(`.notesprig/history/${hash(relative)}/${id}.json`);
        return JSON.parse(await readFile(path.join(this.root, '.notesprig/history', hash(relative), `${id}.json`), 'utf8'));

        });
    }
    restoreVersion(relative, id, baseHash) {
        return this.mutate(async () => {
            this.protectManaged(relative); this.rejectGenericBoard(relative);
            const version = await this.version(relative, id), current = await this.read(relative);
            if (baseHash !== current.hash) return { conflict: true, current };
            this.validateContent(relative, version.content);
            const history = await this.historyPlan([{ path: relative, content: current.content, reason: 'before-restore' }, { path: relative, content: version.content, reason: 'restore' }]);
            await this.boardReferences.runChange({ replacePaths: /\.md$/i.test(relative) ? [relative] : [] }, () => ({ writes: [{ path: relative, content: version.content, expectedHash: baseHash }, ...history.writes], deletes: history.deletes }));
            return { conflict: false, note: await this.read(relative) };
        });
    }
    folder(relative) {
        return this.mutate(async () => {
            const file = this.normalizeRelative(relative, true); this.protectManaged(file.relative);
            await this.boardTransactions.run({ directories: [{ path: file.relative, op: 'create' }] }); return { path: relative };
        });
    }
    async upload(relative, base64, overwrite = false) {
        return this.mutate(async () => {
            const file = this.normalizeRelative(relative); this.protectManaged(file.relative); this.rejectGenericBoard(relative);
            if (typeof base64 !== 'string' || base64.length > Math.ceil(maxFileBytes / 3) * 4 || !/^[A-Za-z\d+/]*={0,2}$/.test(base64)) throw fail('Invalid file or file larger than 50 MB.');
            const buffer = Buffer.from(base64, 'base64'); if (buffer.length > maxFileBytes) throw fail('File larger than 50 MB.');
            if (isDocumentPath(relative)) this.validateContent(relative, buffer.toString('utf8'));
            const current = await this.boardTransactions.inspect(relative);
            if (current && !overwrite) throw fail('A file already exists at this path.', 409);
            const history = isDocumentPath(relative) ? await this.historyPlan([...(current ? [{ path: relative, content: await readFile(file.absolute, 'utf8'), reason: 'before-import' }] : []), { path: relative, content: buffer.toString('utf8'), reason: 'import' }]) : { writes: [], deletes: [] };
            const change = /\.md$/i.test(relative) ? current ? { replacePaths: [relative] } : { createPaths: [relative] } : {};
            await this.boardReferences.runChange(change, () => ({ writes: [{ path: relative, content: buffer, expectedHash: current?.hash ?? null }, ...history.writes], deletes: history.deletes }));
            return { path: relative, size: buffer.length };
        });
    }
    trash(relative) {
        return this.mutate(async () => {
            this.protectManaged(relative, true); const file = await this.checkedExistingPath(relative, true), tree = await this.collectTree(relative);
            const id = `${Date.now()}-${randomUUID()}`, directory = `.trash/${id}`, destination = `${directory}/content`;
            const kind = file.info.isDirectory() ? 'folder' : kindForPath(relative);
            const metadata = { id, path: relative, trashedAt: Date.now(), kind, size: file.info.size };
            for (const entry of tree.files.filter((entry) => kindForPath(entry.path) === 'board')) validateBoard(entry.data.toString('utf8'));
            const history = await this.historyPlan(tree.files.filter((entry) => isDocumentPath(entry.path)).map((entry) => ({ path: entry.path, content: entry.data.toString('utf8'), reason: 'before-delete' })));
            const moved = tree.files.map((entry) => ({ path: destination + entry.path.slice(relative.length), content: entry.data, expectedHash: null }));
            await this.boardReferences.runChange({ deletePaths: tree.files.filter((entry) => /\.md$/i.test(entry.path)).map((entry) => entry.path) }, () => ({ writes: [{ path: `${directory}/metadata.json`, content: JSON.stringify(metadata), expectedHash: null }, ...moved, ...history.writes], deletes: [...tree.files.map((entry) => ({ path: entry.path, expectedHash: hash(entry.data) })), ...history.deletes], directories: [...tree.directories.map((entry) => ({ path: destination + entry.slice(relative.length), op: 'create' })), ...tree.directories.map((entry) => ({ path: entry, op: 'remove', expectedExists: true }))] }));
            return { path: relative, id, trashedAt: metadata.trashedAt };
        });
    }
    async trashList() {
        return this.barrier(async () => {
        const root = await this.internalDirectory('.trash');
        const result = [];
        for (const entry of await readdir(root, { withFileTypes: true }))
            if (entry.isDirectory() && /^[\d]+-[a-f\d-]{36}$/.test(entry.name)) {
                try {
                    await this.boardTransactions.inspect(`.trash/${entry.name}/metadata.json`);
                    // Both file and directory content entries are accepted,
                    // but symbolic links in trash must never be followed.
                    const contentInfo = await lstat(path.join(root, entry.name, 'content'));
                    if (contentInfo.isSymbolicLink()) continue;
                    const metadata = JSON.parse(await readFile(path.join(root, entry.name, 'metadata.json'), 'utf8'));
                    await lstat(path.join(root, entry.name, 'content'));
                    result.push(metadata);
                }
                catch { /* Interrupted empty trash entry. */ }
            }
        return result.sort((a, b) => b.trashedAt - a.trashedAt);

        });
    }
    restoreTrash(id, destination) {
        return this.mutate(async () => {
            if (!/^[\d]+-[a-f\d-]{36}$/.test(id)) throw fail('Invalid trash entry.');
            const directory = `.trash/${id}`, metadataPath = `${directory}/metadata.json`;
            const metadataFile = await this.boardTransactions.inspect(metadataPath); if (!metadataFile) throw fail('Trash entry not found.', 404);
            const metadata = JSON.parse(await readFile(metadataFile.absolute, 'utf8'));
            const target = this.normalizeRelative(destination || metadata.path, metadata.kind === 'folder'); this.protectManaged(target.relative, true);
            if (await lstat(target.absolute).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; })) throw fail('A file already exists at the target. Choose another path.', 409);
            const source = `${directory}/content`, tree = await this.collectTree(source);
            const writes = tree.files.map((entry) => {
                const relative = target.relative + entry.path.slice(source.length); this.normalizeRelative(relative); this.protectManaged(relative);
                if (kindForPath(relative) === 'board') validateBoard(entry.data.toString('utf8'));
                return { path: relative, content: entry.data, expectedHash: null };
            });
            const directories = [...tree.directories.map((entry) => ({ path: target.relative + entry.slice(source.length), op: 'create' })), ...tree.directories.map((entry) => ({ path: entry, op: 'remove', expectedExists: true })), { path: directory, op: 'remove', expectedExists: true }];
            await this.boardReferences.runChange({ createPaths: writes.filter((entry) => /\.md$/i.test(entry.path)).map((entry) => entry.path) }, () => ({ writes, deletes: [{ path: metadataPath, expectedHash: metadataFile.hash }, ...tree.files.map((entry) => ({ path: entry.path, expectedHash: hash(entry.data) }))], directories }));
            return { path: target.relative, kind: metadata.kind };
        });
    }
    async attachment(relative) {
        return this.barrier(async () => {
        const file = await this.checkedExistingPath(relative);
        if (file.info.size > maxFileBytes)
            throw fail("File larger than 50 MB.");
        return { absolute: file.absolute, type: mimeTypes[path.extname(relative).toLowerCase()] || 'application/octet-stream', size: file.info.size, name: path.basename(relative), preview: Boolean(mimeTypes[path.extname(relative).toLowerCase()]) };

        });
    }
    async exportArchive() {
        return this.barrier(async () => {
        const entries = {};
        let size = 0;
        for (const file of await this.listFiles())
            if (file.kind !== 'folder') {
                size += file.size;
                if (size > 128 * 1024 * 1024)
                    throw fail("The vault exceeds 128 MB. Use the server backup tool.", 413);
                entries[file.path] = new Uint8Array(await readFile((await this.checkedExistingPath(file.path)).absolute));
            }
        return Buffer.from(zipSync(entries, { level: 6 }));

        });
    }
    async settings(value) {
        return this.barrier(async () => {
        const file = path.join(this.root, '.notesprig', 'settings.json');
        if (value === undefined)
            return readFile(file, 'utf8').then(JSON.parse, (error) => { if (error.code === 'ENOENT')
                return {}; throw error; });
        if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 128 * 1024)
            throw fail("Invalid configuration.");
        return this.mutate(async () => { await atomicWrite(file, JSON.stringify(value, null, 2), false); return value; });

        });
    }
    async importArchive(base64, overwrite = false) {
        if (typeof base64 !== 'string' || base64.length > 100 * 1024 * 1024)
            throw fail("ZIP file is too large.");
        let total = 0;
        const skipped = [];
        const entries = unzipSync(Buffer.from(base64, 'base64'), { filter: (file) => {
                if (file.name.endsWith('/') || file.name.split('/').some((part) => part.startsWith('.')))
                    return false;
                try {
                    this.normalizeRelative(file.name);
                    if (kindForPath(file.name) === 'board' || isManagedPath(file.name)) { skipped.push(file.name); return false; }
                }
                catch {
                    skipped.push(file.name);
                    return false;
                }
                total += file.originalSize;
                if (total > 128 * 1024 * 1024 || file.originalSize > maxFileBytes)
                    throw fail("Expanded ZIP contents exceed the allowed limit.");
                return true;
            } });
        let imported = 0;
        for (const [relative, data] of Object.entries(entries)) {
            try {
                await this.upload(relative, Buffer.from(data).toString('base64'), overwrite);
                imported++;
            }
            catch (error) {
                if (error.status === 409)
                    skipped.push(relative);
                else
                    throw error;
            }
        }
        return { imported, skipped };
    }
    async recoverTransaction() {
        const journal = path.join(this.root, '.notesprig', 'transaction.json');
        const transaction = await readFile(journal, 'utf8').then(JSON.parse, (error) => { if (error.code === 'ENOENT')
            return null; throw error; });
        if (!transaction)
            return;
        if (transaction.directoryMove) {
            const from = this.normalizeRelative(transaction.directoryMove.from, true), to = this.normalizeRelative(transaction.directoryMove.to, true);
            const fromExists = await lstat(from.absolute).then(() => true, () => false), toExists = await lstat(to.absolute).then(() => true, () => false);
            if (!fromExists && toExists) {
                await this.ensureSafeDirectory(path.dirname(from.absolute));
                await rename(to.absolute, from.absolute);
            }
        }
        for (const entry of transaction.originals) {
            const file = this.normalizeRelative(entry.path);
            await this.ensureSafeDirectory(path.dirname(file.absolute));
            await atomicWrite(file.absolute, Buffer.from(entry.base64, 'base64'), false);
        }
        for (const relative of transaction.created) {
            const file = this.normalizeRelative(relative);
            await unlink(file.absolute).catch((error) => { if (error.code !== 'ENOENT')
                throw error; });
        }
        await unlink(journal);
    }
    merge(sourcePath, targetPath, sourceHash, targetHash, prepend = false) {
        return this.mutate(async () => {
            if (sourcePath === targetPath || !/\.md$/i.test(sourcePath) || !/\.md$/i.test(targetPath)) throw fail('Choose two different Markdown notes.');
            this.protectManaged(sourcePath); this.protectManaged(targetPath);
            const source = await this.read(sourcePath), target = await this.read(targetPath);
            if (source.hash !== sourceHash || target.hash !== targetHash) throw fail('One of the notes changed. Refresh the preview before merging.', 409);
            const all = (await this.listFiles()).filter((file) => file.kind !== 'folder'), mapping = new Map([[sourcePath, targetPath]]);
            const properties = { ...source.properties, ...target.properties };
            for (const key of ['tags', 'aliases']) { const values = [...new Set([...toStringList(source.properties[key]), ...toStringList(target.properties[key])])]; if (values.length) properties[key] = values; }
            const sourceBody = rewriteLinks(source.body, sourcePath, targetPath, all, mapping).trim();
            const bodies = prepend ? [sourceBody, target.body.trim()] : [target.body.trim(), sourceBody];
            const merged = `${Object.keys(properties).length ? `---\n${yamlStringify(properties)}---\n` : ''}${bodies.filter(Boolean).join('\n\n')}\n`; this.validateContent(targetPath, merged);
            const writes = [], updated = [], historyRequests = [{ path: sourcePath, content: source.content, reason: 'before-merge' }];
            for (const file of all.filter((file) => (file.kind === 'markdown' || file.kind === 'canvas') && file.path !== sourcePath)) {
                const original = file.path === targetPath ? target.content : await readFile((await this.checkedExistingPath(file.path)).absolute, 'utf8'); let next = file.path === targetPath ? merged : original;
                if (file.kind === 'canvas') { const document = JSON.parse(next); let changed = false; for (const node of document.nodes || []) for (const key of ['file', 'background']) if (node[key] === sourcePath) { node[key] = targetPath; changed = true; } if (changed) next = JSON.stringify(document, null, '\t'); }
                else next = rewriteLinks(next, file.path, file.path, all, mapping);
                if (next !== original) { this.validateContent(file.path, next); historyRequests.push({ path: file.path, content: original, reason: 'before-merge' }, { path: file.path, content: next, reason: 'merge' }); writes.push({ path: file.path, content: next, expectedHash: hash(original) }); updated.push(file.path); }
            }
            const id = `${Date.now()}-${randomUUID()}`, directory = `.trash/${id}`, history = await this.historyPlan(historyRequests);
            await this.boardReferences.runChange({ deletePaths: [sourcePath], replacePaths: [targetPath] }, () => ({ writes: [...writes, ...history.writes, { path: `${directory}/metadata.json`, content: JSON.stringify({ id, path: sourcePath, trashedAt: Date.now(), kind: 'markdown', size: Buffer.byteLength(source.content) }), expectedHash: null }, { path: `${directory}/content`, content: source.content, expectedHash: null }], deletes: [{ path: sourcePath, expectedHash: sourceHash }, ...history.deletes] }));
            return { note: await this.read(targetPath), updated };
        });
    }
    rename(oldRelative, newRelative, updateLinks = true) {
        return this.mutate(async () => {
            this.protectManaged(oldRelative, true); this.protectManaged(newRelative, true);
            const source = await this.checkedExistingPath(oldRelative, true), target = this.normalizeRelative(newRelative, source.info.isDirectory());
            if (source.relative === target.relative) return { path: source.relative, updated: [] };
            if (target.relative.startsWith(`${source.relative}/`)) throw fail('A folder cannot be moved inside itself.');
            if (source.info.isFile() && (isDocumentPath(source.relative) || isDocumentPath(target.relative)) && path.extname(source.relative).toLowerCase() !== path.extname(target.relative).toLowerCase()) throw fail('Keep the document extension when renaming.');
            if (await lstat(target.absolute).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; })) throw fail('A file or folder already exists at the target.', 409);
            const tree = await this.collectTree(source.relative), all = await this.listFiles();
            const mapping = new Map(tree.files.map((entry) => [entry.path, target.relative + entry.path.slice(source.relative.length)]));
            const originalData = new Map(tree.files.map((entry) => [entry.path, entry.data])), writes = new Map(), updated = [], historyRequests = [];
            for (const [from, to] of mapping) { this.normalizeRelative(to); this.protectManaged(to); writes.set(to, originalData.get(from)); }
            if (updateLinks) for (const file of all.filter((file) => file.kind === 'markdown' || file.kind === 'canvas')) {
                const data = originalData.get(file.path) || await readFile((await this.checkedExistingPath(file.path)).absolute), content = data.toString('utf8'), nextPath = mapping.get(file.path) || file.path; let next = content;
                if (file.kind === 'canvas') { const document = JSON.parse(content); let changed = false; for (const node of document.nodes || []) for (const key of ['file', 'background']) if (mapping.has(node[key])) { node[key] = mapping.get(node[key]); changed = true; } if (changed) next = JSON.stringify(document, null, '\t'); }
                else next = rewriteLinks(content, file.path, nextPath, all.filter((entry) => entry.kind !== 'folder'), mapping);
                if (next !== content) { this.validateContent(file.path, next); originalData.set(file.path, data); writes.set(nextPath, Buffer.from(next)); updated.push(nextPath); }
            }
            for (const [relative, data] of originalData) if (isDocumentPath(relative)) { if (kindForPath(relative) === 'board') validateBoard(data.toString('utf8')); historyRequests.push({ path: relative, content: data.toString('utf8'), reason: 'before-rename' }); }
            const history = await this.historyPlan(historyRequests), historyCopies = [];
            const copyHistory = async (to, original) => {
                const relative = `.notesprig/history/${hash(to)}/${original.id}.json`, content = JSON.stringify({ ...original, path: to });
                const existing = await this.boardTransactions.inspect(relative);
                if (existing && existing.hash !== hash(content)) throw fail('A historical version at the destination differs. Choose another path.', 409);
                if (!existing) historyCopies.push({ path: relative, content, expectedHash: null });
            };
            for (const [from, to] of mapping) if (isDocumentPath(from)) {
                for (const version of await this.versions(from)) await copyHistory(to, await this.version(from, version.id));
                for (const entry of history.writes.filter((entry) => entry.path.startsWith(`.notesprig/history/${hash(from)}/`))) await copyHistory(to, JSON.parse(entry.content));
            }
            const stagedWrites = [...writes].map(([relative, data]) => ({ path: relative, content: data, expectedHash: mapping.has(relative) ? null : originalData.has(relative) ? hash(originalData.get(relative)) : null }));
            const directories = [...tree.directories.map((entry) => ({ path: target.relative + entry.slice(source.relative.length), op: 'create' })), ...tree.directories.map((entry) => ({ path: entry, op: 'remove', expectedExists: true }))];
            await this.boardReferences.runChange({ renamePaths: [...mapping].filter(([from]) => /\.md$/i.test(from)).map(([from, to]) => ({ from, to })) }, () => ({ writes: [...stagedWrites, ...history.writes, ...historyCopies], deletes: [...tree.files.map((entry) => ({ path: entry.path, expectedHash: hash(entry.data) })), ...history.deletes], directories }));
            return { path: target.relative, updated, moved: Object.fromEntries(mapping) };
        });
    }
}
export function parseMetadata(content, relative) {
    const parsed = parseFrontmatter(content);
    const body = parsed.content;
    const indexable = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, '').replace(/`+[^`\n]*`+/g, '');
    const aliases = toStringList(parsed.data.aliases || parsed.data.alias);
    const tags = [...new Set([...toStringList(parsed.data.tags).map((tag) => tag.replace(/^#/, '')), ...[...indexable.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[1])])];
    const links = [...indexable.matchAll(/!?\[\[([^\]]+)\]\]/g)].map((match) => { const target = match[1].split('|')[0].split('#')[0].trim(); return target ? { target, embed: match[0].startsWith('!'), kind: 'wiki' } : null; }).filter(Boolean);
    for (const match of indexable.matchAll(/(!?)\[[^\]\n]*\]\(<?([^)>\n]+?)>?(?:\s+"[^"]*")?\)|^\s*\[[^\]]+\]:\s*<?([^>\s]+)>?/gm)) {
        let target = (match[2] || match[3] || '').trim().split('#')[0];
        try {
            target = decodeURIComponent(target);
        }
        catch { /* Literal percent. */ }
        if (target && !/^[a-z][a-z\d+.-]*:/i.test(target))
            links.push({ target, embed: match[1] === '!', kind: 'markdown' });
    }
    return { title: body.match(/^\s*#\s+(.+)\s*$/m)?.[1]?.trim() || basename(relative), aliases, tags, links, propertyError: parsed.error };
}
function toStringList(value) { return (Array.isArray(value) ? value : value == null ? [] : [value]).filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean); }
export function validateCanvas(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document) || document.nodes !== undefined && !Array.isArray(document.nodes) || document.edges !== undefined && !Array.isArray(document.edges))
        throw fail("Invalid Canvas: nodes and edges must be lists when present.");
    const nodes = document.nodes || [], edges = document.edges || [];
    if (nodes.length > 5000 || edges.length > 10000)
        throw fail("Canvas exceeds the element limit.");
    const ids = new Set();
    for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['text', 'file', 'link', 'group'].includes(node.type) || ![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0)
            throw fail("Canvas contains an invalid card.");
        if (node.type === 'text' && typeof node.text !== 'string' || node.type === 'file' && typeof node.file !== 'string' || node.type === 'link' && typeof node.url !== 'string')
            throw fail("Invalid card content.");
        ids.add(node.id);
    }
    const edgeIds = new Set();
    for (const edge of edges) {
        if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id) || !ids.has(edge.fromNode) || !ids.has(edge.toNode))
            throw fail("Canvas contains an invalid connection.");
        edgeIds.add(edge.id);
    }
    return copy(document);
}
function resolveFile(raw, origin, files, markdown = false) {
    let target = raw.split('#')[0];
    try {
        target = decodeURIComponent(target);
    }
    catch { /* Literal percent. */ }
    const norm = (value) => stem(path.posix.normalize(value.replace(/^\//, ''))).toLocaleLowerCase();
    if (!target)
        return [];
    const local = norm(path.posix.join(path.posix.dirname(origin), target));
    const root = norm(target);
    if (markdown || /^\.\.?\//.test(target))
        return files.filter((file) => norm(file.path) === (target.startsWith('/') ? root : local));
    const exact = files.filter((file) => norm(file.path) === root);
    if (exact.length)
        return exact;
    const nearby = files.filter((file) => norm(file.path) === local);
    if (nearby.length)
        return nearby;
    return files.filter((file) => norm(file.path).endsWith(`/${root}`) || file.aliases?.some((alias) => alias.toLocaleLowerCase() === root));
}
function rewriteLinks(content, origin, nextOrigin, files, mapping) {
    const mask = content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, (value) => value.replace(/[^\n]/g, ' ')).replace(/`+[^`\n]*`+/g, (value) => ' '.repeat(value.length));
    let result = content.replace(/(!?\[\[)([^\]]+)(\]\])/g, (whole, start, raw, end, offset) => {
        if (mask[offset] === ' ')
            return whole;
        const [targetPart, ...labels] = raw.split('|');
        const [target, ...heading] = targetPart.split('#');
        const resolved = resolveFile(target, origin, files);
        if (resolved.length !== 1 || !mapping.has(resolved[0].path) && origin === nextOrigin)
            return whole;
        const next = mapping.get(resolved[0].path) || resolved[0].path;
        const short = basename(next);
        const projected = files.filter((file) => basename(mapping.get(file.path) || file.path).toLocaleLowerCase() === short.toLocaleLowerCase());
        if (!labels.length && resolved[0].aliases?.some((alias) => alias.toLocaleLowerCase() === target.toLocaleLowerCase()))
            labels.push(target);
        return `${start}${projected.length === 1 ? short : stem(next)}${target.endsWith('.md') ? '.md' : ''}${heading.length ? `#${heading.join('#')}` : ''}${labels.length ? `|${labels.join('|')}` : ''}${end}`;
    });
    // Offsets are evaluated against each source independently, so length changes in wiki links do not affect code exclusions.
    const markdownMask = result.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, (value) => value.replace(/[^\n]/g, ' ')).replace(/`+[^`\n]*`+/g, (value) => ' '.repeat(value.length));
    result = result.replace(/(!?\[[^\]\n]*\]\()<?([^)>\n]+?)>?(\))|(^\s*\[[^\]]+\]:\s*)<?([^>\s]+)>?/gm, (whole, start, raw, end, definition, definitionRaw, offset) => {
        if (markdownMask[offset] === ' ')
            return whole;
        const value = raw || definitionRaw;
        const [target, ...heading] = value.split('#');
        const resolved = resolveFile(target, origin, files, true);
        if (resolved.length !== 1)
            return whole;
        const next = mapping.get(resolved[0].path) || resolved[0].path;
        if (!mapping.has(resolved[0].path) && origin === nextOrigin)
            return whole;
        const relative = target.startsWith('/') ? `/${next}` : path.posix.relative(path.posix.dirname(nextOrigin), next);
        return `${start || definition}${encodeURI(relative).replace(/#/g, '%23')}${heading.length ? `#${heading.join('#')}` : ''}${end || ''}`;
    });
    return result;
}
async function atomicWrite(destination, content, exclusive) {
    const temporary = path.join(path.dirname(destination), `.notesprig-${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        await handle.writeFile(content);
        await handle.sync();
        await handle.close();
        handle = undefined;
        if (exclusive)
            await link(temporary, destination).catch((error) => { if (error.code === 'EEXIST')
                throw fail("A file already exists at this path.", 409); throw error; });
        else
            await rename(temporary, destination);
        const directory = await open(path.dirname(destination), constants.O_RDONLY);
        try {
            await directory.sync();
        }
        finally {
            await directory.close();
        }
    }
    finally {
        if (handle)
            await handle.close().catch(() => { });
        await unlink(temporary).catch(() => { });
    }
}
