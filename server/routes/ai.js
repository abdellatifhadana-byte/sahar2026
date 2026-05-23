'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const https  = require('https');
const { db } = require('../database');

/* ══════════════════════════════════════════════
   PRODUCT SEARCH — by name, SKU, or description
   ══════════════════════════════════════════════ */
function searchProducts(query, products) {
  if (!query || !products?.length) return [];
  const q = query.toLowerCase().trim();
  const scored = products
    .filter(p => p.status === 'published' && p.stock > 0)
    .map(p => {
      let score = 0;
      const name = (p.name || '').toLowerCase();
      const sku  = (p.sku || p.id || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const cat  = (p.category || '').toLowerCase();
      if (sku === q || sku.includes(q)) score += 100;
      if (name === q) score += 90;
      if (name.startsWith(q)) score += 70;
      if (name.includes(q)) score += 50;
      if (desc.includes(q)) score += 20;
      if (cat.includes(q)) score += 15;
      return { ...p, _score: score };
    })
    .filter(p => p._score > 0)
    .sort((a, b) => b._score - a._score);
  return scored.slice(0, 3);
}

/* ══════════════════════════════════════════════
   ORDER DATA EXTRACTION from conversation
   ══════════════════════════════════════════════ */
function extractOrderData(history) {
  const text = (history || []).map(m => m.content).join('\n');
  const extracted = {};

  // Phone
  const phoneMatch = text.match(/(?:^|\s)(\+?212\d{9}|0[5-7]\d{8}|\+?[\d\s\-]{10,13})(?:\s|$)/m);
  if (phoneMatch) extracted.phone = phoneMatch[1].replace(/\s/g, '');

  // Moroccan cities
  const cities = ['الدار البيضاء','كازابلانكا','casablanca','الرباط','rabat','فاس','fes','مراكش','marrakech','طنجة','tanger','أكادير','agadir','مكناس','meknès','وجدة','oujda','تطوان','tetouan','القنيطرة','kenitra','سلا','sale','الجديدة','el jadida','بني ملال','beni mellal','خريبكة','khouribga','تازة','taza','الحسيمة','al hoceima','نادور','nador','برشيد','berrechid','سطات','settat'];
  for (const city of cities) {
    if (text.toLowerCase().includes(city.toLowerCase())) {
      extracted.city = city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // Name (simple heuristic: line after asking for name, or "اسمي X")
  const nameMatch = text.match(/(?:اسمي|اسم|my name is|je m'appelle)\s+([^\n،,.؟?]{3,30})/i);
  if (nameMatch) extracted.name = nameMatch[1].trim();

  // Size
  const sizeMatch = text.match(/(?:مقاس|taille|size)\s*:?\s*(XS|S|M|L|XL|XXL|XXXL|\d{2,3})/i);
  if (sizeMatch) extracted.size = sizeMatch[1].toUpperCase();

  // Color
  const colorMatch = text.match(/(?:لون|couleur|color)\s*:?\s*(أسود|أبيض|أحمر|أزرق|أخضر|رمادي|بيج|وردي|بني|كحلي|noir|blanc|rouge|bleu|black|white|red|blue)/i);
  if (colorMatch) extracted.color = colorMatch[1];

  return extracted;
}

/* ══════════════════════════════════════════════
   SMART LOCAL AI
   ══════════════════════════════════════════════ */
function smartReply(msg, history, products, settings) {
  const lo  = (msg || '').toLowerCase();
  const D   = settings?.ai?.language !== 'Arabic';
  const cur = settings?.brand?.currency || 'MAD';
  const pub = (products || []).filter(p => p.status === 'published' && p.stock > 0);
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  // Search by product name/sku in message
  const found = searchProducts(msg, products);
  if (found.length > 0 && /(عندكم|كاين|منتج|بغيت|طلب|سعر|ثمن|بكام|هاد)/i.test(lo)) {
    const p = found[0];
    const sizes = p.sizes?.join(' · ') || 'S M L XL';
    const colors = p.colors?.join(' · ') || '—';
    return D
      ? `وجدت المنتج! 🎉\n\n${p.emoji || '📦'} **${p.name}**\n💰 السعر: ${p.price} ${cur}\n📏 المقاسات: ${sizes}\n🎨 الألوان: ${colors}\n📦 المخزون: ${p.stock} قطعة\n\nواش بغيت هاد المنتج؟`
      : `وجدت المنتج:\n\n${p.emoji || '📦'} ${p.name}\n💰 ${p.price} ${cur}\n📏 ${sizes}\n🎨 ${colors}\n\nهل تريد الطلب؟`;
  }

  // Greetings
  if (/(سلام|مرحبا|hello|salut|bonjour|هاي|hi\b|صباح|مساء)/i.test(lo))
    return D ? `مرحباً! 👋 كيداير؟ ${pub.length ? `عندنا ${pub.length} منتج متوفر دابا!` : 'مرحباً بك!'}\nواش بغيتي تشوف المنتجات أو تطلب شي محدد؟` : `مرحباً! 👋 يسعدني مساعدتك. ${pub.length ? `لدينا ${pub.length} منتج متوفر.` : ''}`;

  // Price
  if (/(ثمن|سعر|بكام|prix|price|كم|combien|شحال)/i.test(lo)) {
    if (pub.length === 0) return D ? 'ما كاين منتجات منشورة دابا.' : 'لا منتجات متوفرة حالياً.';
    const p = rand(pub);
    return D
      ? `${p.emoji || '📦'} **${p.name}**\nالثمن: ${p.price} ${cur} 💎\nالتوصيل: 25-40 MAD\nواش بغيتيه؟ عطيني الاسم والمدينة 😊`
      : `${p.emoji || '📦'} ${p.name} — ${p.price} ${cur}`;
  }

  // Order flow
  if (/(طلب|نطلب|bghit|commander|أبغى|شري|أطلب|اطلب)/i.test(lo))
    return D
      ? `ممتاز! 🎉 باش نكملو الطلب محتاجين:\n1️⃣ الاسم الكامل\n2️⃣ رقم الهاتف 📱\n3️⃣ المدينة والعنوان 🏠\n4️⃣ المقاس واللون\n\nأبدأ بالاسم الكامل 😊`
      : `رائع! 🎉 للطلب أحتاج: الاسم الكامل، رقم الهاتف، المدينة والعنوان، المقاس واللون.`;

  // Delivery
  if (/(توصيل|livraison|delivery|يوصل|فين|wين)/i.test(lo))
    return D
      ? `التوصيل لجميع مدن المغرب 🇲🇦\n⏱️ 24-48 ساعة\n💰 20-40 MAD حسب المدينة:\n• كازا/الرباط: 20 MAD\n• فاس/مراكش/طنجة: 30 MAD\n• باقي المدن: 35-40 MAD\nواش بغيتي تطلب؟`
      : `نوصل لجميع المدن 🇲🇦 في 24-48 ساعة. السعر 20-40 MAD.`;

  // Negotiation
  if (/(غالي|cher|expensive|خصم|discount|نقص|تخفيض|رخص)/i.test(lo)) {
    const max = settings?.ai?.maxDiscount || 15;
    const d   = Math.round(max * 0.7);
    if (settings?.ai?.autoDiscount)
      return D ? `فاهمك! 😊 نقدر نعطيك خصم **${d}%** إذا طلبت أكثر من قطعة 🎁\nواش هاد العرض مناسب؟` : `يمكنني تقديم خصم ${d}% على الطلبات المتعددة.`;
    return D ? `الثمن مناسب جداً للجودة العالية 💎\nوعندنا ضمان كامل + توصيل سريع 🚚` : `السعر مناسب مع ضمان الجودة.`;
  }

  // Sizes
  if (/(مقاس|تاي|taille|size|قياس)/i.test(lo)) {
    const sizes = settings?.products?.defaultSizes?.join(' · ') || 'S · M · L · XL · XXL';
    return D ? `المقاسات المتوفرة: **${sizes}** 📏\nأي مقاس مناسب ليك؟` : `المقاسات: ${sizes}`;
  }

  // Colors
  if (/(لون|ألوان|couleur|color|لونات)/i.test(lo)) {
    const colors = settings?.products?.defaultColors?.join(' · ') || 'أسود · أبيض · أحمر';
    return D ? `الألوان المتوفرة: **${colors}** 🎨\nأي لون تبغي؟` : `الألوان: ${colors}`;
  }

  // Tracking
  if (/(تتبع|tracking|طلبي|وين طلبي|وصل|status)/i.test(lo))
    return D ? `باش تتبع طلبك:\n1️⃣ ابعث رقم هاتفك\n2️⃣ أو رقم الطلب\nنشوف ليك الحالة مباشرة 📦` : `لمتابعة طلبك أرسل رقم هاتفك.`;

  // Phone detected → extract and continue order
  if (/^[\+\d\s\-]{8,15}$/.test(msg.replace(/\s/g, ''))) {
    const extracted = extractOrderData([...( history || []), { content: msg, role: 'customer' }]);
    if (extracted.city)
      return D ? `شكراً! 📱 لاحظت أنك من **${extracted.city}**.\nدابا عطيني العنوان بالتفصيل 🏠` : `شكراً! أعطني العنوان الكامل.`;
    return D ? `شكراً! 📱 دابا عطيني المدينة والعنوان 🏠` : `شكراً! أعطني المدينة والعنوان.`;
  }

  // Thanks
  if (/(شكرا|merci|thanks|بارك الله|يسلمو)/i.test(lo))
    return D ? `العفو! 😊 واش كاين شي آخر نقدر نساعدك فيه؟` : `العفو! هل تحتاج شيئاً آخر؟`;

  // After name in history
  const lastAI = [...(history || [])].reverse().find(m => m.role === 'ai');
  if (lastAI?.content?.includes('الاسم'))
    return D ? `مزيان ${msg}! 😊 دابا عطيني رقم الهاتف 📱` : `شكراً ${msg}! أعطني رقم هاتفك.`;

  const generics = D
    ? [`فاهمت! 😊 واش عندك سؤال آخر؟`, `أكيد! عندنا أحسن المنتجات 🔥 واش تبغي تشوف؟`, `دابا نشوف ليك! 😊 وصف أكثر باش نساعدك`]
    : [`بالتأكيد! 😊 كيف أساعدك؟`, `شكراً لتواصلك!`, `أنا هنا للمساعدة 😊`];
  return rand(generics);
}

/* ══════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════ */

// POST /api/ai/reply — main AI endpoint
router.post('/reply', auth, async (req, res) => {
  const { message, history, products, settings, systemPrompt } = req.body;
  const openaiKey = settings?.ai?.apiKey || process.env.OPENAI_API_KEY;
  const geminiKey = settings?.ai?.geminiKey || process.env.GEMINI_API_KEY;
  const sysPrompt = systemPrompt || settings?.ai?.systemPrompt || 'أنت مساعد بيع ذكي لمتجر مغربي. تتحدث بالدارجة المغربية بأسلوب ودود واحترافي.';

  // Try OpenAI
  if (openaiKey && settings?.ai?.provider !== 'gemini') {
    try {
      const body = JSON.stringify({
        model: settings?.ai?.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sysPrompt },
          ...(history || []).slice(-10).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
          { role: 'user', content: message },
        ],
        max_tokens: 400,
        temperature: settings?.ai?.temperature || 0.7,
      });
      const reply = await _https('api.openai.com', '/v1/chat/completions',
        { 'Authorization': `Bearer ${openaiKey}` }, body);
      const parsed = JSON.parse(reply).choices?.[0]?.message?.content;
      if (parsed) return res.json({ reply: parsed, model: 'openai' });
    } catch (e) { console.warn('[AI] OpenAI:', e.message); }
  }

  // Try Gemini
  if (geminiKey) {
    try {
      const body = JSON.stringify({
        contents: [
          ...(history || []).slice(-8).map(m => ({
            role: m.role === 'ai' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          { role: 'user', parts: [{ text: message }] },
        ],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
        systemInstruction: { parts: [{ text: sysPrompt }] },
      });
      const reply = await _https('generativelanguage.googleapis.com',
        `/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {}, body);
      const parsed = JSON.parse(reply).candidates?.[0]?.content?.parts?.[0]?.text;
      if (parsed) return res.json({ reply: parsed, model: 'gemini' });
    } catch (e) { console.warn('[AI] Gemini:', e.message); }
  }

  // Local fallback
  const allProducts = products || (req.user?.id ? db.getProducts(req.user.id) : []);
  const allSettings = settings || (req.user?.id ? db.getSettings(req.user.id) : {});
  res.json({ reply: smartReply(message, history, allProducts, allSettings), model: 'local' });
});

// POST /api/ai/product-search — search product by name/sku/description
router.post('/product-search', async (req, res) => {
  const { query, userId } = req.body;
  if (!query || !userId) return res.status(400).json({ error: 'query and userId required' });
  const products = db.getProducts(userId);
  const results  = searchProducts(query, products);
  res.json({ results, found: results.length > 0 });
});

// POST /api/ai/extract-order — extract order data from conversation
router.post('/extract-order', async (req, res) => {
  const { history } = req.body;
  res.json(extractOrderData(history));
});

// POST /api/ai/public-reply — for storefront (no auth)
router.post('/public-reply', async (req, res) => {
  const { message, history, userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const products = db.getProducts(userId);
  const settings = db.getSettings(userId) || {};
  const openaiKey = settings?.ai?.apiKey || process.env.OPENAI_API_KEY;
  const geminiKey = settings?.ai?.geminiKey || process.env.GEMINI_API_KEY;

  // Product search first
  const found = searchProducts(message, products);
  if (found.length > 0 && /(عندكم|كاين|منتج|بغيت|سعر|ثمن|بكام|هاد)/i.test(message)) {
    const p = found[0];
    const reply = `وجدت المنتج! 🎉\n\n${p.emoji||'📦'} **${p.name}**\n💰 السعر: ${p.price} ${settings?.brand?.currency||'MAD'}\n📏 المقاسات: ${(p.sizes||[]).join(' · ')||'S M L XL'}\n🎨 الألوان: ${(p.colors||[]).join(' · ')||'—'}\n📦 المخزون: ${p.stock} قطعة\n\nواش بغيت هاد المنتج؟`;
    return res.json({ reply, model: 'product-search', product: p });
  }

  // Try remote AI
  if (openaiKey || geminiKey) {
    const sysPrompt = settings?.ai?.systemPrompt || `أنت مساعد بيع ذكي لمتجر "${settings?.brand?.name||'متجر'}". تتحدث بالدارجة المغربية بأسلوب ودود. لديك هذه المنتجات: ${products.slice(0,10).map(p=>`${p.name} (${p.price} MAD)`).join(', ')}. ساعد الزبون في الطلب.`;
    try {
      if (openaiKey) {
        const body = JSON.stringify({
          model: settings?.ai?.model || 'gpt-4o-mini',
          messages: [{ role:'system', content:sysPrompt }, ...(history||[]).slice(-6).map(m=>({ role:m.role==='ai'?'assistant':'user', content:m.content })), { role:'user', content:message }],
          max_tokens: 300, temperature: 0.8,
        });
        const r = await _https('api.openai.com','/v1/chat/completions',{ 'Authorization':`Bearer ${openaiKey}` },body);
        const reply = JSON.parse(r).choices?.[0]?.message?.content;
        if (reply) return res.json({ reply, model:'openai' });
      }
    } catch {}
    try {
      if (geminiKey) {
        const body = JSON.stringify({ contents:[{ role:'user', parts:[{ text:message }] }], generationConfig:{ maxOutputTokens:300 }, systemInstruction:{ parts:[{ text:sysPrompt }] } });
        const r = await _https('generativelanguage.googleapis.com',`/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,{},body);
        const reply = JSON.parse(r).candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return res.json({ reply, model:'gemini' });
      }
    } catch {}
  }

  res.json({ reply: smartReply(message, history, products, settings), model: 'local' });
});

// POST /api/ai/whatsapp-confirm — send WhatsApp confirmation
router.post('/whatsapp-confirm', auth, async (req, res) => {
  const { orderId, to, type } = req.body; // type: 'customer' | 'merchant'
  const order = db.getOrder(orderId);
  if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  const settings = db.getSettings(req.user.id) || {};
  const waToken  = settings.social?.whatsapp?.accessToken;
  const waPhoneId= settings.social?.whatsapp?.pageId;
  const cur = settings.brand?.currency || 'MAD';

  let msg = '';
  if (type === 'customer') {
    const items = (order.items || []).map(i => `• ${i.productName} x${i.quantity||1} — ${i.price} ${cur}`).join('\n');
    msg = `مرحباً ${order.customerName}! 👋\n\n✅ تم تأكيد طلبك بنجاح!\n\n${items}\n\n💰 الإجمالي: ${order.total} ${cur}\n🚚 التوصيل: 24-48 ساعة\n\nسنبلغك عند الشحن. شكراً لثقتك بنا! 🙏`;
  } else {
    const items = (order.items || []).map(i => `• ${i.productName} (${i.size||''} ${i.color||''}) x${i.quantity||1}`).join('\n');
    msg = `🔔 طلب جديد يحتاج موافقتك!\n\n👤 ${order.customerName}\n📱 ${order.customerPhone}\n📍 ${order.city} — ${order.address||''}\n\n${items}\n\n💰 الإجمالي: ${order.total} ${cur}\n\nرد بـ ✅ للموافقة أو ❌ للرفض`;
  }

  if (waToken && waPhoneId && to) {
    try {
      const body = JSON.stringify({ messaging_product:'whatsapp', to:to.replace(/\s/g,''), type:'text', text:{ body:msg } });
      const https2 = require('https');
      await new Promise((resolve,reject) => {
        const r = https2.request({ hostname:'graph.facebook.com', path:`/v19.0/${waPhoneId}/messages`, method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${waToken}`, 'Content-Length':Buffer.byteLength(body) } }, res => { res.resume(); resolve(res.statusCode < 300); });
        r.on('error', reject); r.write(body); r.end();
      });
      return res.json({ sent: true, via: 'whatsapp_api', message: msg });
    } catch (e) { console.warn('[WhatsApp]', e.message); }
  }

  // Fallback: return wa.me URL
  const phone = (to || settings.brand?.phone || '').replace(/\D/g,'');
  res.json({ sent: false, via: 'wa_me', url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, message: msg });
});

// POST /api/ai/publish — post to social media
router.post('/publish', auth, async (req, res) => {
  const { platform, message, imageUrl, productId } = req.body;
  const settings = db.getSettings(req.user.id) || {};
  const social   = settings.social || {};

  if (platform === 'facebook') {
    const token  = social.facebook?.accessToken;
    const pageId = social.facebook?.pageId;
    if (!token || !pageId) return res.status(400).json({ error: 'Facebook غير مربوط. اذهب لصفحة الربط أولاً.' });
    try {
      const body = imageUrl
        ? JSON.stringify({ message, url: imageUrl, access_token: token })
        : JSON.stringify({ message, access_token: token });
      const endpoint = imageUrl ? `/v19.0/${pageId}/photos` : `/v19.0/${pageId}/feed`;
      const resp = await _https('graph.facebook.com', endpoint, {}, body);
      const data = JSON.parse(resp);
      if (data.error) return res.status(400).json({ error: data.error.message });
      db.addLog({ userId: req.user.id, user: 'System', action: `Published to Facebook`, details: message.slice(0,50), type: 'notification', severity: 'success' });
      return res.json({ success: true, postId: data.id });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (platform === 'instagram') {
    const token  = social.instagram?.accessToken;
    const accId  = social.instagram?.pageId;
    if (!token || !accId) return res.status(400).json({ error: 'Instagram غير مربوط.' });
    if (!imageUrl) return res.status(400).json({ error: 'Instagram يتطلب صورة للنشر.' });
    try {
      // Step 1: create container
      const container = await _https('graph.facebook.com', `/v19.0/${accId}/media`,
        {}, JSON.stringify({ image_url: imageUrl, caption: message, access_token: token }));
      const { id: containerId } = JSON.parse(container);
      if (!containerId) return res.status(500).json({ error: 'فشل إنشاء المحتوى.' });
      // Step 2: publish
      const publish = await _https('graph.facebook.com', `/v19.0/${accId}/media_publish`,
        {}, JSON.stringify({ creation_id: containerId, access_token: token }));
      const { id: mediaId } = JSON.parse(publish);
      db.addLog({ userId: req.user.id, user: 'System', action: `Published to Instagram`, details: message.slice(0,50), type: 'notification', severity: 'success' });
      return res.json({ success: true, mediaId });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  res.status(400).json({ error: `Platform "${platform}" غير مدعوم بعد.` });
});

// GET /api/ai/comments/:platform — get comments from posts
router.get('/comments/:platform', auth, async (req, res) => {
  const settings = db.getSettings(req.user.id) || {};
  const { platform } = req.params;

  if (platform === 'facebook') {
    const token  = settings.social?.facebook?.accessToken;
    const pageId = settings.social?.facebook?.pageId;
    if (!token || !pageId) return res.json({ comments: [] });
    try {
      const data = await _https('graph.facebook.com', `/v19.0/${pageId}/feed?fields=id,message,comments{message,from,created_time}&access_token=${token}&limit=10`, {}, null, 'GET');
      const posts = JSON.parse(data).data || [];
      const comments = [];
      posts.forEach(post => {
        (post.comments?.data || []).forEach(c => {
          comments.push({ id: c.id, text: c.message, from: c.from?.name, time: c.created_time, postId: post.id, platform: 'facebook' });
        });
      });
      return res.json({ comments });
    } catch (e) { return res.json({ comments: [], error: e.message }); }
  }
  res.json({ comments: [] });
});

function _https(hostname, path, extraHeaders, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

module.exports = router;
