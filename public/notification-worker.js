/* Install support and push delivery. Authenticated application pages are never cached. */
const APP_CACHE = 'fuzedflow-app-shell-v1';
const OFFLINE_URL = '/offline.html';
const PUBLIC_APP_ASSETS = [OFFLINE_URL, '/app-icon-192.png', '/app-icon-512.png', '/app-icon-maskable-512.png'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(APP_CACHE);
  await Promise.all(PUBLIC_APP_ASSETS.map(asset => cache.add(asset).catch(() => null)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames
    .filter(name => name.startsWith('fuzedflow-app-shell-') && name !== APP_CACHE)
    .map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
const validUrl = value => {
  try {
    const url = new URL(value || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL('/', self.location.origin).href;
  } catch { return new URL('/', self.location.origin).href; }
};
const remember = async (id, displayed = false) => {
  if (!id) return false;
  const cache = await caches.open('fuzedflow-push-delivery-v1');
  const request = new Request(new URL('/__push_seen__/' + encodeURIComponent(id), self.location.origin));
  if (await cache.match(request)) return true;
  if (!displayed) return false;
  await cache.put(request, new Response('received'));
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - 200)).map(key => cache.delete(key)));
  return false;
};
self.addEventListener('push', event => event.waitUntil((async () => {
  let payload;
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  if (await remember(payload.id)) return;
  await self.registration.showNotification(payload.title || 'Fuzed Flow', {
    body: payload.body || 'You have a new Fuzed Flow update.', tag: payload.id || 'fuzedflow-update',
    icon: '/app-icon-192.png', badge: '/notification-icon.svg',
    data: { url: validUrl(payload.url), id: payload.id },
  });
  await remember(payload.id, true);
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = validUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
self.addEventListener('pushsubscriptionchange', event => event.waitUntil((async () => {
  // A worker has no account credentials. Reconnect explicitly in notification settings.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: 'fuzedflow-push-expired' }));
})()));
