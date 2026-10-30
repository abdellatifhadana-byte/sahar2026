// logs.js — نظام السجلات (Logs) الاحترافي 2025
import { db } from './db.js';

/**
 * إضافة سجل جديد (log) لأي حدث في المنصة
 * @param {string} type - نوع السجل: ('equipment', 'user', 'ticket', ...)
 * @param {string} action - الإجراء: ('create', 'update', 'delete', ...)
 * @param {object} details - تفاصيل إضافية للحدث
 * @param {object} user - (اختياري) معلومات المستخدم
 */
export async function addLog(type, action, details = {}, user = null) {
  const now = new Date();
  const logEntry = {
    id: Date.now(),
    type,
    action,
    details,
    username: user?.username || localStorage.getItem('auth') ? JSON.parse(localStorage.getItem('auth')).username : '',
    fullName: user?.fullName || '',
    timestamp: now.getTime(),
    dateStr: now.toLocaleString()
  };
  await db.save('logs', logEntry);
}

/**
 * جلب آخر N من السجلات (مُرتبة من الأحدث)
 * @param {number} limit - الحد الأعلى (افتراضي: 50)
 * @returns {Array} - مصفوفة السجلات
 */
export async function getRecentLogs(limit = 50) {
  const all = await db.getAll('logs');
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * جلب السجلات حسب نوع محدد (مثلاً: فقط سجلات الأجهزة)
 * @param {string} type - 'equipment', 'user', 'ticket'...
 * @param {number} limit - الحد الأعلى
 */
export async function getLogsByType(type, limit = 30) {
  const all = await db.getAll('logs');
  return all.filter(l => l.type === type).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * جلب السجلات المتعلقة بعنصر معين (حسب الـ ID)
 * @param {string} type
 * @param {number|string} relatedId
 */
export async function getLogsForItem(type, relatedId, limit = 30) {
  const all = await db.getAll('logs');
  return all.filter(l => l.type === type && (l.details?.id === relatedId || l.details?.relatedId === relatedId))
            .sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * حذف سجل محدد
 */
export async function deleteLog(id) {
  await db.delete('logs', id);
}

/**
 * تفريغ كل السجلات
 */
export async function clearLogs() {
  const all = await db.getAll('logs');
  for (const log of all) await db.delete('logs', log.id);
}

/**
 * تصدير السجلات كملف JSON
 */
export async function exportLogs() {
  const logs = await db.getAll('logs');
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `logs-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

/**
 * استيراد السجلات من ملف JSON
 */
export async function importLogsFromFile(file) {
  const text = await file.text();
  try {
    const logs = JSON.parse(text);
    for (const log of logs) await db.save('logs', log);
    return true;
  } catch {
    return false;
  }
}

// دالة للعرض السريع (مثلاً في Popover أو Tooltip)
export function formatLogEntry(log) {
  return `
    <div>
      <b>[${log.type}] ${log.action}</b> — 
      <span style="color:#888">${log.dateStr || new Date(log.timestamp).toLocaleString()}</span><br>
      ${log.details && Object.keys(log.details).length
        ? Object.entries(log.details).map(([k, v]) => `<span><b>${k}:</b> ${JSON.stringify(v)}</span>`).join(' | ')
        : '<span style="color:#bbb">-</span>'
      }
    </div>
  `;
}

// سجل صغير (آخر 3 أو 5 أحداث متعلقة)
export async function getMiniLog(type, relatedId, count = 5) {
  const all = await getLogsForItem(type, relatedId, count);
  return all.map(l => ({
    action: l.action,
    date: l.dateStr,
    user: l.fullName || l.username || '',
    details: l.details
  }));
}

// سجل حدث من المنصة/AI/حل تلقائي
export async function logAIAction(context, result, user) {
  await addLog('ai', 'suggestion', { context, result }, user);
}

// دالة مساعدة لتوليد وصف مبسط للسجل (للإحصائيات أو عرض سريع)
export function logLabel(log) {
  return `[${log.type}] ${log.action} ${log.details?.name ? ' - ' + log.details.name : ''}`;
}

