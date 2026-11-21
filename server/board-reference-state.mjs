import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BoardTransactionError, normalizeBoardTransactionPath } from './board-transactions.mjs';

export const BOARD_REFERENCE_STATE_PATH = '.notesprig/board-reference-state.json';
const stateLimit = 16 * 1024 * 1024;
const token = (value) => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value);
const failure = (code, message, status = 409) => new BoardTransactionError(code, message, status);
const clone = (value) => JSON.parse(JSON.stringify(value));
const eligible = (value) => {
  const normalized = normalizeBoardTransactionPath(value);
  if (normalized.startsWith('.notesprig/') || !/\.md$/i.test(normalized)) throw failure('INVALID_REFERENCE_PATH', 'Reference occupation paths must be Markdown files.', 400);
  return normalized;
};

export function boardReferenceContext(state) { return { vaultId: state.vaultId, restoreGeneration: state.restoreGeneration, epoch: state.epoch }; }
export function validateBoardReferenceState(state) {
  if (!state || state.version !== 1 || !token(state.vaultId) || !token(state.restoreGeneration) || !token(state.epoch) || !Array.isArray(state.occupiedPaths)) throw failure('INVALID_REFERENCE_STATE', 'Invalid persisted board reference state.', 503);
  const seen = new Set();
  for (const value of state.occupiedPaths) { const normalized = eligible(value); if (seen.has(normalized)) throw failure('INVALID_REFERENCE_STATE', 'Duplicate reference occupation path.', 503); seen.add(normalized); }
  return state;
}
export function assertBoardReferenceContext(expected, state, { referenceEpoch = true } = {}) {
  if (!expected || !token(expected.vaultId) || !token(expected.restoreGeneration) || referenceEpoch && !token(expected.epoch)) throw failure('VAULT_CONTEXT_REQUIRED', 'A valid workspace context is required.', 400);
  if (expected.vaultId !== state.vaultId) throw failure('VAULT_CONTEXT_MISMATCH', 'The request belongs to a different vault.');
  if (expected.restoreGeneration !== state.restoreGeneration) throw failure('RESTORE_CONTEXT_MISMATCH', 'The vault was restored; retain drafts for explicit recovery.');
  if (referenceEpoch && expected.epoch !== state.epoch) throw failure('REFERENCE_REVIEW_REQUIRED', 'References changed; review bindings before continuing.');
  return boardReferenceContext(state);
}

/** Pure transition: occupied paths are tombstones, not a list of current files. */
export function prepareBoardReferenceTransition(state, change = {}) {
  validateBoardReferenceState(state);
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw failure('INVALID_REFERENCE_CHANGE', 'A reference change must be an object.', 400);
  for (const key of ['createPaths', 'deletePaths', 'replacePaths', 'renamePaths']) if (change[key] !== undefined && !Array.isArray(change[key])) throw failure('INVALID_REFERENCE_CHANGE', 'Reference path changes must be arrays.', 400);
  const next = clone(state), occupied = new Set(next.occupiedPaths);
  let rotate = Boolean(change.rotateEpoch || change.rotateRestoreGeneration);
  for (const value of change.createPaths || []) { const normalized = eligible(value); if (occupied.has(normalized)) rotate = true; occupied.add(normalized); }
  for (const value of change.deletePaths || []) { occupied.add(eligible(value)); rotate = true; }
  for (const value of change.replacePaths || []) { occupied.add(eligible(value)); rotate = true; }
  for (const move of change.renamePaths || []) {
    if (!move || typeof move !== 'object') throw failure('INVALID_REFERENCE_PATH', 'Invalid reference rename.', 400);
    occupied.add(eligible(move.from)); occupied.add(eligible(move.to)); rotate = true;
  }
  next.occupiedPaths = [...occupied].sort();
  if (change.rotateRestoreGeneration) next.restoreGeneration = randomUUID();
  if (rotate) next.epoch = randomUUID();
  if (Buffer.byteLength(JSON.stringify(next)) > stateLimit) throw failure('REFERENCE_STATE_BUDGET', 'Reference occupation state exceeds its supported size.', 413);
  return next;
}

