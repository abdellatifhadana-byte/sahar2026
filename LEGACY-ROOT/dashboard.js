import { db } from './db.js';

export default class Dashboard {
  constructor(container, router = null) {
    this.container = container;
    this.router = router;
    this.container.innerHTML = `<div class="dashboard-loading">تحميل البيانات...</div>`;
    setTimeout(() => this.render(), 150); // slight delay for effect
  }

  async render() {
    try {
      // جلب جميع البيانات دفعة واحدة
      const [equipments, rooms, baies, users, notifications, logs, tickets] = await Promise.all([
        db.getAll('equipments').catch(()=>[]),
        db.getAll('rooms').catch(()=>[]),
        db.getAll('baies').catch(()=>[]),
        db.getAll('users').catch(()=>[]),
        db.getAll('notifications').catch(()=>[]),
        db.getAll('logs').catch(()=>[]),
        db.getAll('tickets').catch(()=>[])
      ]);
      // إحصائيات الأجهزة
      const active = equipments.filter(e => ['actif','active'].includes((e.status||'').toLowerCase())).length;
      const maintenance = equipments.filter(e => (e.status||'').toLowerCase() === 'maintenance').length;
      const faulty = equipments.filter(e => ['hors-service','faulty','hs'].includes((e.status||'').toLowerCase())).length;
      // ترتيب الغرف الأكثر ازدحاماً (Top5)
      const roomsStats = rooms
        .map(r => ({
          ...r,
          equipments: equipments.filter(e => e.roomId == r.id).length,
          baies: baies.filter(b => b.roomId == r.id).length
        }))
        .sort((a,b) => b.equipments - a.equipments).slice(0,5);

      // أحدث 8 نشاطات
      const recentLogs = [...logs].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0,8);

      // أحدث التذاكر (5)
      const recentTickets = [...tickets].sort((a,b) => new Date(b.createdAt||b.timestamp) - new Date(a.createdAt||a.timestamp)).slice(0,5);

      // الإشعارات الغير مقروءة
      const unreadNotifs = notifications.filter(n => !n.read);

      // واجهة الداشبورد
      this.container.innerHTML = `
        <div class="dashboard-main">
          <div class="dashboard-cards">
            <div class="stat-card clickable" data-goto="equipments"><div class="stat-icon bg-blue"><i class="fas fa-server"></i></div><div class="stat-info"><h3>${equipments.length}</h3><p>جميع الأجهزة</p></div></div>
            <div class="stat-card clickable" data-goto="equipments?status=active"><div class="stat-icon bg-green"><i class="fas fa-check-circle"></i></div><div class="stat-info"><h3>${active}</h3><p>أجهزة شغالة</p></div></div>
            <div class="stat-card clickable" data-goto="equipments?status=maintenance"><div class="stat-icon bg-orange"><i class="fas fa-tools"></i></div><div class="stat-info"><h3>${maintenance}</h3><p>تحت الصيانة</p></div></div>
            <div class="stat-card clickable" data-goto="equipments?status=faulty"><div class="stat-icon bg-danger"><i class="fas fa-times-circle"></i></div><div class="stat-info"><h3>${faulty}</h3><p>معطلة</p></div></div>
            <div class="stat-card clickable" data-goto="salles"><div class="stat-icon bg-purple"><i class="fas fa-building"></i></div><div class="stat-info"><h3>${rooms.length}</h3><p>غرف تقنية</p></div></div>
            <div class="stat-card clickable" data-goto="baies"><div class="stat-icon bg-red"><i class="fas fa-network-wired"></i></div><div class="stat-info"><h3>${baies.length}</h3><p>Baies</p></div></div>
            <div class="stat-card clickable" data-goto="users"><div class="stat-icon bg-teal"><i class="fas fa-users"></i></div><div class="stat-info"><h3>${users.length}</h3><p>مستخدمين</p></div></div>
            <div class="stat-card clickable" data-goto="notifications"><div class="stat-icon bg-gray"><i class="fas fa-bell"></i></div><div class="stat-info"><h3>${unreadNotifs.length}</h3><p>إشعارات جديدة</p></div></div>
            <div class="stat-card clickable" data-goto="tickets"><div class="stat-icon bg-yellow"><i class="fas fa-ticket-alt"></i></div><div class="stat-info"><h3>${tickets.length}</h3><p>تذاكر الدعم</p></div></div>
          </div>
          <div class="dashboard-flex">
            <div class="dashboard-section">
              <div class="dashboard-title"><i class="fas fa-chart-pie"></i> حالة الأجهزة</div>
              <canvas id="equipments-status-chart" width="220" height="220"></canvas>
              <div class="dashboard-legend">
                <span><span class="legend-dot" style="background:#27ae60"></span>شغالة</span>
                <span><span class="legend-dot" style="background:#f39c12"></span>صيانة</span>
                <span><span class="legend-dot" style="background:#e74c3c"></span>معطلة</span>
              </div>
            </div>
            <div class="dashboard-section">
              <div class="dashboard-title"><i class="fas fa-history"></i> آخر الأنشطة</div>
              <div class="activity-list">
                ${recentLogs.length === 0 ? '<p class="empty-note">لا يوجد نشاطات حديثة.</p>' :
                  recentLogs.map(log => `
                    <div class="activity-item">
                      <div class="activity-icon"><i class="fas fa-bolt"></i></div>
                      <div class="activity-details">
                        <p>${log.action || log.details || '—'}</p>
                        <small>${new Date(log.timestamp).toLocaleString()} (${log.username || log.userId || ''})</small>
                      </div>
                    </div>
                  `).join('')}
              </div>
            </div>
            <div class="dashboard-section">
              <div class="dashboard-title"><i class="fas fa-ticket-alt"></i> أحدث التذاكر</div>
              <div class="tickets-list">
                ${recentTickets.length === 0 ? '<p class="empty-note">لا توجد تذاكر.</p>' :
                  recentTickets.map(tk => `
                    <div class="ticket-item">
                      <i class="fas fa-tag"></i>
                      <b>${tk.title || 'تذكرة دعم'}</b>
                      <span class="status-badge ${tk.status||'open'}">${tk.status||'Ouverte'}</span>
                      <small>${new Date(tk.createdAt||tk.timestamp).toLocaleString()}</small>
                    </div>
                  `).join('')}
              </div>
            </div>
          </div>
          <div class="dashboard-rooms-bar">
            <div class="dashboard-title"><i class="fas fa-building"></i> أكثر الغرف ازدحاماً بالأجهزة</div>
            <div class="rooms-stats-list">
              ${roomsStats.length ? roomsStats.map(room => `
                <div class="room-stat-card clickable" data-goto="salles/${room.id}">
                  <span class="room-name">${room.name}</span>
                  <span class="room-equip"><i class="fas fa-server"></i> ${room.equipments} جهاز</span>
                  <span class="room-baie"><i class="fas fa-network-wired"></i> ${room.baies} Baies</span>
                </div>
              `).join('') : '<p class="empty-note">لا توجد غرف بعد.</p>'}
            </div>
          </div>
        </div>
      `;
      // رسم الرسم البياني الدائري
      this.renderEquipmentsChart(active, maintenance, faulty);

      // تفعيل التنقل عبر الكروت
      this.container.querySelectorAll('.clickable[data-goto]').forEach(el => {
        el.onclick = () => {
          const goto = el.getAttribute('data-goto');
          if (this.router && typeof this.router.navigate === 'function') this.router.navigate(goto);
          else location.hash = `#/${goto}`;
        };
      });
      this.container.querySelectorAll('.room-stat-card').forEach(el => {
        el.onclick = () => {
          const goto = el.getAttribute('data-goto');
          if (this.router && typeof this.router.navigate === 'function') this.router.navigate(goto);
          else location.hash = `#/${goto}`;
        };
      });
    } catch (e) {
      this.container.innerHTML = `<div style="color:#e74c3c; text-align:center; padding: 80px 0;">
        <b>تعذر تحميل لوحة البيانات.</b><br>${e.message || e}
      </div>`;
      console.error(e);
    }
  }

  renderEquipmentsChart(active, maintenance, faulty) {
    const canvas = document.getElementById('equipments-status-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = 220;
    const data = [active, maintenance, faulty];
    const colors = ['#27ae60', '#f39c12', '#e74c3c'];
    const total = data.reduce((a, b) => a + b, 0) || 1;
    let startAngle = -0.5 * Math.PI;
    for (let i = 0; i < data.length; i++) {
      const sliceAngle = (data[i] / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(110, 110);
      ctx.arc(110, 110, 90, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = 0.93;
      ctx.fill();
      ctx.globalAlpha = 1.0;
      startAngle += sliceAngle;
    }
    // وسط الدائرة رقم الإجمالي
    ctx.beginPath();
    ctx.arc(110, 110, 60, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.font = "bold 32px Segoe UI";
    ctx.fillStyle = "#2874a6";
    ctx.textAlign = "center";
    ctx.fillText(total, 110, 122);
  }
}
