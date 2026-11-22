// DailyJon service worker — offline cache
const V = 'dailyjon-v4';
const LIB = 'dailyjon-lib';
const SHELL = ['./', './index.html', './manifest.json',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('dailyjon-') && k !== V && k !== LIB).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // App sendiri: tampilkan dari cache (cepat & offline), perbarui di latar belakang
  if (u.origin === location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cached => {
        const net = fetch(req).then(res => {
          if (res.ok) { const cl = res.clone(); caches.open(V).then(c => c.put(req, cl)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Pustaka AI on-device (WebLLM) dari CDN: simpan supaya bisa dipakai offline
  if (/(^|\.)esm\.run$|(^|\.)jsdelivr\.net$/.test(u.hostname)) {
    e.respondWith(caches.open(LIB).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});

// Notifikasi push dari server DailyJon Push (muncul walau aplikasi tertutup)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'DailyJon', {
    body: d.body || '', tag: d.tag || undefined, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: {url: d.url || './'}, timestamp: Date.now()
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return clients.openWindow(target);
  }));
});
