// mur-dimage-loader.js - Version محسنة ومتكاملة مع wallsManager.js
import WallsManager from './wallsManager.js';
import { getCurrentUser } from './security.js';
import { db } from './db.js';
import { NotificationSystem } from './notifications.js'; // Import NotificationSystem

const notifications = new NotificationSystem(); // Initialize notifications

async function injectMurButton() {
  const user = getCurrentUser();
  if (!user || !user.role) return;

  document.addEventListener('DOMContentLoaded', () => {
    const menu = document.querySelector('.sidebar') || document.querySelector('.menu') || document.querySelector('.navbar');
    if (!menu || document.getElementById('mur-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'mur-btn';
    btn.innerText = 'جدار الشاشات'; // Changed text to Arabic
    btn.className = 'menu-button';
    btn.style.margin = '10px';
    btn.onclick = async () => {
      const main = document.getElementById('main');
      if (!main) {
        notifications.showNotification('عنصر "main" غير موجود.', 'error');
        return;
      }
      main.innerHTML = '<div id="mur-container" style="width:100%;height:80vh;"></div>';

      // Use the new getCurrentRoom helper from db.js
      const currentRoomData = await db.getCurrentRoom();
      const currentRoomId = currentRoomData ? currentRoomData.roomId : null;

      if (!currentRoomId) {
        notifications.showNotification("لم يتم اختيار قاعة. يرجى اختيار قاعة أولاً من قسم 'القاعات'.", "warning");
        // Optionally, navigate to the salles section
        // window.location.hash = '#/salles';
        return;
      }

      await WallsManager.initWall(currentRoomId);
    };

    menu.appendChild(btn);
  });
}

injectMurButton();
