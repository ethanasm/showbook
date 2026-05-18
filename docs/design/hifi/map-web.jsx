// Web · Map view · dark
// Same shell as web-home: sidebar + top bar + filter bar.
// Main: full-bleed NYC map on the left, venue inspector on the right.

const { SB, Icon, HIFI_KINDS, HIFI_MAP_PINS, HIFI_MAP_KINGS, HIFI_MAP_TOTALS, NYCMap } = window;

const MW_MODE = 'dark';
const MW_BG    = SB.bg[MW_MODE];
const MW_SURF  = SB.surface[MW_MODE];
const MW_SURF2 = SB.surface2[MW_MODE];
const MW_INK   = SB.ink[MW_MODE];
const MW_MUTED = SB.muted[MW_MODE];
const MW_FAINT = SB.faint[MW_MODE];
const MW_RULE  = SB.rule[MW_MODE];
const MW_RULE2 = SB.ruleStrong[MW_MODE];

const mwKind = (k) => window.kindInk(k, true);

// Dot radius scale — counts range 1..12.
const dotR = (c) => Math.max(4, Math.min(18, 3 + c * 1.2));

// ─── Sidebar (duplicated from web-home, map active) ────────────────
function MapSidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive,  count:'87' },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'4' },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'48' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'24' },
    { key:'map',    label:'Map',       Icon:Icon.Map,      active:true },
  ];
  return (
    <div style={{
      width:224, background:MW_BG, borderRight:`1px solid ${MW_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
    }}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:MW_INK, letterSpacing:-0.5}}>
          showbook
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:MW_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v · 2026.04
        </div>
      </div>

      <div style={{padding:'0 16px 20px'}}>
        <button style={{
          width:'100%', padding:'9px 12px', background:MW_INK, color:MW_BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={MW_BG}/> Add a show
        </button>
        <div style={{
          marginTop:8, padding:'6px 10px', background:MW_SURF, border:`1px solid ${MW_RULE}`,
          display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:11, color:MW_MUTED,
        }}>
          <Icon.Search size={13} color={MW_MUTED}/>
          <span>search venues…</span>
          <span style={{flex:1}}/>
          <span style={{padding:'1px 6px', fontSize:9.5, border:`1px solid ${MW_RULE2}`, color:MW_MUTED}}>⌘K</span>
        </div>
      </div>

      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:MW_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Navigate
        </div>
        {items.map(({key, label, Icon:Ic, active, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'7px 12px', margin:'1px 0',
            background: active ? MW_SURF : 'transparent',
            color: active ? MW_INK : MW_MUTED,
            fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
            letterSpacing:-0.1, cursor:'pointer',
            borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
          }}>
            <Ic size={15} color={active ? MW_INK : MW_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && <span style={{fontFamily:SB.mono, fontSize:11, color:MW_FAINT}}>{count}</span>}
          </div>
        ))}

        <div style={{padding:'18px 12px 8px', fontFamily:SB.mono, fontSize:10, color:MW_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Kind
        </div>
        {Object.entries(HIFI_KINDS).map(([key, k])=>{
          const KIc = window.KindIcon[key];
          return (
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'6px 12px', margin:'1px 0',
            color:MW_MUTED, fontFamily:SB.sans, fontSize:13, cursor:'pointer',
          }}>
            <KIc size={13} color={mwKind(key)}/>
            <span style={{flex:1}}>{k.label}</span>
          </div>
        );})}
      </div>

      <div style={{padding:'14px 16px', borderTop:`1px solid ${MW_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{
          width:28, height:28, borderRadius:999, background:MW_SURF2, color:MW_INK,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:12, fontWeight:500,
        }}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:MW_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:MW_FAINT, marginTop:1}}>synced 3m ago</div>
        </div>
        <Icon.More size={14} color={MW_MUTED}/>
      </div>
    </div>
  );
}

