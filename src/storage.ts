import { clearLegacyPrivateCache, migrateLegacyPrivateCache, PRIVATE_MIGRATION } from './legacy';
let opening: Promise<IDBDatabase> | undefined;
function writable(database:IDBDatabase) {
  try { return database.transaction('state','readwrite',{durability:'strict'}); }
  catch(error) { if(error instanceof TypeError||error instanceof DOMException&&error.name==='NotSupportedError')return database.transaction('state','readwrite');throw error; }
}
function database() {
  opening ||= new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('notesprig-private', 1); request.onupgradeneeded = () => request.result.createObjectStore('state'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }).then(async (db) => { try { await migrateLegacyPrivateCache(db); return db; } catch (error) { db.close(); throw error; } }).catch((error) => { opening = undefined; throw error; });
  return opening;
}
export async function getLocal<T>(key: string): Promise<T | undefined> { const db = await database(); return new Promise((resolve, reject) => { const request = db.transaction('state').objectStore('state').get(key); request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error); }); }
export async function setLocal(key: string, value: unknown) { return localBatch({[key]:value}); }
export async function removeLocal(key: string) { const db = await database(); return new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
export async function listLocal<T>(prefix: string): Promise<T[]> { const db = await database(); return new Promise((resolve, reject) => { const request = db.transaction('state').objectStore('state').getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error); }); }
export async function cacheRemoteDocument<T extends { path: string }>(value: T, key = `doc:${value.path}`) { const db = await database(); return new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); const request = store.get(key); request.onsuccess = () => { if (!request.result?.dirty) store.put(value, key); }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
export async function clearPrivateCache() { const db = await database(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state'); store.clear(); store.put(true, PRIVATE_MIGRATION); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); await clearLegacyPrivateCache(); if ('caches' in window) await caches.delete('notesprig-media-v1'); navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE' }); sessionStorage.removeItem('notesprig.unlocked'); }

/** Atomic state/blob/outbox checkpoint. Success is the only device-saved acknowledgement. */
export async function localBatch(puts: Record<string, unknown>, deletes: string[] = []) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = writable(db), state = tx.objectStore('state');let failure:unknown;
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(failure||tx.error); tx.onabort = () => reject(failure||tx.error||new DOMException('Private storage transaction aborted.','AbortError'));
    try {
      for (const [key, value] of Object.entries(puts)) state.put(value, key);
      for (const key of deletes) state.delete(key);
    }catch(error){failure=error;try{tx.abort();}catch{reject(error);}}
  });
}
export async function localEntries(prefix = ''): Promise<[string, unknown][]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const entries: [string, unknown][] = [];
    const request = db.transaction('state').objectStore('state').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(entries); entries.push([String(cursor.key), cursor.value]); cursor.continue(); };
    request.onerror = () => reject(request.error);
  });
}
export async function pendingPrivateWork() {
  const entries = await localEntries();
  return entries.filter(([key, value]) => key.startsWith('quarantine:') || Boolean(value && typeof value === 'object' && ('dirty' in value && value.dirty || 'pending' in value && value.pending)));
}
