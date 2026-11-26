const CACHE_NAME = 'moneymanager-shell-v76';
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/theme-init.js',
  './js/i18n.js',
  './js/charts.js',
  './js/receipt.js',
  './js/importer-ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.includes('/api/')) {
    return;
  }

  // Network-first with HTTP cache bypass for same-origin shell updates across web & PWA
  const req = url.origin === self.location.origin ? new Request(event.request, { cache: 'no-cache' }) : event.request;
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch {
      payload = {};
    }
  }

  const title = payload.title || 'MoneyManager';
  const options = {
    body: payload.body || 'New auto-logged transaction.',
    icon: './icons/icon-192.svg',
    badge: './icons/icon-192.svg',
    tag: payload.tag || 'mm-autolog',
    renotify: true,
    data: {
      url: payload.url || './',
      txId: payload.txId || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          try {
            client.postMessage({ type: 'mm-autolog-push', txId: payload.txId || null });
          } catch {
            // ignore
          }
        }
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification?.data?.url || './', self.registration.scope).toString();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
