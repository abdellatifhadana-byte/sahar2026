import { useState, useEffect, lazy, Suspense } from 'react';
import { useStore } from '../store';
import NavBar from './NavBar';
import KeyboardShortcuts from '../components/KeyboardShortcuts';
import GlobalSearch from '../components/GlobalSearch';
import type { AppNotification } from '../types';

const DashboardPage    = lazy(() => import('./DashboardPage'));
const ProductsPage     = lazy(() => import('./ProductsPage'));
const OrdersPage       = lazy(() => import('./OrdersPage'));
const MessagesPage     = lazy(() => import('./MessagesPage'));
const CustomersPage    = lazy(() => import('./CustomersPage'));
const AnalyticsPage    = lazy(() => import('./AnalyticsPage'));
const ConnectionsPage  = lazy(() => import('./ConnectionsPage'));
const DeliveryPage     = lazy(() => import('./DeliveryPage'));
const NotificationsPage= lazy(() => import('./NotificationsPage'));
const SettingsPage     = lazy(() => import('./SettingsPage'));
const BannerStudioPage  = lazy(() => import('./BannerStudioPage'));
const ImageEditorPage   = lazy(() => import('./ImageEditorPage'));

function PageSkeleton() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="skeleton" style={{ height: 36, width: '40%' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 18 }} />)}
      </div>
      <div className="skeleton" style={{ height: 220, borderRadius: 18 }} />
    </div>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-bar">
      📡 أنت غير متصل — التطبيق يعمل بالبيانات المحلية
    </div>
  );
}

function AutoSaveTag() {
  const { auditLogs } = useStore();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (auditLogs.length > 0) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2200);
      return () => clearTimeout(t);
    }
  }, [auditLogs.length]);
  if (!visible) return null;
  return <div className="autosave-tag">✓ تم الحفظ</div>;
}

export default function MainLayout() {
  const { currentPage, notifications, markNotifRead, logout, isOnline, refreshData } = useStore();
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  // Cmd+K global search
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(v => !v);
      }
      if (e.key === 'Escape') setShowSearch(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Toasts
  useEffect(() => {
    const unread = notifications.filter(n => !n.read).slice(0, 3);
    if (unread.length > 0) {
      setToasts(unread);
      const t = setTimeout(() => {
        setToasts([]);
        unread.forEach(n => markNotifRead(n.id));
      }, 4500);
      return () => clearTimeout(t);
    }
  }, [notifications, markNotifRead]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':     return <DashboardPage />;
      case 'products':      return <ProductsPage />;
      case 'orders':        return <OrdersPage />;
      case 'conversations': return <MessagesPage />;
      case 'customers':     return <CustomersPage />;
      case 'analytics':     return <AnalyticsPage />;
      case 'connections':   return <ConnectionsPage />;
      case 'delivery':      return <DeliveryPage />;
      case 'notifications': return <NotificationsPage />;
      case 'settings':      return <SettingsPage />;
      case 'banner':        return <BannerStudioPage />;
      case 'editor':        return <ImageEditorPage />;
      default:              return <DashboardPage />;
    }
  };

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', position: 'relative', zIndex: 1 }}>
      {/* Subtle grid overlay on top of global background */}
      <div className="bg-grid" style={{ opacity: 0.05, position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }} />

      <OfflineBanner />
      <NavBar />

      <main className="main-content">
        <div className="page-wrap">
          <Suspense fallback={<PageSkeleton />}>
            <div className="anim-fade-up" key={currentPage}>
              {renderPage()}
            </div>
          </Suspense>
        </div>
      </main>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.map(n => (
            <div key={n.id} className={`toast toast-${n.type}`} onClick={() => markNotifRead(n.id)}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {n.type === 'success' ? '✅' : n.type === 'error' ? '❌' : n.type === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <span style={{ flex: 1 }}>{n.message}</span>
            </div>
          ))}
        </div>
      )}

      <AutoSaveTag />
      <KeyboardShortcuts />
      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} />}
    </div>
  );
}
