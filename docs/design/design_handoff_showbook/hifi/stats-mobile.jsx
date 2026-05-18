// Mobile · Stats / Year-in-Review · mono refined
// Warm-off-white. Geist + Geist Mono. Per-kind accent chips.

const { SB, Icon, HIFI_KINDS,
  STATS_TOTALS, STATS_YEARS, STATS_VENUES, STATS_ARTISTS,
  STATS_KIND_TOTALS, STATS_SPEND, STATS_DOW, STATS_SUPERLATIVES } = window;

const SM_BG    = SB.bg.light;
const SM_SURF  = SB.surface.light;
const SM_SURF2 = SB.surface2.light;
const SM_INK   = SB.ink.light;
const SM_MUTED = SB.muted.light;
const SM_FAINT = SB.faint.light;
const SM_RULE  = SB.rule.light;
const SM_RULE2 = SB.ruleStrong.light;

const sKind = (k) => SB.kinds[k].ink;

// Legend pattern for stacked bars (solid = concert, dot = festival, stripe = theatre, comma = comedy)
function kindFill(k) {
  if (k==='concert')  return SB.kinds.concert.ink;
  if (k==='theatre') return SB.kinds.theatre.ink;
  if (k==='comedy')   return SB.kinds.comedy.ink;
  if (k==='festival') return SB.kinds.festival.ink;
  return SM_INK;
}

function SectionHead({label, sub}) {
  return (
    <div style={{
      padding:'16px 20px 10px',
      display:'flex', alignItems:'baseline', justifyContent:'space-between',
    }}>
      <div style={{fontFamily:SB.mono, fontSize:11, color:SM_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
        {label}
      </div>
      {sub && <div style={{fontFamily:SB.mono, fontSize:10, color:SM_FAINT, letterSpacing:'.04em'}}>{sub}</div>}
    </div>
  );
}

function BigStat({value, label, sub}) {
  return (
    <div style={{padding:'14px 16px', borderRight:`1px solid ${SM_RULE}`}}>
      <div style={{fontFamily:SB.sans, fontSize:30, fontWeight:500, color:SM_INK, letterSpacing:-1.1, lineHeight:.9, fontFeatureSettings:'"tnum"'}}>
        {value}
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10, color:SM_MUTED, letterSpacing:'.06em', textTransform:'uppercase', marginTop:6}}>
        {label}
      </div>
      {sub && <div style={{fontFamily:SB.mono, fontSize:9.5, color:SM_FAINT, marginTop:3, letterSpacing:'.02em'}}>{sub}</div>}
    </div>
  );
}

function StackedBar({y, max}) {
  const total = y.c + y.f + y.b + y.co;
  const pct = max>0 ? (total/max) : 0;
  const seg = (v, color) => v>0 && (
    <div style={{flex:v, background:color, height:'100%'}}/>
  );
  return (
    <div style={{display:'grid', gridTemplateColumns:'36px 1fr 28px', columnGap:10, alignItems:'center'}}>
      <div style={{fontFamily:SB.mono, fontSize:10.5, color: y.y==='2026'?SM_INK:SM_MUTED, letterSpacing:'.02em', fontFeatureSettings:'"tnum"', fontWeight: y.y==='2026'?500:400}}>
        {y.y}
      </div>
      <div style={{height:12, background:SM_SURF2, position:'relative'}}>
        <div style={{position:'absolute', inset:0, width:`${pct*100}%`, display:'flex'}}>
          {seg(y.c,  kindFill('concert'))}
          {seg(y.f,  kindFill('festival'))}
          {seg(y.b,  kindFill('theatre'))}
          {seg(y.co, kindFill('comedy'))}
        </div>
      </div>
      <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:SM_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
        {total||'·'}
      </div>
    </div>
  );
}

