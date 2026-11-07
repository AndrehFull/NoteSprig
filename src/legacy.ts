// Read compatibility for installations created before the current product identity.
export const legacyBrowserPrefix = 'obsdian';
export const LEGACY_DATABASE = `${legacyBrowserPrefix}-private`;
export const LEGACY_MEDIA = `${legacyBrowserPrefix}-media-v1`;
export const PRIVATE_MIGRATION = 'migration:private-cache-v1';

export function migrateLegacyPreferences() {
  for (const storage of [localStorage, sessionStorage]) {
    const marker = 'notesprig.migration.preferences-v1';
    if (storage.getItem(marker)) continue;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(`${legacyBrowserPrefix}.`)));
    for (const key of keys) {
      const next = `notesprig${key.slice(legacyBrowserPrefix.length)}`;
      if (storage.getItem(next) === null) storage.setItem(next, storage.getItem(key)!);
    }
    storage.setItem(marker, 'complete');
  }
}

async function legacyDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE);
    let absent = false;
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
    request.onerror = () => { if (absent) resolve(undefined); else reject(request.error); };
    request.onsuccess = () => {
      if (!request.result.objectStoreNames.contains('state')) { request.result.close(); resolve(undefined); }
      else resolve(request.result);
    };
  });
}

export async function migrateLegacyPrivateCache(database: IDBDatabase) {
  const migrated = await new Promise<boolean>((resolve, reject) => {
    const request = database.transaction('state').objectStore('state').get(PRIVATE_MIGRATION);
    request.onsuccess = () => resolve(Boolean(request.result)); request.onerror = () => reject(request.error);
  });
  if (migrated) return;
  const previous = await legacyDatabase();
  let keys: IDBValidKey[] = [], values: unknown[] = [];
  if (previous) {
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = previous.transaction('state'); const store = transaction.objectStore('state');
        store.getAllKeys().onsuccess = (event) => { keys = (event.target as IDBRequest<IDBValidKey[]>).result; };
        store.getAll().onsuccess = (event) => { values = (event.target as IDBRequest<unknown[]>).result; };
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      });
    } finally { previous.close(); }
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite'), store = transaction.objectStore('state');
    for (const [index, key] of keys.entries()) {
      const request = store.get(key);
      request.onsuccess = () => { if (request.result === undefined) store.put(values[index], key); };
    }
    store.put(true, PRIVATE_MIGRATION);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearLegacyPrivateCache() {
  sessionStorage.removeItem(`${legacyBrowserPrefix}.unlocked`);
  const previous = await legacyDatabase();
  if (previous) {
    try { await new Promise<void>((resolve, reject) => {
      const transaction = previous.transaction('state', 'readwrite'); transaction.objectStore('state').clear();
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    }); } finally { previous.close(); }
  }
  if ('caches' in window) await caches.delete(LEGACY_MEDIA);
}
