import { useStore } from '../store';
import { ShoppingBag, Store, ArrowLeft, Sparkles } from 'lucide-react';

export default function LandingPage() {
  const { token, user } = useStore();

  // Get the store URL for the current merchant (if logged in)
  const userId = user?.id || (() => {
    try { const u = localStorage.getItem('ai_commerce_user'); return u ? JSON.parse(u)?.id : null; } catch { return null; }
  })();

  const storeUrl  = userId ? `/store/${userId}` : null;
  const isAuthed  = !!token || token === 'demo-token-local';

  return (
    <div dir="rtl" style={{
      minHeight: '100dvh',
      background: 'var(--void)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', padding: 20,
    }}>
      {/* Background gradient */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,77,26,.09) 0%, transparent 60%)',
      }} />

      {/* Zellige top decoration */}
      <svg style={{ position:'absolute',top:0,left:0,right:0,width:'100%',height:60,opacity:.07,pointerEvents:'none' }}
        viewBox="0 0 600 60" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {Array.from({length:28},(_,i)=>(
          <polygon key={i} points={`${i*22},0 ${i*22+11},11 ${i*22},22 ${i*22-11},11`}
            fill={['#FF4D1A','#C9954C','#00C896'][i%3]}/>
        ))}
      </svg>

      <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:900, textAlign:'center' }}>

        {/* Logo + Title */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, background: 'var(--ember)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', fontSize: 32, fontWeight: 900, color: '#fff',
            boxShadow: '0 8px 32px rgba(255,77,26,.4)',
          }}>م</div>
          <h1 style={{
            fontSize: 'clamp(26px, 5vw, 44px)', fontWeight: 900, color: 'var(--ink1)',
            marginBottom: 10, letterSpacing: '-0.03em',
          }}>
            {isAuthed ? `مرحباً في متجرك 🎉` : 'Sahar Shop OS'}
          </h1>
          <p style={{ fontSize: 16, color: 'var(--ink3)', maxWidth: 480, margin: '0 auto' }}>
            منصة البيع الذكية للسوق المغربي — بالدارجة، بالذكاء الاصطناعي
          </p>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:12 }}>
            <div className="dot-live" />
            <span style={{ fontSize:12, color:'var(--mint)', fontWeight:700 }}>AI نشط · يرد بالدارجة</span>
          </div>
        </div>

        {/* Two cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20, marginBottom: 32,
        }}>

          {/* CUSTOMER CARD */}
          <a
            href={storeUrl || '#'}
            onClick={e => {
              if (!storeUrl) {
                e.preventDefault();
                window.alert('المتجر غير متاح حالياً. اطلب من التاجر مشاركة رابط متجره معك.');
              }
            }}
            style={{
              background: 'var(--panel)', border: '1px solid var(--border)',
              borderRadius: 24, padding: 36, textDecoration: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              cursor: 'pointer', transition: 'all 0.25s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,200,150,.4)';
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
              (e.currentTarget as HTMLElement).style.background = 'rgba(0,200,150,.05)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.transform = '';
              (e.currentTarget as HTMLElement).style.background = 'var(--panel)';
            }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'rgba(0,200,150,.12)', border: '1px solid rgba(0,200,150,.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20, color: 'var(--mint)',
            }}>
              <ShoppingBag size={28} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink1)', marginBottom: 10 }}>
              تسوق الآن
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24, lineHeight: 1.7, textAlign:'center' }}>
              اكتشف المنتجات، أضف للسلة، واطلب مع توصيل لباب منزلك 🚚
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              color: 'var(--mint)', fontWeight: 800, fontSize: 14,
            }}>
              دخول كزبون <ArrowLeft size={16} />
            </div>
          </a>

          {/* MERCHANT CARD */}
          <a
            href={isAuthed ? '/dashboard' : '/login'}
            style={{
              background: 'var(--panel)', border: '1px solid var(--border)',
              borderRadius: 24, padding: 36, textDecoration: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              cursor: 'pointer', transition: 'all 0.25s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,77,26,.4)';
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)';
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,77,26,.05)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLElement).style.transform = '';
              (e.currentTarget as HTMLElement).style.background = 'var(--panel)';
            }}
          >
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'rgba(255,77,26,.12)', border: '1px solid rgba(255,77,26,.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20, color: 'var(--ember)',
            }}>
              <Store size={28} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink1)', marginBottom: 10 }}>
              {isAuthed ? 'لوحة التحكم' : 'إنشاء متجرك'}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24, lineHeight: 1.7, textAlign:'center' }}>
              {isAuthed
                ? 'أدر منتجاتك، طلباتك، وزبائنك من لوحة التحكم الذكية 🔥'
                : 'ابدأ بيعك اليوم — أضف منتجاتك وشارك رابطك مع زبائنك مجاناً'}
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              color: 'var(--ember)', fontWeight: 800, fontSize: 14,
            }}>
              {isAuthed ? 'الدخول للوحة' : 'دخول كتاجر'} <ArrowLeft size={16} />
            </div>
          </a>
        </div>

        {/* Features strip */}
        <div style={{ display:'flex', justifyContent:'center', gap:20, flexWrap:'wrap' }}>
          {[
            { icon:'🤖', text:'AI بالدارجة' },
            { icon:'📱', text:'واتساب مدمج' },
            { icon:'🚚', text:'توصيل تلقائي' },
            { icon:'📊', text:'تحليلات ذكية' },
          ].map(f => (
            <div key={f.text} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'var(--ink3)' }}>
              <span>{f.icon}</span><span>{f.text}</span>
            </div>
          ))}
        </div>

        {/* AI Badge */}
        <div style={{ marginTop: 32, display:'inline-flex', alignItems:'center', gap:8,
          padding:'8px 18px', borderRadius:99,
          background:'rgba(201,149,76,.08)', border:'1px solid rgba(201,149,76,.2)' }}>
          <Sparkles size={14} style={{ color:'var(--gold2)' }}/>
          <span style={{ fontSize:12, fontWeight:700, color:'var(--gold2)' }}>
            Powered by AI · مصنوع للسوق المغربي
          </span>
        </div>
      </div>
    </div>
  );
}
