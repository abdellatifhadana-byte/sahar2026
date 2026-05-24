import { useStore } from '../store';
import { ShoppingBag, Store, ArrowLeft, Sparkles, Bot, Truck, BarChart3, MessageCircle } from 'lucide-react';

export default function LandingPage() {
  const { token, user } = useStore();

  const userId = user?.id || (() => {
    try { const u = localStorage.getItem('ai_commerce_user'); return u ? JSON.parse(u)?.id : null; } catch { return null; }
  })();

  const storeUrl = userId ? `/store/${userId}` : null;
  const isAuthed = !!token || token === 'demo-token-local';

  return (
    <div dir="rtl" style={{
      minHeight: '100dvh',
      background: '#07080D',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative', overflow: 'hidden',
    }}>

      {/* ── HERO BACKGROUND ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse 100% 60% at 50% 0%, rgba(255,77,26,.08) 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 80% 60%, rgba(0,200,150,.05) 0%, transparent 50%)',
        pointerEvents: 'none',
      }} />

      {/* Zellige pattern top */}
      <svg style={{ position:'absolute',top:0,left:0,width:'100%',height:50,opacity:.06,pointerEvents:'none',zIndex:1 }}
        viewBox="0 0 800 50" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {Array.from({length:38},(_,i)=>(
          <polygon key={i} points={`${i*22},0 ${i*22+11},11 ${i*22},22 ${i*22-11},11`}
            fill={['#FF4D1A','#C9954C','#00C896','#FF4D1A','#C9954C'][i%5]}/>
        ))}
      </svg>

      {/* ── MAIN CONTENT ── */}
      <div style={{ position:'relative', zIndex:2, width:'100%', maxWidth:960, padding:'48px 20px 40px', textAlign:'center' }}>

        {/* LOGO — Real Sahar Shop logo */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            width: 140, height: 140, margin: '0 auto 20px',
            borderRadius: 32,
            overflow: 'hidden',
            boxShadow: '0 12px 48px rgba(255,77,26,.35), 0 0 0 1px rgba(255,255,255,.06)',
            background: '#07080D',
          }}>
            <img
              src="/sahar-logo-text.png"
              alt="SAHAR shop"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                (e.currentTarget.parentElement as HTMLElement).innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:52px;font-weight:900;color:#FF4D1A;font-family:monospace">S</div>';
              }}
            />
          </div>
          <h1 style={{
            fontSize: 'clamp(24px, 6vw, 46px)', fontWeight: 900, color: '#E8E4DC',
            marginBottom: 8, letterSpacing: '-0.03em', lineHeight: 1.1,
          }}>
            <span style={{ color: '#FF4D1A' }}>SAHAR</span>{' '}
            <span style={{ color: '#E8E4DC' }}>shop</span>
          </h1>
          <p style={{
            fontSize: 13, color: '#5C5854', fontWeight: 700,
            letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 14,
          }}>
            AI commerce OS
          </p>
          <p style={{ fontSize: 15, color: '#A8A49C', maxWidth: 420, margin: '0 auto 16px', lineHeight: 1.7 }}>
            نظام تشغيل التجارة الإلكترونية بالذكاء الاصطناعي<br/>
            <span style={{ color: '#FF4D1A', fontWeight: 700 }}>مصنوع للسوق المغربي</span>
          </p>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <div style={{ width:7,height:7,borderRadius:'50%',background:'#00C896',boxShadow:'0 0 8px #00C896',animation:'pulse 2s infinite' }} />
            <span style={{ fontSize:12, color:'#00C896', fontWeight:700 }}>AI نشط · يرد بالدارجة المغربية</span>
          </div>
        </div>

        {/* ── ACTION CARDS ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16, marginBottom: 36,
        }}>

          {/* CUSTOMER CARD */}
          <a href={storeUrl || '#'}
            onClick={e => { if (!storeUrl) { e.preventDefault(); window.alert('اطلب من التاجر مشاركة رابط متجره معك.'); } }}
            style={{ background:'rgba(0,200,150,.06)', border:'1.5px solid rgba(0,200,150,.2)', borderRadius:24, padding:'28px 24px', textDecoration:'none', display:'flex', flexDirection:'column', alignItems:'center', transition:'all .25s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor='rgba(0,200,150,.5)'; el.style.transform='translateY(-4px)'; el.style.background='rgba(0,200,150,.1)'; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor='rgba(0,200,150,.2)'; el.style.transform=''; el.style.background='rgba(0,200,150,.06)'; }}
          >
            <div style={{ width:60,height:60,borderRadius:16,background:'rgba(0,200,150,.15)',border:'1px solid rgba(0,200,150,.3)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:16,color:'#00C896' }}>
              <ShoppingBag size={26}/>
            </div>
            <h2 style={{ fontSize:20,fontWeight:900,color:'#E8E4DC',marginBottom:8 }}>🛍️ تسوق الآن</h2>
            <p style={{ fontSize:13,color:'#5C5854',marginBottom:20,lineHeight:1.7,textAlign:'center' }}>
              تصفح المنتجات، أضف للسلة، واطلب مع توصيل سريع لباب منزلك
            </p>
            <div style={{ display:'flex',alignItems:'center',gap:6,color:'#00C896',fontWeight:800,fontSize:13 }}>
              دخول كزبون <ArrowLeft size={14}/>
            </div>
          </a>

          {/* MERCHANT CARD */}
          <a href={isAuthed ? '/dashboard' : '/login'}
            style={{ background:'rgba(255,77,26,.06)', border:'1.5px solid rgba(255,77,26,.2)', borderRadius:24, padding:'28px 24px', textDecoration:'none', display:'flex', flexDirection:'column', alignItems:'center', transition:'all .25s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor='rgba(255,77,26,.5)'; el.style.transform='translateY(-4px)'; el.style.background='rgba(255,77,26,.1)'; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor='rgba(255,77,26,.2)'; el.style.transform=''; el.style.background='rgba(255,77,26,.06)'; }}
          >
            <div style={{ width:60,height:60,borderRadius:16,background:'rgba(255,77,26,.15)',border:'1px solid rgba(255,77,26,.3)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:16,color:'#FF4D1A' }}>
              <Store size={26}/>
            </div>
            <h2 style={{ fontSize:20,fontWeight:900,color:'#E8E4DC',marginBottom:8 }}>
              {isAuthed ? '🔥 لوحة التحكم' : '🏪 ابدأ متجرك'}
            </h2>
            <p style={{ fontSize:13,color:'#5C5854',marginBottom:20,lineHeight:1.7,textAlign:'center' }}>
              {isAuthed ? 'أدر منتجاتك، طلباتك، وزبائنك بالذكاء الاصطناعي' : 'أضف منتجاتك وشارك رابط متجرك مع زبائنك مجاناً'}
            </p>
            <div style={{ display:'flex',alignItems:'center',gap:6,color:'#FF4D1A',fontWeight:800,fontSize:13 }}>
              {isAuthed ? 'الدخول للوحة' : 'دخول كتاجر'} <ArrowLeft size={14}/>
            </div>
          </a>
        </div>

        {/* ── FEATURES ROW ── */}
        <div style={{ display:'flex',justifyContent:'center',gap:8,flexWrap:'wrap',marginBottom:32 }}>
          {[
            { icon:<Bot size={14}/>, label:'AI بالدارجة', color:'#FF4D1A' },
            { icon:<MessageCircle size={14}/>, label:'واتساب مدمج', color:'#25D366' },
            { icon:<Truck size={14}/>, label:'توصيل تلقائي', color:'#00C896' },
            { icon:<BarChart3 size={14}/>, label:'تحليلات ذكية', color:'#C9954C' },
            { icon:<Sparkles size={14}/>, label:'بنر AI', color:'#a78bfa' },
          ].map(f => (
            <div key={f.label} style={{ display:'flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:99,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.07)',color:f.color,fontSize:12,fontWeight:600 }}>
              {f.icon} {f.label}
            </div>
          ))}
        </div>

        {/* ── CONTACT BAR ── */}
        <div style={{
          display:'flex',justifyContent:'center',gap:20,flexWrap:'wrap',
          padding:'16px 24px',
          background:'rgba(255,255,255,.03)',
          border:'1px solid rgba(255,255,255,.06)',
          borderRadius:16,
          fontSize:12,color:'#5C5854',
        }}>
          <a href="https://wa.me/212612265893" target="_blank" rel="noreferrer"
            style={{ display:'flex',alignItems:'center',gap:6,color:'#25D366',fontWeight:700,textDecoration:'none' }}>
            💬 +212612265893
          </a>
          <span style={{ color:'#2E2C2A' }}>|</span>
          <span style={{ display:'flex',alignItems:'center',gap:5,color:'#5C5854' }}>
            📍 Casablanca, Maroc
          </span>
          <span style={{ color:'#2E2C2A' }}>|</span>
          <span style={{ display:'flex',alignItems:'center',gap:5,color:'#C9954C',fontWeight:700 }}>
            <Sparkles size={11}/> AI commerce OS
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}
