// Music layer visuals — Spotify-derived components woven through the show page.
// Each component is small + composable so it slots into Overview / Setlist tabs
// across every viewport. Reads SB tokens + ST_TOKENS via window.

const ML = (() => {
  const { SB } = window;
  const M = 'dark';
  return {
    BG: SB.bg[M], SURF: SB.surface[M], SURF2: SB.surface2[M],
    INK: SB.ink[M], MUTED: SB.muted[M], FAINT: SB.faint[M],
    RULE: SB.rule[M], RULE2: SB.ruleStrong[M],
    ACCENT: SB.accent.dark, ACCENT_TEXT: SB.accent.text,
    SPOT: '#1DB954',
  };
})();

// ─────────────────────────────────────────── Vibe radar (7-axis) ──
// SVG, sized via prop. axes order: energy → acoustic → happiness →
// danceability → instrumental → live → speech (clockwise from top).
function VibeRadar({ size = 200, profile, label, compact = false }) {
  const { INK, MUTED, FAINT, ACCENT, RULE, RULE2 } = ML;
  const cx = size/2, cy = size/2;
  const r  = size * 0.36;
  const axes = [
    { key:'energy',       short:'ENG' },
    { key:'acoustic',     short:'ACO' },
    { key:'happiness',    short:'HAP' },
    { key:'danceability', short:'DNC' },
    { key:'instrumental', short:'INS' },
    { key:'live',         short:'LIV' },
    { key:'speech',       short:'SPC' },
  ];
  const N = axes.length;
  const pt = (i, mag) => {
    const a = (Math.PI*2*i)/N - Math.PI/2;
    return [ cx + Math.cos(a)*r*mag, cy + Math.sin(a)*r*mag ];
  };
  const poly = axes.map((ax,i)=>pt(i, profile[ax.key])).map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* concentric rings */}
        {[0.25, 0.5, 0.75, 1].map((m,i)=>(
          <polygon key={m} points={axes.map((_,j)=>pt(j,m).map(n=>n.toFixed(1)).join(',')).join(' ')}
            fill="none" stroke={i===3?RULE2:RULE} strokeWidth="1"/>
        ))}
        {/* axes */}
        {axes.map((ax,i)=>{
          const [x,y] = pt(i,1);
          return <line key={ax.key} x1={cx} y1={cy} x2={x} y2={y} stroke={RULE} strokeWidth="1"/>;
        })}
        {/* shape */}
        <polygon points={poly} fill={ACCENT+'2A'} stroke={ACCENT} strokeWidth="1.5"/>
        {/* dots */}
        {axes.map((ax,i)=>{
          const [x,y] = pt(i, profile[ax.key]);
          return <circle key={ax.key} cx={x} cy={y} r="2.4" fill={ACCENT}/>;
        })}
        {/* labels */}
        {axes.map((ax,i)=>{
          const [x,y] = pt(i, 1.18);
          return <text key={ax.key} x={x} y={y} fill={FAINT}
            fontFamily="Geist Mono, ui-monospace, monospace" fontSize={size<160?7.5:8.5}
            textAnchor="middle" dominantBaseline="middle" letterSpacing="1">{ax.short}</text>;
        })}
      </svg>
      {label && (
        <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:11, color:INK, letterSpacing:'.04em', textAlign:'center', maxWidth:size+40 }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── Energy arc (sparkline) ──
function EnergyArc({ values, encoreStart, width = 560, height = 88, axis = 'energy' }) {
  const { INK, MUTED, FAINT, ACCENT, RULE, RULE2, SURF } = ML;
  const padX = 14, padTop = 10, padBot = 22;
  const innerW = width - padX*2;
  const innerH = height - padTop - padBot;
  const N = values.length;
  const barW = (innerW / N) * 0.78;
  const gap  = (innerW / N) * 0.22;
  const max = 1;
  return (
    <div style={{ width, background:SURF, padding:'12px 14px 14px', border:`1px solid ${RULE}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <span style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>energy arc</span>
        <span style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10, color:MUTED, letterSpacing:'.04em' }}>tap to flip · happiness · danceability</span>
      </div>
      <svg width={width-28} height={height} viewBox={`0 0 ${width-28} ${height}`} style={{ display:'block' }}>
        {/* baseline */}
        <line x1={0} y1={padTop+innerH} x2={innerW} y2={padTop+innerH} stroke={RULE} strokeWidth="1"/>
        {values.map((v,i)=>{
          const h = (v/max) * innerH;
          const x = i * (barW + gap);
          const y = padTop + innerH - h;
          const isEncore = encoreStart != null && i >= encoreStart;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill={isEncore ? ACCENT : INK}/>
              <text x={x + barW/2} y={padTop+innerH+12} fill={FAINT}
                fontFamily="Geist Mono, ui-monospace, monospace" fontSize={8}
                textAnchor="middle">
                {isEncore ? 'E' : (i+1)}
              </text>
            </g>
          );
        })}
        {/* encore divider */}
        {encoreStart != null && (
          <line x1={encoreStart*(barW+gap)-gap/2} y1={padTop-2} x2={encoreStart*(barW+gap)-gap/2} y2={padTop+innerH+4}
            stroke={ACCENT} strokeDasharray="2 3" strokeWidth="1"/>
        )}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────── Hype playlist hero card ──
// Replaces the inline button on Setlist tab — gives the playlist its own
// editorial space with the branded cover and a "X songs · X min" stat.
function HypePlaylistCard({ artist = 'No Doubt', count = 14, mins = 92, compact = false }) {
  const { INK, MUTED, FAINT, ACCENT, ACCENT_TEXT, SURF, RULE, SPOT } = ML;
  return (
    <div style={{ display:'flex', gap:14, padding: compact? '14px':'18px', background:SURF, border:`1px solid ${RULE}` }}>
      {/* Editorial cover — branded card */}
      <div style={{
        width: compact?72:96, height: compact?72:96, flexShrink:0,
        background:'#0A0A0A', position:'relative', overflow:'hidden',
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        padding: compact?'8px':'10px',
        boxShadow:'inset 0 0 0 1px #ffffff10',
      }}>
        <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize: compact?8:9, color:ACCENT, letterSpacing:'.18em' }}>SHOWBOOK</div>
        <div style={{ fontFamily:'Geist, sans-serif', fontSize: compact?14:18, color:'#FAFAF8', fontWeight:600, letterSpacing:-0.4, lineHeight:.95 }}>
          hype<br/>{artist.toLowerCase().split(' ')[0]}
        </div>
        <div style={{ width:14, height:2, background:ACCENT }}/>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between', minWidth:0 }}>
        <div>
          <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>hype playlist</div>
          <div style={{ fontFamily:'Geist, sans-serif', fontSize: compact?15:17, color:INK, fontWeight:600, letterSpacing:-0.3, marginTop:3 }}>
            Spin up {count} songs you'll hear
          </div>
          <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10.5, color:MUTED, marginTop:4, letterSpacing:'.02em' }}>
            ~{mins} min · ordered like the show · drops onto your Spotify
          </div>
        </div>
        <div style={{ display:'flex', gap:6, marginTop:10 }}>
          <div style={{ padding:'8px 12px', background:ACCENT, color:ACCENT_TEXT, fontFamily:'Geist, sans-serif', fontSize:12.5, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer' }}>
            <SpotifyGlyph size={12} color={ACCENT_TEXT}/> Open in Spotify
          </div>
          <div style={{ padding:'8px 10px', border:`1px solid ${ML.RULE2}`, color:INK, fontFamily:'Geist, sans-serif', fontSize:12.5, cursor:'pointer' }}>
            Preview here
          </div>
        </div>
      </div>
    </div>
  );
}

function SpotifyGlyph({ size=14, color='#0A0A0A' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7.5" fill={color} fillOpacity="0.001" stroke={color} strokeOpacity=".25"/>
      <path d="M3.6 6.4 c2.4-.8 6.4-.6 8.8.8 M4 8.4 c2-.6 5.4-.4 7.4.8 M4.4 10.4 c1.8-.5 4.4-.3 6 .6"
        stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// ─────────────────────────────────────────── Track preview button (▶) ──
function TrackPreview({ playing = false, color }) {
  const { INK, MUTED, FAINT, ACCENT } = ML;
  const c = color || INK;
  return (
    <span style={{
      width:24, height:24, border:`1px solid ${ML.RULE2}`, borderRadius:999,
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      flexShrink:0,
    }}>
      {playing ? (
        <span style={{ display:'inline-flex', gap:1.5, alignItems:'flex-end' }}>
          <span style={{ width:1.5, height:6, background:ACCENT, animation:'mlbar 1s infinite' }}/>
          <span style={{ width:1.5, height:9, background:ACCENT, animation:'mlbar 1s infinite .2s' }}/>
          <span style={{ width:1.5, height:5, background:ACCENT, animation:'mlbar 1s infinite .4s' }}/>
        </span>
      ) : (
        <svg width={9} height={9} viewBox="0 0 9 9"><path d="M1 0.5 L8 4.5 L1 8.5 Z" fill={c}/></svg>
      )}
    </span>
  );
}

// ─────────────────────────────────────────── Discovered-live rail ──
function DiscoveredRail({ tracks, compact = false }) {
  const { INK, MUTED, FAINT, ACCENT, SURF, RULE } = ML;
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:0 }}>
      {tracks.map((t,i)=>(
        <div key={t.title} style={{
          padding: compact?'12px 14px':'14px 16px',
          background: SURF,
          borderTop: i===0 ? `1px solid ${RULE}` : 'none',
          borderBottom: `1px solid ${RULE}`,
          display:'grid', gridTemplateColumns:'auto 1fr auto auto', columnGap:12, alignItems:'center',
        }}>
          <TrackPreview/>
          <div style={{ minWidth:0 }}>
            <div style={{ fontFamily:'Geist, sans-serif', fontSize: compact?13.5:14.5, color:INK, fontWeight:500, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</div>
            <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10, color:MUTED, marginTop:2, letterSpacing:'.02em' }}>
              {t.artist} · {t.year}
            </div>
          </div>
          <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>{t.length}</div>
          <div style={{ padding:'5px 10px', border:`1px solid ${ML.RULE2}`, fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10, color:INK, letterSpacing:'.04em', cursor:'pointer' }}>
            + save
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────── Fan loyalty ring ──
function FanLoyaltyRing({ pct = 67, total = 18, size = 92 }) {
  const { INK, MUTED, FAINT, ACCENT, RULE2 } = ML;
  const r = size/2 - 6;
  const c = 2 * Math.PI * r;
  const filled = (pct/100) * c;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={RULE2} strokeWidth="3"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={ACCENT} strokeWidth="3"
          strokeDasharray={`${filled} ${c-filled}`} strokeDashoffset={c/4}
          transform={`rotate(-90 ${size/2} ${size/2})`} strokeLinecap="square"/>
        <text x={size/2} y={size/2+1} fill={INK} fontFamily="Geist, sans-serif" fontSize={size*0.32} fontWeight="500"
          textAnchor="middle" dominantBaseline="middle" letterSpacing="-1">{pct}<tspan fontSize={size*0.16} fill={MUTED}>%</tspan></text>
      </svg>
      <div>
        <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>fan loyalty</div>
        <div style={{ fontFamily:'Geist, sans-serif', fontSize:14, color:INK, marginTop:4, letterSpacing:-0.2 }}>
          {Math.round(total*pct/100)} of {total} songs
        </div>
        <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.02em' }}>
          in your library before walking in
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── Pre-show priming italics ──
function PrimingStat({ text, padX = 32, dim = false }) {
  const { MUTED, FAINT } = ML;
  return (
    <div style={{
      padding: `8px ${padX}px 16px`, fontFamily:'Geist, sans-serif', fontSize:13,
      color: dim ? FAINT : MUTED, fontStyle:'italic', letterSpacing:-0.1,
    }}>{text}</div>
  );
}

// ─────────────────────────────────────────── Spotify-follow rail (Discover) ──
function SpotifyFollowRail({ artists, compact = false }) {
  const { INK, MUTED, FAINT, ACCENT, SURF, RULE, SPOT } = ML;
  return (
    <div style={{ display:'grid', gridAutoFlow:'column', gridAutoColumns: compact?'160px':'180px', gap:10, overflowX:'auto', padding:'4px 0' }}>
      {artists.map(a=>(
        <div key={a.name} style={{ background:SURF, border:`1px solid ${RULE}`, padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ width:48, height:48, borderRadius:999, background:`linear-gradient(135deg, ${a.c1}, ${a.c2})`, position:'relative' }}>
            <SpotifyGlyph size={12} color="#0A0A0A"/>
            <span style={{ position:'absolute', right:-4, bottom:-4, width:18, height:18, borderRadius:999, background:SPOT, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 0 2px ${SURF}` }}>
              <SpotifyGlyph size={10} color="#0A0A0A"/>
            </span>
          </div>
          <div style={{ fontFamily:'Geist, sans-serif', fontSize:13.5, color:INK, fontWeight:500, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</div>
          <div style={{ fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:9.5, color:FAINT, letterSpacing:'.04em' }}>{a.tag}</div>
          <div style={{ marginTop:'auto', padding:'5px 10px', border:`1px solid ${ML.RULE2}`, fontFamily:'Geist Mono, ui-monospace, monospace', fontSize:10, color:INK, letterSpacing:'.08em', textAlign:'center', cursor:'pointer' }}>
            FOLLOW
          </div>
        </div>
      ))}
    </div>
  );
}

// Animation keyframes for the playing waveform
const __ml_kf = `@keyframes mlbar { 0%,100%{transform:scaleY(.45)} 50%{transform:scaleY(1)} }`;
if (typeof document !== 'undefined' && !document.getElementById('ml-kf')) {
  const s = document.createElement('style'); s.id='ml-kf'; s.textContent=__ml_kf; document.head.appendChild(s);
}

Object.assign(window, {
  VibeRadar, EnergyArc, HypePlaylistCard, TrackPreview,
  DiscoveredRail, FanLoyaltyRing, PrimingStat, SpotifyFollowRail, SpotifyGlyph,
  ML_TOKENS: ML,
});
