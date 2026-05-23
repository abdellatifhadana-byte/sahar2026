import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Search, Package, ShoppingCart, Users, X } from 'lucide-react';
import type { Page } from '../types';

interface Result {
  type: 'product' | 'order' | 'customer';
  id: string;
  title: string;
  subtitle: string;
  page: Page;
}

export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { products, orders, customers, settings, setPage } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const currency = settings.brand.currency;

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = query.toLowerCase();
    const res: Result[] = [];

    // Products
    products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)).slice(0, 4).forEach(p => {
      res.push({ type: 'product', id: p.id, title: `${p.emoji} ${p.name}`, subtitle: `${p.price} ${currency} · ${p.category}`, page: 'products' });
    });

    // Orders
    orders.filter(o => o.customerName.includes(q) || o.id.includes(q) || o.city.includes(q)).slice(0, 4).forEach(o => {
      res.push({ type: 'order', id: o.id, title: `${o.id} — ${o.customerName}`, subtitle: `${o.total} ${currency} · ${o.city}`, page: 'orders' });
    });

    // Customers
    customers.filter(c => c.name.includes(q) || c.phone.includes(q) || c.city.includes(q)).slice(0, 4).forEach(c => {
      res.push({ type: 'customer', id: c.id, title: c.name, subtitle: `${c.phone} · ${c.city}`, page: 'customers' });
    });

    setResults(res.slice(0, 10));
  }, [query, products, orders, customers, currency]);

  const icons = { product: Package, order: ShoppingCart, customer: Users };
  const colors = { product: 'text-indigo-400', order: 'text-blue-400', customer: 'text-emerald-400' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 540, padding: '0 16px', zIndex: 300 }}
        onClick={e => e.stopPropagation()}>
        <div className="card overflow-hidden anim-scale-in">
          {/* Search input */}
          <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <Search className="w-5 h-5 text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="ابحث في المنتجات، الطلبات، الزبائن..."
              className="flex-1 bg-transparent border-0 text-primary text-base outline-none placeholder:text-muted"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && results.length > 0) { setPage(results[0].page); onClose(); }
              }}
              dir="rtl"
            />
            <button onClick={onClose} className="text-muted hover:text-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results */}
          {results.length > 0 ? (
            <div className="max-h-80 overflow-y-auto">
              {results.map((r, i) => {
                const Icon = icons[r.type];
                return (
                  <button key={`${r.type}-${r.id}`} onClick={() => { setPage(r.page); onClose(); }}
                    className={`w-full text-right flex items-center gap-3 px-4 py-3 hover:bg-card transition-all ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: 'var(--border)' }}>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${colors[r.type]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-primary text-sm font-semibold truncate">{r.title}</p>
                      <p className="text-muted text-xs truncate">{r.subtitle}</p>
                    </div>
                    <span className="text-muted text-xs flex-shrink-0 badge" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                      {r.type === 'product' ? 'منتج' : r.type === 'order' ? 'طلب' : 'زبون'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : query.trim() ? (
            <div className="py-10 text-center text-muted text-sm">لا نتائج لـ "{query}"</div>
          ) : (
            <div className="p-4 space-y-1">
              <p className="text-muted text-xs font-bold mb-2">بحث سريع في:</p>
              {[
                { icon: Package, label: 'المنتجات', color: 'text-indigo-400' },
                { icon: ShoppingCart, label: 'الطلبات', color: 'text-blue-400' },
                { icon: Users, label: 'الزبائن', color: 'text-emerald-400' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-muted text-sm">
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  {item.label}
                </div>
              ))}
              <p className="text-muted text-xs mt-3 pt-3 border-t text-center" style={{ borderColor: 'var(--border)' }}>
                اضغط ESC للإغلاق · Enter للاختيار الأول
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
