import { useState, useCallback } from 'react';
import { useStore } from '../store';
import { Wifi, CheckCircle, Loader2, Eye, EyeOff, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { IconWhatsApp, IconFacebook, IconInstagram, IconTikTok } from '../components/icons';

const SERVICES = [
  {
    id: 'whatsapp', name: 'WhatsApp Business', Icon: IconWhatsApp, grad: 'linear-gradient(135deg,#25d366,#128C7E)', desc: 'استقبال وإرسال الرسائل تلقائياً',
    fields: [
      { key: 'phoneId', label: 'Phone Number ID', ph: '123456789012345', help: 'Meta for Developers → WhatsApp → Configuration' },
      { key: 'accessToken', label: 'Access Token', ph: 'EAAxxxxxxx...', help: 'Token الوصول الدائم من Meta Business Manager', secret: true },
    ],
    guide: ['اذهب لـ developers.facebook.com', 'أنشئ App من نوع Business', 'فعّل WhatsApp من المنتجات', 'انسخ Phone Number ID و Access Token'],
    url: 'https://business.whatsapp.com/products/business-platform',
  },
  {
    id: 'facebook', name: 'Facebook Page', Icon: IconFacebook, grad: 'linear-gradient(135deg,#1877f2,#0a4fa8)', desc: 'نشر المنتجات والرد على التعليقات',
    fields: [
      { key: 'pageId', label: 'Page ID', ph: '123456789', help: 'معرّف صفحتك من إعدادات الصفحة' },
      { key: 'accessToken', label: 'Page Access Token', ph: 'EAAxxxxxxx...', help: 'من Graph API Explorer باختيار الصفحة', secret: true },
    ],
    guide: ['اذهب لـ Graph API Explorer', 'اختر تطبيقك', 'اختر صفحتك', 'انسخ Page Access Token'],
    url: 'https://developers.facebook.com/tools/explorer',
  },
  {
    id: 'instagram', name: 'Instagram Business', Icon: IconInstagram, grad: 'linear-gradient(135deg,#e1306c,#833ab4)', desc: 'نشر Stories & Reels والرسائل المباشرة',
    fields: [
      { key: 'pageId', label: 'Instagram Account ID', ph: '17841400000000000', help: 'معرّف حساب Instagram Business' },
      { key: 'accessToken', label: 'Access Token', ph: 'EAAxxxxxxx...', help: 'نفس Token ديال Facebook', secret: true },
    ],
    guide: ['اربط Instagram بصفحة Facebook', 'اطلب Instagram Graph API', 'احصل على Account ID', 'نفس Token ديال Facebook'],
    url: 'https://developers.facebook.com/docs/instagram-api',
  },
  {
    id: 'openai', name: 'OpenAI (GPT)', icon: '🧠', grad: 'linear-gradient(135deg,#10b981,#059669)', desc: 'ردود ذكية حقيقية بدون محاكاة',
    fields: [
      { key: 'apiKey', label: 'API Key', ph: 'sk-proj-...', help: 'من platform.openai.com/api-keys', secret: true },
    ],
    guide: ['سجل على platform.openai.com', 'اذهب لـ API Keys', 'أنشئ مفتاحاً جديداً', 'انسخه هنا'],
    url: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini', name: 'Google Gemini (مجاني)', icon: '🤖', grad: 'linear-gradient(135deg,#4285f4,#ea4335)', desc: 'بديل مجاني — 15 طلب/دقيقة',
    fields: [
      { key: 'geminiKey', label: 'Gemini API Key', ph: 'AIzaSy...', help: 'من aistudio.google.com/app/apikey', secret: true },
    ],
    guide: ['اذهب لـ aistudio.google.com', 'سجل بحساب Google', 'اضغط Get API Key', 'انسخه هنا'],
    url: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'tiktok', name: 'TikTok for Business', Icon: IconTikTok, grad: 'linear-gradient(135deg,#000000,#25f4ee)', desc: 'نشر الفيديوهات وإدارة الإعلانات',
    fields: [
      { key: 'accessToken', label: 'Access Token', ph: 'act_xxxxx...', help: 'من TikTok Ads Manager', secret: true },
      { key: 'advertiserId', label: 'Advertiser ID', ph: '123456789', help: 'معرّف المعلن' },
    ],
    guide: ['اذهب لـ ads.tiktok.com', 'أنشئ حساب Ads Manager', 'اذهب إلى Tools > API', 'أنشئ Access Token'],
    url: 'https://ads.tiktok.com',
  },
];

export default function ConnectionsPage() {
  const { settings, updateSettings, notify } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const stored = (id: string, key: string) => {
    if (id === 'openai') return settings.ai.apiKey || '';
    if (id === 'gemini') return settings.ai.geminiKey || '';
    const s = settings.social[id as keyof typeof settings.social];
    return !s ? '' : key === 'pageId' || key === 'phoneId' ? (s.pageId || '') : (s.accessToken || '');
  };

  const val = (id: string, k: string) => values[id]?.[k] ?? stored(id, k);
  const setVal = (id: string, k: string, v: string) => setValues(p => ({ ...p, [id]: { ...(p[id] || {}), [k]: v } }));

  const isConnected = (id: string) => {
    if (id === 'openai') return !!settings.ai.apiKey;
    if (id === 'gemini') return !!settings.ai.geminiKey;
    return settings.social[id as keyof typeof settings.social]?.connected || false;
  };

  const connect = useCallback(async (svc: typeof SERVICES[0]) => {
    const allFilled = svc.fields.every(f => val(svc.id, f.key).trim());
    if (!allFilled) { notify('error', 'يرجى ملء جميع الحقول'); return; }
    setLoading(p => ({ ...p, [svc.id]: true }));
    let ok = false;
    try {
      if (svc.id === 'openai') {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${val('openai', 'apiKey')}` }, signal: AbortSignal.timeout(8000) });
        ok = r.ok;
        if (ok) { updateSettings('ai', { ...settings.ai, apiKey: val('openai', 'apiKey'), provider: 'openai' }); notify('success', '✅ OpenAI متصل ويعمل!'); }
        else notify('error', `❌ مفتاح غير صحيح (${(await r.json()).error?.message?.slice(0,50)})`);
      } else if (svc.id === 'gemini') {
        const k = val('gemini', 'geminiKey');
        const r = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${k}`, { signal: AbortSignal.timeout(8000) });
        ok = r.ok;
        if (ok) { updateSettings('ai', { ...settings.ai, geminiKey: k, provider: 'gemini' }); notify('success', '✅ Gemini متصل!'); }
        else notify('error', '❌ مفتاح Gemini غير صحيح');
      } else {
        const token = val(svc.id, 'accessToken'); const pageId = val(svc.id, 'pageId') || val(svc.id, 'phoneId') || '';
        try {
          const r = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`, { signal: AbortSignal.timeout(8000) });
          const d = await r.json(); ok = !d.error;
          if (ok) { updateSettings('social', { ...settings.social, [svc.id]: { ...settings.social[svc.id as keyof typeof settings.social], connected: true, pageId, accessToken: token, name: d.name || svc.name } }); notify('success', `✅ ${svc.name} متصل${d.name ? ` — ${d.name}` : ''}!`); }
          else notify('error', `❌ Token غير صحيح: ${d.error?.message?.slice(0,60)}`);
        } catch {
          updateSettings('social', { ...settings.social, [svc.id]: { ...settings.social[svc.id as keyof typeof settings.social], connected: true, pageId, accessToken: token } });
          notify('warning', '⚠️ تم الحفظ — لم يمكن التحقق (CORS). الإرسال الحقيقي يحتاج Backend.');
          ok = true;
        }
      }
    } catch (e: any) { notify('error', `❌ ${e.message || 'خطأ في الاتصال'}`); }
    setLoading(p => ({ ...p, [svc.id]: false }));
  }, [values, settings, updateSettings, notify]);

  const disconnect = (svc: typeof SERVICES[0]) => {
    if (svc.id === 'openai') updateSettings('ai', { ...settings.ai, apiKey: '' });
    else if (svc.id === 'gemini') updateSettings('ai', { ...settings.ai, geminiKey: '' });
    else updateSettings('social', { ...settings.social, [svc.id]: { ...settings.social[svc.id as keyof typeof settings.social], connected: false, pageId: '', accessToken: '' } });
    notify('warning', `🔌 تم قطع الاتصال بـ ${svc.name}`);
  };

  const connected = SERVICES.filter(s => isConnected(s.id)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 className="page-title">ربط الخدمات</h1>
        <p className="page-sub">اربط حساباتك مرة واحدة — النظام يتكفل بالباقي</p>
      </div>

      {/* Progress */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>حالة الاتصالات</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: connected === SERVICES.length ? '#34d399' : 'var(--clr-warn)' }}>{connected}/{SERVICES.length}</span>
        </div>
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${(connected / SERVICES.length) * 100}%` }} /></div>
        {connected === 0 && <p style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 8, textAlign: 'center' }}>التطبيق يعمل بمحاكاة ذكية بدون ربط — الربط للنشر الحقيقي فقط</p>}
      </div>

      {/* Services */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SERVICES.map(svc => {
          const conn = isConnected(svc.id);
          const open = expanded === svc.id;
          return (
            <div key={svc.id} className="card" style={{ overflow: 'hidden', borderColor: conn ? 'rgba(16,185,129,0.25)' : undefined }}>
              {/* Header */}
              <div onClick={() => setExpanded(open ? null : svc.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', cursor: 'pointer', transition: 'background .18s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: svc.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px rgba(0,0,0,0.3)', overflow: 'hidden', padding: 6 }}>
                  {svc.Icon ? <svc.Icon /> : <span style={{ fontSize: 22 }}>{svc.icon}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>{svc.name}</p>
                    {conn && <CheckCircle size={15} color="#34d399" />}
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--txt-3)', marginTop: 2 }}>{svc.desc}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {conn && <button onClick={e => { e.stopPropagation(); disconnect(svc); }} className="btn btn-danger btn-sm" style={{ fontSize: 12 }}>قطع</button>}
                  {loading[svc.id] ? <Loader2 size={16} className="spin" style={{ color: 'var(--clr-pri-h)' }} /> : conn ? <CheckCircle size={16} color="#34d399" /> : <Wifi size={16} color="var(--txt-3)" />}
                </div>
              </div>

              {/* Body */}
              {open && (
                <div className="anim-fade-in" style={{ borderTop: '1px solid var(--clr-border)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Guide */}
                  <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--clr-pri-h)' }}>كيف تحصل على هذه المعلومات؟</p>
                      <a href={svc.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--clr-pri-h)', textDecoration: 'none', fontWeight: 700 }}>
                        الدليل الرسمي <ExternalLink size={12} />
                      </a>
                    </div>
                    <ol style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {svc.guide.map((step, i) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', color: 'var(--clr-pri-h)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>{i+1}</span>
                          <span style={{ color: 'rgba(165,180,252,0.75)' }}>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Fields */}
                  {svc.fields.map(f => {
                    const vk = `${svc.id}-${f.key}`;
                    return (
                      <div key={f.key}>
                        <label className="label">{f.label}</label>
                        <div style={{ position: 'relative' }}>
                          <input type={(f as any).secret && !visible[vk] ? 'password' : 'text'}
                            className="input" style={{ paddingLeft: (f as any).secret ? 42 : 14, fontFamily: 'monospace', fontSize: 13 }}
                            placeholder={f.ph} value={val(svc.id, f.key)} onChange={e => setVal(svc.id, f.key, e.target.value)} dir="ltr" />
                          {(f as any).secret && (
                            <button onClick={() => setVisible(p => ({ ...p, [vk]: !p[vk] }))}
                              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--txt-3)', cursor: 'pointer' }}>
                              {visible[vk] ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          )}
                        </div>
                        {f.help && <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 5 }}>{f.help}</p>}
                      </div>
                    );
                  })}

                  <button onClick={() => connect(svc)} disabled={loading[svc.id]} className={`btn ${conn ? 'btn-ghost' : 'btn-primary'}`} style={{ justifyContent: 'center' }}>
                    {loading[svc.id] ? <><Loader2 size={15} className="spin" /> جارٍ التحقق...</> : conn ? <><RefreshCw size={15} /> إعادة اختبار</> : <><Wifi size={15} /> اتصال وتحقق</>}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Security note */}
      <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderColor: 'rgba(245,158,11,0.22)', background: 'rgba(245,158,11,0.04)' }}>
        <AlertTriangle size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 3 }}>ملاحظة أمنية</p>
          <p style={{ fontSize: 12, color: 'var(--txt-3)', lineHeight: 1.6 }}>المفاتيح تُحفظ في متصفحك. لا تشاركها مع أحد. للاستخدام الاحترافي يُنصح بـ Backend + تشفير قاعدة البيانات.</p>
        </div>
      </div>
    </div>
  );
}
