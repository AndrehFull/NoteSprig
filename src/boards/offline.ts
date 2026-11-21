/** Public drawing dependencies only. Vault documents and images belong in scoped private storage. */
type FeatureAsset = { url: string; bytes: number; sha256: string };
type FeatureManifest = { schemaVersion: 1; version: string; entry: string; assets: FeatureAsset[] };
export type BoardOfflineResult = { ready: true; version: string; assets: number; bytes: number } | { ready: false; reason: 'development' };
export class BoardDependencyError extends Error {
  readonly code = 'BOARD_DEPENDENCY_UNAVAILABLE';
  constructor(message = 'Drawing dependencies are unavailable. Your draft is preserved. Reconnect and reload when you are ready.') { super(message); this.name = 'BoardDependencyError'; }
}
const CACHE_PREFIX = 'notesprig-board-feature-';
const READY = '/__notesprig-board-feature-ready__';
const MAX_BYTES = 128 * 1024 ** 2;
const safeAsset = (url: unknown): url is string => typeof url === 'string' && url.length < 2000 && /^\/(?:assets|board-assets)\/[a-zA-Z\d./_-]+$/.test(url) && !url.split('/').some((part) => part === '.' || part === '..');
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function validateManifest(value: unknown): FeatureManifest {
  if (!value || typeof value !== 'object') throw new BoardDependencyError();
  const manifest = value as FeatureManifest;
  if (manifest.schemaVersion !== 1 || !/^[a-f\d]{24}$/.test(manifest.version) || !safeAsset(manifest.entry) || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 2000) throw new BoardDependencyError();
  const urls = new Set<string>(); let total = 0;
  for (const asset of manifest.assets) {
    if (!asset || !safeAsset(asset.url) || urls.has(asset.url) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_BYTES || !/^[a-f\d]{64}$/.test(asset.sha256)) throw new BoardDependencyError();
    urls.add(asset.url); total += asset.bytes;
  }
  if (total > MAX_BYTES || !urls.has(manifest.entry)) throw new BoardDependencyError();
  return manifest;
}

async function controlledWorker(signal?: AbortSignal) {
  if (!('serviceWorker' in navigator) || !('caches' in window) || !crypto.subtle) throw new BoardDependencyError();
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', check); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const check = () => { if (navigator.serviceWorker.controller) done(); };
    const abort = () => done(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => done(new BoardDependencyError()), 15000);
    navigator.serviceWorker.addEventListener('controllerchange', check);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else check();
  });
}

/** Verify every required chunk/font before reporting that boards are available offline. */
export async function prepareBoardOffline(options: { signal?: AbortSignal; entryUrl?: string } = {}): Promise<BoardOfflineResult> {
  if (import.meta.env.DEV) return { ready: false, reason: 'development' };
  const { signal } = options;
  try {
    await controlledWorker(signal);
    const manifestUrl = document.querySelector<HTMLMetaElement>('meta[name="notesprig-board-manifest"]')?.content;
    if (!manifestUrl || !/^\/board-feature-[a-f\d]{24}\.json$/.test(manifestUrl)) throw new BoardDependencyError();
    const response = await fetch(manifestUrl, { cache: 'force-cache', credentials: 'omit', signal });
    if (!response.ok || Number(response.headers.get('Content-Length')) > 1024 ** 2) throw new BoardDependencyError();
    const text = await response.text();
    if (text.length > 1024 ** 2) throw new BoardDependencyError();
    const manifest = validateManifest(JSON.parse(text));
    if (manifestUrl !== `/board-feature-${manifest.version}.json`) throw new BoardDependencyError();
    if (options.entryUrl) {
      const entry = new URL(options.entryUrl, location.origin);
      if (entry.origin !== location.origin || !manifest.assets.some((asset) => asset.url === entry.pathname)) throw new BoardDependencyError();
    }
    const cache = await caches.open(CACHE_PREFIX + manifest.version);
    await cache.delete(READY);
    let cursor = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < manifest.assets.length) {
        signal?.throwIfAborted();
        const asset = manifest.assets[cursor++];
        const cached = await cache.match(asset.url);
        if (cached) {
          const bytes = await cached.clone().arrayBuffer();
          if (bytes.byteLength === asset.bytes && await digest(bytes) === asset.sha256) continue;
          await cache.delete(asset.url);
        }
        const resource = await fetch(asset.url, { cache: 'force-cache', credentials: 'omit', signal });
        if (!resource.ok || resource.type === 'opaque' || Number(resource.headers.get('Content-Length')) > asset.bytes) throw new BoardDependencyError();
        const bytes = await resource.clone().arrayBuffer();
        if (bytes.byteLength !== asset.bytes || await digest(bytes) !== asset.sha256) throw new BoardDependencyError();
        await cache.put(asset.url, resource);
      }
    }));
    signal?.throwIfAborted();
    const result: BoardOfflineResult = { ready: true, version: manifest.version, assets: manifest.assets.length, bytes: manifest.assets.reduce((total, asset) => total + asset.bytes, 0) };
    await cache.put(manifestUrl, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    await cache.put(READY, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }));
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof BoardDependencyError) throw error;
    throw new BoardDependencyError();
  }
}