function MobileStats() {
  const maxYear = Math.max(...STATS_YEARS.map(y=>y.c+y.f+y.b+y.co));
  const maxVenue = STATS_VENUES[0].count;
  const maxArtist = STATS_ARTISTS[0].count;
  const maxSpend = Math.max(...STATS_SPEND.map(s=>s.v));
  const maxDow = Math.max(...STATS_DOW.map(d=>d.v));
  const maxKind = Math.max(...STATS_KIND_TOTALS.map(k=>k.v));

  return (
    <div style={{
      height:'100%', background:SM_BG, color:SM_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'62px 20px 18px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Icon.ChevronRight size={14} color={SM_INK} style={{transform:'rotate(180deg)'}}/>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:SM_MUTED, letterSpacing:'.04em'}}>
              back
            </div>
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center'}}>
            <Icon.Filter size={16} color={SM_INK}/>
            <Icon.More size={18} color={SM_INK}/>
          </div>
        </div>

        <div style={{marginTop:22}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:SM_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
            the ledger · since 2019
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:32, fontWeight:600, color:SM_INK,
            letterSpacing:-1.2, marginTop:6, lineHeight:1,
          }}>
            87 shows
            <span style={{color:SM_FAINT, fontWeight:400}}> across 8 years</span>
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:13, color:SM_MUTED, marginTop:8,
            letterSpacing:-.1, lineHeight:1.4,
          }}>
            1 show every 33 days · on average. Peak was 2025.
          </div>
        </div>

        {/* Range toggle */}
        <div style={{
          marginTop:16, display:'inline-flex',
          border:`1px solid ${SM_RULE2}`,
        }}>
          {['all-time','2026','2025','2024'].map((t,i)=>{
            const active = i===0;
            return (
              <div key={t} style={{
                padding:'6px 12px',
                borderRight: i===3 ? 'none' : `1px solid ${SM_RULE2}`,
                background: active ? SM_INK : 'transparent',
                color: active ? SM_BG : SM_INK,
                fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.04em',
                fontWeight: active ? 500 : 400, textTransform:'lowercase',
              }}>{t}</div>
            );
          })}
        </div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {/* 4 big numbers */}
        <div style={{
          display:'grid', gridTemplateColumns:'repeat(2,1fr)',
          borderTop:`1px solid ${SM_RULE2}`, borderBottom:`1px solid ${SM_RULE2}`,
          background:SM_SURF,
        }}>
          <div style={{borderRight:`1px solid ${SM_RULE}`, borderBottom:`1px solid ${SM_RULE}`}}>
            <BigStat value={STATS_TOTALS.shows} label="shows" sub="72% concerts"/>
          </div>
          <div style={{borderBottom:`1px solid ${SM_RULE}`}}>
            <div style={{padding:'14px 16px'}}>
              <div style={{fontFamily:SB.sans, fontSize:30, fontWeight:500, color:SM_INK, letterSpacing:-1.1, lineHeight:.9, fontFeatureSettings:'"tnum"'}}>
                {STATS_TOTALS.artists}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:SM_MUTED, letterSpacing:'.06em', textTransform:'uppercase', marginTop:6}}>
                distinct artists
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:SM_FAINT, marginTop:3, letterSpacing:'.02em'}}>
                34 repeat
              </div>
            </div>
          </div>
          <div style={{borderRight:`1px solid ${SM_RULE}`}}>
            <BigStat value={STATS_TOTALS.venues} label="venues" sub="nyc + 3 away"/>
          </div>
          <BigStat value={STATS_TOTALS.spent} label="spent" sub="~$86 / show"/>
        </div>

        {/* Shows per year — stacked */}
        <SectionHead label="Shows per year" sub="stacked · by kind"/>
        <div style={{padding:'0 20px'}}>
          {/* legend */}
          <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:12}}>
            {[['concert','concert'],['festival','festival'],['theatre','theatre'],['comedy','comedy']].map(([lbl,k])=>(
              <div key={k} style={{display:'flex', alignItems:'center', gap:5}}>
                <div style={{width:9, height:9, background:kindFill(k)}}/>
                <span style={{fontFamily:SB.mono, fontSize:9.5, color:SM_MUTED, letterSpacing:'.04em'}}>{lbl}</span>
              </div>
            ))}
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {STATS_YEARS.map(y => <StackedBar key={y.y} y={y} max={maxYear}/>)}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:SM_FAINT, letterSpacing:'.02em', marginTop:12, paddingTop:10, borderTop:`1px solid ${SM_RULE}`}}>
            peak · 2025 · 22 shows incl. 3 theatre (a first)
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:SM_FAINT, letterSpacing:'.02em', marginTop:4}}>
            drought · 2020 · pandemic · 14-month gap
          </div>
        </div>

        {/* Venues leaderboard */}
        <SectionHead label="Most-attended venues" sub="top 6"/>
        <div style={{padding:'0 20px'}}>
          {STATS_VENUES.slice(0,6).map((v, i) => (
            <div key={v.name} style={{
              display:'grid', gridTemplateColumns:'18px 1fr 80px 30px',
              columnGap:10, alignItems:'center',
              padding:'10px 0', borderTop: i===0 ? `1px solid ${SM_RULE2}` : `1px solid ${SM_RULE}`,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:SM_FAINT, fontFeatureSettings:'"tnum"'}}>
                {String(i+1).padStart(2,'0')}
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, color:SM_INK, fontWeight:500, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {v.name}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:SM_MUTED, letterSpacing:'.02em', marginTop:2}}>
                  {v.hood.toLowerCase()} · {v.city.toLowerCase()}
                </div>
              </div>
              <div style={{height:6, background:SM_SURF2, position:'relative'}}>
                <div style={{position:'absolute', inset:0, width:`${(v.count/maxVenue)*100}%`, background:SM_INK}}/>
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:SM_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {v.count}×
              </div>
            </div>
          ))}
        </div>

        {/* Artists leaderboard */}
        <SectionHead label="Most-seen artists" sub="top 6"/>
        <div style={{padding:'0 20px'}}>
          {STATS_ARTISTS.slice(0,6).map((a, i) => (
            <div key={a.name} style={{
              display:'grid', gridTemplateColumns:'18px 1fr 80px 30px',
              columnGap:10, alignItems:'center',
              padding:'10px 0', borderTop: i===0 ? `1px solid ${SM_RULE2}` : `1px solid ${SM_RULE}`,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:SM_FAINT, fontFeatureSettings:'"tnum"'}}>
                {String(i+1).padStart(2,'0')}
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, color:SM_INK, fontWeight:500, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {a.name}
                </div>
                <div style={{display:'inline-flex', alignItems:'center', gap:5, marginTop:3}}>
                  <span style={{width:5, height:5, borderRadius:999, background:sKind(a.kind)}}/>
                  <span style={{fontFamily:SB.mono, fontSize:9.5, color:sKind(a.kind), letterSpacing:'.04em', textTransform:'lowercase'}}>
                    {HIFI_KINDS[a.kind].label}
                  </span>
                </div>
              </div>
              <div style={{height:6, background:SM_SURF2, position:'relative'}}>
                <div style={{position:'absolute', inset:0, width:`${(a.count/maxArtist)*100}%`, background:sKind(a.kind)}}/>
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:SM_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {a.count}×
              </div>
            </div>
          ))}
        </div>

        {/* By kind · donut-ish bar */}
        <SectionHead label="By kind" sub="all-time"/>
        <div style={{padding:'0 20px'}}>
          {/* Single stacked bar showing proportion */}
          <div style={{height:14, display:'flex', marginBottom:12}}>
            {STATS_KIND_TOTALS.map(({k,v}) => (
              <div key={k} style={{flex:v, background:kindFill(k)}}/>
            ))}
          </div>
          {STATS_KIND_TOTALS.map(({k,v}, i) => (
            <div key={k} style={{
              display:'grid', gridTemplateColumns:'14px 1fr 40px 40px',
              columnGap:10, alignItems:'center',
              padding:'8px 0', borderTop: i===0 ? `1px solid ${SM_RULE2}` : `1px solid ${SM_RULE}`,
            }}>
              <div style={{width:10, height:10, background:kindFill(k)}}/>
              <div style={{fontFamily:SB.sans, fontSize:13, color:SM_INK, letterSpacing:-0.1, textTransform:'lowercase'}}>
                {HIFI_KINDS[k].label}
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:SM_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {v}
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:10, color:SM_FAINT, fontFeatureSettings:'"tnum"'}}>
                {Math.round(v/87*100)}%
              </div>
            </div>
          ))}
        </div>

        {/* Day-of-week bars */}
        <SectionHead label="Day of week" sub="when you go out"/>
        <div style={{padding:'0 20px'}}>
          <div style={{display:'flex', gap:6, alignItems:'flex-end', height:90}}>
            {STATS_DOW.map((d, i) => {
              const h = (d.v / maxDow) * 100;
              const peak = d.v === maxDow;
              return (
                <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'stretch', gap:6}}>
                  <div style={{
                    fontFamily:SB.mono, fontSize:10, textAlign:'center',
                    color: peak ? SM_INK : SM_FAINT, fontWeight: peak ? 500 : 400,
                    fontFeatureSettings:'"tnum"',
                  }}>
                    {d.v}
                  </div>
                  <div style={{height:h+'%', background: peak ? sKind('concert') : SM_INK}}/>
                  <div style={{
                    fontFamily:SB.mono, fontSize:10, textAlign:'center',
                    color: peak ? SM_INK : SM_MUTED, letterSpacing:'.04em',
                    fontWeight: peak ? 500 : 400,
                  }}>
                    {d.d}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:9.5, color:SM_FAINT, letterSpacing:'.02em', marginTop:12, paddingTop:10, borderTop:`1px solid ${SM_RULE}`}}>
            saturday · 24 shows · a real weekend habit
          </div>
        </div>

        {/* Spend · sparkline-ish */}
        <SectionHead label="Spend by year" sub="$7,482 all-time"/>
        <div style={{padding:'0 20px'}}>
          {STATS_SPEND.map((s, i) => (
            <div key={s.y} style={{
              display:'grid', gridTemplateColumns:'40px 1fr 70px',
              columnGap:10, alignItems:'center',
              padding:'8px 0', borderTop: i===0 ? `1px solid ${SM_RULE2}` : `1px solid ${SM_RULE}`,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:11, color: s.y==='2026'?SM_INK:SM_MUTED, letterSpacing:'.02em', fontFeatureSettings:'"tnum"', fontWeight: s.y==='2026'?500:400}}>
                {s.y}
              </div>
              <div style={{height:5, background:SM_SURF2, position:'relative'}}>
                <div style={{position:'absolute', inset:0, width:`${(s.v/maxSpend)*100}%`, background:SM_INK}}/>
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:SM_INK, fontFeatureSettings:'"tnum"'}}>
                ${s.v.toLocaleString()}{s.y==='2026' && <span style={{color:SM_FAINT, marginLeft:4}}>ytd</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Superlatives — editorial list */}
        <SectionHead label="Superlatives" sub="all-time extremes"/>
        <div style={{padding:'0 20px 8px'}}>
          {STATS_SUPERLATIVES.map((s, i) => (
            <div key={s.label} style={{
              display:'grid', gridTemplateColumns:'120px 1fr',
              columnGap:12, alignItems:'baseline',
              padding:'12px 0', borderTop: i===0 ? `1px solid ${SM_RULE2}` : `1px solid ${SM_RULE}`,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:SM_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
                {s.label}
              </div>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:14, color:SM_INK, fontWeight:500, letterSpacing:-0.2}}>
                  {s.value}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:SM_FAINT, marginTop:2, letterSpacing:'.02em'}}>
                  {s.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding:'24px 20px 20px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:SM_FAINT, letterSpacing:'.14em',
        }}>— END OF LEDGER —</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1px solid ${SM_RULE2}`, background:SM_BG,
        padding:'12px 8px 30px', alignItems:'center',
      }}>
        {[
          { key:'home',  label:'Home',  Icon:Icon.Home,     active:false },
          { key:'past',  label:'Past',  Icon:Icon.Archive,  active:false },
          { key:'add',   label:'Add',   Icon:Icon.Plus,     cta:true },
          { key:'map',   label:'Map',   Icon:Icon.Map,      active:false },
          { key:'me',    label:'Me',    Icon:Icon.User,     active:true },
        ].map(({key, label, Icon:Ic, active, cta})=>(
          <div key={key} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta ? 34 : 26, height: cta ? 34 : 26,
              background: cta ? SM_INK : 'transparent',
              color: cta ? SM_BG : (active ? SM_INK : SM_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta ? 999 : 0,
            }}>
              <Ic size={cta ? 20 : 18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active ? SM_INK : SM_MUTED, fontWeight: active ? 500 : 400,
              textTransform:'lowercase',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.MobileStats = MobileStats;
