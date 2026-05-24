// ================================================================
// AI Commerce OS — Custom Icon Set
// All icons as React components (SVG-based, no external deps)
// ================================================================
import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, ...props,
});

// ── Social Platform Icons ─────────────────────────────────────

export function IconWhatsApp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill="#25d366" stroke="none"/>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" fill="none" stroke="#25d366" strokeWidth="1.5"/>
    </svg>
  );
}

export function IconFacebook(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="#1877f2" stroke="none"/>
      <path d="M13.5 12.5h2l.5-3h-2.5v-1.5c0-.8.4-1.5 1.5-1.5h1V4h-2c-2.2 0-3.5 1.3-3.5 3.5v2H9v3h2.5v7h3v-7z" fill="#fff" stroke="none"/>
    </svg>
  );
}

export function IconInstagram(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="ig" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0%" stopColor="#feda75"/><stop offset="25%" stopColor="#fa7e1e"/>
          <stop offset="50%" stopColor="#d62976"/><stop offset="75%" stopColor="#962fbf"/>
          <stop offset="100%" stopColor="#4f5bd5"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig)" stroke="none"/>
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="#fff" strokeWidth="1.8"/>
      <circle cx="17.5" cy="6.5" r="1.2" fill="#fff" stroke="none"/>
    </svg>
  );
}

export function IconTikTok(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <path d="M9 12a4 4 0 104 4V4a5 5 0 005 5" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M9 12a4 4 0 104 4V4a5 5 0 005 5" fill="none" stroke="#25f4ee" strokeWidth="2.5" strokeLinecap="round" transform="translate(-0.5,-0.5)"/>
      <path d="M9 12a4 4 0 104 4V4a5 5 0 005 5" fill="none" stroke="#fe2c55" strokeWidth="2.5" strokeLinecap="round" transform="translate(0.5,0.5)"/>
    </svg>
  );
}

// ── Delivery Icons ────────────────────────────────────────────

export function IconAmana(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <rect x="3" y="8" width="18" height="12" rx="2" fill="#ff6b00" stroke="none"/>
      <path d="M3 12l9-6 9 6" fill="none" stroke="#ff6b00" strokeWidth="2"/>
      <rect x="7" y="14" width="10" height="6" rx="1" fill="#fff" stroke="none" opacity="0.3"/>
    </svg>
  );
}

export function IconJibli(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <path d="M4 16l4-8 4 4 4-8 4 4" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="20" cy="4" r="2" fill="#f59e0b" stroke="none"/>
    </svg>
  );
}

// ── Product Category Icons ────────────────────────────────────

export function IconDress(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <path d="M8 3l-2 6 2 1v11h8V10l2-1-2-6H8z" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5"/>
      <path d="M8 3h8" stroke="#f59e0b" strokeWidth="1.5"/>
    </svg>
  );
}

export function IconShoes(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <path d="M4 16h16v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" fill="#f97316" stroke="none"/>
      <path d="M4 16c0-3 2-6 5-8l2-2h4l3 4c1 1 2 3 2 6H4z" fill="#fff" stroke="#333" strokeWidth="1.5"/>
      <path d="M8 16v-2c0-2 1-3 2-4" stroke="#f97316" strokeWidth="1.5" fill="none"/>
    </svg>
  );
}

export function IconBag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <rect x="4" y="8" width="16" height="13" rx="2" fill="#92400e" stroke="#78350f" strokeWidth="1.5"/>
      <path d="M8 8V6a4 4 0 018 0v2" fill="none" stroke="#78350f" strokeWidth="2"/>
    </svg>
  );
}

export function IconWatch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7" fill="#1e293b" stroke="#475569" strokeWidth="2"/>
      <path d="M12 9v3l2 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M9 3h6M9 21h6" stroke="#475569" strokeWidth="2"/>
    </svg>
  );
}

// ── Empty State Icons ─────────────────────────────────────────

export function EmptyProducts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <rect x="30" y="40" width="60" height="65" rx="8" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2"/>
      <path d="M45 40V30a15 15 0 0130 0v10" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
      <rect x="45" y="60" width="30" height="8" rx="4" fill="#e2e8f0"/>
      <rect x="45" y="75" width="20" height="8" rx="4" fill="#e2e8f0"/>
      <text x="60" y="118" textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">No Products</text>
    </svg>
  );
}

