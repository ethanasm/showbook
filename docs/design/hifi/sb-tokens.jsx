// Shared tokens + SVG icon set for the refined mono direction.
// Geist + Geist Mono. Near-black dark theme for web, warm-off-white for mobile.

window.SB = {
  // Palette
  bg:       { dark: '#0C0C0C', light: '#FAFAF8' },
  surface:  { dark: '#141414', light: '#FFFFFF' },
  surface2: { dark: '#1C1C1C', light: '#F2F1EC' },
  ink:      { dark: '#F5F5F3', light: '#0B0B0A' },
  muted:    { dark: 'rgba(245,245,243,.55)', light: 'rgba(11,11,10,.55)' },
  faint:    { dark: 'rgba(245,245,243,.32)', light: 'rgba(11,11,10,.32)' },
  rule:     { dark: 'rgba(245,245,243,.10)', light: 'rgba(11,11,10,.10)' },
  ruleStrong: { dark: 'rgba(245,245,243,.22)', light: 'rgba(11,11,10,.22)' },

  // Per-kind accents — "Marquee" palette
  kinds: {
    concert:  { label: 'Concert',  ink: '#2E6FD9', inkDark: '#3A86FF' }, // stage blue
    theatre: { label: 'Theatre', ink: '#D42F3A', inkDark: '#E63946' }, // curtain crimson
    comedy:   { label: 'Comedy',   ink: '#8340C4', inkDark: '#9D4EDD' }, // quirky amethyst
    festival: { label: 'Festival', ink: '#238577', inkDark: '#2A9D8F' }, // outdoor teal
  },

  // Accent — Marquee Gold (spotlight)
  accent: {
    light: '#E5A800',           // warm gold for light surfaces
    dark:  '#FFD166',           // sunray gold — luminous on dark
    faded: { light: 'rgba(229,168,0,.12)', dark: 'rgba(255,209,102,.14)' },
    text:  '#0C0C0C',           // always dark text on gold fills
  },

  // Type
  sans: '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

// Helper — kind color for current theme
window.kindInk = (kind, dark=false) => {
  const k = window.SB.kinds[kind];
  return dark ? k.inkDark : k.ink;
};

// ─── SVG icons — 24px stroke 1.6, square corners. Replace the ascii glyphs. ──
// All take {size, color}. Default size 20, color currentColor.
const _svg = (p, {size=20, color='currentColor', strokeWidth=1.6, fill='none'} = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{display:'block', flexShrink:0}}>{p}</svg>
);

window.Icon = {
  // — Navigation —
  Home: (p) => _svg(<><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/></>, p),
  Archive: (p) => _svg(<><rect x="3" y="4" width="18" height="4" rx="0"/><path d="M5 8v12h14V8"/><path d="M10 13h4"/></>, p),
  Calendar: (p) => _svg(<><rect x="3.5" y="5" width="17" height="16" rx="0"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/></>, p),
  Map: (p) => _svg(<><path d="M9 5 3 7v13l6-2 6 2 6-2V5l-6 2-6-2z"/><path d="M9 5v13M15 7v13"/></>, p),
  User: (p) => _svg(<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>, p),
  Plus: (p) => _svg(<><path d="M12 5v14M5 12h14"/></>, p),

  // — Meta —
  Search: (p) => _svg(<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, p),
  Filter: (p) => _svg(<><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z"/></>, p),
  Sort: (p) => _svg(<><path d="M7 4v16M3 8l4-4 4 4"/><path d="M17 20V4M13 16l4 4 4-4"/></>, p),
  More: (p) => _svg(<><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>, p),
  Command: (p) => _svg(<><path d="M9 3a3 3 0 0 0-3 3v3m3-6h6v3M9 3v3m6 0V3a3 3 0 0 1 3 3v3m0 0h-3m3 0v3a3 3 0 0 1-3 3h0M9 9h6M9 9v6m0 0v3a3 3 0 0 1-3 3h0m3-3h6m-6 0H6v-3"/></>, p),

  // — Context —
  Ticket: (p) => _svg(<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M14 6v12" strokeDasharray="2 2"/></>, p),
  MapPin: (p) => _svg(<><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></>, p),
  Clock: (p) => _svg(<><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>, p),
  Music: (p) => _svg(<><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></>, p),
  ArrowUpRight: (p) => _svg(<><path d="M7 17 17 7M9 7h8v8"/></>, p),
  ArrowRight: (p) => _svg(<><path d="M5 12h14M13 6l6 6-6 6"/></>, p),
  ChevronRight: (p) => _svg(<><path d="m9 6 6 6-6 6"/></>, p),
  ChevronDown: (p) => _svg(<><path d="m6 9 6 6 6-6"/></>, p),
  Check: (p) => _svg(<><path d="m5 12 5 5L20 7"/></>, p),
  Eye: (p) => _svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>, p),
  Dot: (p) => _svg(<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>, p),
  Square: (p) => _svg(<rect x="7" y="7" width="10" height="10"/>, p),
  SquareFilled: (p) => _svg(<rect x="7" y="7" width="10" height="10" fill="currentColor" stroke="none"/>, p),

  // — Kind icons (24×24 · stroke 1.6 · match existing style) —
  // Concert: microphone on stand
  Concert: (p) => _svg(<>
    <rect x="9.5" y="3" width="5" height="9" rx="2.5"/>
    <path d="M6.5 10.5a5.5 5.5 0 0 0 11 0"/>
    <path d="M12 16v4M9 20h6"/>
  </>, p),
  // Theatre: proscenium arch with curtain swags
  Theatre: (p) => _svg(<>
    <path d="M3.5 20V6h17v14"/>
    <path d="M7 6v11M17 6v11"/>
    <path d="M7 6c1.3 2 3 3 5 3s3.7-1 5-3"/>
    <path d="M3.5 20h17"/>
  </>, p),
  // Comedy: mic with spotlight cone from above
  Comedy: (p) => _svg(<>
    <path d="M8 3h8l-2 7h-4z"/>
    <path d="M6 10.5h12"/>
    <circle cx="12" cy="15.5" r="3"/>
    <path d="M12 18.5V21"/>
  </>, p),
  // Festival: tent with flag on top
  Festival: (p) => _svg(<>
    <path d="M12 3v3"/>
    <path d="M12 3l4 2-4 1.5"/>
    <path d="M3.5 20 12 6l8.5 14"/>
    <path d="M9 20l3-6 3 6"/>
    <path d="M3.5 20h17"/>
  </>, p),
};

// Helper: kind → icon component
window.KindIcon = {
  concert:  window.Icon.Concert,
  theatre: window.Icon.Theatre,
  comedy:   window.Icon.Comedy,
  festival: window.Icon.Festival,
};
