// Web · History · archive · dark
// Sidebar nav + year rail + dense archive ledger + map & venues panel.
// Year selection filters the right panel (map/top venues/most seen).

const { SB, Icon, HIFI_KINDS, HIFI_ARCHIVE, HIFI_YEAR_COUNTS, HIFI_ARCHIVE_TOTALS, HIFI_TOP_VENUES, HIFI_TOP_ARTISTS, HIFI_VENUE_PINS } = window;

const H2_MODE = 'dark';
const H2_BG    = SB.bg[H2_MODE];
const H2_SURF  = SB.surface[H2_MODE];
const H2_SURF2 = SB.surface2[H2_MODE];
const H2_INK   = SB.ink[H2_MODE];
const H2_MUTED = SB.muted[H2_MODE];
const H2_FAINT = SB.faint[H2_MODE];
const H2_RULE  = SB.rule[H2_MODE];
const H2_RULE2 = SB.ruleStrong[H2_MODE];

const h2Kind = (k) => window.kindInk(k, true);

// ─── Aggregation helpers ────────────────────────────────────────────
// Scale year counts in data so aggregates across years > archive rows
// roughly match HIFI_YEAR_COUNTS totals. For year-specific filtering we
// just use the archive rows we have.
function aggregateFor(year) {
  const rows = year === 'all' ? HIFI_ARCHIVE : HIFI_ARCHIVE.filter(s => s.date.y === year);
  // Venues
  const vMap = {};
  rows.forEach(s => {
    if (!vMap[s.venue]) vMap[s.venue] = { name: s.venue, neighborhood: s.neighborhood, count: 0 };
    vMap[s.venue].count++;
  });
  let venues = Object.values(vMap).sort((a,b)=>b.count-a.count);
  // Artists (headliner only for simplicity)
  const aMap = {};
  rows.forEach(s => {
    if (!aMap[s.headliner]) aMap[s.headliner] = { name: s.headliner, kind: s.kind, count: 0 };
    aMap[s.headliner].count++;
  });
  let artists = Object.values(aMap).sort((a,b)=>b.count-a.count);

  // For "all time" we have curated leaderboards that reflect the full 65-show archive.
  if (year === 'all') {
    venues = HIFI_TOP_VENUES.map(v=>({...v}));
    artists = HIFI_TOP_ARTISTS.map(a=>({...a}));
  }

  // Pins: filter by year using venue-name ↔ pin label match, else all pins.
  let pins;
  if (year === 'all') {
    pins = HIFI_VENUE_PINS;
  } else {
    const venueSet = new Set(rows.map(r => r.venue));
    // approx match by label substring
    pins = HIFI_VENUE_PINS.map(p => {
      const match = [...venueSet].find(v => v.toLowerCase().includes(p.label.toLowerCase()) || p.label.toLowerCase().includes(v.toLowerCase().split(' ')[0]));
      if (!match) return null;
      const c = rows.filter(r => r.venue === match).length;
      return c > 0 ? { ...p, count: c, r: Math.min(8, 3 + c*1.5), label: match.replace(' Theatre','') } : null;
    }).filter(Boolean);
  }
  return { rows, venues, artists, pins };
}

// ─── Sidebar ─────────────────────────────────────────────────────────
function HistorySidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive, count:'65', active:true },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'4' },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'48' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'24' },
    { key:'map',    label:'Map',       Icon:Icon.Map },
  ];
  return (
    <div style={{
      width:224, background:H2_BG, borderRight:`1px solid ${H2_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
    }}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:H2_INK, letterSpacing:-0.5}}>
          showbook<span style={{color:H2_FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v · 2026.04
        </div>
      </div>
      <div style={{padding:'0 16px 20px'}}>
        <button style={{
          width:'100%', padding:'9px 12px', background:H2_INK, color:H2_BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={H2_BG}/> Add a show
        </button>
        <div style={{
          marginTop:8, padding:'6px 10px',
          background:H2_SURF, border:`1px solid ${H2_RULE}`,
          display:'flex', alignItems:'center', gap:8,
          fontFamily:SB.mono, fontSize:11, color:H2_MUTED,
        }}>
          <Icon.Search size={13} color={H2_MUTED}/>
          <span>search archive…</span>
          <span style={{flex:1}}/>
          <span style={{padding:'1px 6px', fontSize:9.5, border:`1px solid ${H2_RULE2}`, color:H2_MUTED}}>⌘K</span>
        </div>
      </div>
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:H2_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Navigate
        </div>
        {items.map(({key, label, Icon:Ic, active, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10, padding:'7px 12px', margin:'1px 0',
            background: active ? H2_SURF : 'transparent',
            color: active ? H2_INK : H2_MUTED,
            fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
            cursor:'pointer',
            borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
          }}>
            <Ic size={15} color={active ? H2_INK : H2_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && <span style={{fontFamily:SB.mono, fontSize:11, color:H2_FAINT}}>{count}</span>}
          </div>
        ))}
        <div style={{padding:'18px 12px 8px', fontFamily:SB.mono, fontSize:10, color:H2_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Filter by
        </div>
        {Object.entries(HIFI_KINDS).map(([key, k])=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10, padding:'6px 12px', margin:'1px 0',
            color:H2_MUTED, fontFamily:SB.sans, fontSize:13, cursor:'pointer',
          }}>
            <span style={{width:9, height:9, borderRadius:999, background:h2Kind(key)}}/>
            <span style={{flex:1}}>{k.label}</span>
            <span style={{fontFamily:SB.mono, fontSize:11, color:H2_FAINT}}>
              {HIFI_ARCHIVE.filter(s=>s.kind===key).length}
            </span>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px', borderTop:`1px solid ${H2_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:H2_SURF2, color:H2_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:H2_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, marginTop:1}}>synced 3m ago</div>
        </div>
        <Icon.More size={14} color={H2_MUTED}/>
      </div>
    </div>
  );
}

