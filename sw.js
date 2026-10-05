// Service worker: оболочка, ассеты, фото и шрифты — из кэша (cache-first), API — сеть с запасным кэшем.
// Пути относительны области регистрации, поэтому работает и в корне домена, и в подпапке (GitHub Pages).
const CACHE = 'moonlight-v2';
const BASE = new URL(self.registration.scope).pathname; // например "/" или "/order-manager-HoReCa/"
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icon.svg`];
const STATIC = /\/(assets|photos|fonts)\//;

// При установке кладём в кэш оболочку, её скрипты/стили (имена берём из index.html) и шрифты:
// второй запуск не зависит от HTTP-кэша хостинга (GitHub Pages отдаёт max-age всего 10 минут).
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL).catch(() => {});
  try {
    const html = await (await fetch(`${BASE}index.html`, { cache: 'no-cache' })).text();
    const urls = [...html.matchAll(/(?:src|href)="\.?\/?((?:assets|fonts)\/[^"]+)"/g)].map((m) => BASE + m[1]);
    await Promise.all(urls.map((u) => c.add(u).catch(() => {})));
  } catch {}
}
self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(`${BASE}api/`)) {
    // network-first, запасной вариант — кэш (каталог можно показать офлайн)
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (url.pathname === `${BASE}api/catalog`) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request)),
    );
    return;
  }
  // Фото не имеют хэша в имени: отдаём из кэша сразу, а свежую версию тихо подтягиваем в фоне (stale-while-revalidate)
  const revalidate = url.pathname.includes('/photos/');
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok && (STATIC.test(url.pathname) || SHELL.includes(url.pathname))) {
            caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => hit || caches.match(`${BASE}index.html`));
      if (hit && revalidate) e.waitUntil(network.catch(() => {}));
      return hit || network;
    }),
  );
});
