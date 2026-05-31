const CACHE_NAME = 'pingpong-swing-v4'; // ★キャッシュバージョンを更新
const ASSETS_TO_CACHE = [
  '/tt_visualization/',
  '/tt_visualization/index.html',
  '/tt_visualization/manifest.json',
  '/tt_visualization/style.css',
  '/tt_visualization/app.js',
  '/tt_visualization/swing_logic.js'
];

// インストール時に必要なファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 新しいバージョンが有効になったら古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (CACHE_NAME !== cacheName) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});


// オフライン時はキャッシュからページを返す
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
