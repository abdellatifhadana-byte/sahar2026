import { useState } from 'react';
import { useStore } from '../store';
import type { Customer } from '../types';
import { Plus, Search, Star, Phone, MapPin, MessageCircle, Check, X } from 'lucide-react';

export default function CustomersPage() {
  const { customers, addCustomer, updateCustomer, settings } = useStore();
  const [search, setSearch] = useState('');
  const [src, setSrc] = useState('all');
  const [vipOnly, setVipOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ name: string; phone: string; city: string; address: string; source: Customer['source']; notes: string; vip: boolean }>({ name: '', phone: '', city: '', address: '', source: 'WhatsApp', notes: '', vip: false });
  const { currency } = settings.brand;

  const filtered = customers
    .filter(c => (!search || c.name.includes(search) || c.phone.includes(search) || c.city.includes(search)) && (src === 'all' || c.source === src) && (!vipOnly || c.vip))
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const total = customers.reduce((s, c) => s + c.totalSpent, 0);
  const vips = customers.filter(c => c.vip).length;
  const repeat = customers.filter(c => c.totalOrders >= 3).length;

  const save = () => {
    if (!form.name || !form.phone) return;
    addCustomer({ ...form });
    setForm({ name: '', phone: '', city: '', address: '', source: 'WhatsApp', notes: '', vip: false });
    setShowAdd(false);
  };

  const srcIcon: Record<string, string> = { WhatsApp: '💬', Instagram: '📸', Messenger: '💙', TikTok: '🎵', مباشر: '🏪' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">الزبائن</h1>
          <p className="page-sub">{customers.length} زبون · {vips} VIP</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary"><Plus size={16} /> إضافة</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[
          { e: '👥', label: 'الزبائن', val: customers.length },
          { e: '⭐', label: 'VIP', val: vips },
          { e: '🔄', label: 'متكررون (3+)', val: repeat },
          { e: '💰', label: 'إجمالي المشتريات', val: `${total.toLocaleString()} ${currency}` },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>{s.e}</span>
            <div>
              <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>{s.val}</p>
              <p style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--txt-3)', pointerEvents: 'none' }} />
          <input className="input" style={{ paddingRight: 38 }} placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="tabs scroll-x" style={{ flex: 1 }}>
            {['all','WhatsApp','Instagram','Messenger','TikTok','مباشر'].map(s => (
              <button key={s} onClick={() => setSrc(s)} className={`tab-btn ${src === s ? 'active' : ''}`} style={{ fontSize: 12.5 }}>
                {s === 'all' ? 'الكل' : `${srcIcon[s]} ${s}`}
              </button>
            ))}
          </div>
          <button onClick={() => setVipOnly(!vipOnly)}
            className="btn btn-ghost btn-sm"
            style={{ borderColor: vipOnly ? 'rgba(245,158,11,0.4)' : undefined, color: vipOnly ? '#fbbf24' : undefined, background: vipOnly ? 'rgba(245,158,11,0.1)' : undefined }}>
            ⭐ VIP {vipOnly ? 'فقط' : ''}
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(c => (
          <div key={c.id} className="card card-hover" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Avatar */}
            <div style={{ width: 46, height: 46, borderRadius: 14, background: c.vip ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : 'var(--clr-pri-g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
              {c.name[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <p style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--txt-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                {c.vip && <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', flexShrink: 0 }}>VIP</span>}
                <span style={{ fontSize: 11, color: 'var(--txt-3)', flexShrink: 0 }}>{srcIcon[c.source]} {c.source}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{c.phone}</span>
                {c.city && <span style={{ fontSize: 12, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} />{c.city}</span>}
              </div>
              {c.notes && <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 3 }}>📝 {c.notes}</p>}
            </div>
            <div style={{ textAlign: 'left', flexShrink: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>{c.totalSpent.toLocaleString()}</p>
              <p style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'left' }}>{currency} · {c.totalOrders} طلب</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {c.phone && (
                <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                  style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.25)', color: '#25d366', textDecoration: 'none' }}>
                  <MessageCircle size={15} />
                </a>
              )}
              <button onClick={() => updateCustomer(c.id, { vip: !c.vip })}
                style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.vip ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${c.vip ? 'rgba(245,158,11,0.3)' : 'var(--clr-border)'}`, color: c.vip ? '#fbbf24' : 'var(--txt-3)', cursor: 'pointer', transition: 'all .18s' }}>
                <Star size={15} />
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <img src="/empty-customers.png" alt="No Customers" style={{ width: 180, height: 140, margin: '0 auto 12px', display: 'block', opacity: 0.8 }} />
            <p style={{ color: 'var(--txt-2)', fontWeight: 700, fontSize: 18 }}>لا نتائج للبحث</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--clr-border)' }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--txt-1)' }}>إضافة زبون</h2>
              <button onClick={() => setShowAdd(false)} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--txt-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
            </div>
            <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label className="label">الاسم *</label><input className="input" placeholder="محمد العلوي" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                <div><label className="label">الهاتف *</label><input className="input" placeholder="+212 6XX" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} dir="ltr" /></div>
                <div><label className="label">المدينة</label><input className="input" placeholder="الدار البيضاء" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
                <div>
                  <label className="label">المصدر</label>
                  <select className="select" value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value as Customer['source'] }))}>
                    {['WhatsApp','Instagram','Messenger','TikTok','مباشر'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">ملاحظات</label><textarea className="textarea" rows={2} placeholder="ملاحظات..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button onClick={() => setShowAdd(false)} className="btn btn-ghost" style={{ paddingInline: 20 }}>إلغاء</button>
                <button onClick={save} disabled={!form.name || !form.phone} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  <Check size={16} /> إضافة
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
