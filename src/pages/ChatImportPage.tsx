import { useState, useRef } from 'react';
import { useStore } from '../store';
import {
  Upload, Bot, Check, X, Users, Phone, MapPin, MessageCircle,
  Download, Eye, EyeOff, Sparkles, AlertCircle, Plus
} from 'lucide-react';
import * as api from '../services/api';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════
interface ExtractedCustomer {
  id: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  source: string;
  notes: string;
  orders: string[];
  sizes: string[];
  colors: string[];
  messageCount: number;
  confidence: number; // 0-100
  selected: boolean;
}

// ══════════════════════════════════════════════
// LOCAL EXTRACTOR (no API key needed)
// ══════════════════════════════════════════════
function extractCustomersLocally(text: string, source: string): ExtractedCustomer[] {
  const MOROCCAN_CITIES = ['الدار البيضاء','كازابلانكا','casablanca','الرباط','rabat','فاس','fes','مراكش','marrakech','طنجة','tanger','أكادير','agadir','مكناس','meknès','وجدة','oujda','سلا','sale','تطوان','tetouan','القنيطرة','kenitra','الجديدة','el jadida','بني ملال','سطات','خريبكة','نادور','الحسيمة','برشيد','تازة','ورزازات','العرائش','خنيفرة','آسفي','قلعة السراغنة'];
  const SIZES = ['XS','S','M','L','XL','XXL','XXXL','34','36','38','40','42','44','46','48'];
  const COLORS_AR = ['أسود','أبيض','أحمر','أزرق','أخضر','رمادي','بيج','وردي','بني','كحلي','زيتي','بنفسجي','برتقالي','أصفر'];

  const customers: ExtractedCustomer[] = [];
  const lines = text.split('\n');
  
  // Split into conversation blocks (by date patterns or message separators)
  const blocks: string[][] = [];
  let current: string[] = [];
  
  for (const line of lines) {
    // New conversation block if date pattern or separator
    if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(line.trim()) && current.length > 20) {
      if (current.length > 0) blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  
  // Process each block or the whole text as one customer
  const textsToProcess = blocks.length > 1 ? blocks.map(b => b.join('\n')) : [text];
  
  for (const segment of textsToProcess) {
    const lo = segment.toLowerCase();
    let confidence = 0;
    
    // Extract phone
    const phoneMatches = segment.match(/(?:\+212|00212|0)([ \-]?\d){9}/g) || 
                         segment.match(/0[5-7]\d[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}/g) ||
                         segment.match(/(?:06|07|05)\d{8}/g);
    const phone = phoneMatches ? phoneMatches[0].replace(/[\s\-]/g, '') : '';
    if (phone) confidence += 40;
    
    // Extract name
    let name = '';
    const namePatterns = [
      /(?:اسمي|اسم|إسمي|je m'appelle|my name is|أنا)\s+([أ-ي\w]{2,25}(?:\s+[أ-ي\w]{2,20})?)/i,
      /(?:المرسل|من|client)\s*:\s*([أ-ي\w]{2,25}(?:\s+[أ-ي\w]{2,20})?)/i,
      /^([أ-ي]{2,15}\s+[أ-ي]{2,15})$/m,
    ];
    for (const p of namePatterns) {
      const m = segment.match(p);
      if (m) { name = m[1].trim(); confidence += 20; break; }
    }
    
    // Extract city
    let city = '';
    for (const c of MOROCCAN_CITIES) {
      if (lo.includes(c.toLowerCase())) { city = c; confidence += 15; break; }
    }
    
    // Extract address
    let address = '';
    const addrMatch = segment.match(/(?:عنواني|عنوان|حي|شارع|زنقة|ديرب|ruelle|rue|quartier|adresse)\s*:?\s*([^\n،,]{5,60})/i);
    if (addrMatch) { address = addrMatch[1].trim(); confidence += 10; }
    
    // Extract orders/products mentioned
    const orders: string[] = [];
    const orderPatterns = [
      /(?:بغيت|أريد|أبغى|je veux|je voudrais|طلب|commande)\s+([^\n،,]{3,50})/gi,
      /(?:منتج|قطعة|piece|article)\s*:?\s*([^\n،,]{3,40})/gi,
    ];
    for (const p of orderPatterns) {
      const matches = [...segment.matchAll(p)];
      matches.forEach(m => { if (m[1] && orders.length < 5) orders.push(m[1].trim()); });
    }
    
    // Extract sizes
    const foundSizes = SIZES.filter(s => new RegExp(`\\b${s}\\b`, 'i').test(segment));
    
    // Extract colors
    const foundColors = COLORS_AR.filter(c => segment.includes(c));
    
    // Count messages
    const messageCount = (segment.match(/\d{1,2}:\d{2}/g) || []).length;
    
    // Skip if no useful info extracted
    if (confidence < 20) continue;
    
    // Check for duplicate phone
    if (phone && customers.find(c => c.phone === phone)) continue;
    
    customers.push({
      id: `imp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      name: name || `زبون ${customers.length + 1}`,
      phone,
      city,
      address,
      source,
      notes: orders.length > 0 ? `منتجات مذكورة: ${orders.slice(0,3).join(', ')}` : '',
      orders,
      sizes: foundSizes,
      colors: foundColors,
      messageCount,
      confidence: Math.min(100, confidence),
      selected: confidence >= 40,
    });
  }
  
  return customers;
}

// ══════════════════════════════════════════════
// AI EXTRACTOR (with API key)
// ══════════════════════════════════════════════
async function extractWithAI(text: string, source: string, token: string): Promise<ExtractedCustomer[]> {
  const chunk = text.slice(0, 8000); // Send first 8K chars to AI
  const prompt = `أنت خبير استخراج بيانات. من هذه المحادثة الواحدة أو المتعددة، استخرج معلومات كل زبون.

أرجع JSON فقط بهذا الشكل (بدون أي نص خارج JSON):
{
  "customers": [
    {
      "name": "الاسم أو فارغ",
      "phone": "رقم الهاتف بدون مسافات أو فارغ", 
      "city": "المدينة المغربية أو فارغ",
      "address": "العنوان التفصيلي أو فارغ",
      "orders": ["منتج1", "منتج2"],
      "sizes": ["L", "XL"],
      "colors": ["أسود"],
      "notes": "ملاحظات مهمة عن الزبون"
    }
  ]
}

المحادثة:
${chunk}`;

  try {
    const r = await fetch('/api/ai/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ message: prompt, history: [], systemPrompt: 'أنت خبير استخراج بيانات. أرجع JSON فقط بدون أي نص آخر.' }),
    });
    const data = await r.json();
    const text2 = data.reply || '';
    const clean = text2.replace(/```json\n?/g,'').replace(/```/g,'').trim();
    const parsed = JSON.parse(clean);
    
    return (parsed.customers || []).map((c: any, i: number) => ({
      id: `ai-${Date.now()}-${i}`,
      name: c.name || `زبون ${i+1}`,
      phone: (c.phone || '').replace(/\s/g, ''),
      city: c.city || '',
      address: c.address || '',
      source,
      notes: c.notes || '',
      orders: c.orders || [],
      sizes: c.sizes || [],
      colors: c.colors || [],
      messageCount: 0,
      confidence: c.phone ? 80 : 50,
      selected: true,
    }));
  } catch {
    return extractCustomersLocally(text, source);
  }
}

// ══════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════
export default function ChatImportPage() {
  const { addCustomer, settings, notify, token } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep]         = useState<'upload'|'processing'|'review'|'done'>('upload');
  const [source, setSource]     = useState('WhatsApp');
  const [text, setText]         = useState('');
  const [customers, setCustomers] = useState<ExtractedCustomer[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [useAI, setUseAI]       = useState(false);
  const [editId, setEditId]     = useState<string|null>(null);
  const [importedCount, setImportedCount] = useState(0);

  const SOURCES = ['WhatsApp','Messenger','Instagram','Facebook','يدوي'];

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
    await processText(content);
    if (fileRef.current) fileRef.current.value = '';
  };

  const processText = async (content: string) => {
    if (!content.trim() || content.length < 20) {
      notify('warning', 'الملف فارغ أو قصير جداً'); return;
    }
    setStep('processing'); setProgress(10);
    
    try {
      let extracted: ExtractedCustomer[];
      
      const hasAIKey = !!(settings.ai?.apiKey || settings.ai?.geminiKey);
      setProgress(30);
      
      if (hasAIKey && useAI) {
        notify('info', '🤖 AI يحلل المحادثة...');
        extracted = await extractWithAI(content, source, token || '');
      } else {
        extracted = extractCustomersLocally(content, source);
      }
      
      setProgress(80);
      
      if (extracted.length === 0) {
        notify('warning', 'لم نجد معلومات زبائن واضحة. جرب نصاً آخر أو ادخل يدوياً.');
        setStep('upload'); return;
      }
      
      setProgress(100);
      setCustomers(extracted);
      setStep('review');
    } catch (e: any) {
      notify('error', `خطأ: ${e.message}`);
      setStep('upload');
    }
  };

  const importSelected = async () => {
    const selected = customers.filter(c => c.selected);
    if (selected.length === 0) { notify('warning', 'اختر زبوناً واحداً على الأقل'); return; }
    
    setImporting(true);
    let count = 0;
    
    for (const c of selected) {
      try {
        await addCustomer({
          name: c.name, phone: c.phone, city: c.city, address: c.address,
          source: c.source, notes: c.notes, vip: false, trustScore: 80,
          totalOrders: c.orders.length, totalSpent: 0,
          lastOrderDate: new Date().toISOString().split('T')[0],
        });
        count++;
      } catch {}
    }
    
    setImportedCount(count);
    setStep('done');
    notify('success', `✅ تم استيراد ${count} زبون`);
    setImporting(false);
  };

  const toggleAll = (v: boolean) => setCustomers(cs => cs.map(c => ({ ...c, selected: v })));
  const toggleOne = (id: string) => setCustomers(cs => cs.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  const updateCustomer = (id: string, field: string, value: string) =>
    setCustomers(cs => cs.map(c => c.id === id ? { ...c, [field]: value } : c));
  const removeCustomer = (id: string) => setCustomers(cs => cs.filter(c => c.id !== id));

  const selectedCount = customers.filter(c => c.selected).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, maxWidth:800 }}>
      
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:44,height:44,borderRadius:12,background:'rgba(201,149,76,.12)',border:'1px solid rgba(201,149,76,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20 }}>
          🧠
        </div>
        <div>
          <h1 style={{ fontSize:20,fontWeight:900,color:'var(--ink1)',margin:0,letterSpacing:'-.02em' }}>
            استيراد الزبائن من المحادثات
          </h1>
          <p style={{ fontSize:13,color:'var(--ink3)',margin:0 }}>
            AI يستخرج معلومات زبائنك تلقائياً من محادثات واتساب، مسنجر، إنستغرام
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ display:'flex', alignItems:'center', gap:0 }}>
        {[{n:1,l:'رفع الملف'},{n:2,l:'التحليل'},{n:3,l:'المراجعة'},{n:4,l:'تم الاستيراد'}].map((s,i) => {
          const stepIdx = ['upload','processing','review','done'].indexOf(step);
          const active  = i === stepIdx;
          const done    = i < stepIdx;
          return (
            <div key={s.n} style={{ display:'flex', alignItems:'center', flex: i < 3 ? 1 : 'auto' }}>
              <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
                <div style={{
                  width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:11,fontWeight:800,border:'2px solid',
                  background:done?'rgba(0,200,150,.12)':active?'var(--ember)':'transparent',
                  borderColor:done?'var(--mint)':active?'var(--ember)':'var(--border2)',
                  color:done?'var(--mint)':active?'#fff':'var(--ink3)',
                }}>{done?'✓':s.n}</div>
                <span style={{ fontSize:10,color:active?'var(--ink1)':'var(--ink3)',whiteSpace:'nowrap',fontWeight:active?700:400 }}>{s.l}</span>
              </div>
              {i < 3 && <div style={{ flex:1,height:2,background:done?'var(--mint)':'var(--border2)',marginTop:-12,margin:'0 6px -12px' }}/>}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          
          {/* Source selector */}
          <div>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>مصدر المحادثة</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {SOURCES.map(s => (
                <button key={s} onClick={()=>setSource(s)} style={{
                  padding:'7px 16px',borderRadius:99,fontSize:13,fontWeight:600,cursor:'pointer',
                  border:`1px solid ${source===s?'var(--ember)':'var(--border)'}`,
                  background:source===s?'rgba(255,77,26,.1)':'var(--panel)',
                  color:source===s?'var(--ember2)':'var(--ink2)',transition:'all .15s',
                }}>
                  {s==='WhatsApp'?'💬 ':s==='Messenger'?'💙 ':s==='Instagram'?'📸 ':s==='Facebook'?'📘 ':'✏️ '}{s}
                </button>
              ))}
            </div>
          </div>

          {/* AI toggle */}
          <div style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',
            background:'rgba(0,200,150,.06)',border:'1px solid rgba(0,200,150,.18)',borderRadius:'var(--r)' }}>
            <div className="dot-live" />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13,fontWeight:700,color:'var(--ink1)' }}>استخدام AI للتحليل</div>
              <div style={{ fontSize:11,color:'var(--ink3)' }}>
                {settings.ai?.apiKey || settings.ai?.geminiKey
                  ? 'مفتاح AI موجود — النتائج ستكون أدق'
                  : 'بدون مفتاح AI — التحليل محلي (أقل دقة)'}
              </div>
            </div>
            <div className={`toggle ${useAI?'on':'off'}`} onClick={()=>setUseAI(v=>!v)} />
          </div>

          {/* File upload */}
          <div>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>الخيار 1 — رفع ملف المحادثة</div>
            <input ref={fileRef} type="file" accept=".txt,.csv,.json,.zip" onChange={handleFile} style={{ display:'none' }} />
            <div onClick={()=>fileRef.current?.click()} style={{
              border:'2px dashed var(--border2)',borderRadius:'var(--r)',padding:'32px 20px',
              textAlign:'center',cursor:'pointer',transition:'all .2s',
              background:'var(--panel)',
            }}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--ember)';(e.currentTarget as HTMLElement).style.background='rgba(255,77,26,.03)'}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--border2)';(e.currentTarget as HTMLElement).style.background='var(--panel)'}}
            >
              <Upload size={32} style={{ color:'var(--ink3)',marginBottom:12 }} />
              <div style={{ fontSize:14,fontWeight:700,color:'var(--ink1)',marginBottom:4 }}>اسحب الملف هنا أو اضغط للاختيار</div>
              <div style={{ fontSize:12,color:'var(--ink3)' }}>يدعم: .txt .json .csv .zip</div>
            </div>
          </div>

          {/* How to export */}
          <div className="card" style={{ padding:'14px 16px' }}>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:10 }}>كيف تُصدِّر المحادثات</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
              {[
                { src:'💬 واتساب', steps:'الإعدادات ← المحادثات ← تصدير' },
                { src:'💙 مسنجر', steps:'إعدادات المحادثة ← تنزيل معلومات' },
                { src:'📸 إنستغرام', steps:'الإعدادات ← تنزيل البيانات' },
                { src:'📘 فيسبوك', steps:'إعدادات الصفحة ← إعدادات البيانات' },
              ].map(item => (
                <div key={item.src} style={{ background:'var(--void2)',borderRadius:8,padding:'8px 12px' }}>
                  <div style={{ fontSize:12,fontWeight:700,color:'var(--ink1)',marginBottom:2 }}>{item.src}</div>
                  <div style={{ fontSize:11,color:'var(--ink3)' }}>{item.steps}</div>
                </div>
              ))}
            </div>
          </div>

          {/* OR: paste text */}
          <div>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>الخيار 2 — لصق نص المحادثة مباشرة</div>
            <textarea
              className="glass-input"
              rows={6}
              placeholder="الصق هنا نص المحادثة من واتساب أو مسنجر أو أي منصة..."
              value={text}
              onChange={e=>setText(e.target.value)}
              style={{ resize:'none', fontFamily:'monospace', fontSize:12 }}
            />
            <button
              onClick={()=>processText(text)}
              disabled={!text.trim()}
              className="btn btn-aurora"
              style={{ marginTop:8, width:'100%', gap:8, opacity:text.trim()?1:.5 }}>
              <Bot size={15} /> تحليل المحادثة
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Processing ── */}
      {step === 'processing' && (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ width:64,height:64,borderRadius:'50%',background:'rgba(255,77,26,.1)',border:'2px solid var(--ember)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px' }}>
            <Bot size={28} style={{ color:'var(--ember)',animation:'spin 2s linear infinite' }} />
          </div>
          <div style={{ fontSize:18,fontWeight:700,color:'var(--ink1)',marginBottom:8 }}>
            {useAI ? 'AI يحلل المحادثة...' : 'جارٍ استخراج المعلومات...'}
          </div>
          <div style={{ fontSize:13,color:'var(--ink3)',marginBottom:20 }}>
            نبحث عن الأسماء والأرقام والمدن وتفاصيل الطلبات
          </div>
          <div style={{ height:6,background:'var(--panel2)',borderRadius:99,overflow:'hidden',maxWidth:300,margin:'0 auto' }}>
            <div style={{ width:`${progress}%`,height:'100%',background:'var(--ember)',borderRadius:99,transition:'width .5s' }}/>
          </div>
          <div style={{ fontSize:11,color:'var(--ink3)',marginTop:8 }}>{progress}%</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── STEP 3: Review ── */}
      {step === 'review' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          
          {/* Summary bar */}
          <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',
            padding:'12px 16px',background:'rgba(0,200,150,.06)',border:'1px solid rgba(0,200,150,.2)',borderRadius:'var(--r)' }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14,fontWeight:700,color:'var(--ink1)' }}>
                🎉 تم العثور على {customers.length} زبون
              </div>
              <div style={{ fontSize:12,color:'var(--ink3)' }}>
                {selectedCount} محدد للاستيراد — راجع وعدّل قبل الحفظ
              </div>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <button onClick={()=>toggleAll(true)} className="btn btn-ghost btn-sm">تحديد الكل</button>
              <button onClick={()=>toggleAll(false)} className="btn btn-ghost btn-sm">إلغاء الكل</button>
            </div>
          </div>

          {/* Customer cards */}
          {customers.map(c => (
            <div key={c.id} style={{
              background:'var(--panel)',border:`1px solid ${c.selected?'rgba(0,200,150,.3)':'var(--border)'}`,
              borderRadius:'var(--r)',padding:'14px 16px',transition:'all .15s',
            }}>
              <div style={{ display:'flex',alignItems:'flex-start',gap:12 }}>
                {/* Select */}
                <input type="checkbox" checked={c.selected} onChange={()=>toggleOne(c.id)}
                  style={{ marginTop:3,accentColor:'var(--mint)',width:16,height:16,cursor:'pointer' }} />
                
                {/* Info */}
                <div style={{ flex:1,minWidth:0 }}>
                  {editId === c.id ? (
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8 }}>
                      <input className="glass-input" style={{ fontSize:12,padding:'6px 10px' }} value={c.name} onChange={e=>updateCustomer(c.id,'name',e.target.value)} placeholder="الاسم" />
                      <input className="glass-input" style={{ fontSize:12,padding:'6px 10px' }} value={c.phone} onChange={e=>updateCustomer(c.id,'phone',e.target.value)} placeholder="الهاتف" dir="ltr" />
                      <input className="glass-input" style={{ fontSize:12,padding:'6px 10px' }} value={c.city} onChange={e=>updateCustomer(c.id,'city',e.target.value)} placeholder="المدينة" />
                      <input className="glass-input" style={{ fontSize:12,padding:'6px 10px' }} value={c.address} onChange={e=>updateCustomer(c.id,'address',e.target.value)} placeholder="العنوان" />
                      <input className="glass-input" style={{ fontSize:12,padding:'6px 10px',gridColumn:'span 2' }} value={c.notes} onChange={e=>updateCustomer(c.id,'notes',e.target.value)} placeholder="ملاحظات" />
                    </div>
                  ) : (
                    <div style={{ display:'flex',flexWrap:'wrap',gap:12,marginBottom:6 }}>
                      <span style={{ fontSize:14,fontWeight:700,color:'var(--ink1)' }}>
                        {c.name || <span style={{ color:'var(--ink3)' }}>اسم غير محدد</span>}
                      </span>
                      {c.phone && <span style={{ display:'flex',alignItems:'center',gap:4,fontSize:12,color:'var(--ink2)' }} dir="ltr"><Phone size={11}/>{c.phone}</span>}
                      {c.city && <span style={{ display:'flex',alignItems:'center',gap:4,fontSize:12,color:'var(--ink2)' }}><MapPin size={11}/>{c.city}</span>}
                      {c.orders.length > 0 && <span style={{ fontSize:11,color:'var(--gold2)',background:'rgba(201,149,76,.1)',borderRadius:99,padding:'1px 8px' }}>🛒 {c.orders.length} طلب</span>}
                    </div>
                  )}
                  
                  <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
                    <span style={{ fontSize:10,background:'var(--void2)',borderRadius:99,padding:'2px 8px',color:'var(--ink3)' }}>
                      {c.source}
                    </span>
                    <span style={{ fontSize:10,color:c.confidence>=70?'var(--mint)':c.confidence>=40?'var(--gold)':'var(--ember)',
                      background:c.confidence>=70?'rgba(0,200,150,.1)':c.confidence>=40?'rgba(201,149,76,.1)':'rgba(255,77,26,.1)',
                      borderRadius:99,padding:'2px 8px' }}>
                      دقة {c.confidence}%
                    </span>
                    {c.messageCount > 0 && <span style={{ fontSize:10,color:'var(--ink3)' }}>{c.messageCount} رسالة</span>}
                    {c.sizes.length > 0 && <span style={{ fontSize:10,color:'var(--ink2)' }}>📏 {c.sizes.join(' ')}</span>}
                    {c.colors.length > 0 && <span style={{ fontSize:10,color:'var(--ink2)' }}>🎨 {c.colors.join(' ')}</span>}
                  </div>
                </div>
                
                {/* Actions */}
                <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                  <button onClick={()=>setEditId(editId===c.id?null:c.id)} style={{
                    width:28,height:28,borderRadius:7,background:'var(--panel2)',border:'1px solid var(--border)',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                    color:editId===c.id?'var(--mint)':'var(--ink3)',
                  }}>
                    {editId===c.id ? <Check size={12}/> : <Eye size={12}/>}
                  </button>
                  <button onClick={()=>removeCustomer(c.id)} style={{
                    width:28,height:28,borderRadius:7,background:'rgba(255,77,26,.08)',border:'1px solid rgba(255,77,26,.2)',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--ember)',
                  }}>
                    <X size={12}/>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Import button */}
          <div style={{ display:'flex',gap:10,marginTop:4 }}>
            <button onClick={()=>{setStep('upload');setText('');setCustomers([]);}} className="btn btn-ghost">
              ← رجوع
            </button>
            <button onClick={importSelected} disabled={importing||selectedCount===0}
              className="btn btn-aurora" style={{ flex:1,gap:8,opacity:selectedCount===0?.5:1 }}>
              {importing
                ? <><span style={{ animation:'spin 1s linear infinite' }}>⟳</span> جارٍ الاستيراد...</>
                : <><Users size={15}/> استيراد {selectedCount} زبون</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ── */}
      {step === 'done' && (
        <div style={{ textAlign:'center',padding:'60px 20px' }}>
          <div style={{ width:72,height:72,borderRadius:'50%',background:'rgba(0,200,150,.12)',border:'2px solid var(--mint)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px' }}>
            <Check size={36} style={{ color:'var(--mint)' }}/>
          </div>
          <h2 style={{ fontSize:22,fontWeight:900,color:'var(--ink1)',marginBottom:8 }}>
            تم استيراد {importedCount} زبون! 🎉
          </h2>
          <p style={{ fontSize:14,color:'var(--ink2)',marginBottom:24,lineHeight:1.7 }}>
            يمكنك الآن رؤية زبائنك في صفحة الزبائن وإدارة طلباتهم
          </p>
          <div style={{ display:'flex',gap:10,justifyContent:'center' }}>
            <button onClick={()=>{setStep('upload');setText('');setCustomers([]);setProgress(0);}} className="btn btn-ghost">
              استيراد محادثة أخرى
            </button>
            <button onClick={()=>window.location.hash='customers'} className="btn btn-aurora">
              <Users size={15}/> عرض الزبائن
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
