import { useState } from 'react';
import { useStore } from '../store';
import { Sparkles, Copy, Check, Zap, Hash, MessageCircle, FileText, Video } from 'lucide-react';

const TEMPLATES = [
  { id:'new_product', label:'منتج جديد', icon:'🎉', hint:'اكتب اسم المنتج والسعر' },
  { id:'discount',    label:'عرض خاص',   icon:'🔥', hint:'اكتب المنتج ونسبة الخصم' },
  { id:'seasonal',    label:'عرض موسمي', icon:'🌙', hint:'اكتب الموسم والمنتجات' },
  { id:'custom',      label:'حر',         icon:'✏️', hint:'اكتب ما تريد' },
];

const SYSTEM_PROMPT = `أنت خبير تسويق رقمي مغربي محترف. تكتب محتوى تسويقياً للسوق المغربي باللغة العربية والدارجة المغربية.
لكل طلب، أنتج JSON بالهيكل التالي (لا تضف أي شيء خارج JSON):
{
  "caption": "النص الكامل للبوست",
  "hashtags": "#هاشتاغ1 #هاشتاغ2 #هاشتاغ3",
  "whatsapp": "رسالة واتساب قصيرة ومباشرة",
  "tiktok": "سكريبت تيكتوك 15 ثانية بالدارجة",
  "story": "3 سلايدات للستوري"
}`;

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} className="btn btn-ghost btn-sm" style={{ padding:'4px 8px' }}>
      {copied ? <Check size={12} style={{ color:'var(--mint)' }} /> : <Copy size={12} />}
    </button>
  );
}

