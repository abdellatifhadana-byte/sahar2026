/**
 * @file ar-support.js - دعم الواقع المعزز للأجهزة
 * @description يتيح عرض معلومات الأجهزة عبر الواقع المعزز
 */

import { db } from './db.js';
import { NotificationSystem } from './notifications.js'; // Import the class

// Create an instance of the NotificationSystem
const notifications = new NotificationSystem();

class ARSupport {
  constructor() {
    this.isSupported = this.checkARSupport();
    this.init();
  }

  checkARSupport() {
    try {
      return 'xr' in navigator &&
             (navigator.xr?.isSessionSupported('immersive-ar') ||
             navigator.xr?.isSessionSupported('inline-ar'));
    } catch (e) {
      console.warn('الواقع المعزز غير مدعوم في هذا المتصفح:', e.message);
      return false;
    }
  }

  init() {
    if (!this.isSupported) {
      console.warn('الواقع المعزز غير مدعوم في هذا المتصفح');
      return;
    }

    // يمكن إضافة تهيئة إضافية هنا
  }

  async setupAR() {
    try {
      const session = await navigator.xr.requestSession('immersive-ar');
      session.addEventListener('end', () => {
        notifications.showNotification('تم إنهاء جلسة الواقع المعزز', 'info');
      });

      return session;
    } catch (error) {
      console.error('فشل بدء جلسة الواقع المعزز:', error);
      notifications.showNotification('فشل بدء الواقع المعزز', 'error');
      throw error;
    }
  }

  async showEquipmentInAR(equipmentId) {
    if (!this.isSupported) {
      notifications.showNotification('الواقع المعزز غير مدعوم في جهازك', 'warning');
      return;
    }

    try {
      const equipment = await db.get('equipments', equipmentId);
      if (!equipment) {
        throw new Error('الجهاز غير موجود');
      }

      const session = await this.setupAR();
      this.renderEquipmentAR(session, equipment);

    } catch (error) {
      console.error('فشل عرض الجهاز في الواقع المعزز:', error);
      notifications.showNotification(error.message, 'error');
    }
  }

  renderEquipmentAR(session, equipment) {
    // في تطبيق حقيقي، هنا يتم عرض الجهاز في الواقع المعزز
    console.log('عرض الجهاز في الواقع المعزز:', equipment);

    // يمكن استخدام مكتبة مثل AR.js أو Three.js
    notifications.showNotification(`جاري عرض ${equipment.name} في الواقع المعزز`, 'info');
  }

  async scanQRCode() {
    if (!this.isSupported) {
      notifications.showNotification('الماسح الضوئي غير متاح', 'warning');
      return null;
    }

    try {
      // في تطبيق حقيقي، هنا يتم استخدام API الماسح الضوئي
      const qrCode = prompt('الرجاء إدخال محتوى QR code يدوياً (للتجربة)');
      return qrCode;

    } catch (error) {
      console.error('فشل مسح QR code:', error);
      notifications.showNotification('فشل في مسح QR code', 'error');
      return null;
    }
  }

  async getEquipmentByQR() {
    const qrContent = await this.scanQRCode();
    if (!qrContent) return null;

    try {
      // البحث عن الجهاز باستخدام QR code
      const equipments = await db.getAll('equipments');
      const equipment = equipments.find(e =>
        e.qrCode === qrContent ||
        e.id.toString() === qrContent ||
        e.serialNumber === qrContent
      );

      if (!equipment) {
        throw new Error('لا يوجد جهاز مطابق لـ QR code هذا');
      }

      return equipment;

    } catch (error) {
      console.error('فشل العثور على الجهاز:', error);
      notifications.showNotification(error.message, 'error');
      return null;
    }
  }
}

// تصدير نسخة واحدة من دعم الواقع المعزز
export const arSupport = new ARSupport();