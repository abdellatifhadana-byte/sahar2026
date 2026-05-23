import { useState, useRef } from 'react';
import { useStore } from '../store';
import { Plus, Search, X, Camera, Trash2, Edit3, Check, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import type { Product } from '../types';

type Filter = 'all' | 'published' | 'draft' | 'low' | 'out';
type Sort = 'newest' | 'name' | 'price' | 'stock' | 'sales';

const EMOJIS = ['👔','👗','🧥','👟','👜','👖','👕','👘','🧣','👒','🧢','👠','👞','💍','⌚','🕶️','🧤','🧦','👚','🎒','💼','👙','🩱'];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--clr-border)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--txt-1)' }}>{title}</h2>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--clr-border)', color: 'var(--txt-3)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProductForm({ product, onClose }: { product?: Product; onClose: () => void }) {
  const { addProduct, updateProduct, settings, notify } = useStore();
  const [form, setForm] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product?.price?.toString() ?? '',
    cost: product?.cost?.toString() ?? '',
    stock: product?.stock?.toString() ?? '',
    category: product?.category ?? settings.products.categories[0] ?? '',
    sizes: product?.sizes ?? [...settings.products.defaultSizes],
    colors: product?.colors ?? [...settings.products.defaultColors],
    status: (product?.status ?? 'published') as Product['status'],
    emoji: product?.emoji ?? '📦',
    imageUrl: product?.imageUrl ?? '',
    images: product?.images ?? [],
    isForChildren: product?.isForChildren ?? false,
    ageRange: product?.ageRange ?? '',
  });
  const [imgTab, setImgTab] = useState<'photo' | 'emoji'>('photo');
  const fileRef = useRef<HTMLInputElement>(null);

  const tog = (arr: string[], val: string) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];

  const handleImg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { notify('error', 'الصورة أكبر من 8MB'); return; }
    const r = new FileReader();
    r.onload = ev => setForm(p => ({ ...p, imageUrl: ev.target?.result as string }));
    r.readAsDataURL(f);
  };

  const save = () => {
    if (!form.name || !form.price) { notify('error', 'اسم المنتج والسعر مطلوبان'); return; }
    const d = { 
      name: form.name.trim(), description: form.description, 
      price: parseFloat(form.price) || 0, cost: parseFloat(form.cost) || 0, 
      stock: parseInt(form.stock) || 0, category: form.category, 
      sizes: form.sizes, colors: form.colors, status: form.status, 
      emoji: form.emoji, imageUrl: form.imageUrl, images: form.images, 
      isForChildren: form.isForChildren, ageRange: form.ageRange 
    };
    if (product) updateProduct(product.id, d); else addProduct(d);
    onClose();
  };

  const margin = form.price && form.cost ? Math.round(((parseFloat(form.price) - parseFloat(form.cost)) / parseFloat(form.price)) * 100) : 0;

  const chip = (active: boolean, onClick: () => void, label: string) => (
    <button onClick={onClick} style={{ padding: '6px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', transition: 'all .15s', border: `1.5px solid ${active ? 'rgba(99,102,241,0.5)' : 'var(--clr-border)'}`, background: active ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.04)', color: active ? 'var(--clr-pri-h)' : 'var(--txt-3)' }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '75vh', overflowY: 'auto' }}>
      {/* Image */}
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['photo','emoji'].map(t => (
            <button key={t} onClick={() => setImgTab(t as any)} className={`tab-btn ${imgTab === t ? 'active' : ''}`} style={{ fontSize: 12.5 }}>
              {t === 'photo' ? '📸 صورة' : '😊 إيقونة'}
            </button>
          ))}
        </div>
        {imgTab === 'photo' ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" style={{ display: 'none' }} onChange={handleImg} />
            {form.imageUrl ? (
              <div style={{ position: 'relative' }}>
                <img src={form.imageUrl} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 14, border: '1px solid var(--clr-border)' }} />
                <button onClick={() => setForm(p => ({ ...p, imageUrl: '' }))} style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 8, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="img-upload" onClick={() => fileRef.current?.click()}>
                <Camera size={28} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>التقط صورة أو اختر من المعرض</span>
                <span style={{ fontSize: 11.5, opacity: .6 }}>أقصى 8MB</span>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setForm(p => ({ ...p, emoji: e }))} style={{ width: 38, height: 38, borderRadius: 10, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s', border: `2px solid ${form.emoji === e ? 'rgba(99,102,241,0.55)' : 'transparent'}`, background: form.emoji === e ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.05)', transform: form.emoji === e ? 'scale(1.18)' : 'none' }}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="label">اسم المنتج *</label>
        <input className="input" placeholder="مثال: قميص كتان فاخر" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoFocus={!product} />
      </div>

      {/* Desc */}
      <div>
        <label className="label">الوصف</label>
        <textarea className="textarea" rows={2} placeholder="وصف مختصر..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
      </div>

      {/* Price / Cost / Stock */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: `السعر * (${settings.brand.currency})`, key: 'price', ph: '299' },
          { label: 'التكلفة', key: 'cost', ph: '150' },
          { label: 'المخزون', key: 'stock', ph: '50' },
        ].map(f => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            <input className="input" type="number" placeholder={f.ph} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} dir="ltr" />
          </div>
        ))}
      </div>
      {margin > 0 && <p style={{ fontSize: 12, color: '#34d399', fontWeight: 800, marginTop: -10 }}>💰 هامش الربح: {margin}% — ربح {(parseFloat(form.price || '0') - parseFloat(form.cost || '0')).toFixed(0)} {settings.brand.currency}</p>}

      {/* Category */}
      <div>
        <label className="label">التصنيف</label>
        <select className="select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
          {settings.products.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Sizes */}
      <div>
        <label className="label">المقاسات</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['XS','S','M','L','XL','XXL','38','39','40','41','42','43','44'].map(s => chip(form.sizes.includes(s), () => setForm(p => ({ ...p, sizes: tog(p.sizes, s) })), s))}
        </div>
      </div>

      {/* Colors */}
      <div>
        <label className="label">الألوان</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['أسود','أبيض','أحمر','أزرق','أخضر','رمادي','بني','وردي','ذهبي','بيج','نبيتي','برتقالي'].map(c => chip(form.colors.includes(c), () => setForm(p => ({ ...p, colors: tog(p.colors, c) })), c))}
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="label">الحالة</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([['published','🟢 نشر مباشرة'],['draft','📝 مسودة']] as const).map(([s, l]) => (
            <button key={s} onClick={() => setForm(p => ({ ...p, status: s }))} style={{ padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all .18s', border: `1.5px solid ${form.status === s ? 'rgba(99,102,241,0.45)' : 'var(--clr-border)'}`, background: form.status === s ? 'rgba(99,102,241,0.13)' : 'rgba(255,255,255,0.04)', color: form.status === s ? 'var(--clr-pri-h)' : 'var(--txt-3)' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
        <button onClick={onClose} className="btn btn-ghost" style={{ paddingInline: 20 }}>إلغاء</button>
        <button onClick={save} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
          <Check size={16} /> {product ? 'حفظ التعديلات' : 'إضافة المنتج'}
        </button>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const { products, deleteProduct, adjustStock, settings } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [showFilter, setShowFilter] = useState(false);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editProd, setEditProd] = useState<Product | undefined>();
  const { currency } = settings.brand;

  const filtered = products.filter(p => {
    const mf = filter === 'all' ? true : filter === 'published' ? p.status === 'published' : filter === 'draft' ? p.status === 'draft' : filter === 'low' ? (p.stock > 0 && p.stock <= settings.products.lowStockAlert) : p.stock === 0;
    const ms = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.includes(search);
    return mf && ms;
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name,'ar') : sort === 'price' ? b.price - a.price : sort === 'stock' ? b.stock - a.stock : sort === 'sales' ? b.sales - a.sales : b.createdAt.localeCompare(a.createdAt));

  const counts = { all: products.length, published: products.filter(p => p.status === 'published').length, draft: products.filter(p => p.status === 'draft').length, low: products.filter(p => p.stock > 0 && p.stock <= settings.products.lowStockAlert).length, out: products.filter(p => p.stock === 0).length };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 className="page-title">المنتجات</h1>
          <p className="page-sub">{counts.published} منشور · {products.length} إجمالي</p>
        </div>
        <button onClick={() => { setEditProd(undefined); setModal('add'); }} className="btn btn-primary">
          <Plus size={16} /> إضافة منتج
        </button>
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--txt-3)', pointerEvents: 'none' }} />
            <input className="input" style={{ paddingRight: 38 }} placeholder="بحث في المنتجات..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowFilter(!showFilter)} className={`btn btn-ghost ${showFilter ? 'btn-ghost' : ''}`} style={{ paddingInline: 14 }}>
            <SlidersHorizontal size={16} />
          </button>
        </div>

        {showFilter && (
          <div className="card anim-fade-in" style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div className="tabs" style={{ flex: 1 }}>
              {([['all','الكل'],['published','منشور'],['draft','مسودة'],['low','منخفض'],['out','نفذ']] as [Filter,string][]).map(([f,l]) => (
                <button key={f} onClick={() => setFilter(f)} className={`tab-btn ${filter === f ? 'active' : ''}`} style={{ fontSize: 12.5 }}>
                  {l} <span style={{ opacity: .5, marginRight: 3 }}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowUpDown size={14} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
              <select className="select" style={{ height: 34, fontSize: 12.5, width: 'auto', paddingInline: '10px' }} value={sort} onChange={e => setSort(e.target.value as Sort)}>
                <option value="newest">الأحدث</option>
                <option value="name">الاسم</option>
                <option value="price">السعر</option>
                <option value="stock">المخزون</option>
                <option value="sales">المبيعات</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <img src="/empty-products.png" alt="No Products" style={{ width: 200, height: 200, margin: '0 auto 16px', display: 'block', opacity: 0.85 }} />
          <p style={{ color: 'var(--txt-2)', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{search ? 'لا نتائج للبحث' : 'لا توجد منتجات بعد'}</p>
          {!search && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ margin: '0 auto', marginTop: 16 }}><Plus size={16} /> أضف أول منتج</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {filtered.map(p => {
            const margin = p.cost > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
            const stockColor = p.stock === 0 ? '#f87171' : p.stock <= settings.products.lowStockAlert ? '#fbbf24' : '#34d399';
            return (
              <div key={p.id} className="card" style={{ overflow: 'hidden', position: 'relative', cursor: 'pointer', transition: 'all .22s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--sh-md)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
                {/* Image / Emoji */}
                <div style={{ position: 'relative', background: 'var(--clr-surface)' }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: 150, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.08))' }}>
                      {p.emoji || '📦'}
                    </div>
                  )}
                  {/* Status */}
                  <span style={{ position: 'absolute', top: 8, right: 8, padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 800, background: p.status === 'published' ? 'rgba(16,185,129,0.85)' : 'rgba(245,158,11,0.85)', color: '#fff' }}>
                    {p.status === 'published' ? 'منشور' : 'مسودة'}
                  </span>
                  {p.stock === 0 && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }}>
                      <span style={{ padding: '5px 14px', borderRadius: 20, background: 'rgba(239,68,68,0.85)', color: '#fff', fontSize: 12, fontWeight: 900 }}>نفذ من المخزون</span>
                    </div>
                  )}
                  {/* Actions */}
                  <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 5, opacity: 0, transition: 'opacity .18s' }}
                    className="prod-actions">
                    <button onClick={() => { setEditProd(p); setModal('edit'); }} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Edit3 size={13} /></button>
                    <button onClick={() => { if (confirm(`حذف "${p.name}"؟`)) deleteProduct(p.id); }} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(239,68,68,0.75)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding: '12px 13px' }}>
                  <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--txt-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{p.name}</p>
                  <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginBottom: 8 }}>{p.category}</p>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--txt-1)' }}>{p.price} <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>{currency}</span></span>
                    {margin > 0 && <span style={{ fontSize: 11, color: '#34d399', fontWeight: 800 }}>{margin}%</span>}
                  </div>

                  {/* Stock +/- */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => adjustStock(p.id, -1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--clr-border)', background: 'var(--clr-surface)', color: 'var(--txt-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16 }}>−</button>
                    <span style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 800, color: stockColor }}>{p.stock}</span>
                    <button onClick={() => adjustStock(p.id, +1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--clr-border)', background: 'var(--clr-surface)', color: 'var(--txt-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16 }}>+</button>
                  </div>
                </div>

                <style>{`.card:hover .prod-actions { opacity: 1 !important; }`}</style>
              </div>
            );
          })}
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? 'إضافة منتج جديد' : 'تعديل المنتج'} onClose={() => { setModal(null); setEditProd(undefined); }}>
          <ProductForm product={editProd} onClose={() => { setModal(null); setEditProd(undefined); }} />
        </Modal>
      )}
    </div>
  );
}
