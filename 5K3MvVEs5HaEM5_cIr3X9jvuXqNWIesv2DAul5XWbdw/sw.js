/* App shell cache only. Data (/api/ on the desk, d/ in a snapshot) is never cached: no stale numbers.
   Paths are relative so the app works at / on the desk and under the secret path on a static host. */
const SHELL = 'desk-shell-v2';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'chart.js', 'crypt.js', 'manifest.json', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || u.origin !== scope.origin) return;
  const rel = u.pathname.slice(scope.pathname.length);
  if (u.pathname.startsWith('/api/') || rel.startsWith('d/')) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
// Every push shows a notification (iOS revokes push for silent ones).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Desk', { body: d.body || '', icon: 'icons/icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const inApp = url.startsWith(self.registration.scope);
    for (const w of ws) if (inApp && 'focus' in w) { w.navigate && w.navigate(url); return w.focus(); }
    return clients.openWindow(url);
  }));
});
