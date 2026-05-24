import { useState } from 'react';
import { useStore } from '../store';
import { CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'checking';
  detail: string;
}

export default function SystemCheck() {
  const { settings, products, orders, customers, auditLogs } = useStore();
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const results: Check[] = [];

    // Storage
    try {
      const used = JSON.stringify(localStorage).length;
      const usedMB = (used / 1024 / 1024).toFixed(2);
      const pct = Math.round((used / (5 * 1024 * 1024)) * 100);
      results.push({
        name: 'التخزين المحلي', status: pct > 80 ? 'warn' : 'ok',
        detail: `${usedMB}MB مستخدم من 5MB (${pct}%)`,
      });
    } catch {
      results.push({ name: 'التخزين المحلي', status: 'error', detail: 'فشل في قراءة localStorage' });
    }

    // AI
    if (settings.ai.apiKey) {
      results.push({ name: 'فحص AI API Key', status: 'checking', detail: 'جارٍ التحقق...' });
      setChecks([...results]);
      try {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${settings.ai.apiKey}` },
          signal: AbortSignal.timeout(6000),
        });
        results[results.length - 1] = { name: 'OpenAI API Key', status: r.ok ? 'ok' : 'error', detail: r.ok ? 'متصل ويعمل ✅' : `خطأ: ${r.status}` };
      } catch {
        results[results.length - 1] = { name: 'OpenAI API Key', status: 'error', detail: 'لم يمكن الاتصال' };
      }
    } else {
      results.push({ name: 'OpenAI API Key', status: 'warn', detail: 'غير مضاف — سيعمل بالمحاكاة' });
    }

    // WhatsApp
    if (settings.social.whatsapp.connected) {
      results.push({ name: 'WhatsApp', status: 'ok', detail: `متصل — Phone ID: ${settings.social.whatsapp.pageId?.slice(0, 8)}...` });
    } else {
      results.push({ name: 'WhatsApp', status: 'warn', detail: 'غير متصل — الإشعارات تعمل بالمحاكاة' });
    }

    // Facebook
    results.push({
      name: 'Facebook', status: settings.social.facebook.connected ? 'ok' : 'warn',
      detail: settings.social.facebook.connected ? 'متصل' : 'غير متصل',
    });

    // Instagram
    results.push({
      name: 'Instagram', status: settings.social.instagram.connected ? 'ok' : 'warn',
      detail: settings.social.instagram.connected ? 'متصل' : 'غير متصل',
    });

    // Delivery
    const activeProv = settings.delivery.providers.filter(p => p.enabled);
    results.push({
      name: 'شركات التوصيل', status: activeProv.length > 0 ? 'ok' : 'warn',
      detail: activeProv.length > 0 ? `${activeProv.length} شركة مفعّلة` : 'لم تضف شركة توصيل',
    });

    // Data
    results.push({ name: 'البيانات', status: 'ok', detail: `${products.length} منتج · ${orders.length} طلب · ${customers.length} زبون · ${auditLogs.length} سجل` });

    // Browser features
    results.push({ name: 'Web Audio (صوت)', status: 'AudioContext' in window ? 'ok' : 'warn', detail: 'AudioContext' in window ? 'متاح' : 'غير متاح في هذا المتصفح' });
    results.push({ name: 'Service Worker (PWA)', status: 'serviceWorker' in navigator ? 'ok' : 'warn', detail: 'serviceWorker' in navigator ? 'متاح — يمكن التنصيب' : 'غير متاح' });

    // Backend check
    results.push({ name: 'Backend Server', status: 'checking', detail: 'جارٍ التحقق...' });
    setChecks([...results]);
    try {
      const r = await fetch('http://localhost:3001/api/health', { signal: AbortSignal.timeout(3000) });
      const data = await r.json();
      results[results.length - 1] = { name: 'Backend Server', status: r.ok ? 'ok' : 'warn', detail: r.ok ? `يعمل — v${data.version} — ${data.uptime}` : 'لم يستجب' };
    } catch {
      results[results.length - 1] = { name: 'Backend Server', status: 'warn', detail: 'لا يعمل — التطبيق يعمل بـ localStorage' };
    }

    setChecks(results);
    setRunning(false);
  };

  const statusIcon = (s: Check['status']) => {
    if (s === 'ok')       return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (s === 'warn')     return <AlertCircle className="w-4 h-4 text-amber-400" />;
    if (s === 'error')    return <XCircle className="w-4 h-4 text-red-400" />;
    return <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />;
  };

  const statusBg = (s: Check['status']) => {
    if (s === 'ok')    return 'rgba(16,185,129,0.07)';
    if (s === 'warn')  return 'rgba(245,158,11,0.07)';
    if (s === 'error') return 'rgba(239,68,68,0.07)';
    return 'var(--bg-input)';
  };

  const summary = checks.length > 0 ? {
    ok: checks.filter(c => c.status === 'ok').length,
    warn: checks.filter(c => c.status === 'warn').length,
    error: checks.filter(c => c.status === 'error').length,
  } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-primary font-bold">فحص النظام</h2>
          <p className="text-muted text-xs">تحقق من حالة كل مكون</p>
        </div>
        <button onClick={run} disabled={running} className="btn btn-primary btn-sm disabled:opacity-50">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {running ? 'جارٍ الفحص...' : 'فحص الآن'}
        </button>
      </div>

      {summary && (
        <div className="flex gap-3">
          <span className="badge text-emerald-400 px-3 py-1" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}>✅ {summary.ok} سليم</span>
          {summary.warn > 0 && <span className="badge text-amber-400 px-3 py-1" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>⚠️ {summary.warn} تحذير</span>}
          {summary.error > 0 && <span className="badge text-red-400 px-3 py-1" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>❌ {summary.error} خطأ</span>}
        </div>
      )}

      {checks.length > 0 && (
        <div className="space-y-2">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl border"
              style={{ background: statusBg(c.status), borderColor: 'var(--border)' }}>
              <div className="flex-shrink-0 mt-0.5">{statusIcon(c.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-primary font-semibold text-sm">{c.name}</p>
                <p className="text-muted text-xs">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {checks.length === 0 && (
        <div className="card p-12 text-center text-muted">
          <RefreshCw className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <p className="text-sm">اضغط "فحص الآن" لبدء التحقق من النظام</p>
        </div>
      )}
    </div>
  );
}
