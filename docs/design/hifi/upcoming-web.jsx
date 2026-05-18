// Web · Upcoming / Calendar · dark
// Sidebar (Upcoming active) + top bar + year/month switch + main grid:
//   [left] calendar month view with event pills + chronological list below
//   [right] venue lens, import helpers, totals, on-sale watcher
// 1440 × 900.

const { SB, Icon, HIFI_KINDS, HIFI_UP_FULL, HIFI_UP_BY_VENUE, HIFI_UP_TOTALS, HIFI_UP_CAL, HIFI_TOTALS } = window;

const WU_MODE = 'dark';
const WU_BG    = SB.bg[WU_MODE];
const WU_SURF  = SB.surface[WU_MODE];
const WU_SURF2 = SB.surface2[WU_MODE];
const WU_INK   = SB.ink[WU_MODE];
const WU_MUTED = SB.muted[WU_MODE];
const WU_FAINT = SB.faint[WU_MODE];
const WU_RULE  = SB.rule[WU_MODE];
const WU_RULE2 = SB.ruleStrong[WU_MODE];

const wuKind = (k) => window.kindInk(k, true);

function UpSidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive,  count:'87' },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'8', active:true },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'22' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'9' },
    { key:'map',    label:'Map',       Icon:Icon.Map },
  ];
  return (
    <div style={{
      width:224, background:WU_BG, borderRight:`1px solid ${WU_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
    }}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:WU_INK, letterSpacing:-0.5}}>
          showbook
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v · 2026.04
        </div>
      </div>
      <div style={{padding:'0 16px 20px'}}>
        <button style={{
          width:'100%', padding:'9px 12px', background:WU_INK, color:WU_BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={WU_BG}/> Add a show
        </button>
        <div style={{
          marginTop:8, padding:'6px 10px', background:WU_SURF, border:`1px solid ${WU_RULE}`,
          display:'flex', alignItems:'center', gap:8,
          fontFamily:SB.mono, fontSize:11, color:WU_MUTED,
        }}>
          <Icon.Search size={13} color={WU_MUTED}/>
          <span>search upcoming…</span>
          <span style={{flex:1}}/>
          <span style={{padding:'1px 6px', fontSize:9.5, border:`1px solid ${WU_RULE2}`, color:WU_MUTED}}>⌘K</span>
        </div>
      </div>
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:WU_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Navigate
        </div>
        {items.map(({key, label, Icon:Ic, active, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10, padding:'7px 12px', margin:'1px 0',
            background: active ? WU_SURF : 'transparent',
            color: active ? WU_INK : WU_MUTED,
            fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
            cursor:'pointer',
            borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
          }}>
            <Ic size={15} color={active ? WU_INK : WU_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && <span style={{fontFamily:SB.mono, fontSize:11, color:WU_FAINT}}>{count}</span>}
          </div>
        ))}
        <div style={{padding:'18px 12px 8px', fontFamily:SB.mono, fontSize:10, color:WU_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Filter by
        </div>
        {Object.entries(HIFI_KINDS).map(([key, k])=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10, padding:'6px 12px', margin:'1px 0',
            color:WU_MUTED, fontFamily:SB.sans, fontSize:13, cursor:'pointer',
          }}>
            <span style={{width:9, height:9, borderRadius:999, background:wuKind(key)}}/>
            <span style={{flex:1}}>{k.label}</span>
            <span style={{fontFamily:SB.mono, fontSize:11, color:WU_FAINT}}>
              {HIFI_UP_FULL.filter(s=>s.kind===key).length}
            </span>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px', borderTop:`1px solid ${WU_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:WU_SURF2, color:WU_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:WU_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WU_FAINT, marginTop:1}}>synced 3m ago</div>
        </div>
        <Icon.More size={14} color={WU_MUTED}/>
      </div>
    </div>
  );
}

