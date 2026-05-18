// Mobile · Upcoming / Calendar
// Matches HomeMonoRefined style — warm light, Geist + Geist Mono,
// per-kind accents (thin vertical rule on each row + kind chip).
// Layout: header → filter chips → view toggle (list/calendar) → grouped list → totals.

const { SB, Icon, HIFI_KINDS, HIFI_UP_FULL, HIFI_UP_BY_VENUE, HIFI_UP_TOTALS, HIFI_UP_CAL } = window;

const U_MODE  = 'light';
const U_BG    = SB.bg[U_MODE];
const U_SURF  = SB.surface[U_MODE];
const U_SURF2 = SB.surface2[U_MODE];
const U_INK   = SB.ink[U_MODE];
const U_MUTED = SB.muted[U_MODE];
const U_FAINT = SB.faint[U_MODE];
const U_RULE  = SB.rule[U_MODE];
const U_RULE2 = SB.ruleStrong[U_MODE];

const uKind = (k) => SB.kinds[k].ink;

function UpKindChip({kind}) {
  const k = HIFI_KINDS[kind];
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontFamily:SB.mono, fontSize:10, fontWeight:500,
      letterSpacing:'.06em', color:uKind(kind), textTransform:'uppercase',
    }}>
      <span style={{width:5, height:5, borderRadius:999, background:uKind(kind)}}/>
      {k.label}
    </span>
  );
}

