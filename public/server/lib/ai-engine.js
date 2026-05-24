'use strict';
const https = require('https');

// ── Moroccan Market Intent Detection ─────────────────────────
const PATTERNS = {
  greeting:   /سلام|مرحبا|hello|salut|bonjour|هاي|صباح|مساء|كيداير|labes/i,
  price:      /ثمن|سعر|بكام|بشحال|prix|price|combien|كم|شحال/i,
  order:      /طلب|نطلب|bghit|commander|شري|acheter|بغيت|كنبغي/i,
  delivery:   /توصيل|livraison|delivery|يوصل|فين وصل|tracking|تتبع/i,
  negotiate:  /غالي|cher|expensive|خصم|discount|تخفيض|نقص|باهي/i,
  size:       /مقاس|تاي|taille|size|مقاسات/i,
  color:      /لون|ألوان|couleur|color|alwan/i,
  thanks:     /شكرا|merci|thanks|بارك الله|يعطيك الصحة/i,
  available:  /واش كاين|موجود|available|عندكم|stock|في الستوك/i,
  images:     /صورة|صور|photo|image|عارض/i,
};

function detectIntent(msg) {
  const lo = (msg||'').toLowerCase();
  for (const [intent, pattern] of Object.entries(PATTERNS)) {
    if (pattern.test(lo)) return intent;
  }
  return 'general';
}

function generateLocalReply(intent, msg, products, settings) {
  const D   = settings?.ai?.language !== 'Arabic'; // Default Darija
  const cur = settings?.brand?.currency || 'MAD';
  const pub = (products || []).filter(p => p.status === 'published' && p.stock > 0);
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  switch (intent) {
    case 'greeting':
      return D
        ? `مرحباً! 👋 كيداير؟ واش بغيتي تشوف المنتجات ديالنا؟ عندنا عروض واعرة اليوم! 🔥`
        : `مرحباً! 👋 كيف يمكنني مساعدتك؟`;

    case 'price':
      if (!pub.length) return D ? 'تواصل معنا للاستفسار عن الأثمان 😊' : 'تواصل معنا للأسعار';
      const p = rand(pub);
      return D
        ? `${p.emoji||'📦'} **${p.name}**\nالثمن: ${p.price} ${cur} 💎\nجودة ممتازة وكيوصل في 24-48 ساعة! واش بغيتيه؟`
        : `${p.emoji||'📦'} ${p.name} — ${p.price} ${cur}`;

    case 'order':
      return D
        ? `ممتاز! 🎉 باش نكملو الطلب محتاجين:\n1️⃣ الاسم الكامل\n2️⃣ رقم الهاتف\n3️⃣ المدينة والعنوان\n4️⃣ المقاس واللون\n\nأبدأ بالاسم الكامل 😊`
        : `رائع! 🎉 للطلب أحتاج: الاسم الكامل، رقم الهاتف، العنوان الكامل، المقاس.`;

    case 'delivery':
      return D
        ? `التوصيل لجميع مدن المغرب 🇲🇦\n⏱️ 24-48 ساعة\n💰 الثمن يتحدد حسب المدينة\nواش بغيتي تطلب؟`
        : `نوصل لجميع المدن 🇲🇦 في 24-48 ساعة`;

    case 'negotiate':
      if (settings?.ai?.autoDiscount) {
        const d = Math.round((settings.ai.maxDiscount || 15) * 0.7);
        return D
          ? `فاهمك! 😊 نقدر نعطيك خصم **${d}%** إذا طلبتي أكثر من قطعة 🎁 واش هاد العرض يعجبك؟`
          : `يمكنني تقديم خصم ${d}% على الطلبات المتعددة 🎁`;
      }
      return D ? `الثمن مناسب جداً للجودة العالية 💎 وعندنا ضمان كامل.` : `السعر مناسب مع ضمان الجودة 💎`;

    case 'size':
      const sizes = settings?.products?.defaultSizes?.join(' · ') || 'S · M · L · XL';
      return D ? `المقاسات المتوفرة: **${sizes}** 📏\nأش المقاس ديالك؟` : `المقاسات: ${sizes}`;

    case 'color':
      const colors = settings?.products?.defaultColors?.join(' · ') || 'أسود، أبيض';
      return D ? `الألوان المتوفرة: **${colors}** 🎨\nأي لون تبغي؟` : `الألوان: ${colors}`;

    case 'thanks':
      return D ? `العفو! 😊 واش كاين شي آخر؟` : `العفو! 😊 هل تحتاج شيئاً آخر؟`;

    case 'available':
      if (!pub.length) return D ? 'الستوك ناقص دابا، سنعلمك عند التوفر 📲' : 'المنتج غير متوفر حالياً';
      return D ? `عندنا ${pub.length} منتج متوفر الآن! واش تبغي تشوف؟ 🛍️` : `لدينا ${pub.length} منتج متاح.`;

    default:
      const generics = D
        ? ['فاهمت! 😊 واش عندك سؤال آخر على المنتجات؟', 'أكيد! عندنا أحسن المنتجات 🔥', 'دابا نشوف ليك! 😊']
        : ['بالتأكيد! 😊 كيف أساعدك؟', 'شكراً لتواصلك!', 'أنا هنا للمساعدة 😊'];
      return rand(generics);
  }
}

// ── Remote AI (OpenAI + Gemini) ───────────────────────────────
async function getRemoteAI(provider, key, model, systemPrompt, messages, temperature = 0.7) {
  if (!key) return null;
  const system = systemPrompt || 'أنت مساعد بيع ذكي لمتجر مغربي. تحدث بالدارجة المغربية بأسلوب ودي واحترافي.';

  if (provider === 'gemini') {
    const body = JSON.stringify({
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 400, temperature },
      systemInstruction: { parts: [{ text: system }] },
    });
    const data = await _post('generativelanguage.googleapis.com', `/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {}, body);
    return JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  // Default: OpenAI
  const body = JSON.stringify({
    model: model || 'gpt-4o-mini',
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: 400,
    temperature,
  });
  const data = await _post('api.openai.com', '/v1/chat/completions', { 'Authorization': `Bearer ${key}` }, body);
  return JSON.parse(data).choices?.[0]?.message?.content || null;
}

function _post(hostname, path, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders, 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('AI timeout')); });
    req.write(body); req.end();
  });
}

module.exports = { detectIntent, generateLocalReply, getRemoteAI };
