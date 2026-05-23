// ================================================================
// AI Commerce OS — Complete Type System v8
// ================================================================

export type Page =
  | 'dashboard' | 'products' | 'orders' | 'conversations'
  | 'customers' | 'analytics' | 'connections' | 'delivery'
  | 'notifications' | 'settings' | 'banner' | 'editor';

export type UserRole = 'admin' | 'seller' | 'support' | 'delivery';
export type OrderStatus = 'pending' | 'pending_confirmation' | 'approved' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type ProductStatus = 'draft' | 'published' | 'archived';
export type NotifType = 'success' | 'error' | 'warning' | 'info';
export type LogType = 'product' | 'order' | 'customer' | 'ai' | 'delivery' | 'settings' | 'auth' | 'notification';
export type LogSeverity = 'info' | 'success' | 'warning' | 'error';

// ── Entities ──────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
  sizes: string[];
  colors: string[];
  status: ProductStatus;
  emoji: string;
  imageUrl: string;
  images: string[]; // معرض الصور
  isForChildren: boolean;
  ageRange?: string; // للأطفال
  views: number;
  sales: number;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  source: 'WhatsApp' | 'Instagram' | 'Messenger' | 'TikTok' | 'مباشر';
  notes: string;
  vip: boolean;
  trustScore: number; // 0-100 (Delivery Trust)
  buyerScore: number; // 0-100 (Likelihood to buy)
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  source: string;
  deliveryProvider: string;
  trackingNumber: string;
  notes: string;
  needsReview: boolean;
  reviewReason?: string;
  createdAt: string;
}

export interface ConvMessage {
  id: string;
  content: string;
  role: 'customer' | 'ai' | 'agent';
  timestamp: string;
  templateUsed?: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  source: 'WhatsApp' | 'Instagram' | 'Messenger' | 'TikTok';
  status: 'active' | 'waiting' | 'closed';
  lastMessage: string;
  messages: ConvMessage[];
  unread: number;
  priority: 'low' | 'medium' | 'high'; // AI Priority
  mood: 'neutral' | 'interested' | 'hesitant' | 'angry' | 'urgent'; // AI Mood
  pinned?: boolean;
  label?: 'urgent' | 'followup' | 'done' | null;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  type: LogType;
  severity: LogSeverity;
}

