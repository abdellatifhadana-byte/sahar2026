import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, ShoppingCart, X, MessageCircle, Phone, Share2,
  Plus, Minus, Check, Package, Truck, MapPin, ChevronRight,
  Star, Zap, Heart, Send, Bot, ArrowRight, RotateCcw
} from 'lucide-react';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════
interface SProduct {
  id:string; name:string; description:string; price:number; cost?:number;
  stock:number; category:string; sizes:string[]; colors:string[];
  status:string; emoji:string; imageUrl:string; images:string[]; sku?:string;
  sales:number; views?:number;
}
interface CartItem { product:SProduct; quantity:number; size:string; color:string; }
interface StoreInfo { brand:{name:string;phone:string;currency:string;logo?:string;description?:string;instagram?:string;facebook?:string;whatsapp?:string;email?:string}; deliveryCosts?:Record<string,number>; }
interface ChatMsg { role:'user'|'ai'; content:string; product?:SProduct; }

// ══════════════════════════════════════════════
// MOROCCAN CITIES + DELIVERY COST
// ══════════════════════════════════════════════
const MOROCCAN_CITIES = [
  'الدار البيضاء','الرباط','فاس','مراكش','طنجة','أكادير','مكناس','وجدة',
  'سلا','تطوان','القنيطرة','الجديدة','بني ملال','خريبكة','تازة','نادور',
  'الحسيمة','برشيد','سطات','آسفي','الرحامنة','قلعة السراغنة','خنيفرة',
  'إفران','ورزازات','زاكورة','الراشيدية','فيكيك','طاطا','ميدلت',
];

const DEFAULT_COSTS: Record<string,number> = {
  'الدار البيضاء':20,'الرباط':25,'فاس':30,'مراكش':30,'طنجة':35,
  'أكادير':35,'مكناس':30,'وجدة':40,'سلا':25,'تطوان':35,
  'القنيطرة':30,'الجديدة':35,'بني ملال':40,
};

function getDeliveryCost(city:string, costs?:Record<string,number>):number {
  const allCosts = { ...DEFAULT_COSTS, ...(costs||{}) };
  for (const [k,v] of Object.entries(allCosts)) {
    if (city.includes(k) || k.includes(city)) return v;
  }
  return allCosts['default'] || 40;
}

// ══════════════════════════════════════════════
// HOOKS
// ══════════════════════════════════════════════
function useStorefront(userId:string) {
  const [products, setProducts] = useState<SProduct[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreInfo|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!userId) { setError('رابط المتجر غير صحيح'); setLoading(false); return; }
    Promise.all([
      fetch(`/api/products/public/catalog?userId=${userId}`).then(r => r.json()),
    ]).then(([catalog]) => {
      setProducts(catalog.products || []);
      setStoreInfo({ brand: catalog.brand || {}, deliveryCosts: catalog.deliveryCosts });
      setLoading(false);
    }).catch(() => { setError('تعذّر تحميل المتجر'); setLoading(false); });
  }, [userId]);

  return { products, storeInfo, loading, error };
}

// ══════════════════════════════════════════════
// CART HOOK
// ══════════════════════════════════════════════
function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  const add = (product:SProduct, size:string, color:string) => {
    setItems(prev => {
      const existing = prev.find(i => i.product.id===product.id && i.size===size && i.color===color);
      if (existing) return prev.map(i => i===existing ? {...i,quantity:i.quantity+1} : i);
      return [...prev, { product, quantity:1, size, color }];
    });
  };
  const remove = (productId:string, size:string, color:string) =>
    setItems(prev => prev.filter(i => !(i.product.id===productId && i.size===size && i.color===color)));
  const update = (productId:string, size:string, color:string, qty:number) =>
    setItems(prev => qty <= 0
      ? prev.filter(i => !(i.product.id===productId && i.size===size && i.color===color))
      : prev.map(i => (i.product.id===productId && i.size===size && i.color===color) ? {...i,quantity:qty} : i));
  const total  = items.reduce((s,i) => s+i.product.price*i.quantity, 0);
  const count  = items.reduce((s,i) => s+i.quantity, 0);
  const clear  = () => setItems([]);
  return { items, add, remove, update, total, count, clear };
}

// ══════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════

