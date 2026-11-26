/**
 * Prowosma Service Worker
 * Dev: immediately unregisters itself to avoid intercepting Vite HMR
 * Prod: caches API + static assets for offline support
 */

const IS_DEV = self.location.hostname === 'localhost' ||
               self.location.hostname === '127.0.0.1';

// In development: no caching (Vite serves everything), but stay installed so desktop notifications work locally too.
if (IS_DEV) {
  self.addEventListener('install',  () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
} else {
  // ── Production only ─────────────────────────────────────────
  // v2: the v1 cache could hold an HTML page saved under the name of a script of an older build; a new name drops all of it.
  const STATIC = 'prowosma-static-v2';
  const API    = 'prowosma-api-v1';

  self.addEventListener('install', (e) => {
    e.waitUntil(
      caches.open(STATIC)
        .then(c => c.addAll(['/manifest.json']))
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
          // Clone SYNCHRONOUSLY, immediately, before any async gap. The
          // previous version called res.clone() inside caches.open()'s
          // .then() callback — but caches.open() is itself async and
          // wasn't awaited, so `return res` below already handed the
          // original response to the page (which starts reading its body
          // right away) well before that later .then() ever ran. By the
          // time it did, the body stream was already locked/consumed,
          // and .clone() failed with "Response body is already used".
          // Cloning here, in the same tick the response arrives, avoids
          // that race entirely — the clone is made before anyone (the
          // page, or this same caching code) has touched the body.
          if (res.ok) {
            const resClone = res.clone();
            caches.open(API).then(c => c.put(request, resClone));
          }
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

    // Navigation — network first, /index.html fallback (kept fresh: the copy saved here is always the newest page that loaded)
    if (request.mode === 'navigate') {
      e.respondWith(
        fetch(request).then(res => {
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(STATIC).then(c => c.put('/index.html', copy));
          }
          return res;
        }).catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || new Response('<h1>Offline</h1>',
            { status: 200, headers: { 'Content-Type': 'text/html' } });
        })
      );
      return;
    }

    // Built files (/assets/…) carry a hash of their content in the name, so they never change: cache first. But only keep a real file —
    // when a file of an older build is gone, the server may answer with the app's HTML page instead, and keeping THAT under the file's name
    // would break the page until someone cleared the browser's data.
    if (url.pathname.startsWith('/assets/')) {
      e.respondWith(
        caches.match(request).then(cached => cached ||
          fetch(request).then(res => {
            const type = res.headers.get('content-type') || '';
            if (res.ok && !type.includes('text/html')) {
              const resClone = res.clone();
              caches.open(STATIC).then(c => c.put(request, resClone));
            }
            return res;
          })
        )
      );
      return;
    }

    // Everything else (icons, manifest, …) — network first, cached copy only when offline
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
          const resClone = res.clone();
          caches.open(STATIC).then(c => c.put(request, resClone));
        }
        return res;
      }).catch(async () => (await caches.match(request)) || Response.error())
    );
  });

}

// Desktop notifications (Web Push) - in development and production alike.
self.addEventListener('push', (e) => {
  let data = { title: 'Prowosma', body: 'You have a new notification' };
  try { data = e.data?.json() || data; } catch { /* malformed push payload, use default */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-72.png',
    data: { url: data.url || '/' },
    tag: data.tag, renotify: !!data.tag,
    actions: [{ action: 'open', title: 'Open' }, { action: 'dismiss', title: 'Dismiss' }],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      // Prowosma already open: bring it forward on the right page. Otherwise open it.
      const win = wins.find(c => c.url.includes(url)) || wins[0];
      if (!win) return clients.openWindow(url);
      await win.focus();
      if (!win.url.includes(url) && 'navigate' in win) { try { await win.navigate(url); } catch { return clients.openWindow(url); } }
    })
  );
});
