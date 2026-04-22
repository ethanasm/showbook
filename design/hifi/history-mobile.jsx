// Mobile · History · archive
// Matches HomeMonoRefined style — warm light, Geist, per-kind accents.

const { SB, Icon, HIFI_KINDS, HIFI_ARCHIVE, HIFI_YEAR_COUNTS, HIFI_ARCHIVE_TOTALS, HIFI_TOP_VENUES } = window;

const H_MODE = 'light';
const H_BG   = SB.bg[H_MODE];
const H_SURF = SB.surface[H_MODE];
const H_INK  = SB.ink[H_MODE];
const H_MUTED= SB.muted[H_MODE];
const H_FAINT= SB.faint[H_MODE];
const H_RULE = SB.rule[H_MODE];
const H_RULE2= SB.ruleStrong[H_MODE];

const hKind = (k) => SB.kinds[k].ink;

function MKindDot({kind}) {
  return <span style={{width:6, height:6, borderRadius:999, background:hKind(kind), flexShrink:0}}/>;
}

function MYearHeader({y, count, spent, active}) {
  return (
    <div style={{
      padding:'16px 20px 10px',
      background: active ? '#F2F1EC' : 'transparent',
      borderTop:`1px solid ${H_RULE2}`,
      borderBottom:`1px solid ${H_RULE}`,
      display:'flex', alignItems:'baseline', justifyContent:'space-between',
      position:'sticky', top:0, zIndex:2,
    }}>
      <div style={{display:'flex', alignItems:'baseline', gap:10}}>
        <div style={{
          fontFamily:SB.sans, fontSize:24, fontWeight:600, color:H_INK,
          letterSpacing:-0.9, fontFeatureSettings:'"tnum"', lineHeight:1,
        }}>{y}</div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:H_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
          {count} shows · ${spent}
        </div>
      </div>
    </div>
  );
}

