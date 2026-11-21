import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Vault } from './vault.mjs';
import { Boards } from './boards.mjs';

/** Display metadata lives inside each vault so a backup or moved folder keeps its name. */
const METADATA = '.notesprig/vault.json';
const NAME_LIMIT = 60;
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export function validVaultName(value) {
  if (typeof value !== 'string') throw fail('Enter a vault name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)) throw fail('Use a vault name with 1 to 60 characters.');
  return name;
}
/** Folder names are derived, never taken from input verbatim, so they cannot escape the vaults directory. */
export function vaultFolder(name, taken) {
  const base = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\d]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vault';
  let folder = base;
  for (let index = 2; taken.has(folder); index++) folder = `${base}-${index}`;
  return folder;
}

/**
 * Obsidian-style vaults: the configured vault is the default; additional vaults are sibling folders
 * under the vaults directory. Each vault keeps its own files, history, trash, and reference identity.
 */
export class VaultRegistry {
  constructor(defaultDir, vaultsDir) { this.defaultDir = path.resolve(defaultDir); this.vaultsDir = path.resolve(vaultsDir); this.entries = new Map(); this.queue = Promise.resolve(); }
  async initialize() {
    await this.open(this.defaultDir, null, 'My vault');
    const folders = await readdir(this.vaultsDir, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of folders.filter((item) => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) await this.open(path.join(this.vaultsDir, entry.name), entry.name, entry.name);
    return this;
  }
  async open(directory, folder, fallbackName) {
    const vault = new Vault(directory);
    await vault.initialize();
    const boards = new Boards(vault);
    const { vaultId: id } = await boards.context();
    if (this.entries.has(id)) throw new Error(`Two vault folders share the identity ${id}. Restore one of them as a new vault before starting.`);
    const metadata = JSON.parse(await readFile(path.join(vault.root, METADATA), 'utf8').catch(() => '{}'));
    let name = fallbackName;
    try { name = validVaultName(metadata.name); } catch { /* Missing or invalid metadata keeps the folder name. */ }
    const entry = { id, name, folder, isDefault: folder === null, vault, boards };
    this.entries.set(id, entry);
    return entry;
  }
  get default() { return [...this.entries.values()].find((entry) => entry.isDefault); }
  list() { return [...this.entries.values()].map(({ id, name, isDefault }) => ({ id, name, default: isDefault })).sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name)); }
  get(id) {
    if (id === undefined || id === null || id === '') return this.default;
    const entry = this.entries.get(id);
    if (!entry) throw fail('This vault is no longer available. Choose another vault.', 404, 'VAULT_NOT_FOUND');
    return entry;
  }
  /** Serialized so concurrent requests cannot pick the same folder. */
  exclusive(task) { const run = this.queue.then(task, task); this.queue = run.catch(() => {}); return run; }
  create(value) {
    const name = validVaultName(value);
    return this.exclusive(async () => {
      if ([...this.entries.values()].some((entry) => entry.name.toLowerCase() === name.toLowerCase())) throw fail('A vault with this name already exists.', 409);
      await mkdir(this.vaultsDir, { recursive: true, mode: 0o700 });
      const taken = new Set((await readdir(this.vaultsDir)).map((item) => item.toLowerCase()));
      const folder = vaultFolder(name, taken);
      const entry = await this.open(path.join(this.vaultsDir, folder), folder, name);
      await this.writeName(entry, name);
      return { id: entry.id, name: entry.name, default: false };
    });
  }
  rename(id, value) {
    const name = validVaultName(value);
    return this.exclusive(async () => {
      const entry = this.get(id);
      if ([...this.entries.values()].some((other) => other !== entry && other.name.toLowerCase() === name.toLowerCase())) throw fail('A vault with this name already exists.', 409);
      await this.writeName(entry, name);
      return { id: entry.id, name: entry.name, default: entry.isDefault };
    });
  }
  async writeName(entry, name) {
    const target = path.join(entry.vault.root, METADATA), temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, name }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, target);
    entry.name = name;
  }
}
