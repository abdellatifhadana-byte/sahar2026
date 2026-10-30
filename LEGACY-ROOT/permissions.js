/**
 * @file permissions.js - نظام إدارة الصلاحيات المتقدم
 * @description يتحكم في الوصول إلى مكونات النظام حسب الأدوار
 */

// هيكل الصلاحيات الكامل
const PERMISSIONS_MATRIX = {
  admin: {
    // إدارة النظام
    system: {
      view: true,
      configure: true,
      backup: true,
      restore: true
    },
    
    // إدارة المستخدمين
    users: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      changeRole: true,
      resetPassword: true
    },
    
    // الأجهزة
    equipments: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      changeStatus: true,
      export: true
    },
    
    // الغرف
    rooms: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      assign: true
    },
    
    // البايات
    baies: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      assign: true
    },
    
    // التقارير
    reports: {
      view: true,
      generate: true,
      export: true
    },
    
    // السجلات
    logs: {
      view: true,
      export: true,
      clear: true
    }
  },
  
  responsible: {
    system: {
      view: false,
      configure: false,
      backup: false,
      restore: false
    },
    
    users: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      changeRole: false,
      resetPassword: false
    },
    
    equipments: {
      view: true,
      create: true,
      edit: true,
      delete: false,
      changeStatus: true,
      export: false
    },
    
    rooms: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    baies: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    reports: {
      view: true,
      generate: true,
      export: false
    },
    
    logs: {
      view: true,
      export: false,
      clear: false
    }
  },
  
  technician: {
    system: {
      view: false,
      configure: false,
      backup: false,
      restore: false
    },
    
    users: {
      view: false,
      create: false,
      edit: false,
      delete: false,
      changeRole: false,
      resetPassword: false
    },
    
    equipments: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      changeStatus: true,
      export: false
    },
    
    rooms: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    baies: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    reports: {
      view: false,
      generate: false,
      export: false
    },
    
    logs: {
      view: false,
      export: false,
      clear: false
    }
  },
  
  visitor: {
    system: {
      view: false,
      configure: false,
      backup: false,
      restore: false
    },
    
    users: {
      view: false,
      create: false,
      edit: false,
      delete: false,
      changeRole: false,
      resetPassword: false
    },
    
    equipments: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      changeStatus: false,
      export: false
    },
    
    rooms: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    baies: {
      view: true,
      create: false,
      edit: false,
      delete: false,
      assign: false
    },
    
    reports: {
      view: false,
      generate: false,
      export: false
    },
    
    logs: {
      view: false,
      export: false,
      clear: false
    }
  }
};

class PermissionManager {
  /**
   * التحقق من الصلاحية
   * @param {object} user - بيانات المستخدم
   * @param {string} entity - الكيان (users, equipments, etc.)
   * @param {string} action - الإجراء (view, create, etc.)
   */
  static check(user, entity, action) {
    if (!user || !user.role) return false;
    
    const rolePermissions = PERMISSIONS_MATRIX[user.role];
    if (!rolePermissions) return false;
    
    return rolePermissions[entity]?.[action] || false;
  }

  /**
   * الحصول على جميع الصلاحيات لدور معين
   * @param {string} role - الدور المطلوب
   */
  static getRolePermissions(role) {
    return PERMISSIONS_MATRIX[role] || {};
  }

  /**
   * تحديث الصلاحيات لدور معين
   * @param {string} role - الدور
   * @param {string} entity - الكيان
   * @param {string} action - الإجراء
   * @param {boolean} value - القيمة الجديدة
   */
  static updatePermission(role, entity, action, value) {
    if (PERMISSIONS_MATRIX[role] && PERMISSIONS_MATRIX[role][entity]) {
      PERMISSIONS_MATRIX[role][entity][action] = value;
      return true;
    }
    return false;
  }

  /**
   * إنشاء دور مخصص جديد
   * @param {string} roleName - اسم الدور الجديد
   * @param {object} permissions - الصلاحيات المخصصة
   */
  static createCustomRole(roleName, permissions) {
    if (PERMISSIONS_MATRIX[roleName]) {
      return false; // الدور موجود بالفعل
    }
    
    PERMISSIONS_MATRIX[roleName] = permissions;
    return true;
  }
}

/**
 * دالة مختصرة للتحقق من الصلاحية مباشرة (للاستخدام في الواجهة)
 * @param {string} role - دور المستخدم
 * @param {string} entity - الكيان (مثلاً 'system', 'users', ...)
 * @param {string} action - الإجراء (مثلاً 'backup', 'view', ...)
 * @returns {boolean}
 */
function checkPermission(role, entity, action) {
  if (!role) return false;
  const rolePermissions = PERMISSIONS_MATRIX[role];
  if (!rolePermissions) return false;
  return !!(rolePermissions[entity] && rolePermissions[entity][action]);
}

// صدّرها للاستيراد في باقي الملفات
export { PermissionManager, checkPermission };