// Direction B · Mono · REFINED
// Geist + Geist Mono. Near-black surfaces optional; default is warm-off-white.
// Real SVG icons. Tighter grid. Per-kind accent via a thin vertical rule,
// a small kind chip, and numeric accent on the headline date.

const { SB, Icon, HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_RHYTHM, HIFI_TOTALS } = window;

const M_MODE = 'light'; // mobile stays light
const M_BG    = SB.bg[M_MODE];
const M_SURF  = SB.surface[M_MODE];
const M_INK   = SB.ink[M_MODE];
const M_MUTED = SB.muted[M_MODE];
const M_FAINT = SB.faint[M_MODE];
const M_RULE  = SB.rule[M_MODE];
const M_RULE2 = SB.ruleStrong[M_MODE];

const mKind = (k) => SB.kinds[k].ink;

function MKindChip({kind}) {
  const k = HIFI_KINDS[kind];
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontFamily:SB.mono, fontSize:10.5, fontWeight:500,
      letterSpacing:'.04em', color:mKind(kind), textTransform:'lowercase',
    }}>
      <span style={{width:5, height:5, borderRadius:999, background:mKind(kind)}}/>
      {k.label.toLowerCase()}
    </span>
  );
}

function MPastRow({show, last}) {
  return (
    <div style={{
      padding:'16px 20px',
      borderBottom: last ? 'none' : `1px solid ${M_RULE}`,
      display:'grid', gridTemplateColumns:'48px 1fr auto', columnGap:16,
      alignItems:'start',
    }}>
      <div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:M_MUTED, letterSpacing:'.02em'}}>
          {show.date.m.toLowerCase()}
        </div>
        <div style={{
          fontFamily:SB.sans, fontSize:24, fontWeight:500, color:M_INK,
          letterSpacing:-0.9, marginTop:2, lineHeight:.95, fontFeatureSettings:'"tnum"',
        }}>{show.date.d}</div>
        <div style={{fontFamily:SB.mono, fontSize:9.5, color:M_FAINT, marginTop:3, letterSpacing:'.02em'}}>
          {show.date.dow.toLowerCase()}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <MKindChip kind={show.kind}/>
        <div style={{
          fontFamily:SB.sans, fontWeight:600, fontSize:17,
          lineHeight:1.2, letterSpacing:-0.35, color:M_INK, marginTop:4,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:SB.sans, fontSize:13, color:M_MUTED,
            marginTop:2, fontWeight:400, letterSpacing:-0.1,
          }}>+ {show.support.join(', ')}</div>
        )}
        <div style={{
          fontFamily:SB.mono, fontSize:10.5, color:M_MUTED,
          marginTop:7, letterSpacing:'.01em',
          display:'flex', alignItems:'center', gap:6,
        }}>
          <Icon.MapPin size={11} color={M_FAINT}/>
          <span style={{color:M_INK, opacity:.75}}>{show.venue.toLowerCase()}</span>
          <span style={{color:M_FAINT}}>·</span>
          <span>{show.neighborhood.toLowerCase()}</span>
        </div>
        {(show.setlistCount || show.cast) && (
          <div style={{
            fontFamily:SB.mono, fontSize:10, color:M_FAINT,
            marginTop:4, letterSpacing:'.01em',
            display:'flex', alignItems:'center', gap:6,
          }}>
            <Icon.Music size={10}/>
            {show.setlistCount && <span>{show.setlistCount} songs{show.encore ? ' · encore' : ''}</span>}
            {show.cast && <span>{show.cast.join(', ').toLowerCase()}</span>}
          </div>
        )}
      </div>
      <div style={{textAlign:'right'}}>
        <div style={{fontFamily:SB.mono, fontSize:12, color:M_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
          ${show.paid}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:9.5, color:M_FAINT, marginTop:3}}>
          {show.seat.toLowerCase().replace('· ','')}
        </div>
      </div>
    </div>
  );
}

