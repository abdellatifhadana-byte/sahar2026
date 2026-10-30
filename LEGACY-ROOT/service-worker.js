/**
 * @file service-worker.js - خادم الخدمة لتطبيق الويب التقدمي (PWA)
 * @description يدعم العمل دون اتصال والتخزين المؤقت
 */

const CACHE_NAME = '2mtech-v1';
const OFFLINE_URL = '/offline.html';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/assets/css/main.css',
  '/assets/css/admin.css',
  '/assets/css/tech.css',
  '/assets/css/responsive.css',
  '/assets/css/visitor.css',
  '/assets/js/app/core.js',
  '/assets/js/app/db.js',
  '/assets/js/app/auth.js',
  '/assets/js/app/logs.js',
  '/assets/js/app/permissions.js',
  '/assets/js/app/search.js',
  '/assets/js/app/notifications.js',
  '/assets/js/app/admin-ui.js',
  '/assets/js/app/techui.js',
  '/assets/js/app/responsible-ui.js',
  '/assets/js/app/visitor-ui.js',
  '/assets/js/app/utils.js',
  '/assets/js/app/api.js',
  '/assets/js/app/offline-manager.js',
  '/assets/js/app/sync-manager.js',
  '/assets/js/app/backup-manager.js',
  '/assets/js/app/ar-support.js',
  '/assets/images/logo.png',
  '/assets/images/user-avatar.png',
  '/assets/images/tech-avatar.png',
  '/assets/images/responsible-avatar.png',
  '/assets/images/visitor-avatar.png',
  '/assets/images/tech-rooms.png',
  '/assets/images/favicon.ico',
  OFFLINE_URL
];

// التثبيت الأولي وتخزين الأصول في الذاكرة المؤقتة
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// التنشيط وتنظيف الذاكرة المؤقتة القديمة
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// إستراتيجية التخزين المؤقت (الأولوية للشبكة مع السقوط على الذاكرة المؤقتة)
self.addEventListener('fetch', (event) => {
  // تجاهل طلبات غير GET وطلبات من مصادر أخرى
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // معالجة طلبات API بشكل مختلف
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // يمكن إضافة تخزين مؤقت لطلبات API هنا إذا لزم الأمر
          return response;
        })
        .catch(() => {
          // في حالة فشل طلب API، يمكن إرجاع بيانات مخزنة مسبقاً إذا كانت متوفرة
          return new Response(JSON.stringify({ error: 'You are offline' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // إذا نجح الطلب، تحديث الذاكرة المؤقتة
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          });
        return response;
      })
      .catch(() => {
        // إذا فشل الطلب، جلب من الذاكرة المؤقتة
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // إذا كانت الصفحة الرئيسية ولم تكن في الذاكرة المؤقتة، عرض صفحة عدم الاتصال
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }
            
            return new Response('', { status: 404, statusText: 'Not Found' });
          });
      })
  );
});

// معالجة رسائل الخادم الخدمي
self.addEventListener('message', (event) => {
  if (event.data.type === 'CACHE_ASSETS') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => {
          return cache.addAll(event.data.payload);
        })
    );
  }
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});