/* Product Card */
function ProductCard({ p, onAdd, onView, currency }: { p:SProduct; onAdd:(p:SProduct)=>void; onView:(p:SProduct)=>void; currency:string }) {
  const [liked, setLiked] = useState(false);
  return (
    <div onClick={() => onView(p)} style={{
      background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--r-lg)',
      overflow:'hidden',cursor:'pointer',transition:'all .2s',
    }}
      onMouseOver={e => (e.currentTarget.style.transform='translateY(-3px)')}
      onMouseOut={e  => (e.currentTarget.style.transform='translateY(0)')}
    >
      <div style={{ height:220,position:'relative',background:p.imageUrl?'#000':'var(--void2)',overflow:'hidden' }}>
        {p.imageUrl
          ? <img src={p.imageUrl} alt={p.name} style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" />
          : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:64 }}>{p.emoji||'📦'}</div>
        }
        {/* Badges */}
        <div style={{ position:'absolute',top:10,right:10,display:'flex',flexDirection:'column',gap:5 }}>
          {p.stock <= 5 && p.stock > 0 && <span style={{ background:'rgba(245,158,11,.9)',color:'#fff',fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99 }}>آخر {p.stock} قطع</span>}
          {p.sales > 10 && <span style={{ background:'rgba(255,77,26,.9)',color:'#fff',fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99 }}>الأكثر طلباً 🔥</span>}
        </div>
        {/* Like */}
        <button onClick={e=>{e.stopPropagation();setLiked(v=>!v)}} style={{
          position:'absolute',top:10,left:10,width:32,height:32,borderRadius:'50%',
          background:'rgba(0,0,0,.4)',border:'none',color:liked?'#ef4444':'#fff',cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          <Heart size={15} fill={liked?'#ef4444':'none'} />
        </button>
        {/* Quick add */}
        <button onClick={e=>{e.stopPropagation();onAdd(p)}} style={{
          position:'absolute',bottom:10,left:10,right:10,height:36,background:'var(--ember)',
          border:'none',borderRadius:8,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',gap:6,opacity:0,transition:'opacity .2s',
        }}
          className="quick-add-btn">
          <ShoppingCart size={14} /> أضف للسلة
        </button>
      </div>
      <div style={{ padding:'12px 14px' }}>
        <div style={{ fontSize:10,color:'var(--ink3)',marginBottom:3,fontWeight:600,letterSpacing:'.04em' }}>{p.category}</div>
        <div style={{ fontSize:14,fontWeight:700,color:'var(--ink1)',marginBottom:6,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' }}>{p.name}</div>
        {p.sizes?.length > 0 && (
          <div style={{ display:'flex',gap:4,flexWrap:'wrap',marginBottom:8 }}>
            {p.sizes.slice(0,4).map(s=>(
              <span key={s} style={{ fontSize:10,background:'var(--void2)',border:'1px solid var(--border)',borderRadius:5,padding:'1px 6px',color:'var(--ink2)' }}>{s}</span>
            ))}
          </div>
        )}
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div style={{ fontSize:18,fontWeight:900,color:'var(--ember)',letterSpacing:'-0.03em' }}>
            {p.price.toLocaleString()} <span style={{ fontSize:12 }}>{currency}</span>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:3,fontSize:11,color:'var(--gold)' }}>
            <Star size={12} fill="var(--gold)" stroke="none" /> 4.9
          </div>
        </div>
      </div>
      <style>{`.quick-add-btn{opacity:0!important} *:hover>.quick-add-btn,.card-lift:hover .quick-add-btn{opacity:1!important}`}</style>
    </div>
  );
}

