import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Page } from '../types';

const SHORTCUTS: { keys: string; desc: string; page?: Page }[] = [
  { keys: 'G + H', desc: 'الرئيسية', page: 'dashboard' },
  { keys: 'G + P', desc: 'المنتجات', page: 'products' },
  { keys: 'G + O', desc: 'الطلبات', page: 'orders' },
  { keys: 'G + M', desc: 'الرسائل', page: 'conversations' },
  { keys: 'G + C', desc: 'الزبائن', page: 'customers' },
  { keys: 'G + A', desc: 'التحليلات', page: 'analytics' },
  { keys: 'G + S', desc: 'الإعدادات', page: 'settings' },
  { keys: '?', desc: 'عرض الاختصارات' },
];

export default function KeyboardShortcuts() {
  const { setPage } = useStore();
  const [showHelp, setShowHelp] = useState(false);
  const [pending, setPending] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      // Skip if typing in input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();

      // Show shortcuts help
      if (key === '?' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setShowHelp(v => !v);
        return;
      }

      // ESC closes everything
      if (key === 'escape') { setShowHelp(false); setPending(''); return; }

      // G + letter navigation
      if (pending === 'g') {
        const map: Record<string, Page> = {
          h: 'dashboard', p: 'products', o: 'orders',
          m: 'conversations', c: 'customers', a: 'analytics', s: 'settings',
          n: 'notifications', d: 'delivery', r: 'connections',
        };
        if (map[key]) { setPage(map[key]); setPending(''); return; }
        setPending('');
      }

      if (key === 'g') {
        setPending('g');
        timer = setTimeout(() => setPending(''), 1500);
      }
    };

    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); clearTimeout(timer); };
  }, [pending, setPage]);

  if (!showHelp) return null;

  return (
    <div className="modal-overlay" onClick={() => setShowHelp(false)}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-primary font-black text-lg">⌨️ اختصارات لوحة المفاتيح</h2>
          <button onClick={() => setShowHelp(false)} className="text-muted hover:text-secondary">✕</button>
        </div>
        <div className="p-5 space-y-2">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
              <span className="text-secondary text-sm">{s.desc}</span>
              <kbd className="px-2.5 py-1 rounded-lg text-xs font-mono text-indigo-300"
                style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                {s.keys}
              </kbd>
            </div>
          ))}
          <p className="text-muted text-xs pt-2 text-center">اضغط ESC أو ? للإغلاق</p>
        </div>
      </div>
    </div>
  );
}
