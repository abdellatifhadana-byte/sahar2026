// ================================================================
// API Client — يتصل بالـ backend عند توفره، وإلا يعمل offline
// ================================================================

const BASE_URL = (() => {
  if (typeof window !== 'undefined') {
    // Auto-detect: same origin or localhost:3001
    if (window.location.port === '5173' || window.location.port === '4173') {
      return 'http://localhost:3001/api';
    }
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:3001/api';
})();

let _token: string | null = null;
let _isOnline = false;

try {
  _token = localStorage.getItem('ai_commerce_token');
} catch {}

export function getToken()  { return _token; }
export function isOnline()  { return _isOnline; }

export function setToken(t: string | null) {
  _token = t;
  try {
    if (t) localStorage.setItem('ai_commerce_token', t);
    else localStorage.removeItem('ai_commerce_token');
  } catch {}
}

// ── Health check ──────────────────────────────────────────────
export async function checkBackend(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    _isOnline = r.ok;
  } catch {
    _isOnline = false;
  }
  return _isOnline;
}

// ── Generic request ───────────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as T;
}

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { name: string; email: string; password: string; storeName?: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/register', data),

  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: any }>('POST', '/auth/login', data),

  me: () => request<{ user: any }>('GET', '/auth/me'),

  changePassword: (data: { current: string; next: string }) =>
    request<{ success: boolean }>('POST', '/auth/change-password', data),
};

// ── Products ──────────────────────────────────────────────────
export const productsAPI = {
  list:   ()              => request<any[]>('GET', '/products'),
  create: (data: any)     => request<any>('POST', '/products', data),
  update: (id: string, d: any) => request<any>('PUT', `/products/${id}`, d),
  remove: (id: string)    => request<any>('DELETE', `/products/${id}`),
};

// ── Orders ────────────────────────────────────────────────────
export const ordersAPI = {
  list:    ()            => request<any[]>('GET', '/orders'),
  create:  (data: any)   => request<any>('POST', '/orders', data),
  approve: (id: string)  => request<any>('PUT', `/orders/${id}/approve`),
  reject:  (id: string)  => request<any>('PUT', `/orders/${id}/reject`),
  ship:    (id: string, data?: any) => request<any>('PUT', `/orders/${id}/ship`, data),
  deliver: (id: string)  => request<any>('PUT', `/orders/${id}/deliver`),
  update:  (id: string, d: any) => request<any>('PUT', `/orders/${id}`, d),
};

// ── Customers ─────────────────────────────────────────────────
export const customersAPI = {
  list:   ()             => request<any[]>('GET', '/customers'),
  create: (data: any)    => request<any>('POST', '/customers', data),
  update: (id: string, d: any) => request<any>('PUT', `/customers/${id}`, d),
};

// ── Conversations ─────────────────────────────────────────────
export const conversationsAPI = {
  list:         ()              => request<any[]>('GET', '/conversations'),
  create:       (data: any)     => request<any>('POST', '/conversations', data),
  sendMessage:  (id: string, d: any) => request<any>('POST', `/conversations/${id}/messages`, d),
};

// ── Settings ──────────────────────────────────────────────────
export const settingsAPI = {
  get:           ()       => request<any>('GET', '/settings'),
  save:          (d: any) => request<any>('PUT', '/settings', d),
  getLogs:       ()       => request<any[]>('GET', '/settings/logs'),
  getNotifs:     ()       => request<any[]>('GET', '/settings/notifications'),
  markRead:      ()       => request<any>('POST', '/settings/notifications/read'),
  clearNotifs:   ()       => request<any>('DELETE', '/settings/notifications'),
  getTemplates:  ()       => request<any[]>('GET', '/settings/templates'),
  saveTemplates: (t: any) => request<any>('PUT', '/settings/templates', t),
};

// ── Analytics ─────────────────────────────────────────────────
export const analyticsAPI = {
  get: () => request<any>('GET', '/analytics'),
};

// ── Broadcast ─────────────────────────────────────────────────
export const broadcastAPI = {
  send:    (data: any) => request<any>('POST', '/broadcast', data),
  history: ()          => request<any[]>('GET', '/broadcast/history'),
};

// ── Media ─────────────────────────────────────────────────────
export const mediaAPI = {
  uploadBase64: (data: string, ext = 'jpg') =>
    request<{ url: string; filename: string }>('POST', '/media/upload-base64', { data, ext }),
};

// ── Delivery ──────────────────────────────────────────────────
export const deliveryAPI = {
  list:     ()           => request<any[]>('GET', '/delivery'),
  save:     (data: any)  => request<any>('POST', '/delivery', data),
  remove:   (id: string) => request<any>('DELETE', `/delivery/${id}`),
  simulate: (orderId: string) => request<any>('POST', `/delivery/simulate/${orderId}`),
};

// ── AI chat via backend ───────────────────────────────────────
export const aiAPI = {
  reply: (data: {
    message: string;
    history: any[];
    products: any[];
    settings: any;
  }) => request<{ reply: string; model: string }>('POST', '/ai/reply', data),
};

// ── Loyalty ──────────────────────────────────────────────────
export const loyaltyAPI = {
  get: (customerId: string) => request<any>('GET', `/loyalty/${customerId}`),
  add: (data: { customerId: string; amount: number }) => request<any>('POST', '/loyalty/add', data),
};

// ── WebSocket real-time ───────────────────────────────────────
let _ws: WebSocket | null = null;
const _handlers = new Map<string, Set<(data: any) => void>>();

export function connectWS(userId: string) {
  if (_ws && _ws.readyState < 2) return;
  try {
    const wsBase = BASE_URL.replace(/^http/, 'ws').replace('/api', '');
    _ws = new WebSocket(`${wsBase}/ws?userId=${userId}`);
    _ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        _handlers.get(event)?.forEach(fn => fn(data));
      } catch {}
    };
    _ws.onerror = () => {};
    _ws.onclose = () => {
      setTimeout(() => connectWS(userId), 5000);
    };
  } catch {}
}

export function onWS(event: string, handler: (data: any) => void) {
  if (!_handlers.has(event)) _handlers.set(event, new Set());
  _handlers.get(event)!.add(handler);
  return () => _handlers.get(event)?.delete(handler);
}

export function disconnectWS() {
  _ws?.close();
  _ws = null;
}
