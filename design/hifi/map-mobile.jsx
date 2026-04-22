// Mobile · Map view · light (warm off-white)
// Matches the home-mono-v2 mobile style.
// Full-bleed map on top, draggable venue sheet on bottom.

const { SB, Icon, HIFI_KINDS, HIFI_MAP_PINS, HIFI_MAP_KINGS, NYCMap } = window;

const MM_MODE = 'light';
const MM_BG    = SB.bg[MM_MODE];
const MM_SURF  = SB.surface[MM_MODE];
const MM_SURF2 = SB.surface2[MM_MODE];
const MM_INK   = SB.ink[MM_MODE];
const MM_MUTED = SB.muted[MM_MODE];
const MM_FAINT = SB.faint[MM_MODE];
const MM_RULE  = SB.rule[MM_MODE];
const MM_RULE2 = SB.ruleStrong[MM_MODE];

const mmKind = (k) => window.kindInk(k, false);

const mDotR = (c) => Math.max(4, Math.min(16, 3 + c * 1.1));

function MPin({ pin, selected, onClick }) {
  const r = mDotR(pin.count);
  const kind = pin.kindMix[0] || 'concert';
  const color = mmKind(kind);
  return (
    <g style={{cursor:'pointer'}} onClick={onClick}>
      {pin.count >= 4 && (
        <circle cx={pin.x} cy={pin.y} r={r + 5} fill={color} opacity="0.15"/>
      )}
      <circle cx={pin.x} cy={pin.y} r={r} fill={color} opacity={selected ? 1 : 0.88}/>
      {pin.count >= 5 && (
        <text x={pin.x} y={pin.y + 3}
              textAnchor="middle"
              fontFamily='"Geist Mono", monospace' fontSize={r > 10 ? 10 : 9} fontWeight="600"
              fill={MM_BG}>
          {pin.count}
        </text>
      )}
      {selected && (
        <circle cx={pin.x} cy={pin.y} r={r + 4} fill="none" stroke={MM_INK} strokeWidth="1.5"/>
      )}
    </g>
  );
}

