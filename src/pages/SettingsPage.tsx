import { useState, useRef } from 'react';
import { useStore } from '../store';
import { Settings, Bot, Package, Truck, FileText, Shield, Users, RefreshCw, Download, Upload, Plus, Trash2, Cloud, Bell, Palette } from 'lucide-react';
import type { TeamMember } from '../types';
import SystemCheck from '../components/SystemCheck';
import QRCode from '../components/QRCode';

type Tab = 'general'|'ai'|'chatbot'|'products'|'delivery'|'templates'|'team'|'security'|'notifs'|'design'|'cloud'|'logs';

const TABS: { id: Tab; icon: typeof Settings; label: string }[] = [
  { id: 'general', icon: Settings, label: 'المتجر' },
  { id: 'ai', icon: Bot, label: 'AI' },
  { id: 'chatbot', icon: Bot, label: 'المساعد' },
  { id: 'products', icon: Package, label: 'المنتجات' },
  { id: 'delivery', icon: Truck, label: 'التوصيل' },
  { id: 'templates', icon: FileText, label: 'القوالب' },
  { id: 'team', icon: Users, label: 'الفريق' },
  { id: 'security', icon: Shield, label: 'الأمان' },
  { id: 'notifs', icon: Bell, label: 'الإشعارات' },
  { id: 'design', icon: Palette, label: 'التصميم' },
  { id: 'cloud', icon: Cloud, label: 'السحابة' },
  { id: 'logs', icon: Settings, label: 'السجلات' },
];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
    <h2 style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 2 }}>{title}</h2>
    {children}
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="label">{label}</label>{children}</div>
);

const Toggle = ({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 11, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>
    <div>
      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-1)' }}>{label}</p>
      {sub && <p style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 1 }}>{sub}</p>}
    </div>
    <button onClick={onClick} className={`toggle ${on ? 'on' : ''}`} />
  </div>
);

