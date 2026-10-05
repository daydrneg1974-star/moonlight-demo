// Service worker. Пути относительны области регистрации: работает и в корне домена, и в подпапке (GitHub Pages).
//   index.html (навигация)  — сеть, запасной вариант кэш: после каждого деплоя гость сразу получает новую сборку
//   assets/, fonts/         — кэш (имена с хэшем, не меняются)
//   photos/                 — кэш сразу, свежая версия тихо в фоне (stale-while-revalidate)
//   api/                    — сеть, запасной вариант кэш (каталог можно показать офлайн)
// Урок v2: index.html отдавался из кэша первым, и после деплоя телефон неделю жил на старой сборке,
// у которой уже не было чанков на сервере («не смог оформить заказ»).
const CACHE = 'moonlight-v3';
const BASE = new URL(self.registration.scope).pathname;
const SHELL = [`${BASE}manifest.webmanifest`, `${BASE}icon.svg`];
const STATIC = /\/(assets|fonts)\//;
const PHOTOS = /\/photos\//;
const isNavigation = (req, url) => req.mode === 'navigate' || url.pathname === BASE || url.pathname === `${BASE}index.html`;

async function precache() {
  const c = await caches.open(CACHE);
  await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
  try {
    const res = await fetch(`${BASE}index.html`, { cache: 'no-cache' });
    const html = await res.clone().text();
    await c.put(`${BASE}index.html`, res);
    const urls = [...html.matchAll(/(?:src|href)="\.?\/?((?:assets|fonts)\/[^"]+)"/g)].map((m) => BASE + m[1]);
    await Promise.all(urls.map((u) => c.add(u).catch(() => {})));
  } catch {}
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter((k) => k !== CACHE);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Старая версия кэша означает, что открытые вкладки работают на старой сборке — перезагружаем их один раз
    if (stale.length) {
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (isNavigation(req, url) || url.pathname.startsWith(`${BASE}api/`)) {
    // сеть первой; кэшируем только оболочку и каталог
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (isNavigation(req, url) || url.pathname === `${BASE}api/catalog`)) {
            const key = isNavigation(req, url) ? `${BASE}index.html` : req;
            caches.open(CACHE).then((c) => c.put(key, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(isNavigation(req, url) ? `${BASE}index.html` : req)),
    );
    return;
  }

  if (STATIC.test(url.pathname) || PHOTOS.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        if (hit && PHOTOS.test(url.pathname)) e.waitUntil(network.catch(() => {}));
        return hit || network;
      }),
    );
  }
});