export interface AppNotification {
  id: string;
  type: NotifType;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface Template {
  id: string;
  name: string;
  category: 'greeting' | 'reply' | 'caption' | 'followup' | 'escalation';
  content: string;
  variables: string[];
  active: boolean;
  usageCount: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface SalesGoal {
  daily: number;
  monthly: number;
}

// ── Settings ──────────────────────────────────────────────────

export interface BrandSettings {
  name: string;
  logo: string;
  currency: string;
  language: string;
  timezone: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  workStart: string;
  workEnd: string;
}

export interface SocialConnection {
  connected: boolean;
  pageId: string;
  accessToken: string;
  name: string;
  autoPublish: boolean;
  autoHashtags: boolean;
  captionTemplate: string;
}

export interface SocialSettings {
  whatsapp: SocialConnection;
  facebook: SocialConnection;
  instagram: SocialConnection;
  tiktok: SocialConnection;
}

export interface AISettings {
  apiKey: string;
  provider: 'openai' | 'gemini';
  model: string;
  geminiKey: string;
  personality: string;
  tone: string;
  language: string;
  replyDelay: number;
  humanSimulation: boolean;
  autoDiscount: boolean;
  maxDiscount: number;
  systemPrompt: string;
  temperature: number;
  darijaMode: boolean;
  contextMemory: number;
  learnFromConversations: boolean;
}

export interface DeliveryProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'api' | 'browser';
  logo: string;
  websiteUrl: string;
  loginUrl: string;
  username: string;
  password: string;
  addOrderPage: string;
  livraisonBonPage: string;
  ramassagePage: string;
  apiKey: string;
  apiEndpoint: string;
  fields: Record<string, string>;
}

export interface DeliverySettings {
  providers: DeliveryProviderConfig[];
  defaultProvider: string;
  autoSendOnApproval: boolean;
  notifyCustomerOnShip: boolean;
  trackingUrlTemplate: string;
}

export interface ProductSettings {
  autoSku: boolean;
  skuPrefix: string;
  lowStockAlert: number;
  defaultSizes: string[];
  defaultColors: string[];
  categories: string[];
  taxRate: number;
  autoPublishOnCreate: boolean;
}

export interface ChatbotSettings {
  greetingMessage: string;
  fallbackMessage: string;
  quickReplies: string[];
  escalationKeywords: string[];
  autoClose: boolean;
  autoCloseMinutes: number;
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  autoLogoutMinutes: number;
  loginNotification: boolean;
}

export interface NotifSettings {
  newOrder: boolean;
  newMessage: boolean;
  lowStock: boolean;
  orderShipped: boolean;
  sound: boolean;
  whatsappBroadcast: boolean;
}

export interface DesignSettings {
  theme: 'dark' | 'light';
  primaryColor: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  compressImages: boolean;
}

export interface AppSettings {
  brand: BrandSettings;
  social: SocialSettings;
  ai: AISettings;
  chatbot: ChatbotSettings;
  delivery: DeliverySettings;
  products: ProductSettings;
  security: SecuritySettings;
  notifs: NotifSettings;
  design: DesignSettings;
  templates: Template[];
  team: TeamMember[];
  goals: SalesGoal;
  cloudEnabled: boolean;
  supabaseUrl: string;
  supabaseKey: string;
  onboardingDone: boolean;
}

// ── Defaults ──────────────────────────────────────────────────

const defSocial: SocialConnection = {
  connected: false, pageId: '', accessToken: '', name: '',
  autoPublish: false, autoHashtags: true, captionTemplate: '',
};

export const defaultSettings: AppSettings = {
  brand: {
    name: 'متجري', logo: '', currency: 'MAD', language: 'ar',
    timezone: 'Africa/Casablanca', phone: '', email: '',
    address: '', description: '', workStart: '09:00', workEnd: '21:00',
  },
  social: {
    whatsapp: { ...defSocial },
    facebook: { ...defSocial },
    instagram: { ...defSocial },
    tiktok: { ...defSocial },
  },
  ai: {
    apiKey: '', provider: 'openai', model: 'gpt-4o-mini', geminiKey: '',
    personality: 'Moroccan Seller', tone: 'Friendly', language: 'Darija',
    replyDelay: 2, humanSimulation: true, autoDiscount: true, maxDiscount: 15,
    systemPrompt: 'أنت مساعد بيع ذكي لمتجر مغربي. تحدث بالدارجة المغربية بأسلوب ودود واحترافي.',
    temperature: 0.7, darijaMode: true, contextMemory: 10, learnFromConversations: false,
  },
  chatbot: {
    greetingMessage: 'مرحباً! 👋 كيف يمكنني مساعدتك؟',
    fallbackMessage: 'عذراً، لم أفهم. هل يمكنك إعادة السؤال؟',
    quickReplies: ['السعر؟', 'المقاسات؟', 'التوصيل؟', 'للطلب؟'],
    escalationKeywords: ['مشكلة', 'شكوى', 'مسؤول', 'نهضر معا'],
    autoClose: false, autoCloseMinutes: 30,
  },
  delivery: {
    providers: [], defaultProvider: '',
    autoSendOnApproval: false, notifyCustomerOnShip: true,
    trackingUrlTemplate: '',
  },
  products: {
    autoSku: true, skuPrefix: 'PRD', lowStockAlert: 5,
    defaultSizes: ['S', 'M', 'L', 'XL'],
    defaultColors: ['أسود', 'أبيض', 'أحمر', 'أزرق'],
    categories: ['ملابس رجالية', 'ملابس نسائية', 'أحذية', 'إكسسوارات', 'ملابس أطفال'],
    taxRate: 0, autoPublishOnCreate: false,
  },
  security: { twoFactorEnabled: false, autoLogoutMinutes: 60, loginNotification: true },
  notifs: { newOrder: true, newMessage: true, lowStock: true, orderShipped: true, sound: true, whatsappBroadcast: false },
  design: { theme: 'dark', primaryColor: '#6366f1', watermarkEnabled: false, watermarkText: '', compressImages: true },
  templates: [
    { id: 't1', name: 'ترحيب', category: 'greeting', content: 'مرحباً {name}! 👋 كيف يمكنني مساعدتك؟', variables: ['name'], active: true, usageCount: 0 },
    { id: 't2', name: 'عرض السعر', category: 'reply', content: '💎 {product}\nالسعر: {price} {currency}\nجودة ممتازة وتوصيل سريع 🚚', variables: ['product', 'price', 'currency'], active: true, usageCount: 0 },
    { id: 't3', name: 'تأكيد الطلب', category: 'followup', content: '✅ تم تأكيد طلبك!\nسيصلك خلال 24-48 ساعة 🚚\nشكراً على ثقتك 😊', variables: [], active: true, usageCount: 0 },
    { id: 't4', name: 'إشعار شحن', category: 'followup', content: '🚚 تم شحن طلبك!\nرقم التتبع: {tracking}\nللتتبع: {url}', variables: ['tracking', 'url'], active: true, usageCount: 0 },
    { id: 't5', name: 'وصف منتج', category: 'caption', content: '✨ {product} ✨\n💰 {price} {currency} فقط!\n🚚 توصيل لجميع المدن\n📞 للطلب راسلنا الآن!', variables: ['product', 'price', 'currency'], active: true, usageCount: 0 },
  ],
  team: [{ id: 'u1', name: 'المدير', email: 'admin@mystore.ma', role: 'admin', active: true }],
  goals: { daily: 1000, monthly: 30000 },
  cloudEnabled: false, supabaseUrl: '', supabaseKey: '',
  onboardingDone: false,
};

// ── Seed Data ──────────────────────────────────────────────────

export const seedProducts: Product[] = [
  { id: 'P1', name: 'قميص كتان كلاسيك', description: 'قميص كتان فاخر 100%', price: 299, cost: 150, stock: 45, category: 'ملابس رجالية', sizes: ['M','L','XL'], colors: ['أبيض','أزرق','بيج'], status: 'published', emoji: '👔', imageUrl: '', images: [], isForChildren: false, views: 342, sales: 45, createdAt: '2025-01-10' },
  { id: 'P2', name: 'فستان سهرة أنيق', description: 'فستان بتصميم عصري', price: 599, cost: 280, stock: 12, category: 'ملابس نسائية', sizes: ['S','M','L'], colors: ['أسود','أحمر','نبيتي'], status: 'published', emoji: '👗', imageUrl: '', images: [], isForChildren: false, views: 567, sales: 32, createdAt: '2025-01-08' },
  { id: 'P3', name: 'جاكيت جلد فاخر', description: 'جلد طبيعي 100%', price: 899, cost: 450, stock: 8, category: 'ملابس رجالية', sizes: ['M','L','XL'], colors: ['أسود','بني'], status: 'published', emoji: '🧥', imageUrl: '', images: [], isForChildren: false, views: 234, sales: 18, createdAt: '2025-01-05' },
  { id: 'P4', name: 'حذاء رياضي عصري', description: 'خفيف ومريح', price: 450, cost: 200, stock: 30, category: 'أحذية', sizes: ['40','41','42','43','44'], colors: ['أبيض','أسود','رمادي'], status: 'published', emoji: '👟', imageUrl: '', images: [], isForChildren: false, views: 456, sales: 28, createdAt: '2025-01-03' },
  { id: 'P5', name: 'حقيبة يد جلدية', description: 'جلد طبيعي أنيق', price: 350, cost: 160, stock: 3, category: 'إكسسوارات', sizes: [], colors: ['بني','أسود','بيج'], status: 'published', emoji: '👜', imageUrl: '', images: [], isForChildren: false, views: 189, sales: 15, createdAt: '2025-01-01' },
  { id: 'P6', name: 'بنطال جينز سليم', description: 'قصة سليم عصرية', price: 250, cost: 100, stock: 0, category: 'ملابس رجالية', sizes: ['M','L','XL'], colors: ['أزرق','أسود'], status: 'draft', emoji: '👖', imageUrl: '', images: [], isForChildren: false, views: 123, sales: 0, createdAt: '2025-01-15' },
];

export const seedCustomers: Customer[] = [
  { id: 'C1', name: 'محمد العلوي', phone: '+212661111111', city: 'الدار البيضاء', address: 'حي المعاريف، شارع 2', totalOrders: 8, totalSpent: 4784, lastOrderDate: '2025-01-15', source: 'WhatsApp', notes: 'زبون منتظم', vip: true, trustScore: 95, buyerScore: 90 },
  { id: 'C2', name: 'سارة الإدريسي', phone: '+212662222222', city: 'الرباط', address: 'أكدال، زنقة 5', totalOrders: 5, totalSpent: 2995, lastOrderDate: '2025-01-15', source: 'Instagram', notes: 'تفضل الفساتين', vip: false, trustScore: 88, buyerScore: 75 },
  { id: 'C3', name: 'يوسف بنعلي', phone: '+212663333333', city: 'مراكش', address: 'المدينة القديمة', totalOrders: 3, totalSpent: 3747, lastOrderDate: '2025-01-15', source: 'Messenger', notes: '', vip: false, trustScore: 70, buyerScore: 60 },
  { id: 'C4', name: 'نادية الحسني', phone: '+212664444444', city: 'طنجة', address: 'مرشان، حي النصر', totalOrders: 12, totalSpent: 10800, lastOrderDate: '2025-01-14', source: 'WhatsApp', notes: 'VIP كبيرة', vip: true, trustScore: 98, buyerScore: 95 },
  { id: 'C5', name: 'فاطمة الزهراء', phone: '+212665555555', city: 'فاس', address: 'Ville Nouvelle', totalOrders: 2, totalSpent: 1497, lastOrderDate: '2025-01-13', source: 'Instagram', notes: '', vip: false, trustScore: 85, buyerScore: 80 },
];

export const seedOrders: Order[] = [
  { id: 'ORD-001', customerId: 'C1', customerName: 'محمد العلوي', customerPhone: '+212661111111', city: 'الدار البيضاء', address: 'حي المعاريف', items: [{ productId: 'P1', productName: 'قميص كتان كلاسيك', price: 299, quantity: 2, size: 'L', color: 'أبيض' }], total: 598, status: 'approved', source: 'WhatsApp', deliveryProvider: '', trackingNumber: '', notes: '', needsReview: false, createdAt: '2025-01-15T10:30:00' },
  { id: 'ORD-002', customerId: 'C2', customerName: 'سارة الإدريسي', customerPhone: '+212662222222', city: 'الرباط', address: 'أكدال', items: [{ productId: 'P2', productName: 'فستان سهرة أنيق', price: 599, quantity: 1, size: 'M', color: 'أسود' }], total: 599, status: 'shipped', source: 'Instagram', deliveryProvider: 'Amana', trackingNumber: 'TRK-112233', notes: '', needsReview: false, createdAt: '2025-01-15T11:00:00' },
  { id: 'ORD-003', customerId: 'C3', customerName: 'يوسف بنعلي', customerPhone: '+212663333333', city: 'مراكش', address: 'المدينة القديمة', items: [{ productId: 'P3', productName: 'جاكيت جلد فاخر', price: 899, quantity: 1, size: 'L', color: 'أسود' }], total: 899, status: 'pending', source: 'Messenger', deliveryProvider: '', trackingNumber: '', notes: '', needsReview: true, reviewReason: 'أول طلب من هذا الزبون', createdAt: '2025-01-15T12:15:00' },
  { id: 'ORD-004', customerId: 'C4', customerName: 'نادية الحسني', customerPhone: '+212664444444', city: 'طنجة', address: 'مرشان', items: [{ productId: 'P4', productName: 'حذاء رياضي', price: 450, quantity: 2, size: '41', color: 'أبيض' }], total: 900, status: 'processing', source: 'WhatsApp', deliveryProvider: 'Amana', trackingNumber: 'TRK-887766', notes: '', needsReview: false, createdAt: '2025-01-14T09:00:00' },
  { id: 'ORD-005', customerId: 'C1', customerName: 'محمد العلوي', customerPhone: '+212661111111', city: 'الدار البيضاء', address: 'حي المعاريف', items: [{ productId: 'P1', productName: 'قميص كتان كلاسيك', price: 299, quantity: 3, size: 'XL', color: 'أزرق' }], total: 897, status: 'delivered', source: 'Instagram', deliveryProvider: 'Amana', trackingNumber: 'TRK-554433', notes: '', needsReview: false, createdAt: '2025-01-13T14:30:00' },
];

export const seedConversations: Conversation[] = [
  { id: 'conv-1', customerId: 'C1', customerName: 'محمد العلوي', customerPhone: '+212661111111', source: 'WhatsApp', status: 'active', lastMessage: 'واش عندكم مقاس L؟', unread: 2, priority: 'high', mood: 'interested', pinned: false, label: null, createdAt: '2025-01-15T10:00:00',
    messages: [
      { id: 'm1', content: 'مرحباً! 👋 كيف يمكنني مساعدتك؟', role: 'ai', timestamp: '10:30', templateUsed: 'ترحيب' },
      { id: 'm2', content: 'سلام، بغيت نشوف القميص الكتان', role: 'customer', timestamp: '10:31' },
      { id: 'm3', content: '👔 قميص كتان كلاسيك — 299 MAD\nجودة ممتازة وكيوصل في 48 ساعة 🚚\nبغيتي نشوف الألوان؟', role: 'ai', timestamp: '10:32' },
      { id: 'm4', content: 'واش عندكم مقاس L؟', role: 'customer', timestamp: '10:33' },
    ]
  },
  { id: 'conv-2', customerId: 'C2', customerName: 'سارة الإدريسي', customerPhone: '+212662222222', source: 'Instagram', status: 'active', lastMessage: 'عجبني الفستان!', unread: 1, priority: 'medium', mood: 'urgent', pinned: true, label: 'urgent', createdAt: '2025-01-15T11:00:00',
    messages: [
      { id: 'm1', content: 'مرحباً سارة! ✨ كيف يمكنني مساعدتك؟', role: 'ai', timestamp: '11:00' },
      { id: 'm2', content: 'عجبني الفستان!', role: 'customer', timestamp: '11:01' },
    ]
  },
];

export const seedAuditLogs: AuditLog[] = [
  { id: 1, timestamp: '2025-01-15 14:32', user: 'المدير', action: 'وافق على ORD-001', details: 'محمد العلوي — 598 MAD', type: 'order', severity: 'success' },
  { id: 2, timestamp: '2025-01-15 12:00', user: 'AI', action: 'رد تلقائي', details: 'محمد العلوي — WhatsApp', type: 'ai', severity: 'info' },
  { id: 3, timestamp: '2025-01-15 10:00', user: 'المدير', action: 'أضاف منتج', details: 'قميص كتان — 299 MAD', type: 'product', severity: 'success' },
  { id: 4, timestamp: '2025-01-15 09:00', user: 'النظام', action: 'بدء التشغيل', details: 'AI Commerce OS v8', type: 'settings', severity: 'info' },
];

// ── Role Permissions ──────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['*'],
  seller: ['view_dashboard', 'manage_products', 'view_orders', 'update_order_status', 'view_customers', 'view_conversations', 'view_analytics'],
  support: ['view_dashboard', 'view_orders', 'update_order_status', 'view_customers', 'manage_conversations'],
  delivery: ['view_dashboard', 'view_orders', 'update_order_status'],
};

export function hasPermission(role: UserRole, perm: string): boolean {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(perm);
}
