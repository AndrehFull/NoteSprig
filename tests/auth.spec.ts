import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore Native server module.
import { createAuth, createPasswordHashSync, verifyPassword } from '../server/auth.mjs';

test('production treats example values as unset, never as credentials, and rejects invalid explicit values', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-auth-'));
  try {
    const store = path.join(root, 'auth.json'), logs: string[] = [];
    // Example and legacy placeholders start first-run setup with a generated secret instead of being used.
    const auth = await createAuth({ production: true, passwordHash: 'configure-with-npm-run-set-password', sessionSecret: 'replace-with-a-random-secret-of-at-least-32-characters', storePath: store, log: (line: string) => logs.push(line) });
    expect(auth.setupRequired).toBe(true);
    expect(logs.join(' ')).toMatch(/setup code [A-Z\d]{4}-[A-Z\d]{4}-[A-Z\d]{4}/);
    expect(await auth.verifyPassword('configure-with-npm-run-set-password')).toBe(false);
    const forged = await createAuth({ production: false, devPassword: 'x', sessionSecret: 'replace-with-a-random-secret-of-at-least-32-characters' });
    expect(auth.verifyCookie(forged.createCookie())).toBe(false);
    const legacy = await createAuth({ production: true, passwordHash: createPasswordHashSync('senha-ficticia-valida-de-teste'), sessionSecret: 'troque-por-um-valor-aleatorio-com-32-caracteres-ou-mais', storePath: store, log: () => {} }); // gitleaks:allow -- public legacy placeholder; must never be used.
    expect(legacy.setupRequired).toBe(false);
    await expect(createAuth({ production: true, passwordHash: 'scrypt$not-a-hash', storePath: store })).rejects.toThrow();
    await expect(createAuth({ production: true, sessionSecret: 'too-short', storePath: store })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('malformed hashes cannot authenticate and invalid cookies fail without throwing', async () => {
  expect(await verifyPassword('qualquer', 'scrypt$sal$zz')).toBe(false);
  const auth = await createAuth({ production: false, devPassword: 'senha-ficticia' });
  expect(auth.verifyCookie(`a.${'é'.repeat(43)}`)).toBe(false); expect(auth.verifyCookie('cookie-inválido')).toBe(false); expect(auth.verifyCookie(auth.createCookie())).toBe(true);
});
