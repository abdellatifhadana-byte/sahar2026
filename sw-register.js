/**
 * @file sw-register.js - تسجيل خادم الخدمة
 * @description يقوم بتسجيل Service Worker لتطبيق الويب التقدمي
 */

let controllerReloading = false;

function reloadOnControllerChange() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controllerReloading) return;
    controllerReloading = true;
    // Recharge exactement une fois lorsque la nouvelle version prend le contrôle.
    // Cela évite de mélanger index.html récent avec d'anciens modules en cache.
    window.location.reload();
  });
}

if ('serviceWorker' in navigator) {
  reloadOnControllerChange();
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' });
      console.log('Service worker enregistré avec la portée :', registration.scope);

      // Vérifier immédiatement au démarrage, pas seulement une fois par heure.
      await registration.update().catch(error => console.warn('Vérification SW différée :', error));
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateNotification(registration);
          }
        });
      });
    } catch (err) {
      console.error("Échec de l'enregistrement du service worker :", err);
    }
  });
}

function showUpdateNotification(registration) {
  if (document.getElementById('app-update-notification')) return;
  const notification = document.createElement('div');
  notification.id = 'app-update-notification';
  notification.className = 'update-notification';
  const message = document.createElement('p');
  message.textContent = "Une nouvelle version de l'application est disponible.";
  const reload = document.createElement('button');
  reload.id = 'reload-app-btn';
  reload.textContent = 'Mettre à jour maintenant';
  notification.append(message, reload);
  document.body.appendChild(notification);

  reload.addEventListener('click', () => {
    const worker = registration?.waiting || registration?.installing;
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  });
}

// Vérification périodique en complément de la vérification au chargement.
setInterval(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => registration.update().catch(() => {}));
  }
}, 60 * 60 * 1000);