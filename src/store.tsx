import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  defaultSettings, seedProducts, seedCustomers, seedOrders,
  seedConversations, seedAuditLogs,
  type AppSettings, type Product, type Customer, type Order,
  type Conversation, type ConvMessage, type AuditLog, type AppNotification, type Template,
  type Page, type UserRole, type LogType, type LogSeverity, type NotifType, type OrderStatus,
} from './types';
import * as api from './services/api';

interface StoreValue {
  token: string | null;
  user: any;
  settings: AppSettings;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  conversations: Conversation[];
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  currentPage: Page;
  currentRole: UserRole;
  isOnline: boolean;
  sidebarOpen: boolean;

  // Auth
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, storeName?: string) => Promise<void>;
  logout: () => void;

  setPage: (p: Page) => void;
  setSidebarOpen: (v: boolean) => void;
  updateSettings: (key: keyof AppSettings, val: any) => Promise<void>;

  // Products
  addProduct: (p: any) => Promise<void>;
  updateProduct: (id: string, u: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  adjustStock: (id: string, delta: number) => Promise<void>;

  // Customers
  addCustomer: (c: any) => Promise<void>;
  updateCustomer: (id: string, u: Partial<Customer>) => Promise<void>;

  // Orders
  addOrder: (o: any) => Promise<string>;
  updateOrder: (id: string, u: Partial<Order>) => Promise<void>;
  approveOrder: (id: string) => Promise<void>;
  rejectOrder: (id: string, reason?: string) => Promise<void>;
  shipOrder: (id: string, provider?: string, tracking?: string) => Promise<void>;
  deliverOrder: (id: string) => Promise<void>;

  // Conversations
  sendMessage: (convId: string, content: string, role: 'customer' | 'agent' | 'ai') => Promise<void>;
  addConversation: (c: any) => Promise<string>;
  updateConversation: (id: string, u: Partial<Conversation>) => Promise<void>;

  // Templates
  addTemplate: (t: any) => Promise<void>;
  updateTemplate: (id: string, u: Partial<Template>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  // System
  notify: (type: NotifType, message: string) => void;
  clearNotifications: () => void;
  markNotifRead: (id: string) => void;
  log: (user: string, action: string, details: string, type: LogType, severity: LogSeverity) => void;
  exportData: () => void;
  importData: (json: string) => boolean;
  resetToDemo: () => void;
  refreshData: () => Promise<void>;
}

const StoreCtx = createContext<StoreValue | null>(null);
const uid = () => Math.random().toString(36).slice(2, 9);
const nowStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};


// URL → Page mapping for initial load
const URL_TO_PAGE: Record<string, string> = {
  '/dashboard': 'dashboard', '/products': 'products', '/orders': 'orders',
  '/messages': 'conversations', '/customers': 'customers', '/analytics': 'analytics',
  '/connections': 'connections', '/delivery': 'delivery', '/notifications': 'notifications',
  '/settings': 'settings', '/studio': 'banner', '/editor': 'editor',
};

function getInitialPage(): Page {
  const path = window.location.pathname;
  return (URL_TO_PAGE[path] as Page) || 'dashboard';
}

