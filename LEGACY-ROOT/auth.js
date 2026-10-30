// auth.js
import { db } from './db.js';

export default class Auth {
  constructor() {
    this.form = null;
    this.errorDiv = null;
    this.usernameInput = null;
    this.passwordInput = null;
  }

  // === دالة تسجيل الدخول
  async login(username, password) {
    await db.open();
    return new Promise((resolve, reject) => {
      const tx = db.db.transaction(['users'], 'readonly');
      const store = tx.objectStore('users');
      const index = store.index('username');
      const request = index.get(username);

      request.onsuccess = async (e) => {
        const user = e.target.result;
        if (user && user.password === db.hashPassword(password)) {
          // تحديث آخر دخول
          const updateTx = db.db.transaction(['users'], 'readwrite');
          updateTx.objectStore('users').put({ ...user, lastLogin: new Date() });

          // إزالة كلمة السر من الجلسة
          const { password: _, ...userData } = user;
          localStorage.setItem('auth', JSON.stringify(userData));

          // تعيين كلاس body حسب الدور والثيم
          this.applyRoleTheme(userData.role);

          resolve(userData);
        } else {
          reject(new Error("Nom d'utilisateur ou mot de passe incorrect"));
        }
      };
      request.onerror = function () {
        reject(new Error("Erreur d'accès à la base des utilisateurs"));
      };
    });
  }

  // === التحقق من الجلسة عند تحميل الصفحة
  async checkSession() {
    const data = localStorage.getItem('auth');
    if (!data) return null;
    try {
      const user = JSON.parse(data);
      // تعيين كلاس body حسب الدور والثيم
      this.applyRoleTheme(user.role);
      return user;
    } catch {
      return null;
    }
  }

  // === تطبيق كلاس الدور والثيم على body
  applyRoleTheme(role) {
    let roleClass = "theme-visitor";
    if (role === "admin") roleClass = "theme-admin";
    else if (role === "tech") roleClass = "theme-tech";
    else if (role === "responsible") roleClass = "theme-responsible";
    else if (role === "visitor") roleClass = "theme-visitor";
    // الثيم الليلي/الفاتح
    let themeClass = (localStorage.getItem("theme") === "dark") ? "dark-theme" : "light-theme";
    document.body.className = `${roleClass} ${themeClass}`;
  }

  // === إظهار شاشة تسجيل الدخول
  showLogin() {
    document.getElementById('app').innerHTML = `
      <div id="login-box" style="max-width:360px;margin:100px auto;padding:40px 30px;background:#fff;border-radius:14px;box-shadow:0 2px 16px #e5e7e9;text-align:center;">
        <h2>2M TECH Platform</h2>
        <div id="login-error" style="display:none;color:#e74c3c;margin-bottom:12px;"></div>
        <form id="login-form">
          <div class="form-group">
            <label>Nom d'utilisateur</label>
            <input id="login-username" type="text" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label>Mot de passe</label>
            <input id="login-password" type="password" autocomplete="current-password" required>
          </div>
          <button class="btn" style="margin-top:14px;">Se connecter</button>
        </form>
      </div>
    `;
    this.form = document.getElementById('login-form');
    this.errorDiv = document.getElementById('login-error');
    this.usernameInput = document.getElementById('login-username');
    this.passwordInput = document.getElementById('login-password');
    document.getElementById('app').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    // دعم زر Enter وتسجيل الدخول
    this.form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const user = await this.login(this.usernameInput.value, this.passwordInput.value);
        this.errorDiv.style.display = 'none';
        this.hideLogin();
        window.location.reload(); // تحديث الصفحة لعرض الواجهة حسب الدور
      } catch (err) {
        this.errorDiv.textContent = err.message;
        this.errorDiv.style.display = 'block';
      }
    };

    // لدعم الوعد عند استدعاء showLogin() من core.js وغيره
    return new Promise(resolve => {
      this.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const user = await this.login(this.usernameInput.value, this.passwordInput.value);
          this.errorDiv.style.display = 'none';
          resolve(user);
        } catch (err) {
          this.errorDiv.textContent = err.message;
          this.errorDiv.style.display = 'block';
        }
      });
    });
  }

  // === إخفاء شاشة تسجيل الدخول
  hideLogin() {
    document.getElementById('app').style.display = 'none';
    document.getElementById('app').style.display = 'block';
  }

  // === رسالة نجاح مخصصة (اختياري)
  showSuccess(msg) {
    this.errorDiv.style.display = 'block';
    this.errorDiv.style.color = '#27ae60';
    this.errorDiv.textContent = msg;
    setTimeout(() => {
      this.errorDiv.style.display = 'none';
      this.errorDiv.style.color = '#e74c3c';
    }, 1500);
  }

  // === تسجيل الخروج
  logout() {
    localStorage.removeItem('auth');
    document.body.className = "theme-visitor light-theme";
    window.location.reload();
  }
}