// ─── Map pin ──────────────────────────────────────────────────────
function Pin({ pin, onClick, selected }) {
  const r = dotR(pin.count);
  const kind = pin.kindMix[0] || 'concert';
  const color = mwKind(kind);
  return (
    <g style={{cursor:'pointer'}} onClick={onClick}>
      {/* Halo for larger pins */}
      {pin.count >= 4 && (
        <circle cx={pin.x} cy={pin.y} r={r + 6} fill={color} opacity="0.12"/>
      )}
      <circle cx={pin.x} cy={pin.y} r={r} fill={color} opacity={selected ? 1 : 0.85}/>
      {/* Count label for big pins */}
      {pin.count >= 4 && (
        <text x={pin.x} y={pin.y + 3}
              textAnchor="middle"
              fontFamily='"Geist Mono", monospace' fontSize={r > 10 ? 10 : 9} fontWeight="600"
              fill={MW_BG}>
          {pin.count}
        </text>
      )}
      {/* Selected ring */}
      {selected && (
        <circle cx={pin.x} cy={pin.y} r={r + 4} fill="none" stroke={MW_INK} strokeWidth="1.5"/>
      )}
    </g>
  );
}

// ─── Map shell ────────────────────────────────────────────────────
function MapPanel({ selectedId, setSelectedId, kindFilter, yearFilter }) {
  const filtered = HIFI_MAP_PINS.filter(p => {
    if (kindFilter === 'all') return true;
    return p.kindMix.includes(kindFilter);
  });

  return (
    <div style={{
      position:'relative', flex:1, background:MW_BG, overflow:'hidden',
    }}>
      <NYCMap
        stroke={MW_RULE2}
        rule={MW_RULE}
        ink={MW_INK}
        bg={MW_BG}
      >
        {/* Pin labels */}
        <g fontFamily='"Geist", sans-serif' fontSize="10.5" fill={MW_INK}>
          {filtered.filter(p => p.count >= 5 || p.id === selectedId).map(p => {
            const r = dotR(p.count);
            return (
              <text key={p.id + '-l'}
                x={p.x + r + 6} y={p.y + 3.5}
                fill={p.id === selectedId ? MW_INK : MW_MUTED}
                fontWeight={p.id === selectedId ? 600 : 400}
                letterSpacing="-0.1">
                {p.label.toLowerCase()}
              </text>
            );
          })}
        </g>
        {filtered.map(p => (
          <Pin key={p.id} pin={p}
               selected={p.id === selectedId}
               onClick={()=>setSelectedId(p.id)}/>
        ))}
      </NYCMap>

      {/* overlay: legend bottom-left */}
      <div style={{
        position:'absolute', bottom:20, left:20,
        background:MW_SURF, border:`1px solid ${MW_RULE}`,
        padding:'12px 14px', minWidth:220,
      }}>
        <div style={{
          fontFamily:SB.mono, fontSize:9.5, color:MW_FAINT,
          letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, marginBottom:10,
        }}>dot size · # of shows</div>
        <div style={{display:'flex', gap:12, alignItems:'flex-end'}}>
          {[1,3,6,12].map(n => (
            <div key={n} style={{display:'flex', flexDirection:'column', alignItems:'center', gap:6}}>
              <div style={{
                width: dotR(n) * 2, height: dotR(n) * 2, borderRadius:999,
                background: SB.kinds.concert.inkDark, opacity:0.85,
              }}/>
              <div style={{fontFamily:SB.mono, fontSize:10, color:MW_MUTED, letterSpacing:'.04em'}}>{n}</div>
            </div>
          ))}
        </div>
      </div>

      {/* overlay: view toggle bottom-right */}
      <div style={{
        position:'absolute', bottom:20, right:20,
        background:MW_SURF, border:`1px solid ${MW_RULE}`, display:'flex',
      }}>
        {['NYC','North-east','World'].map((t,i)=>(
          <div key={t} style={{
            padding:'8px 14px',
            background: i===0 ? MW_INK : 'transparent',
            color: i===0 ? MW_BG : MW_MUTED,
            fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em', textTransform:'uppercase',
            fontWeight: i===0 ? 500 : 400,
            borderRight: i === 2 ? 'none' : `1px solid ${MW_RULE2}`,
            cursor:'pointer',
          }}>{t}</div>
        ))}
      </div>

      {/* overlay: summary top-right */}
      <div style={{
        position:'absolute', top:20, right:20,
        background:MW_SURF, border:`1px solid ${MW_RULE}`,
        padding:'10px 14px', display:'flex', gap:18, alignItems:'center',
      }}>
        <div>
          <div style={{fontFamily:SB.sans, fontSize:20, color:MW_INK, fontWeight:500, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>
            {filtered.length}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:MW_MUTED, marginTop:4, letterSpacing:'.08em', textTransform:'uppercase'}}>venues</div>
        </div>
        <div style={{width:1, height:24, background:MW_RULE}}/>
        <div>
          <div style={{fontFamily:SB.sans, fontSize:20, color:MW_INK, fontWeight:500, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>
            {filtered.reduce((s,p)=>s+p.count,0)}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:MW_MUTED, marginTop:4, letterSpacing:'.08em', textTransform:'uppercase'}}>shows</div>
        </div>
      </div>
    </div>
  );
}

