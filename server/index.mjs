import { createReadStream, readFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.mjs';
import { Vault } from './vault.mjs';
import { environment, legacy } from './legacy.mjs';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const branding = JSON.parse(readFileSync(path.join(projectRoot, 'branding.json'), 'utf8'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const production = process.env.NODE_ENV === 'production';
const trustProxy = process.env.TRUST_PROXY === '1';
const vaultDir = path.resolve(environment('VAULT') || path.join(projectRoot, 'data', 'vault'));
const distDir = path.join(projectRoot, 'dist');
const auth = createAuth({
    passwordHash: environment('PASSWORD_HASH'),
    sessionSecret: process.env.SESSION_SECRET,
    devPassword: environment('DEV_PASSWORD'),
    production,
});
const vault = new Vault(vaultDir);
const attempts = new Map();
if (production && !['127.0.0.1', '::1', 'localhost'].includes(host) && !trustProxy) {
    throw new Error("In production, set TRUST_PROXY=1 only behind a trusted proxy.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
await vault.initialize();
const mimeTypes = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};
function sessionCookie(req) {
    const raw = req.headers.cookie || '';
    const cookies = raw.split(';').map((part) => part.trim());
    for (const name of ['notesprig_session', legacy.sessionCookie]) {
        const value = cookies.find((part) => part.startsWith(`${name}=`));
        if (value) {
            try {
                return decodeURIComponent(value.slice(name.length + 1));
            }
            catch {
                return '';
            }
        }
    }
    return '';
}
function cookieOptions(req) {
    const secure = production || req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
    return `Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600${secure ? '; Secure' : ''}`;
}
function json(res, status, body, extraHeaders = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(data),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...securityHeaders(),
        ...extraHeaders,
    });
    res.end(data);
}
function securityHeaders() {
    return production ? {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self' https:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
    } : {};
}
async function readJson(req, maxBytes = 12 * 1024 * 1024) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
        length += chunk.length;
        if (length > maxBytes)
            throw Object.assign(new Error("The request exceeds the allowed limit."), { status: 413 });
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw Object.assign(new Error("Invalid JSON."), { status: 400 });
    }
}
function requestOrigin(req) {
    const forwardedHost = trustProxy && typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host'].split(',')[0].trim()
        : req.headers.host;
    const proto = trustProxy && typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : req.socket.encrypted ? 'https' : 'http';
    return `${proto}://${forwardedHost}`;
}
function checkOrigin(req, res) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    const expected = requestOrigin(req);
    const devAllowed = !production && new Set([
        'http://127.0.0.1:5173', 'http://localhost:5173', `http://${req.headers.host}`,
    ]).has(origin);
    if (origin === expected || devAllowed)
        return true;
    json(res, 403, { error: "Request origin is not allowed." });
    return false;
}
function authenticated(req) {
    return auth.verifyCookie(sessionCookie(req));
}
function checkRateLimit(req, res) {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry || now > entry.resetAt)
        entry = { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (entry.count >= 8) {
        attempts.set(key, entry);
        json(res, 429, { error: "Too many attempts. Wait a few minutes." }, { 'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)) });
        return false;
    }
    entry.count += 1;
    attempts.set(key, entry);
    return true;
}
function countHits(content, terms) {
    if (!terms.length)
        return { count: 1, snippets: [] };
    const lower = content.toLocaleLowerCase();
    if (!terms.every((term) => lower.includes(term.toLocaleLowerCase())))
        return { count: 0, snippets: [] };
    const lines = content.split(/\r?\n/);
    const matches = lines.map((line) => terms.map((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return (line.match(new RegExp(escaped, 'giu')) || []).length;
    }));
    const matchingLines = matches.map((counts) => counts.some((count) => count > 0));
    const count = matchingLines.reduce((sum, matched, index) => sum + (matched ? matches[index].reduce((a, b) => a + b, 0) : 0), 0);
    const snippets = lines.filter((_line, index) => matchingLines[index]).slice(0, 5).map((line) => line.slice(0, 240));
    return { count, snippets };
}
async function serveStatic(req, res, url) {
    let requested = decodeURIComponent(url.pathname);
    if (requested === '/')
        requested = '/index.html';
    let absolute = path.resolve(distDir, `.${requested}`);
    const distReal = await realpath(distDir).catch(() => null);
    if (!distReal)
        return json(res, 503, { error: "The app has not been built yet. Run npm run build." });
    if (!absolute.startsWith(`${distReal}${path.sep}`) && absolute !== distReal)
        return json(res, 404, { error: "File not found." });
    let info;
    try {
        info = await stat(absolute);
        if (!info.isFile())
            throw new Error('not-file');
    }
    catch {
        absolute = path.join(distReal, 'index.html');
        info = await stat(absolute);
    }
    const extension = path.extname(absolute).toLowerCase();
    res.writeHead(200, {
        'Cache-Control': extension === '.html' || requested === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Content-Length': info.size,
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        ...securityHeaders(),
    });
    createReadStream(absolute).pipe(res);
}
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', requestOrigin(req));
        if (url.pathname.startsWith('/api/')) {
            if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
                if (!checkOrigin(req, res))
                    return;
                if (!(req.headers['content-type'] || '').startsWith('application/json')) {
                    return json(res, 415, { error: "Use a JSON request." });
                }
            }
            if (req.method === 'GET' && url.pathname === '/api/session') {
                return json(res, 200, { authenticated: authenticated(req) });
            }
            if (req.method === 'POST' && url.pathname === '/api/login') {
                if (!checkRateLimit(req, res))
                    return;
                const body = await readJson(req, 16 * 1024);
                if (!(await auth.verifyPassword(body.password)))
                    return json(res, 401, { error: "Incorrect password." });
                attempts.delete(req.socket.remoteAddress || 'unknown');
                return json(res, 200, { authenticated: true }, { 'Set-Cookie': `notesprig_session=${encodeURIComponent(auth.createCookie())}; ${cookieOptions(req)}` });
            }
            if (req.method === 'POST' && url.pathname === '/api/logout') {
                return json(res, 200, { authenticated: false }, { 'Set-Cookie': ['notesprig_session', legacy.sessionCookie].map((name) => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`) });
            }
            if (!authenticated(req))
                return json(res, 401, { error: "Authentication required." });
            if (req.method === 'GET' && url.pathname === '/api/notes') {
                return json(res, 200, await vault.list());
            }
            if (req.method === 'GET' && url.pathname === '/api/files')
                return json(res, 200, await vault.listFiles());
            if (req.method === 'POST' && url.pathname === '/api/folder') {
                const body = await readJson(req);
                return json(res, 201, await vault.folder(body.path));
            }
            if (req.method === 'POST' && url.pathname === '/api/upload') {
                const body = await readJson(req, 72 * 1024 * 1024);
                return json(res, 201, await vault.upload(body.path, body.base64));
            }
            if (req.method === 'GET' && url.pathname === '/api/history')
                return json(res, 200, await vault.versions(url.searchParams.get('path') || ''));
            if (req.method === 'GET' && url.pathname === '/api/version')
                return json(res, 200, await vault.version(url.searchParams.get('path') || '', url.searchParams.get('id') || ''));
            if (req.method === 'POST' && url.pathname === '/api/history/restore') {
                const body = await readJson(req);
                const result = await vault.restoreVersion(body.path, body.id, body.baseHash);
                return json(res, result.conflict ? 409 : 200, result.conflict ? { error: "The document changed. Refresh before restoring.", current: result.current } : result.note);
            }
            if (req.method === 'GET' && url.pathname === '/api/trash')
                return json(res, 200, await vault.trashList());
            if (req.method === 'POST' && url.pathname === '/api/trash/restore') {
                const body = await readJson(req);
                return json(res, 200, await vault.restoreTrash(body.id, body.path));
            }
            if (req.method === 'GET' && url.pathname === '/api/settings')
                return json(res, 200, await vault.settings());
            if (req.method === 'PUT' && url.pathname === '/api/settings')
                return json(res, 200, await vault.settings(await readJson(req, 128 * 1024)));
            if (req.method === 'GET' && url.pathname === '/api/export') {
                const archive = await vault.exportArchive();
                res.writeHead(200, { ...securityHeaders(), 'Cache-Control': 'no-store', 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="notesprig-vault.zip"', 'Content-Length': archive.length });
                return res.end(archive);
            }
            if (req.method === 'POST' && url.pathname === '/api/import-zip') {
                const body = await readJson(req, 100 * 1024 * 1024);
                return json(res, 200, await vault.importArchive(body.base64, body.overwrite === true));
            }
            if (req.method === 'GET' && url.pathname === '/api/note') {
                const relative = url.searchParams.get('path') || '';
                return json(res, 200, await vault.read(relative));
            }
            if (req.method === 'POST' && url.pathname === '/api/note') {
                const body = await readJson(req);
                return json(res, 201, await vault.create(body.path, body.content));
            }
            if (req.method === 'PUT' && url.pathname === '/api/note') {
                const body = await readJson(req);
                const result = await vault.update(body.path, body.content, body.baseHash);
                if (result.conflict)
                    return json(res, 409, { error: "The note changed elsewhere.", current: result.current });
                return json(res, 200, result.note);
            }
            if (req.method === 'POST' && url.pathname === '/api/note/rename') {
                const body = await readJson(req, 32 * 1024);
                return json(res, 200, await vault.rename(body.oldPath, body.newPath, body.updateLinks !== false));
            }
            if (req.method === 'POST' && url.pathname === '/api/note/merge') {
                const body = await readJson(req);
                return json(res, 200, await vault.merge(body.source, body.target, body.sourceHash, body.targetHash, body.prepend === true));
            }
            if (req.method === 'DELETE' && url.pathname === '/api/note') {
                const relative = url.searchParams.get('path') || '';
                return json(res, 200, await vault.trash(relative));
            }
            if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/api/attachment' || url.pathname === '/api/download')) {
                const attachment = await vault.attachment(url.searchParams.get('path') || '');
                const attachmentHeaders = {
                    'Cache-Control': 'private, max-age=60',
                    'Content-Length': attachment.size,
                    'Content-Disposition': `${url.pathname === '/api/download' || !attachment.preview ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
                    'Content-Type': attachment.type,
                    'X-Content-Type-Options': 'nosniff',
                    ...securityHeaders(),
                };
                attachmentHeaders['Content-Security-Policy'] = `default-src 'none'; frame-ancestors 'self'${attachment.type === 'application/pdf' ? '' : '; sandbox'}`;
                attachmentHeaders['X-Frame-Options'] = 'SAMEORIGIN';
                attachmentHeaders['Accept-Ranges'] = 'bytes';
                const range = typeof req.headers.range === 'string' && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
                if (range) {
                    const start = range[1] ? Number(range[1]) : Math.max(0, attachment.size - Number(range[2]));
                    const end = range[1] && range[2] ? Math.min(attachment.size - 1, Number(range[2])) : attachment.size - 1;
                    if (start > end || start >= attachment.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
                        res.writeHead(416, { 'Content-Range': `bytes */${attachment.size}` });
                        return res.end();
                    }
                    res.writeHead(206, { ...attachmentHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${attachment.size}` });
                    if (req.method === 'HEAD')
                        return res.end();
                    return createReadStream(attachment.absolute, { start, end }).on('error', () => res.destroy()).pipe(res);
                }
                res.writeHead(200, attachmentHeaders);
                if (req.method === 'HEAD')
                    return res.end();
                return createReadStream(attachment.absolute).on('error', () => res.destroy()).pipe(res);
            }
            if (req.method === 'GET' && url.pathname === '/api/search') {
                const query = (url.searchParams.get('q') || '').trim().slice(0, 120);
                if (!query)
                    return json(res, 200, { total: 0, items: [] });
                const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
                const tags = tokens.filter((token) => token.startsWith('#') || token.startsWith('tag:')).map((token) => token.replace(/^(tag:)?#?/, '').toLocaleLowerCase());
                const paths = tokens.filter((token) => token.startsWith('path:')).map((token) => token.slice(5).replaceAll('"', '').toLocaleLowerCase());
                const terms = tokens.filter((token) => !token.startsWith('#') && !token.startsWith('tag:') && !token.startsWith('path:')).map((token) => token.replaceAll('"', ''));
                const notes = await vault.list();
                const items = [];
                for (const note of notes) {
                    if (!tags.every((tag) => note.tags.some((value) => value.toLocaleLowerCase() === tag || value.toLocaleLowerCase().startsWith(`${tag}/`))))
                        continue;
                    if (!paths.every((filter) => note.path.toLocaleLowerCase().includes(filter)))
                        continue;
                    const { content } = await vault.read(note.path);
                    const matches = countHits(content, terms);
                    if (matches.count)
                        items.push({ path: note.path, title: note.title, count: matches.count, snippets: matches.snippets });
                }
                return json(res, 200, { total: items.reduce((sum, item) => sum + item.count, 0), items });
            }
            return json(res, 404, { error: "Endpoint not found." });
        }
        if (req.method !== 'GET' && req.method !== 'HEAD')
            return json(res, 405, { error: "Method not allowed." });
        return await serveStatic(req, res, url);
    }
    catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 400;
        return json(res, status, { error: error.message || "Could not process the request." });
    }
});
server.listen(port, host, () => {
    console.log(`${branding.name} available at http://${host}:${port}`);
    console.log(`Vault: ${vaultDir}`);
    if (!production)
        console.log("Local development: password from NOTESPRIG_DEV_PASSWORD (default dev-only-change-me).");
});
function stop() {
    server.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
