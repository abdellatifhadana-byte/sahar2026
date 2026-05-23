import { useState, useRef, useEffect, useCallback } from 'react';
import { Download, Plus, Trash2, RotateCcw, Type, Image as ImageIcon, Share2 } from 'lucide-react';
import { useStore } from '../store';

type Layer = { id:string; type:'text'|'logo'|'sticker'; content:string; x:number; y:number; size:number; color?:string; opacity?:number; };
type ExportSize = { label:string; w:number; h:number; desc:string; };

const EXPORT_SIZES: ExportSize[] = [
  { label:'Facebook Post', w:1200, h:630, desc:'منشور فيسبوك' },
  { label:'Instagram Square', w:1080, h:1080, desc:'انستغرام مربع' },
  { label:'Story', w:1080, h:1920, desc:'ستوري (عمودي)' },
  { label:'WhatsApp', w:800, h:800, desc:'واتساب' },
];

const STICKERS = ['🔥','⭐','💎','🎉','✅','🚚','🏷️','💯','🤑','📦','🇲🇦','❤️'];

export default function ImageEditorPage() {
  const { settings, products } = useStore();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const logoRef    = useRef<HTMLInputElement>(null);
  const [bg, setBg]         = useState<string>('');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [exportSize,setExportSize] = useState<ExportSize>(EXPORT_SIZES[1]);
  const [dragging, setDragging] = useState<{id:string;ox:number;oy:number}|null>(null);
  const [text, setText]     = useState('');
  const [textColor,setTextColor] = useState('#ffffff');
  const [fontSize,setFontSize]   = useState(36);
  const [bgColor,setBgColor]     = useState('#0E1018');
  const [showProductPicker,setShowProductPicker] = useState(false);

  const uid = () => Math.random().toString(36).slice(2,8);
  const previewW = 340;
  const previewH = Math.round(previewW * exportSize.h / exportSize.w);
  const scale    = previewW / exportSize.w;

  // Draw preview
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width  = previewW;
    canvas.height = previewH;
    ctx.clearRect(0,0,previewW,previewH);

    // Background
    if (bg) {
      const img = new window.Image();
      img.src = bg;
      img.onload = () => { ctx.drawImage(img,0,0,previewW,previewH); drawLayers(ctx); };
      if (img.complete) { ctx.drawImage(img,0,0,previewW,previewH); drawLayers(ctx); }
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0,0,previewW,previewH);
      drawLayers(ctx);
    }
  }, [bg, layers, previewW, previewH, bgColor, scale]);

  function drawLayers(ctx: CanvasRenderingContext2D) {
    layers.forEach(layer => {
      ctx.globalAlpha = layer.opacity ?? 1;
      if (layer.type === 'text') {
        ctx.font = `900 ${layer.size * scale}px Tajawal, sans-serif`;
        ctx.fillStyle = layer.color || '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.5)';
        ctx.shadowBlur  = 4;
        ctx.fillText(layer.content, layer.x * scale, layer.y * scale);
        ctx.shadowBlur = 0;
      } else if (layer.type === 'sticker') {
        ctx.font = `${layer.size * scale}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.content, layer.x * scale, layer.y * scale);
      } else if (layer.type === 'logo' && layer.content) {
        const img = new window.Image();
        img.src = layer.content;
        const s = layer.size * scale;
        img.onload = () => { ctx.drawImage(img, layer.x*scale - s/2, layer.y*scale - s/2, s, s); };
        if (img.complete) { ctx.drawImage(img, layer.x*scale - s/2, layer.y*scale - s/2, s, s); }
      }
      ctx.globalAlpha = 1;
    });
  }

  useEffect(() => { draw(); }, [draw]);

  const addText = () => {
    if (!text.trim()) return;
    setLayers(l => [...l, { id:uid(), type:'text', content:text, x:exportSize.w/2, y:exportSize.h/2, size:fontSize, color:textColor }]);
    setText('');
  };

  const addSticker = (s: string) => {
    setLayers(l => [...l, { id:uid(), type:'sticker', content:s, x:exportSize.w/2, y:exportSize.h/3, size:80, opacity:1 }]);
  };

  const removeLayer = (id: string) => { setLayers(l => l.filter(x=>x.id!==id)); setSelected(null); };

  const loadImage = (e: React.ChangeEvent<HTMLInputElement>, type: 'bg'|'logo') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      if (type === 'bg') setBg(result);
      else setLayers(l => [...l, { id:uid(), type:'logo', content:result, x:exportSize.w*0.85, y:exportSize.h*0.12, size:120 }]);
    };
    reader.readAsDataURL(file);
  };

  const loadProductImage = (product: any) => {
    if (product.imageUrl) setBg(product.imageUrl);
    addFromProduct(product);
    setShowProductPicker(false);
  };

  const addFromProduct = (p: any) => {
    const cur = settings.brand.currency || 'MAD';
    setLayers([
      { id:uid(), type:'text', content:p.name, x:exportSize.w/2, y:exportSize.h*0.75, size:42, color:'#ffffff' },
      { id:uid(), type:'text', content:`${p.price} ${cur}`, x:exportSize.w/2, y:exportSize.h*0.85, size:38, color:'#FF4D1A' },
    ]);
  };

  const exportImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = exportSize.w;
    canvas.height = exportSize.h;
    const ctx = canvas.getContext('2d')!;
    const s   = exportSize.w / previewW;

    const finish = () => {
      layers.forEach(layer => {
        ctx.globalAlpha = layer.opacity ?? 1;
        if (layer.type === 'text') {
          ctx.font = `900 ${layer.size * 1}px Tajawal, Arial, sans-serif`;
          ctx.fillStyle = layer.color || '#fff';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
          ctx.fillText(layer.content, layer.x, layer.y);
          ctx.shadowBlur = 0;
        } else if (layer.type === 'sticker') {
          ctx.font = `${layer.size}px serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(layer.content, layer.x, layer.y);
        }
        ctx.globalAlpha = 1;
      });
      const link = document.createElement('a');
      link.download = `${exportSize.label.replace(/\s/g,'-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    if (bg) {
      const img = new window.Image(); img.crossOrigin = 'anonymous'; img.src = bg;
      img.onload = () => { ctx.drawImage(img,0,0,exportSize.w,exportSize.h); finish(); };
    } else {
      ctx.fillStyle = bgColor; ctx.fillRect(0,0,exportSize.w,exportSize.h); finish();
    }
  };

  const selLayer = layers.find(l => l.id === selected);

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:16 }}>
      <div style={{ display:'flex',alignItems:'center',gap:12 }}>
        <div style={{ width:40,height:40,borderRadius:11,background:'rgba(201,149,76,.12)',border:'1px solid rgba(201,149,76,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20 }}>🎨</div>
        <div>
          <h1 style={{ fontSize:18,fontWeight:900,color:'var(--ink1)',margin:0,letterSpacing:'-0.02em' }}>محرر الصور</h1>
          <p style={{ fontSize:12,color:'var(--ink3)',margin:0 }}>أضف لوغو، نص، وعناصر لمنتجاتك</p>
        </div>
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'1fr 300px',gap:14 }}>
        {/* Canvas */}
        <div>
          {/* Export size selector */}
          <div style={{ display:'flex',gap:6,marginBottom:12,flexWrap:'wrap' }}>
            {EXPORT_SIZES.map(s=>(
              <button key={s.label} onClick={()=>setExportSize(s)} style={{
                padding:'5px 12px',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',
                border:`1px solid ${exportSize.label===s.label?'var(--ember)':'var(--border)'}`,
                background:exportSize.label===s.label?'rgba(255,77,26,.1)':'var(--panel)',
                color:exportSize.label===s.label?'var(--ember2)':'var(--ink2)',
              }}>{s.desc} ({s.w}×{s.h})</button>
            ))}
          </div>

          {/* Canvas preview */}
          <div style={{ position:'relative',width:previewW,height:previewH,borderRadius:'var(--r)',overflow:'hidden',border:'1px solid var(--border2)',cursor:'crosshair',userSelect:'none' }}
            onClick={e => {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              if (dragging) return;
              setSelected(null);
            }}
          >
            <canvas ref={canvasRef} style={{ width:'100%',height:'100%',display:'block' }} />
            {/* Layer overlays for selection */}
            {layers.map(layer => (
              <div key={layer.id}
                onClick={e=>{e.stopPropagation();setSelected(layer.id);}}
                style={{
                  position:'absolute',
                  left:layer.x*scale-(layer.size*scale/2)-4, top:layer.y*scale-(layer.size*scale/2)-4,
                  width:layer.size*scale+8, height:layer.size*scale+8,
                  border:`2px dashed ${selected===layer.id?'var(--ember)':'transparent'}`,
                  borderRadius:4, cursor:'pointer', pointerEvents:'auto',
                }}
              />
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display:'flex',gap:8,marginTop:12,flexWrap:'wrap' }}>
            <button onClick={exportImage} className="btn btn-aurora" style={{ gap:7 }}>
              <Download size={14}/> تصدير {exportSize.desc}
            </button>
            <button onClick={()=>{ setBg(''); setLayers([]); }} className="btn btn-ghost btn-sm">
              <RotateCcw size={13}/> إعادة تعيين
            </button>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display:'flex',flexDirection:'column',gap:10 }}>

          {/* Background */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8,letterSpacing:'.06em' }}>الخلفية</div>
            <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
              <button onClick={()=>fileRef.current?.click()} className="btn btn-ghost btn-sm" style={{ gap:6,fontSize:11 }}>
                <ImageIcon size={12}/> رفع صورة
              </button>
              <button onClick={()=>setShowProductPicker(true)} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>
                📦 من منتج
              </button>
              {bg && <button onClick={()=>setBg('')} className="btn btn-ghost btn-sm" style={{ color:'var(--ember)' }}><Trash2 size={12}/></button>}
            </div>
            {!bg && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:11,color:'var(--ink3)',marginBottom:5 }}>لون الخلفية</div>
                <div style={{ display:'flex',gap:6,flexWrap:'wrap' }}>
                  {['#07080D','#0E1018','#C1121F','#0A7C6E','#1A0A2E','#1B1B2F'].map(c=>(
                    <button key={c} onClick={()=>setBgColor(c)} style={{ width:26,height:26,borderRadius:'50%',background:c,border:bgColor===c?'2px solid var(--ember)':'2px solid transparent',cursor:'pointer' }}/>
                  ))}
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>loadImage(e,'bg')}/>
          </div>

          {/* Logo */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8,letterSpacing:'.06em' }}>اللوغو</div>
            <button onClick={()=>logoRef.current?.click()} className="btn btn-ghost btn-sm" style={{ gap:6,fontSize:11,width:'100%' }}>
              <Plus size={12}/> إضافة اللوغو
            </button>
            <input ref={logoRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>loadImage(e,'logo')}/>
          </div>

          {/* Text */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8,letterSpacing:'.06em' }}>إضافة نص</div>
            <input className="glass-input" style={{ marginBottom:8,fontSize:13 }} placeholder="اكتب النص..." value={text} onChange={e=>setText(e.target.value)} />
            <div style={{ display:'flex',gap:8,alignItems:'center',marginBottom:8 }}>
              <input type="color" value={textColor} onChange={e=>setTextColor(e.target.value)} style={{ width:32,height:32,borderRadius:8,border:'1px solid var(--border)',cursor:'pointer',background:'none' }}/>
              <select value={fontSize} onChange={e=>setFontSize(+e.target.value)} style={{ flex:1,background:'var(--void2)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 8px',color:'var(--ink1)',fontSize:12 }}>
                {[18,24,32,40,48,60,80].map(s=><option key={s} value={s}>{s}px</option>)}
              </select>
            </div>
            <button onClick={addText} className="btn btn-aurora btn-sm" style={{ width:'100%' }} disabled={!text.trim()}>
              <Type size={12}/> إضافة
            </button>
          </div>

          {/* Stickers */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8,letterSpacing:'.06em' }}>ملصقات</div>
            <div style={{ display:'flex',flexWrap:'wrap',gap:6 }}>
              {STICKERS.map(s=>(
                <button key={s} onClick={()=>addSticker(s)} style={{ width:36,height:36,borderRadius:8,background:'var(--void2)',border:'1px solid var(--border)',cursor:'pointer',fontSize:20 }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Layers */}
          {layers.length > 0 && (
            <div className="card" style={{ padding:'12px 14px' }}>
              <div style={{ fontSize:11,fontWeight:700,color:'var(--ink3)',marginBottom:8 }}>الطبقات ({layers.length})</div>
              {[...layers].reverse().map(layer=>(
                <div key={layer.id} onClick={()=>setSelected(layer.id)} style={{
                  display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:8,marginBottom:4,cursor:'pointer',
                  background:selected===layer.id?'rgba(255,77,26,.1)':'var(--void2)',
                  border:`1px solid ${selected===layer.id?'var(--ember)':'transparent'}`,
                }}>
                  <span style={{ fontSize:14 }}>{layer.type==='sticker'?layer.content:layer.type==='logo'?'🖼':'"'}</span>
                  <span style={{ flex:1,fontSize:11,color:'var(--ink2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                    {layer.type==='text'?layer.content:layer.type==='logo'?'لوغو':'ملصق'}
                  </span>
                  <button onClick={e=>{e.stopPropagation();removeLayer(layer.id)}} style={{ width:22,height:22,borderRadius:5,background:'rgba(255,77,26,.12)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--ember)' }}>
                    <Trash2 size={10}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Product picker modal */}
      {showProductPicker && (
        <div onClick={()=>setShowProductPicker(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'var(--panel)',borderRadius:'var(--r-xl)',padding:20,width:'100%',maxWidth:400,maxHeight:'80vh',overflowY:'auto' }}>
            <div style={{ fontSize:14,fontWeight:700,color:'var(--ink1)',marginBottom:14 }}>اختر منتج</div>
            {products.filter(p=>p.status==='published').map(p=>(
              <div key={p.id} onClick={()=>loadProductImage(p)} style={{ display:'flex',gap:12,padding:'10px',borderBottom:'1px solid var(--border)',cursor:'pointer' }}>
                <div style={{ width:44,height:44,borderRadius:8,background:'var(--void2)',overflow:'hidden',flexShrink:0 }}>
                  {p.imageUrl?<img src={p.imageUrl} style={{ width:'100%',height:'100%',objectFit:'cover' }}/>:<div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22 }}>{p.emoji||'📦'}</div>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13,fontWeight:600,color:'var(--ink1)' }}>{p.name}</div>
                  <div style={{ fontSize:12,color:'var(--ember)' }}>{p.price} {settings.brand.currency}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
