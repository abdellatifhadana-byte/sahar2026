import { useState } from 'react';
import { useStore } from '../store';
import { BellRing, Send, Users, Trash2, MessageCircle, CheckCircle, Loader2 } from 'lucide-react';

type BType = 'new_product' | 'discount' | 'custom';

export default function NotificationsPage() {
  const { customers, products, auditLogs, notifications, clearNotifications, markNotifRead, notify, settings, updateSettings } = useStore();
  const [bType, setBType] = useState<BType>('new_product');
  const [target, setTarget] = useState<'all' | 'vip' | 'repeat'>('all');
  const [customMsg, setCustomMsg] = useState('');
  const [prod, setProd] = useState(products[0]?.id || '');
  const [disc, setDisc] = useState(15);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const { currency } = settings.brand;
  const published = products.filter(p => p.status === 'published');
  const targets = target === 'all' ? customers : target === 'vip' ? customers.filter(c => c.vip) : customers.filter(c => c.totalOrders >= 3);

  const buildMsg = () => {
    if (bType === 'custom') return customMsg;
    const p = products.find(x => x.id === prod);
    if (!p) return '';
    if (bType === 'new_product') return `🎉 منتج جديد!\n\n${p.emoji} ${p.name}\n💰 ${p.price} ${currency}\n\nطلب الآن 🚚`;
    const np = Math.round(p.price * (1 - disc / 100));
    return `🔥 عرض خاص!\n\n${p.emoji} ${p.name}\n~~${p.price}~~ → ${np} ${currency} (-${disc}%)\n\nلفترة محدودة! ⏰`;
  };

  const sendBcast = async () => {
    const msg = buildMsg(); if (!msg.trim()) { notify('error', 'الرسالة فارغة'); return; }
    if (targets.length === 0) { notify('error', 'لا يوجد زبائن'); return; }
    setSending(true); setSent(null);
    await new Promise(r => setTimeout(r, 1500));
    setSent(targets.length);
    notify('success', `✅ تم الإرسال لـ ${targets.length} زبون${!settings.social.whatsapp.connected ? ' (محاكاة)' : ''}`);
    setSending(false);
  };

  const typeOpts: { v: BType; l: string; d: string }[] = [
    { v: 'new_product', l: '📦 منتج جديد', d: 'أخبر زبائنك عن آخر إضافة' },
    { v: 'discount', l: '🔥 عرض خاص', d: 'خصم مغري على منتج معين' },
    { v: 'custom', l: '✏️ رسالة مخصصة', d: 'اكتب رسالتك بنفسك' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 className="page-title">الإشعارات</h1>
        <p className="page-sub">إرسال رسائل للزبائن وإدارة التنبيهات</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Broadcast */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Send size={16} color="var(--clr-ok)" /> إرسال إشعار للزبائن
              </h2>
              <p style={{ fontSize: 12, color: settings.social.whatsapp.connected ? '#34d399' : 'var(--clr-warn)' }}>
                {settings.social.whatsapp.connected ? '✅ WhatsApp متصل — إرسال حقيقي' : '⚠️ WhatsApp غير متصل — محاكاة'}
              </p>
            </div>

            {/* Type */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="label">نوع الإشعار</label>
              {typeOpts.map(opt => (
                <button key={opt.v} onClick={() => setBType(opt.v)}
                  style={{ padding: '11px 14px', borderRadius: 12, textAlign: 'right', cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${bType === opt.v ? 'rgba(99,102,241,0.4)' : 'var(--clr-border)'}`, background: bType === opt.v ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--txt-1)' }}>{opt.l}</p>
                  <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 2 }}>{opt.d}</p>
                </button>
              ))}
            </div>

            {/* Product */}
            {bType !== 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="label">المنتج</label>
                  <select className="select" value={prod} onChange={e => setProd(e.target.value)}>
                    {published.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name} — {p.price} {currency}</option>)}
                  </select>
                </div>
                {bType === 'discount' && (
                  <div>
                    <label className="label">الخصم: {disc}%</label>
                    <input type="range" min={5} max={50} value={disc} onChange={e => setDisc(parseInt(e.target.value))} style={{ width: '100%', accentColor: 'var(--clr-accent)' }} />
                  </div>
                )}
              </div>
            )}

            {bType === 'custom' && (
              <div>
                <label className="label">الرسالة</label>
                <textarea className="textarea" rows={3} placeholder="اكتب رسالتك..." value={customMsg} onChange={e => setCustomMsg(e.target.value)} />
              </div>
            )}

            {/* Preview */}
            {buildMsg() && (
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p style={{ fontSize: 11, color: '#34d399', fontWeight: 800, marginBottom: 6 }}>معاينة الرسالة:</p>
                <p style={{ fontSize: 13, color: 'var(--txt-2)', whiteSpace: 'pre-line', lineHeight: 1.7 }}>{buildMsg()}</p>
              </div>
            )}

            {/* Target */}
            <div>
              <label className="label flex items-center gap-2"><Users size={13} /> المستهدفون</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {[
                  { k: 'all' as const, l: `الكل (${customers.length})` },
                  { k: 'vip' as const, l: `VIP (${customers.filter(c => c.vip).length})` },
                  { k: 'repeat' as const, l: `متكرر (${customers.filter(c => c.totalOrders >= 3).length})` },
                ].map(t => (
                  <button key={t.k} onClick={() => setTarget(t.k)}
                    style={{ padding: '9px 6px', borderRadius: 10, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', transition: 'all .15s', border: `1.5px solid ${target === t.k ? 'rgba(249,115,22,0.4)' : 'var(--clr-border)'}`, background: target === t.k ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.03)', color: target === t.k ? 'var(--clr-accent-h)' : 'var(--txt-3)' }}>
                    {t.l}
                  </button>
                ))}
              </div>
            </div>

            {sent !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <CheckCircle size={15} color="#34d399" />
                <p style={{ fontSize: 13, color: '#34d399', fontWeight: 700 }}>تم الإرسال لـ {sent} زبون</p>
              </div>
            )}

            <button onClick={sendBcast} disabled={sending} className="btn btn-accent" style={{ justifyContent: 'center' }}>
              {sending ? <><Loader2 size={16} className="spin" /> جارٍ الإرسال...</> : <><Send size={16} /> إرسال لـ {targets.length} زبون</>}
            </button>
          </div>

          {/* Auto notifs */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <h2 style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BellRing size={15} color="var(--clr-pri-h)" /> إشعارات تلقائية
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { l: '🛒 طلب جديد', k: 'newOrder' },
                { l: '💬 رسالة جديدة', k: 'newMessage' },
                { l: '⚠️ مخزون منخفض', k: 'lowStock' },
                { l: '🚚 عند الشحن', k: 'orderShipped' },
                { l: '🔊 صوت تنبيه', k: 'sound' },
              ].map(item => (
                <div key={item.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderRadius: 11, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--txt-1)' }}>{item.l}</p>
                  <button onClick={() => updateSettings('notifs', { ...settings.notifs, [item.k]: !(settings.notifs as any)[item.k] })}
                    className={`toggle ${(settings.notifs as any)[item.k] ? 'on' : ''}`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* App Notifications */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <BellRing size={15} color="var(--clr-pri-h)" /> الإشعارات
                {notifications.filter(n => !n.read).length > 0 && (
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--clr-pri)', color: '#fff', fontSize: 10, fontWeight: 900 }}>
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </h2>
              {notifications.length > 0 && (
                <button onClick={clearNotifications} className="btn btn-ghost btn-sm"><Trash2 size={13} /></button>
              )}
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--txt-3)' }}>
                  <BellRing size={28} style={{ marginBottom: 6, opacity: .2 }} />
                  <p style={{ fontSize: 13 }}>لا إشعارات</p>
                </div>
              ) : notifications.map(n => (
                <button key={n.id} onClick={() => markNotifRead(n.id)} className={`toast toast-${n.type}`}
                  style={{ opacity: n.read ? .5 : 1, cursor: 'pointer', fontSize: 12.5, padding: '10px 13px', animation: 'none' }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{n.type === 'success' ? '✅' : n.type === 'error' ? '❌' : n.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{n.message}</span>
                  {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--clr-pri)', flexShrink: 0 }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Audit log */}
          <div className="card" style={{ padding: '18px 20px', flex: 1 }}>
            <h2 style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageCircle size={15} color="#a855f7" /> سجل النشاطات
            </h2>
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {auditLogs.slice(0, 20).map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 10, transition: 'background .15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{log.type === 'order' ? '🛒' : log.type === 'product' ? '📦' : log.type === 'ai' ? '🤖' : log.type === 'delivery' ? '🚚' : '⚙️'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12.5, color: 'var(--txt-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.action}</p>
                    {log.details && <p style={{ fontSize: 11, color: 'var(--txt-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.details}</p>}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--txt-3)', flexShrink: 0 }}>{log.timestamp.split(' ')[1]}</span>
                </div>
              ))}
              {auditLogs.length === 0 && <p style={{ fontSize: 13, color: 'var(--txt-3)', textAlign: 'center', padding: '16px 0' }}>لا نشاط بعد</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
