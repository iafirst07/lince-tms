'use strict';
const CACHE = 'lince-driver-shell-v1';
const SHELL = ['/driver/scanner.js','/driver/vendor/jsQR.js','/driver/vendor/qrcode.js','/driver/', '/driver/driver.js', '/driver/driver.css', '/driver/manifest.webmanifest', '/driver/icon.svg', '/driver/icon-192.png', '/driver/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lince-driver-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(url.pathname).then(hit => hit || Response.error())));
});
