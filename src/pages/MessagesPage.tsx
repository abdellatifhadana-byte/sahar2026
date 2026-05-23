import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Send, Bot, Plus, Sparkles, X, Pin, ShoppingCart } from 'lucide-react';
import * as api from '../services/api';

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ember)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Bot size={14} color="#fff" /></div>
      <div className="bubble-ai" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 16px' }}>
        {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink3)', display: 'inline-block', animation: `blink 1.4s ${i*0.2}s infinite` }} />)}
      </div>
    </div>
  );
}

const SRC_CLR: Record<string,string> = { WhatsApp:'#25d366', Instagram:'#e1306c', Messenger:'#0084ff', TikTok:'#fff' };
const SRC_ICN: Record<string,string> = { WhatsApp:'💬', Instagram:'📸', Messenger:'💙', TikTok:'🎵' };
const LBL_CLR: Record<string,string> = { urgent:'#f87171', followup:'#fbbf24', done:'#34d399' };
const LABEL_LABEL: Record<string,string> = { urgent:'مهم', followup:'متابعة', done:'مكتمل' };
const MOOD_EMOJI: Record<string,string> = { neutral:'😐', interested:'🔥', hesitant:'🤔', angry:'😠', urgent:'⚡' };

export default function MessagesPage() {
  const { conversations, sendMessage, addConversation, updateConversation, settings, products, isOnline, notify } = useStore();
  const [active,    setActive]    = useState<string|null>(conversations[0]?.id ?? null);
  const [input,     setInput]     = useState('');
  const [typing,    setTyping]    = useState(false);
  const [showTpl,   setShowTpl]   = useState(false);
  const [srcFilter, setSrcFilter] = useState('all');
  const [aiThinking,setAiThinking]= useState(false);
  const msgEnd = useRef<HTMLDivElement>(null);

  const conv = conversations.find(c => c.id === active);

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [conv?.messages?.length, typing]);

  // Show typing indicator when customer sends
  useEffect(() => {
    if (!conv || !conv.messages?.length) return;
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === 'customer' && settings.ai.humanSimulation) {
      setTyping(true);
      const t = setTimeout(() => setTyping(false), (settings.ai.replyDelay || 2) * 1000 + 800);
      return () => clearTimeout(t);
    }
  }, [conv?.messages?.length]);

  const send = async () => {
    if (!input.trim() || !active) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(active, msg, 'customer');
  };

  // Send AI reply manually (agent triggers AI)
  const triggerAI = async () => {
    if (!conv || !active) return;
    const lastMsg = conv.messages?.filter(m => m.role === 'customer').pop();
    if (!lastMsg) { notify('info', 'لا توجد رسالة من الزبون للرد عليها'); return; }

    setAiThinking(true);
    try {
      if (isOnline && api.getToken()) {
        // Try backend AI
        const data = await api.aiAPI.reply({
          message: lastMsg.content,
          history: (conv.messages || []).slice(-10).map(m => ({ role: m.role, content: m.content })),
          products: products.filter(p => p.status === 'published'),
          settings: settings,
        });
        if (data.reply) {
          await sendMessage(active, data.reply, 'ai');
        }
      } else {
        // Fallback: sendMessage handles local AI
        await sendMessage(active, lastMsg.content, 'customer');
      }
    } catch (e: any) {
      notify('error', `خطأ AI: ${e.message}`);
    }
    setAiThinking(false);
  };

  const newConv = async () => {
    const srcs = ['WhatsApp', 'Instagram', 'Messenger'] as const;
    const names = ['محمد ال.', 'فاطمة ز.', 'يوسف م.', 'أمينة ب.', 'خالد ع.'];
    const src = srcs[Math.floor(Math.random() * srcs.length)];
    const name = names[Math.floor(Math.random() * names.length)];
    const id = await addConversation({ customerId: `C${Date.now()}`, customerName: name, source: src, status: 'active', lastMessage: '' });
    setActive(id);
  };

  const filtered = conversations
    .filter(c => srcFilter === 'all' || c.source === srcFilter)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.unread||0) - (a.unread||0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">الرسائل</h1>
          <p className="page-sub">AI يرد تلقائياً بالدارجة {isOnline ? '· متصل' : '· offline'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, background: settings.ai.humanSimulation ? 'rgba(0,200,150,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${settings.ai.humanSimulation ? 'rgba(0,200,150,0.3)' : 'var(--border)'}`, color: settings.ai.humanSimulation ? 'var(--mint)' : 'var(--ink3)' }}>
            <Sparkles size={13} />
            AI {settings.ai.humanSimulation ? `نشط · ${settings.ai.replyDelay}s` : 'معطّل'}
          </div>
          <button onClick={newConv} className="btn btn-ghost btn-sm"><Plus size={15} /> محادثة</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, height: 'calc(100vh - 220px)', minHeight: 500 }}>
        {/* Sidebar */}
        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="tabs" style={{ gap: 4 }}>
            {['all','WhatsApp','Instagram','Messenger'].map(s => (
              <button key={s} onClick={() => setSrcFilter(s)} className={`tab-btn ${srcFilter === s ? 'active' : ''}`} style={{ padding: '5px 10px', fontSize: 12 }}>
                {s === 'all' ? 'الكل' : SRC_ICN[s]}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink3)' }}>
                <Bot size={36} style={{ marginBottom: 8, opacity: .3 }} />
                <p style={{ fontSize: 13 }}>لا محادثات</p>
                <button onClick={newConv} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>ابدأ محادثة تجريبية</button>
              </div>
            )}
            {filtered.map(c => (
              <button key={c.id} onClick={() => { setActive(c.id); updateConversation(c.id, { unread: 0 }); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '11px 13px', borderRadius: 14, textAlign: 'right', cursor: 'pointer', transition: 'all .18s', background: active === c.id ? 'rgba(255,77,26,0.1)' : 'rgba(255,255,255,0.03)', border: `1.5px solid ${active === c.id ? 'rgba(255,77,26,0.3)' : 'var(--border)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 15 }}>{SRC_ICN[c.source] || '💬'}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: 'var(--ink1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.customerName}</span>
                  {c.pinned && <Pin size={11} color="var(--gold)" />}
                  {(c.unread||0) > 0 && <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: 'var(--ember)', color: '#fff', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{c.unread}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${SRC_CLR[c.source] || '#fff'}22`, color: SRC_CLR[c.source] || 'var(--ink3)' }}>{c.source}</span>
                  {c.label && <span style={{ fontSize: 10, fontWeight: 700, color: LBL_CLR[c.label] || 'var(--ink3)' }}>{LABEL_LABEL[c.label]}</span>}
                  {c.mood && c.mood !== 'neutral' && <span style={{ fontSize: 12 }}>{MOOD_EMOJI[c.mood]}</span>}
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{c.lastMessage || 'ابدأ المحادثة...'}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Chat window */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {!conv ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--ink3)' }}>
              <Bot size={48} style={{ opacity: .2 }} />
              <p style={{ fontSize: 14 }}>اختر محادثة من القائمة</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: `${SRC_CLR[conv.source]||'var(--ember)'}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{SRC_ICN[conv.source]||'💬'}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink1)' }}>{conv.customerName}</p>
                  <p style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{conv.customerPhone || 'غير محدد'} · {conv.source}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => updateConversation(conv.id, { pinned: !conv.pinned })} style={{ width: 30, height: 30, borderRadius: 8, background: conv.pinned ? 'rgba(201,149,76,.15)' : 'rgba(255,255,255,.05)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: conv.pinned ? 'var(--gold)' : 'var(--ink3)' }}>
                    <Pin size={13} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {(!conv.messages || conv.messages.length === 0) && (
                  <div style={{ textAlign: 'center', color: 'var(--ink3)', fontSize: 13, padding: '30px 0' }}>
                    ابدأ بكتابة رسالة كالزبون أو انتظر رسالة حقيقية من WhatsApp
                  </div>
                )}
                {(conv.messages||[]).map((msg: any) => (
                  <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: msg.role === 'customer' ? 'row-reverse' : 'row' }}>
                    {msg.role !== 'customer' && (
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: msg.role === 'ai' ? 'var(--ember)' : 'var(--panel2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {msg.role === 'ai' ? <Bot size={14} color="#fff" /> : <span style={{ fontSize: 11 }}>👤</span>}
                      </div>
                    )}
                    <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 3, alignItems: msg.role === 'customer' ? 'flex-end' : 'flex-start' }}>
                      <div className={msg.role === 'customer' ? 'bubble-out' : msg.role === 'ai' ? 'bubble-ai' : 'bubble-in'} style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>
                        {msg.content}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{msg.timestamp}</span>
                        {msg.role === 'ai' && <span style={{ fontSize: 9, color: 'var(--mint)', background: 'rgba(0,200,150,.1)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>AI</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {typing && <TypingDots />}
                <div ref={msgEnd} />
              </div>

              {/* Templates quick panel */}
              {showTpl && settings.templates?.length > 0 && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', maxHeight: 140, overflowY: 'auto' }}>
                  {settings.templates.map((t: any) => (
                    <button key={t.id} onClick={() => { setInput(t.content); setShowTpl(false); }} style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', color: 'var(--ink2)', fontSize: 12.5, cursor: 'pointer', textAlign: 'right', marginBottom: 5, transition: 'background .15s' }}>
                      <strong style={{ color: 'var(--ember)' }}>{t.name}</strong> — {t.content.slice(0, 60)}...
                    </button>
                  ))}
                </div>
              )}

              {/* Input bar */}
              <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setShowTpl(v => !v)} title="قوالب الردود" style={{ width: 34, height: 34, borderRadius: 9, background: showTpl ? 'var(--ember)' : 'rgba(255,255,255,.05)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: showTpl ? '#fff' : 'var(--ink3)' }}>
                  <Sparkles size={14} />
                </button>
                <input className="glass-input" style={{ flex: 1, padding: '10px 14px', fontSize: 13 }} placeholder="اكتب رسالة كالزبون لاختبار الـ AI..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button onClick={triggerAI} disabled={aiThinking} title="رد AI مباشر" style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(0,200,150,.1)', border: '1px solid rgba(0,200,150,.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--mint)', opacity: aiThinking ? .5 : 1 }}>
                  <Bot size={15} />
                </button>
                <button onClick={send} disabled={!input.trim()} style={{ width: 36, height: 36, borderRadius: 10, background: input.trim() ? 'var(--ember)' : 'var(--panel2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: input.trim() ? 1 : .5, transition: 'all .15s' }}>
                  <Send size={15} color="#fff" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
