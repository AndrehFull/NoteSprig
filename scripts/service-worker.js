const SHELL = 'notesprig-shell-__VERSION__';
const MEDIA = 'notesprig-media-v1';
const LEGACY_SHELL = '__LEGACY_SHELL__';
const LEGACY_MEDIA = '__LEGACY_MEDIA__';
const ASSETS = __ASSETS__;
const MESSAGES = __OFFLINE_MESSAGES__;
const languages = new Map();
function message(event, key) {
    const requested = languages.get(event.clientId) || event.request.headers.get('Accept-Language') || 'en';
    return MESSAGES[String(requested).toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'][key];
}
self.addEventListener('install', (event) => event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
    const keys = await caches.keys();
    if (keys.includes(LEGACY_MEDIA)) {
        try {
            const previous = await caches.open(LEGACY_MEDIA), current = await caches.open(MEDIA);
            for (const request of await previous.keys())
                if (!(await current.match(request))) {
                    const response = await previous.match(request);
                    if (response)
                        await current.put(request, response);
                }
            const entries = await current.keys();
            for (const request of entries.slice(0, Math.max(0, entries.length - 40)))
                await current.delete(request);
            await caches.delete(LEGACY_MEDIA);
        }
        catch { /* Keep the previous private cache available if migration fails. */ }
    }
    await Promise.all(keys.filter((key) => (key.startsWith('notesprig-shell-') || key.startsWith(LEGACY_SHELL)) && key !== SHELL).map((key) => caches.delete(key)));
    await self.clients.claim();
})()));
self.addEventListener('message', (event) => { if (event.data?.type === 'SET_LANGUAGE' && event.source?.id && ['en', 'pt-BR'].includes(event.data.language)) languages.set(event.source.id, event.data.language); if (event.data?.type === 'CLEAR_PRIVATE')
    event.waitUntil(Promise.all([caches.delete(MEDIA), caches.delete(LEGACY_MEDIA)])); });
self.addEventListener('fetch', (event) => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin)
        return;
    if (url.pathname.startsWith('/api/')) {
        if (url.pathname !== '/api/attachment' || request.headers.has('Range'))
            return;
        event.respondWith((async () => {
            const cache = await caches.open(MEDIA);
            try {
                const response = await fetch(request);
                if (response.status === 401) {
                    await cache.delete(request);
                    if ((await caches.keys()).includes(LEGACY_MEDIA))
                        await (await caches.open(LEGACY_MEDIA)).delete(request);
                    return response;
                }
                if (response.ok && Number(response.headers.get('content-length')) < 10 * 1024 * 1024) {
                    await cache.put(request, response.clone());
                    const keys = await cache.keys();
                    for (const key of keys.slice(0, Math.max(0, keys.length - 40)))
                        await cache.delete(key);
                }
                return response;
            }
            catch {
                return await cache.match(request) || await caches.match(request, { cacheName: LEGACY_MEDIA }) || new Response(message(event, "Attachment unavailable offline."), { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
        })());
        return;
    }
    if (request.mode === 'navigate') {
        event.respondWith(fetch(request).catch(async () => await (await caches.open(SHELL)).match('/index.html') || new Response(message(event, "Open the app online before using it offline."), { status: 503 })));
        return;
    }
    event.respondWith(caches.open(SHELL).then((cache) => cache.match(request)).then((cached) => cached || fetch(request)));
});
