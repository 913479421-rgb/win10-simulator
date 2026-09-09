// Service Worker - 离线缓存支持
const CACHE_NAME = 'win10-simulator-v3';
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

//  fetch：缓存优先策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存 GET 请求
  if (request.method !== 'GET') return;

  // 对于 WASM 和大文件，使用网络优先（避免缓存过大）
  if (request.url.includes('.wasm') || request.url.includes('.bin') || request.url.includes('.iso')) {
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

  // 其他资源：缓存优先，网络回退
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