// ─── Inspector (right panel) ──────────────────────────────────────
function Inspector({ pin, shows }) {
  if (!pin) return null;
  const kindCounts = shows.reduce((acc, s) => {
    acc[s.kind] = (acc[s.kind] || 0) + 1;
    return acc;
  }, {});
  const firstShow = shows[shows.length - 1];
  const totalPaid = shows.reduce((s, sh) => s + (sh.paid || 0), 0);

  return (
    <div style={{
      width:400, background:MW_SURF, borderLeft:`1px solid ${MW_RULE}`,
      display:'flex', flexDirection:'column', minHeight:0,
    }}>
      {/* header */}
      <div style={{padding:'20px 24px', borderBottom:`1px solid ${MW_RULE}`}}>
        <div style={{
          display:'flex', alignItems:'center', gap:8, marginBottom:10,
          fontFamily:SB.mono, fontSize:10, color:MW_FAINT,
          letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500,
        }}>
          <Icon.MapPin size={11} color={MW_FAINT}/>
          Selected venue
        </div>
        <div style={{
          fontFamily:SB.sans, fontSize:30, fontWeight:600, color:MW_INK,
          letterSpacing:-1.1, lineHeight:1,
        }}>{pin.label}</div>
        <div style={{
          fontFamily:SB.sans, fontSize:13, color:MW_MUTED,
          marginTop:8, letterSpacing:-0.1,
        }}>
          {pin.nbhd} · Brooklyn, NY
        </div>
        <div style={{
          fontFamily:SB.mono, fontSize:10.5, color:MW_FAINT,
          marginTop:4, letterSpacing:'.04em',
        }}>
          40.6497° N · 73.9600° W
        </div>
      </div>

      {/* stats strip */}
      <div style={{
        display:'grid', gridTemplateColumns:'1fr 1fr 1fr',
        borderBottom:`1px solid ${MW_RULE}`,
      }}>
        {[
          ['Shows', pin.count, 'since ' + firstShow.d.y],
          ['Artists', new Set(shows.map(s=>s.artist)).size, 'unique'],
          ['Spent', '$'+totalPaid.toLocaleString(), 'lifetime'],
        ].map(([l, v, sub], i) => (
          <div key={l} style={{
            padding:'16px 18px',
            borderLeft: i === 0 ? 'none' : `1px solid ${MW_RULE}`,
          }}>
            <div style={{
              fontFamily:SB.sans, fontSize:22, fontWeight:500, color:MW_INK,
              letterSpacing:-0.7, fontFeatureSettings:'"tnum"', lineHeight:1,
            }}>{v}</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:MW_MUTED, marginTop:6, letterSpacing:'.08em', textTransform:'uppercase'}}>
              {l}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:MW_FAINT, marginTop:2, letterSpacing:'.02em'}}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      {/* kind mix chips */}
      <div style={{padding:'14px 24px', borderBottom:`1px solid ${MW_RULE}`, display:'flex', gap:10, alignItems:'center'}}>
        <div style={{fontFamily:SB.mono, fontSize:10, color:MW_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Kind mix
        </div>
        {Object.entries(kindCounts).map(([k, c]) => {
          const KIc = window.KindIcon[k];
          return (
          <div key={k} style={{
            display:'inline-flex', alignItems:'center', gap:6,
            fontFamily:SB.mono, fontSize:10.5, color:mwKind(k),
            letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          }}>
            <KIc size={12} color={mwKind(k)}/>
            {HIFI_KINDS[k].label} · {c}
          </div>
        );})}
      </div>

      {/* visits list */}
      <div style={{
        padding:'12px 24px 8px', display:'flex', alignItems:'baseline', justifyContent:'space-between',
      }}>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:MW_INK,
          letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
        }}>All visits</div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:MW_MUTED, letterSpacing:'.04em'}}>
          {shows.length} · newest first
        </div>
      </div>
      <div style={{flex:1, overflow:'auto'}}>
        {shows.map((s, i) => (
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'62px 1fr auto',
            columnGap:14, padding:'12px 24px',
            borderTop: i === 0 ? `1px solid ${MW_RULE}` : `1px solid ${MW_RULE}`,
            alignItems:'center',
          }}>
            <div>
              <div style={{fontFamily:SB.sans, fontSize:15, color:MW_INK, fontWeight:500, letterSpacing:-0.3, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                {s.d.m} {s.d.day}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:MW_FAINT, marginTop:3, letterSpacing:'.04em'}}>
                {s.d.y}
              </div>
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:13.5, fontWeight:500, color:MW_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {s.artist}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:MW_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                {s.seat.toLowerCase()}
              </div>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:MW_MUTED, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
              ${s.paid}
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div style={{
        padding:'14px 24px', borderTop:`1px solid ${MW_RULE2}`,
        display:'flex', gap:10,
      }}>
        <button style={{
          padding:'10px 12px', background:'transparent',
          border:`1px solid ${SB.accent.dark}`, color:SB.accent.dark,
          fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={13} color={SB.accent.dark}/> Follow
        </button>
        <button style={{
          flex:1, padding:'10px 12px', background:'transparent',
          border:`1px solid ${MW_RULE2}`, color:MW_INK,
          fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Eye size={13} color={MW_INK}/> Watch upcoming
        </button>
        <button style={{
          flex:1, padding:'10px 12px', background:MW_INK, color:MW_BG,
          border:'none',
          fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={13} color={MW_BG}/> Log a visit
        </button>
      </div>
    </div>
  );
}

// ─── Top filter bar ───────────────────────────────────────────────
function MapFilterBar({ kind, setKind, year, setYear }) {
  const YEARS = ['All-time','2026','2025','2024','2023'];
  const KINDS = [
    {k:'all',     label:'All kinds'},
    {k:'concert', label:'Concert'},
    {k:'theatre',label:'Theatre'},
    {k:'comedy',  label:'Comedy'},
    {k:'festival',label:'Festival'},
  ];
  return (
    <div style={{
      padding:'14px 32px', background:MW_SURF,
      borderBottom:`1px solid ${MW_RULE}`,
      display:'flex', alignItems:'center', gap:24,
    }}>
      <div style={{display:'flex', flexDirection:'column', gap:2}}>
        <div style={{fontFamily:SB.mono, fontSize:9.5, color:MW_FAINT, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
          Viewing
        </div>
        <div style={{fontFamily:SB.sans, fontSize:13, color:MW_MUTED, letterSpacing:-0.1}}>
          All shows on the map
        </div>
      </div>

      <div style={{display:'flex', alignItems:'stretch', border:`1px solid ${MW_RULE2}`, background:MW_BG}}>
        {YEARS.map((t, i) => {
          const active = t === year;
          return (
            <button key={t} onClick={()=>setYear(t)} style={{
              padding:'9px 16px',
              border:'none',
              borderRight: i === YEARS.length-1 ? 'none' : `1px solid ${MW_RULE2}`,
              background: active ? MW_INK : 'transparent',
              color: active ? MW_BG : MW_INK,
              fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 600 : 500,
              letterSpacing:-0.2, cursor:'pointer', fontFeatureSettings:'"tnum"',
            }}>{t}</button>
          );
        })}
      </div>

      <div style={{display:'flex', gap:6, alignItems:'center'}}>
        {KINDS.map(({k, label}) => {
          const active = k === kind;
          const color = k === 'all' ? MW_INK : mwKind(k);
          const KIc = k !== 'all' ? window.KindIcon[k] : null;
          return (
            <button key={k} onClick={()=>setKind(k)} style={{
              padding:'6px 11px',
              border:`1px solid ${active ? color : MW_RULE2}`,
              background: active ? (k === 'all' ? MW_INK : 'transparent') : 'transparent',
              color: active ? (k === 'all' ? MW_BG : color) : MW_MUTED,
              fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em', textTransform:'uppercase',
              fontWeight:500, cursor:'pointer',
              display:'inline-flex', alignItems:'center', gap:7,
            }}>
              {KIc && <KIc size={12} color={active ? color : MW_MUTED}/>}
              {label}
            </button>
          );
        })}
      </div>

      <div style={{flex:1}}/>

      <div style={{display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:10.5, color:MW_MUTED, letterSpacing:'.04em'}}>
        <Icon.Filter size={12} color={MW_MUTED}/>
        <span>{HIFI_MAP_TOTALS.venues} venues · {HIFI_MAP_TOTALS.shows} shows · {HIFI_MAP_TOTALS.cities} cities</span>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────
function MapWeb() {
  const [selectedId, setSelectedId] = React.useState('kings');
  const [kind, setKind] = React.useState('all');
  const [year, setYear] = React.useState('All-time');
  const pin = HIFI_MAP_PINS.find(p => p.id === selectedId);

  return (
    <div style={{
      width:'100%', height:'100%', background:MW_BG, color:MW_INK,
      display:'flex', fontFamily:SB.sans, overflow:'hidden', WebkitFontSmoothing:'antialiased',
    }}>
      <window.V2Sidebar active="map"/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar */}
        <div style={{
          padding:'14px 32px', display:'flex', alignItems:'center',
          justifyContent:'space-between', borderBottom:`1px solid ${MW_RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:MW_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              Map · geographic view
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:MW_INK, letterSpacing:-0.7, marginTop:3}}>
              Where you've been
            </div>
          </div>
          <div style={{display:'flex', gap:10, alignItems:'center'}}>
            <button style={{
              padding:'8px 12px', background:'transparent', border:`1px solid ${MW_RULE2}`,
              color:MW_INK, fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase',
              display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
            }}>
              <Icon.ArrowUpRight size={12} color={MW_INK}/> Export
            </button>
            <button style={{
              padding:'8px 12px', background:MW_INK, border:'none', color:MW_BG,
              fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
              display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
            }}>
              <Icon.Plus size={12} color={MW_BG}/> Add a show
            </button>
          </div>
        </div>

        <MapFilterBar kind={kind} setKind={setKind} year={year} setYear={setYear}/>

        <div style={{flex:1, display:'flex', minHeight:0}}>
          <MapPanel selectedId={selectedId} setSelectedId={setSelectedId} kindFilter={kind} yearFilter={year}/>
          <Inspector pin={pin} shows={HIFI_MAP_KINGS}/>
        </div>
      </div>
    </div>
  );
}

window.MapWeb = MapWeb;