function MobileMap() {
  const [selectedId, setSelectedId] = React.useState('kings');
  const [kind, setKind] = React.useState('all');
  const pin = HIFI_MAP_PINS.find(p => p.id === selectedId);
  const shows = HIFI_MAP_KINGS;

  const filtered = HIFI_MAP_PINS.filter(p => kind === 'all' || p.kindMix.includes(kind));

  const KINDS = [
    {k:'all',     label:'all'},
    {k:'concert', label:'concert'},
    {k:'theatre',label:'theatre'},
    {k:'comedy',  label:'comedy'},
    {k:'festival',label:'festival'},
  ];

  return (
    <div style={{
      height:'100%', background:MM_BG, color:MM_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
      position:'relative',
    }}>
      {/* Header */}
      <div style={{padding:'62px 20px 14px', background:MM_BG, position:'relative', zIndex:3}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:MM_MUTED, letterSpacing:'.04em'}}>
            mon · 20 apr
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center', color:MM_INK}}>
            <Icon.Search size={18} color={MM_INK}/>
            <Icon.More size={18} color={MM_INK}/>
          </div>
        </div>
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          marginTop:14,
        }}>
          <div>
            <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:MM_INK, letterSpacing:-0.9, lineHeight:1}}>
              Map
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:MM_MUTED, letterSpacing:'.02em', marginTop:6}}>
              24 venues · 87 shows · nyc + 3
            </div>
          </div>
          <div style={{
            fontFamily:SB.mono, fontSize:10, color:MM_MUTED,
            letterSpacing:'.08em', textTransform:'uppercase',
            padding:'4px 8px', border:`1px solid ${MM_RULE2}`,
            display:'inline-flex', alignItems:'center', gap:5,
          }}>
            <Icon.MapPin size={11} color={MM_INK}/>
            NYC
          </div>
        </div>
      </div>

      {/* Kind filter strip */}
      <div style={{
        padding:'0 20px 12px',
        display:'flex', gap:6, overflowX:'auto',
        borderBottom:`1px solid ${MM_RULE}`,
        background:MM_BG, position:'relative', zIndex:3,
      }}>
        {KINDS.map(({k, label}) => {
          const active = k === kind;
          const color = k === 'all' ? MM_INK : mmKind(k);
          return (
            <button key={k} onClick={()=>setKind(k)} style={{
              padding:'6px 11px', flexShrink:0,
              border:`1px solid ${active ? color : MM_RULE2}`,
              background: active ? (k === 'all' ? MM_INK : 'transparent') : 'transparent',
              color: active ? (k === 'all' ? MM_BG : color) : MM_MUTED,
              fontFamily:SB.mono, fontSize:10, letterSpacing:'.06em', textTransform:'uppercase',
              fontWeight:500, cursor:'pointer',
              display:'inline-flex', alignItems:'center', gap:5,
            }}>
              {k !== 'all' && <span style={{width:5, height:5, borderRadius:999, background:color}}/>}
              {label}
            </button>
          );
        })}
      </div>

      {/* Map container — occupies whole remaining area; sheet overlays it */}
      <div style={{flex:1, position:'relative', background:MM_SURF2, minHeight:0, overflow:'hidden'}}>
        <NYCMap
          stroke={MM_RULE2}
          rule={MM_RULE}
          ink={MM_INK}
          bg={MM_SURF2}
        >
          <g fontFamily='"Geist", sans-serif' fontSize="9.5" fill={MM_INK}>
            {filtered.filter(p => p.count >= 6 || p.id === selectedId).map(p => {
              const r = mDotR(p.count);
              return (
                <text key={p.id + '-l'}
                  x={p.x + r + 5} y={p.y + 3.2}
                  fill={p.id === selectedId ? MM_INK : MM_MUTED}
                  fontWeight={p.id === selectedId ? 600 : 400}
                  letterSpacing="-0.1">
                  {p.label.toLowerCase()}
                </text>
              );
            })}
          </g>
          {filtered.map(p => (
            <MPin key={p.id} pin={p}
                  selected={p.id === selectedId}
                  onClick={()=>setSelectedId(p.id)}/>
          ))}
        </NYCMap>

        {/* mini legend top-left */}
        <div style={{
          position:'absolute', top:12, left:12,
          background:MM_SURF, border:`1px solid ${MM_RULE}`,
          padding:'7px 10px',
          fontFamily:SB.mono, fontSize:9.5, color:MM_MUTED,
          letterSpacing:'.04em',
          display:'flex', gap:8, alignItems:'center',
        }}>
          <span style={{fontFamily:SB.mono, fontSize:9, color:MM_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>size =</span>
          {[1,4,10].map(n => (
            <span key={n} style={{display:'inline-flex', alignItems:'center', gap:3}}>
              <span style={{width:mDotR(n)*2, height:mDotR(n)*2, borderRadius:999, background:SB.kinds.concert.ink, opacity:0.85}}/>
              <span>{n}</span>
            </span>
          ))}
        </div>

        {/* zoom controls top-right */}
        <div style={{
          position:'absolute', top:12, right:12,
          display:'flex', flexDirection:'column',
          background:MM_SURF, border:`1px solid ${MM_RULE}`,
        }}>
          {['＋','−'].map((t, i) => (
            <div key={t} style={{
              width:28, height:28,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:SB.mono, fontSize:14, color:MM_INK,
              borderBottom: i === 0 ? `1px solid ${MM_RULE}` : 'none',
              cursor:'pointer',
            }}>{t}</div>
          ))}
        </div>
      </div>

      {/* Bottom sheet · draggable inspector */}
      <div style={{
        position:'absolute', left:0, right:0, bottom:83,
        background:MM_SURF,
        borderTop:`1px solid ${MM_RULE2}`,
        boxShadow:'0 -12px 40px rgba(11,11,10,.08)',
        maxHeight:'56%',
        display:'flex', flexDirection:'column',
        zIndex:2,
      }}>
        {/* grabber */}
        <div style={{padding:'8px 0 2px', display:'flex', justifyContent:'center'}}>
          <div style={{width:36, height:4, borderRadius:2, background:MM_FAINT, opacity:.5}}/>
        </div>

        {/* venue header */}
        <div style={{padding:'6px 20px 14px', borderBottom:`1px solid ${MM_RULE}`}}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:6,
            fontFamily:SB.mono, fontSize:9.5, color:MM_FAINT,
            letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500,
            marginBottom:6,
          }}>
            <Icon.MapPin size={10} color={MM_FAINT}/>
            Selected
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:22, fontWeight:600, color:MM_INK,
            letterSpacing:-0.7, lineHeight:1.05,
          }}>{pin.label}</div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:4, gap:10}}>
            <div style={{fontFamily:SB.sans, fontSize:12, color:MM_MUTED}}>
              {pin.nbhd} · Brooklyn, NY
            </div>
            <button style={{
              padding:'5px 10px', background:'transparent',
              border:`1px solid ${SB.accent.light}`, color:SB.accent.light,
              fontFamily:SB.mono, fontSize:10, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
              display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer', flexShrink:0,
            }}>
              <Icon.Plus size={10} color={SB.accent.light}/> Follow
            </button>
          </div>

          {/* stat row */}
          <div style={{
            display:'grid', gridTemplateColumns:'1fr 1fr 1fr',
            marginTop:14, gap:0,
            border:`1px solid ${MM_RULE}`,
          }}>
            {[
              ['Shows', pin.count],
              ['Artists', new Set(shows.map(s=>s.artist)).size],
              ['Spent', '$'+shows.reduce((s,sh)=>s+(sh.paid||0),0)],
            ].map(([l, v], i) => (
              <div key={l} style={{
                padding:'10px 12px',
                borderLeft: i === 0 ? 'none' : `1px solid ${MM_RULE}`,
              }}>
                <div style={{fontFamily:SB.sans, fontSize:17, fontWeight:500, color:MM_INK, letterSpacing:-0.4, fontFeatureSettings:'"tnum"', lineHeight:1}}>
                  {v}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9, color:MM_MUTED, marginTop:4, letterSpacing:'.08em', textTransform:'uppercase'}}>
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* visits header */}
        <div style={{
          padding:'10px 20px 6px',
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
        }}>
          <div style={{
            fontFamily:SB.mono, fontSize:10.5, color:MM_INK,
            letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
          }}>All visits</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:MM_FAINT, letterSpacing:'.04em'}}>
            {shows.length} · since {shows[shows.length-1].d.y}
          </div>
        </div>

        {/* scrollable list */}
        <div style={{overflow:'auto', flex:1}}>
          {shows.slice(0, 6).map((s, i) => (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'52px 1fr auto',
              columnGap:12, padding:'11px 20px',
              borderTop:`1px solid ${MM_RULE}`,
              alignItems:'center',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:13.5, color:MM_INK, fontWeight:500, letterSpacing:-0.3, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                  {s.d.m} {s.d.day}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:MM_FAINT, marginTop:3, letterSpacing:'.04em'}}>
                  {s.d.y}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:13, fontWeight:500, color:MM_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {s.artist}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:MM_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                  {s.seat.toLowerCase()}
                </div>
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:MM_MUTED, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                ${s.paid}
              </div>
            </div>
          ))}
          <div style={{
            padding:'10px 20px', borderTop:`1px solid ${MM_RULE2}`,
            fontFamily:SB.mono, fontSize:10, color:MM_MUTED, letterSpacing:'.06em', textTransform:'uppercase',
            display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <span>+ {shows.length - 6} more</span>
            <Icon.ArrowRight size={12} color={MM_MUTED}/>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        display:'flex', borderTop:`1px solid ${MM_RULE2}`, background:MM_BG,
        padding:'12px 8px 30px', alignItems:'center', zIndex:3,
      }}>
        {[
          { key:'home',  label:'Home',  Icon:Icon.Home,    active:false },
          { key:'past',  label:'Past',  Icon:Icon.Archive, active:false },
          { key:'add',   label:'Add',   Icon:Icon.Plus,    cta:true },
          { key:'map',   label:'Map',   Icon:Icon.Map,     active:true },
          { key:'me',    label:'Me',    Icon:Icon.User,    active:false },
        ].map(({key, label, Icon:Ic, active, cta})=>(
          <div key={key} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta ? 34 : 26, height: cta ? 34 : 26,
              background: cta ? MM_INK : 'transparent',
              color: cta ? MM_BG : (active ? MM_INK : MM_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta ? 999 : 0,
            }}>
              <Ic size={cta ? 20 : 18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active ? MM_INK : MM_MUTED, fontWeight: active ? 500 : 400,
              textTransform:'lowercase',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.MobileMap = MobileMap;
