# 🛍️ AI Commerce OS — v3.1 Final

> نظام إدارة بيع ذكي متكامل — مصنوع بعقلية مغربية

---

## 🚀 تشغيل سريع

### Mac / Linux
```bash
chmod +x start.sh && ./start.sh
```

### Windows
```batch
انقر مرتين على start.bat
```

### يدوياً
```bash
# 1. تثبيت المكتبات
npm install
cd server && npm install && cd ..

# 2. إعداد البيئة
cp server/.env.example server/.env
# عدّل server/.env وأضف JWT_SECRET

# 3. بناء وتشغيل
npm run build
cd server && node index.js
```

افتح: **http://localhost:3001**

---

## ⚙️ server/.env — الإعداد الأساسي

```env
# ضروري لتشغيل التطبيق
JWT_SECRET=YOUR-RANDOM-32-CHAR-STRING

# AI — يشتغل بدونه (local AI)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIzaSy...

# WhatsApp API (للإرسال التلقائي)
# من developers.facebook.com
META_VERIFY_TOKEN=my-token
META_APP_SECRET=...

# admin تلقائي
ADMIN_EMAIL=admin@mystore.ma
ADMIN_PASSWORD=Admin1234!
```

---

## 📱 صفحة الزبون (Storefront)

شارك هذا الرابط مع زبائنك:
```
http://localhost:3001/store/YOUR_USER_ID
```
أو:
```
http://localhost:3001/?userId=YOUR_USER_ID
```

**ما يقدر يعمله الزبون:**
- تصفح المنتجات مع فلترة متقدمة
- إضافة عدة منتجات للسلة 🛒
- Checkout مع مدن المغرب وحساب التوصيل تلقائياً
- Chat مع AI يرد بالدارجة (يبحث في المنتجات)
- تتبع الطلبات برقم الهاتف
- طلب عبر واتساب مباشرة

---

## ✅ الميزات الكاملة

### للتاجر
| الميزة | الحالة |
|--------|--------|
| Dashboard + تقرير الصباح | ✅ |
| إدارة المنتجات (CRUD + صور + SKU) | ✅ |
| Kanban الطلبات (5 مراحل) | ✅ |
| إدارة الزبائن + نظام الولاء | ✅ |
| محادثات + AI دارجة | ✅ |
| ربط WhatsApp/Facebook/Instagram | ✅ |
| AI Banner Studio (caption + hashtags) | ✅ |
| محرر الصور (لوغو + نص + تصدير) | ✅ |
| تحليلات كاملة | ✅ |
| Broadcast جماعي | ✅ |
| تقرير الصباح التلقائي | ✅ |
| تنبيه السلة المهجورة | ✅ |
| الثيمات الموسمية (رمضان/عيد/صيف) | ✅ |
| Export البيانات JSON | ✅ |
| PWA (يعمل offline) | ✅ |
| نشر على Facebook/Instagram | ✅ |
| تأكيد الطلب واتساب تلقائي | ✅ |
| إشعار الشحن واتساب تلقائي | ✅ |

### للزبون (Storefront)
| الميزة | الحالة |
|--------|--------|
| كتالوج مع فلترة وترتيب | ✅ |
| سلة متعددة المنتجات | ✅ |
| Checkout بمدن المغرب | ✅ |
| حساب التوصيل تلقائياً | ✅ |
| Chat AI بالدارجة | ✅ |
| بحث بالاسم/الكود | ✅ |
| تتبع الطلبات | ✅ |
| تأكيد واتساب | ✅ |

---

## 🔗 API موجز

```
# Auth
POST /api/auth/register
POST /api/auth/login

# Products
GET  /api/products
POST /api/products/public/catalog?userId=X

# Orders
POST /api/orders
POST /api/orders/public         ← من storefront
GET  /api/orders/track/:phone   ← تتبع الزبون
PUT  /api/orders/:id/approve    ← + تأكيد واتساب تلقائي
PUT  /api/orders/:id/ship       ← + إشعار واتساب تلقائي

# AI
POST /api/ai/reply              ← مع auth
POST /api/ai/public-reply       ← للـ storefront
POST /api/ai/product-search     ← بحث في المنتجات
POST /api/ai/whatsapp-confirm   ← إرسال تأكيد
POST /api/ai/publish            ← نشر على منصة
GET  /api/ai/comments/:platform ← جمع التعليقات

# Loyalty
GET  /api/loyalty
POST /api/loyalty/add

# Settings
GET  /api/settings/qr           ← QR الكتالوج
GET  /api/settings/export       ← export JSON
```

---

## 📂 هيكل المشروع

```
src/pages/
├── DashboardPage.tsx    ← لوحة القيادة + تقرير الصباح
├── ProductsPage.tsx     ← إدارة المنتجات
├── OrdersPage.tsx       ← Kanban الطلبات
├── MessagesPage.tsx     ← الصندوق الذكي
├── CustomersPage.tsx    ← الزبائن + الولاء
├── AnalyticsPage.tsx    ← التحليلات
├── BannerStudioPage.tsx ← AI Banner Studio (جديد)
├── ImageEditorPage.tsx  ← محرر الصور (جديد)
├── Storefront.tsx       ← صفحة الزبون الكاملة (جديد)
├── SettingsPage.tsx     ← الإعدادات (12 تبويب)
└── ConnectionsPage.tsx  ← ربط المنصات

server/routes/
├── ai.js            ← AI + نشر + بحث منتجات
├── orders.js        ← + WhatsApp تلقائي
├── loyalty.js       ← نقاط الولاء (جديد)
└── ...
```