/** Caller structural changes and reference metadata share one transaction decision. */
export class BoardReferenceState {
  constructor(root, transactions) {
    if (!transactions) throw failure('INVALID_REFERENCE_STATE', 'A shared transaction coordinator is required.', 500);
    this.root = path.resolve(root); this.transactions = transactions;
  }
  async loadUnlocked() {
    const file = path.join(this.transactions.root, BOARD_REFERENCE_STATE_PATH);
    // inspect verifies every existing ancestor before readFile follows a path.
    const inspected = await this.transactions.inspect(BOARD_REFERENCE_STATE_PATH);
    if (!inspected) return null;
    const info = await lstat(file);
    if (info.size > stateLimit) throw failure('REFERENCE_STATE_BUDGET', 'Reference state exceeds its supported size.', 503);
    return validateBoardReferenceState(JSON.parse(await readFile(file, 'utf8')));
  }
  async initialize(seedPaths = []) {
    if (!this.transactions.ready) await this.transactions.initialize();
    if (path.resolve(this.transactions.root) !== await import('node:fs/promises').then(({ realpath }) => realpath(this.root))) throw failure('INVALID_REFERENCE_STATE', 'Reference state and transaction roots differ.', 500);
    const initialized = await this.transactions.run(async () => {
      const current = await this.loadUnlocked();
      const seeds = [...new Set(seedPaths.map(eligible))].sort();
      let state = current || { version: 1, vaultId: randomUUID(), restoreGeneration: randomUUID(), epoch: randomUUID(), occupiedPaths: seeds };
      if (current && seeds.some((value) => !current.occupiedPaths.includes(value))) {
        state = prepareBoardReferenceTransition(current, { createPaths: seeds.filter((value) => !current.occupiedPaths.includes(value)), rotateEpoch: true });
      }
      return { writes: !current || JSON.stringify(current) !== JSON.stringify(state) ? [{ path: BOARD_REFERENCE_STATE_PATH, content: JSON.stringify(state), expectedHash: current ? (await this.transactions.inspect(BOARD_REFERENCE_STATE_PATH)).hash : null }] : [], result: boardReferenceContext(state) };
    });
    return initialized.result;
  }
  getState() { return this.transactions.read(() => this.loadUnlocked().then((state) => { if (!state) throw failure('INVALID_REFERENCE_STATE', 'Board reference state has not been initialized.', 503); return state; })); }
  async getContext() { return boardReferenceContext(await this.getState()); }
  assertContext(expected, options) { return this.readGuarded(expected, ({ context }) => context, options); }
  readGuarded(expected, action, options) {
    return this.transactions.read(async () => {
      const state = await this.loadUnlocked(); if (!state) throw failure('INVALID_REFERENCE_STATE', 'Missing reference state.', 503);
      const context = assertBoardReferenceContext(expected, state, options);
      return action({ context, state: clone(state) });
    });
  }
  runGuarded(expected, build, options) {
    return this.transactions.run(async () => {
      const state = await this.loadUnlocked(); if (!state) throw failure('INVALID_REFERENCE_STATE', 'Missing reference state.', 503);
      const context = assertBoardReferenceContext(expected, state, options);
      return build({ context, state: clone(state) });
    });
  }
  runChange(change, build = async () => ({}), { expectedContext } = {}) {
    return this.transactions.run(async () => {
      const state = await this.loadUnlocked(); if (!state) throw failure('INVALID_REFERENCE_STATE', 'Missing reference state.', 503);
      if (expectedContext) assertBoardReferenceContext(expectedContext, state);
      const next = prepareBoardReferenceTransition(state, change), context = boardReferenceContext(next);
      const prepared = await build({ state: clone(state), next: clone(next), context });
      if (!prepared || typeof prepared !== 'object') throw failure('INVALID_TRANSACTION', 'Structural change builder must return a transaction.', 400);
      const changed = JSON.stringify(state) !== JSON.stringify(next);
      return {
        writes: [...(prepared.writes || []), ...(changed ? [{ path: BOARD_REFERENCE_STATE_PATH, content: JSON.stringify(next), expectedHash: (await this.transactions.inspect(BOARD_REFERENCE_STATE_PATH)).hash }] : [])],
        deletes: prepared.deletes || [], directories: prepared.directories || [], result: { context, value: prepared.result },
      };
    });
  }
}
