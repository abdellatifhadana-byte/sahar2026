import { useStore } from '../store';
import { Share2, MessageCircle, Phone, ShoppingCart, Star, Search } from 'lucide-react';
import { useState } from 'react';

export default function CatalogPage() {
  const { settings, products } = useStore();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');

  const published = products.filter(p =>
    p.status === 'published' && p.stock > 0 &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
    (cat === 'all' || p.category === cat)
  );

  const cats = ['all', ...Array.from(new Set(products.filter(p => p.status === 'published').map(p => p.category)))];

  const share = async () => {
    const url = `${window.location.origin}?catalog=1`;
    try {
      if (navigator.share) await navigator.share({ title: settings.brand.name, url });
      else { await navigator.clipboard.writeText(url); alert('✅ تم نسخ رابط الكتالوج!'); }
    } catch {}
  };

  const orderOnWhatsApp = (product: any) => {
    const phone = settings.brand.phone?.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `مرحباً! 👋\nأريد الطلب:\n\n${product.emoji || '📦'} ${product.name}\nالسعر: ${product.price} ${settings.brand.currency}\n\nهل المنتج متوفر؟`
    );
    const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
  };

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', background: 'var(--clr-space)', fontFamily: 'Tajawal, sans-serif' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--nav-bg)', backdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--clr-border)',
        padding: '0 16px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--clr-pri-g)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {settings.brand.name[0]?.toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)', lineHeight: 1.2 }}>{settings.brand.name}</p>
            {settings.brand.description && <p style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>{settings.brand.description}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {settings.brand.phone && (
            <a href={`tel:${settings.brand.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: 'rgba(255,255,255,0.07)', border: '1px solid var(--clr-border)', color: 'var(--txt-2)', textDecoration: 'none' }}>
              <Phone size={14} /> اتصل
            </a>
          )}
          <button onClick={share} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: 'var(--clr-pri-g)', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <Share2 size={14} /> مشاركة
          </button>
        </div>
      </header>

      {/* Background */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(ellipse 80% 50% at 70% 0%, rgba(99,102,241,0.07) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 20% 90%, rgba(249,115,22,0.05) 0%, transparent 60%)' }} />

      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '24px 16px 20px', marginBottom: 24 }}>
          <img src="/logo-sahar.png" alt="Sahar Shop" style={{ width: 60, height: 60, margin: '0 auto 12px', display: 'block', filter: 'drop-shadow(0 0 12px rgba(249,115,22,0.4))' }} />
          <h1 style={{ fontSize: 26, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 8 }}>
            🛍️ منتجات Sahar Shop
          </h1>
          <p style={{ fontSize: 14, color: 'var(--txt-3)' }}>
            {published.length} منتج متوفر — ملابس، أحذية، إكسسوارات 🇲🇦
          </p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--txt-3)', pointerEvents: 'none' }} />
          <input
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--clr-border)', borderRadius: 12, padding: '11px 40px 11px 14px', color: 'var(--txt-1)', fontSize: 14, outline: 'none', fontFamily: 'Tajawal, sans-serif', boxSizing: 'border-box' }}
            placeholder="ابحث عن منتج..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Categories */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 20 }}>
          {cats.map(c => (
            <button key={c} onClick={() => setCat(c)}
              style={{ flexShrink: 0, padding: '7px 15px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${cat === c ? 'rgba(99,102,241,0.5)' : 'var(--clr-border)'}`, background: cat === c ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.04)', color: cat === c ? '#a5b4fc' : 'var(--txt-3)' }}>
              {c === 'all' ? '🏪 الكل' : c}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {published.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--txt-3)' }}>
            <ShoppingCart size={48} style={{ marginBottom: 12, opacity: .3 }} />
            <p style={{ fontSize: 16, fontWeight: 700 }}>لا توجد منتجات متاحة حالياً</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            {published.map(p => (
              <div key={p.id} style={{
                background: 'var(--clr-card)', borderRadius: 20,
                border: '1px solid var(--clr-border)',
                overflow: 'hidden', transition: 'all .22s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 40px rgba(0,0,0,0.4)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
                {/* Image */}
                <div style={{ position: 'relative' }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: 170, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60, background: 'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.08))' }}>
                      {p.emoji || '📦'}
                    </div>
                  )}
                  {/* Stock badge */}
                  {p.stock <= 5 && p.stock > 0 && (
                    <span style={{ position: 'absolute', top: 8, right: 8, padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 900, background: 'rgba(245,158,11,0.85)', color: '#fff' }}>
                      آخر {p.stock} قطع!
                    </span>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '14px 14px 16px' }}>
                  <h3 style={{ fontSize: 14.5, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</h3>
                  {p.description && <p style={{ fontSize: 12, color: 'var(--txt-3)', marginBottom: 8, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>}

                  {/* Sizes */}
                  {p.sizes.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                      {p.sizes.map(s => (
                        <span key={s} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.07)', border: '1px solid var(--clr-border)', color: 'var(--txt-3)' }}>{s}</span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--txt-1)' }}>
                      {p.price} <span style={{ fontSize: 12, color: 'var(--txt-3)', fontWeight: 600 }}>{settings.brand.currency}</span>
                    </span>
                    {p.sales > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: '#fbbf24', fontWeight: 700 }}>
                        <Star size={12} fill="#fbbf24" /> {p.sales} مبيعة
                      </span>
                    )}
                  </div>

                  <button onClick={() => orderOnWhatsApp(p)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 12, fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#25d366,#128C7E)', color: '#fff', transition: 'all .18s' }}
                    onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
                    onMouseLeave={e => (e.currentTarget.style.filter = '')}>
                    <MessageCircle size={16} /> اطلب عبر واتساب
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 40, padding: '24px 20px', borderTop: '1px solid var(--clr-border)', background: 'rgba(0,0,0,0.2)', borderRadius: 16 }}>
          <img src="/logo-sahar.png" alt="Sahar Shop" style={{ width: 40, height: 40, margin: '0 auto 10px', display: 'block' }} />
          <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 4 }}>Sahar Shop</p>
          <p style={{ fontSize: 12, color: 'var(--txt-3)', marginBottom: 12 }}>ملابس · أحذية · إكسسوارات — رجال، نساء، أطفال</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {settings.brand.phone && <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>📞 {settings.brand.phone}</span>}
            <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>📍 Casablanca</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--txt-3)' }}>🚀 مدعوم بـ AI Commerce OS</p>
        </div>
      </main>
    </div>
  );
}
