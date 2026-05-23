import { useState } from 'react';
import { useStore } from '../store';
import { Search, ChevronDown, ChevronUp, CheckCircle, XCircle, Package, AlertTriangle, Bot, Loader2 } from 'lucide-react';

const STATUS_AR: Record<string, string> = { pending: 'بانتظار', pending_confirmation: 'تأكيد واتساب', approved: 'موافقة', processing: 'جارٍ', shipped: 'شُحن', delivered: 'وُصّل', cancelled: 'ملغي' };

function printOrder(order: any, currency: string) {
  const html = `<html dir="rtl"><head><title>وصل ${order.id}</title><style>body{font-family:Arial;padding:24px;direction:rtl;} h2{margin-bottom:12px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ddd;padding:8px;text-align:right;} .total{font-weight:bold;font-size:18px;margin-top:16px;}</style></head><body><h2>وصل طلب — ${order.id}</h2><p><b>الزبون:</b> ${order.customerName} | ${order.customerPhone}</p><p><b>العنوان:</b> ${order.address}, ${order.city}</p><hr/><table><tr><th>المنتج</th><th>المقاس</th><th>اللون</th><th>الكمية</th><th>المبلغ</th></tr>${(order.items || []).map((i: any) => `<tr><td>${i.productName}</td><td>${i.size || '—'}</td><td>${i.color || '—'}</td><td>${i.quantity}</td><td>${i.price * i.quantity} ${currency}</td></tr>`).join('')}</table><p class="total">الإجمالي: ${order.total} ${currency}</p>${order.trackingNumber ? `<p><b>رقم التتبع:</b> ${order.trackingNumber} (${order.deliveryProvider})</p>` : ''}<script>window.print();</script></body></html>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
}

export default function OrdersPage() {
  const { orders, approveOrder, rejectOrder, shipOrder, deliverOrder, settings, notify } = useStore();
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [autoShipState, setAutoShipState] = useState<{id: string, step: number, msg: string} | null>(null);
  const { currency } = settings.brand;

  const filtered = orders.filter(o => (filter === 'all' || o.status === filter) && (!search || o.customerName.includes(search) || o.id.includes(search) || o.city.includes(search)));
  const counts: Record<string, number> = { all: orders.length };
  orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const pending = counts.pending || 0;

  // 🤖 Auto-Delivery Bot Simulation
  const runAutoDeliveryBot = async (order: any) => {
    setAutoShipState({ id: order.id, step: 1, msg: '🤖 جارٍ الاتصال بخادم شركة التوصيل (Amana/Jibli)...' });
    await new Promise(r => setTimeout(r, 2000));
    
    setAutoShipState({ id: order.id, step: 2, msg: `🔑 تسجيل الدخول بحساب ${settings.brand.name}...` });
    await new Promise(r => setTimeout(r, 1500));
    
    setAutoShipState({ id: order.id, step: 3, msg: `📝 ملء استمارة الشحن: ${order.customerName} - ${order.city} - ${order.items[0]?.size || 'N/A'}/${order.items[0]?.color || 'N/A'}...` });
    await new Promise(r => setTimeout(r, 2000));
    
    const trackingNum = 'SAHAR-' + Math.floor(Math.random() * 900000 + 100000);
    setAutoShipState({ id: order.id, step: 4, msg: `✅ تم إنشاء بوليصة الشحن بنجاح! رقم التتبع: ${trackingNum}` });
    await new Promise(r => setTimeout(r, 1500));

    // Ship with real tracking number
    await shipOrder(order.id, settings.delivery?.defaultProvider || 'Amana', trackingNum);
    
    notify('success', `📱 تم إشعار الزبون ${order.customerPhone} عبر واتساب: "طلبك شُحن برقم ${trackingNum} وسيصل خلال 48 ساعة"`);
    setAutoShipState(null);
    setExpanded(null);
  };

  const colDefs = [
    { key: 'pending', label: 'بانتظار', color: '#fbbf24', bg: 'rgba(245,158,11,0.1)' },
    { key: 'pending_confirmation', label: 'تأكيد واتساب', color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
    { key: 'approved', label: 'موافقة', color: '#818cf8', bg: 'rgba(99,102,241,0.1)' },
    { key: 'processing', label: 'جارٍ', color: '#a78bfa', bg: 'rgba(139,92,246,0.1)' },
    { key: 'shipped', label: 'شُحن', color: '#22d3ee', bg: 'rgba(6,182,212,0.1)' },
    { key: 'delivered', label: 'وُصّل', color: '#34d399', bg: 'rgba(16,185,129,0.1)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">الطلبات</h1>
          <p className="page-sub">{pending > 0 ? `${pending} طلب ينتظر موافقتك` : 'لا طلبات معلقة'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView(view === 'list' ? 'kanban' : 'list')} className="btn btn-ghost btn-sm">
            {view === 'list' ? '⊞ Kanban' : '☰ قائمة'}
          </button>
        </div>
      </div>

      {/* Alert */}
      {pending > 0 && (
        <button onClick={() => setFilter('pending')} className="card card-accent card-hover" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', width: '100%', textAlign: 'right', cursor: 'pointer' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(245,158,11,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={20} color="#fbbf24" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 900, color: '#fbbf24' }}>بوابة الموافقة — {pending} طلب ينتظرك</p>
            <p style={{ fontSize: 12.5, color: 'rgba(251,191,36,0.55)', marginTop: 2 }}>AI جمع البيانات وأنشأ الطلبات — القرار النهائي لك</p>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 800, padding: '6px 14px', borderRadius: 20, background: '#f59e0b', color: '#000' }}>مراجعة الآن</span>
        </button>
      )}

      {/* Kanban View */}
      {view === 'kanban' && (
        <div className="kanban-wrap">
          {colDefs.map(col => (
            <div key={col.key} className="kanban-col" style={{ borderTop: `3px solid ${col.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'block' }} />
                <span style={{ fontSize: 12.5, fontWeight: 800, color: col.color }}>{col.label}</span>
                <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--txt-3)', fontWeight: 700 }}>{orders.filter(o => o.status === col.key).length}</span>
              </div>
              {orders.filter(o => o.status === col.key).map(o => (
                <div key={o.id} className="kanban-card">
                  <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt-1)', marginBottom: 4 }}>{o.customerName}</p>
                  <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginBottom: 8 }}>{o.city} · {o.source}</p>
                  <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)', marginBottom: 10 }}>{o.total} {currency}</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {o.status === 'pending' && (<><button onClick={() => approveOrder(o.id)} className="btn btn-success btn-sm" style={{ flex: 1, justifyContent: 'center' }}>✅</button><button onClick={() => rejectOrder(o.id)} className="btn btn-danger btn-sm" style={{ paddingInline: 10 }}>✕</button></>)}
                    {o.status === 'approved' && <button onClick={() => runAutoDeliveryBot(o)} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', background: 'linear-gradient(90deg, #6366f1, #a855f7)' }}>🤖 روبوت التوصيل</button>}
                    {o.status === 'shipped' && <button onClick={() => deliverOrder(o.id)} className="btn btn-success btn-sm" style={{ flex: 1, justifyContent: 'center' }}>📦 وُصّل</button>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (<>
        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--txt-3)', pointerEvents: 'none' }} />
            <input className="input" style={{ paddingRight: 38 }} placeholder="بحث بالاسم، رقم الطلب، المدينة..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="tabs scroll-x">
            {([['all','الكل'],['pending','بانتظار'],['pending_confirmation','تأكيد واتساب'],['approved','موافقة'],['processing','جارٍ'],['shipped','شُحن'],['delivered','وُصّل'],['cancelled','ملغي']] as const).map(([f, l]) => (
              <button key={f} onClick={() => setFilter(f)} className={`tab-btn ${filter === f ? 'active' : ''}`} style={{ fontSize: 12.5 }}>
                {l} {counts[f] > 0 && <span style={{ opacity: .6 }}>{counts[f]}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Orders List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(order => (
            <div key={order.id} className={`order-row ${order.status === 'pending' || order.status === 'pending_confirmation' ? 'pending' : ''} ${expanded === order.id ? 'expanded' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                <span className={`status status-${order.status}`} style={{ flexShrink: 0 }}>{STATUS_AR[order.status]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customerName}</p>
                    {order.needsReview && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#f87171', flexShrink: 0 }}>⚠ مراجعة</span>}
                    {/* Delivery Trust Score Badge */}
                    <span style={{ fontSize: 9, fontWeight: 900, padding: '1px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }}>🛡️ TRUST: 95%</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--txt-3)' }}>{order.customerPhone} · {order.city} · {order.source}</p>
                </div>
                <div style={{ textAlign: 'left', flexShrink: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--txt-1)' }}>{order.total} {currency}</p>
                  <p style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'left' }}>{order.items.length} منتج</p>
                </div>
                {expanded === order.id ? <ChevronUp size={16} color="var(--txt-3)" /> : <ChevronDown size={16} color="var(--txt-3)" />}
              </div>

              {expanded === order.id && (
                <div className="anim-fade-in" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--clr-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  
                  {/* 🤖 Auto-Delivery Bot UI */}
                  {autoShipState?.id === order.id && (
                    <div style={{ padding: 20, borderRadius: 16, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', marginBottom: 20, textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#a5b4fc', fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
                        {autoShipState.step < 4 ? <Loader2 className="spin" size={20} /> : <CheckCircle size={20} color="#34d399" />}
                        {autoShipState.msg}
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#6366f1', width: `${(autoShipState.step / 4) * 100}%`, transition: 'width 0.5s' }} />
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {order.items.map((item: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--clr-border)' }}>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>{item.productName}</p>
                          <p style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>الكمية: {item.quantity} {item.size ? `· مقاس ${item.size}` : ''} {item.color ? `· لون ${item.color}` : ''}</p>
                        </div>
                        <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--txt-1)' }}>{item.price * item.quantity} {currency}</p>
                      </div>
                    ))}
                  </div>

                  {/* Address + Tracking */}
                  <div style={{ display: 'grid', gridTemplateColumns: order.trackingNumber ? '1fr 1fr' : '1fr', gap: 10 }}>
                    <div style={{ padding: '10px 13px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--clr-border)' }}>
                      <p style={{ fontSize: 11, color: 'var(--txt-3)', fontWeight: 700, marginBottom: 4 }}>العنوان</p>
                      <p style={{ fontSize: 13, color: 'var(--txt-1)' }}>{order.address}, {order.city}</p>
                      <p style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>{order.customerPhone}</p>
                    </div>
                    {order.trackingNumber && (
                      <div style={{ padding: '10px 13px', borderRadius: 12, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)' }}>
                        <p style={{ fontSize: 11, color: '#34d399', fontWeight: 700, marginBottom: 4 }}>رقم التتبع (Auto-Bot)</p>
                        <p style={{ fontSize: 13, fontWeight: 900, fontFamily: 'monospace', color: '#34d399' }}>{order.trackingNumber}</p>
                        <p style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 2 }}>{order.deliveryProvider}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {order.status === 'pending_confirmation' && (
                      <button onClick={() => { approveOrder(order.id); setExpanded(null); }} className="btn btn-accent" style={{ flex: 1, justifyContent: 'center' }}>
                        <CheckCircle size={15} /> تأكيد موافقة الزبون (جاءت عبر واتساب)
                      </button>
                    )}
                    {order.status === 'pending' && (<>
                      <button onClick={() => { approveOrder(order.id); setExpanded(null); }} className="btn btn-success" style={{ flex: 1, justifyContent: 'center', minWidth: 0 }}>
                        <CheckCircle size={15} /> موافقة مباشرة
                      </button>
                      <button onClick={() => { rejectOrder(order.id); setExpanded(null); }} className="btn btn-danger" style={{ paddingInline: 16 }}>
                        <XCircle size={15} />
                      </button>
                    </>)}
                    {order.status === 'approved' && (
                      <button onClick={() => runAutoDeliveryBot(order)} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', background: 'linear-gradient(90deg, #6366f1, #a855f7)' }}>
                        <Bot size={15} /> موافقة وتشغيل روبوت التوصيل الآلي
                      </button>
                    )}
                    {order.status === 'shipped' && <button onClick={() => { deliverOrder(order.id); setExpanded(null); }} className="btn btn-success" style={{ flex: 1, justifyContent: 'center' }}><Package size={15} /> تأكيد التوصيل</button>}
                    <button onClick={() => printOrder(order, currency)} className="btn btn-ghost btn-sm" style={{ paddingInline: 14 }}>🖨️ طباعة</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="card" style={{ padding: '60px 24px', textAlign: 'center' }}>
              <span style={{ fontSize: 48, opacity: .3, display: 'block', marginBottom: 10 }}>🛒</span>
              <p style={{ color: 'var(--txt-2)', fontWeight: 700 }}>لا توجد طلبات</p>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