export function EmptyOrders(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <rect x="35" y="30" width="50" height="70" rx="6" fill="#fff" stroke="#f97316" strokeWidth="2.5"/>
      <rect x="42" y="42" width="36" height="4" rx="2" fill="#fed7aa"/>
      <rect x="42" y="52" width="28" height="4" rx="2" fill="#fed7aa"/>
      <rect x="42" y="62" width="32" height="4" rx="2" fill="#fed7aa"/>
      <rect x="42" y="72" width="20" height="4" rx="2" fill="#fed7aa"/>
      <circle cx="85" cy="35" r="8" fill="#f97316"/>
      <text x="60" y="118" textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">No Orders</text>
    </svg>
  );
}

export function EmptyMessages(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <ellipse cx="60" cy="55" rx="35" ry="25" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="2"/>
      <path d="M35 55l-10 15 15-5" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="2" strokeLinejoin="round"/>
      <text x="60" y="60" textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="700">No Messages</text>
    </svg>
  );
}

export function EmptyCustomers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <circle cx="60" cy="45" r="20" fill="#3b82f6" stroke="none"/>
      <path d="M60 38c-3 0-5 3-5 6s2 5 5 5 5-2 5-5-2-6-5-6z" fill="#0ea5e9" stroke="none"/>
      <path d="M40 85c0-11 9-20 20-20s20 9 20 20" fill="#3b82f6" stroke="none"/>
      <rect x="50" y="30" width="20" height="10" rx="5" fill="#1e293b" stroke="none"/>
      <text x="60" y="118" textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">No Customers</text>
    </svg>
  );
}

export function EmptyResults(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <circle cx="55" cy="55" r="28" fill="none" stroke="#94a3b8" strokeWidth="4"/>
      <line x1="75" y1="75" x2="95" y2="95" stroke="#64748b" strokeWidth="5" strokeLinecap="round"/>
      <text x="60" y="118" textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">No Results</text>
    </svg>
  );
}

// ── Onboarding Illustrations ──────────────────────────────────

export function IllStartBusiness(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <rect x="15" y="30" width="70" height="55" rx="6" fill="#1e293b" stroke="#475569" strokeWidth="2"/>
      <rect x="20" y="35" width="60" height="35" rx="3" fill="#334155"/>
      <rect x="25" y="40" width="20" height="8" rx="2" fill="#6366f1"/>
      <rect x="25" y="52" width="35" height="4" rx="2" fill="#475569"/>
      <rect x="25" y="60" width="28" height="4" rx="2" fill="#475569"/>
      <rect x="65" y="40" width="10" height="25" rx="2" fill="#f97316"/>
      <rect x="70" y="70" width="25" height="35" rx="4" fill="#1e293b" stroke="#475569" strokeWidth="1.5"/>
      <rect x="74" y="75" width="17" height="22" rx="2" fill="#334155"/>
      <circle cx="82" cy="86" r="4" fill="#6366f1"/>
      <text x="50" y="118" textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="700">Start Business</text>
    </svg>
  );
}

export function IllConnectAccounts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <circle cx="40" cy="50" r="14" fill="#25d366" stroke="none"/>
      <circle cx="80" cy="50" r="14" fill="#1877f2" stroke="none"/>
      <circle cx="60" cy="80" r="14" fill="#e1306c" stroke="none"/>
      <path d="M40 50h20M60 50v20" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3"/>
      <circle cx="60" cy="80" r="14" fill="#e1306c" stroke="none"/>
      <text x="60" y="118" textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="700">Connect Accounts</text>
    </svg>
  );
}

export function IllAIPowered(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <rect x="25" y="35" width="70" height="50" rx="12" fill="#1e293b" stroke="#475569" strokeWidth="2"/>
      <circle cx="45" cy="55" r="8" fill="#6366f1"/>
      <circle cx="75" cy="55" r="8" fill="#f97316"/>
      <circle cx="45" cy="55" r="3" fill="#fff"/>
      <circle cx="75" cy="55" r="3" fill="#fff"/>
      <path d="M50 70q10 8 20 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="30" cy="30" r="6" fill="#f97316" opacity="0.6"/>
      <circle cx="90" cy="30" r="5" fill="#6366f1" opacity="0.6"/>
      <rect x="35" y="25" width="12" height="8" rx="3" fill="#f97316" opacity="0.5"/>
      <rect x="75" y="28" width="10" height="6" rx="2" fill="#6366f1" opacity="0.5"/>
      <text x="60" y="118" textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="700">AI Powered</text>
    </svg>
  );
}