export default function SettingsPage() {
  const { settings, updateSettings, notify, logout, isOnline, refreshData, addTemplate, updateTemplate, deleteTemplate, auditLogs, exportData, importData, resetToDemo } = useStore();
  const [tab, setTab] = useState<Tab>('general');
  const importRef = useRef<HTMLInputElement>(null);
  const s = settings;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 className="page-title">الإعدادات</h1>
        <p className="page-sub">تخصيص كامل للنظام</p>
      </div>

      {/* Tabs */}
      <div className="tabs scroll-x" style={{ gap: 4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn ${tab === t.id ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {/* ── General ── */}
      {tab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="معلومات المتجر">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="اسم المتجر"><input className="input" value={s.brand.name} onChange={e => updateSettings('brand', { ...s.brand, name: e.target.value })} /></Field>
              <Field label="رقم الهاتف"><input className="input" value={s.brand.phone} dir="ltr" onChange={e => updateSettings('brand', { ...s.brand, phone: e.target.value })} /></Field>
              <Field label="البريد الإلكتروني"><input className="input" type="email" value={s.brand.email} dir="ltr" onChange={e => updateSettings('brand', { ...s.brand, email: e.target.value })} /></Field>
              <Field label="العنوان"><input className="input" value={s.brand.address} onChange={e => updateSettings('brand', { ...s.brand, address: e.target.value })} /></Field>
              <Field label="العملة">
                <select className="select" value={s.brand.currency} onChange={e => updateSettings('brand', { ...s.brand, currency: e.target.value })}>
                  {['MAD','EUR','USD','GBP','SAR','AED','DZD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="اللغة">
                <select className="select" value={s.brand.language} onChange={e => updateSettings('brand', { ...s.brand, language: e.target.value })}>
                  {[['ar','العربية'],['fr','Français'],['en','English']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field label="الوصف"><textarea className="textarea" rows={2} value={s.brand.description} onChange={e => updateSettings('brand', { ...s.brand, description: e.target.value })} /></Field>
            <button onClick={() => notify('success', '✅ تم الحفظ')} className="btn btn-primary" style={{ width: 'fit-content' }}>حفظ</button>
          </Section>

          <Section title="أهداف المبيعات">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label={`هدف يومي (${s.brand.currency})`}><input className="input" type="number" value={s.goals.daily} dir="ltr" onChange={e => updateSettings('goals', { ...s.goals, daily: parseInt(e.target.value)||0 })} /></Field>
              <Field label={`هدف شهري (${s.brand.currency})`}><input className="input" type="number" value={s.goals.monthly} dir="ltr" onChange={e => updateSettings('goals', { ...s.goals, monthly: parseInt(e.target.value)||0 })} /></Field>
            </div>
          </Section>

          {/* QR Code */}
          <Section title="🔗 رابط الكتالوج العام">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <QRCode value={`${window.location.origin}?catalog=1`} size={130} label="امسح للوصول للكتالوج" />
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?catalog=1`); notify('success', '✅ تم نسخ الرابط'); }} className="btn btn-ghost" style={{ flex: 1 }}>📋 نسخ الرابط</button>
                <button onClick={() => { if (navigator.share) navigator.share({ title: s.brand.name, url: `${window.location.origin}?catalog=1` }); }} className="btn btn-primary" style={{ flex: 1 }}>📱 مشاركة</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--txt-3)', textAlign: 'center' }}>الزبائن يرون منتجاتك ويطلبون عبر واتساب مباشرة</p>
            </div>
          </Section>
        </div>
      )}

      {/* ── AI ── */}
      {tab === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="مزوّد الذكاء الاصطناعي">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['openai','gemini'] as const).map(p => (
                <button key={p} onClick={() => updateSettings('ai', { ...s.ai, provider: p })}
                  style={{ padding: '13px', borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${s.ai.provider === p ? 'rgba(99,102,241,0.45)' : 'var(--clr-border)'}`, background: s.ai.provider === p ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)', color: s.ai.provider === p ? 'var(--clr-pri-h)' : 'var(--txt-3)' }}>
                  {p === 'openai' ? '🧠 OpenAI GPT' : '🤖 Google Gemini (مجاني)'}
                </button>
              ))}
            </div>
            {s.ai.provider === 'openai' ? (
              <Field label="OpenAI API Key">
                <input className="input" type="password" placeholder="sk-proj-..." value={s.ai.apiKey} dir="ltr" style={{ fontFamily: 'monospace' }} onChange={e => updateSettings('ai', { ...s.ai, apiKey: e.target.value })} />
                <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 5 }}>من platform.openai.com/api-keys</p>
              </Field>
            ) : (
              <Field label="Gemini API Key (مجاني)">
                <input className="input" type="password" placeholder="AIzaSy..." value={s.ai.geminiKey} dir="ltr" style={{ fontFamily: 'monospace' }} onChange={e => updateSettings('ai', { ...s.ai, geminiKey: e.target.value })} />
                <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 5 }}>من aistudio.google.com/app/apikey</p>
              </Field>
            )}
          </Section>

          <Section title="الشخصية والأسلوب">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="الشخصية">
                <select className="select" value={s.ai.personality} onChange={e => updateSettings('ai', { ...s.ai, personality: e.target.value })}>
                  {['Moroccan Seller','Professional','Friendly','Luxury','Fast Seller'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="لغة الردود">
                <select className="select" value={s.ai.language} onChange={e => updateSettings('ai', { ...s.ai, language: e.target.value })}>
                  {['Darija','Arabic','French','English'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="تأخير الرد (ثوانٍ)"><input className="input" type="number" min={0} max={15} value={s.ai.replyDelay} dir="ltr" onChange={e => updateSettings('ai', { ...s.ai, replyDelay: parseInt(e.target.value)||2 })} /></Field>
              <Field label="الحرارة (Temperature)"><input className="input" type="number" min={0} max={2} step={0.1} value={s.ai.temperature} dir="ltr" onChange={e => updateSettings('ai', { ...s.ai, temperature: parseFloat(e.target.value)||0.7 })} /></Field>
              <Field label="حد الخصم التلقائي %"><input className="input" type="number" min={0} max={50} value={s.ai.maxDiscount} dir="ltr" onChange={e => updateSettings('ai', { ...s.ai, maxDiscount: parseInt(e.target.value)||15 })} /></Field>
            </div>
            <Field label="System Prompt"><textarea className="textarea" rows={3} value={s.ai.systemPrompt} onChange={e => updateSettings('ai', { ...s.ai, systemPrompt: e.target.value })} /></Field>
            {[
              { l: 'محاكاة السلوك البشري', k: 'humanSimulation', sub: 'يكتب ببطء ويتأخر قليلاً' },
              { l: 'خصم تلقائي عند التفاوض', k: 'autoDiscount', sub: '' },
              { l: 'وضع الدارجة المغربية', k: 'darijaMode', sub: '' },
            ].map(item => <Toggle key={item.k} on={(s.ai as any)[item.k]} onClick={() => updateSettings('ai', { ...s.ai, [item.k]: !(s.ai as any)[item.k] })} label={item.l} sub={item.sub} />)}
            <button onClick={() => notify('success', '✅ تم حفظ إعدادات AI')} className="btn btn-primary" style={{ width: 'fit-content' }}>حفظ</button>
          </Section>
        </div>
      )}

      {/* ── Chatbot ── */}
      {tab === 'chatbot' && (
        <Section title="إعدادات المساعد الذكي">
          <Field label="رسالة الترحيب"><textarea className="textarea" rows={2} value={s.chatbot.greetingMessage} onChange={e => updateSettings('chatbot', { ...s.chatbot, greetingMessage: e.target.value })} /></Field>
          <Field label="رسالة الفشل"><textarea className="textarea" rows={2} value={s.chatbot.fallbackMessage} onChange={e => updateSettings('chatbot', { ...s.chatbot, fallbackMessage: e.target.value })} /></Field>
          <div>
            <label className="label">ردود سريعة</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {s.chatbot.quickReplies.map((r, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--clr-border)', fontSize: 12.5 }}>
                  {r}
                  <button onClick={() => updateSettings('chatbot', { ...s.chatbot, quickReplies: s.chatbot.quickReplies.filter((_,j)=>j!==i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="qr-in" className="input" placeholder="رد سريع جديد..." />
              <button onClick={() => { const el = document.getElementById('qr-in') as HTMLInputElement; if (el?.value.trim()) { updateSettings('chatbot', { ...s.chatbot, quickReplies: [...s.chatbot.quickReplies, el.value.trim()] }); el.value = ''; } }} className="btn btn-ghost">إضافة</button>
            </div>
          </div>
          <button onClick={() => notify('success', '✅ تم الحفظ')} className="btn btn-primary" style={{ width: 'fit-content' }}>حفظ</button>
        </Section>
      )}

      {/* ── Products ── */}
      {tab === 'products' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="إعدادات المنتجات">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="بادئة SKU"><input className="input" value={s.products.skuPrefix} dir="ltr" style={{ fontFamily: 'monospace' }} onChange={e => updateSettings('products', { ...s.products, skuPrefix: e.target.value })} /></Field>
              <Field label="تنبيه مخزون منخفض (≤)"><input className="input" type="number" value={s.products.lowStockAlert} dir="ltr" onChange={e => updateSettings('products', { ...s.products, lowStockAlert: parseInt(e.target.value)||5 })} /></Field>
              <Field label="الضريبة %"><input className="input" type="number" value={s.products.taxRate} dir="ltr" onChange={e => updateSettings('products', { ...s.products, taxRate: parseFloat(e.target.value)||0 })} /></Field>
            </div>
            <Toggle on={s.products.autoSku} onClick={() => updateSettings('products', { ...s.products, autoSku: !s.products.autoSku })} label="توليد SKU تلقائياً" />
            <Toggle on={s.products.autoPublishOnCreate} onClick={() => updateSettings('products', { ...s.products, autoPublishOnCreate: !s.products.autoPublishOnCreate })} label="نشر تلقائي عند الإضافة" />
          </Section>
          <Section title="التصنيفات">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {s.products.categories.map((c, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--clr-border)', fontSize: 12.5 }}>
                  {c}
                  <button onClick={() => updateSettings('products', { ...s.products, categories: s.products.categories.filter((_,j)=>j!==i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="cat-in" className="input" placeholder="تصنيف جديد..." />
              <button onClick={() => { const el = document.getElementById('cat-in') as HTMLInputElement; if (el?.value.trim()) { updateSettings('products', { ...s.products, categories: [...s.products.categories, el.value.trim()] }); el.value = ''; } }} className="btn btn-ghost">إضافة</button>
            </div>
          </Section>
        </div>
      )}

      {/* ── Delivery ── */}
      {tab === 'delivery' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="خيارات التوصيل">
            <Toggle on={s.delivery.autoSendOnApproval} onClick={() => updateSettings('delivery', { ...s.delivery, autoSendOnApproval: !s.delivery.autoSendOnApproval })} label="إرسال تلقائي عند الموافقة" />
            <Toggle on={s.delivery.notifyCustomerOnShip} onClick={() => updateSettings('delivery', { ...s.delivery, notifyCustomerOnShip: !s.delivery.notifyCustomerOnShip })} label="إشعار الزبون عند الشحن" />
          </Section>
          <Section title="شركات التوصيل">
            {s.delivery.providers.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--txt-3)', textAlign: 'center', padding: '12px 0' }}>لا توجد شركات — أضف من صفحة التوصيل</p>
            ) : (
              s.delivery.providers.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>
                  <span style={{ fontSize: 20 }}>{p.logo}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>{p.name}</p>
                    <p style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>{p.mode} · {p.username}</p>
                  </div>
                  <button onClick={() => updateSettings('delivery', { ...s.delivery, providers: s.delivery.providers.map((x,j) => j===i ? {...x,enabled:!x.enabled} : x) })} className={`toggle ${p.enabled ? 'on' : ''}`} />
                  <button onClick={() => updateSettings('delivery', { ...s.delivery, providers: s.delivery.providers.filter(x => x.id !== p.id) })} className="btn btn-danger btn-sm" style={{ paddingInline: 10 }}><Trash2 size={13} /></button>
                </div>
              ))
            )}
          </Section>
        </div>
      )}

      {/* ── Templates ── */}
      {tab === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>القوالب ({s.templates.length})</p>
            <button onClick={() => { const name = prompt('اسم القالب:'); const content = prompt('نص القالب:'); if (name && content) addTemplate({ name, category: 'reply', content, variables: [], active: true }); }} className="btn btn-primary btn-sm"><Plus size={14} /> إضافة</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {s.templates.map(t => (
              <div key={t.id} className="card" style={{ padding: '14px 16px', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--txt-1)' }}>{t.name}</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => { const c = prompt('تعديل المحتوى:', t.content); if (c) updateTemplate(t.id, { content: c }); }} style={{ background: 'none', border: 'none', color: 'var(--txt-3)', cursor: 'pointer', fontSize: 16 }}>✏️</button>
                    <button onClick={() => deleteTemplate(t.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>🗑️</button>
                  </div>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--txt-3)', lineHeight: 1.6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>{t.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Team ── */}
      {tab === 'team' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>الفريق</p>
            <button onClick={() => { const name = prompt('الاسم:'); const email = prompt('البريد:'); if (name && email) updateSettings('team', [...s.team, { id: `u${Date.now()}`, name, email, role: 'seller', active: true }]); }} className="btn btn-primary btn-sm"><Plus size={14} /> إضافة</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {s.team.map((m: TeamMember, i: number) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', borderBottom: i < s.team.length-1 ? '1px solid var(--clr-border)' : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--clr-pri-g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{m.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--txt-1)' }}>{m.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--txt-3)' }}>{m.email}</p>
                </div>
                <select className="select" style={{ width: 130, height: 36, fontSize: 13, paddingInline: '10px' }} value={m.role}
                  onChange={e => { const t=[...s.team]; t[i]={...t[i],role:e.target.value as any}; updateSettings('team',t); }}>
                  {['admin','seller','support','delivery'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => { const t=[...s.team]; t[i]={...t[i],active:!t[i].active}; updateSettings('team',t); }}
                  style={{ fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: 'none', background: m.active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: m.active ? '#34d399' : '#f87171' }}>
                  {m.active ? 'نشط' : 'معطّل'}
                </button>
              </div>
            ))}
          </div>
          {/* Permissions table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--clr-border)' }}>
              <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)' }}>جدول الصلاحيات</p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--clr-border)' }}>
                  {['الصلاحية','👑 Admin','🛒 Seller','💬 Support','🚚 Delivery'].map(h => <th key={h} style={{ padding: '12px 14px', textAlign: h === 'الصلاحية' ? 'right' : 'center', color: 'var(--txt-3)', fontWeight: 700 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[['لوحة التحكم',true,true,true,true],['إضافة منتج',true,true,false,false],['حذف منتج',true,false,false,false],['الطلبات',true,true,true,true],['الزبائن',true,true,true,false],['المحادثات',true,true,true,false],['التحليلات',true,true,false,false],['الإعدادات',true,false,false,false]].map(([perm,...perms],i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--clr-border)' }}>
                      <td style={{ padding: '10px 14px', color: 'var(--txt-1)', fontWeight: 600 }}>{perm as string}</td>
                      {(perms as boolean[]).map((has, j) => <td key={j} style={{ textAlign: 'center', padding: '10px', fontSize: 16 }}>{has ? '✅' : '❌'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Security ── */}
      {tab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="الأمان">
            <Toggle on={s.security.twoFactorEnabled} onClick={() => updateSettings('security', { ...s.security, twoFactorEnabled: !s.security.twoFactorEnabled })} label="المصادقة الثنائية (2FA)" sub="حماية إضافية لحسابك" />
            <Field label="تسجيل الخروج التلقائي (دقائق)"><input className="input" type="number" value={s.security.autoLogoutMinutes} dir="ltr" onChange={e => updateSettings('security', { ...s.security, autoLogoutMinutes: parseInt(e.target.value)||60 })} /></Field>
          </Section>
          <Section title="النسخ الاحتياطي">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button onClick={exportData} className="btn btn-ghost" style={{ justifyContent: 'center' }}><Download size={15} /> تصدير نسخة احتياطية</button>
              <button onClick={() => importRef.current?.click()} className="btn btn-ghost" style={{ justifyContent: 'center' }}><Upload size={15} /> استيراد نسخة</button>
              <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { const f=e.target.files?.[0]; if(f){const r=new FileReader();r.onload=ev=>importData(ev.target?.result as string);r.readAsText(f);} }} />
            </div>
            <button onClick={() => { if(confirm('هل أنت متأكد؟ ستُفقد البيانات الحالية.')) resetToDemo(); }} className="btn btn-danger" style={{ justifyContent: 'center', width: '100%' }}>
              <RefreshCw size={15} /> إعادة البيانات التجريبية
            </button>
          </Section>
        </div>
      )}

      {/* ── Notifs ── */}
      {tab === 'notifs' && (
        <Section title="إعدادات الإشعارات">
          {[
            { l: '🛒 طلب جديد', k: 'newOrder' },
            { l: '💬 رسالة جديدة', k: 'newMessage' },
            { l: '⚠️ مخزون منخفض', k: 'lowStock' },
            { l: '🚚 عند الشحن', k: 'orderShipped' },
            { l: '🔊 صوت تنبيه', k: 'sound' },
            { l: '📱 إشعارات WhatsApp للزبائن', k: 'whatsappBroadcast' },
          ].map(item => <Toggle key={item.k} on={(s.notifs as any)[item.k]} onClick={() => updateSettings('notifs', { ...s.notifs, [item.k]: !(s.notifs as any)[item.k] })} label={item.l} />)}
        </Section>
      )}

      {/* ── Design ── */}
      {tab === 'design' && (
        <Section title="التصميم">
          <div>
            <label className="label">الثيم</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['dark','light'] as const).map(t => (
                <button key={t} onClick={() => updateSettings('design', { ...s.design, theme: t })}
                  style={{ padding: '16px', borderRadius: 13, fontSize: 14, fontWeight: 800, cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${s.design.theme === t ? 'rgba(99,102,241,0.45)' : 'var(--clr-border)'}`, background: t === 'dark' ? '#09090f' : '#f8f9fc', color: t === 'dark' ? '#fff' : '#0f172a' }}>
                  {t === 'dark' ? '🌙 داكن' : '☀️ فاتح'}
                </button>
              ))}
            </div>
          </div>
          <Toggle on={s.design.watermarkEnabled} onClick={() => updateSettings('design', { ...s.design, watermarkEnabled: !s.design.watermarkEnabled })} label="علامة مائية على الصور" />
          {s.design.watermarkEnabled && <Field label="نص العلامة"><input className="input" value={s.design.watermarkText} onChange={e => updateSettings('design', { ...s.design, watermarkText: e.target.value })} /></Field>}
          <Toggle on={s.design.compressImages} onClick={() => updateSettings('design', { ...s.design, compressImages: !s.design.compressImages })} label="ضغط الصور تلقائياً" />
        </Section>
      )}

      {/* ── Cloud ── */}
      {tab === 'cloud' && (
        <Section title="الحفظ السحابي — Supabase">
          <div style={{ padding: '12px 14px', borderRadius: 11, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <p style={{ fontSize: 13, color: 'var(--txt-2)', lineHeight: 1.6 }}>Supabase مجاني حتى 500MB — يحل مشكلة localStorage نهائياً ويتيح المزامنة بين الأجهزة.</p>
          </div>
          <Field label="Supabase Project URL"><input className="input" placeholder="https://xxxx.supabase.co" value={s.supabaseUrl} dir="ltr" style={{ fontFamily: 'monospace' }} onChange={e => updateSettings('supabaseUrl', e.target.value as any)} /></Field>
          <Field label="Supabase Anon Key"><input className="input" type="password" placeholder="eyJ..." value={s.supabaseKey} dir="ltr" style={{ fontFamily: 'monospace' }} onChange={e => updateSettings('supabaseKey', e.target.value as any)} /></Field>
          <button onClick={async () => {
            if (!s.supabaseUrl || !s.supabaseKey) { notify('error', 'يرجى إدخال URL والمفتاح'); return; }
            notify('info', '⏳ جارٍ اختبار الاتصال...');
            try { const r = await fetch(`${s.supabaseUrl}/rest/v1/`, { headers: { 'apikey': s.supabaseKey } }); r.ok ? notify('success', '✅ Supabase متصل!') : notify('error', '❌ فشل الاتصال'); } catch { notify('error', '❌ فشل — تحقق من URL'); }
          }} className="btn btn-primary" style={{ justifyContent: 'center' }}>اختبار الاتصال</button>
          <Toggle on={s.cloudEnabled} onClick={() => updateSettings('cloudEnabled', !s.cloudEnabled as any)} label="تفعيل الحفظ السحابي" sub="البيانات ستُحفظ في Supabase" />
        </Section>
      )}

      {/* ── Logs ── */}
      {tab === 'logs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--clr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)' }}>سجلات التدقيق ({auditLogs.length})</p>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {auditLogs.slice(0, 30).map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--clr-border)' }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{log.type === 'order' ? '🛒' : log.type === 'product' ? '📦' : log.type === 'ai' ? '🤖' : log.type === 'delivery' ? '🚚' : '⚙️'}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: 'var(--txt-2)' }}>{log.action}</p>
                    {log.details && <p style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>{log.details}</p>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--txt-3)', flexShrink: 0 }}>{log.timestamp.split(' ')[1]}</span>
                </div>
              ))}
              {auditLogs.length === 0 && <p style={{ padding: '24px', textAlign: 'center', color: 'var(--txt-3)', fontSize: 13 }}>لا نشاط بعد</p>}
            </div>
          </div>
          <SystemCheck />
        </div>
      )}
    </div>
  );
}
