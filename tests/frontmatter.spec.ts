import { test, expect } from '@playwright/test';
// The parser is shared by listing, reading, importing and saving notes.
// @ts-ignore The server runs native ESM; it has no separate declaration file.
import { parseFrontmatter } from '../server/frontmatter.mjs';

test('invalid YAML preserves text and keeps the vault index available', async ({ request }) => {
  await request.post('/api/login', { data: { password: 'test-session-only' } });
  const source = '---\ntags: [incompleto\n---\n# Texto preservado\n';
  const parsed = parseFrontmatter(source);
  expect(parsed.content).toBe(source); expect(parsed.error).toBeTruthy();
  const created = await request.post('/api/note', { data: { path: 'YAML inválido.md', content: source } });
  expect(created.status()).toBe(201);
  const listed = await request.get('/api/notes');
  expect(listed.status()).toBe(200);
  const read = await request.get('/api/note?path=' + encodeURIComponent('YAML inválido.md'));
  expect((await read.json()).content).toBe(source);
  await request.delete('/api/note?path=' + encodeURIComponent('YAML inválido.md'), { headers: { 'Content-Type': 'application/json' } });
});

test('language suffix cannot select an executable parser', () => {
  const source = '---javascript\n(() => { throw new Error("Não executar conteúdo da nota"); })()\n---\n# Nota\n';
  const parsed = parseFrontmatter(source);
  expect(parsed.data).toEqual({}); expect(parsed.content).toBe(source);
});

test('YAML preserves lists, values, and dates as metadata', () => {
  const parsed = parseFrontmatter('---\naliases: [Astro]\ntags: [projetos]\nfeito: true\ndata: 2026-11-01\n---\n# Atlas\n');
  expect(parsed.data).toEqual({ aliases: ['Astro'], tags: ['projetos'], feito: true, data: '2026-11-01' });
  expect(parsed.content).toBe('# Atlas\n');
  expect(parseFrontmatter('---\n---\n# Sem propriedades\n').content).toBe('# Sem propriedades\n');
});

test('cyclic aliases produce a property error', () => {
  const source = '---\nciclo: &ciclo\n  valor: *ciclo\n---\n# Nota\n';
  const parsed = parseFrontmatter(source);
  expect(parsed.error).toBeTruthy(); expect(parsed.content).toBe(source);
});
