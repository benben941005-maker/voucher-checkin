// Service worker for the Voucher Check-In / Check-Out app.
//
// Purpose: let the app OPEN even with zero network, as long as it has been
// opened at least once before while online (which installs this cache).
// This does NOT make scanning (Google Vision OCR) or Firebase sync work
// offline — those genuinely need a live connection — but it means the app
// shell itself (the page + the JS libraries it depends on) is always
// available, so staff can at least use manual name entry + signature +
// check-in/out (which already has its own offline fallback built into the
// app) even when there is truly no network at the venue.
//
// Bump CACHE_NAME whenever you want to force everyone's cached copy to
// refresh (e.g. after a meaningful update to index.html) — the old cache is
// deleted automatically on the next activate.
const CACHE_NAME = 'voucher-checkin-v1';

// The exact set of files this app needs to open and run. Kept in sync with
// the <script src="..."> tags in index.html — if you add/remove a library
// there, update this list too.
const APP_SHELL_URLS = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache each URL independently so one failure (e.g. a transient
      // network hiccup during the very first install) doesn't stop the
      // others from being cached.
      return Promise.all(APP_SHELL_URLS.map(url =>
        fetch(url, { cache: 'reload' })
          .then(resp => {
            if(resp && (resp.ok || resp.type === 'opaque')){
              return cache.put(url, resp);
            }
          })
          .catch(() => { /* ignore — best effort at install time */ })
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  // Loading the page itself: try the network first (so any update to
  // index.html is picked up immediately whenever there IS a connection),
  // and only fall back to the cached copy when the network request fails —
  // that's the actual "open with zero network" case this exists for.
  if(req.mode === 'navigate'){
    event.respondWith(
      fetch(req)
        .then(resp => {
          caches.open(CACHE_NAME).then(cache => cache.put('./', resp.clone()));
          return resp;
        })
        .catch(() => caches.match('./').then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // The JS libraries the page depends on rarely change (their URLs are
  // pinned to a specific version), so these are cache-first: instant load,
  // no network round-trip needed once cached, with a network fetch (that
  // also refreshes the cache) as the fallback for anything not cached yet.
  if(APP_SHELL_URLS.includes(req.url)){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached) return cached;
        return fetch(req).then(resp => {
          if(resp && resp.ok){
            caches.open(CACHE_NAME).then(cache => cache.put(req, resp.clone()));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Everything else — Firestore sync traffic, the Google Vision OCR calls,
  // the conference-registration lookup, anything else — passes straight
  // through untouched. Those genuinely need a live network connection and
  // the app already has its own fallback/retry handling for them.
});
