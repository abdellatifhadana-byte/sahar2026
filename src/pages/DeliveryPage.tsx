import { useState } from 'react';
import { useStore } from '../store';
import { Truck, Plus, Trash2, Eye, EyeOff, CheckCircle, AlertTriangle, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { DeliveryProviderConfig } from '../types';

const TEMPLATES = [
  { name: 'Amana', logo: '📦', url: 'https://www.amana.ma', loginUrl: 'https://www.amana.ma/auth', addOrder: 'https://www.amana.ma/orders/create', guide: 'أنشئ حساباً تجارياً على amana.ma' },
  { name: 'Jibli Maroc', logo: '🚚', url: 'https://app.jibli.ma', loginUrl: 'https://app.jibli.ma/auth/login', addOrder: 'https://app.jibli.ma/shipments/create', guide: 'سجل على jibli.ma كبائع' },
  { name: 'Naqel', logo: '⚡', url: 'https://www.naqelexpress.com', loginUrl: 'https://merchant.naqelexpress.com/login', addOrder: '', guide: 'أنشئ حساب تاجر على naqelexpress.com' },
  { name: 'أخرى', logo: '🏢', url: '', loginUrl: '', addOrder: '', guide: 'أدخل بيانات شركتك يدوياً' },
];

const EMPTY: Partial<DeliveryProviderConfig> = { name: '', logo: '🚚', websiteUrl: '', loginUrl: '', username: '', password: '', addOrderPage: '', livraisonBonPage: '', ramassagePage: '', enabled: true, mode: 'browser', fields: { packageNumber: 'رقم الحزمة', recipientName: 'اسم المرسل إليه', address: 'العنوان', phone: 'رقم الهاتف', notes: 'ملاحظات', citySelector: 'اختيار المدينة', priceField: 'ثمن التوصيل' } };

export default function DeliveryPage() {
  const { settings, updateSettings, notify } = useStore();
  const [showAdd, setShowAdd] = useState(false);

  const [config, setConfig] = useState<Partial<DeliveryProviderConfig>>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const providers = settings.delivery.providers;

  const applyTpl = (t: typeof TEMPLATES[0]) => setConfig(p => ({ ...p, name: t.name, logo: t.logo, websiteUrl: t.url, loginUrl: t.loginUrl, addOrderPage: t.addOrder }));

  const save = () => {
    if (!config.name || !config.loginUrl || !config.username || !config.password) { notify('error', 'يرجى ملء: الاسم، رابط الدخول، المستخدم، كلمة المرور'); return; }
    const np: DeliveryProviderConfig = { id: `DEL-${Date.now()}`, name: config.name!, logo: config.logo || '🚚', enabled: true, mode: config.mode || 'browser', websiteUrl: config.websiteUrl || '', loginUrl: config.loginUrl!, username: config.username!, password: config.password!, addOrderPage: config.addOrderPage || '', livraisonBonPage: config.livraisonBonPage || '', ramassagePage: config.ramassagePage || '', apiKey: '', apiEndpoint: '', fields: config.fields as any };
    updateSettings('delivery', { ...settings.delivery, providers: [...providers, np], defaultProvider: np.name });
    notify('success', `✅ تم إضافة ${config.name}`);
    setShowAdd(false); setConfig(EMPTY);
  };

  const remove = (id: string) => { updateSettings('delivery', { ...settings.delivery, providers: providers.filter(p => p.id !== id) }); notify('warning', '🗑️ تم الحذف'); };

  const testConn = async (prov: DeliveryProviderConfig) => {
    notify('info', `⏳ اختبار ${prov.name}...`);
    try {
      if (prov.websiteUrl) {
        const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(prov.websiteUrl)}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { notify('success', `✅ ${prov.name} يستجيب`); return; }
      }
      notify('success', `✅ إعدادات ${prov.name} محفوظة`);
    } catch { notify('warning', `⚠️ لم يمكن الوصول لـ ${prov.name}`); }
  };

  const Input = ({ label, value, onChange, ph, dir = 'ltr', secret = false }: any) => {
    const [show, setShow] = useState(false);
    return (
      <div>
        <label className="label">{label}</label>
        <div style={{ position: 'relative' }}>
          <input className="input" type={secret && !show ? 'password' : 'text'} placeholder={ph} value={value} onChange={e => onChange(e.target.value)} dir={dir} style={{ paddingLeft: secret ? 40 : 14, fontSize: 13.5, fontFamily: 'monospace' }} />
          {secret && <button onClick={() => setShow(!show)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--txt-3)', cursor: 'pointer' }}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">شركات التوصيل</h1>
          <p className="page-sub">إعداد شركات التوصيل — النظام يملأ الطلبات تلقائياً</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary"><Plus size={16} /> إضافة شركة</button>
      </div>

      {/* How it works */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Truck size={16} color="var(--clr-accent)" /> كيف يشتغل تلقائياً؟
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {['يفتح الموقع', 'يسجل الدخول', 'يملأ البيانات', 'يختار المدينة', 'ينشئ الطلب', 'يرجع التتبع'].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.12))', border: '1px solid rgba(99,102,241,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: 'var(--clr-pri-h)', margin: '0 auto 5px' }}>{i+1}</div>
                <p style={{ fontSize: 10, color: 'var(--txt-3)', whiteSpace: 'nowrap', fontWeight: 700 }}>{s}</p>
              </div>
              {i < 5 && <div style={{ width: 20, height: 1.5, background: 'var(--clr-border)', flexShrink: 0, marginBottom: 14 }} />}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={14} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: 'rgba(251,191,36,0.75)', lineHeight: 1.5 }}>الأتمتة الكاملة تحتاج Backend Server. الإعدادات الحالية تحفظ البيانات جاهزة.</p>
        </div>
      </div>

      {/* Auto settings */}
      <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { l: 'إرسال تلقائي للتوصيل عند الموافقة', k: 'autoSendOnApproval' },
          { l: 'إشعار الزبون عند الشحن', k: 'notifyCustomerOnShip' },
        ].map(item => (
          <div key={item.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderRadius: 11, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt-1)' }}>{item.l}</p>
            <button onClick={() => updateSettings('delivery', { ...settings.delivery, [item.k]: !(settings.delivery as any)[item.k] })}
              className={`toggle ${(settings.delivery as any)[item.k] ? 'on' : ''}`} />
          </div>
        ))}
      </div>

      {/* Providers */}
      {providers.length === 0 ? (
        <div className="card" style={{ padding: '60px 24px', textAlign: 'center' }}>
          <Truck size={48} style={{ opacity: .2, marginBottom: 12 }} />
          <p style={{ color: 'var(--txt-2)', fontWeight: 700, marginBottom: 16 }}>لم تضف شركة توصيل بعد</p>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary" style={{ margin: '0 auto' }}><Plus size={16} /> إضافة</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map(p => (
            <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 18px', cursor: 'pointer' }} onClick={() => setSelected(selected === p.id ? null : p.id)}>
                <span style={{ fontSize: 26, flexShrink: 0 }}>{p.logo}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--txt-1)' }}>{p.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--txt-3)' }}>{p.websiteUrl || 'لا يوجد رابط'} · {p.mode === 'api' ? 'API' : 'Browser'}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); testConn(p); }} className="btn btn-ghost btn-sm" style={{ gap: 5 }}><Zap size={13} /> اختبار</button>
                  <button onClick={e => { e.stopPropagation(); remove(p.id); }} className="btn btn-danger btn-sm" style={{ paddingInline: 10 }}><Trash2 size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); updateSettings('delivery', { ...settings.delivery, providers: providers.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x) }); }} className={`toggle ${p.enabled ? 'on' : ''}`} />
                </div>
                {selected === p.id ? <ChevronUp size={15} color="var(--txt-3)" /> : <ChevronDown size={15} color="var(--txt-3)" />}
              </div>
              {selected === p.id && (
                <div className="anim-fade-in" style={{ borderTop: '1px solid var(--clr-border)', padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[['رابط الدخول', p.loginUrl], ['صفحة الطلب', p.addOrderPage], ['Bon Livraison', p.livraisonBonPage], ['Ramassage', p.ramassagePage]].map(([l, v]) => v ? (
                    <div key={l} style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--clr-border)' }}>
                      <p style={{ fontSize: 10.5, color: 'var(--txt-3)', fontWeight: 700, marginBottom: 3 }}>{l}</p>
                      <p style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'var(--txt-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</p>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => { setShowAdd(false); setConfig(EMPTY); }}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--clr-border)' }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--txt-1)' }}>إضافة شركة توصيل</h2>
              <button onClick={() => { setShowAdd(false); setConfig(EMPTY); }} style={{ background: 'none', border: 'none', color: 'var(--txt-3)', cursor: 'pointer', fontSize: 22 }}>✕</button>
            </div>
            <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Templates */}
              <div>
                <label className="label">اختر شركة معروفة</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {TEMPLATES.map(t => (
                    <button key={t.name} onClick={() => applyTpl(t)}
                      style={{ padding: '12px 8px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${config.name === t.name ? 'rgba(99,102,241,0.45)' : 'var(--clr-border)'}`, background: config.name === t.name ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: 22, marginBottom: 5 }}>{t.logo}</div>
                      <p style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--txt-2)' }}>{t.name}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode */}
              <div>
                <label className="label">نوع الربط</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                   {(['browser','api'] as const).map(m => (
                     <button key={m} onClick={() => setConfig(p => ({ ...p, mode: m }))}
                       style={{ padding: '11px', borderRadius: 11, fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${config.mode === m ? 'rgba(99,102,241,0.45)' : 'var(--clr-border)'}`, background: config.mode === m ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)', color: config.mode === m ? 'var(--clr-pri-h)' : 'var(--txt-3)' }}>
                       {m === 'browser' ? '🌐 Browser' : '⚡ API'}
                     </button>
                   ))}
                </div>
              </div>

              {/* Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="اسم الشركة *" value={config.name || ''} onChange={(v: string) => setConfig(p => ({ ...p, name: v }))} ph="Amana Livraison" dir="rtl" />
                <Input label="رابط الموقع" value={config.websiteUrl || ''} onChange={(v: string) => setConfig(p => ({ ...p, websiteUrl: v }))} ph="https://..." />
                <div style={{ gridColumn: '1/-1' }}>
                  <Input label="رابط صفحة تسجيل الدخول *" value={config.loginUrl || ''} onChange={(v: string) => setConfig(p => ({ ...p, loginUrl: v }))} ph="https://.../login" />
                </div>
                <Input label="اسم المستخدم / البريد *" value={config.username || ''} onChange={(v: string) => setConfig(p => ({ ...p, username: v }))} ph="email@..." />
                <Input label="كلمة المرور *" value={config.password || ''} onChange={(v: string) => setConfig(p => ({ ...p, password: v }))} ph="••••••••" secret />
                <div style={{ gridColumn: '1/-1' }}>
                  <Input label="📦 صفحة إضافة طلب" value={config.addOrderPage || ''} onChange={(v: string) => setConfig(p => ({ ...p, addOrderPage: v }))} ph="https://.../new" />
                </div>
                <Input label="📋 Bon de Livraison" value={config.livraisonBonPage || ''} onChange={(v: string) => setConfig(p => ({ ...p, livraisonBonPage: v }))} ph="https://..." />
                <Input label="🚚 Demande Ramassage" value={config.ramassagePage || ''} onChange={(v: string) => setConfig(p => ({ ...p, ramassagePage: v }))} ph="https://..." />
              </div>

              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button onClick={() => { setShowAdd(false); setConfig(EMPTY); }} className="btn btn-ghost" style={{ paddingInline: 20 }}>إلغاء</button>
                <button onClick={save} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  <CheckCircle size={16} /> حفظ شركة التوصيل
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
