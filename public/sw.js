const LOG_PREFIX = '[PWA Cleanup]';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = typeof caches !== 'undefined' ? await caches.keys() : [];

    if (cacheKeys.length > 0) {
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      console.info(`${LOG_PREFIX} Cache storage cleared`, cacheKeys.length);
    }

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await self.registration.unregister();
    console.info(`${LOG_PREFIX} Service Worker unregistered`);

    await Promise.all(clients.map((client) => {
      if ('navigate' in client) {
        return client.navigate(client.url).catch(() => undefined);
      }
      return undefined;
    }));
  })());
});