function UpRow({show, last}) {
  return (
    <div style={{
      padding:'14px 20px 14px 18px',
      borderBottom: last ? 'none' : `1px solid ${U_RULE}`,
      borderLeft:`2px solid ${uKind(show.kind)}`,
      display:'grid', gridTemplateColumns:'56px 1fr auto', columnGap:14,
      alignItems:'start', background:U_SURF,
    }}>
      <div>
        <div style={{display:'flex', alignItems:'baseline', gap:4}}>
          <div style={{
            fontFamily:SB.sans, fontSize:22, fontWeight:500, color:U_INK,
            letterSpacing:-0.8, lineHeight:.95, fontFeatureSettings:'"tnum"',
          }}>{show.date.d}</div>
        </div>
        <div style={{
          fontFamily:SB.mono, fontSize:9.5, color:uKind(show.kind),
          marginTop:4, letterSpacing:'.06em', fontWeight:500,
        }}>{show.date.m.toLowerCase()} · {show.date.dow.toLowerCase()}</div>
        <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_FAINT, marginTop:3, letterSpacing:'.02em'}}>
          in {show.countdown}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <UpKindChip kind={show.kind}/>
        <div style={{
          fontFamily:SB.sans, fontWeight:600, fontSize:16.5,
          lineHeight:1.2, letterSpacing:-0.35, color:U_INK, marginTop:4,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:SB.sans, fontSize:12, color:U_MUTED, marginTop:2,
            letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>+ {show.support.slice(0,2).join(', ')}{show.support.length>2 && ` +${show.support.length-2}`}</div>
        )}
        <div style={{
          fontFamily:SB.mono, fontSize:10.5, color:U_MUTED, marginTop:7,
          display:'flex', alignItems:'center', gap:6,
        }}>
          <Icon.MapPin size={11} color={U_FAINT}/>
          <span style={{color:U_INK, opacity:.75, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
            {show.venue.toLowerCase()}
          </span>
        </div>
      </div>
      <div style={{textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, minWidth:70}}>
        {show.hasTix ? (
          <>
            <div style={{
              display:'inline-flex', alignItems:'center', gap:4,
              padding:'2px 6px', background:U_INK, color:U_BG,
              fontFamily:SB.mono, fontSize:9, letterSpacing:'.08em',
              textTransform:'uppercase', fontWeight:500,
            }}>
              <Icon.Check size={9} color={U_BG}/> tix
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11.5, color:U_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>${show.paid}</div>
            <div style={{fontFamily:SB.mono, fontSize:9, color:U_FAINT, letterSpacing:'.02em'}}>
              {show.seat ? show.seat.toLowerCase().split('·')[0].trim() : ''}
            </div>
          </>
        ) : (
          <>
            <div style={{
              display:'inline-flex', alignItems:'center', gap:4,
              padding:'2px 6px', border:`1px dashed ${U_RULE2}`,
              fontFamily:SB.mono, fontSize:9, color:U_MUTED, letterSpacing:'.08em',
              textTransform:'uppercase', fontWeight:500,
            }}>
              <Icon.Eye size={9} color={U_MUTED}/> watching
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_FAINT, letterSpacing:'.02em', textAlign:'right'}}>
              {show.src}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UpMonthHeader({label, count, paid}) {
  return (
    <div style={{
      padding:'14px 20px 10px',
      background:U_SURF2,
      borderTop:`1px solid ${U_RULE2}`,
      borderBottom:`1px solid ${U_RULE}`,
      display:'flex', alignItems:'baseline', justifyContent:'space-between',
      position:'sticky', top:0, zIndex:2,
    }}>
      <div style={{display:'flex', alignItems:'baseline', gap:10}}>
        <div style={{
          fontFamily:SB.sans, fontSize:20, fontWeight:600, color:U_INK,
          letterSpacing:-0.7, lineHeight:1,
        }}>{label}</div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:U_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
          {count} {count===1?'show':'shows'}{paid ? ` · $${paid}` : ''}
        </div>
      </div>
    </div>
  );
}

function FilterRow({kind, onKind, tix, onTix}) {
  const kinds = [
    {k:'all', label:'all'},
    {k:'concert', label:'concert'},
    {k:'theatre', label:'theatre'},
    {k:'comedy', label:'comedy'},
    {k:'festival', label:'festival'},
  ];
  return (
    <div style={{
      padding:'10px 20px 12px', borderBottom:`1px solid ${U_RULE}`,
      display:'flex', flexDirection:'column', gap:8,
    }}>
      <div style={{display:'flex', gap:5, overflowX:'auto', scrollbarWidth:'none'}}>
        {kinds.map(({k, label})=>{
          const active = k === kind;
          const isAll = k==='all';
          return (
            <div key={k} onClick={()=>onKind(k)} style={{
              padding:'5px 10px',
              background: active ? U_INK : 'transparent',
              color: active ? U_BG : U_INK,
              border: `1px solid ${active ? U_INK : U_RULE2}`,
              fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.04em',
              display:'inline-flex', alignItems:'center', gap:5, flexShrink:0,
              fontWeight: active ? 500 : 400, textTransform:'lowercase',
            }}>
              {!isAll && <span style={{width:6, height:6, borderRadius:999, background: active ? U_BG : uKind(k)}}/>}
              {label}
            </div>
          );
        })}
      </div>
      <div style={{display:'flex', gap:5}}>
        {[
          {k:'both', label:'all'},
          {k:'tix',  label:'have tix'},
          {k:'watch',label:'watching'},
        ].map(({k, label})=>{
          const active = k===tix;
          return (
            <div key={k} onClick={()=>onTix(k)} style={{
              padding:'5px 10px', flex:1, textAlign:'center',
              background: active ? U_INK : 'transparent',
              color: active ? U_BG : U_MUTED,
              border:`1px solid ${active ? U_INK : U_RULE2}`,
              fontFamily:SB.mono, fontSize:10, letterSpacing:'.04em',
              textTransform:'lowercase', fontWeight: active ? 500 : 400,
            }}>{label}</div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar() {
  // Focus month: MAY 2026 (has the most upcoming activity). Show weeks grid.
  const m = HIFI_UP_CAL.months[1]; // MAY
  const DOW = ['S','M','T','W','T','F','S'];
  const cells = [];
  for (let i=0;i<m.firstDow;i++) cells.push({empty:true});
  for (let d=1; d<=m.days; d++) {
    const iso = `2026-05-${String(d).padStart(2,'0')}`;
    const shows = HIFI_UP_CAL.byIso[iso] || [];
    cells.push({d, shows});
  }
  while (cells.length % 7 !== 0) cells.push({empty:true});

  return (
    <div style={{borderBottom:`1px solid ${U_RULE}`, background:U_BG}}>
      <div style={{
        padding:'14px 20px 6px', display:'flex',
        alignItems:'baseline', justifyContent:'space-between',
      }}>
        <div style={{display:'flex', alignItems:'baseline', gap:8}}>
          <div style={{fontFamily:SB.sans, fontSize:18, fontWeight:600, color:U_INK, letterSpacing:-0.5}}>
            May <span style={{color:U_FAINT, fontWeight:400}}>2026</span>
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
            3 upcoming
          </div>
        </div>
        <div style={{display:'flex', gap:10, color:U_MUTED}}>
          <Icon.ChevronRight size={14} color={U_MUTED} style={{transform:'rotate(180deg)'}}/>
          <Icon.ChevronRight size={14} color={U_INK}/>
        </div>
      </div>
      <div style={{padding:'0 16px 14px'}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:0}}>
          {DOW.map((d,i)=>(
            <div key={i} style={{
              textAlign:'center', fontFamily:SB.mono, fontSize:9,
              color:U_FAINT, letterSpacing:'.08em', padding:'4px 0',
            }}>{d}</div>
          ))}
          {cells.map((c,i)=>{
            if (c.empty) return <div key={i} style={{height:38}}/>;
            const hasShows = c.shows.length>0;
            const primary = hasShows ? c.shows[0] : null;
            return (
              <div key={i} style={{
                height:38, padding:'3px 0 0',
                borderTop:`1px solid ${U_RULE}`,
                position:'relative',
                display:'flex', flexDirection:'column', alignItems:'center',
              }}>
                <div style={{
                  fontFamily:SB.mono, fontSize:11,
                  color: hasShows ? U_INK : U_MUTED,
                  fontWeight: hasShows ? 600 : 400,
                  fontFeatureSettings:'"tnum"',
                }}>{c.d}</div>
                {hasShows && (
                  <div style={{display:'flex', gap:2, marginTop:4}}>
                    {c.shows.slice(0,3).map((s,j)=>(
                      <div key={j} style={{
                        width:5, height:5, background:uKind(s.kind),
                      }}/>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpcomingMobile() {
  const [kind, setKind] = React.useState('all');
  const [tix, setTix] = React.useState('both');
  const [view, setView] = React.useState('list');

  const filtered = HIFI_UP_FULL.filter(s => {
    if (kind!=='all' && s.kind!==kind) return false;
    if (tix==='tix'   && !s.hasTix)    return false;
    if (tix==='watch' && s.hasTix)     return false;
    return true;
  });

  // Group by month
  const byMonth = {};
  filtered.forEach(s => {
    const key = `${s.date.m} ${s.date.y}`;
    (byMonth[key] = byMonth[key] || []).push(s);
  });
  const monthOrder = ['APR 2026','MAY 2026','JUN 2026','JUL 2026','AUG 2026'];

  return (
    <div style={{
      height:'100%', background:U_BG, color:U_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'62px 20px 16px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:8, color:U_INK}}>
            <Icon.ChevronRight size={16} color={U_INK} style={{transform:'rotate(180deg)'}}/>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:U_MUTED, letterSpacing:'.04em'}}>
              home
            </div>
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center', color:U_INK}}>
            <Icon.Search size={18} color={U_INK}/>
            <Icon.Plus size={18} color={U_INK}/>
          </div>
        </div>
        <div style={{marginTop:20}}>
          <div style={{fontFamily:SB.sans, fontSize:32, fontWeight:600, color:U_INK, letterSpacing:-1.2, lineHeight:.95}}>
            Upcoming
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:U_MUTED, letterSpacing:'.04em', marginTop:6}}>
            next 15 weeks · through aug 2026
          </div>
        </div>
        <div style={{display:'flex', gap:22, marginTop:20}}>
          {[
            ['total',    HIFI_UP_TOTALS.total],
            ['ticketed', HIFI_UP_TOTALS.ticketed],
            ['watching', HIFI_UP_TOTALS.watching],
            ['paid',     '$'+HIFI_UP_TOTALS.paid],
          ].map(([l,v])=>(
            <div key={l}>
              <div style={{fontFamily:SB.sans, fontSize:20, fontWeight:500, color:U_INK, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>
                {v}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_MUTED, letterSpacing:'.04em', marginTop:4}}>
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* View toggle */}
      <div style={{padding:'0 20px 12px', display:'flex', gap:4, borderBottom:`1px solid ${U_RULE}`}}>
        {[
          {k:'list', label:'list', Ic:Icon.Archive},
          {k:'cal',  label:'calendar', Ic:Icon.Calendar},
        ].map(({k, label, Ic})=>{
          const active = view===k;
          return (
            <div key={k} onClick={()=>setView(k)} style={{
              padding:'6px 10px',
              background: active ? U_INK : 'transparent',
              color: active ? U_BG : U_MUTED,
              border:`1px solid ${active ? U_INK : U_RULE2}`,
              fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.04em',
              display:'inline-flex', alignItems:'center', gap:6,
              textTransform:'lowercase', fontWeight: active ? 500 : 400,
            }}>
              <Ic size={11} color={active ? U_BG : U_MUTED}/>
              {label}
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <FilterRow kind={kind} onKind={setKind} tix={tix} onTix={setTix}/>

      {/* Body — list or calendar */}
      <div style={{flex:1, overflow:'auto'}}>
        {view==='cal' && <MiniCalendar/>}

        {monthOrder.map(mk => {
          const rows = byMonth[mk];
          if (!rows || rows.length===0) return null;
          const [m,y] = mk.split(' ');
          const monthLong = {APR:'April',MAY:'May',JUN:'June',JUL:'July',AUG:'August'}[m];
          const paid = rows.reduce((a,s)=>a+(s.paid||0),0);
          return (
            <div key={mk}>
              <UpMonthHeader label={`${monthLong} ${y}`} count={rows.length} paid={paid || null}/>
              <div>
                {rows.map((s,i)=>(
                  <UpRow key={s.id} show={s} last={i===rows.length-1}/>
                ))}
              </div>
            </div>
          );
        })}

        {/* Import tools */}
        <div style={{padding:'22px 20px 16px', borderTop:`1px solid ${U_RULE2}`, background:U_SURF}}>
          <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:10}}>
            <Icon.ArrowUpRight size={13} color={U_INK}/>
            <div style={{fontFamily:SB.mono, fontSize:11, color:U_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              Or import from
            </div>
          </div>
          {[
            {label:'scan gmail for receipts', meta:'auto'},
            {label:'paste ticketmaster url',  meta:'link'},
            {label:'upload pdf ticket',       meta:'file'},
          ].map((r,i)=>(
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'1fr auto auto', columnGap:10,
              alignItems:'center', padding:'11px 0',
              borderTop: i===0 ? 'none' : `1px solid ${U_RULE}`,
            }}>
              <div style={{fontFamily:SB.sans, fontSize:13, color:U_INK, letterSpacing:-0.1}}>
                {r.label}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_FAINT, letterSpacing:'.06em', textTransform:'uppercase'}}>
                {r.meta}
              </div>
              <Icon.ChevronRight size={13} color={U_MUTED}/>
            </div>
          ))}
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:U_FAINT, marginTop:8, letterSpacing:'.02em', lineHeight:1.5}}>
            also: ticketmaster keeps this list fresh for saved artists & venues.
          </div>
        </div>

        <div style={{
          padding:'22px 20px 12px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:U_FAINT, letterSpacing:'.14em',
        }}>— END OF QUEUE —</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1px solid ${U_RULE2}`, background:U_BG,
        padding:'12px 8px 30px', alignItems:'center',
      }}>
        {[
          { key:'home',  label:'Home',  Icon:Icon.Home,     active:false },
          { key:'up',    label:'Up',    Icon:Icon.Calendar, active:true },
          { key:'add',   label:'Add',   Icon:Icon.Plus,     cta:true },
          { key:'past',  label:'Past',  Icon:Icon.Archive,  active:false },
          { key:'me',    label:'Me',    Icon:Icon.User,     active:false },
        ].map(({key, label, Icon:Ic, active, cta})=>(
          <div key={key} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta ? 34 : 26, height: cta ? 34 : 26,
              background: cta ? U_INK : 'transparent',
              color: cta ? U_BG : (active ? U_INK : U_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta ? 999 : 0,
            }}>
              <Ic size={cta ? 20 : 18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active ? U_INK : U_MUTED, fontWeight: active ? 500 : 400,
              textTransform:'lowercase',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.UpcomingMobile = UpcomingMobile;