/* Product Detail Modal */
function ProductModal({ p, cart, onClose, currency, userId }: { p:SProduct; cart:ReturnType<typeof useCart>; onClose:()=>void; currency:string; userId:string }) {
  const [size,  setSize]  = useState(p.sizes?.[0]||'');
  const [color, setColor] = useState(p.colors?.[0]||'');
  const [qty,   setQty]   = useState(1);
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    cart.add(p, size, color);
    for (let i = 0; i < qty-1; i++) cart.add(p, size, color);
    setAdded(true);
    setTimeout(() => { setAdded(false); onClose(); }, 1000);
  };

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.7)',backdropFilter:'blur(8px)',zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'0' }}
      className="anim-fade-up">
      <div onClick={e=>e.stopPropagation()} style={{
        background:'var(--panel)',borderRadius:'24px 24px 0 0',width:'100%',maxWidth:520,
        maxHeight:'90vh',overflowY:'auto',padding:'0 0 24px',
      }}>
        {/* Image */}
        <div style={{ height:260,position:'relative',background:p.imageUrl?'#000':'var(--void2)' }}>
          {p.imageUrl
            ? <img src={p.imageUrl} alt={p.name} style={{ width:'100%',height:'100%',objectFit:'cover' }} />
            : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:80 }}>{p.emoji||'📦'}</div>
          }
          <button onClick={onClose} style={{ position:'absolute',top:14,left:14,width:34,height:34,borderRadius:'50%',background:'rgba(0,0,0,.5)',border:'none',color:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <X size={17} />
          </button>
          {p.sales > 0 && <div style={{ position:'absolute',bottom:14,right:14,background:'var(--ember)',color:'#fff',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:99 }}>{p.sales}+ مبيعة</div>}
        </div>

        <div style={{ padding:'20px 20px 0' }}>
          <div style={{ fontSize:11,color:'var(--ink3)',marginBottom:4 }}>{p.category} {p.sku ? `· #${p.sku}` : ''}</div>
          <h2 style={{ fontSize:20,fontWeight:900,color:'var(--ink1)',marginBottom:8 }}>{p.name}</h2>
          {p.description && <p style={{ fontSize:13,color:'var(--ink2)',lineHeight:1.6,marginBottom:14 }}>{p.description}</p>}

          {/* Price */}
          <div style={{ fontSize:28,fontWeight:900,color:'var(--ember)',letterSpacing:'-0.04em',marginBottom:18 }}>
            {p.price.toLocaleString()} {currency}
          </div>

          {/* Sizes */}
          {p.sizes?.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>المقاس</div>
              <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
                {p.sizes.map(s => (
                  <button key={s} onClick={()=>setSize(s)} style={{
                    padding:'6px 14px',borderRadius:8,border:`1.5px solid ${size===s?'var(--ember)':'var(--border2)'}`,
                    background:size===s?'rgba(255,77,26,.12)':'transparent',
                    color:size===s?'var(--ember2)':'var(--ink2)',
                    fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s',
                  }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          {p.colors?.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>اللون</div>
              <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
                {p.colors.map(c => (
                  <button key={c} onClick={()=>setColor(c)} style={{
                    padding:'6px 14px',borderRadius:8,border:`1.5px solid ${color===c?'var(--ember)':'var(--border2)'}`,
                    background:color===c?'rgba(255,77,26,.12)':'transparent',
                    color:color===c?'var(--ember2)':'var(--ink2)',
                    fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s',
                  }}>{c}</button>
                ))}
              </div>
            </div>
          )}

          {/* Qty */}
          <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:20 }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)' }}>الكمية</div>
            <div style={{ display:'flex',alignItems:'center',gap:8,background:'var(--void2)',borderRadius:8,padding:'4px 8px' }}>
              <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:26,height:26,borderRadius:6,background:'var(--panel)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><Minus size={12}/></button>
              <span style={{ fontSize:15,fontWeight:700,color:'var(--ink1)',minWidth:24,textAlign:'center' }}>{qty}</span>
              <button onClick={()=>setQty(q=>Math.min(p.stock,q+1))} style={{ width:26,height:26,borderRadius:6,background:'var(--panel)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><Plus size={12}/></button>
            </div>
            <span style={{ fontSize:11,color:'var(--ink3)' }}>{p.stock} متوفرة</span>
          </div>

          <button onClick={handleAdd} style={{
            width:'100%',height:50,background:added?'var(--mint)':'var(--ember)',
            border:'none',borderRadius:'var(--r)',color:'#fff',fontSize:15,fontWeight:700,
            cursor:'pointer',transition:'all .2s',
            display:'flex',alignItems:'center',justifyContent:'center',gap:8,
            boxShadow:`0 4px 16px ${added?'rgba(0,200,150,.3)':'rgba(255,77,26,.35)'}`,
          }}>
            {added ? <><Check size={18}/> تمت الإضافة!</> : <><ShoppingCart size={16}/> أضف للسلة — {(p.price*qty).toLocaleString()} {currency}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Cart Sidebar */
function CartSidebar({ cart, storeInfo, userId, onClose, onOrderSuccess }: { cart:ReturnType<typeof useCart>; storeInfo:StoreInfo; userId:string; onClose:()=>void; onOrderSuccess:(orderId:string)=>void }) {
  const [step, setStep] = useState<'cart'|'checkout'|'success'>('cart');
  const [form, setForm] = useState({ name:'', phone:'', city:'', address:'', notes:'', subscribe:true });
  const [citySearch, setCitySearch] = useState('');
  const [showCities, setShowCities] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState('');
  const cur = storeInfo.brand.currency || 'MAD';
  const deliveryCost = getDeliveryCost(form.city, storeInfo.deliveryCosts);
  const grandTotal   = cart.total + deliveryCost;

  const filteredCities = MOROCCAN_CITIES.filter(c => c.includes(citySearch) || citySearch === '');

  const handleOrder = async () => {
    if (!form.name || !form.phone || !form.city) {
      alert('الاسم الكامل، الهاتف والمدينة مطلوبون'); return;
    }
    setLoading(true);
    try {
      const items = cart.items.map(i => ({
        productId: i.product.id, productName: i.product.name,
        price: i.product.price, quantity: i.quantity, size: i.size, color: i.color,
      }));
      const r = await fetch('/api/orders/public', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          userId, items, customerName: form.name, customerPhone: form.phone,
          city: form.city, address: form.address, total: grandTotal,
          source: 'Storefront', notes: `${form.notes}${form.subscribe?' · يريد عروض':''}`
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);

      setOrderId(data.order.id);

      // Open WhatsApp for confirmation
      const phone = storeInfo.brand.phone?.replace(/\D/g,'');
      const itemsText = cart.items.map(i=>`• ${i.product.name} (${i.size} ${i.color}) x${i.quantity} — ${i.product.price*i.quantity} ${cur}`).join('\n');
      const msg = `مرحباً ${storeInfo.brand.name}! 👋\n\nأريد تأكيد طلبي:\n\n${itemsText}\n\n💰 المجموع: ${cart.total} ${cur}\n🚚 التوصيل: ${deliveryCost} ${cur}\n💵 الإجمالي: ${grandTotal} ${cur}\n\n👤 الاسم: ${form.name}\n📱 الهاتف: ${form.phone}\n📍 المدينة: ${form.city}\n🏠 العنوان: ${form.address||'—'}\n\nرقم الطلب: ${data.order.id}`;
      if (phone) setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank'), 500);

      cart.clear();
      setStep('success');
      onOrderSuccess(data.order.id);
    } catch (e: any) {
      alert(`حدث خطأ: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div style={{ position:'fixed',inset:0,zIndex:400,display:'flex' }}>
      <div onClick={onClose} style={{ flex:1,background:'rgba(0,0,0,.6)',backdropFilter:'blur(4px)' }} />
      <div style={{ width:Math.min(400,window.innerWidth),background:'var(--panel)',borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflowY:'auto',animation:'slide-in .25s ease' }}>

        {/* Header */}
        <div style={{ padding:'16px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10 }}>
          <button onClick={onClose} style={{ width:32,height:32,borderRadius:8,background:'var(--panel2)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><X size={16}/></button>
          <div style={{ flex:1,fontSize:15,fontWeight:700,color:'var(--ink1)' }}>
            {step==='cart'?`سلتك (${cart.count})`  :step==='checkout'?'تأكيد الطلب':'تم الطلب ✅'}
          </div>
          {step==='cart' && <span style={{ fontSize:13,fontWeight:700,color:'var(--ember)' }}>{cart.total.toLocaleString()} {cur}</span>}
        </div>

        {/* Step: Cart */}
        {step === 'cart' && (
          <div style={{ flex:1,overflow:'auto',padding:'12px' }}>
            {cart.items.length === 0 ? (
              <div style={{ textAlign:'center',padding:'60px 20px',color:'var(--ink3)' }}>
                <ShoppingCart size={40} style={{ margin:'0 auto 12px',opacity:.3 }} />
                <div style={{ fontSize:14 }}>سلتك فارغة</div>
                <button onClick={onClose} style={{ marginTop:16,padding:'8px 20px',background:'var(--ember)',border:'none',borderRadius:8,color:'#fff',cursor:'pointer',fontWeight:700,fontSize:13 }}>تصفح المنتجات</button>
              </div>
            ) : (
              <>
                {cart.items.map((item,i) => (
                  <div key={i} style={{ display:'flex',gap:12,padding:'12px 0',borderBottom:'1px solid var(--border)' }}>
                    <div style={{ width:64,height:64,borderRadius:10,background:'var(--void2)',overflow:'hidden',flexShrink:0 }}>
                      {item.product.imageUrl
                        ? <img src={item.product.imageUrl} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} />
                        : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28 }}>{item.product.emoji||'📦'}</div>
                      }
                    </div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:13,fontWeight:600,color:'var(--ink1)' }}>{item.product.name}</div>
                      <div style={{ fontSize:11,color:'var(--ink3)',marginTop:2 }}>{item.size && `مقاس: ${item.size}`} {item.color && `· لون: ${item.color}`}</div>
                      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8 }}>
                        <div style={{ display:'flex',alignItems:'center',gap:8,background:'var(--void2)',borderRadius:6,padding:'3px 8px' }}>
                          <button onClick={()=>cart.update(item.product.id,item.size,item.color,item.quantity-1)} style={{ width:22,height:22,borderRadius:5,background:'var(--panel)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><Minus size={10}/></button>
                          <span style={{ fontSize:13,fontWeight:700,color:'var(--ink1)',minWidth:20,textAlign:'center' }}>{item.quantity}</span>
                          <button onClick={()=>cart.update(item.product.id,item.size,item.color,item.quantity+1)} style={{ width:22,height:22,borderRadius:5,background:'var(--panel)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><Plus size={10}/></button>
                        </div>
                        <span style={{ fontSize:14,fontWeight:700,color:'var(--ink1)' }}>{(item.product.price*item.quantity).toLocaleString()} {cur}</span>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ padding:'14px 0',borderTop:'1px solid var(--border)',marginTop:12 }}>
                  <div style={{ display:'flex',justifyContent:'space-between',fontSize:13,color:'var(--ink2)',marginBottom:8 }}>
                    <span>المنتجات</span><span>{cart.total.toLocaleString()} {cur}</span>
                  </div>
                  <div style={{ display:'flex',justifyContent:'space-between',fontSize:13,color:'var(--ink2)',marginBottom:12 }}>
                    <span>التوصيل</span><span style={{ color:'var(--ink3)' }}>يُحسب حسب المدينة</span>
                  </div>
                  <button onClick={()=>setStep('checkout')} style={{
                    width:'100%',height:48,background:'var(--ember)',border:'none',
                    borderRadius:'var(--r)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                    boxShadow:'0 4px 16px rgba(255,77,26,.35)',
                  }}>
                    متابعة الطلب <ArrowRight size={16}/>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: Checkout */}
        {step === 'checkout' && (
          <div style={{ flex:1,overflow:'auto',padding:'16px 18px' }}>
            <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
              <input className="glass-input" placeholder="الاسم الكامل *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
              <input className="glass-input" placeholder="رقم الهاتف *" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} dir="ltr" type="tel" />

              {/* City with autocomplete */}
              <div style={{ position:'relative' }}>
                <input className="glass-input" placeholder="المدينة *"
                  value={citySearch||form.city}
                  onChange={e=>{setCitySearch(e.target.value);setShowCities(true);setForm(f=>({...f,city:e.target.value}))}}
                  onFocus={()=>setShowCities(true)} onBlur={()=>setTimeout(()=>setShowCities(false),200)}
                />
                {showCities && filteredCities.length > 0 && (
                  <div style={{ position:'absolute',top:'100%',right:0,left:0,background:'var(--panel2)',border:'1px solid var(--border)',borderRadius:8,maxHeight:180,overflowY:'auto',zIndex:10,marginTop:4 }}>
                    {filteredCities.map(city=>(
                      <div key={city} onClick={()=>{setForm(f=>({...f,city}));setCitySearch(city);setShowCities(false)}}
                        style={{ padding:'8px 14px',fontSize:13,color:'var(--ink1)',cursor:'pointer',borderBottom:'1px solid var(--border)' }}
                        onMouseOver={e=>(e.currentTarget.style.background='var(--panel3)')}
                        onMouseOut={e=>(e.currentTarget.style.background='')}
                      >{city}</div>
                    ))}
                  </div>
                )}
              </div>

              <textarea className="glass-input" placeholder="العنوان بالتفصيل (الشارع، الحي...)" rows={2}
                value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))}
                style={{ resize:'none' }} />
              <textarea className="glass-input" placeholder="ملاحظة للبائع (اختياري)" rows={2}
                value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                style={{ resize:'none' }} />

              <label style={{ display:'flex',alignItems:'center',gap:10,cursor:'pointer',fontSize:13,color:'var(--ink2)' }}>
                <input type="checkbox" checked={form.subscribe} onChange={e=>setForm(f=>({...f,subscribe:e.target.checked}))} style={{ accentColor:'var(--ember)',width:16,height:16 }}/>
                أريد استقبال العروض والمنتجات الجديدة عبر واتساب
              </label>

              {/* Summary */}
              {form.city && (
                <div style={{ background:'var(--void2)',borderRadius:'var(--r)',padding:'14px 16px',border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:12,fontWeight:700,color:'var(--ink3)',marginBottom:10 }}>ملخص الطلب</div>
                  {cart.items.map((item,i)=>(
                    <div key={i} style={{ display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--ink2)',marginBottom:5 }}>
                      <span>{item.product.name} x{item.quantity}</span>
                      <span>{(item.product.price*item.quantity).toLocaleString()} {cur}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--ink2)',paddingTop:8,borderTop:'1px solid var(--border)',marginTop:5 }}>
                    <span>التوصيل إلى {form.city}</span><span>{deliveryCost} {cur}</span>
                  </div>
                  <div style={{ display:'flex',justifyContent:'space-between',fontSize:16,fontWeight:900,color:'var(--ink1)',paddingTop:10,marginTop:5 }}>
                    <span>الإجمالي</span>
                    <span style={{ color:'var(--ember)' }}>{grandTotal.toLocaleString()} {cur}</span>
                  </div>
                </div>
              )}

              <button onClick={handleOrder} disabled={loading} style={{
                width:'100%',height:52,background:'var(--ember)',border:'none',
                borderRadius:'var(--r)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',
                display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                boxShadow:'0 4px 16px rgba(255,77,26,.35)',opacity:loading?0.7:1,
              }}>
                {loading ? '⟳ جارٍ إرسال الطلب...' : <><MessageCircle size={16}/> تأكيد الطلب عبر واتساب</>}
              </button>
              <button onClick={()=>setStep('cart')} style={{ background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:13,padding:'4px' }}>← رجوع للسلة</button>
            </div>
          </div>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 24px',textAlign:'center' }}>
            <div style={{ width:72,height:72,borderRadius:'50%',background:'rgba(0,200,150,.12)',border:'2px solid var(--mint)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:20 }}>
              <Check size={36} style={{ color:'var(--mint)' }} />
            </div>
            <h2 style={{ fontSize:22,fontWeight:900,color:'var(--ink1)',marginBottom:10 }}>تم إرسال طلبك! 🎉</h2>
            <p style={{ fontSize:14,color:'var(--ink2)',lineHeight:1.7,marginBottom:24 }}>
              تم إرسال تفاصيل طلبك عبر واتساب.<br/>
              سيتواصل معك البائع لتأكيد الطلب قريباً.
            </p>
            {orderId && <div style={{ fontSize:12,color:'var(--ink3)',background:'var(--void2)',borderRadius:8,padding:'6px 14px',marginBottom:20 }}>رقم الطلب: {orderId}</div>}
            <button onClick={onClose} style={{ padding:'10px 28px',background:'var(--ember)',border:'none',borderRadius:10,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer' }}>
              متابعة التسوق
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Floating AI Chat */
function FloatingChat({ userId, storeInfo }: { userId:string; storeInfo:StoreInfo }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role:'ai', content:`مرحباً! 👋 أنا مساعد ${storeInfo.brand.name||'المتجر'} الذكي.\nيمكنني مساعدتك في:\n• البحث عن منتج بالاسم أو الكود\n• الأسئلة عن التوصيل والمقاسات\n• تتبع طلبك\n\nكيف يمكنني مساعدتك؟` }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setUnread(0); endRef.current?.scrollIntoView(); } }, [msgs, open]);

  const send = async (msg?: string) => {
    const text = msg || input.trim();
    if (!text) return;
    setInput('');
    const newMsg: ChatMsg = { role:'user', content:text };
    setMsgs(m => [...m, newMsg]);
    setLoading(true);
    try {
      const r = await fetch('/api/ai/public-reply', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: text, history: msgs.slice(-8).map(m=>({role:m.role,content:m.content})), userId }),
      });
      const data = await r.json();
      const aiMsg: ChatMsg = { role:'ai', content: data.reply, product: data.product };
      setMsgs(m => [...m, aiMsg]);
      if (!open) setUnread(n => n+1);
    } catch { setMsgs(m => [...m, { role:'ai', content:'عذراً، حدث خطأ في الاتصال. حاول مرة أخرى.' }]); }
    setLoading(false);
  };

  return (
    <>
      {/* FAB */}
      <button onClick={()=>setOpen(v=>!v)} style={{
        position:'fixed',bottom:24,left:24,width:56,height:56,borderRadius:'50%',
        background:'var(--ember)',border:'none',color:'#fff',cursor:'pointer',zIndex:200,
        display:'flex',alignItems:'center',justifyContent:'center',
        boxShadow:'0 4px 20px rgba(255,77,26,.45)',transition:'all .2s',
      }}>
        {open ? <X size={22}/> : <Bot size={22}/>}
        {unread > 0 && !open && (
          <div style={{ position:'absolute',top:-4,right:-4,width:18,height:18,background:'var(--mint)',borderRadius:'50%',fontSize:9,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--void)' }}>{unread}</div>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position:'fixed',bottom:92,left:16,right:16,maxWidth:360,marginLeft:'auto',
          background:'var(--panel)',border:'1px solid var(--border2)',borderRadius:'var(--r-xl)',
          boxShadow:'0 16px 48px rgba(0,0,0,.5)',zIndex:200,overflow:'hidden',
          animation:'fade-up .2s ease',
          display:'flex',flexDirection:'column',maxHeight:460,
        }}>
          {/* Header */}
          <div style={{ padding:'12px 16px',background:'var(--ember)',display:'flex',alignItems:'center',gap:10 }}>
            <div style={{ width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,.2)',display:'flex',alignItems:'center',justifyContent:'center' }}><Bot size={16} style={{ color:'#fff' }}/></div>
            <div>
              <div style={{ fontSize:13,fontWeight:700,color:'#fff' }}>مساعد {storeInfo.brand.name}</div>
              <div style={{ fontSize:10,color:'rgba(255,255,255,.7)' }}>متاح الآن · يرد بالدارجة</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex:1,overflow:'auto',padding:'12px',display:'flex',flexDirection:'column',gap:10 }}>
            {msgs.map((m,i) => (
              <div key={i} style={{ maxWidth:'85%', alignSelf:m.role==='user'?'flex-end':'flex-start' }}>
                <div className={m.role==='ai'?'bubble-ai':'bubble-out'}
                  style={{ whiteSpace:'pre-wrap', fontSize:12 }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="bubble-ai" style={{ fontSize:12,color:'var(--ink3)',alignSelf:'flex-start' }}>
                <span style={{ animation:'blink 1s infinite' }}>يكتب...</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick replies */}
          <div style={{ padding:'8px 10px',display:'flex',gap:6,flexWrap:'wrap',borderTop:'1px solid var(--border)' }}>
            {['اشوف المنتجات','بكام التوصيل؟','تتبع طلبي'].map(q=>(
              <button key={q} onClick={()=>send(q)} style={{ fontSize:10,padding:'4px 9px',borderRadius:99,background:'var(--panel2)',border:'1px solid var(--border2)',color:'var(--ink2)',cursor:'pointer' }}>{q}</button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding:'8px 10px',borderTop:'1px solid var(--border)',display:'flex',gap:8 }}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()}
              placeholder="اكتب سؤالك..." className="glass-input"
              style={{ flex:1,padding:'7px 12px',fontSize:12 }} />
            <button onClick={()=>send()} disabled={!input.trim()||loading}
              style={{ width:34,height:34,borderRadius:'50%',background:'var(--ember)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:(!input.trim()||loading)?0.5:1 }}>
              <Send size={14} style={{ color:'#fff' }}/>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* Order Tracking */
function TrackingModal({ userId, storeInfo, onClose }: { userId:string; storeInfo:StoreInfo; onClose:()=>void }) {
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const cur = storeInfo.brand.currency || 'MAD';

  const STATUS_AR: Record<string,string> = { pending:'بانتظار التأكيد', approved:'تم التأكيد', processing:'جاري التحضير', shipped:'في الطريق 🚚', delivered:'وصل ✅', cancelled:'ملغي' };
  const STATUS_COLOR: Record<string,string> = { pending:'var(--gold)', approved:'var(--mint)', processing:'var(--gold)', shipped:'var(--mint)', delivered:'var(--mint)', cancelled:'var(--ember)' };

  const search = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    const r = await fetch(`/api/orders/track/${encodeURIComponent(phone.trim())}?userId=${userId}`);
    const data = await r.json();
    setOrders(Array.isArray(data) ? data : []);
    setSearched(true);
    setLoading(false);
  };

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.7)',backdropFilter:'blur(6px)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--panel)',borderRadius:'var(--r-xl)',width:'100%',maxWidth:440,padding:24 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
          <h2 style={{ fontSize:18,fontWeight:900,color:'var(--ink1)' }}>📦 تتبع طلبك</h2>
          <button onClick={onClose} style={{ width:30,height:30,borderRadius:8,background:'var(--panel2)',border:'1px solid var(--border)',cursor:'pointer',color:'var(--ink2)',display:'flex',alignItems:'center',justifyContent:'center' }}><X size={14}/></button>
        </div>
        <div style={{ display:'flex',gap:8,marginBottom:16 }}>
          <input className="glass-input" placeholder="أدخل رقم هاتفك" value={phone} onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} dir="ltr" style={{ flex:1 }} />
          <button onClick={search} disabled={loading} style={{ padding:'8px 18px',background:'var(--ember)',border:'none',borderRadius:10,color:'#fff',fontWeight:700,cursor:'pointer',fontSize:14 }}>
            {loading?'...':'بحث'}
          </button>
        </div>
        {searched && orders.length === 0 && <p style={{ color:'var(--ink3)',textAlign:'center',fontSize:13 }}>لم نجد طلبات بهذا الرقم</p>}
        {orders.map(o=>(
          <div key={o.id} style={{ background:'var(--void2)',borderRadius:'var(--r)',padding:'14px 16px',marginBottom:10,border:'1px solid var(--border)' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
              <span style={{ fontSize:11,color:'var(--ink3)',fontFamily:'var(--font-mono)' }}>{o.id}</span>
              <span style={{ fontSize:12,fontWeight:700,color:STATUS_COLOR[o.status]||'var(--ink2)' }}>{STATUS_AR[o.status]||o.status}</span>
            </div>
            {(o.items||[]).map((item:any,i:number)=>(
              <div key={i} style={{ fontSize:12,color:'var(--ink2)',marginBottom:3 }}>• {item.productName} x{item.quantity}</div>
            ))}
            <div style={{ display:'flex',justifyContent:'space-between',marginTop:8,fontSize:12 }}>
              <span style={{ color:'var(--ink3)' }}>{new Date(o.createdAt).toLocaleDateString('ar-MA')}</span>
              <span style={{ fontWeight:700,color:'var(--ink1)' }}>{o.total} {cur}</span>
            </div>
            {o.trackingNumber && <div style={{ marginTop:6,fontSize:11,color:'var(--mint)' }}>🚚 رقم التتبع: {o.trackingNumber}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN STOREFRONT
// ══════════════════════════════════════════════
export default function Storefront() {
  // Get userId from URL or window
  const userId = (() => {
    // From URL path: /store/USER_ID
    const path = window.location.pathname;
    const match = path.match(/\/store\/([^\/\?]+)/);
    if (match) return match[1];
    // From query string: ?userId=XXX or ?user=XXX
    const params = new URLSearchParams(window.location.search);
    const qId = params.get('userId') || params.get('user') || params.get('id');
    if (qId) return qId;
    // From hash: #USER_ID
    const hash = window.location.hash.replace('#', '');
    if (hash && hash.length > 5) return hash;
    return '';
  })();

  const { products, storeInfo, loading, error } = useStorefront(userId);
  const cart = useCart();

  const [search,     setSearch]     = useState('');
  const [activeTab,  setActiveTab]  = useState('all');
  const [sortBy,     setSortBy]     = useState<'popular'|'newest'|'price-asc'|'price-desc'>('popular');
  const [viewProduct,setViewProduct]= useState<SProduct|null>(null);
  const [showCart,   setShowCart]   = useState(false);
  const [showTrack,  setShowTrack]  = useState(false);
  const [cartAnim,   setCartAnim]   = useState(false);
  const [successOrderId,setSuccessOrderId] = useState('');

  const handleAddToCart = (p: SProduct, size?: string, color?: string) => {
    cart.add(p, size||p.sizes?.[0]||'', color||p.colors?.[0]||'');
    setCartAnim(true);
    setTimeout(() => setCartAnim(false), 600);
  };

  const categories = ['all', ...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];

  let filtered = products
    .filter(p => (activeTab==='all' || p.category===activeTab)
      && (!search || p.name.includes(search) || p.description?.includes(search) || p.sku?.includes(search)));

  if (sortBy === 'popular')    filtered = [...filtered].sort((a,b) => b.sales - a.sales);
  if (sortBy === 'newest')     filtered = [...filtered].sort((a,b) => new Date(b.createdAt||0).getTime() - new Date(a.createdAt||0).getTime());
  if (sortBy === 'price-asc')  filtered = [...filtered].sort((a,b) => a.price - b.price);
  if (sortBy === 'price-desc') filtered = [...filtered].sort((a,b) => b.price - a.price);

  if (loading) return (
    <div style={{ minHeight:'100dvh',background:'var(--void)',display:'flex',alignItems:'center',justifyContent:'center' }}>
      <div style={{ textAlign:'center',color:'var(--ink2)' }}>
        <div style={{ width:48,height:48,border:'3px solid var(--border)',borderTopColor:'var(--ember)',borderRadius:'50%',animation:'spin 1s linear infinite',margin:'0 auto 16px' }}/>
        جارٍ تحميل المتجر...
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!userId) return (
    <div dir="rtl" style={{ minHeight:'100dvh',background:'var(--void)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--ink2)',textAlign:'center',padding:24,flexDirection:'column',gap:20 }}>
      <div style={{ fontSize:56 }}>🏪</div>
      <div style={{ fontSize:22,fontWeight:900,color:'var(--ink1)' }}>متجر Sahar Shop</div>
      <div style={{ fontSize:14,color:'var(--ink3)',maxWidth:360,lineHeight:1.8 }}>
        مرحباً! للدخول لصفحة المتجر، اطلب من التاجر مشاركة رابط متجره الخاص معك عبر واتساب أو إنستغرام.
      </div>
      <div style={{ display:'flex',gap:12,flexWrap:'wrap',justifyContent:'center' }}>
        <a href="/" style={{ padding:'10px 24px',background:'var(--ember)',borderRadius:10,color:'#fff',fontWeight:700,fontSize:14,textDecoration:'none' }}>
          الصفحة الرئيسية
        </a>
        <a href="/login" style={{ padding:'10px 24px',background:'var(--panel)',border:'1px solid var(--border)',borderRadius:10,color:'var(--ink2)',fontWeight:700,fontSize:14,textDecoration:'none' }}>
          دخول التاجر
        </a>
      </div>
    </div>
  );

  if (error || (!loading && !storeInfo)) return (
    <div style={{ minHeight:'100dvh',background:'var(--void)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--ink2)',textAlign:'center',padding:24 }}>
      <div><div style={{ fontSize:40,marginBottom:16 }}>🏪</div><div style={{ fontSize:18,fontWeight:700,color:'var(--ink1)',marginBottom:8 }}>المتجر غير موجود</div><div style={{ fontSize:14 }}>{error||'تحقق من الرابط'}</div></div>
    </div>
  );

  const brand = storeInfo!.brand;
  const cur   = brand.currency || 'MAD';

  return (
    <div dir="rtl" style={{ minHeight:'100dvh',background:'var(--void)',color:'var(--ink1)',fontFamily:'Tajawal,system-ui,sans-serif' }}>
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        body{background:var(--void)!important}
        .product-hover:hover{transform:translateY(-3px)!important;border-color:var(--border2)!important}
      `}</style>

      {/* ── HEADER ───────────────────────────── */}
      <header style={{
        position:'sticky',top:0,zIndex:100,
        background:'rgba(7,8,13,.92)',backdropFilter:'blur(20px)',
        borderBottom:'1px solid var(--border)',
        padding:'0 16px',height:60,
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,
      }}>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:34,height:34,borderRadius:10,background:'var(--ember)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:900,color:'#fff',flexShrink:0 }}>
            {brand.name?.[0]?.toUpperCase()||'م'}
          </div>
          <div>
            <div style={{ fontSize:14,fontWeight:900,color:'var(--ink1)' }}>{brand.name}</div>
            {brand.description && <div style={{ fontSize:10,color:'var(--ink3)',marginTop:1 }}>{brand.description}</div>}
          </div>
        </div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          <button onClick={()=>setShowTrack(true)} style={{ padding:'5px 10px',borderRadius:8,background:'var(--panel)',border:'1px solid var(--border)',color:'var(--ink2)',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5 }}>
            <Package size={13}/> طلباتي
          </button>
          {brand.phone && (
            <a href={`https://wa.me/${brand.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
              style={{ padding:'5px 10px',borderRadius:8,background:'rgba(37,211,102,.12)',border:'1px solid rgba(37,211,102,.25)',color:'#25D366',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5,textDecoration:'none' }}>
              <MessageCircle size={13}/> واتساب
            </a>
          )}
          <button onClick={()=>setShowCart(true)} style={{
            position:'relative',width:40,height:40,borderRadius:10,
            background:cartAnim?'var(--ember)':'var(--panel)',border:'1px solid var(--border)',
            color:cartAnim?'#fff':'var(--ink2)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
            transition:'all .2s',
          }}>
            <ShoppingCart size={18}/>
            {cart.count > 0 && (
              <span style={{ position:'absolute',top:-5,left:-5,width:18,height:18,background:'var(--ember)',borderRadius:'50%',fontSize:9,fontWeight:900,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--void)' }}>{cart.count}</span>
            )}
          </button>
        </div>
      </header>

      {/* ── HERO ─────────────────────────────── */}
      <div style={{ textAlign:'center',padding:'32px 20px 20px',position:'relative',overflow:'hidden' }}>
        <div style={{ position:'absolute',inset:0,background:'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,77,26,.06) 0%, transparent 70%)',pointerEvents:'none' }}/>
        <h1 style={{ fontSize:'clamp(22px,5vw,38px)',fontWeight:900,color:'var(--ink1)',letterSpacing:'-0.03em',marginBottom:8,lineHeight:1.2 }}>
          {brand.name}
        </h1>
        <p style={{ fontSize:14,color:'var(--ink2)',marginBottom:20 }}>
          {filtered.length} منتج متوفر · توصيل لجميع مدن المغرب 🇲🇦
        </p>
        {/* Social links */}
        <div style={{ display:'flex',justifyContent:'center',gap:10,flexWrap:'wrap' }}>
          {brand.phone && <a href={`https://wa.me/${brand.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" style={{ padding:'5px 12px',borderRadius:99,background:'rgba(37,211,102,.1)',border:'1px solid rgba(37,211,102,.2)',color:'#25D366',fontSize:12,fontWeight:700,textDecoration:'none',display:'flex',alignItems:'center',gap:5 }}><MessageCircle size={12}/>واتساب</a>}
          {brand.instagram && <a href={`https://instagram.com/${brand.instagram}`} target="_blank" rel="noreferrer" style={{ padding:'5px 12px',borderRadius:99,background:'rgba(225,48,108,.1)',border:'1px solid rgba(225,48,108,.2)',color:'#E1306C',fontSize:12,fontWeight:700,textDecoration:'none' }}>📸 Instagram</a>}
          {brand.facebook && <a href={`https://facebook.com/${brand.facebook}`} target="_blank" rel="noreferrer" style={{ padding:'5px 12px',borderRadius:99,background:'rgba(24,119,242,.1)',border:'1px solid rgba(24,119,242,.2)',color:'#1877F2',fontSize:12,fontWeight:700,textDecoration:'none' }}>📘 Facebook</a>}
          <button onClick={()=>{navigator.share?.({ title:brand.name, url:window.location.href }).catch(()=>{})||navigator.clipboard?.writeText(window.location.href)}} style={{ padding:'5px 12px',borderRadius:99,background:'var(--panel)',border:'1px solid var(--border)',color:'var(--ink2)',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5 }}>
            <Share2 size={12}/> مشاركة
          </button>
        </div>
      </div>

      {/* ── SEARCH + FILTER ──────────────────── */}
      <div style={{ padding:'0 16px',marginBottom:16 }}>
        <div style={{ position:'relative',marginBottom:12 }}>
          <Search size={16} style={{ position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'var(--ink3)',pointerEvents:'none' }}/>
          <input className="glass-input" style={{ paddingRight:42 }}
            placeholder="ابحث بالاسم أو الكود..."
            value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {/* Category tabs */}
        <div style={{ display:'flex',gap:8,overflowX:'auto',paddingBottom:4 }}>
          {categories.map(cat=>(
            <button key={cat} onClick={()=>setActiveTab(cat)} style={{
              flexShrink:0,padding:'6px 14px',borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',
              border:`1px solid ${activeTab===cat?'var(--ember)':'var(--border)'}`,
              background:activeTab===cat?'rgba(255,77,26,.12)':'var(--panel)',
              color:activeTab===cat?'var(--ember2)':'var(--ink2)',transition:'all .15s',
            }}>{cat==='all'?'الكل':cat}</button>
          ))}
        </div>
      </div>

      {/* ── SORT ─────────────────────────────── */}
      <div style={{ padding:'0 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between' }}>
        <span style={{ fontSize:12,color:'var(--ink3)',fontWeight:600 }}>{filtered.length} منتج</span>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)}
          style={{ background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 10px',color:'var(--ink2)',fontSize:12,cursor:'pointer',outline:'none' }}>
          <option value="popular">الأكثر طلباً</option>
          <option value="newest">الأحدث</option>
          <option value="price-asc">السعر: من الأقل</option>
          <option value="price-desc">السعر: من الأعلى</option>
        </select>
      </div>

      {/* ── PRODUCTS GRID ───────────────────── */}
      <div style={{ padding:'0 16px 120px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:14 }}>
        {filtered.map(p => (
          <ProductCard key={p.id} p={p} currency={cur}
            onAdd={handleAddToCart}
            onView={setViewProduct}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn:'1/-1',textAlign:'center',padding:'60px 20px',color:'var(--ink3)' }}>
            <Package size={48} style={{ margin:'0 auto 16px',opacity:.3 }}/>
            <div style={{ fontSize:16,fontWeight:700,marginBottom:8 }}>لم نجد منتجات</div>
            <div style={{ fontSize:13 }}>جرب كلمة بحث أخرى</div>
          </div>
        )}
      </div>

      {/* ── STICKY CART BUTTON ───────────────── */}
      {cart.count > 0 && !showCart && (
        <div style={{ position:'fixed',bottom:20,right:16,left:16,zIndex:150 }}>
          <button onClick={()=>setShowCart(true)} style={{
            width:'100%',height:52,background:'var(--ember)',border:'none',borderRadius:'var(--r)',
            color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',gap:10,
            boxShadow:'0 8px 24px rgba(255,77,26,.45)',
          }}>
            <ShoppingCart size={18}/>
            عرض السلة ({cart.count} منتج)
            <span style={{ background:'rgba(255,255,255,.2)',borderRadius:99,padding:'2px 10px',fontSize:13 }}>
              {cart.total.toLocaleString()} {cur}
            </span>
          </button>
        </div>
      )}

      {/* ── MODALS ──────────────────────────── */}
      {viewProduct && <ProductModal p={viewProduct} cart={cart} onClose={()=>setViewProduct(null)} currency={cur} userId={userId}/>}
      {showCart && <CartSidebar cart={cart} storeInfo={storeInfo!} userId={userId} onClose={()=>setShowCart(false)} onOrderSuccess={id=>{setSuccessOrderId(id);setShowCart(false)}}/>}
      {showTrack && <TrackingModal userId={userId} storeInfo={storeInfo!} onClose={()=>setShowTrack(false)}/>}
      <FloatingChat userId={userId} storeInfo={storeInfo!}/>
    </div>
  );
}
