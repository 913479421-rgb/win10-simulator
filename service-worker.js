// Service Worker - 离线缓存支持
const CACHE_NAME = 'win10-simulator-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/vnc.js',
  './js/vm.js',
  './js/storage.js',
  './js/indexeddb-buffer.js',
  './v86/libv86.js',
  './v86/v86.wasm',
  './v86/bios/seabios.bin',
  './v86/bios/vgabios.bin',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 缓存核心资源');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// fetch：网络优先策略（确保加载最新版本）
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存 GET 请求
  if (request.method !== 'GET') return;

  // 对于 HTML、JS、CSS 文件，使用网络优先（确保最新版本）
  if (request.mode === 'navigate' || 
      request.url.includes('.js') || 
      request.url.includes('.css') ||
      request.url.includes('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 克隆响应并存入缓存
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 对于 WASM、BIOS、图片等静态资源，使用缓存优先
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        });
      })
  );
});

// 消息处理
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
