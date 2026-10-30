import { db } from './db.js';

/**
 * الحصول على المستخدم الحالي من التخزين المحلي
 */
export function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('auth')) || null;
    } catch {
        return null;
    }
}

/**
 * تسجيل أي عملية في سجل النظام
 * @param {string} type - نوع العملية
 * @param {string} details - التفاصيل
 * @param {object|null} userOverride - بيانات مستخدم مخصصة (اختياري)
 */
export async function logAction(type, details, userOverride = null) {
    const user = userOverride || getCurrentUser() || {};
    try {
        if (db.db && db.db.logs && db.db.logs.add) {
            await db.db.logs.add({
                type,
                userId: user.id || null,
                username: user.username || 'system',
                details,
                date: new Date(),
                ipAddress: ''
            });
        }
    } catch (error) {
        console.error('Failed to log action:', error);
    }
}

/**
 * جميع الأدوار المتاحة بالنظام
 */
export const ROLES = {
    ADMIN: 'admin',
    TECHNICIAN: 'technician',
    USER: 'user'
};

/**
 * التحقق من صلاحيات المستخدم
 * @param {string} userRole - دور المستخدم
 * @param {string} requiredRole - الحد الأدنى للصلاحية
 * @returns {boolean}
 */
export function checkPermission(userRole, requiredRole) {
    if (!userRole) return false;
    const roleHierarchy = {
        [ROLES.ADMIN]: 3,
        [ROLES.TECHNICIAN]: 2,
        [ROLES.USER]: 1
    };
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * توليد كلمة سر قوية عشوائية
 * @param {number} length - الطول (افتراضي 12)
 * @returns {string}
 */
export function generatePassword(length = 12) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
    let pwd = '';
    for (let i = 0; i < length; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
}
