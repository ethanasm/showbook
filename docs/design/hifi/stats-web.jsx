// Web · Stats / Year-in-Review · mono refined · dark
// 1440 × 900 frame. Newsprint dashboard in the dark-mode sidebar shell.

const { SB, Icon, HIFI_KINDS,
  STATS_TOTALS, STATS_YEARS, STATS_VENUES, STATS_ARTISTS,
  STATS_KIND_TOTALS, STATS_SPEND, STATS_DOW, STATS_MONTH,
  STATS_SUPERLATIVES, STATS_STREAKS } = window;

const WS_MODE = 'dark';
const WS_BG    = SB.bg[WS_MODE];
const WS_SURF  = SB.surface[WS_MODE];
const WS_SURF2 = SB.surface2[WS_MODE];
const WS_INK   = SB.ink[WS_MODE];
const WS_MUTED = SB.muted[WS_MODE];
const WS_FAINT = SB.faint[WS_MODE];
const WS_RULE  = SB.rule[WS_MODE];
const WS_RULE2 = SB.ruleStrong[WS_MODE];

const wsKind = (k) => window.kindInk(k, true);

function wsKindFill(k) {
  if (k==='concert')  return SB.kinds.concert.inkDark;
  if (k==='theatre') return SB.kinds.theatre.inkDark;
  if (k==='comedy')   return SB.kinds.comedy.inkDark;
  if (k==='festival') return SB.kinds.festival.inkDark;
  return WS_INK;
}

// ─── Sidebar ────────────────────────────────────────────────────────────
function WSSidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive,  count:'87' },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'4' },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'142' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'34' },
    { key:'map',    label:'Map',       Icon:Icon.Map },
    { key:'stats',  label:'Stats',     Icon:Icon.Sort,     active:true },
  ];
  return (
    <div style={{
      width:224, background:WS_BG, borderRight:`1px solid ${WS_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0',
      flexShrink:0,
    }}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:WS_INK, letterSpacing:-0.5}}>
          showbook
          <span style={{color:WS_FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v · 2026.04
        </div>
      </div>

      <div style={{padding:'0 16px 20px'}}>
        <button style={{
          width:'100%', padding:'9px 12px', background:WS_INK, color:WS_BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={WS_BG}/> Add a show
        </button>
      </div>

      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Navigate
        </div>
        {items.map(({key, label, Icon:Ic, active, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'7px 12px', margin:'1px 0',
            background: active ? WS_SURF : 'transparent',
            color: active ? WS_INK : WS_MUTED,
            fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
            letterSpacing:-0.1, cursor:'pointer',
            borderLeft: active ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
          }}>
            <Ic size={15} color={active ? WS_INK : WS_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && <span style={{fontFamily:SB.mono, fontSize:11, color:WS_FAINT}}>{count}</span>}
          </div>
        ))}

        <div style={{padding:'18px 12px 8px', fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Export
        </div>
        {[['PDF · ledger'], ['CSV · raw'], ['Share · year-in-review']].map(([l])=>(
          <div key={l} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'6px 12px', color:WS_MUTED,
            fontFamily:SB.sans, fontSize:13, cursor:'pointer',
          }}>
            <Icon.ArrowUpRight size={13} color={WS_FAINT}/>
            <span>{l}</span>
          </div>
        ))}
      </div>

      <div style={{padding:'14px 16px', borderTop:`1px solid ${WS_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:WS_SURF2, color:WS_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:WS_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, marginTop:1}}>synced 3m ago</div>
        </div>
        <Icon.More size={14} color={WS_MUTED}/>
      </div>
    </div>
  );
}