// Read token from localStorage on startup
const storedToken = (() => { try { return localStorage.getItem('ai_commerce_token'); } catch { return null; } })();
if (storedToken) api.setToken(storedToken);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({
    token: storedToken,
    user: (() => { try { const u = localStorage.getItem('ai_commerce_user'); return u ? JSON.parse(u) : null; } catch { return null; } })(),
    settings: defaultSettings,
    products: seedProducts,
    customers: seedCustomers,
    orders: seedOrders,
    conversations: seedConversations,
    auditLogs: seedAuditLogs,
    notifications: [] as AppNotification[],
    currentPage: (storedToken ? getInitialPage() : 'dashboard') as Page,
    currentRole: 'admin' as UserRole,
    isOnline: false,
    sidebarOpen: false,
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((type: NotifType, message: string) => {
    setState(s => ({ ...s, notifications: [{ id: uid(), type, message, timestamp: Date.now(), read: false }, ...s.notifications].slice(0, 50) }));
  }, []);

  const log = useCallback((user: string, action: string, details: string, type: LogType, severity: LogSeverity) => {
    setState(s => ({ ...s, auditLogs: [{ id: Date.now(), timestamp: nowStr(), user, action, details, type, severity }, ...s.auditLogs].slice(0, 300) }));
  }, []);

  // Full data sync from backend
  const refreshData = useCallback(async () => {
    // Demo mode: skip backend calls
    if (api.getToken() === 'demo-token-local') {
      setState(s => ({ ...s, isOnline: false }));
      return;
    }
    const online = await api.checkBackend();
    if (!online) {
      try {
        const saved = localStorage.getItem('ai_commerce_os_state');
        if (saved) {
          const parsed = JSON.parse(saved);
          setState(s => ({ ...s, ...parsed, isOnline: false, token: s.token, user: s.user }));
        }
      } catch {}
      return;
    }

    if (!api.getToken()) { setState(s => ({ ...s, isOnline: true })); return; }

    try {
      const meData = await api.authAPI.me().catch(() => null);
      const currentUser = meData?.user || null;
      if (currentUser) { try { localStorage.setItem('ai_commerce_user', JSON.stringify(currentUser)); } catch {} }

      const [products, orders, customers, settings, convs] = await Promise.all([
        api.productsAPI.list(),
        api.ordersAPI.list(),
        api.customersAPI.list(),
        api.settingsAPI.get(),
        api.conversationsAPI.list(),
      ]);
      setState(s => ({
        ...s,
        user: currentUser || s.user,
        products: products || s.products,
        orders: orders || s.orders,
        customers: customers || s.customers,
        settings: (settings && settings.brand) ? { ...s.settings, ...settings } : s.settings,
        conversations: convs || s.conversations,
        isOnline: true,
      }));
    } catch (e: any) {
      setState(s => ({ ...s, isOnline: false }));
    }
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  // Persist offline state
  useEffect(() => {
    if (!state.isOnline && state.token) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          const { token, user, notifications, currentPage, sidebarOpen, ...toSave } = state;
          localStorage.setItem('ai_commerce_os_state', JSON.stringify(toSave));
        } catch {}
      }, 1000);
    }
  }, [state]);

  // WebSocket real-time updates
  useEffect(() => {
    if (!state.isOnline || !state.user?.id) return;
    api.connectWS(state.user.id);
    const offOrder = api.onWS('order_created', (data) => {
      setState(s => ({ ...s, orders: [data, ...s.orders.filter(o => o.id !== data.id)] }));
      notify('info', `🛒 طلب جديد من ${data.customerName}`);
    });
    const offUpdated = api.onWS('order_updated', (data) => {
      setState(s => ({ ...s, orders: s.orders.map(o => o.id === data.id ? data : o) }));
    });
    const offMsg = api.onWS('new_message', ({ convId, data: msg }) => {
      setState(s => ({
        ...s,
        conversations: s.conversations.map(c => c.id === convId
          ? { ...c, messages: [...(c.messages||[]), msg], lastMessage: msg.content, unread: msg.role !== 'ai' ? (c.unread||0)+1 : c.unread }
          : c)
      }));
    });
    return () => { offOrder(); offUpdated(); offMsg(); };
  }, [state.isOnline, state.user?.id, notify]);

  // ── AUTH ──────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    const { token, user } = await api.authAPI.login({ email, password });
    api.setToken(token);
    try { localStorage.setItem('ai_commerce_user', JSON.stringify(user)); } catch {}
    setState(s => ({ ...s, token, user, currentPage: 'dashboard' }));
    setTimeout(() => refreshData(), 100);
    // Redirect to dashboard
    if (window.location.pathname === '/' || window.location.pathname === '/login' || window.location.pathname === '/register') {
      window.history.pushState({}, '', '/dashboard');
    }
  };

  const register = async (name: string, email: string, password: string, storeName?: string) => {
    const { token, user } = await api.authAPI.register({ name, email, password, storeName });
    api.setToken(token);
    try { localStorage.setItem('ai_commerce_user', JSON.stringify(user)); } catch {}
    setState(s => ({ ...s, token, user, currentPage: 'dashboard', settings: { ...s.settings, onboardingDone: false as any } }));
    setTimeout(() => refreshData(), 100);
    if (window.location.pathname === '/' || window.location.pathname === '/login' || window.location.pathname === '/register') {
      window.history.pushState({}, '', '/dashboard');
    }
  };

  const logout = () => {
    api.setToken(null);
    api.disconnectWS();
    try { localStorage.removeItem('ai_commerce_user'); } catch {}
    setState(s => ({ ...s, token: null, user: null, currentPage: 'dashboard', products: seedProducts, orders: seedOrders, customers: seedCustomers, conversations: seedConversations }));
    window.location.href = '/login';
  };

  // ── SETTINGS ──────────────────────────────────────────────
  const updateSettings = async (key: keyof AppSettings, val: any) => {
    setState(s => ({ ...s, settings: { ...s.settings, [key]: val } }));
    if (state.isOnline && api.getToken()) {
      try { await api.settingsAPI.save({ [key]: val }); } catch {}
    }
  };

  // ── PRODUCTS ─────────────────────────────────────────────
  const addProduct = async (p: any) => {
    let np: Product;
    if (state.isOnline && api.getToken()) {
      np = await api.productsAPI.create(p);
    } else {
      np = { ...p, id: 'L'+Date.now(), sku: 'PRD-'+uid(), createdAt: new Date().toISOString().split('T')[0], views: 0, sales: 0 };
    }
    setState(s => ({ ...s, products: [np, ...s.products] }));
    log('المدير', `أضاف منتج: ${np.name}`, `${np.price} ${state.settings.brand.currency}`, 'product', 'success');
  };

  const updateProduct = async (id: string, u: Partial<Product>) => {
    setState(s => ({ ...s, products: s.products.map(p => p.id === id ? { ...p, ...u } : p) }));
    if (state.isOnline && api.getToken()) {
      try { await api.productsAPI.update(id, u); } catch {}
    }
  };

  const deleteProduct = async (id: string) => {
    const p = state.products.find(x => x.id === id);
    setState(s => ({ ...s, products: s.products.filter(p => p.id !== id) }));
    if (state.isOnline && api.getToken()) {
      try { await api.productsAPI.remove(id); } catch {}
    }
    if (p) log('المدير', `حذف منتج: ${p.name}`, '', 'product', 'warning');
  };

  const adjustStock = async (id: string, delta: number) => {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    const newStock = Math.max(0, p.stock + delta);
    setState(s => ({ ...s, products: s.products.map(x => x.id === id ? { ...x, stock: newStock } : x) }));
    if (state.isOnline && api.getToken()) {
      try { await api.productsAPI.update(id, { stock: newStock }); } catch {}
    }
  };

  // ── CUSTOMERS ────────────────────────────────────────────
  const addCustomer = async (c: any) => {
    let nc: Customer;
    if (state.isOnline && api.getToken()) {
      nc = await api.customersAPI.create(c);
    } else {
      nc = { ...c, id: 'C'+uid(), totalOrders: 0, totalSpent: 0, lastOrderDate: nowStr(), vip: false, trustScore: 80, buyerScore: 50 };
    }
    setState(s => ({ ...s, customers: [nc, ...s.customers] }));
  };

  const updateCustomer = async (id: string, u: Partial<Customer>) => {
    setState(s => ({ ...s, customers: s.customers.map(c => c.id === id ? { ...c, ...u } : c) }));
    if (state.isOnline && api.getToken()) {
      try { await api.customersAPI.update(id, u); } catch {}
    }
  };

  // ── ORDERS ───────────────────────────────────────────────
  const addOrder = async (o: any) => {
    let order: any;
    if (state.isOnline && api.getToken()) {
      order = await api.ordersAPI.create(o);
    } else {
      order = { ...o, id: 'ORD-'+uid().toUpperCase(), createdAt: new Date().toISOString() };
    }
    setState(s => ({ ...s, orders: [order, ...s.orders] }));
    notify('info', `🛒 طلب جديد من ${order.customerName}`);
    return order.id;
  };

  const updateOrder = async (id: string, u: Partial<Order>) => {
    setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? { ...o, ...u } : o) }));
    if (state.isOnline && api.getToken()) {
      try { await api.ordersAPI.update(id, u); } catch {}
    }
  };

  const approveOrder = async (id: string) => {
    setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? { ...o, status: 'approved' as OrderStatus } : o) }));
    if (state.isOnline && api.getToken()) {
      try {
        const updated = await api.ordersAPI.approve(id);
        setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? updated : o) }));
      } catch (e: any) { notify('warning', `تحذير: ${e.message}`); }
    }
    notify('success', '✅ تم تأكيد الطلب');
    log('المدير', `وافق على طلب: ${id}`, '', 'order', 'success');
  };

  const rejectOrder = async (id: string, reason?: string) => {
    setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? { ...o, status: 'cancelled' as OrderStatus } : o) }));
    if (state.isOnline && api.getToken()) {
      try { await api.ordersAPI.reject(id); } catch {}
    }
    notify('info', '❌ تم رفض الطلب');
    log('المدير', `رفض طلب: ${id}`, reason||'', 'order', 'warning');
  };

  const shipOrder = async (id: string, provider?: string, tracking?: string) => {
    const trk = tracking || 'TRK-' + Math.random().toString(36).slice(2,8).toUpperCase();
    const prov = provider || state.settings.delivery?.defaultProvider || 'Amana';
    setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? { ...o, status: 'shipped' as OrderStatus, trackingNumber: trk, deliveryProvider: prov } : o) }));
    if (state.isOnline && api.getToken()) {
      try {
        const updated = await api.ordersAPI.ship(id, { trackingNumber: trk, provider: prov });
        setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? updated : o) }));
      } catch {}
    }
    notify('success', `🚚 تم الشحن — رقم التتبع: ${trk}`);
    log('النظام', `شحن طلب: ${id}`, trk, 'delivery', 'success');
  };

  const deliverOrder = async (id: string) => {
    setState(s => ({ ...s, orders: s.orders.map(o => o.id === id ? { ...o, status: 'delivered' as OrderStatus } : o) }));
    if (state.isOnline && api.getToken()) {
      try { await api.ordersAPI.deliver(id); } catch {}
    }
    notify('success', '📦 تم التوصيل بنجاح');
    log('النظام', `تم توصيل طلب: ${id}`, '', 'order', 'success');
  };

  // ── CONVERSATIONS + AI ────────────────────────────────────
  const sendMessage = async (convId: string, content: string, role: 'customer' | 'agent' | 'ai') => {
    const ts = new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    const msg: ConvMessage = { id: uid(), content, role: role as any, timestamp: ts };

    setState(s => ({
      ...s,
      conversations: s.conversations.map(c => c.id === convId
        ? { ...c, messages: [...(c.messages||[]), msg], lastMessage: content, unread: role === 'customer' ? (c.unread||0) + 1 : 0 }
        : c)
    }));

    // If online and customer message → call backend AI
    if (role === 'customer' && state.isOnline && api.getToken()) {
      try {
        await api.conversationsAPI.sendMessage(convId, { content, role: 'customer' });
        // AI reply will come via WebSocket from server
      } catch {
        // Fallback: local AI if backend fails
        _localAIReply(convId, content);
      }
    } else if (role === 'customer' && !state.isOnline) {
      _localAIReply(convId, content);
    }
  };

  // Local AI fallback
  const _localAIReply = (convId: string, userMsg: string) => {
    const conv = state.conversations.find(c => c.id === convId);
    if (!conv) return;
    const delay = (state.settings.ai.replyDelay || 2) * 1000;
    const lo = userMsg.toLowerCase();
    const products = state.products.filter(p => p.status === 'published' && p.stock > 0);
    const cur = state.settings.brand.currency || 'MAD';
    let reply = '';

    // Product search in message
    const found = products.filter(p =>
      p.name.toLowerCase().includes(lo) || (p as any).sku?.toLowerCase().includes(lo)
    );
    if (found.length > 0 && /(عندكم|كاين|بغيت|سعر|ثمن|بكام|هاد)/i.test(lo)) {
      const p = found[0];
      reply = `وجدت المنتج! 🎉\n\n${p.emoji} **${p.name}**\n💰 السعر: ${p.price} ${cur}\n📏 المقاسات: ${(p.sizes||[]).join(' · ')||'S M L XL'}\n🎨 الألوان: ${(p.colors||[]).join(' · ')||'—'}\n📦 المخزون: ${p.stock} قطعة\n\nواش بغيت هاد المنتج؟`;
    } else if (/(سلام|مرحبا|hello|هاي)/i.test(lo)) {
      reply = `مرحباً! 👋 كيداير؟ عندنا ${products.length} منتج متوفر دابا.\nواش بغيتي تشوف شي محدد؟`;
    } else if (/(ثمن|سعر|بكام|شحال)/i.test(lo) && products.length) {
      const p = products[Math.floor(Math.random() * products.length)];
      reply = `${p.emoji} **${p.name}** — ${p.price} ${cur} 💎\nواش بغيتيه؟`;
    } else if (/(توصيل|livraison|delivery)/i.test(lo)) {
      reply = `التوصيل لجميع مدن المغرب 🇲🇦\n⏱️ 24-48 ساعة\n💰 20-40 MAD حسب المدينة\nواش بغيتي تطلب؟`;
    } else if (/(طلب|نطلب|بغيت)/i.test(lo)) {
      reply = `ممتاز! 🎉 باش نكملو الطلب محتاجين:\n1️⃣ الاسم الكامل\n2️⃣ رقم الهاتف 📱\n3️⃣ المدينة والعنوان 🏠\n4️⃣ المقاس واللون\n\nأبدأ بالاسم الكامل 😊`;
    } else if (/(غالي|خصم|discount)/i.test(lo)) {
      const max = state.settings.ai.maxDiscount || 15;
      const d = Math.round(max * 0.7);
      reply = state.settings.ai.autoDiscount
        ? `فاهمك! 😊 نقدر نعطيك خصم **${d}%** إذا طلبت أكثر من قطعة 🎁`
        : `الثمن مناسب جداً للجودة 💎 وعندنا ضمان كامل!`;
    } else {
      const generics = ['فاهمت! 😊 واش عندك سؤال آخر؟', 'أكيد! عندنا أحسن المنتجات 🔥', 'دابا نشوف ليك! 😊'];
      reply = generics[Math.floor(Math.random() * generics.length)];
    }

    setTimeout(() => {
      const ts = new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
      const aiMsg: ConvMessage = { id: uid(), content: reply, role: 'ai', timestamp: ts };
      setState(s => ({
        ...s,
        conversations: s.conversations.map(c => c.id === convId
          ? { ...c, messages: [...(c.messages||[]), aiMsg], lastMessage: reply }
          : c)
      }));
    }, delay);
  };

  const addConversation = async (c: any) => {
    let conv: any;
    if (state.isOnline && api.getToken()) {
      try { conv = await api.conversationsAPI.create(c); } catch { conv = null; }
    }
    if (!conv) {
      conv = { ...c, id: 'conv-'+Date.now(), messages: [], unread: 0, createdAt: new Date().toISOString() };
    }
    setState(s => ({ ...s, conversations: [conv, ...s.conversations] }));
    return conv.id;
  };

  const updateConversation = async (id: string, u: Partial<Conversation>) => {
    setState(s => ({ ...s, conversations: s.conversations.map(c => c.id === id ? { ...c, ...u } : c) }));
  };

  // ── TEMPLATES ────────────────────────────────────────────
  const addTemplate = async (t: any) => {
    setState(s => ({ ...s, settings: { ...s.settings, templates: [{ ...t, id: 'T'+uid(), usageCount: 0 }, ...s.settings.templates] } }));
  };
  const updateTemplate = async (id: string, u: Partial<Template>) => {
    setState(s => ({ ...s, settings: { ...s.settings, templates: s.settings.templates.map(t => t.id === id ? { ...t, ...u } : t) } }));
  };
  const deleteTemplate = async (id: string) => {
    setState(s => ({ ...s, settings: { ...s.settings, templates: s.settings.templates.filter(t => t.id !== id) } }));
  };

  // ── SYSTEM ───────────────────────────────────────────────
  const setPage = (p: Page) => setState(s => ({ ...s, currentPage: p }));
  const setSidebarOpen = (v: boolean) => setState(s => ({ ...s, sidebarOpen: v }));
  const clearNotifications = () => setState(s => ({ ...s, notifications: [] }));
  const markNotifRead = (id: string) => setState(s => ({ ...s, notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n) }));

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ products: state.products, orders: state.orders, customers: state.customers, settings: state.settings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const importData = (json: string) => {
    try { setState(s => ({ ...s, ...JSON.parse(json) })); return true; }
    catch { return false; }
  };

  const resetToDemo = () => {
    setState(s => ({ ...s, products: seedProducts, orders: seedOrders, conversations: seedConversations, customers: seedCustomers }));
  };

  return (
    <StoreCtx.Provider value={{
      ...state, login, register, logout, setPage, setSidebarOpen, updateSettings,
      addProduct, updateProduct, deleteProduct, adjustStock,
      addCustomer, updateCustomer,
      addOrder, updateOrder, approveOrder, rejectOrder, shipOrder, deliverOrder,
      sendMessage, addConversation, updateConversation,
      addTemplate, updateTemplate, deleteTemplate,
      notify, clearNotifications, markNotifRead, log,
      resetToDemo, exportData, importData, refreshData,
    }}>
      {children}
    </StoreCtx.Provider>
  );
}

export const useStore = () => {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore must be inside StoreProvider');
  return c;
};

export function useRole() {
  const { currentRole } = useStore();
  return {
    role: currentRole,
    can: (perm: string) => {
      const perms: Record<string, string[]> = {
        admin: ['*'],
        seller: ['view_dashboard','manage_products','view_orders','update_order_status','view_customers','view_conversations','view_analytics'],
        support: ['view_dashboard','view_orders','update_order_status','view_customers','manage_conversations'],
        delivery: ['view_dashboard','view_orders','update_order_status'],
      };
      const p = perms[currentRole] || [];
      return p.includes('*') || p.includes(perm);
    },
    isAdmin: currentRole === 'admin',
  };
}
