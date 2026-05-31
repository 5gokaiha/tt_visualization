const CACHE_NAME = 'pingpong-swing-v5'; // ★キャッシュバージョンをインクリメント
const ASSETS_TO_CACHE = [
  'index.html',
  'manifest.json',
  'style.css',
  'app.js',
  'swing_logic.js'
];

// インストール時に新しいファイルを即時取得
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting(); // ★古い待機状態をスキップして即時有効化
    })
  );
});

// 古いキャッシュを確実に削除して競合を防止
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
    }).then(() => {
      return self.clients.claim(); // ★起動中の全タブをこの新ワーカーの配下に即座に置く
    })
  );
});

// フェッチ処理
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
