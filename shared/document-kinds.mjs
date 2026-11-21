export const documentKinds = Object.freeze({
  markdown: { suffix: '.md', maxBytes: 2 * 1024 ** 2, label: 'Note' },
  canvas: { suffix: '.canvas', maxBytes: 2 * 1024 ** 2, label: 'Canvas' },
  base: { suffix: '.base', maxBytes: 2 * 1024 ** 2, label: 'Base' },
  board: { suffix: '.board', maxBytes: 4 * 1024 ** 2, label: 'Board' },
});
export function kindForPath(path) { const value = String(path).toLowerCase(); return Object.entries(documentKinds).find(([, policy]) => value.endsWith(policy.suffix))?.[0] || 'attachment'; }
export function isDocumentPath(path) { return Object.hasOwn(documentKinds, kindForPath(path)); }
export function documentLimit(path) { return documentKinds[kindForPath(path)]?.maxBytes || 50 * 1024 ** 2; }
export function documentTitle(path) { const name = String(path).split('/').at(-1) || ''; const kind = kindForPath(path); return kind === 'attachment' ? name : name.slice(0, -documentKinds[kind].suffix.length); }
