import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { parseFrontmatter } from './frontmatter.mjs';
import { stringify as yamlStringify } from 'yaml';
import { migrateVaultMetadata } from './legacy.mjs';
const maxNoteBytes = 2 * 1024 * 1024;
const maxFileBytes = 50 * 1024 * 1024;
const allowedExtensions = new Set(['.md', '.canvas', '.base', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.pdf', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.txt', '.csv', '.json', '.zip']);
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8' };
const hash = (content) => createHash('sha256').update(content).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const stem = (value) => value.replace(/\.md$/i, '');
const basename = (value) => path.posix.basename(stem(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
export class Vault {
    constructor(root) { this.root = path.resolve(root); this.queue = Promise.resolve(); }
    async initialize() {
        await mkdir(this.root, { recursive: true });
        this.root = await realpath(this.root);
        await migrateVaultMetadata(this.root);
        await this.internalDirectory('.notesprig');
        await this.internalDirectory('.trash');
        await this.recoverTransaction();
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
    }
    mutate(action) {
        const task = this.queue.then(action);
        this.queue = task.catch(() => { });
        return task;
    }
    async listFiles() {
        const result = [];
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
                        const kind = /\.md$/i.test(relative) ? 'markdown' : /\.canvas$/i.test(relative) ? 'canvas' : /\.base$/i.test(relative) ? 'base' : 'attachment';
                        const metadata = kind === 'markdown' && info.size <= maxNoteBytes ? parseMetadata(await readFile(absolute, 'utf8'), relative) : { title: kind === 'canvas' ? entry.name.slice(0, -7) : entry.name, aliases: [], tags: [], links: [] };
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
        return result;
    }
    async list() { return (await this.listFiles()).filter((file) => file.kind === 'markdown'); }
    async read(relative) {
        const file = await this.checkedExistingPath(relative);
        if (!/\.(md|canvas|base)$/i.test(relative))
            throw fail("This file is an attachment.");
        if (file.info.size > maxNoteBytes)
            throw fail("The document exceeds 2 MB.");
        const content = await readFile(file.absolute, 'utf8');
        const parsed = /\.md$/i.test(relative) ? parseFrontmatter(content) : { content, data: {} };
        return { ...parseMetadata(/\.md$/i.test(relative) ? content : '', file.relative), path: file.relative, kind: /\.canvas$/i.test(relative) ? 'canvas' : /\.base$/i.test(relative) ? 'base' : 'markdown', content, body: parsed.content, properties: parsed.data, hash: hash(content), mtime: file.info.mtimeMs, size: file.info.size };
    }
    validateContent(relative, content) {
        if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxNoteBytes)
            throw fail("The document must be text of up to 2 MB.");
        if (/\.canvas$/i.test(relative))
            validateCanvas(JSON.parse(content));
        return content;
    }
    async snapshot(relative, content, reason = 'edit') {
        const root = await this.internalDirectory('.notesprig/history');
        const directory = path.join(root, hash(relative));
        await this.ensureSafeDirectory(directory);
        const digest = hash(content);
        const entries = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
        if (entries.length) {
            const last = JSON.parse(await readFile(path.join(directory, entries.at(-1)), 'utf8'));
            if (last.hash === digest)
                return;
        }
        const id = `${Date.now()}-${randomUUID()}`;
        await atomicWrite(path.join(directory, `${id}.json`), JSON.stringify({ id, path: relative, content, hash: digest, createdAt: Date.now(), size: Buffer.byteLength(content), reason }), true);
        for (const old of entries.slice(0, Math.max(0, entries.length - 99)))
            await unlink(path.join(directory, old));
    }
    create(relative, content) {
        return this.mutate(async () => {
            const file = this.normalizeRelative(relative);
            this.validateContent(relative, content);
            await this.ensureSafeDirectory(path.dirname(file.absolute));
            await atomicWrite(file.absolute, content, true);
            await this.snapshot(relative, content, 'create');
            return this.read(relative);
        });
    }
    update(relative, content, baseHash) {
        return this.mutate(async () => {
            this.validateContent(relative, content);
            const file = await this.checkedExistingPath(relative);
            const current = await readFile(file.absolute, 'utf8');
            if (current === content)
                return { conflict: false, note: await this.read(relative) };
            if (typeof baseHash !== 'string' || baseHash !== hash(current))
                return { conflict: true, current: await this.read(relative) };
            if (current !== content) {
                await this.snapshot(relative, current);
                await atomicWrite(file.absolute, content, false);
                await this.snapshot(relative, content);
            }
            return { conflict: false, note: await this.read(relative) };
        });
    }
    async versions(relative) {
        this.normalizeRelative(relative);
        const directory = path.join(this.root, '.notesprig/history', hash(relative));
        const names = await readdir(directory).catch((error) => { if (error.code === 'ENOENT')
            return []; throw error; });
        const result = [];
        for (const name of names.filter((name) => name.endsWith('.json')).sort().reverse()) {
            const { content, ...metadata } = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
            result.push(metadata);
        }
        return result;
    }
    async version(relative, id) {
        this.normalizeRelative(relative);
        if (!/^[\d]+-[a-f\d-]{36}$/.test(id))
            throw fail("Invalid version.");
        return JSON.parse(await readFile(path.join(this.root, '.notesprig/history', hash(relative), `${id}.json`), 'utf8'));
    }
    restoreVersion(relative, id, baseHash) {
        return this.mutate(async () => {
            const version = await this.version(relative, id);
            const current = await this.read(relative);
            if (baseHash !== current.hash)
                return { conflict: true, current };
            await this.snapshot(relative, current.content, 'before-restore');
            await atomicWrite(this.normalizeRelative(relative).absolute, version.content, false);
            await this.snapshot(relative, version.content, 'restore');
            return { conflict: false, note: await this.read(relative) };
        });
    }
    folder(relative) { return this.mutate(async () => { const file = this.normalizeRelative(relative, true); await this.ensureSafeDirectory(file.absolute); return { path: relative }; }); }
    async upload(relative, base64, overwrite = false) {
        return this.mutate(async () => {
            const file = this.normalizeRelative(relative);
            if (typeof base64 !== 'string' || base64.length > Math.ceil(maxFileBytes / 3) * 4 || !/^[A-Za-z\d+/]*={0,2}$/.test(base64))
                throw fail("Invalid file or file larger than 50 MB.");
            const buffer = Buffer.from(base64, 'base64');
            if (buffer.length > maxFileBytes)
                throw fail("File larger than 50 MB.");
            if (/\.(md|canvas|base)$/i.test(relative))
                this.validateContent(relative, buffer.toString('utf8'));
            await this.ensureSafeDirectory(path.dirname(file.absolute));
            if (overwrite) {
                const current = await this.checkedExistingPath(relative).catch((error) => { if (error.status === 404)
                    return null; throw error; });
                if (current && /\.(md|canvas|base)$/i.test(relative))
                    await this.snapshot(relative, await readFile(current.absolute, 'utf8'), 'before-import');
            }
            await atomicWrite(file.absolute, buffer, !overwrite);
            if (/\.(md|canvas|base)$/i.test(relative))
                await this.snapshot(relative, buffer.toString('utf8'), 'import');
            return { path: relative, size: buffer.length };
        });
    }
    trash(relative) {
        return this.mutate(async () => {
            const file = await this.checkedExistingPath(relative, true);
            const id = `${Date.now()}-${randomUUID()}`;
            const directory = await this.internalDirectory(`.trash/${id}`);
            await atomicWrite(path.join(directory, 'metadata.json'), JSON.stringify({ id, path: relative, trashedAt: Date.now(), kind: file.info.isDirectory() ? 'folder' : /\.canvas$/i.test(relative) ? 'canvas' : /\.md$/i.test(relative) ? 'markdown' : 'attachment', size: file.info.size }), true);
            await rename(file.absolute, path.join(directory, 'content'));
            return { path: relative, id, trashedAt: Date.now() };
        });
    }
    async trashList() {
        const root = await this.internalDirectory('.trash');
        const result = [];
        for (const entry of await readdir(root, { withFileTypes: true }))
            if (entry.isDirectory() && /^[\d]+-[a-f\d-]{36}$/.test(entry.name)) {
                try {
                    const metadata = JSON.parse(await readFile(path.join(root, entry.name, 'metadata.json'), 'utf8'));
                    await lstat(path.join(root, entry.name, 'content'));
                    result.push(metadata);
                }
                catch { /* Interrupted empty trash entry. */ }
            }
        return result.sort((a, b) => b.trashedAt - a.trashedAt);
    }
    restoreTrash(id, destination) {
        return this.mutate(async () => {
            if (!/^[\d]+-[a-f\d-]{36}$/.test(id))
                throw fail("Invalid trash entry.");
            const directory = path.join(this.root, '.trash', id);
            const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
            const target = this.normalizeRelative(destination || metadata.path, metadata.kind === 'folder');
            await this.ensureSafeDirectory(path.dirname(target.absolute));
            if (await lstat(target.absolute).then(() => true, (error) => { if (error.code === 'ENOENT')
                return false; throw error; }))
                throw fail("A file already exists at the target. Choose another path.", 409);
            await rename(path.join(directory, 'content'), target.absolute);
            await unlink(path.join(directory, 'metadata.json'));
            await rmdir(directory);
            return { path: target.relative, kind: metadata.kind };
        });
    }
    async attachment(relative) {
        const file = await this.checkedExistingPath(relative);
        if (file.info.size > maxFileBytes)
            throw fail("File larger than 50 MB.");
        return { absolute: file.absolute, type: mimeTypes[path.extname(relative).toLowerCase()] || 'application/octet-stream', size: file.info.size, name: path.basename(relative), preview: Boolean(mimeTypes[path.extname(relative).toLowerCase()]) };
    }
    async exportArchive() {
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
    }
    async settings(value) {
        const file = path.join(this.root, '.notesprig', 'settings.json');
        if (value === undefined)
            return readFile(file, 'utf8').then(JSON.parse, (error) => { if (error.code === 'ENOENT')
                return {}; throw error; });
        if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 128 * 1024)
            throw fail("Invalid configuration.");
        return this.mutate(async () => { await atomicWrite(file, JSON.stringify(value, null, 2), false); return value; });
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
            if (sourcePath === targetPath || !/\.md$/i.test(sourcePath) || !/\.md$/i.test(targetPath))
                throw fail("Choose two different Markdown notes.");
            const source = await this.read(sourcePath), target = await this.read(targetPath);
            if (source.hash !== sourceHash || target.hash !== targetHash)
                throw fail("One of the notes changed. Refresh the preview before merging.", 409);
            const all = (await this.listFiles()).filter((file) => file.kind !== 'folder');
            const mapping = new Map([[sourcePath, targetPath]]);
            const properties = { ...source.properties, ...target.properties };
            for (const key of ['tags', 'aliases']) {
                const values = [...new Set([...toStringList(source.properties[key]), ...toStringList(target.properties[key])])];
                if (values.length)
                    properties[key] = values;
            }
            const sourceBody = rewriteLinks(source.body, sourcePath, targetPath, all, mapping).trim();
            const bodies = prepend ? [sourceBody, target.body.trim()] : [target.body.trim(), sourceBody];
            const merged = `${Object.keys(properties).length ? `---\n${yamlStringify(properties)}---\n` : ''}${bodies.filter(Boolean).join('\n\n')}\n`;
            this.validateContent(targetPath, merged);
            const originals = new Map([[sourcePath, Buffer.from(source.content)], [targetPath, Buffer.from(target.content)]]);
            const writes = new Map();
            const updated = [];
            for (const file of all.filter((file) => (file.kind === 'markdown' || file.kind === 'canvas') && file.path !== sourcePath)) {
                const original = file.path === targetPath ? target.content : await readFile((await this.checkedExistingPath(file.path)).absolute, 'utf8');
                let next = file.path === targetPath ? merged : original;
                if (file.kind === 'canvas') {
                    const document = JSON.parse(next);
                    let changed = false;
                    for (const node of document.nodes || [])
                        if (node.file === sourcePath) {
                            node.file = targetPath;
                            changed = true;
                        }
                    if (changed)
                        next = JSON.stringify(document, null, '\t');
                }
                else
                    next = rewriteLinks(next, file.path, file.path, all, mapping);
                if (next !== original) {
                    originals.set(file.path, Buffer.from(original));
                    writes.set(file.path, Buffer.from(next));
                    updated.push(file.path);
                }
            }
            const journal = path.join(this.root, '.notesprig', 'transaction.json');
            await atomicWrite(journal, JSON.stringify({ originals: [...originals].map(([path, buffer]) => ({ path, base64: buffer.toString('base64') })), created: [] }), false);
            try {
                for (const [path, data] of originals)
                    await this.snapshot(path, data.toString('utf8'), 'before-merge');
                for (const [relative, data] of writes)
                    await atomicWrite(this.normalizeRelative(relative).absolute, data, false);
                const id = `${Date.now()}-${randomUUID()}`, trash = await this.internalDirectory(`.trash/${id}`);
                await atomicWrite(path.join(trash, 'metadata.json'), JSON.stringify({ id, path: sourcePath, trashedAt: Date.now(), kind: 'markdown', size: Buffer.byteLength(source.content) }), true);
                await rename(this.normalizeRelative(sourcePath).absolute, path.join(trash, 'content'));
                const result = await this.read(targetPath);
                await this.snapshot(targetPath, result.content, 'merge');
                await unlink(journal);
                return { note: result, updated };
            }
            catch (error) {
                await this.recoverTransaction();
                throw error;
            }
        });
    }
    rename(oldRelative, newRelative, updateLinks = true) {
        return this.mutate(async () => {
            const source = await this.checkedExistingPath(oldRelative, true);
            const target = this.normalizeRelative(newRelative, source.info.isDirectory());
            if (source.relative === target.relative)
                return { path: source.relative, updated: [] };
            if (target.relative.startsWith(`${source.relative}/`))
                throw fail("A folder cannot be moved inside itself.");
            if (source.info.isFile() && /\.(md|canvas|base)$/i.test(source.relative) && path.extname(source.relative).toLowerCase() !== path.extname(target.relative).toLowerCase())
                throw fail("Keep the document extension when renaming.");
            await this.ensureSafeDirectory(path.dirname(target.absolute));
            if (await lstat(target.absolute).then(() => true, (error) => { if (error.code === 'ENOENT')
                return false; throw error; }))
                throw fail("A file or folder already exists at the target.", 409);
            const all = await this.listFiles();
            const moves = all.filter((file) => file.kind !== 'folder' && (file.path === source.relative || file.path.startsWith(`${source.relative}/`)));
            const mapping = new Map(moves.map((file) => [file.path, target.relative + file.path.slice(source.relative.length)]));
            const originalData = new Map();
            const writes = new Map();
            const updated = [];
            for (const file of moves) {
                const destination = this.normalizeRelative(mapping.get(file.path));
                if (!source.info.isDirectory())
                    await this.ensureSafeDirectory(path.dirname(destination.absolute));
                if (await lstat(destination.absolute).then(() => true, (error) => { if (error.code === 'ENOENT')
                    return false; throw error; }))
                    throw fail("A file already exists at the target.", 409);
                const data = await readFile((await this.checkedExistingPath(file.path)).absolute);
                originalData.set(file.path, data);
                writes.set(destination.relative, data);
            }
            if (updateLinks)
                for (const file of all.filter((file) => file.kind === 'markdown' || file.kind === 'canvas')) {
                    const data = originalData.get(file.path) || await readFile((await this.checkedExistingPath(file.path)).absolute);
                    const content = data.toString('utf8');
                    const nextPath = mapping.get(file.path) || file.path;
                    let next = content;
                    if (file.kind === 'canvas') {
                        const document = JSON.parse(content);
                        let changed = false;
                        for (const node of document.nodes || [])
                            for (const key of ['file', 'background'])
                                if (mapping.has(node[key])) {
                                    node[key] = mapping.get(node[key]);
                                    changed = true;
                                }
                        if (changed)
                            next = JSON.stringify(document, null, '\t');
                    }
                    else
                        next = rewriteLinks(content, file.path, nextPath, all.filter((entry) => entry.kind !== 'folder'), mapping);
                    if (next !== content) {
                        originalData.set(file.path, data);
                        writes.set(nextPath, Buffer.from(next));
                        updated.push(nextPath);
                    }
                }
            const journal = path.join(this.root, '.notesprig', 'transaction.json');
            await atomicWrite(journal, JSON.stringify({ originals: [...originalData].map(([relative, data]) => ({ path: relative, base64: data.toString('base64') })), created: [...mapping.values()], ...(source.info.isDirectory() ? { directoryMove: { from: source.relative, to: target.relative } } : {}) }), false);
            try {
                for (const [relative, data] of originalData)
                    if (/\.(md|canvas|base)$/i.test(relative))
                        await this.snapshot(relative, data.toString('utf8'), 'before-rename');
                if (source.info.isDirectory())
                    await rename(source.absolute, target.absolute);
                const destinations = new Set(mapping.values());
                for (const [relative, data] of writes) {
                    const file = this.normalizeRelative(relative);
                    await this.ensureSafeDirectory(path.dirname(file.absolute));
                    await atomicWrite(file.absolute, data, !originalData.has(relative) && !(source.info.isDirectory() && destinations.has(relative)));
                }
                if (!source.info.isDirectory())
                    for (const relative of mapping.keys())
                        await unlink(this.normalizeRelative(relative).absolute);
                for (const [from, to] of mapping)
                    if (/\.(md|canvas|base)$/i.test(from)) {
                        const directory = await this.internalDirectory(`.notesprig/history/${hash(to)}`);
                        for (const version of await this.versions(from)) {
                            const original = await this.version(from, version.id);
                            await atomicWrite(path.join(directory, `${version.id}.json`), JSON.stringify({ ...original, path: to }), false);
                        }
                    }
                await unlink(journal);
                return { path: target.relative, updated, moved: Object.fromEntries(mapping) };
            }
            catch (error) {
                await this.recoverTransaction();
                throw error;
            }
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