function MUpRow({show}) {
  return (
    <div style={{
      padding:'16px 18px', marginLeft:20, marginRight:20,
      marginBottom:10,
      background: M_SURF,
      borderLeft:`2px solid ${mKind(show.kind)}`,
      display:'grid', gridTemplateColumns:'68px 1fr auto', columnGap:14,
      alignItems:'start',
    }}>
      <div>
        <div style={{display:'flex', alignItems:'baseline', gap:4}}>
          <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:M_INK, letterSpacing:-0.8, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>
            {show.date.d}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:mKind(show.kind), letterSpacing:'.04em', fontWeight:500}}>
            {show.date.m.toLowerCase()}
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:M_MUTED, marginTop:4, letterSpacing:'.01em'}}>
          {show.countdown}
        </div>
        <div style={{
          marginTop:7, display:'inline-flex', alignItems:'center', gap:4,
          fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em', fontWeight:500,
          color: show.hasTix ? M_INK : M_MUTED, textTransform:'lowercase',
        }}>
          {show.hasTix ? <Icon.SquareFilled size={8}/> : <Icon.Square size={8}/>}
          {show.hasTix ? 'ticketed' : 'watching'}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <MKindChip kind={show.kind}/>
        <div style={{
          fontFamily:SB.sans, fontWeight:600, fontSize:17,
          lineHeight:1.2, letterSpacing:-0.35, color:M_INK, marginTop:4,
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:SB.sans, fontSize:12.5, color:M_MUTED,
            marginTop:2, letterSpacing:-0.1,
          }}>+ {show.support.slice(0,2).join(', ')}{show.support.length>2 && ` +${show.support.length-2}`}</div>
        )}
        <div style={{
          fontFamily:SB.mono, fontSize:10.5, color:M_MUTED, marginTop:7,
          display:'flex', alignItems:'center', gap:6,
        }}>
          <Icon.MapPin size={11} color={M_FAINT}/>
          <span style={{color:M_INK, opacity:.75}}>{show.venue.toLowerCase()}</span>
        </div>
      </div>
      <div style={{textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6}}>
        {show.paid ? (
          <div style={{fontFamily:SB.mono, fontSize:12, color:M_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>${show.paid}</div>
        ) : (
          <div style={{fontFamily:SB.mono, fontSize:10, color:M_FAINT}}>—</div>
        )}
        <Icon.ChevronRight size={14} color={M_FAINT}/>
      </div>
    </div>
  );
}

function MYearBars() {
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  return (
    <div style={{padding:'18px 20px', borderTop:`1px solid ${M_RULE}`, borderBottom:`1px solid ${M_RULE}`}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{
          fontFamily:SB.mono, fontSize:10.5, color:M_INK, letterSpacing:'.06em',
          fontWeight:500, textTransform:'uppercase',
        }}>2026 · rhythm</div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          <div style={{display:'inline-flex', alignItems:'center', gap:4, fontFamily:SB.mono, fontSize:9.5, color:M_MUTED}}>
            <Icon.SquareFilled size={8} color={M_INK}/> attended
          </div>
          <div style={{display:'inline-flex', alignItems:'center', gap:4, fontFamily:SB.mono, fontSize:9.5, color:M_MUTED}}>
            <Icon.Square size={8} color={M_INK}/> ticket
          </div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, alignItems:'end', height:60}}>
        {HIFI_RHYTHM.map((m,i)=>{
          const isNow = i===3; // APR
          return (
            <div key={i} style={{
              display:'flex', flexDirection:'column-reverse', gap:2, height:'100%',
              position:'relative',
            }}>
              {Array.from({length:m.a}).map((_,j)=>(
                <div key={'a'+j} style={{height:11, background:M_INK}}/>
              ))}
              {Array.from({length:m.t}).map((_,j)=>(
                <div key={'t'+j} style={{height:11, border:`1.25px solid ${M_INK}`, background:'transparent'}}/>
              ))}
              {isNow && (
                <div style={{
                  position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)',
                  width:2, height:4, background:SB.kinds.concert.ink,
                }}/>
              )}
            </div>
          );
        })}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, marginTop:8}}>
        {months.map((m,i)=>(
          <div key={i} style={{
            textAlign:'center', fontFamily:SB.mono, fontSize:10,
            color: i===3 ? M_INK : M_FAINT, letterSpacing:'.02em',
            fontWeight: i===3 ? 500 : 400,
          }}>{m}</div>
        ))}
      </div>
    </div>
  );
}