// ─── Masthead ───────────────────────────────────────────────────────────
function Masthead() {
  return (
    <div style={{
      padding:'22px 32px 20px', background:WS_BG,
      borderBottom:`1px solid ${WS_RULE2}`,
    }}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
        <div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, letterSpacing:'.1em', textTransform:'uppercase'}}>
            The Ledger · since 2019
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:40, fontWeight:600, color:WS_INK,
            letterSpacing:-1.6, marginTop:6, lineHeight:1,
          }}>
            Year in Review
            <span style={{color:WS_FAINT, fontWeight:400}}> · All-time</span>
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:14, color:WS_MUTED, marginTop:10,
            letterSpacing:-0.1,
          }}>
            87 shows across 8 years · 198 hours of live music · 2,840 miles traveled
          </div>
        </div>
        <div style={{display:'flex', alignItems:'stretch', border:`1px solid ${WS_RULE2}`}}>
          {['All-time','2026','2025','2024','2023'].map((t, i, arr) => {
            const active = i===0;
            return (
              <div key={t} style={{
                padding:'10px 16px',
                borderRight: i === arr.length-1 ? 'none' : `1px solid ${WS_RULE2}`,
                background: active ? WS_INK : 'transparent',
                color: active ? WS_BG : WS_INK,
                fontFamily:SB.sans, fontSize:13, fontWeight: active ? 600 : 500,
                cursor:'pointer',
              }}>{t}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── KPI strip ──────────────────────────────────────────────────────────
function KPIs() {
  const items = [
    ['shows total', STATS_TOTALS.shows, '72% concerts'],
    ['distinct artists', STATS_TOTALS.artists, '34 repeat'],
    ['venues', STATS_TOTALS.venues, '9 away · 25 NYC'],
    ['spent all-time', STATS_TOTALS.spent, '~$86 / show'],
    ['hours live', STATS_TOTALS.hoursLive, '8.2 days'],
    ['miles traveled', STATS_TOTALS.miles.toLocaleString(), 'for music'],
  ];
  return (
    <div style={{
      display:'grid', gridTemplateColumns:`repeat(${items.length}, 1fr)`,
      background:WS_SURF, borderBottom:`1px solid ${WS_RULE}`,
    }}>
      {items.map(([l,v,sub], i) => (
        <div key={l} style={{
          padding:'20px 22px',
          borderRight: i===items.length-1 ? 'none' : `1px solid ${WS_RULE}`,
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
            {l}
          </div>
          <div style={{
            fontFamily:SB.sans, fontSize:38, fontWeight:500, color:WS_INK,
            letterSpacing:-1.4, lineHeight:.95, marginTop:8, fontFeatureSettings:'"tnum"',
          }}>
            {v}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, marginTop:6, letterSpacing:'.04em'}}>
            {sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shows per year · stacked area chart ───────────────────────────────
function YearChart() {
  const max = Math.max(...STATS_YEARS.map(y => y.c+y.f+y.b+y.co));
  const chartH = 180;
  const legend = [
    ['concert', 'concert'],
    ['festival','festival'],
    ['theatre','theatre'],
    ['comedy',  'comedy'],
  ];
  return (
    <div style={{
      background:WS_SURF, borderRight:`1px solid ${WS_RULE}`,
      padding:'18px 22px',
      display:'flex', flexDirection:'column', minHeight:0,
    }}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Sort size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Shows per year · by kind
          </div>
        </div>
        <div style={{display:'flex', gap:14}}>
          {legend.map(([lbl,k]) => (
            <div key={k} style={{display:'flex', alignItems:'center', gap:5}}>
              <div style={{width:10, height:10, background:wsKindFill(k)}}/>
              <span style={{fontFamily:SB.mono, fontSize:10, color:WS_MUTED, letterSpacing:'.04em'}}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
      {/* bar chart */}
      <div style={{display:'flex', alignItems:'flex-end', gap:10, height:chartH, borderBottom:`1px solid ${WS_RULE2}`, paddingBottom:6}}>
        {STATS_YEARS.map(y => {
          const total = y.c+y.f+y.b+y.co;
          const h = (total/max)*chartH;
          const seg = (v, color) => v>0 && (
            <div style={{height: (v/total)*h, background:color}}/>
          );
          return (
            <div key={y.y} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-end', position:'relative'}}>
              {total > 0 ? (
                <>
                  <div style={{fontFamily:SB.mono, fontSize:11, color: y.y==='2026'?WS_INK:WS_MUTED, textAlign:'center', marginBottom:6, fontWeight: y.y==='2026'?500:400, fontFeatureSettings:'"tnum"'}}>
                    {total}
                  </div>
                  <div style={{display:'flex', flexDirection:'column', height:h}}>
                    {seg(y.co, wsKindFill('comedy'))}
                    {seg(y.b,  wsKindFill('theatre'))}
                    {seg(y.f,  wsKindFill('festival'))}
                    {seg(y.c,  wsKindFill('concert'))}
                  </div>
                </>
              ) : (
                <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, textAlign:'center', marginBottom:6, letterSpacing:'.04em'}}>—</div>
              )}
            </div>
          );
        })}
      </div>
      {/* x axis */}
      <div style={{display:'flex', gap:10, marginTop:6}}>
        {STATS_YEARS.map(y => (
          <div key={y.y} style={{
            flex:1, textAlign:'center',
            fontFamily:SB.mono, fontSize:11, letterSpacing:'.04em',
            color: y.y==='2026' ? WS_INK : WS_FAINT,
            fontWeight: y.y==='2026' ? 500 : 400,
          }}>{y.y}</div>
        ))}
      </div>
      {/* annotations */}
      <div style={{
        display:'flex', alignItems:'stretch', gap:0,
        marginTop:14, paddingTop:14,
        borderTop:`1px solid ${WS_RULE}`,
      }}>
        <div style={{flex:1, paddingRight:14, borderRight:`1px solid ${WS_RULE}`}}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Peak year</div>
          <div style={{fontFamily:SB.sans, fontSize:15, color:WS_INK, fontWeight:500, marginTop:4, letterSpacing:-0.3}}>2025 · 22 shows</div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, marginTop:3, letterSpacing:'.02em'}}>first year with 3 theatre</div>
        </div>
        <div style={{flex:1, padding:'0 14px', borderRight:`1px solid ${WS_RULE}`}}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Drought</div>
          <div style={{fontFamily:SB.sans, fontSize:15, color:WS_INK, fontWeight:500, marginTop:4, letterSpacing:-0.3}}>2020 · 0 shows</div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, marginTop:3, letterSpacing:'.02em'}}>14-month gap · pandemic</div>
        </div>
        <div style={{flex:1, paddingLeft:14}}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Trend</div>
          <div style={{fontFamily:SB.sans, fontSize:15, color:wsKind('concert'), fontWeight:500, marginTop:4, letterSpacing:-0.3}}>+38% YoY avg</div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, marginTop:3, letterSpacing:'.02em'}}>since 2021 · accelerating</div>
        </div>
      </div>
    </div>
  );
}

// ─── Month-of-year · radial-ish bars ───────────────────────────────────
function MonthChart() {
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const max = Math.max(...STATS_MONTH);
  return (
    <div style={{background:WS_SURF, padding:'18px 22px'}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Calendar size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Month distribution
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          all-time · n=87
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, alignItems:'end', height:100}}>
        {STATS_MONTH.map((v, i) => {
          const peak = v === max;
          return (
            <div key={i} style={{display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-end', gap:4}}>
              <div style={{fontFamily:SB.mono, fontSize:9.5, color: peak ? WS_INK : WS_FAINT, textAlign:'center', fontFeatureSettings:'"tnum"', fontWeight: peak ? 500 : 400}}>
                {v}
              </div>
              <div style={{height:(v/max)*80, background: peak ? wsKind('concert') : WS_INK}}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, marginTop:6}}>
        {months.map((m,i)=>{
          const peak = STATS_MONTH[i] === max;
          return (
            <div key={i} style={{
              textAlign:'center', fontFamily:SB.mono, fontSize:10,
              color: peak ? WS_INK : WS_FAINT, letterSpacing:'.04em',
              fontWeight: peak ? 500 : 400,
            }}>{m}</div>
          );
        })}
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.02em', marginTop:12, paddingTop:10, borderTop:`1px solid ${WS_RULE}`}}>
        june · 11 shows · festival season peak
      </div>
    </div>
  );
}

// ─── DOW chart ─────────────────────────────────────────────────────────
function DOWChart() {
  const max = Math.max(...STATS_DOW.map(d=>d.v));
  return (
    <div style={{background:WS_SURF, padding:'18px 22px', borderRight:`1px solid ${WS_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Clock size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Day of week
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          weekend-heavy
        </div>
      </div>
      <div style={{display:'flex', gap:10, alignItems:'flex-end', height:100}}>
        {STATS_DOW.map((d, i) => {
          const peak = d.v === max;
          return (
            <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-end', gap:5}}>
              <div style={{fontFamily:SB.mono, fontSize:10, color: peak?WS_INK:WS_FAINT, textAlign:'center', fontWeight: peak?500:400, fontFeatureSettings:'"tnum"'}}>
                {d.v}
              </div>
              <div style={{height:(d.v/max)*80, background: peak ? wsKind('concert') : WS_INK}}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex', gap:10, marginTop:6}}>
        {STATS_DOW.map((d, i) => {
          const peak = d.v === max;
          return (
            <div key={i} style={{flex:1, textAlign:'center', fontFamily:SB.mono, fontSize:10, color: peak?WS_INK:WS_FAINT, letterSpacing:'.04em', fontWeight: peak?500:400}}>
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}
            </div>
          );
        })}
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.02em', marginTop:14, paddingTop:10, borderTop:`1px solid ${WS_RULE}`}}>
        saturday · 24 shows · 28% of all-time
      </div>
    </div>
  );
}

// ─── Spend chart ───────────────────────────────────────────────────────
function SpendChart() {
  const max = Math.max(...STATS_SPEND.map(s=>s.v));
  return (
    <div style={{background:WS_SURF, padding:'18px 22px'}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Ticket size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Spend by year
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          $7,482 all-time
        </div>
      </div>
      {STATS_SPEND.map((s, i) => (
        <div key={s.y} style={{
          display:'grid', gridTemplateColumns:'44px 1fr 90px',
          columnGap:12, alignItems:'center',
          padding:'7px 0', borderTop: i===0 ? 'none' : `1px solid ${WS_RULE}`,
        }}>
          <div style={{fontFamily:SB.mono, fontSize:11, color: s.y==='2026'?WS_INK:WS_MUTED, letterSpacing:'.02em', fontFeatureSettings:'"tnum"', fontWeight: s.y==='2026'?500:400}}>
            {s.y}
          </div>
          <div style={{height:6, background:WS_SURF2, position:'relative'}}>
            <div style={{position:'absolute', inset:0, width:`${(s.v/max)*100}%`, background: s.y==='2025' ? wsKind('concert') : WS_INK}}/>
          </div>
          <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11.5, color:WS_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
            ${s.v.toLocaleString()}{s.y==='2026' && <span style={{color:WS_FAINT, marginLeft:4, fontWeight:400}}>ytd</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Leaderboard (venues or artists) ───────────────────────────────────
function Leaderboard({title, sub, rows, maxVal, withKind=false}) {
  return (
    <div style={{background:WS_SURF, padding:'18px 22px', borderRight:`1px solid ${WS_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.ArrowUpRight size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            {title}
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          {sub}
        </div>
      </div>
      {rows.map((r, i) => {
        const color = withKind ? wsKind(r.kind) : WS_INK;
        return (
          <div key={r.name} style={{
            display:'grid', gridTemplateColumns:'22px 1fr 110px 34px',
            columnGap:12, alignItems:'center',
            padding:'9px 0', borderTop: i===0 ? 'none' : `1px solid ${WS_RULE}`,
          }}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, fontFeatureSettings:'"tnum"', letterSpacing:'.02em'}}>
              {String(i+1).padStart(2,'0')}
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:13.5, color:WS_INK, fontWeight:500, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {r.name}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:WS_MUTED, letterSpacing:'.02em', marginTop:2}}>
                {withKind ? HIFI_KINDS[r.kind].label.toLowerCase() : `${r.hood.toLowerCase()} · ${r.city.toLowerCase()}`}
              </div>
            </div>
            <div style={{height:5, background:WS_SURF2, position:'relative'}}>
              <div style={{position:'absolute', inset:0, width:`${(r.count/maxVal)*100}%`, background:color}}/>
            </div>
            <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:WS_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
              {r.count}×
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Kind donut ────────────────────────────────────────────────────────
function KindBreakdown() {
  const total = STATS_KIND_TOTALS.reduce((a,k)=>a+k.v,0);
  // Build SVG donut
  const cx=60, cy=60, r=44, sw=16;
  const C = 2*Math.PI*r;
  let offset = 0;
  const segs = STATS_KIND_TOTALS.map(({k,v}) => {
    const frac = v/total;
    const len = C*frac;
    const gap = 2;
    const seg = {
      k, v,
      color: wsKindFill(k),
      dash: `${Math.max(0,len-gap)} ${C-Math.max(0,len-gap)}`,
      offset: -offset,
    };
    offset += len;
    return seg;
  });
  return (
    <div style={{background:WS_SURF, padding:'18px 22px'}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Dot size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            By kind
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          all-time · n={total}
        </div>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:18}}>
        <svg width="120" height="120" style={{flexShrink:0}}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={WS_RULE} strokeWidth={sw}/>
          {segs.map((s,i)=>(
            <circle key={i}
              cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={sw}
              strokeDasharray={s.dash}
              strokeDashoffset={s.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
          <text x={cx} y={cy-2} textAnchor="middle" fontFamily={SB.sans} fontSize="20" fontWeight="600" fill={WS_INK} style={{letterSpacing:-0.5}}>{total}</text>
          <text x={cx} y={cy+14} textAnchor="middle" fontFamily={SB.mono} fontSize="8.5" fill={WS_MUTED} letterSpacing="0.08em">SHOWS</text>
        </svg>
        <div style={{flex:1}}>
          {STATS_KIND_TOTALS.map(({k,v}) => (
            <div key={k} style={{display:'grid', gridTemplateColumns:'12px 1fr 34px 40px', columnGap:8, alignItems:'center', padding:'6px 0', borderTop:`1px solid ${WS_RULE}`}}>
              <div style={{width:9, height:9, background:wsKindFill(k)}}/>
              <div style={{fontFamily:SB.sans, fontSize:12.5, color:WS_INK, textTransform:'lowercase', letterSpacing:-0.1}}>
                {HIFI_KINDS[k].label}
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:WS_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {v}
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:10, color:WS_FAINT, fontFeatureSettings:'"tnum"'}}>
                {Math.round(v/total*100)}%
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Superlatives (editorial grid) ─────────────────────────────────────
function Superlatives() {
  return (
    <div style={{background:WS_SURF, padding:'18px 22px', borderTop:`1px solid ${WS_RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Icon.Eye size={14} color={WS_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WS_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Superlatives
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.04em'}}>
          all-time extremes
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:0, border:`1px solid ${WS_RULE}`}}>
        {STATS_SUPERLATIVES.map((s, i) => (
          <div key={s.label} style={{
            padding:'14px 16px',
            borderRight: (i+1)%3!==0 ? `1px solid ${WS_RULE}` : 'none',
            borderBottom: i < 3 ? `1px solid ${WS_RULE}` : 'none',
          }}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
              {s.label}
            </div>
            <div style={{fontFamily:SB.sans, fontSize:17, color:WS_INK, fontWeight:500, letterSpacing:-0.4, marginTop:6, lineHeight:1.15}}>
              {s.value}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:WS_MUTED, marginTop:5, letterSpacing:'.02em'}}>
              {s.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────
function WebStats() {
  const maxVenue = STATS_VENUES[0].count;
  const maxArtist = STATS_ARTISTS[0].count;

  return (
    <div style={{
      width:'100%', height:'100%', background:WS_BG, color:WS_INK,
      display:'flex', fontFamily:SB.sans,
      WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <window.V2Sidebar active="shows"/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'auto'}}>
        <Masthead/>
        <KPIs/>

        {/* Main charts grid — row 1 */}
        <div style={{
          display:'grid', gridTemplateColumns:'1.45fr 1fr',
          borderBottom:`1px solid ${WS_RULE}`,
        }}>
          <YearChart/>
          <div style={{display:'grid', gridTemplateRows:'1fr 1fr'}}>
            <div style={{borderBottom:`1px solid ${WS_RULE}`}}>
              <KindBreakdown/>
            </div>
            <MonthChart/>
          </div>
        </div>

        {/* Row 2 — leaderboards */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', borderBottom:`1px solid ${WS_RULE}`}}>
          <Leaderboard
            title="Most-attended venues"
            sub="34 total · top 8"
            rows={STATS_VENUES}
            maxVal={maxVenue}
          />
          <Leaderboard
            title="Most-seen artists"
            sub="142 total · top 8"
            rows={STATS_ARTISTS}
            maxVal={maxArtist}
            withKind
          />
        </div>

        {/* Row 3 — DOW + spend */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', borderBottom:`1px solid ${WS_RULE}`}}>
          <DOWChart/>
          <SpendChart/>
        </div>

        {/* Row 4 — superlatives */}
        <Superlatives/>

        <div style={{
          padding:'20px 32px', background:WS_BG,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          borderTop:`1px solid ${WS_RULE}`,
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WS_FAINT, letterSpacing:'.14em'}}>
            showbook · the ledger · compiled apr 20 · 2026
          </div>
          <div style={{display:'flex', gap:16}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WS_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
              <Icon.ArrowUpRight size={12} color={WS_MUTED}/> Share year-in-review
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WS_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
              <Icon.ArrowUpRight size={12} color={WS_MUTED}/> Export PDF
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.WebStats = WebStats;
