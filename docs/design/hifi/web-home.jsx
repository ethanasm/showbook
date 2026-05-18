// Web · full-screen dashboard · dark
// Dense, data-forward. Sidebar nav + 3-column content:
//   [1] Upcoming queue (wide)  [2] Past log (tall)  [3] Rhythm + map + leaderboard
// 1440 × 900 frame.

const { SB, Icon, HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_RHYTHM, HIFI_TOTALS } = window;

const W_MODE = 'dark';
const W_BG    = SB.bg[W_MODE];
const W_SURF  = SB.surface[W_MODE];
const W_SURF2 = SB.surface2[W_MODE];
const W_INK   = SB.ink[W_MODE];
const W_MUTED = SB.muted[W_MODE];
const W_FAINT = SB.faint[W_MODE];
const W_RULE  = SB.rule[W_MODE];
const W_RULE2 = SB.ruleStrong[W_MODE];

const wKind = (k) => window.kindInk(k, true);

// ─── Sidebar ────────────────────────────────────────────────────────────
function Sidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home,     active:true },
    { key:'past',   label:'Archive',   Icon:Icon.Archive,  count:'87' },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'4' },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'22' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'9' },
    { key:'map',    label:'Map',       Icon:Icon.Map },
  ];
  return (
    <div style={{
      width:224, background:W_BG, borderRight:`1px solid ${W_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0',
      flexShrink:0,
    }}>
      {/* Logo */}
      <div style={{padding:'0 20px 24px'}}>
        <div style={{
          fontFamily:SB.sans, fontSize:19, fontWeight:600, color:W_INK,
          letterSpacing:-0.5,
        }}>
          showbook
          <span style={{color:W_FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{
          fontFamily:SB.mono, fontSize:10, color:W_MUTED,
          letterSpacing:'.08em', textTransform:'uppercase', marginTop:3,
        }}>v · 2026.04</div>
      </div>

      {/* Add CTA */}
      <div style={{padding:'0 16px 20px'}}>
        <button style={{
          width:'100%', padding:'9px 12px', background:W_INK, color:W_BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          letterSpacing:-0.1,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={W_BG}/> Add a show
        </button>
        <div style={{
          marginTop:8, padding:'6px 10px',
          background:W_SURF, border:`1px solid ${W_RULE}`,
          display:'flex', alignItems:'center', gap:8,
          fontFamily:SB.mono, fontSize:11, color:W_MUTED,
        }}>
          <Icon.Search size={13} color={W_MUTED}/>
          <span>search shows…</span>
          <span style={{flex:1}}/>
          <span style={{
            padding:'1px 6px', fontSize:9.5, border:`1px solid ${W_RULE2}`,
            color:W_MUTED, letterSpacing:.05,
          }}>⌘K</span>
        </div>
      </div>

      {/* Nav */}
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{
          padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:W_FAINT,
          letterSpacing:'.08em', textTransform:'uppercase',
        }}>Navigate</div>
        {items.map(({key, label, Icon:Ic, active, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'7px 12px', margin:'1px 0',
            background: active ? W_SURF : 'transparent',
            color: active ? W_INK : W_MUTED,
            fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
            letterSpacing:-0.1, cursor:'pointer',
            borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
          }}>
            <Ic size={15} color={active ? W_INK : W_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && (
              <span style={{fontFamily:SB.mono, fontSize:11, color:W_FAINT, letterSpacing:'.02em'}}>
                {count}
              </span>
            )}
          </div>
        ))}

        <div style={{
          padding:'18px 12px 8px', fontFamily:SB.mono, fontSize:10, color:W_FAINT,
          letterSpacing:'.08em', textTransform:'uppercase',
        }}>Filter by</div>
        {Object.entries(HIFI_KINDS).map(([key, k])=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'6px 12px', margin:'1px 0',
            color:W_MUTED, fontFamily:SB.sans, fontSize:13, cursor:'pointer',
          }}>
            <span style={{
              width:9, height:9, borderRadius:999, background:wKind(key),
              border:`1px solid ${wKind(key)}`,
            }}/>
            <span style={{flex:1}}>{k.label}</span>
            <span style={{fontFamily:SB.mono, fontSize:11, color:W_FAINT}}>
              {HIFI_PAST.filter(s=>s.kind===key).length + HIFI_UPCOMING.filter(s=>s.kind===key).length}
            </span>
          </div>
        ))}
      </div>

      {/* Profile */}
      <div style={{
        padding:'14px 16px', borderTop:`1px solid ${W_RULE}`,
        display:'flex', alignItems:'center', gap:10,
      }}>
        <div style={{
          width:28, height:28, borderRadius:999,
          background:W_SURF2, color:W_INK, display:'flex',
          alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:12, fontWeight:500,
        }}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:W_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:W_FAINT, marginTop:1, letterSpacing:'.02em'}}>
            synced 3m ago
          </div>
        </div>
        <Icon.More size={14} color={W_MUTED}/>
      </div>
    </div>
  );
}

// ─── Featured upcoming card (hero) ──────────────────────────────────────
function UpcomingHero({show}) {
  return (
    <div style={{
      padding:'22px 24px', background:W_SURF,
      borderLeft:`3px solid ${wKind(show.kind)}`,
      display:'grid', gridTemplateColumns:'1fr auto', gap:24,
      alignItems:'start',
    }}>
      <div style={{minWidth:0}}>
        <div style={{
          display:'flex', alignItems:'center', gap:10, marginBottom:10,
        }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:6,
            fontFamily:SB.mono, fontSize:10.5, color:wKind(show.kind),
            letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
          }}>
            <Icon.Dot size={9} color={wKind(show.kind)}/>
            {HIFI_KINDS[show.kind].label}
          </span>
          <span style={{
            fontFamily:SB.mono, fontSize:10.5, color:W_MUTED, letterSpacing:'.04em',
          }}>NEXT · {show.countdown.toUpperCase()}</span>
          <span style={{flex:1}}/>
          <span style={{
            fontFamily:SB.mono, fontSize:10.5, color:W_INK,
            padding:'3px 8px', border:`1px solid ${W_RULE2}`,
            letterSpacing:'.06em', textTransform:'uppercase',
            display:'inline-flex', alignItems:'center', gap:5,
          }}>
            <Icon.Check size={11} color={W_INK}/> Ticketed
          </span>
        </div>
        <div style={{
          fontFamily:SB.sans, fontWeight:600, fontSize:34,
          letterSpacing:-1.3, color:W_INK, lineHeight:1,
        }}>{show.headliner}</div>
        {show.support.length > 0 && (
          <div style={{
            fontFamily:SB.sans, fontSize:15, color:W_MUTED,
            marginTop:7, letterSpacing:-0.2,
          }}>with {show.support.join(', ')}</div>
        )}
        <div style={{
          display:'flex', gap:28, marginTop:18,
          fontFamily:SB.sans, fontSize:13, color:W_INK,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.MapPin size={14} color={W_MUTED}/>
            <span>{show.venue}</span>
            <span style={{color:W_FAINT}}>·</span>
            <span style={{color:W_MUTED}}>{show.city}</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.Ticket size={14} color={W_MUTED}/>
            <span style={{fontFamily:SB.mono, color:W_MUTED}}>{show.seat}</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.Clock size={14} color={W_MUTED}/>
            <span style={{fontFamily:SB.mono, color:W_MUTED}}>doors · 7:00 pm</span>
          </div>
        </div>
      </div>
      <div style={{
        textAlign:'right', paddingLeft:24, borderLeft:`1px solid ${W_RULE}`,
      }}>
        <div style={{
          fontFamily:SB.sans, fontSize:56, fontWeight:500, color:W_INK,
          letterSpacing:-2.2, lineHeight:.9, fontFeatureSettings:'"tnum"',
        }}>{show.date.d}</div>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:wKind(show.kind),
          letterSpacing:'.1em', marginTop:6, textTransform:'uppercase',
          fontWeight:500,
        }}>{show.date.m} · {show.date.dow}</div>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:W_MUTED, marginTop:4,
          letterSpacing:'.04em',
        }}>${show.paid} · paid</div>
      </div>
    </div>
  );
}

function UpcomingMini({show}) {
  return (
    <div style={{
      padding:'14px 16px', background:W_SURF, minWidth:0,
      borderLeft:`2px solid ${wKind(show.kind)}`,
      display:'flex', flexDirection:'column', gap:6,
    }}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span style={{
          fontFamily:SB.mono, fontSize:10, color:wKind(show.kind),
          letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
        }}>{HIFI_KINDS[show.kind].label}</span>
        <span style={{
          fontFamily:SB.mono, fontSize:9.5, color: show.hasTix ? W_INK : W_MUTED,
          letterSpacing:'.04em', display:'inline-flex', alignItems:'center', gap:4,
        }}>
          {show.hasTix
            ? <><Icon.SquareFilled size={8} color={W_INK}/>tix</>
            : <><Icon.Eye size={10} color={W_MUTED}/>watching</>}
        </span>
      </div>
      <div style={{fontFamily:SB.sans, fontSize:15, fontWeight:600, letterSpacing:-0.3, color:W_INK, lineHeight:1.15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
        {show.headliner}
      </div>
      <div style={{fontFamily:SB.sans, fontSize:11.5, color:W_MUTED, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
        {show.venue}
      </div>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop:4}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, fontWeight:500, letterSpacing:'.02em'}}>
          {show.date.m} {show.date.d}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:W_FAINT}}>
          {show.countdown}
        </div>
      </div>
    </div>
  );
}

// Counts per year across all shows (past + upcoming) — for filter badges
const HIFI_ALL_SHOWS = [...HIFI_PAST, ...HIFI_UPCOMING];
const YEAR_COUNTS = HIFI_ALL_SHOWS.reduce((acc, s) => {
  acc[s.date.y] = (acc[s.date.y] || 0) + 1;
  return acc;
}, {});
const YEARS = ['All', '2026', '2025', '2024'];
const yearCount = (y) => y === 'All' ? HIFI_ALL_SHOWS.length : (YEAR_COUNTS[Number(y)] || 0);
const yearMatch = (show, y) => y === 'All' || show.date.y === Number(y);

// ─── Prominent year filter · global control ────────────────────────────
function YearFilter({value, onChange}) {
  return (
    <div style={{
      padding:'14px 32px 16px', background:W_SURF,
      borderBottom:`1px solid ${W_RULE}`,
      display:'flex', alignItems:'center', gap:20,
    }}>
      <div style={{display:'flex', flexDirection:'column', gap:2}}>
        <div style={{
          fontFamily:SB.mono, fontSize:9.5, color:W_FAINT,
          letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500,
        }}>Viewing</div>
        <div style={{
          fontFamily:SB.sans, fontSize:13, color:W_MUTED, letterSpacing:-0.1,
        }}>Filters rhythm · map · archive</div>
      </div>
      <div style={{
        display:'flex', alignItems:'stretch',
        border:`1px solid ${W_RULE2}`, background:W_BG,
      }}>
        {YEARS.map((t, i) => {
          const active = t === value;
          const n = yearCount(t);
          return (
            <button
              key={t}
              onClick={() => onChange(t)}
              style={{
                padding:'10px 18px',
                border:'none',
                borderRight: i === YEARS.length-1 ? 'none' : `1px solid ${W_RULE2}`,
                background: active ? W_INK : 'transparent',
                color: active ? W_BG : W_INK,
                fontFamily:SB.sans, fontSize:15, fontWeight: active ? 600 : 500,
                letterSpacing:-0.3,
                cursor:'pointer',
                display:'flex', alignItems:'baseline', gap:8,
                fontFeatureSettings:'"tnum"',
              }}
            >
              <span>{t}</span>
              <span style={{
                fontFamily:SB.mono, fontSize:10.5,
                color: active ? W_BG : W_FAINT,
                opacity: active ? .7 : 1,
                letterSpacing:'.04em', fontWeight:400,
              }}>{n}</span>
            </button>
          );
        })}
      </div>
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        fontFamily:SB.mono, fontSize:10.5, color:W_MUTED,
        letterSpacing:'.04em',
      }}>
        <Icon.Filter size={12} color={W_MUTED}/>
        <span>
          {value === 'All'
            ? 'Showing every show on record'
            : `Showing ${yearCount(value)} shows from ${value}`}
        </span>
      </div>
      <div style={{flex:1}}/>
      <div style={{
        display:'flex', alignItems:'center', gap:14,
      }}>
        <div style={{padding:'6px 10px', fontFamily:SB.mono, fontSize:11, color:W_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer', border:`1px solid ${W_RULE}`}}>
          <Icon.Filter size={12} color={W_MUTED}/> Kind
        </div>
        <div style={{padding:'6px 10px', fontFamily:SB.mono, fontSize:11, color:W_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer', border:`1px solid ${W_RULE}`}}>
          <Icon.Sort size={12} color={W_MUTED}/> Sort
        </div>
      </div>
    </div>
  );
}

// ─── Past log — tabular ────────────────────────────────────────────────
function PastLog({year}) {
  const rows = HIFI_PAST.filter(s => yearMatch(s, year));
  const subtitle = year === 'All'
    ? `${HIFI_PAST.length} shows · 2024 → 2026`
    : `${rows.length} shows · ${year}`;
  return (
    <div style={{background:W_SURF, display:'flex', flexDirection:'column', minHeight:0}}>
      {/* header */}
      <div style={{
        padding:'12px 20px', display:'flex', alignItems:'center',
        justifyContent:'space-between', borderBottom:`1px solid ${W_RULE2}`,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Archive size={14} color={W_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Archive
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:W_FAINT, letterSpacing:'.04em'}}>
            {subtitle}
          </div>
        </div>
        <div style={{
          fontFamily:SB.mono, fontSize:10, color:W_FAINT,
          letterSpacing:'.08em', textTransform:'uppercase',
          display:'flex', alignItems:'center', gap:6,
        }}>
          <span style={{
            width:6, height:6, borderRadius:999, background:W_INK,
          }}/>
          {year === 'All' ? 'All years' : year}
        </div>
      </div>
      {/* column heads */}
      <div style={{
        display:'grid',
        gridTemplateColumns:'80px 110px 1fr 1fr 120px 70px 80px',
        columnGap:16,
        padding:'10px 20px', borderBottom:`1px solid ${W_RULE}`,
        fontFamily:SB.mono, fontSize:9.5, color:W_FAINT,
        letterSpacing:'.1em', textTransform:'uppercase',
      }}>
        <div>Date</div>
        <div>Kind</div>
        <div>Headline</div>
        <div>Venue</div>
        <div>Seat</div>
        <div style={{textAlign:'right'}}>Paid</div>
        <div style={{textAlign:'right'}}>Detail</div>
      </div>
      {/* rows */}
      <div style={{flex:1, overflow:'auto'}}>
        {rows.length === 0 && (
          <div style={{
            padding:'40px 20px', fontFamily:SB.mono, fontSize:11, color:W_FAINT,
            letterSpacing:'.04em', textAlign:'center',
          }}>no shows in {year}</div>
        )}
        {rows.map((s,i)=>(
          <div key={s.id} style={{
            display:'grid',
            gridTemplateColumns:'80px 110px 1fr 1fr 120px 70px 80px',
            columnGap:16,
            padding:'14px 20px', borderBottom:`1px solid ${W_RULE}`,
            alignItems:'center',
          }}>
            <div>
              <div style={{fontFamily:SB.sans, fontSize:17, color:W_INK, fontWeight:500, letterSpacing:-0.5, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                {s.date.m} {s.date.d}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:W_FAINT, marginTop:3, letterSpacing:'.04em'}}>
                {s.date.y} · {s.date.dow.toLowerCase()}
              </div>
            </div>
            <div style={{
              display:'inline-flex', alignItems:'center', gap:6,
              fontFamily:SB.mono, fontSize:10.5, color:wKind(s.kind),
              letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
            }}>
              <span style={{width:6, height:6, borderRadius:999, background:wKind(s.kind)}}/>
              {HIFI_KINDS[s.kind].label}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:W_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {s.headliner}
              </div>
              {s.support.length>0 && (
                <div style={{fontFamily:SB.sans, fontSize:11.5, color:W_MUTED, marginTop:2, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  + {s.support.join(', ')}
                </div>
              )}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:13, color:W_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {s.venue}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:W_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                {s.neighborhood.toLowerCase()}
              </div>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:W_MUTED, letterSpacing:'.02em'}}>
              {s.seat}
            </div>
            <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color:W_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
              ${s.paid}
            </div>
            <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, color:W_MUTED}}>
              {s.setlistCount && (
                <div style={{display:'flex', alignItems:'center', gap:4, fontFamily:SB.mono, fontSize:10}}>
                  <Icon.Music size={11} color={W_MUTED}/>
                  {s.setlistCount}
                </div>
              )}
              <Icon.ChevronRight size={14} color={W_FAINT}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-year rhythm data (attended, tickets) by month. Real data for 2026;
// synthesized plausible rhythms for prior years so the filter has something to show.
const RHYTHM_BY_YEAR = {
  '2026': HIFI_RHYTHM,
  '2025': [
    {a:1,t:0},{a:2,t:0},{a:3,t:0},{a:2,t:0},
    {a:3,t:0},{a:4,t:0},{a:2,t:0},{a:1,t:0},
    {a:3,t:0},{a:4,t:0},{a:3,t:0},{a:2,t:0},
  ],
  '2024': [
    {a:0,t:0},{a:1,t:0},{a:2,t:0},{a:1,t:0},
    {a:2,t:0},{a:3,t:0},{a:2,t:0},{a:2,t:0},
    {a:1,t:0},{a:2,t:0},{a:1,t:0},{a:1,t:0},
  ],
};
const ALL_RHYTHM = (() => {
  // Sum across years
  return HIFI_RHYTHM.map((_, i) => {
    let a = 0, t = 0;
    Object.values(RHYTHM_BY_YEAR).forEach(yr => { a += yr[i].a; t += yr[i].t; });
    return { a, t };
  });
})();

// ─── Year rhythm · wide ────────────────────────────────────────────────
function YearRhythmWide({year}) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const data = year === 'All' ? ALL_RHYTHM : (RHYTHM_BY_YEAR[year] || HIFI_RHYTHM);
  const isCurrent = year === '2026';
  const total = data.reduce((s, m) => s + m.a + m.t, 0);
  return (
    <div style={{
      padding:'18px 20px', background:W_SURF, borderBottom:`1px solid ${W_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Rhythm · {year === 'All' ? 'all years' : year}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:W_FAINT, letterSpacing:'.04em'}}>
            {total} shows
          </div>
        </div>
        <div style={{display:'flex', gap:12, alignItems:'center', fontFamily:SB.mono, fontSize:10, color:W_MUTED}}>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
            <Icon.SquareFilled size={8} color={W_INK}/> attended
          </span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
            <Icon.Square size={8} color={W_INK}/> have tix
          </span>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:4, alignItems:'end', height:76, position:'relative'}}>
        {data.map((m,i)=>{
          const isNow = isCurrent && i===3;
          return (
            <div key={i} style={{
              display:'flex', flexDirection:'column-reverse', gap:2, height:'100%', position:'relative',
            }}>
              {Array.from({length:m.a}).map((_,j)=>(
                <div key={'a'+j} style={{height:14, background:W_INK}}/>
              ))}
              {Array.from({length:m.t}).map((_,j)=>(
                <div key={'t'+j} style={{height:14, border:`1.25px solid ${W_INK}`, background:'transparent'}}/>
              ))}
              {isNow && (
                <div style={{
                  position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)',
                  fontFamily:SB.mono, fontSize:9, color:SB.kinds.concert.inkDark,
                  letterSpacing:'.04em', whiteSpace:'nowrap', fontWeight:500,
                }}>TODAY</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:4, marginTop:8}}>
        {months.map((m,i)=>(
          <div key={i} style={{
            textAlign:'center', fontFamily:SB.mono, fontSize:9.5,
            color: (isCurrent && i===3) ? W_INK : W_FAINT, letterSpacing:'.06em',
            fontWeight: (isCurrent && i===3) ? 500 : 400,
          }}>{m}</div>
        ))}
      </div>
    </div>
  );
}

// ─── NYC map with venue dots ───────────────────────────────────────────
// Per-year venue dot sets (plausible, distinct so filter has visible effect)
const VENUES_BY_YEAR = {
  '2026': [
    {x:160, y:70,  r:5, count:1, label:'Kings Theatre'},
    {x:148, y:60,  r:6, count:2, label:'Brooklyn Steel'},
    {x:118, y:48,  r:8, count:4, label:'Radio City'},
    {x:122, y:54,  r:5, count:1},
    {x:128, y:44,  r:5, count:1},
    {x:108, y:40,  r:6, count:2},
    {x:178, y:92,  r:5, count:1},
    {x:210, y:72,  r:5, count:1},
    {x:188, y:38,  r:5, count:1},
  ],
  '2025': [
    {x:118, y:48,  r:9, count:5, label:'Radio City'},
    {x:128, y:44,  r:6, count:2},
    {x:108, y:40,  r:7, count:3},
    {x:148, y:60,  r:6, count:2},
    {x:160, y:70,  r:5, count:1},
    {x:178, y:92,  r:6, count:2},
    {x:210, y:72,  r:5, count:1},
    {x:122, y:54,  r:5, count:1},
    {x:100, y:60,  r:5, count:1},
    {x:138, y:82,  r:6, count:2},
    {x:195, y:110, r:5, count:1},
    {x:152, y:100, r:5, count:1},
  ],
  '2024': [
    {x:118, y:48,  r:6, count:2},
    {x:108, y:40,  r:5, count:1},
    {x:148, y:60,  r:5, count:1},
    {x:160, y:70,  r:5, count:1},
    {x:178, y:92,  r:5, count:1},
    {x:138, y:82,  r:5, count:1},
  ],
};
const ALL_VENUES = (() => {
  // Merge by (x,y) — sum counts
  const key = (d) => `${d.x},${d.y}`;
  const map = {};
  Object.values(VENUES_BY_YEAR).forEach(list => list.forEach(d => {
    const k = key(d);
    if (!map[k]) map[k] = { ...d, count:0 };
    map[k].count += d.count;
    map[k].label = map[k].label || d.label;
  }));
  return Object.values(map).map(d => ({
    ...d,
    r: Math.min(10, 4 + d.count),
  }));
})();

function VenueMap({year}) {
  const dots = year === 'All' ? ALL_VENUES : (VENUES_BY_YEAR[year] || []);
  const venueTotal = dots.length;
  const showTotal = dots.reduce((s, d) => s + d.count, 0);
  return (
    <div style={{padding:'18px 20px 20px', background:W_SURF, borderBottom:`1px solid ${W_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Venue map · NYC
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:W_MUTED, letterSpacing:'.04em'}}>
          {venueTotal} venues · {showTotal} shows · {year === 'All' ? 'all years' : year}
        </div>
      </div>
      <div style={{position:'relative', border:`1px solid ${W_RULE}`, background:W_BG, height:190}}>
        <svg viewBox="0 0 300 190" width="100%" height="100%" style={{display:'block'}}>
          {/* abstract NYC outline — water + boroughs */}
          <g stroke={W_RULE2} strokeWidth="0.8" fill="none">
            {/* Manhattan */}
            <path d="M100 10 L130 10 L140 40 L135 90 L120 125 L110 130 L95 110 L88 70 L92 30 Z"/>
            {/* Brooklyn/Queens */}
            <path d="M135 90 L200 80 L240 110 L240 160 L200 170 L160 160 L140 130 L135 110 Z"/>
            {/* Bronx */}
            <path d="M105 10 L160 5 L180 30 L170 45 L135 45 L130 20 Z"/>
            {/* Staten Island */}
            <path d="M60 130 L100 135 L100 170 L60 170 Z"/>
          </g>
          {/* grid lines */}
          <g stroke={W_RULE} strokeWidth="0.4">
            {Array.from({length:10}).map((_,i)=>(
              <line key={'v'+i} x1={i*30} y1={0} x2={i*30} y2={190}/>
            ))}
            {Array.from({length:7}).map((_,i)=>(
              <line key={'h'+i} x1={0} y1={i*30} x2={300} y2={i*30}/>
            ))}
          </g>
          {dots.map((d,i)=>(
            <g key={i}>
              {d.count > 1 && (
                <circle cx={d.x} cy={d.y} r={d.r + 3} fill={SB.kinds.concert.inkDark} opacity="0.18"/>
              )}
              <circle cx={d.x} cy={d.y} r={d.r} fill={SB.kinds.concert.inkDark} opacity="0.9"/>
              {d.count > 1 && (
                <text x={d.x} y={d.y + 2.5} fontFamily={SB.mono} fontSize="7" fill={W_BG} textAnchor="middle" fontWeight="600">{d.count}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function MostSeen() {
  const rows = [
    ['Big Thief', 5, 'concert'],
    ['Mitski', 4, 'concert'],
    ['Fontaines D.C.', 3, 'concert'],
    ['Hadestown', 2, 'theatre'],
    ['John Mulaney', 2, 'comedy'],
  ];
  const MAX = 5;
  return (
    <div style={{padding:'18px 20px 20px', background:W_SURF}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Most seen
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:W_MUTED, letterSpacing:'.04em'}}>all time</div>
      </div>
      {rows.map(([name, count, kind])=>(
        <div key={name} style={{
          display:'grid', gridTemplateColumns:'1fr 90px 24px', columnGap:10,
          alignItems:'center', padding:'8px 0', borderBottom:`1px solid ${W_RULE}`,
        }}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:W_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
            {name}
          </div>
          <div style={{display:'flex', gap:2, alignItems:'center'}}>
            {Array.from({length:MAX}).map((_,i)=>(
              <div key={i} style={{
                height:8, flex:1,
                background: i < count ? wKind(kind) : 'transparent',
                border: i < count ? 'none' : `1px solid ${W_RULE2}`,
              }}/>
            ))}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, textAlign:'right', fontWeight:500}}>
            {count}×
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────
function WebHome() {
  const [year, setYear] = React.useState('2026');
  return (
    <div style={{
      width:'100%', height:'100%', background:W_BG, color:W_INK,
      display:'flex', fontFamily:SB.sans,
      WebkitFontSmoothing:'antialiased',
      overflow:'hidden',
    }}>
      <Sidebar/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar */}
        <div style={{
          padding:'14px 32px', display:'flex', alignItems:'center',
          justifyContent:'space-between', borderBottom:`1px solid ${W_RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:W_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              Mon · 20 apr · 2026
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:W_INK, letterSpacing:-0.7, marginTop:3}}>
              Good evening, m
            </div>
          </div>
          <div style={{display:'flex', gap:28, alignItems:'center'}}>
            {[
              ['Shows', HIFI_TOTALS.shows, 'this year'],
              ['Spent', HIFI_TOTALS.spent, '~$92/show'],
              ['Venues', HIFI_TOTALS.venues, 'NYC'],
              ['Artists', HIFI_TOTALS.artists, '+ 3 new'],
            ].map(([l,v,sub])=>(
              <div key={l} style={{display:'flex', flexDirection:'column', alignItems:'flex-start'}}>
                <div style={{display:'flex', alignItems:'baseline', gap:6}}>
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:W_INK, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>
                    {v}
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:W_FAINT, letterSpacing:'.04em'}}>
                    {sub}
                  </div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:W_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:4}}>
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Prominent year filter — drives rhythm · map · archive */}
        <YearFilter value={year} onChange={setYear}/>

        {/* Main grid */}
        <div style={{
          flex:1, display:'grid',
          gridTemplateColumns:'1fr 360px',
          minHeight:0, overflow:'hidden',
        }}>
          {/* Left column: upcoming + past */}
          <div style={{display:'flex', flexDirection:'column', minHeight:0, minWidth:0, borderRight:`1px solid ${W_RULE}`}}>
            <div style={{padding:'20px 32px 10px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <Icon.ArrowUpRight size={14} color={W_INK}/>
                <div style={{fontFamily:SB.mono, fontSize:11, color:W_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
                  Upcoming
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:W_FAINT, letterSpacing:'.04em'}}>
                  next 90 days
                </div>
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11, color:W_MUTED, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                Calendar <Icon.ArrowRight size={11} color={W_MUTED}/>
              </div>
            </div>

            <div style={{padding:'0 32px 20px'}}>
              <UpcomingHero show={HIFI_UPCOMING[0]}/>
              <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:1, marginTop:1, background:W_RULE}}>
                {HIFI_UPCOMING.slice(1, 4).map(s=>(
                  <UpcomingMini key={s.id} show={s}/>
                ))}
              </div>
            </div>

            <div style={{padding:'0 32px 20px', flex:1, minHeight:0, display:'flex', flexDirection:'column'}}>
              <PastLog year={year}/>
            </div>
          </div>

          {/* Right column: rhythm, map, most-seen */}
          <div style={{display:'flex', flexDirection:'column', minHeight:0, overflow:'auto'}}>
            <YearRhythmWide year={year}/>
            <VenueMap year={year}/>
            <MostSeen/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.WebHome = WebHome;
