/* KopilkaMoto service worker: app shell с версионным кешем и обновлением по кнопке. */
'use strict';

// VERSION меняй при каждом релизе. BUILD подставляет workflow публикации (хеш коммита),
// поэтому при деплое через GitHub Actions кеш обновляется автоматически.
const VERSION = 'v27';
const BUILD = 'dev';
const PREFIX = 'kopilkamoto-';
const CACHE = `${PREFIX}${VERSION}-${BUILD}`;
const LEGACY = /^(kopilkamoto-v[1-7]$|moto-savings-)/;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/calendar.js',
  './js/core.js',
  './js/dom.js',
  './js/insights.js',
  './js/markdown.js',
  './js/motion.js',
  './js/plan.js',
  './js/report.js',
  './js/storage.js',
  './js/ui/backup.js',
  './js/ui/banners.js',
  './js/ui/bindings.js',
  './js/ui/chat.js',
  './js/ui/calendar.js',
  './js/ui/context.js',
  './js/ui/entries.js',
  './js/ui/form.js',
  './js/ui/history.js',
  './js/ui/home.js',
  './js/ui/insights.js',
  './js/ui/notify.js',
  './js/ui/onboarding.js',
  './js/ui/pages.js',
  './js/ui/plan.js',
  './js/ui/presets.js',
  './js/ui/pwa.js',
  './js/ui/report.js',
  './js/ui/router.js',
  './js/ui/settings.js',
  './js/ui/startup.js',
  './js/ui/sync.js',
  './js/ui/theme.js',
  './js/version.js',
  './fonts/russo-one-cyrillic-400-normal.woff2',
  './fonts/russo-one-latin-400-normal.woff2',
  './images/dream-bike.webp',
  './images/dream-bike-480.webp',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' — мимо HTTP-кеша, чтобы не закешировать устаревшие файлы.
      await cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })));
      // Старые версии приложения не умеют показывать кнопку «Обновить» — для них активируемся сразу.
      const keys = await caches.keys();
      if (keys.some((k) => LEGACY.test(k))) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => (k.startsWith(PREFIX) || LEGACY.test(k)) && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Оболочка приложения одна для всех адресов (#home, ?source=pwa и т.п.).
    event.respondWith(
      (async () => {
        const cached = await caches.match('./index.html', { cacheName: CACHE });
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          return new Response('<h1>Нет соединения</h1><p>Открой приложение, когда появится интернет.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  url.search = '';
  if (!SHELL_URLS.has(url.href)) return; // остальное — напрямую в сеть, без кеширования

  event.respondWith(
    (async () => {
      const cached = await caches.match(url.href, { cacheName: CACHE });
      return cached || fetch(req);
    })(),
  );
});
