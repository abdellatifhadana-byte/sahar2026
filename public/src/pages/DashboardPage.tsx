import { useStore } from '../store';
import Sparkline from '../components/Sparkline';
import {
  TrendingUp, ShoppingBag, MessageCircle, Users,
  ChevronRight, AlertTriangle, Package, CheckCircle,
  Zap, Sun, Bell, BarChart3
} from 'lucide-react';

const STATUS_AR: Record<string,string> = {
  pending:'بانتظار',approved:'موافقة',processing:'جارٍ',
  shipped:'شُحن',delivered:'وُصّل',cancelled:'ملغي',
};

function last7(orders:any[],field:'total'|'count'='count') {
  return Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(6-i));
    const ds=d.toISOString().split('T')[0];
    const f=orders.filter(o=>o.status!=='cancelled'&&o.createdAt?.startsWith(ds));
    return field==='total'?f.reduce((s:number,o:any)=>s+o.total,0):f.length;
  });
}

function MorningReport() {
  const { orders, conversations, products, settings } = useStore();
  const cur = settings.brand.currency;
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  const ydOrders = orders.filter(o=>o.status!=='cancelled'&&o.createdAt?.startsWith(yesterday));
  const ydRev = ydOrders.reduce((s,o)=>s+o.total,0);
  const newOrders = orders.filter(o=>o.createdAt?.startsWith(today)).length;
  const pendingMsg = conversations.filter(c=>c.unread>0).length;
  const lowStock = products.filter(p=>p.stock>0&&p.stock<=settings.products.lowStockAlert).length;
  const bestProd = [...products].sort((a,b)=>b.sales-a.sales)[0];

  const rows = [
    { k:'إيراد الأمس', v:`${ydRev.toLocaleString()} ${cur}`, up: ydRev > 0 },
    { k:'طلبات اليوم', v:`${newOrders} طلب`, up: newOrders > 0 },
    { k:'رسائل معلقة', v:`${pendingMsg} رسائل`, warn: pendingMsg > 0 },
    { k:'مخزون منخفض', v:`${lowStock} منتج`, warn: lowStock > 0 },
    bestProd ? { k:'أفضل منتج', v:`${bestProd.emoji||'📦'} ${bestProd.name}`, up:true } : null,
  ].filter(Boolean) as {k:string,v:string,up?:boolean,warn?:boolean}[];

  return (
    <div className="card" style={{padding:'16px 18px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
        <div style={{width:34,height:34,borderRadius:10,background:'rgba(201,149,76,.1)',
          border:'1px solid rgba(201,149,76,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>
          🌅
        </div>
        <div>
          <div className="section-title" style={{fontSize:13}}>ملخص الصباح</div>
          <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>
            {new Date().toLocaleDateString('ar-MA',{weekday:'long',day:'numeric',month:'long'})}
          </div>
        </div>
        <div style={{marginRight:'auto'}}>
          <span className="badge badge-gold" style={{fontSize:10}}>
            <Bell size={9} /> تلقائي
          </span>
        </div>
      </div>
      {rows.map((row,i)=>(
        <div key={i} className="report-row">
          <span className="report-key">{row.k}</span>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <span className="report-val">{row.v}</span>
            {row.up && <span style={{fontSize:10,fontWeight:700,color:'var(--mint)',background:'rgba(0,200,150,.1)',borderRadius:99,padding:'1px 7px'}}>✓</span>}
            {row.warn && <span style={{fontSize:10,fontWeight:700,color:'var(--ember)',background:'rgba(255,77,26,.1)',borderRadius:99,padding:'1px 7px'}}>تنبيه</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AIGreeting() {
  const { settings, orders, conversations } = useStore();
  const pending = orders.filter(o=>o.status==='pending').length;
  const unread = conversations.reduce((s,c)=>s+c.unread,0);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح النور' : hour < 18 ? 'مرحباً' : 'مساء الخير';

  let msg = `${greet}! `;
  if (pending > 0 && unread > 0) msg += `عندك ${pending} طلب جديد و${unread} رسالة تنتظر ردك`;
  else if (pending > 0) msg += `عندك ${pending} طلب جديد يحتاج موافقتك`;
  else if (unread > 0) msg += `عندك ${unread} رسالة غير مقروءة`;
  else msg += 'كل شيء على ما يرام اليوم 👌';

  return (
    <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--r)',
      padding:'11px 14px',display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <div className="dot-live" />
      <span style={{fontSize:13,color:'var(--ink2)',flex:1,lineHeight:1.4}}>
        <strong style={{color:'var(--ink1)'}}>{msg.split('!')[0]}!</strong>
        {msg.split('!').slice(1).join('!')}
      </span>
      {settings.ai.humanSimulation && (
        <span style={{fontSize:10,background:'rgba(0,200,150,.1)',color:'var(--mint)',
          border:'1px solid rgba(0,200,150,.2)',borderRadius:6,padding:'3px 8px',fontWeight:700,whiteSpace:'nowrap'}}>
          AI نشط
        </span>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { settings, products, orders, customers, conversations, setPage, user } = useStore();
  const userId = user?.id || (() => {
    try { const u = localStorage.getItem('ai_commerce_user'); return u ? JSON.parse(u)?.id : null; } catch { return null; }
  })();
  const storeLink    = userId ? `/store/${userId}` : null;
  const fullStoreUrl = userId ? `${window.location.origin}/store/${userId}` : null;
  const { currency } = settings.brand;
  const { goals } = settings;

  const active   = orders.filter(o=>o.status!=='cancelled');
  const revenue  = active.reduce((s,o)=>s+o.total,0);
  const today    = new Date().toISOString().split('T')[0];
  const todayRev = active.filter(o=>o.createdAt?.startsWith(today)).reduce((s,o)=>s+o.total,0);
  const pending  = orders.filter(o=>o.status==='pending').length;
  const unread   = conversations.reduce((s,c)=>s+c.unread,0);
  const low      = products.filter(p=>p.stock>0&&p.stock<=settings.products.lowStockAlert).length;
  const published= products.filter(p=>p.status==='published').length;
  const goalPct  = goals.daily>0 ? Math.min(100,Math.round((todayRev/goals.daily)*100)) : 0;

  const stats = [
    {
      label:'الإيرادات الكلية', value:revenue.toLocaleString(), unit:currency,
      sub:`${todayRev.toLocaleString()} ${currency} اليوم`,
      spark:last7(orders,'total'), color:'var(--mint)',
      icon:TrendingUp, page:'analytics' as const, featured:true,
    },
    {
      label:'الطلبات', value:String(active.length), unit:'طلب',
      sub:pending>0?`${pending} بانتظار موافقتك ⚠`:'لا طلبات معلقة ✅',
      spark:last7(orders,'count'), color:'var(--ember)',
      icon:ShoppingBag, page:'orders' as const, alert:pending>0,
    },
    {
      label:'الرسائل', value:String(unread||conversations.length),
      unit:unread>0?'غير مقروء':'محادثة',
      sub:settings.ai.humanSimulation?`AI نشط · ${settings.ai.language}`:'AI معطّل',
      spark:Array.from({length:7},(_,i)=>Math.max(0,conversations.filter(c=>c.unread>0).length-i)).reverse(),
      color:'var(--gold)', icon:MessageCircle, page:'conversations' as const, alert:unread>0,
    },
    {
      label:'الزبائن', value:String(customers.length), unit:'زبون',
      sub:`${customers.filter(c=>c.vip).length} VIP · ${customers.filter(c=>c.totalOrders>=3).length} متكرر`,
      spark:Array.from({length:7},(_,i)=>Math.max(0,customers.length-(6-i))),
      color:'var(--ember)', icon:Users, page:'customers' as const,
    },
  ];

  const workflowSteps = [
    {label:'منتج',done:products.length>0},
    {label:'منشور',done:published>0},
    {label:'رسائل',done:conversations.length>0},
    {label:'AI رد',done:conversations.some(c=>c.messages.some(m=>m.role==='ai'))},
    {label:'طلب',done:orders.length>0},
    {label:'موافقة',done:orders.some(o=>o.status!=='pending'),badge:pending},
    {label:'توصيل',done:orders.some(o=>['shipped','delivered'].includes(o.status))},
  ];
  const wfPct = Math.round((workflowSteps.filter(s=>s.done).length/workflowSteps.length)*100);

  const recentOrders = [...orders]
    .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
    .slice(0,5);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>

      {/* Store Link Widget */}
      {fullStoreUrl && (
        <div style={{background:'rgba(0,200,150,.06)',border:'1px solid rgba(0,200,150,.2)',borderRadius:'var(--r)',padding:'14px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--mint)',marginBottom:4}}>🛍️ رابط متجرك للزبائن</div>
            <div style={{fontSize:12,color:'var(--ink2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>{fullStoreUrl}</div>
          </div>
          <div style={{display:'flex',gap:8,flexShrink:0}}>
            <button onClick={()=>navigator.clipboard?.writeText(fullStoreUrl).then(()=>window.alert('تم نسخ الرابط!'))}
              style={{padding:'6px 14px',background:'var(--mint)',border:'none',borderRadius:8,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>
              نسخ الرابط
            </button>
            <a href={storeLink!} target="_blank" rel="noreferrer"
              style={{padding:'6px 14px',background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8,color:'var(--ink2)',fontSize:12,fontWeight:700,textDecoration:'none'}}>
              فتح
            </a>
          </div>
        </div>
      )}

      {/* AI Greeting */}
      <AIGreeting />

      {/* Hero KPI */}
      <div style={{background:'var(--ember)',borderRadius:'var(--r-lg)',padding:'22px 20px',
        position:'relative',overflow:'hidden',boxShadow:'0 4px 24px rgba(255,77,26,.3)'}}>
        {/* Zellige overlay */}
        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:.07,pointerEvents:'none'}}
          viewBox="0 0 400 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(i=>(
            <polygon key={i} points={`${i*24},0 ${i*24+12},12 ${i*24},24 ${i*24-12},12`}
              fill="rgba(255,255,255,.6)"/>
          ))}
        </svg>
        <div style={{position:'relative',zIndex:1}}>
          <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,.7)',marginBottom:4}}>
            الإيراد الإجمالي
          </div>
          <div style={{fontSize:36,fontWeight:900,color:'#fff',letterSpacing:'-0.04em',lineHeight:1,marginBottom:8}}>
            {revenue.toLocaleString()} <span style={{fontSize:18,opacity:.8}}>{currency}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:'rgba(255,255,255,.75)'}}>
              اليوم: {todayRev.toLocaleString()} {currency}
            </span>
            {goals.daily > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:8,background:'rgba(255,255,255,.15)',
                borderRadius:99,padding:'3px 10px',gap:8}}>
                <div style={{width:60,height:4,borderRadius:2,background:'rgba(255,255,255,.3)',overflow:'hidden'}}>
                  <div style={{width:`${goalPct}%`,height:'100%',background:'#fff',borderRadius:2}}/>
                </div>
                <span style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,.9)'}}>
                  {goalPct}% من الهدف
                </span>
              </div>
            )}
          </div>
          {/* Mini sparkline */}
          <div style={{marginTop:14,height:40,display:'flex',alignItems:'flex-end',gap:3}}>
            {last7(orders,'total').map((v,i,arr)=>{
              const max=Math.max(...arr)||1;
              const h=Math.max(4,Math.round((v/max)*36));
              const isLast=i===arr.length-1;
              return <div key={i} style={{flex:1,height:h,borderRadius:'2px 2px 0 0',
                background:isLast?'rgba(255,255,255,.9)':'rgba(255,255,255,.35)',transition:'height .3s'}}/>;
            })}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
            {['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','اليوم'].map(d=>(
              <span key={d} style={{fontSize:9,color:'rgba(255,255,255,.5)',flex:1,textAlign:'center'}}>{d}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 3 KPI cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {stats.slice(1).map((s,i)=>(
          <button key={i} onClick={()=>setPage(s.page)} style={{
            background:s.alert?`rgba(255,77,26,.06)`:'var(--panel)',
            border:`1px solid ${s.alert?'rgba(255,77,26,.25)':'var(--border)'}`,
            borderRadius:'var(--r)',padding:'14px 14px',cursor:'pointer',
            transition:'all var(--mid)',textAlign:'right',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
              <s.icon size={15} style={{color:s.alert?'var(--ember2)':'var(--ink3)',marginTop:1}} />
              <span style={{fontSize:10,color:'var(--ink3)'}}>{s.label}</span>
            </div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-0.03em',
              color:s.alert?'var(--ember2)':'var(--ink1)',lineHeight:1}}>
              {s.value}
            </div>
            <div style={{fontSize:10,color:'var(--ink3)',marginTop:5}}>{s.sub}</div>
          </button>
        ))}
      </div>

      {/* Workflow + Morning report */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        {/* Workflow */}
        <div className="card" style={{padding:'16px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div className="section-title" style={{fontSize:13}}>مسار البيع</div>
            <span style={{fontSize:12,fontWeight:700,color:wfPct===100?'var(--mint)':'var(--ember)'}}>
              {wfPct}%
            </span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:0}}>
            {workflowSteps.map((step,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',flex:i<workflowSteps.length-1?1:'auto'}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                  <div style={{
                    width:22,height:22,borderRadius:'50%',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:9,fontWeight:800,border:'2px solid',
                    background:step.done?'rgba(0,200,150,.12)':'transparent',
                    borderColor:step.done?'var(--mint)':'var(--border2)',
                    color:step.done?'var(--mint)':'var(--ink3)',
                  }}>
                    {step.done?'✓':i+1}
                  </div>
                  <span style={{fontSize:8,color:step.done?'var(--mint)':'var(--ink3)',
                    whiteSpace:'nowrap',textAlign:'center'}}>{step.label}</span>
                </div>
                {i<workflowSteps.length-1&&(
                  <div style={{flex:1,height:2,
                    background:step.done?'var(--mint)':'var(--border2)',
                    marginTop:-10,marginRight:2,marginLeft:2}}/>
                )}
              </div>
            ))}
          </div>
        </div>
        {/* Mini morning report */}
        <div className="card" style={{padding:'14px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <span style={{fontSize:16}}>🌅</span>
            <div className="section-title" style={{fontSize:13}}>ملخص الصباح</div>
          </div>
          {[
            {k:'طلبات جديدة',v:orders.filter(o=>o.createdAt?.startsWith(new Date().toISOString().split('T')[0])).length,unit:''},
            {k:'مخزون منخفض',v:low,unit:'منتج',warn:low>0},
            {k:'رسائل معلقة',v:unread,unit:'',warn:unread>0},
          ].map((r,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',
              padding:'6px 0',borderBottom:i<2?'1px solid var(--border)':'none'}}>
              <span style={{fontSize:11,color:'var(--ink3)'}}>{r.k}</span>
              <span style={{fontSize:12,fontWeight:700,
                color:r.warn?'var(--ember2)':'var(--ink1)'}}>
                {r.v} {r.unit}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Orders */}
      {recentOrders.length > 0 && (
        <div className="card">
          <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border)',
            display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div className="section-title" style={{fontSize:13}}>آخر الطلبات</div>
            <button onClick={()=>setPage('orders')} style={{
              fontSize:12,color:'var(--ember)',background:'none',border:'none',
              cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontWeight:700}}>
              كل الطلبات <ChevronRight size={13} />
            </button>
          </div>
          {recentOrders.map((o,i)=>{
            const initials=(o.customerName||'؟').slice(0,1);
            const avatarColors=['av-ember','av-gold','av-mint','av-muted'];
            return (
              <div key={o.id} className="data-row" onClick={()=>setPage('orders')}>
                <div className={`avatar ${avatarColors[i%4]}`}>{initials}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--ink1)'}}>{o.customerName}</div>
                  <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>
                    {o.city||'—'} · {o.source||'مباشر'}
                  </div>
                </div>
                <div style={{textAlign:'left'}}>
                  <div style={{fontSize:14,fontWeight:800,color:'var(--ink1)',letterSpacing:'-0.02em'}}>
                    {o.total.toLocaleString()} {currency}
                  </div>
                  <div style={{marginTop:3}}>
                    <span className={`status-${o.status}`}>{STATUS_AR[o.status]||o.status}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Low stock alert */}
      {low > 0 && (
        <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.2)',
          borderRadius:'var(--r)',padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}>
          <AlertTriangle size={18} style={{color:'#F59E0B',flexShrink:0}} />
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:'#F59E0B'}}>
              {low} منتج بمخزون منخفض
            </div>
            <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>
              يُنصح بتجديد المخزون قبل نفاده
            </div>
          </div>
          <button onClick={()=>setPage('products')}
            className="btn btn-ghost btn-sm" style={{flexShrink:0,color:'#F59E0B',borderColor:'rgba(245,158,11,.3)'}}>
            تحديث
          </button>
        </div>
      )}

    </div>
  );
}