function MonthTabs({sel, onSel}) {
  return (
    <div style={{
      display:'flex', alignItems:'stretch',
      border:`1px solid ${WU_RULE2}`, background:WU_BG,
    }}>
      {HIFI_UP_CAL.months.map((m, i)=>{
        const active = sel === m.m;
        const count = HIFI_UP_FULL.filter(s=>s.date.m===m.m).length;
        return (
          <button key={m.m} onClick={()=>onSel(m.m)} style={{
            padding:'10px 18px',
            border:'none',
            borderRight: i === HIFI_UP_CAL.months.length-1 ? 'none' : `1px solid ${WU_RULE2}`,
            background: active ? WU_INK : 'transparent',
            color: active ? WU_BG : WU_INK,
            fontFamily:SB.sans, fontSize:14, fontWeight: active ? 600 : 500,
            letterSpacing:-0.2, cursor:'pointer',
            display:'flex', alignItems:'baseline', gap:8,
            fontFeatureSettings:'"tnum"',
          }}>
            <span>{m.long}</span>
            <span style={{
              fontFamily:SB.mono, fontSize:10,
              color: active ? WU_BG : WU_FAINT,
              opacity: active ? .7 : 1, fontWeight:400,
            }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function CalendarGrid({monthKey}) {
  const m = HIFI_UP_CAL.months.find(x => x.m === monthKey) || HIFI_UP_CAL.months[0];
  const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const cells = [];
  for (let i=0;i<m.firstDow;i++) cells.push({empty:true});
  for (let d=1; d<=m.days; d++) {
    const iso = `${m.y}-${String({APR:4,MAY:5,JUN:6,JUL:7,AUG:8}[m.m]).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({d, iso, shows: HIFI_UP_CAL.byIso[iso] || []});
  }
  while (cells.length % 7 !== 0) cells.push({empty:true});
  const weeks = [];
  for (let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));

  const isToday = (iso) => iso === '2026-04-20';

  return (
    <div style={{background:WU_SURF, border:`1px solid ${WU_RULE}`, overflow:'hidden'}}>
      {/* DOW header */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:`1px solid ${WU_RULE2}`}}>
        {DOW.map((d,i)=>(
          <div key={i} style={{
            padding:'8px 12px',
            fontFamily:SB.mono, fontSize:10, color:WU_FAINT,
            letterSpacing:'.1em', textTransform:'uppercase',
            borderRight: i<6 ? `1px solid ${WU_RULE}` : 'none',
          }}>{d}</div>
        ))}
      </div>
      {/* weeks */}
      {weeks.map((week, wi)=>(
        <div key={wi} style={{
          display:'grid', gridTemplateColumns:'repeat(7,1fr)',
          borderBottom: wi<weeks.length-1 ? `1px solid ${WU_RULE}` : 'none',
          minHeight:88,
        }}>
          {week.map((c,ci)=>{
            const today = !c.empty && isToday(c.iso);
            return (
              <div key={ci} style={{
                padding:'6px 8px',
                borderRight: ci<6 ? `1px solid ${WU_RULE}` : 'none',
                background: today ? WU_SURF2 : 'transparent',
                minHeight:88, display:'flex', flexDirection:'column', gap:4,
              }}>
                {!c.empty && (
                  <>
                    <div style={{
                      display:'flex', alignItems:'center', gap:6,
                    }}>
                      <div style={{
                        fontFamily:SB.mono, fontSize:11,
                        color: today ? WU_INK : (c.shows.length > 0 ? WU_INK : WU_MUTED),
                        fontWeight: today || c.shows.length > 0 ? 600 : 400,
                        letterSpacing:'.02em', fontFeatureSettings:'"tnum"',
                      }}>{String(c.d).padStart(2,'0')}</div>
                      {today && (
                        <span style={{
                          fontFamily:SB.mono, fontSize:8.5, color:SB.kinds.concert.inkDark,
                          letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600,
                        }}>today</span>
                      )}
                    </div>
                    {c.shows.map((s,i)=>(
                      <div key={i} style={{
                        padding:'4px 6px',
                        borderLeft:`2px solid ${wuKind(s.kind)}`,
                        background: s.hasTix ? WU_SURF2 : 'transparent',
                        border: s.hasTix ? `none` : `1px dashed ${WU_RULE2}`,
                        borderLeftStyle:'solid', borderLeftColor: wuKind(s.kind), borderLeftWidth:2,
                        display:'flex', flexDirection:'column', gap:1, minWidth:0,
                      }}>
                        <div style={{
                          fontFamily:SB.sans, fontSize:11, fontWeight:600,
                          color: WU_INK, letterSpacing:-0.1, lineHeight:1.2,
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        }}>
                          {s.headliner}
                        </div>
                        <div style={{
                          fontFamily:SB.mono, fontSize:9, color:WU_MUTED,
                          letterSpacing:'.02em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        }}>
                          {s.venue.toLowerCase()}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function UpcomingList({rows}) {
  return (
    <div style={{background:WU_SURF, border:`1px solid ${WU_RULE}`}}>
      <div style={{
        display:'grid',
        gridTemplateColumns:'90px 110px 1.2fr 1fr 120px 70px 90px',
        columnGap:14,
        padding:'10px 18px', borderBottom:`1px solid ${WU_RULE2}`,
        fontFamily:SB.mono, fontSize:9.5, color:WU_FAINT,
        letterSpacing:'.12em', textTransform:'uppercase',
      }}>
        <div>When</div>
        <div>Kind</div>
        <div>Headline</div>
        <div>Venue</div>
        <div>Seat</div>
        <div style={{textAlign:'right'}}>Price</div>
        <div style={{textAlign:'right'}}>Status</div>
      </div>
      {rows.map((s, i)=>(
        <div key={s.id} style={{
          display:'grid',
          gridTemplateColumns:'90px 110px 1.2fr 1fr 120px 70px 90px',
          columnGap:14,
          padding:'14px 18px', borderBottom: i<rows.length-1 ? `1px solid ${WU_RULE}` : 'none',
          alignItems:'center',
        }}>
          <div>
            <div style={{fontFamily:SB.sans, fontSize:16, color:WU_INK, fontWeight:500, letterSpacing:-0.4, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
              {s.date.m} {s.date.d}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:WU_FAINT, marginTop:3, letterSpacing:'.04em'}}>
              {s.date.dow.toLowerCase()} · in {s.countdown}
            </div>
          </div>
          <div style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:wuKind(s.kind), letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>
            <span style={{width:6, height:6, borderRadius:999, background:wuKind(s.kind)}}/>
            {HIFI_KINDS[s.kind].label}
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:WU_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {s.headliner}
            </div>
            {s.support.length>0 && (
              <div style={{fontFamily:SB.sans, fontSize:11.5, color:WU_MUTED, marginTop:2, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                + {s.support.slice(0,3).join(', ')}
              </div>
            )}
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:SB.sans, fontSize:13, color:WU_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {s.venue}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:WU_MUTED, marginTop:2, letterSpacing:'.02em'}}>
              {(s.neighborhood||'').toLowerCase()}
            </div>
          </div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WU_MUTED}}>
            {s.seat || '—'}
          </div>
          <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color: s.paid ? WU_INK : WU_FAINT, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
            {s.paid ? `$${s.paid}` : '—'}
          </div>
          <div style={{display:'flex', justifyContent:'flex-end'}}>
            {s.hasTix ? (
              <div style={{
                padding:'3px 8px', background:WU_INK, color:WU_BG,
                fontFamily:SB.mono, fontSize:10, letterSpacing:'.08em',
                textTransform:'uppercase', fontWeight:500,
                display:'inline-flex', alignItems:'center', gap:5,
              }}>
                <Icon.Check size={10} color={WU_BG}/> tix
              </div>
            ) : (
              <div style={{
                padding:'3px 8px', border:`1px dashed ${WU_RULE2}`,
                fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.06em',
                textTransform:'uppercase', fontWeight:500,
              }}>
                {s.src}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function VenueLens() {
  return (
    <div style={{padding:'18px 20px', background:WU_SURF, borderBottom:`1px solid ${WU_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          By venue
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.04em'}}>
          {HIFI_UP_BY_VENUE.length} venues
        </div>
      </div>
      {HIFI_UP_BY_VENUE.map((v,i)=>(
        <div key={v.name} style={{
          padding:'10px 0',
          borderTop: i===0 ? 'none' : `1px solid ${WU_RULE}`,
        }}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:13, color:WU_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {v.name}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:WU_FAINT, marginTop:2, letterSpacing:'.02em'}}>
                {(v.neighborhood||'').toLowerCase()}
              </div>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, fontWeight:500}}>
              {v.shows.length}×
            </div>
          </div>
          <div style={{display:'flex', gap:4, marginTop:6, flexWrap:'wrap'}}>
            {v.shows.map((s,j)=>(
              <span key={j} style={{
                fontFamily:SB.mono, fontSize:9.5, color:wuKind(s.kind),
                letterSpacing:'.04em', padding:'1px 5px',
                border:`1px solid ${WU_RULE2}`,
                display:'inline-flex', alignItems:'center', gap:4,
              }}>
                <span style={{width:5, height:5, borderRadius:999, background:wuKind(s.kind)}}/>
                {s.date.m} {s.date.d}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportHelpers() {
  const rows = [
    {label:'Scan Gmail for receipts',     meta:'auto',  Ic:Icon.ArrowUpRight},
    {label:'Paste Ticketmaster URL',       meta:'link',  Ic:Icon.ArrowUpRight},
    {label:'Upload PDF ticket',            meta:'file',  Ic:Icon.ArrowUpRight},
    {label:'Sync calendar (iCal)',         meta:'feed',  Ic:Icon.ArrowUpRight},
  ];
  return (
    <div style={{padding:'18px 20px', background:WU_SURF, borderBottom:`1px solid ${WU_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Or import from
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.04em'}}>
          past & future
        </div>
      </div>
      {rows.map((r,i)=>(
        <div key={i} style={{
          display:'grid', gridTemplateColumns:'1fr 50px 14px', columnGap:10,
          alignItems:'center', padding:'10px 0',
          borderTop: i===0 ? 'none' : `1px solid ${WU_RULE}`,
          cursor:'pointer',
        }}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:WU_INK, letterSpacing:-0.1}}>
            {r.label}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:WU_FAINT, letterSpacing:'.06em', textTransform:'uppercase', textAlign:'right'}}>
            {r.meta}
          </div>
          <Icon.ChevronRight size={13} color={WU_MUTED}/>
        </div>
      ))}
      <div style={{fontFamily:SB.mono, fontSize:9.5, color:WU_FAINT, marginTop:10, letterSpacing:'.02em', lineHeight:1.5}}>
        Ticketmaster keeps this list fresh for saved artists & venues.
      </div>
    </div>
  );
}

function OnSaleWatcher() {
  const watching = HIFI_UP_FULL.filter(s=>!s.hasTix);
  return (
    <div style={{padding:'18px 20px', background:WU_SURF}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          On the watch
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.04em'}}>
          {watching.length} no tix
        </div>
      </div>
      {watching.map((s,i)=>(
        <div key={s.id} style={{
          display:'grid', gridTemplateColumns:'1fr auto', columnGap:10,
          alignItems:'center', padding:'9px 0',
          borderTop: i===0 ? 'none' : `1px solid ${WU_RULE}`,
        }}>
          <div style={{minWidth:0}}>
            <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
              <span style={{width:5, height:5, borderRadius:999, background:wuKind(s.kind)}}/>
              <span style={{fontFamily:SB.mono, fontSize:9, color:wuKind(s.kind), letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>
                {HIFI_KINDS[s.kind].label}
              </span>
            </div>
            <div style={{fontFamily:SB.sans, fontSize:13, color:WU_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {s.headliner}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:WU_MUTED, marginTop:1, letterSpacing:'.02em'}}>
              {s.date.m} {s.date.d} · {s.venue.toLowerCase()}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, color: s.onSale ? SB.kinds.concert.inkDark : WU_MUTED,
              letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
              padding:'2px 6px', border:`1px ${s.onSale?'solid':'dashed'} ${s.onSale?SB.kinds.concert.inkDark:WU_RULE2}`,
            }}>
              {s.onSale || s.src}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UpcomingWeb() {
  const [month, setMonth] = React.useState('MAY');
  const listRows = HIFI_UP_FULL.filter(s => s.date.m === month);

  return (
    <div style={{
      width:'100%', height:'100%', background:WU_BG, color:WU_INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <UpSidebar/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar */}
        <div style={{
          padding:'14px 28px', display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${WU_RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:WU_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              <span style={{color:WU_FAINT}}>Home</span>
              <span style={{color:WU_FAINT, margin:'0 8px'}}>›</span>
              Upcoming
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:WU_INK, letterSpacing:-0.7, marginTop:3}}>
              What's coming up
            </div>
          </div>
          <div style={{display:'flex', gap:28, alignItems:'center'}}>
            {[
              ['Queued',   HIFI_UP_TOTALS.total,    'next 15w'],
              ['Ticketed', HIFI_UP_TOTALS.ticketed, '~60%'],
              ['Watching', HIFI_UP_TOTALS.watching, 'no tix'],
              ['Paid',     '$'+HIFI_UP_TOTALS.paid, 'so far'],
            ].map(([l,v,sub])=>(
              <div key={l} style={{display:'flex', flexDirection:'column'}}>
                <div style={{display:'flex', alignItems:'baseline', gap:6}}>
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:WU_INK, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>{v}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:WU_FAINT, letterSpacing:'.04em'}}>{sub}</div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:WU_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:4}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Month + view switches */}
        <div style={{
          padding:'14px 28px 16px', background:WU_SURF,
          borderBottom:`1px solid ${WU_RULE}`,
          display:'flex', alignItems:'center', gap:20,
        }}>
          <div style={{display:'flex', flexDirection:'column', gap:2}}>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:WU_FAINT, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
              Viewing
            </div>
            <div style={{fontFamily:SB.sans, fontSize:13, color:WU_MUTED, letterSpacing:-0.1}}>
              Calendar + list filtered to month
            </div>
          </div>
          <MonthTabs sel={month} onSel={setMonth}/>
          <div style={{
            display:'flex', alignItems:'center', gap:8,
            fontFamily:SB.mono, fontSize:10.5, color:WU_MUTED, letterSpacing:'.04em',
          }}>
            <Icon.Filter size={12} color={WU_MUTED}/>
            <span>{listRows.length} shows this month</span>
          </div>
          <div style={{flex:1}}/>
          <div style={{display:'flex', gap:10}}>
            <div style={{padding:'6px 10px', fontFamily:SB.mono, fontSize:11, color:WU_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer', border:`1px solid ${WU_RULE}`}}>
              <Icon.Filter size={12} color={WU_MUTED}/> All kinds
            </div>
            <div style={{padding:'6px 10px', fontFamily:SB.mono, fontSize:11, color:WU_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer', border:`1px solid ${WU_RULE}`}}>
              <Icon.Ticket size={12} color={WU_MUTED}/> Tix + watching
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div style={{
          flex:1, display:'grid', gridTemplateColumns:'1fr 340px',
          minHeight:0, overflow:'hidden',
        }}>
          {/* Left */}
          <div style={{padding:'20px 28px', overflow:'auto', display:'flex', flexDirection:'column', gap:20}}>
            <div>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <Icon.Calendar size={14} color={WU_INK}/>
                  <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
                    {HIFI_UP_CAL.months.find(x=>x.m===month).long} 2026
                  </div>
                </div>
                <div style={{display:'flex', gap:12, alignItems:'center', fontFamily:SB.mono, fontSize:10, color:WU_MUTED}}>
                  <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                    <span style={{width:10, height:6, background:WU_SURF2, borderLeft:`2px solid ${SB.kinds.concert.inkDark}`}}/> ticketed
                  </span>
                  <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                    <span style={{width:10, height:6, border:`1px dashed ${WU_RULE2}`, borderLeft:`2px solid ${SB.kinds.concert.inkDark}`}}/> watching
                  </span>
                </div>
              </div>
              <CalendarGrid monthKey={month}/>
            </div>
            <div>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <Icon.ArrowUpRight size={14} color={WU_INK}/>
                  <div style={{fontFamily:SB.mono, fontSize:11, color:WU_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
                    List · {HIFI_UP_CAL.months.find(x=>x.m===month).long}
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:WU_FAINT, letterSpacing:'.04em'}}>
                    {listRows.length} shows
                  </div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:WU_MUTED, letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6}}>
                  <Icon.Sort size={11} color={WU_MUTED}/> date ascending
                </div>
              </div>
              {listRows.length > 0 ? (
                <UpcomingList rows={listRows}/>
              ) : (
                <div style={{
                  padding:'40px 20px', background:WU_SURF, border:`1px solid ${WU_RULE}`,
                  fontFamily:SB.mono, fontSize:11, color:WU_FAINT, textAlign:'center', letterSpacing:'.04em',
                }}>no shows scheduled in this month</div>
              )}
            </div>
          </div>
          {/* Right */}
          <div style={{display:'flex', flexDirection:'column', minHeight:0, overflow:'auto', borderLeft:`1px solid ${WU_RULE}`}}>
            <VenueLens/>
            <ImportHelpers/>
            <OnSaleWatcher/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.UpcomingWeb = UpcomingWeb;
