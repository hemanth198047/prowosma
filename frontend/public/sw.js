/**
 * Prowosma Service Worker
 * Dev: immediately unregisters itself to avoid intercepting Vite HMR
 * Prod: caches API + static assets for offline support
 */

const IS_DEV = self.location.hostname === 'localhost' ||
               self.location.hostname === '127.0.0.1';

// In development — self-destruct and let Vite handle everything
if (IS_DEV) {
  self.addEventListener('install',  () => self.skipWaiting());
  self.addEventListener('activate', () => {
    self.registration.unregister();
    self.clients.claim();
  });
} else {
  // ── Production only ─────────────────────────────────────────
  const STATIC = 'prowosma-static-v1';
  const API    = 'prowosma-api-v1';

  self.addEventListener('install', (e) => {
    e.waitUntil(
      caches.open(STATIC)
        .then(c => c.addAll(['/', '/index.html', '/manifest.json']))
        .catch(() => {})
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (e) => {
    e.waitUntil(
      caches.keys()
        .then(keys => Promise.all(
          keys.filter(k => k !== STATIC && k !== API).map(k => caches.delete(k))
        ))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', (e) => {
    const { request } = e;
    const url = new URL(request.url);
    if (request.method !== 'GET') return;
    if (url.pathname.startsWith('/ws')) return;

    // API — network first, cached fallback
    if (url.pathname.startsWith('/api/')) {
      e.respondWith(
        fetch(request.clone()).then(res => {
          if (res.ok) caches.open(API).then(c => c.put(request, res.clone()));
          return res;
        }).catch(async () => {
          const cached = await caches.match(request);
          return cached || new Response(
            JSON.stringify({ error: 'Offline' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
      );
      return;
    }

    // Navigation — network first, /index.html fallback
    if (request.mode === 'navigate') {
      e.respondWith(
        fetch(request).catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || new Response('<h1>Offline</h1>',
            { status: 200, headers: { 'Content-Type': 'text/html' } });
        })
      );
      return;
    }

    // Static assets — cache first
    e.respondWith(
      caches.match(request).then(cached => cached ||
        fetch(request).then(res => {
          if (res.ok) caches.open(STATIC).then(c => c.put(request, res.clone()));
          return res;
        })
      )
    );
  });

  // Push notifications
  self.addEventListener('push', (e) => {
    let data = { title: 'Prowosma', body: 'You have a new notification' };
    try { data = e.data?.json() || data; } catch { /* malformed push payload, use default */ }
    e.waitUntil(self.registration.showNotification(data.title, {
      body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-72.png',
      data: { url: data.url || '/' },
      actions: [{ action: 'open', title: '📂 Open' }, { action: 'dismiss', title: '✕ Dismiss' }],
    }));
  });

  self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    if (e.action === 'dismiss') return;
    const url = e.notification.data?.url || '/';
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
        const match = wins.find(c => c.url.includes(url));
        return match ? match.focus() : clients.openWindow(url);
      })
    );
  });
}