function HomeMonoRefined() {
  return (
    <div style={{
      height:'100%', background:M_BG, color:M_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'62px 20px 20px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:M_MUTED, letterSpacing:'.04em'}}>
            mon · 20 apr
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center', color:M_INK}}>
            <Icon.Search size={18} color={M_INK}/>
            <Icon.More size={18} color={M_INK}/>
          </div>
        </div>
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          marginTop:22,
        }}>
          <div style={{fontFamily:SB.sans, fontSize:28, fontWeight:600, color:M_INK, letterSpacing:-0.9}}>
            showbook
            <span style={{color:M_FAINT, fontWeight:400}}>/m</span>
          </div>
          <div style={{
            fontFamily:SB.mono, fontSize:10, color:M_MUTED,
            letterSpacing:'.06em', textTransform:'uppercase',
          }}>NYC</div>
        </div>
        <div style={{display:'flex', gap:24, marginTop:18}}>
          {[
            ['shows', HIFI_TOTALS.shows],
            ['spent', HIFI_TOTALS.spent],
            ['venues', HIFI_TOTALS.venues],
            ['artists', HIFI_TOTALS.artists],
          ].map(([l,v])=>(
            <div key={l}>
              <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:M_INK, letterSpacing:-0.7, fontFeatureSettings:'"tnum"', lineHeight:1}}>
                {v}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:M_MUTED, letterSpacing:'.04em', marginTop:4}}>
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {/* Upcoming header */}
        <div style={{padding:'14px 20px 12px', borderTop:`1px solid ${M_RULE2}`, display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.ArrowUpRight size={14} color={M_INK}/>
            <div style={{fontFamily:SB.mono, fontSize:11, color:M_INK, letterSpacing:'.06em', fontWeight:500, textTransform:'uppercase'}}>
              Upcoming
            </div>
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:M_MUTED, letterSpacing:'.02em'}}>
            next 90d · 4
          </div>
        </div>
        <div>
          {HIFI_UPCOMING.map(s=><MUpRow key={s.id} show={s}/>)}
        </div>

        {/* Year */}
        <MYearBars/>

        {/* Past */}
        <div style={{padding:'16px 20px 10px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.Archive size={14} color={M_INK}/>
            <div style={{fontFamily:SB.mono, fontSize:11, color:M_INK, letterSpacing:'.06em', fontWeight:500, textTransform:'uppercase'}}>
              Recent
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:M_MUTED}}>
            87 total <Icon.ArrowRight size={11} color={M_MUTED}/>
          </div>
        </div>
        <div style={{borderTop:`1px solid ${M_RULE}`}}>
          {HIFI_PAST.map((s,i)=>(
            <MPastRow key={s.id} show={s} last={i===HIFI_PAST.length-1}/>
          ))}
        </div>

        <div style={{
          padding:'22px 20px 12px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:M_FAINT, letterSpacing:'.14em',
        }}>— END OF FEED —</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1px solid ${M_RULE2}`, background:M_BG,
        padding:'12px 8px 30px', alignItems:'center',
      }}>
        {[
          { key:'home',  label:'Home',  Icon:Icon.Home,     active:true },
          { key:'past',  label:'Past',  Icon:Icon.Archive,  active:false },
          { key:'add',   label:'Add',   Icon:Icon.Plus,     cta:true },
          { key:'map',   label:'Map',   Icon:Icon.Map,      active:false },
          { key:'me',    label:'Me',    Icon:Icon.User,     active:false },
        ].map(({key, label, Icon:Ic, active, cta})=>(
          <div key={key} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta ? 34 : 26, height: cta ? 34 : 26,
              background: cta ? M_INK : 'transparent',
              color: cta ? M_BG : (active ? M_INK : M_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta ? 999 : 0,
            }}>
              <Ic size={cta ? 20 : 18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active ? M_INK : M_MUTED, fontWeight: active ? 500 : 400,
              textTransform:'lowercase',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.HomeMonoRefined = HomeMonoRefined;
