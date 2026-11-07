import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
// @ts-ignore Native server module.
import { createAuth, createPasswordHashSync, verifyPassword } from '../server/auth.mjs';

test('production rejects example credentials and invalid hashes', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const exampleHash = example.match(/^NOTESPRIG_PASSWORD_HASH=(.+)$/m)![1];
  const exampleSecret = example.match(/^SESSION_SECRET=(.+)$/m)![1];
  expect(() => createAuth({ production: true, passwordHash: exampleHash, sessionSecret: exampleSecret })).toThrow();
  const hash = createPasswordHashSync('senha-ficticia-valida-de-teste');
  for (const sessionSecret of [exampleSecret, 'troque-por-um-valor-aleatorio-com-32-caracteres-ou-mais']) { // gitleaks:allow -- public legacy placeholder; production must reject it.
    expect(() => createAuth({ production: true, passwordHash: hash, sessionSecret })).toThrow();
  }
});
test('malformed hashes cannot authenticate and invalid cookies fail without throwing', async () => {
  expect(await verifyPassword('qualquer', 'scrypt$sal$zz')).toBe(false);
  const auth = createAuth({ production: false, devPassword: 'senha-ficticia' });
  expect(auth.verifyCookie(`a.${'é'.repeat(43)}`)).toBe(false); expect(auth.verifyCookie('cookie-inválido')).toBe(false); expect(auth.verifyCookie(auth.createCookie())).toBe(true);
});