export function IllSuccess(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <rect x="35" y="25" width="50" height="65" rx="8" fill="#fff" stroke="#3b82f6" strokeWidth="3"/>
      <rect x="40" y="20" width="40" height="10" rx="5" fill="#f97316"/>
      <circle cx="60" cy="60" r="18" fill="#dcfce7" stroke="#10b981" strokeWidth="2"/>
      <path d="M52 60l6 6 10-12" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="95" cy="35" r="8" fill="#fbbf24" opacity="0.5"/>
      <circle cx="25" cy="80" r="6" fill="#fbbf24" opacity="0.4"/>
      <text x="60" y="118" textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="700">Success</text>
    </svg>
  );
}

// ── App Logo ──────────────────────────────────────────────────

export function LogoAI(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 48 48" width={48} height={48}>
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="48" x2="48" y2="0">
          <stop offset="0%" stopColor="#6366f1"/>
          <stop offset="100%" stopColor="#f97316"/>
        </linearGradient>
      </defs>
      <text x="4" y="36" fontSize="32" fontWeight="900" fill="url(#logoGrad)" stroke="none" fontFamily="system-ui">A</text>
      <path d="M28 32h14l-3-8" fill="none" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="42" cy="12" r="4" fill="#f97316" stroke="none"/>
    </svg>
  );
}

// ── Robot / AI Mascot ─────────────────────────────────────────

export function RobotMascot(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 100 100" width={100} height={100}>
      {/* Body */}
      <rect x="25" y="55" width="50" height="35" rx="12" fill="#e0e7ff" stroke="#4f46e5" strokeWidth="2"/>
      <circle cx="50" cy="72" r="6" fill="#6366f1"/>
      {/* Head */}
      <circle cx="50" cy="35" r="22" fill="#f8fafc" stroke="#334155" strokeWidth="2.5"/>
      {/* Eyes */}
      <ellipse cx="42" cy="32" rx="5" ry="6" fill="#06b6d4"/>
      <ellipse cx="58" cy="32" rx="5" ry="6" fill="#06b6d4"/>
      {/* Smile */}
      <path d="M44 42q6 5 12 0" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
      {/* Antenna */}
      <line x1="50" y1="13" x2="50" y2="5" stroke="#334155" strokeWidth="2.5"/>
      <circle cx="50" cy="5" r="4" fill="#f97316"/>
      {/* Ears */}
      <rect x="22" y="28" width="8" height="14" rx="4" fill="#4f46e5"/>
      <rect x="70" y="28" width="8" height="14" rx="4" fill="#f97316"/>
    </svg>
  );
}

// ── App Icon (gradient square) ────────────────────────────────

export function AppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 120 120" width={120} height={120}>
      <defs>
        <linearGradient id="appIconGrad" x1="0" y1="120" x2="120" y2="0">
          <stop offset="0%" stopColor="#f97316"/>
          <stop offset="100%" stopColor="#6366f1"/>
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="112" height="112" rx="28" fill="url(#appIconGrad)" stroke="none"/>
      {/* Shopping bag */}
      <rect x="30" y="45" width="45" height="40" rx="6" fill="none" stroke="#fff" strokeWidth="3.5"/>
      <path d="M42 45V38a8 8 0 0116 0v7" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Network dots */}
      <circle cx="52" cy="65" r="4" fill="#fff"/>
      <circle cx="68" cy="65" r="4" fill="#fff"/>
      <circle cx="60" cy="78" r="4" fill="#fff"/>
      <line x1="52" y1="65" x2="68" y2="65" stroke="#fff" strokeWidth="2"/>
      <line x1="52" y1="65" x2="60" y2="78" stroke="#fff" strokeWidth="2"/>
      <line x1="68" y1="65" x2="60" y2="78" stroke="#fff" strokeWidth="2"/>
      {/* Chat bubble */}
      <rect x="68" y="42" width="18" height="14" rx="4" fill="#fff" opacity="0.9"/>
      <circle cx="73" cy="49" r="1.5" fill="#6366f1"/>
      <circle cx="77" cy="49" r="1.5" fill="#6366f1"/>
      <circle cx="81" cy="49" r="1.5" fill="#6366f1"/>
    </svg>
  );
}

