// Offline-Speicher (Service Worker) für den StatiCulator: Beim ersten Besuch werden alle Dateien der App
// gespeichert, danach funktioniert sie auch ohne Internet (ausser Foto-Import und Besucherstatistik).
// Die Seite selbst kommt zuerst aus dem Netz (damit Updates sofort da sind), sonst aus dem Speicher;
// alle anderen Dateien tragen eine Versionsnummer (?v=…) und kommen direkt aus dem Speicher.
// Liste und Version setzt tools/stamp-web-version.mjs bei jedem Veröffentlichen.

// precache:start (tools/stamp-web-version.mjs)
const VERSION = '202611261242';
const FILES = [
  "./",
  "./css/app.css?v=202611261242",
  "./js/app.js?v=202611261242",
  "./js/bemessung.js?v=202611261242",
  "./js/cursor-derive.js?v=202611261242",
  "./js/design-terms.js?v=202611261242",
  "./js/design-ui.js?v=202611261242",
  "./js/diagrams.js?v=202611261242",
  "./js/dimension.js?v=202611261242",
  "./js/examples.js?v=202611261242",
  "./js/export-image.js?v=202611261242",
  "./js/figure.js?v=202611261242",
  "./js/format.js?v=202611261242",
  "./js/photo-import.js?v=202611261242",
  "./js/section-svg.js?v=202611261242",
  "./js/self-check.js?v=202611261242",
  "./js/solution.js?v=202611261242",
  "./js/statik.js?v=202611261242",
  "./js/step-list.js?v=202611261242",
  "./data/c4.js?v=202611261242",
  "./data/profiles.js?v=202611261242",
  "./vendor/katex/katex.min.css",
  "./vendor/katex/katex.min.js",
  "./vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "./vendor/katex/fonts/KaTeX_Math-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "./vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Script-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size1-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size2-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size3-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Size4-Regular.woff2",
  "./vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];
// precache:end

const CACHE = `staticulator-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // alte Versionen löschen
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('staticulator-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // fremde Adressen (Foto-Import, Turnstile, Statistik) gehen direkt ins Netz
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Seite: zuerst aus dem Netz, offline die gespeicherte
    const isApp = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    event.respondWith(fetch(request)
      .then((response) => {
        if (isApp && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy));
        }
        return response;
      })
      .catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  // Dateien: aus dem Speicher, sonst aus dem Netz (und dann merken)
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
