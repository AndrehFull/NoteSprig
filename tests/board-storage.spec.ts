import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, link, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// @ts-ignore Native server modules are exercised directly without a browser.
import { BoardTransactions, boardContentHash } from '../server/board-transactions.mjs';
// @ts-ignore Native server modules are exercised directly without a browser.
import { BoardReferenceState, BOARD_REFERENCE_STATE_PATH, prepareBoardReferenceTransition, validateBoardReferenceState } from '../server/board-reference-state.mjs';

const journal = '.notesprig/board-transactions';
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-board-storage-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const contents = (root: string, name: string) => readFile(path.join(root, name), 'utf8');
const injected = () => Object.assign(new Error('Injected I/O failure'), { code: 'ENOSPC' });

test('board transactions commit exact bytes, hashes, deletion and empty directory moves', async () => fixture(async (root) => {
  await mkdir(path.join(root, 'Old', 'Empty'), { recursive: true }); await writeFile(path.join(root, 'Old', 'A.md'), '# old');
  const tx = await new BoardTransactions(root).initialize();
  const result = await tx.run({ writes: [{ path: 'New/A.md', content: '# new', expectedHash: null }], deletes: [{ path: 'Old/A.md', expectedHash: boardContentHash('# old') }], directories: [{ path: 'New', op: 'create' }, { path: 'New/Empty', op: 'create' }, { path: 'Old/Empty', op: 'remove' }, { path: 'Old', op: 'remove' }], result: { saved: true } });
  expect(await contents(root, 'New/A.md')).toBe('# new'); expect(await readdir(path.join(root, 'New/Empty'))).toEqual([]);
  await expect(contents(root, 'Old/A.md')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(result.hashes['New/A.md']).toBe(boardContentHash('# new')); expect(result.result).toEqual({ saved: true }); expect(await readdir(path.join(root, journal))).toEqual([]);
}));

test('pre-COMMIT failures leave prior documents intact and permit deterministic restart', async () => {
  for (const point of ['after-preflight', 'after-stage-file', 'after-manifest', 'before-commit']) await fixture(async (root) => {
    await writeFile(path.join(root, 'A.md'), 'before');
    const tx = await new BoardTransactions(root, { fault: async (event: string) => { if (event === point) throw injected(); } }).initialize();
    await expect(tx.run({ writes: [{ path: 'A.md', content: 'after' }, { path: 'B.md', content: 'created' }] })).rejects.toThrow('Injected I/O failure');
    expect(await contents(root, 'A.md')).toBe('before'); await expect(contents(root, 'B.md')).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = await new BoardTransactions(root).initialize(); expect(await restarted.read(() => contents(root, 'A.md'))).toBe('before'); expect(await readdir(path.join(root, journal))).toEqual([]);
  });
});

test('every post-COMMIT fault closes reads and writes until committed state rolls forward', async () => {
  for (const point of ['after-commit', 'before-apply', 'after-apply', 'after-apply-all', 'before-cleanup', 'after-cleanup', 'before-ack']) await fixture(async (root) => {
    await writeFile(path.join(root, 'A.md'), 'old A'); await writeFile(path.join(root, 'B.md'), 'old B');
    const tx = await new BoardTransactions(root, { fault: async (event: string) => { if (event === point) throw injected(); } }).initialize();
    await expect(tx.run({ writes: [{ path: 'A.md', content: 'new A' }, { path: 'C.md', content: 'new C' }], deletes: ['B.md'] })).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED', status: 503 });
    let called = false;
    await expect(tx.read(() => { called = true; })).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
    await expect(tx.run(() => { called = true; return {}; })).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' }); expect(called).toBe(false);
    await tx.recover(); expect(await tx.read(() => contents(root, 'A.md'))).toBe('new A'); expect(await contents(root, 'C.md')).toBe('new C'); await expect(contents(root, 'B.md')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(path.join(root, journal))).toEqual([]);
  });
});

test('committed directory operations recover after interrupted directory application', async () => fixture(async (root) => {
  await mkdir(path.join(root, 'Old')); await writeFile(path.join(root, 'Old/A.md'), 'old');
  const tx = await new BoardTransactions(root, { fault: async (event: string) => { if (event === 'after-apply-directory') throw injected(); } }).initialize();
  await expect(tx.run({ writes: [{ path: 'New/A.md', content: 'new' }], deletes: ['Old/A.md'], directories: [{ path: 'New', op: 'create' }, { path: 'Old', op: 'remove' }] })).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
  await new BoardTransactions(root).initialize(); expect(await contents(root, 'New/A.md')).toBe('new'); await expect(readdir(path.join(root, 'Old'))).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('incomplete uncommitted intents and partial completed cleanup are discarded safely', async () => fixture(async (root) => {
  const tx = await new BoardTransactions(root).initialize();
  const abandoned = path.join(root, journal, '11111111-1111-4111-8111-111111111111'); await mkdir(abandoned); await writeFile(path.join(abandoned, '0.after'), 'uncommitted');
  await tx.recover(); expect(await readdir(path.join(root, journal))).toEqual([]);
  const failed = await new BoardTransactions(root, { fault: async (event: string) => { if (event === 'before-cleanup') throw injected(); } }).initialize();
  await expect(failed.run({ writes: [{ path: 'A.md', content: 'durable' }] })).rejects.toThrow();
  const [id] = await readdir(path.join(root, journal)); const completed = path.join(root, journal, `completed-${id}`);
  await rename(path.join(root, journal, id), completed); await rm(path.join(completed, '0.after'));
  await new BoardTransactions(root).initialize(); expect(await contents(root, 'A.md')).toBe('durable'); expect(await readdir(path.join(root, journal))).toEqual([]);
}));

test('corrupt staged bytes and unexpected destination writes preserve the journal and fail closed', async () => {
  for (const corruption of ['staged', 'destination']) await fixture(async (root) => {
    await writeFile(path.join(root, 'A.md'), 'original');
    const tx = await new BoardTransactions(root, { fault: async (event: string) => { if (event === 'after-commit') throw injected(); } }).initialize();
    await expect(tx.run({ writes: [{ path: 'A.md', content: 'committed' }] })).rejects.toThrow();
    const [id] = await readdir(path.join(root, journal));
    await writeFile(corruption === 'staged' ? path.join(root, journal, id, '0.after') : path.join(root, 'A.md'), 'outside alteration');
    const restarted = new BoardTransactions(root); await expect(restarted.initialize()).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
    await expect(restarted.read(() => true)).rejects.toMatchObject({ status: 503 }); expect(await readdir(path.join(root, journal))).toEqual([id]);
  });
});

test('preflight rejects stale hashes and all transaction budgets before modifying documents', async () => fixture(async (root) => {
  await writeFile(path.join(root, 'A.md'), '12345678');
  for (const limits of [{ documents: 0 }, { stagedBytes: 15 }, { manifestBytes: 2 }, { reserveBytes: Number.MAX_SAFE_INTEGER }]) {
    const tx = await new BoardTransactions(root, { limits }).initialize();
    await expect(tx.run({ writes: [{ path: 'A.md', content: '87654321' }] })).rejects.toMatchObject({ status: limits.reserveBytes ? 507 : 413 });
    expect(await contents(root, 'A.md')).toBe('12345678'); expect(await readdir(path.join(root, journal))).toEqual([]);
  }
  const tx = await new BoardTransactions(root).initialize();
  await expect(tx.run({ writes: [{ path: 'A.md', content: 'changed', expectedHash: boardContentHash('wrong') }] })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' });
  await expect(tx.run({ writes: [{ path: 'A.md', content: 'changed', createOnly: true }] })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' });
  await expect(tx.run({ writes: [{ path: 'B.md', content: '' }], deletes: ['B.md'] })).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
}));

test('transaction paths reject traversal, journal overwrite, symbolic links and hard links', async () => fixture(async (root) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'notesprig-board-outside-'));
  try {
    await symlink(outside, path.join(root, 'escape')); await writeFile(path.join(root, 'original.md'), 'original'); await link(path.join(root, 'original.md'), path.join(root, 'alias.md'));
    const tx = await new BoardTransactions(root).initialize();
    for (const name of ['../outside.md', '/outside.md', 'a/../outside.md', 'a\\outside.md', '.notesprig/board-transactions/intrusion', 'escape/outside.md', 'alias.md', '.trash']) await expect(tx.run({ writes: [{ path: name, content: 'bad' }] })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await readdir(outside)).toEqual([]); expect(await contents(root, 'original.md')).toBe('original');
    await mkdir(path.join(root, 'Nonempty')); await writeFile(path.join(root, 'Nonempty', 'untracked.bin'), 'x');
    await expect(tx.run({ directories: [{ path: 'Nonempty', op: 'remove' }] })).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' }); expect(await readdir(path.join(root, journal))).toEqual([]);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('one coordinator serializes outside callers, permits nested guarded reads and rejects nested commits', async () => fixture(async (root) => {
  const tx = await new BoardTransactions(root).initialize(); let release!: () => void; let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }), entered = new Promise<void>((resolve) => { started = resolve; });
  const first = tx.read(async () => { started(); await gate; await tx.run({ writes: [{ path: 'A.md', content: 'one' }] }); return tx.read(() => contents(root, 'A.md')); });
  await entered; let secondEntered = false; const second = tx.read(() => { secondEntered = true; return contents(root, 'A.md'); });
  await Promise.resolve(); expect(secondEntered).toBe(false); release(); expect(await first).toBe('one'); expect(await second).toBe('one');
  await expect(tx.run(async () => { await tx.run({ writes: [{ path: 'B.md', content: 'two' }] }); return {}; })).rejects.toMatchObject({ code: 'NESTED_TRANSACTION' }); await expect(contents(root, 'B.md')).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('reference occupation tombstones rotate only identity-affecting contexts', async () => fixture(async (root) => {
  const tx = await new BoardTransactions(root).initialize(), refs = new BoardReferenceState(root, tx);
  const initial = await refs.initialize(['A.md']); const initialState = await refs.getState();
  const ordinary = prepareBoardReferenceTransition(initialState, {}); expect(ordinary).toEqual(initialState);
  await refs.runChange({ createPaths: ['Fresh.md'] }, () => ({ writes: [{ path: 'Fresh.md', content: '# fresh', expectedHash: null }] })); expect(await refs.getContext()).toEqual(initial);
  await refs.runChange({ deletePaths: ['Fresh.md'] }, () => ({ deletes: ['Fresh.md'] })); const deleted = await refs.getContext(); expect(deleted.epoch).not.toBe(initial.epoch); expect((await refs.getState()).occupiedPaths).toContain('Fresh.md');
  await refs.runChange({ createPaths: ['Fresh.md'] }, () => ({ writes: [{ path: 'Fresh.md', content: '# different note', expectedHash: null }] })); const reused = await refs.getContext(); expect(reused.epoch).not.toBe(deleted.epoch);
  expect(reused.vaultId).toBe(initial.vaultId); expect(reused.restoreGeneration).toBe(initial.restoreGeneration);
  await expect(refs.assertContext(initial)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' }); let invoked = false;
  await expect(refs.runGuarded(initial, () => { invoked = true; return {}; })).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' }); expect(invoked).toBe(false);
  await refs.runChange({ rotateRestoreGeneration: true }); const restored = await refs.getContext(); expect(restored.restoreGeneration).not.toBe(initial.restoreGeneration); expect(restored.epoch).not.toBe(reused.epoch);
  await expect(refs.assertContext(reused)).rejects.toMatchObject({ code: 'RESTORE_CONTEXT_MISMATCH' });
  const other = { ...restored, vaultId: '00000000-0000-0000-0000-000000000000' }; await expect(refs.assertContext(other)).rejects.toMatchObject({ code: 'VAULT_CONTEXT_MISMATCH' });
  expect(initialState.occupiedPaths).toEqual(['A.md']); expect(() => prepareBoardReferenceTransition(initialState, { createPaths: 'wrong' })).toThrow(); expect(() => validateBoardReferenceState({ ...initialState, epoch: '-'.repeat(36) })).toThrow();
}));

test('reference state and structural bytes share a recoverable COMMIT and reject stale editor writes', async () => fixture(async (root) => {
  let armed = false;
  const tx = await new BoardTransactions(root, { fault: async (event: string) => { if (armed && event === 'after-apply') throw injected(); } }).initialize(); const refs = new BoardReferenceState(root, tx); const old = await refs.initialize(['A.md']);
  await tx.run({ writes: [{ path: 'A.md', content: '# old' }] }); armed = true;
  await expect(refs.runChange({ renamePaths: [{ from: 'A.md', to: 'B.md' }] }, () => ({ writes: [{ path: 'B.md', content: '# old' }], deletes: ['A.md'] }))).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
  await expect(refs.getContext()).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
  const restartedTx = await new BoardTransactions(root).initialize(), restarted = new BoardReferenceState(root, restartedTx); const current = await restarted.initialize(['B.md']);
  expect(current.epoch).not.toBe(old.epoch); expect(await contents(root, 'B.md')).toBe('# old'); expect((await restarted.getState()).occupiedPaths).toEqual(['A.md', 'B.md']);
  await expect(restarted.runGuarded(old, () => ({ writes: [{ path: 'B.md', content: '# stale' }] }))).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' }); expect(await contents(root, 'B.md')).toBe('# old');
  expect(JSON.parse(await contents(root, BOARD_REFERENCE_STATE_PATH)).epoch).toBe(current.epoch);
}));
