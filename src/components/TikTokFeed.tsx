import { useState, useRef } from 'react';
import { Heart, MessageCircle, Share2, ShoppingCart, Music2, User, ChevronUp } from 'lucide-react';

interface TikTokFeedProps {
  products: any[];
  onOrder: (product: any) => void;
  currency: string;
}

export default function TikTokFeed({ products, onOrder, currency }: TikTokFeedProps) {
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleLike = (id: string) => {
    setLikes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (products.length === 0) return null;

  return (
    <div 
      ref={containerRef}
      className="tiktok-container"
      style={{
        height: 'calc(100vh - 120px)',
        overflowY: 'scroll',
        scrollSnapType: 'y mandatory',
        scrollBehavior: 'smooth',
        borderRadius: '24px',
        background: '#000'
      }}
    >
      {products.map((product) => (
        <div 
          key={product.id}
          style={{
            height: '100%',
            width: '100%',
            scrollSnapAlign: 'start',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            background: 'var(--clr-space)'
          }}
        >
          {/* Background Media */}
          {product.imageUrl ? (
            <img 
              src={product.imageUrl} 
              alt={product.name}
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-9xl opacity-20">
              {product.emoji || '📦'}
            </div>
          )}

          {/* Bottom Overlay Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent pointer-events-none" />

          {/* Side Actions */}
          <div className="absolute right-4 bottom-32 flex flex-col gap-6 items-center z-10">
            {/* Merchant Avatar */}
            <div className="relative mb-2">
              <div className="w-12 h-12 rounded-full border-2 border-white overflow-hidden bg-indigo-600 flex items-center justify-center font-bold text-white">
                <User size={24} />
              </div>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white text-[10px] font-bold border-2 border-black">
                +
              </div>
            </div>

            <button onClick={() => toggleLike(product.id)} className="flex flex-col items-center gap-1 group">
              <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center transition-transform group-active:scale-125">
                <Heart size={26} fill={likes[product.id] ? "#ef4444" : "none"} color={likes[product.id] ? "#ef4444" : "#fff"} />
              </div>
              <span className="text-white text-xs font-bold shadow-sm">1.2k</span>
            </button>

            <button className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center">
                <MessageCircle size={26} color="#fff" />
              </div>
              <span className="text-white text-xs font-bold shadow-sm">45</span>
            </button>

            <button className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center">
                <Share2 size={26} color="#fff" />
              </div>
              <span className="text-white text-xs font-bold shadow-sm">إرسال</span>
            </button>

            {/* Rotating Disc Animation */}
            <div className="w-12 h-12 rounded-full bg-black/40 border-4 border-white/20 flex items-center justify-center animate-spin-slow">
               <Music2 size={20} color="#fff" />
            </div>
          </div>

          {/* Product Details (Bottom) */}
          <div className="relative p-6 space-y-4 z-10 text-right">
            <div className="flex items-center gap-2 mb-2">
               <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Top Rated</span>
               <span className="bg-white/10 backdrop-blur-md text-white/70 text-[10px] font-bold px-2 py-0.5 rounded italic">#SaharShopFashion</span>
            </div>
            
            <h2 className="text-white text-3xl font-black mb-1 drop-shadow-lg">{product.name}</h2>
            <p className="text-white/70 text-sm max-w-[80%] leading-relaxed drop-shadow-md">
              {product.description || 'أفضل جودة بأحسن ثمن في المغرب 🇲🇦. جودة مضمونة 100% وتوصيل سريع لباب الدار.'}
            </p>

            <div className="flex items-center gap-3 py-2 text-indigo-300 font-bold text-sm overflow-hidden whitespace-nowrap">
              <Music2 size={14} />
              <span className="animate-pulse">Original Sound - Sahar Shop Official - 🔥 Trending Now</span>
            </div>

            <div className="flex items-center justify-between gap-4 pt-4">
              <div className="flex flex-col">
                <span className="text-[#f97316] text-3xl font-black drop-shadow-lg">{product.price} {currency}</span>
                <span className="text-white/40 text-[10px] line-through">{(product.price * 1.2).toFixed(0)} {currency}</span>
              </div>
              
              <button 
                onClick={() => onOrder(product)}
                className="btn-aurora flex-1 flex items-center justify-center gap-3 h-14 rounded-2xl text-lg font-black"
              >
                <ShoppingCart size={22} />
                اطلب الآن
              </button>
            </div>
          </div>

          {/* Floating Arrow Hint */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 animate-bounce opacity-40">
            <ChevronUp size={24} color="#fff" />
          </div>
        </div>
      ))}

      <style>{`
        .animate-spin-slow { animation: spin 4s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .tiktok-container::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