// ─── Year rail ──────────────────────────────────────────────────────
function YearRail({sel, onSel}) {
  const MAX = Math.max(...HIFI_YEAR_COUNTS.map(y => y.count)) || 1;
  const allCount = HIFI_YEAR_COUNTS.reduce((a,y)=>a+y.count,0);
  const allActive = sel === 'all';
  return (
    <div style={{
      width:160, background:H2_SURF, borderRight:`1px solid ${H2_RULE}`,
      display:'flex', flexDirection:'column', flexShrink:0, overflow:'auto',
    }}>
      <div style={{padding:'14px 18px 12px', borderBottom:`1px solid ${H2_RULE}`}}>
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Years</div>
        <div
          onClick={()=>onSel('all')}
          style={{
            fontFamily:SB.sans, fontSize:15, fontWeight:500,
            color: allActive ? H2_INK : H2_MUTED,
            letterSpacing:-0.3, marginTop:6, fontFeatureSettings:'"tnum"', cursor:'pointer',
            display:'flex', alignItems:'baseline', justifyContent:'space-between',
            paddingLeft: allActive ? 0 : 0,
          }}
        >
          <span style={{borderBottom: allActive ? `1.5px solid ${SB.kinds.concert.inkDark}` : 'none', paddingBottom:2}}>
            2019 <span style={{color:H2_FAINT}}>—</span> 2026
          </span>
          <span style={{fontFamily:SB.mono, fontSize:10.5, color: allActive ? H2_INK : H2_FAINT}}>{allCount}</span>
        </div>
      </div>
      <div style={{flex:1}}>
        {HIFI_YEAR_COUNTS.map(({y, count}) => {
          const active = y === sel;
          const empty = count === 0;
          const pct = count / MAX;
          return (
            <div key={y}
              onClick={()=> !empty && onSel(y)}
              style={{
                padding:'12px 18px',
                background: active ? H2_SURF2 : 'transparent',
                borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
                borderBottom:`1px solid ${H2_RULE}`,
                cursor: empty ? 'default' : 'pointer',
                opacity: empty ? .55 : 1,
              }}
            >
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
                <div style={{
                  fontFamily:SB.sans,
                  fontSize: active ? 18 : 15,
                  fontWeight: active ? 600 : 500,
                  color: empty ? H2_FAINT : H2_INK,
                  letterSpacing:-0.4, fontFeatureSettings:'"tnum"', lineHeight:1,
                }}>{y}</div>
                <div style={{
                  fontFamily:SB.mono, fontSize:10.5,
                  color: empty ? H2_FAINT : H2_MUTED,
                  letterSpacing:'.04em', fontWeight: active ? 500 : 400,
                }}>
                  {count}
                </div>
              </div>
              <div style={{marginTop:7, height:4, background:H2_RULE, position:'relative'}}>
                <div style={{
                  position:'absolute', inset:0, width: `${Math.max(4, pct*100)}%`,
                  background: empty ? 'transparent' : (active ? SB.kinds.concert.inkDark : H2_MUTED),
                }}/>
              </div>
              {count>0 && (
                <div style={{
                  fontFamily:SB.mono, fontSize:9.5, color:H2_FAINT, letterSpacing:'.04em',
                  marginTop:5, textTransform:'lowercase',
                }}>
                  {count} {count===1?'show':'shows'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Archive ledger ──────────────────────────────────────────────────
function ArchiveLedger({sel}) {
  const byYear = {};
  const filtered = sel === 'all' ? HIFI_ARCHIVE : HIFI_ARCHIVE.filter(s => s.date.y === sel);
  filtered.forEach(s => { (byYear[s.date.y] = byYear[s.date.y] || []).push(s); });
  const years = Object.keys(byYear).map(Number).sort((a,b)=>b-a);
  const yearMeta = Object.fromEntries(HIFI_YEAR_COUNTS.map(y=>[y.y,y]));

  const totalShows = sel === 'all' ? HIFI_ARCHIVE_TOTALS.shows : (yearMeta[sel]||{}).count || filtered.length;
  const totalSpent = sel === 'all' ? HIFI_ARCHIVE_TOTALS.spent : '$'+(((yearMeta[sel]||{}).spent) || filtered.reduce((a,s)=>a+s.paid,0)).toLocaleString();

  return (
    <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', background:H2_SURF, minHeight:0}}>
      <div style={{padding:'16px 28px', borderBottom:`1px solid ${H2_RULE2}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:H2_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
            Archive · {sel === 'all' ? 'all time' : sel}
          </div>
          <div style={{display:'flex', alignItems:'baseline', gap:14, marginTop:5}}>
            <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:H2_INK, letterSpacing:-0.9, lineHeight:1}}>
              {totalShows} shows
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:H2_FAINT, letterSpacing:'.04em'}}>
              {totalSpent}{sel === 'all' ? ' · 24 venues · 48 artists · 8 years' : ''}
            </div>
          </div>
        </div>
        <div style={{display:'flex', gap:4, alignItems:'center'}}>
          <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:H2_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
            <Icon.Filter size={12} color={H2_MUTED}/> All kinds
            <Icon.ChevronDown size={11} color={H2_MUTED}/>
          </div>
          <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:H2_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
            <Icon.MapPin size={12} color={H2_MUTED}/> All cities
            <Icon.ChevronDown size={11} color={H2_MUTED}/>
          </div>
          <div style={{width:1, height:18, background:H2_RULE, margin:'0 6px'}}/>
          <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:H2_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
            <Icon.Sort size={12} color={H2_MUTED}/> Newest first
          </div>
        </div>
      </div>

      <div style={{
        display:'grid',
        gridTemplateColumns:'92px 104px 1.2fr 1fr 110px 60px 96px 52px',
        columnGap:14,
        padding:'10px 28px', borderBottom:`1px solid ${H2_RULE}`,
        fontFamily:SB.mono, fontSize:9.5, color:H2_FAINT,
        letterSpacing:'.12em', textTransform:'uppercase',
      }}>
        <div>Date</div>
        <div>Kind</div>
        <div>Headline</div>
        <div>Venue</div>
        <div>Seat</div>
        <div style={{textAlign:'right'}}>Paid</div>
        <div>Rated</div>
        <div style={{textAlign:'right'}}>·</div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {years.map(y=>(
          <React.Fragment key={y}>
            <div style={{
              position:'sticky', top:0, zIndex:1, background:H2_BG,
              padding:'9px 28px', borderBottom:`1px solid ${H2_RULE2}`, borderTop:`1px solid ${H2_RULE2}`,
              display:'flex', alignItems:'baseline', gap:14,
            }}>
              <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:H2_INK, letterSpacing:-0.3, fontFeatureSettings:'"tnum"'}}>
                {y}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:H2_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
                {(yearMeta[y]||{}).count || byYear[y].length} shows
              </div>
            </div>
            {byYear[y].map(s=>(
              <div key={s.id} style={{
                display:'grid',
                gridTemplateColumns:'92px 104px 1.2fr 1fr 110px 60px 96px 52px',
                columnGap:14,
                padding:'13px 28px', borderBottom:`1px solid ${H2_RULE}`, alignItems:'center',
              }}>
                <div>
                  <div style={{fontFamily:SB.sans, fontSize:16, color:H2_INK, fontWeight:500, letterSpacing:-0.4, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                    {s.date.m} {s.date.d}
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, marginTop:3, letterSpacing:'.04em'}}>
                    {s.date.dow.toLowerCase()}
                  </div>
                </div>
                <div style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:h2Kind(s.kind), letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>
                  <span style={{width:6, height:6, borderRadius:999, background:h2Kind(s.kind)}}/>
                  {HIFI_KINDS[s.kind].label}
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:H2_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {s.headliner}
                  </div>
                  {(s.support.length>0 || s.cast) && (
                    <div style={{fontFamily:SB.sans, fontSize:11.5, color:H2_MUTED, marginTop:2, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {s.support.length>0 ? `+ ${s.support.join(', ')}` : s.cast && `cast · ${s.cast.join(', ')}`}
                    </div>
                  )}
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:SB.sans, fontSize:13, color:H2_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {s.venue}
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:10.5, color:H2_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                    {s.neighborhood.toLowerCase()}
                  </div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:11, color:H2_MUTED}}>{s.seat}</div>
                <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color:H2_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                  ${s.paid}
                </div>
                <div style={{display:'flex', gap:2, alignItems:'center'}}>
                  {Array.from({length:5}).map((_,i)=>(
                    <div key={i} style={{
                      width:8, height:8,
                      background: i < s.rating ? H2_INK : 'transparent',
                      border:`1px solid ${i < s.rating ? H2_INK : H2_RULE2}`,
                    }}/>
                  ))}
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, color:H2_MUTED}}>
                  {s.setlistCount && (
                    <div style={{display:'flex', alignItems:'center', gap:4, fontFamily:SB.mono, fontSize:10, color:H2_FAINT}}>
                      <Icon.Music size={10} color={H2_FAINT}/>{s.setlistCount}
                    </div>
                  )}
                  <Icon.ChevronRight size={14} color={H2_FAINT}/>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
        {filtered.length === 0 && (
          <div style={{padding:'60px 28px', textAlign:'center', fontFamily:SB.mono, fontSize:11, color:H2_FAINT, letterSpacing:'.04em'}}>
            No shows captured in archive for {sel}.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Right panel ─────────────────────────────────────────────────────
function MapPanel({pins, venueCount, scopeLabel}) {
  return (
    <div style={{padding:'18px 20px 20px', background:H2_SURF, borderBottom:`1px solid ${H2_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:H2_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Geography · {scopeLabel}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_MUTED, letterSpacing:'.04em'}}>
          {venueCount} {venueCount===1?'venue':'venues'} · nyc
        </div>
      </div>
      <div style={{position:'relative', border:`1px solid ${H2_RULE}`, background:H2_BG, height:220}}>
        <svg viewBox="0 0 300 220" width="100%" height="100%" style={{display:'block'}}>
          <g stroke={H2_RULE2} strokeWidth="0.8" fill="none">
            <path d="M100 20 L130 20 L140 50 L135 100 L120 135 L110 140 L95 120 L88 80 L92 40 Z"/>
            <path d="M135 100 L200 90 L240 120 L240 170 L200 180 L160 170 L140 140 L135 120 Z"/>
            <path d="M105 20 L160 15 L180 40 L170 55 L135 55 L130 30 Z"/>
            <path d="M60 140 L100 145 L100 180 L60 180 Z"/>
          </g>
          <g stroke={H2_RULE} strokeWidth="0.4">
            {Array.from({length:10}).map((_,i)=>(
              <line key={'v'+i} x1={i*30} y1={0} x2={i*30} y2={220}/>
            ))}
            {Array.from({length:8}).map((_,i)=>(
              <line key={'h'+i} x1={0} y1={i*30} x2={300} y2={i*30}/>
            ))}
          </g>
          {pins.map(d=>(
            <g key={d.id}>
              <circle cx={d.x} cy={d.y} r={d.r + 3} fill={SB.kinds.concert.inkDark} opacity="0.18"/>
              <circle cx={d.x} cy={d.y} r={d.r} fill={SB.kinds.concert.inkDark} opacity="0.9"/>
              {d.count > 2 && (
                <text x={d.x} y={d.y + 2.8} fontFamily={SB.mono} fontSize="7.5" fill={H2_BG} textAnchor="middle" fontWeight="600">
                  {d.count}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div style={{fontFamily:SB.mono, fontSize:9.5, color:H2_FAINT, marginTop:6, letterSpacing:'.04em'}}>
        click a pin to filter ↑
      </div>
    </div>
  );
}

function TopVenuesPanel({venues, scopeLabel}) {
  const list = venues.slice(0,6);
  const MAX = list[0] ? list[0].count : 1;
  return (
    <div style={{padding:'18px 20px', background:H2_SURF, borderBottom:`1px solid ${H2_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:H2_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Top venues
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_MUTED, letterSpacing:'.04em'}}>{scopeLabel}</div>
      </div>
      {list.length === 0 && (
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, padding:'8px 0'}}>no data</div>
      )}
      {list.map((v,i)=>(
        <div key={v.name} style={{
          display:'grid', gridTemplateColumns:'1fr 70px 26px', columnGap:10, alignItems:'center',
          padding:'7px 0', borderTop: i===0 ? 'none' : `1px solid ${H2_RULE}`,
        }}>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:SB.sans, fontSize:13, color:H2_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {v.name}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:H2_FAINT, marginTop:1, letterSpacing:'.02em'}}>
              {(v.neighborhood||'').toLowerCase()}
            </div>
          </div>
          <div style={{display:'flex', gap:2, alignItems:'center'}}>
            {Array.from({length:MAX}).map((_,j)=>(
              <div key={j} style={{
                height:8, flex:1,
                background: j < v.count ? H2_INK : 'transparent',
                border: j < v.count ? 'none' : `1px solid ${H2_RULE2}`,
              }}/>
            ))}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:H2_INK, textAlign:'right', fontWeight:500}}>
            {v.count}×
          </div>
        </div>
      ))}
    </div>
  );
}

function TopArtistsPanel({artists, scopeLabel}) {
  const list = artists.slice(0,6);
  const MAX = list[0] ? list[0].count : 1;
  return (
    <div style={{padding:'18px 20px', background:H2_SURF}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:H2_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Most seen
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_MUTED, letterSpacing:'.04em'}}>artists · {scopeLabel}</div>
      </div>
      {list.length === 0 && (
        <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, padding:'8px 0'}}>no data</div>
      )}
      {list.map((a,i)=>(
        <div key={a.name} style={{
          display:'grid', gridTemplateColumns:'1fr 70px 26px', columnGap:10, alignItems:'center',
          padding:'7px 0', borderTop: i===0 ? 'none' : `1px solid ${H2_RULE}`,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8, minWidth:0}}>
            <span style={{width:6, height:6, borderRadius:999, background:h2Kind(a.kind), flexShrink:0}}/>
            <span style={{fontFamily:SB.sans, fontSize:13, color:H2_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {a.name}
            </span>
          </div>
          <div style={{display:'flex', gap:2, alignItems:'center'}}>
            {Array.from({length:MAX}).map((_,j)=>(
              <div key={j} style={{
                height:8, flex:1,
                background: j < a.count ? h2Kind(a.kind) : 'transparent',
                border: j < a.count ? 'none' : `1px solid ${H2_RULE2}`,
              }}/>
            ))}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:H2_INK, textAlign:'right', fontWeight:500}}>
            {a.count}×
          </div>
        </div>
      ))}
    </div>
  );
}

function WebHistory() {
  const [sel, setSel] = React.useState('all');
  const agg = React.useMemo(()=>aggregateFor(sel), [sel]);
  const scopeLabel = sel === 'all' ? 'all time' : String(sel);

  return (
    <div style={{
      width:'100%', height:'100%', background:H2_BG, color:H2_INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <HistorySidebar/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        <div style={{
          padding:'14px 28px', display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${H2_RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:H2_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              <span style={{color:H2_FAINT}}>Home</span>
              <span style={{color:H2_FAINT, margin:'0 8px'}}>›</span>
              Archive
              <span style={{color:H2_FAINT, margin:'0 8px'}}>·</span>
              <span style={{color:H2_INK}}>{scopeLabel}</span>
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:H2_INK, letterSpacing:-0.7, marginTop:3}}>
              Everything you've been to
            </div>
          </div>
          <div style={{display:'flex', gap:28, alignItems:'center'}}>
            {[
              ['Shows', HIFI_ARCHIVE_TOTALS.shows, 'all time'],
              ['Spent', HIFI_ARCHIVE_TOTALS.spent, '~$112/show'],
              ['Venues',HIFI_ARCHIVE_TOTALS.venues, '6 cities'],
              ['Artists',HIFI_ARCHIVE_TOTALS.artists, 'unique'],
            ].map(([l,v,sub])=>(
              <div key={l} style={{display:'flex', flexDirection:'column'}}>
                <div style={{display:'flex', alignItems:'baseline', gap:6}}>
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:H2_INK, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>{v}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:H2_FAINT, letterSpacing:'.04em'}}>{sub}</div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:H2_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:4}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{flex:1, display:'flex', minHeight:0, overflow:'hidden'}}>
          <YearRail sel={sel} onSel={setSel}/>
          <ArchiveLedger sel={sel}/>
          <div style={{
            width:340, display:'flex', flexDirection:'column', minHeight:0,
            overflow:'auto', borderLeft:`1px solid ${H2_RULE}`,
          }}>
            <MapPanel pins={agg.pins} venueCount={agg.venues.length} scopeLabel={scopeLabel}/>
            <TopVenuesPanel venues={agg.venues} scopeLabel={scopeLabel}/>
            <TopArtistsPanel artists={agg.artists} scopeLabel={scopeLabel}/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.WebHistory = WebHistory;
