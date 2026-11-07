import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createPasswordHashSync } from '../server/auth.mjs';
const exec = promisify(execFile);
const image = process.argv[2] || 'notesprig:test';
const name = `notesprig-check-${randomBytes(5).toString('hex')}`, volume = `${name}-data`;
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, NOTESPRIG_PASSWORD_HASH: createPasswordHashSync(password), SESSION_SECRET: randomBytes(32).toString('hex') };
const docker = (args, options = {}) => exec('docker', args, { env, maxBuffer: 1024 * 1024, ...options });
let base = '', cookie = '';
async function api(path, method = 'GET', data) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
}
async function ready() { for (let attempt = 0; attempt < 60; attempt++) { try { if ((await api('/api/session')).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error('The container did not start.'); }
try {
  await docker(['volume', 'create', volume]);
  await docker(['run', '-d', '--name', name, '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,size=32m,mode=1777', '-e', 'NOTESPRIG_PASSWORD_HASH', '-e', 'SESSION_SECRET', '-v', `${volume}:/data`, '-p', '127.0.0.1::4317', image]);
  const { stdout } = await docker(['inspect', name]); const info = JSON.parse(stdout)[0];
  assert.equal(info.Config.User, 'node'); assert.equal(info.HostConfig.ReadonlyRootfs, true);
  const binding = info.NetworkSettings.Ports['4317/tcp'][0]; assert.equal(binding.HostIp, '127.0.0.1'); base = `http://127.0.0.1:${binding.HostPort}`;
  await ready(); assert.equal((await api('/api/files')).status, 401);
  const login = await api('/api/login', 'POST', { password }); assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0]; assert.match(login.headers.get('set-cookie'), /Secure/);
  let result = await api('/api/note', 'POST', { path: 'Pasta/Nota.md', content: '# Persistência\n\n[[Outra]]\n' }); assert.equal(result.status, 201, await result.text());
  result = await api('/api/note', 'POST', { path: 'Mapa.canvas', content: JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Teste', x: 0, y: 0, width: 200, height: 100 }] }) }); assert.equal(result.status, 201, await result.text());
  result = await api('/api/upload', 'POST', { path: 'Anexo.txt', base64: Buffer.from('Anexo sintético').toString('base64') }); assert.equal(result.status, 201, await result.text());
  assert.equal((await api('/')).status, 200); assert.equal((await api('/sw.js')).status, 200);
  assert.equal((await api('/api/export')).status, 200);
  await docker(['restart', name]);
  const restarted = JSON.parse((await docker(['inspect', name])).stdout)[0];
  base = `http://127.0.0.1:${restarted.NetworkSettings.Ports['4317/tcp'][0].HostPort}`;
  await ready();
  result = await api('/api/note?path=Pasta%2FNota.md'); assert.equal(result.status, 200); assert.match((await result.json()).content, /Persistência/);
  assert.equal((await api('/api/attachment?path=Anexo.txt')).status, 200);
  await docker(['exec', '-e', 'NOTESPRIG_BACKUP_PASSWORD=synthetic-backup-test-password', name, 'node', 'scripts/backup.mjs', 'create', '--vault', '/data/vault', '--output', '/tmp/synthetic.obak']);
  await docker(['exec', '-e', 'NOTESPRIG_BACKUP_PASSWORD=synthetic-backup-test-password', name, 'node', 'scripts/backup.mjs', 'restore', '--input', '/tmp/synthetic.obak', '--vault', '/tmp/restored']);
  const restored = await docker(['exec', name, 'cat', '/tmp/restored/Pasta/Nota.md']); assert.match(restored.stdout, /Persistência/);
  console.log('Docker passed: node user, read-only root, loopback port, authentication, Markdown/Canvas/attachment, restart persistence, PWA, export, and encrypted backup/restoration.');
} catch (error) {
  const logs = await docker(['logs', '--tail=20', name]).catch(() => ({ stdout: '', stderr: '' }));
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  await docker(['rm', '-f', name]).catch(() => {});
  await docker(['volume', 'rm', volume]).catch(() => {});
}
