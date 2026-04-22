// Shared NYC outline map used by both web + mobile map views.
// Abstract hand-drawn boroughs inside a 500x400 viewBox. Water = background,
// land = stroked panels. Designed to host dot overlays on top.

function NYCMap({ stroke='rgba(245,245,243,.22)', rule='rgba(245,245,243,.08)', ink='#F5F5F3', bg='#0C0C0C', accent='#FF7A4E', children, showLabels=true, compact=false }) {
  return (
    <svg viewBox="0 0 500 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{display:'block'}}>
      {/* water grid */}
      <defs>
        <pattern id="waterGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0 L0 0 0 40" fill="none" stroke={rule} strokeWidth="0.5"/>
        </pattern>
        <pattern id="waterGridMinor" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="0.4" fill={rule}/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="500" height="400" fill={bg}/>
      <rect x="0" y="0" width="500" height="400" fill="url(#waterGridMinor)"/>
      <rect x="0" y="0" width="500" height="400" fill="url(#waterGrid)"/>

      {/* abstract NYC boroughs. All strokes match */}
      <g fill="none" stroke={stroke} strokeWidth="1.1" strokeLinejoin="round">
        {/* Manhattan */}
        <path d="M225 80 L245 85 L255 110 L262 140 L268 170 L265 195 L255 210 L245 215 L232 205 L220 180 L215 150 L218 115 Z"/>
        {/* Bronx */}
        <path d="M228 50 L270 55 L285 75 L275 95 L255 95 L242 82 L228 75 Z"/>
        {/* Queens + western Long Island */}
        <path d="M270 155 L340 150 L395 160 L430 175 L440 210 L420 230 L370 240 L320 225 L290 210 L275 190 Z"/>
        {/* Brooklyn */}
        <path d="M255 215 L310 220 L340 245 L335 275 L305 290 L265 285 L248 260 L245 230 Z"/>
        {/* Staten Island */}
        <path d="M170 260 L215 265 L220 300 L195 320 L160 315 L145 285 Z"/>
        {/* New Jersey (suggestion) */}
        <path d="M150 60 L205 65 L212 120 L205 180 L200 240 L175 260 L130 250 L115 200 L125 130 Z"/>
      </g>

      {/* subtle borough labels */}
      {showLabels && (
        <g fontFamily='"Geist Mono", ui-monospace, monospace' fontSize="9" fill={stroke} letterSpacing="2">
          <text x="238" y="150" opacity="0.55">MANHATTAN</text>
          <text x="345" y="200" opacity="0.55">QUEENS</text>
          <text x="285" y="260" opacity="0.55">BROOKLYN</text>
          <text x="248" y="72" opacity="0.45">BRONX</text>
          <text x="160" y="295" opacity="0.4">STATEN IS.</text>
          <text x="155" y="140" opacity="0.35">NEW JERSEY</text>
        </g>
      )}

      {/* compass */}
      {!compact && (
        <g transform="translate(465,32)">
          <circle r="13" fill="none" stroke={stroke} strokeWidth="0.8"/>
          <path d="M0 -10 L3 0 L0 10 L-3 0 Z" fill={ink} opacity="0.65"/>
          <text y="-17" textAnchor="middle" fontFamily='"Geist Mono", monospace' fontSize="8" fill={ink} opacity="0.55">N</text>
        </g>
      )}

      {children}
    </svg>
  );
}

window.NYCMap = NYCMap;