// ── Link Accounts Illustration ────────────────────────────────

export function IllLinkAccounts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} viewBox="0 0 200 200" width={200} height={200}>
      {/* Phone */}
      <rect x="20" y="40" width="60" height="120" rx="10" fill="#1e293b" stroke="#475569" strokeWidth="2"/>
      <rect x="25" y="50" width="50" height="100" rx="5" fill="#334155"/>
      {/* App icons on phone */}
      <rect x="32" y="58" width="16" height="16" rx="4" fill="#e1306c"/>
      <rect x="32" y="82" width="16" height="16" rx="4" fill="#1da1f2"/>
      <rect x="32" y="106" width="16" height="16" rx="4" fill="#0077b5"/>
      {/* Robot */}
      <circle cx="140" cy="80" r="30" fill="#f8fafc" stroke="#334155" strokeWidth="2"/>
      <ellipse cx="132" cy="75" rx="5" ry="7" fill="#06b6d4"/>
      <ellipse cx="148" cy="75" rx="5" ry="7" fill="#06b6d4"/>
      <path d="M135 88q5 4 10 0" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
      {/* Arrow */}
      <path d="M85 90q20 -10 35 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeDasharray="4 3"/>
      <polygon points="118,85 122,90 118,95" fill="#fff"/>
      {/* Person silhouette */}
      <circle cx="170" cy="70" r="15" fill="#6366f1"/>
      <path d="M155 120c0-15 7-25 15-25s15 10 15 25" fill="#6366f1"/>
      {/* Title */}
      <text x="100" y="25" textAnchor="middle" fontSize="14" fill="#fff" fontWeight="900">Link Accounts</text>
    </svg>
  );
}

// ── Cyberpunk Background Pattern ──────────────────────────────

export function BgCyberpunk(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="cyberBg" x1="0" y1="0" x2="800" y2="600">
          <stop offset="0%" stopColor="#0a0a1f"/>
          <stop offset="50%" stopColor="#1a0a3e"/>
          <stop offset="100%" stopColor="#0a1628"/>
        </linearGradient>
        <radialGradient id="glow1" cx="30%" cy="40%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="transparent"/>
        </radialGradient>
        <radialGradient id="glow2" cx="70%" cy="60%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.1"/>
          <stop offset="100%" stopColor="transparent"/>
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="url(#cyberBg)"/>
      <rect width="800" height="600" fill="url(#glow1)"/>
      <rect width="800" height="600" fill="url(#glow2)"/>
      {/* Grid */}
      <g stroke="rgba(99,102,241,0.08)" strokeWidth="1">
        {Array.from({length: 20}, (_, i) => (
          <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="600"/>
        ))}
        {Array.from({length: 15}, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 40} x2="800" y2={i * 40}/>
        ))}
      </g>
      {/* Floating nodes */}
      {[
        {cx: 200, cy: 150, r: 4, color: '#6366f1'},
        {cx: 400, cy: 100, r: 3, color: '#f97316'},
        {cx: 600, cy: 200, r: 5, color: '#06b6d4'},
        {cx: 300, cy: 300, r: 3, color: '#a855f7'},
        {cx: 500, cy: 400, r: 4, color: '#10b981'},
        {cx: 150, cy: 450, r: 3, color: '#f97316'},
        {cx: 700, cy: 350, r: 4, color: '#6366f1'},
      ].map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={n.r} fill={n.color} opacity="0.6"/>
      ))}
    </svg>
  );
}

// ── Export all ────────────────────────────────────────────────
export const Icons = {
  WhatsApp: IconWhatsApp,
  Facebook: IconFacebook,
  Instagram: IconInstagram,
  TikTok: IconTikTok,
  Amana: IconAmana,
  Jibli: IconJibli,
  Dress: IconDress,
  Shoes: IconShoes,
  Bag: IconBag,
  Watch: IconWatch,
  EmptyProducts,
  EmptyOrders,
  EmptyMessages,
  EmptyCustomers,
  EmptyResults,
  IllStartBusiness,
  IllConnectAccounts,
  IllAIPowered,
  IllSuccess,
  IllLinkAccounts,
  LogoAI,
  RobotMascot,
  AppIcon,
  BgCyberpunk,
};
