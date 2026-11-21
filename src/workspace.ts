import { boardScope, validContext, type ReferenceContext } from '../shared/board-schema.mjs';
import { getLocal, localBatch, localEntries, setLocal } from './storage';
import { LEGACY_MEDIA } from './legacy';
let context: ReferenceContext | undefined;
export const currentContext = () => { if (!context) throw new Error('Workspace identity has not been verified.'); return { ...context }; };
export const scopedKey = (key: string) => `workspace:${boardScope(currentContext())}:${key}`;
export async function bootstrapWorkspace(load: () => Promise<ReferenceContext>) {
  const previous=await getLocal<ReferenceContext>('workspace:last-context');
  let next: ReferenceContext;
  try { next = await load(); }
  catch (error) {
    if ((error as { status?: number }).status || sessionStorage.getItem('notesprig.unlocked') !== 'true') throw error;
    if (!validContext(previous)) throw error;
    next = previous;
  }
  if (!validContext(next)) throw new Error('Invalid workspace identity.');
  // Unscoped drafts have no verifiable workspace. Preserve them for explicit recovery.
  const old = await localEntries('doc:');
  await localBatch(Object.fromEntries(old.filter(([, value]) => !value||typeof value!=='object'||!('dirty'in value)||(value as {dirty?:boolean;pending?:boolean}).dirty||(value as {pending?:boolean}).pending).map(([key, value]) => [`quarantine:${key}`, value])), old.map(([key]) => key));
  if(validContext(previous)&&boardScope(previous)!==boardScope(next)&&'caches'in window)await Promise.all([caches.delete('notesprig-media-v1'),caches.delete(LEGACY_MEDIA)]);
  await setLocal('workspace:last-context', next);
  context = next;
  return { ...next };
}
export function forgetWorkspace() { context = undefined; }
export async function refreshWorkspaceContext(load: () => Promise<ReferenceContext>) {
  const next = await load();
  if (!validContext(next)) throw new Error('Invalid workspace identity.');
  const previous = currentContext();
  if (boardScope(previous) !== boardScope(next)) throw new Error('The workspace changed. Preserve drafts before reopening it.');
  context = next; await setLocal('workspace:last-context', next); return { ...next };
}