function MArchiveRow({show, last}) {
  return (
    <div style={{
      padding:'14px 20px',
      borderBottom: last ? 'none' : `1px solid ${H_RULE}`,
      display:'grid', gridTemplateColumns:'44px 1fr auto', columnGap:14,
      alignItems:'start',
    }}>
      <div>
        <div style={{fontFamily:SB.mono, fontSize:9.5, color:H_MUTED, letterSpacing:'.04em'}}>
          {show.date.m.toLowerCase()}
        </div>
        <div style={{
          fontFamily:SB.sans, fontSize:22, fontWeight:500, color:H_INK,
          letterSpacing:-0.8, marginTop:2, lineHeight:.95, fontFeatureSettings:'"tnum"',
        }}>{show.date.d}</div>
        <div style={{fontFamily:SB.mono, fontSize:9, color:H_FAINT, marginTop:3, letterSpacing:'.02em'}}>
          {show.date.dow.toLowerCase()}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
          <MKindDot kind={show.kind}/>
          <span style={{fontFamily:SB.mono, fontSize:9.5, color:hKind(show.kind), letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            {HIFI_KINDS[show.kind].label}
          </span>
        </div>
        <div style={{
          fontFamily:SB.sans, fontWeight:600, fontSize:15.5,
          lineHeight:1.2, letterSpacing:-0.3, color:H_INK,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:SB.sans, fontSize:12, color:H_MUTED, marginTop:2,
            letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>+ {show.support.slice(0,2).join(', ')}{show.support.length>2 && ` +${show.support.length-2}`}</div>
        )}
        <div style={{
          fontFamily:SB.mono, fontSize:10, color:H_MUTED, marginTop:6,
          letterSpacing:'.01em', display:'flex', alignItems:'center', gap:5,
        }}>
          <Icon.MapPin size={10} color={H_FAINT}/>
          <span style={{color:H_INK, opacity:.75, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
            {show.venue.toLowerCase()}
          </span>
        </div>
      </div>
      <div style={{textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6}}>
        <div style={{fontFamily:SB.mono, fontSize:11.5, color:H_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
          ${show.paid}
        </div>
        <div style={{display:'flex', gap:1}}>
          {Array.from({length:5}).map((_,i)=>(
            <div key={i} style={{
              width:5, height:5,
              background: i < show.rating ? H_INK : 'transparent',
              border: `1px solid ${i < show.rating ? H_INK : H_RULE2}`,
            }}/>
          ))}
        </div>
        {show.plus1 && show.plus1 !== 'solo' && (
          <div style={{fontFamily:SB.mono, fontSize:9, color:H_FAINT, letterSpacing:'.02em'}}>
            +{show.plus1}
          </div>
        )}
      </div>
    </div>
  );
}

function MYearPicker({sel, onSel}) {
  return (
    <div style={{
      display:'flex', gap:4, padding:'12px 20px 14px', overflowX:'auto',
      borderBottom:`1px solid ${H_RULE}`,
      scrollbarWidth:'none',
    }}>
      {HIFI_YEAR_COUNTS.map(({y, count})=>{
        const active = y === sel;
        const empty = count === 0;
        return (
          <div key={y} style={{
            padding:'6px 11px',
            background: active ? H_INK : 'transparent',
            color: active ? H_BG : (empty ? H_FAINT : H_INK),
            border: active ? `1px solid ${H_INK}` : `1px solid ${H_RULE2}`,
            fontFamily:SB.mono, fontSize:11, letterSpacing:'.02em',
            display:'flex', alignItems:'baseline', gap:5, flexShrink:0,
            fontWeight: active ? 500 : 400,
          }}>
            <span style={{fontFeatureSettings:'"tnum"'}}>{y}</span>
            <span style={{fontSize:9, opacity: active ? .7 : .5}}>·{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function MobileHistory() {
  // Group by year for the visible list
  const byYear = {};
  HIFI_ARCHIVE.forEach(s => {
    (byYear[s.date.y] = byYear[s.date.y] || []).push(s);
  });
  const years = Object.keys(byYear).map(Number).sort((a,b)=>b-a);
  const yearMeta = Object.fromEntries(HIFI_YEAR_COUNTS.map(y=>[y.y,y]));

  return (
    <div style={{
      height:'100%', background:H_BG, color:H_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'62px 20px 16px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:8, color:H_INK}}>
            <Icon.ChevronRight size={16} color={H_INK} style={{transform:'rotate(180deg)'}}/>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:H_MUTED, letterSpacing:'.04em'}}>
              home
            </div>
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center', color:H_INK}}>
            <Icon.Search size={18} color={H_INK}/>
            <Icon.Filter size={18} color={H_INK}/>
          </div>
        </div>
        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop:22}}>
          <div>
            <div style={{fontFamily:SB.sans, fontSize:32, fontWeight:600, color:H_INK, letterSpacing:-1.2, lineHeight:.95}}>
              Archive
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:H_MUTED, letterSpacing:'.04em', marginTop:6}}>
              8 yrs · 2019 → 2026
            </div>
          </div>
        </div>
        <div style={{display:'flex', gap:20, marginTop:20}}>
          {[
            ['shows',  HIFI_ARCHIVE_TOTALS.shows],
            ['spent',  HIFI_ARCHIVE_TOTALS.spent],
            ['venues', HIFI_ARCHIVE_TOTALS.venues],
            ['artists',HIFI_ARCHIVE_TOTALS.artists],
          ].map(([l,v])=>(
            <div key={l}>
              <div style={{fontFamily:SB.sans, fontSize:20, fontWeight:500, color:H_INK, letterSpacing:-0.6, fontFeatureSettings:'"tnum"', lineHeight:1}}>
                {v}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:H_MUTED, letterSpacing:'.04em', marginTop:4}}>
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Year picker (chips) */}
      <MYearPicker sel={2026}/>

      {/* Sort bar */}
      <div style={{
        padding:'10px 20px', display:'flex', alignItems:'center',
        justifyContent:'space-between', borderBottom:`1px solid ${H_RULE}`,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:H_MUTED, letterSpacing:'.04em'}}>
          <Icon.Sort size={12} color={H_MUTED}/>
          <span>most recent first</span>
        </div>
        <div style={{display:'flex', gap:10, fontFamily:SB.mono, fontSize:10, color:H_MUTED, letterSpacing:'.04em'}}>
          <span style={{display:'inline-flex', alignItems:'center', gap:4, color:H_INK}}>
            <span style={{width:7, height:7, background:H_INK}}/>list
          </span>
          <span style={{display:'inline-flex', alignItems:'center', gap:4}}>
            <Icon.Map size={11} color={H_MUTED}/>map
          </span>
        </div>
      </div>

      {/* Ledger */}
      <div style={{flex:1, overflow:'auto'}}>
        {years.map(y => {
          const rows = byYear[y];
          const meta = yearMeta[y] || {count:rows.length, spent:rows.reduce((a,s)=>a+s.paid,0)};
          return (
            <div key={y}>
              <MYearHeader y={y} count={meta.count} spent={meta.spent.toLocaleString()} active={y===2026}/>
              <div>
                {rows.map((s,i)=>(
                  <MArchiveRow key={s.id} show={s} last={i===rows.length-1}/>
                ))}
              </div>
            </div>
          );
        })}

        {/* Top venues callout */}
        <div style={{padding:'22px 20px 16px', borderTop:`1px solid ${H_RULE2}`, background:H_SURF}}>
          <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:12}}>
            <Icon.MapPin size={13} color={H_INK}/>
            <div style={{fontFamily:SB.mono, fontSize:11, color:H_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              Top venues · all time
            </div>
          </div>
          {HIFI_TOP_VENUES.slice(0,5).map((v,i)=>(
            <div key={v.name} style={{
              display:'grid', gridTemplateColumns:'1fr 64px 28px', columnGap:10,
              alignItems:'center', padding:'9px 0',
              borderTop: i===0 ? 'none' : `1px solid ${H_RULE}`,
            }}>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:13.5, color:H_INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {v.name}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:H_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                  {v.neighborhood.toLowerCase()}
                </div>
              </div>
              <div style={{display:'flex', gap:2, alignItems:'center'}}>
                {Array.from({length:11}).map((_,j)=>(
                  <div key={j} style={{
                    height:7, flex:1,
                    background: j < v.count ? H_INK : 'transparent',
                    border: j < v.count ? 'none' : `1px solid ${H_RULE2}`,
                  }}/>
                ))}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11, color:H_INK, textAlign:'right', fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {v.count}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding:'22px 20px 12px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:H_FAINT, letterSpacing:'.14em',
        }}>— END OF ARCHIVE —</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1px solid ${H_RULE2}`, background:H_BG,
        padding:'12px 8px 30px', alignItems:'center',
      }}>
        {[
          { key:'home',  label:'Home',  Icon:Icon.Home,     active:false },
          { key:'past',  label:'Past',  Icon:Icon.Archive,  active:true },
          { key:'add',   label:'Add',   Icon:Icon.Plus,     cta:true },
          { key:'map',   label:'Map',   Icon:Icon.Map,      active:false },
          { key:'me',    label:'Me',    Icon:Icon.User,     active:false },
        ].map(({key, label, Icon:Ic, active, cta})=>(
          <div key={key} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta ? 34 : 26, height: cta ? 34 : 26,
              background: cta ? H_INK : 'transparent',
              color: cta ? H_BG : (active ? H_INK : H_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta ? 999 : 0,
            }}>
              <Ic size={cta ? 20 : 18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active ? H_INK : H_MUTED, fontWeight: active ? 500 : 400,
              textTransform:'lowercase',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.MobileHistory = MobileHistory;
