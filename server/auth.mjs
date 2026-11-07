import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const sessionSeconds = 60 * 60 * 24 * 14;
export function createAuth({ passwordHash, sessionSecret, devPassword, production }) {
    if (production && !/^scrypt\$[a-f\d]{32}\$[a-f\d]{128}$/i.test(passwordHash || ''))
        throw new Error("Generate NOTESPRIG_PASSWORD_HASH with npm run set-password before starting production.");
    if (production && (!sessionSecret || sessionSecret.length < 32 || /^(?:troque-|replace-)/i.test(sessionSecret))) {
        throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
    }
    const secret = sessionSecret || randomBytes(32).toString('hex');
    const expected = passwordHash || createPasswordHashSync(devPassword || 'dev-only-change-me');
    return {
        async verifyPassword(password) {
            return verifyPassword(password, expected);
        },
        createCookie() {
            const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + sessionSeconds })).toString('base64url');
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
                const expiration = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp;
                return typeof expiration === 'number' && Number.isFinite(expiration) && expiration > Date.now() / 1000;
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
export async function verifyPassword(password, encoded) {
    if (typeof password !== 'string' || typeof encoded !== 'string')
        return false;
    if (!/^scrypt\$[a-f\d]{32}\$[a-f\d]{128}$/i.test(encoded))
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
