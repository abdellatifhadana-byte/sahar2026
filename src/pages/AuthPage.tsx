import { useState } from 'react';
import { useStore } from '../store';
import { Lock, Mail, User, ArrowRight, Store, Eye, EyeOff } from 'lucide-react';

export default function AuthPage() {
  const [isLogin, setIsLogin]   = useState(true);
  const [form, setForm]         = useState({ name: '', email: '', password: '', storeName: '' });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [showPass, setShowPass] = useState(false);
  const { login, register, notify, setPage } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.email || !form.password) { setError('البريد الإلكتروني وكلمة المرور مطلوبان'); return; }
    if (!isLogin && !form.name) { setError('الاسم مطلوب'); return; }
    if (!isLogin && form.password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

    setLoading(true);
    try {
      if (isLogin) {
        await login(form.email, form.password);
        notify('success', 'مرحباً بعودتك! 👋');
      } else {
        await register(form.name, form.email, form.password, form.storeName);
        notify('success', 'تم إنشاء الحساب! هيا نعد متجرك 🚀');
      }
    } catch (err: any) {
      const msg = err.message || (isLogin ? 'بيانات الدخول غير صحيحة' : 'حدث خطأ أثناء إنشاء الحساب');
      setError(msg);
    }
    setLoading(false);
  };

  const inp = {
    width: '100%', padding: '13px 42px 13px 14px', borderRadius: 12,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--void)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(255,77,26,.07) 0%, transparent 60%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 70, height: 70, margin: '0 auto 16px', borderRadius: 20, background: 'var(--ember)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 900, color: '#fff', boxShadow: '0 8px 32px rgba(255,77,26,.4)' }}>م</div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: 'var(--ink1)', marginBottom: 6, letterSpacing: '-.02em' }}>AI Commerce OS</h1>
          <p style={{ color: 'var(--ink3)', fontSize: 13 }}>نظام البيع الذكي للسوق المغربي</p>
        </div>

        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 24, padding: 28, backdropFilter: 'blur(20px)', boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', background: 'var(--void2)', borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {[{ v: true, l: 'تسجيل الدخول' }, { v: false, l: 'حساب جديد' }].map(({ v, l }) => (
              <button key={l} onClick={() => { setIsLogin(v); setError(''); }} style={{
                flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .2s',
                background: isLogin === v ? 'var(--ember)' : 'transparent',
                color: isLogin === v ? '#fff' : 'var(--ink3)', border: 'none',
              }}>{l}</button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!isLogin && (
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
                <input style={inp} type="text" placeholder="اسمك الكامل *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required={!isLogin} />
              </div>
            )}
            {!isLogin && (
              <div style={{ position: 'relative' }}>
                <Store size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
                <input style={inp} type="text" placeholder="اسم متجرك (اختياري)" value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} />
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
              <input style={{ ...inp, direction: 'ltr', textAlign: 'right' }} type="email" placeholder="البريد الإلكتروني *" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
              <input style={{ ...inp, direction: 'ltr', textAlign: 'right', paddingLeft: 42 }} type={showPass ? 'text' : 'password'} placeholder="كلمة المرور *" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
              <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ink3)', cursor: 'pointer', padding: 0 }}>
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {error && (
              <div style={{ background: 'rgba(255,77,26,.1)', border: '1px solid rgba(255,77,26,.25)', borderRadius: 10, padding: '10px 14px', color: 'var(--ember2)', fontSize: 13 }}>
                ⚠️ {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              marginTop: 4, padding: '15px', borderRadius: 12, border: 'none',
              background: 'var(--ember)', color: '#fff', fontSize: 15, fontWeight: 900,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 6px 20px rgba(255,77,26,.35)', transition: 'all .2s',
            }}>
              {loading ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> جارٍ التحقق...</>
              ) : (
                <>{isLogin ? 'دخول إلى لوحة التحكم' : 'إنشاء الحساب'} <ArrowRight size={17} /></>
              )}
            </button>
          </form>

          {/* Demo quick login */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <p style={{ textAlign: 'center', color: 'var(--ink3)', fontSize: 11, marginBottom: 10 }}>تجربة سريعة (Demo — بدون backend)</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => {
                // Demo mode: use seed data directly without backend
                setError('');
                setLoading(true);
                localStorage.setItem('ai_commerce_token', 'demo-token-local');
                setTimeout(() => { window.location.href = '/dashboard'; }, 300);
              }} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'rgba(255,77,26,.1)', border: '1px solid rgba(255,77,26,.25)', color: 'var(--ember2)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                👨‍💼 تاجر Demo
              </button>
              <a href="/" style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'rgba(0,200,150,.08)', border: '1px solid rgba(0,200,150,.2)', color: 'var(--mint)', cursor: 'pointer', fontWeight: 700, fontSize: 12, textDecoration:'none', display:'flex', alignItems:'center', justifyContent:'center' }}>
                🛍️ صفحة الزبائن
              </a>
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--ink3)', fontSize: 12 }}>
          لا يوجد حساب؟{' '}
          <button onClick={() => { setIsLogin(false); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--ember)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            أنشئ حساباً مجانياً
          </button>
        </p>
        <p style={{ textAlign: 'center', marginTop: 10, color: 'var(--ink3)', fontSize: 12 }}>
          <a href="/" style={{ color: 'var(--ink3)', textDecoration: 'none' }}>← رجوع للصفحة الرئيسية</a>
        </p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