export default function BannerStudioPage() {
  const { settings, notify } = useStore();
  const [template, setTemplate] = useState('custom');
  const [prompt, setPrompt]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<any>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [publishState, setPublishState] = useState<Record<string, 'idle'|'loading'|'success'|'error'>>({});
  const [publishResults, setPublishResults] = useState<Record<string, string>>({});
  const [error, setError]       = useState('');

  const publishTo = async (platform: string) => {
    if (!result?.caption) { notify('warning', 'أنشئ المحتوى أولاً'); return; }
    const social = settings.social as any;
    const tok = platform === 'facebook' ? social.facebook?.accessToken
              : platform === 'instagram' ? social.instagram?.accessToken : '';
    const pageId = platform === 'facebook' ? social.facebook?.pageId
                 : platform === 'instagram' ? social.instagram?.pageId : '';
    
    if (!tok || !pageId) {
      notify('error', `❌ ${platform === 'facebook' ? 'Facebook' : 'Instagram'} غير مربوط — اذهب لصفحة الربط`);
      return;
    }
    
    setPublishState(s => ({ ...s, [platform]: 'loading' }));
    try {
      const authTok = localStorage.getItem('ai_commerce_token') || '';
      const r = await fetch('/api/ai/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authTok}` },
        body: JSON.stringify({ platform, message: result.caption + '\n\n' + result.hashtags, imageUrl: null }),
      });
      const data = await r.json();
      if (data.success) {
        setPublishState(s => ({ ...s, [platform]: 'success' }));
        setPublishResults(s => ({ ...s, [platform]: data.postId || data.mediaId || 'تم النشر' }));
        notify('success', `✅ تم النشر على ${platform === 'facebook' ? 'Facebook' : 'Instagram'} بنجاح!`);
      } else {
        setPublishState(s => ({ ...s, [platform]: 'error' }));
        setPublishResults(s => ({ ...s, [platform]: data.error || 'فشل النشر' }));
        notify('error', `❌ فشل النشر: ${data.error}`);
      }
    } catch (e: any) {
      setPublishState(s => ({ ...s, [platform]: 'error' }));
      notify('error', `❌ خطأ: ${e.message}`);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const tok = localStorage.getItem('token') || '';
      const r = await fetch('/api/ai/reply', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${tok}` },
        body: JSON.stringify({
          systemPrompt: SYSTEM_PROMPT,
          message: `[${TEMPLATES.find(t=>t.id===template)?.label}] ${prompt}`,
          language: 'arabic',
        }),
      });
      const data = await r.json();
      const text = data.reply || data.message || data.text || '';
      try {
        const clean = text.replace(/```json\n?/g,'').replace(/```/g,'').trim();
        setResult(JSON.parse(clean));
      } catch {
        setResult({ caption: text, hashtags: '', whatsapp: text.slice(0,120), tiktok: '', story: '' });
      }
    } catch (e: any) {
      setError('حدث خطأ في الاتصال. تأكد من إعداد مفتاح AI في الإعدادات.');
    }
    setLoading(false);
  };

  const outputs = result ? [
    { label:'Caption', icon:<FileText size={13} />, text:result.caption, key:'caption' },
    { label:'Hashtags', icon:<Hash size={13} />, text:result.hashtags, key:'hashtags' },
    { label:'WhatsApp', icon:<MessageCircle size={13} />, text:result.whatsapp, key:'whatsapp' },
    { label:'TikTok Script', icon:<Video size={13} />, text:result.tiktok, key:'tiktok' },
    result.story ? { label:'Story سلايدات', icon:<Sparkles size={13} />, text:result.story, key:'story' } : null,
  ].filter(Boolean) : [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:640 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4 }}>
        <div style={{ width:40,height:40,borderRadius:11,background:'rgba(201,149,76,.12)',
          border:'1px solid rgba(201,149,76,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18 }}>
          🎨
        </div>
        <div>
          <h1 style={{ fontSize:18,fontWeight:900,color:'var(--ink1)',margin:0,letterSpacing:'-0.02em' }}>
            AI Banner Studio
          </h1>
          <p style={{ fontSize:12,color:'var(--ink3)',margin:0 }}>توليد محتوى تسويقي مغربي ذكي</p>
        </div>
      </div>

      {/* Template selector */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {TEMPLATES.map(t => (
          <button key={t.id} onClick={() => setTemplate(t.id)}
            style={{
              padding:'7px 14px', borderRadius:'var(--r-sm)',
              border:`1px solid ${template===t.id?'var(--ember)':'var(--border)'}`,
              background:template===t.id?'rgba(255,77,26,.1)':'var(--panel)',
              color:template===t.id?'var(--ember2)':'var(--ink2)',
              fontSize:13, fontWeight:600, cursor:'pointer',
              display:'flex',alignItems:'center',gap:6,
            }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Prompt input */}
      <div className="card" style={{ padding:'16px' }}>
        <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>
          {TEMPLATES.find(t=>t.id===template)?.hint || 'اكتب ما تريد'}
        </div>
        <textarea
          className="glass-input"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="مثال: عندي قفطان مراكشي بسعر 850 درهم، أريد كابشن جذاب..."
          rows={3}
          style={{ resize:'none', marginBottom:10 }}
          onKeyDown={e => { if (e.key==='Enter'&&(e.metaKey||e.ctrlKey)) generate(); }}
        />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11,color:'var(--ink3)' }}>Ctrl+Enter للتوليد</span>
          <button onClick={generate} disabled={loading||!prompt.trim()}
            className="btn btn-aurora" style={{ gap:7 }}>
            {loading ? (
              <><span style={{ animation:'spin 1s linear infinite',display:'inline-block' }}>⟳</span> جارٍ التوليد...</>
            ) : (
              <><Sparkles size={14} /> توليد المحتوى</>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:'rgba(255,77,26,.08)',border:'1px solid rgba(255,77,26,.2)',
          borderRadius:'var(--r)',padding:'12px 14px',fontSize:13,color:'var(--ember2)' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)' }}>المحتوى المُولَّد</div>
          {outputs.map((out: any) => out && (
            <div key={out.key} className="card" style={{ padding:'14px 16px' }}>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
                <div style={{ display:'flex',alignItems:'center',gap:6,
                  fontSize:11,fontWeight:700,color:'var(--gold)',letterSpacing:'.06em' }}>
                  {out.icon}{out.label.toUpperCase()}
                </div>
                <CopyBtn text={out.text} />
              </div>
              <div style={{ fontSize:13,color:'var(--ink1)',lineHeight:1.65,whiteSpace:'pre-wrap',
                background:'var(--void2)',borderRadius:8,padding:'10px 12px' }}>
                {out.text || '—'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Publish to platforms */}
      {result && (
        <div className="card" style={{ padding:'14px 16px' }}>
          <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:10,letterSpacing:'.06em' }}>
            📢 نشر على المنصات
          </div>
          <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
            {[
              { id:'facebook', label:'Facebook', color:'#1877F2', icon:'📘' },
              { id:'instagram', label:'Instagram', color:'#E1306C', icon:'📸' },
            ].map(p => {
              const state = publishState[p.id] || 'idle';
              const connected = !!(settings.social as any)[p.id]?.connected;
              return (
                <div key={p.id} style={{ flex:1,minWidth:140 }}>
                  <button
                    onClick={() => publishTo(p.id)}
                    disabled={state === 'loading' || !connected}
                    style={{
                      width:'100%',padding:'10px',borderRadius:10,
                      background: state === 'success' ? 'rgba(0,200,150,.1)' : state === 'error' ? 'rgba(255,77,26,.1)' : `${p.color}15`,
                      border: `1px solid ${state === 'success' ? 'rgba(0,200,150,.3)' : state === 'error' ? 'rgba(255,77,26,.3)' : `${p.color}40`}`,
                      color: state === 'success' ? 'var(--mint)' : state === 'error' ? 'var(--ember)' : p.color,
                      cursor: connected ? 'pointer' : 'not-allowed',
                      opacity: connected ? 1 : 0.5,
                      display:'flex',flexDirection:'column',alignItems:'center',gap:4,
                    }}>
                    <span style={{ fontSize:20 }}>{p.icon}</span>
                    <span style={{ fontSize:12,fontWeight:700 }}>
                      {state === 'loading' ? '⟳ جارٍ النشر...' : state === 'success' ? '✅ تم النشر' : state === 'error' ? '❌ فشل' : `نشر على ${p.label}`}
                    </span>
                    {!connected && <span style={{ fontSize:10 }}>غير مربوط</span>}
                  </button>
                  {publishResults[p.id] && (
                    <div style={{ fontSize:10,color:'var(--ink3)',marginTop:4,textAlign:'center' }}>
                      {state === 'success' ? `✅ ID: ${publishResults[p.id]}` : publishResults[p.id]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize:10,color:'var(--ink3)',marginTop:8,textAlign:'center' }}>
            يتم التحقق من النشر مباشرة عبر Meta API — النتيجة حقيقية وليست وهمية
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[1,2,3,4].map(i => (
            <div key={i} className="skeleton" style={{ height:90 }} />
          ))}
        </div>
      )}
    </div>
  );
}
