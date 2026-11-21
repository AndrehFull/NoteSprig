import { createHmac, randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const sessionSeconds = 60 * 60 * 24 * 14;
const HASH = /^scrypt\$[a-f\d]{32}\$[a-f\d]{128}$/i;
export const MIN_PASSWORD_LENGTH = 12;
/** Values shipped in .env.example mean "not configured"; they are never used as credentials. */
const placeholder = (value) => !value || /^(?:configure-|replace-|troque-)/i.test(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
// Unambiguous characters: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizeCode = (value) => typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z\d]/g, '') : '';

/**
 * Credentials come from, in order: NOTESPRIG_PASSWORD_HASH / SESSION_SECRET (optional, for managed deployments),
 * then a 0600 credential file in the data volume. Without a password, production starts in first-run setup:
 * the browser asks for a one-time code printed only in the server log, so a stranger reaching the public URL
 * first cannot claim the instance.
 */
export async function createAuth({ passwordHash, sessionSecret, devPassword, production, storePath, log = console.log }) {
    if (!placeholder(passwordHash) && !HASH.test(passwordHash))
        throw new Error("NOTESPRIG_PASSWORD_HASH is invalid. Remove it to set the password in the browser, or generate it with npm run set-password.");
    if (!placeholder(sessionSecret) && sessionSecret.length < 32)
        throw new Error("SESSION_SECRET must contain at least 32 characters. Remove it to let NoteSprig generate one.");
    const environmentHash = placeholder(passwordHash) ? null : passwordHash;
    const environmentSecret = placeholder(sessionSecret) ? null : sessionSecret;
    let stored = { version: 1, credentialVersion: 0 };
    if (production) {
        if (!storePath) throw new Error('A credential store path is required in production.');
        try { stored = { ...stored, ...JSON.parse(await readFile(storePath, 'utf8')) }; }
        catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read the credential file ${storePath}: ${error.message}`); }
        if (stored.passwordHash !== undefined && !HASH.test(stored.passwordHash)) throw new Error(`The credential file ${storePath} is damaged. Remove it to run first-time setup again.`);
        if (!environmentSecret && !(typeof stored.sessionSecret === 'string' && stored.sessionSecret.length >= 64)) { stored.sessionSecret = randomBytes(32).toString('hex'); await persist(); }
    }
    const secret = environmentSecret || (production ? stored.sessionSecret : randomBytes(32).toString('hex'));
    let expected = environmentHash || (production ? stored.passwordHash : createPasswordHashSync(devPassword || 'dev-only-change-me'));
    let setupCode = production && !expected ? Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('') : null;
    if (setupCode) log(`First-time setup: open NoteSprig in your browser and enter the setup code ${setupCode.match(/.{4}/g).join('-')} to create the password.`);

    async function persist() {
        await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
        const temporary = `${storePath}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, storePath);
    }
    async function storePassword(password) {
        if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw fail(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
        const hash = await createPasswordHash(password);
        // A new credential version signs out every existing session.
        stored = { ...stored, passwordHash: hash, credentialVersion: (stored.credentialVersion || 0) + 1 };
        await persist();
        expected = hash;
    }
    return {
        get setupRequired() { return Boolean(setupCode); },
        get managedByEnvironment() { return Boolean(environmentHash) || !production; },
        async verifyPassword(password) {
            return Boolean(expected) && verifyPassword(password, expected);
        },
        async setup(code, password) {
            if (!setupCode) throw fail('A password is already configured.', 409);
            const given = Buffer.from(normalizeCode(code)), wanted = Buffer.from(setupCode);
            if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw fail('The setup code is incorrect. Find it in the server log.', 401);
            await storePassword(password);
            setupCode = null;
            log('First-time setup completed. The setup code is no longer valid.');
        },
        async changePassword(current, next) {
            if (environmentHash) throw fail('The password is set by NOTESPRIG_PASSWORD_HASH on the server. Change it there.', 409);
            if (!production) throw fail('The development password is set by NOTESPRIG_DEV_PASSWORD.', 409);
            if (!(await verifyPassword(current, expected))) throw fail('The current password is incorrect.', 401);
            await storePassword(next);
        },
        createCookie() {
            const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + sessionSeconds, v: stored.credentialVersion || 0 })).toString('base64url');
            return `${payload}.${sign(payload, secret)}`;
        },
        verifyCookie(cookie) {
            if (!cookie)
                return false;
            const [payload, signature, extra] = cookie.split('.');
            if (!payload || !signature || extra)
                return false;
            const correct = sign(payload, secret);
            const actualBytes = Buffer.from(signature), correctBytes = Buffer.from(correct);
            if (actualBytes.length !== correctBytes.length || !timingSafeEqual(actualBytes, correctBytes))
                return false;
            try {
                const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
                return typeof data.exp === 'number' && Number.isFinite(data.exp) && data.exp > Date.now() / 1000 && (data.v ?? 0) === (stored.credentialVersion || 0);
            }
            catch {
                return false;
            }
        },
    };
}
export function createPasswordHashSync(password) {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
}
export async function createPasswordHash(password) {
    const salt = randomBytes(16).toString('hex');
    const derived = await scryptAsync(password, salt, 64);
    return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
    if (typeof password !== 'string' || typeof encoded !== 'string')
        return false;
    if (!HASH.test(encoded))
        return false;
    const [algorithm, salt, storedHex, extra] = encoded.split('$');
    if (algorithm !== 'scrypt' || !salt || !storedHex || extra)
        return false;
    try {
        const stored = Buffer.from(storedHex, 'hex');
        const derived = await scryptAsync(password, salt, stored.length);
        return stored.length === derived.length && timingSafeEqual(stored, derived);
    }
    catch {
        return false;
    }
}
function sign(payload, secret) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}
