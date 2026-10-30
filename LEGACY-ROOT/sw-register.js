/**
 * @file sw-register.js - تسجيل خادم الخدمة
 * @description يقوم بتسجيل Service Worker لتطبيق الويب التقدمي
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
        
        // التحقق من وجود تحديثات
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // هناك نسخة جديدة متاحة
                showUpdateNotification();
              }
            }
          });
        });
      })
      .catch(err => {
        console.log('ServiceWorker registration failed: ', err);
      });
  });
}

function showUpdateNotification() {
  // يمكنك عرض إشعار للمستخدم بوجود تحديث
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <p>يتوفر تحديث جديد للتطبيق</p>
    <button id="reload-btn">تحديث الآن</button>
  `;
  
  document.body.appendChild(notification);
  
  document.getElementById('reload-btn').addEventListener('click', () => {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  });
}

// تحديث الخدمة كل ساعة
setInterval(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.update();
    });
  }
}, 60 * 60 * 1000);