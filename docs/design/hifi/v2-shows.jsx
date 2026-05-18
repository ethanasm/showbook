// v2 · Shows — unified page with 3 modes: List / Calendar / Stats.
// One page that replaces Archive + Upcoming + Stats. Modes switch via segmented
// control at top; past + upcoming unified into a single stream.

const { SB, Icon, KindIcon, HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_WATCHING, HIFI_RHYTHM, HIFI_TOTALS, V2Sidebar } = window;

// Extended archive to fill the ledger — plausible rows pulled from the fuller archive
const EXTRA_PAST = [
  { id:'p6', kind:'concert',  state:'past', date:{y:2026,m:'JAN',d:'18',dow:'SAT'}, headliner:'Jeff Rosenstock', support:[], venue:'Warsaw', neighborhood:'Greenpoint', seat:'GA', paid:45 },
  { id:'p7', kind:'theatre', state:'past', date:{y:2025,m:'DEC',d:'29',dow:'SUN'}, headliner:'Gypsy', support:[], venue:'Majestic Theatre', neighborhood:'Midtown', seat:'ORCH E · 12', paid:189 },
  { id:'p8', kind:'comedy',   state:'past', date:{y:2025,m:'DEC',d:'11',dow:'THU'}, headliner:'Natasha Leggero', support:['Moshe Kasher'], venue:'Town Hall', neighborhood:'Midtown', seat:'MEZZ A · 4', paid:62 },
  { id:'p9', kind:'concert',  state:'past', date:{y:2025,m:'NOV',d:'22',dow:'SAT'}, headliner:'Wednesday', support:['MJ Lenderman'], venue:'Bowery Ballroom', neighborhood:'Lower East Side', seat:'GA', paid:35 },
  { id:'p10',kind:'concert',  state:'past', date:{y:2025,m:'OCT',d:'30',dow:'THU'}, headliner:'Big Thief', support:[], venue:'Webster Hall', neighborhood:'East Village', seat:'GA BALC', paid:72 },
  { id:'p11',kind:'festival', state:'past', date:{y:2025,m:'SEP',d:'06',dow:'SAT'}, headliner:'Electric Zoo', support:['day 2'], venue:'Randall\'s Island', neighborhood:'Randall\'s Island', seat:'GA', paid:155 },
  { id:'p12',kind:'concert',  state:'past', date:{y:2025,m:'AUG',d:'14',dow:'THU'}, headliner:'Black Country, New Road', support:[], venue:'Music Hall of Williamsburg', neighborhood:'Williamsburg', seat:'GA', paid:40 },
];

// Unified stream: future first (upcoming tix + watching), then past newest-first.
// Each row carries its own `state` so the ledger can decorate accordingly.
const FUTURE_ROWS = [...HIFI_UPCOMING, ...HIFI_WATCHING].sort((a,b)=>{
  const am = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(a.date.m);
  const bm = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(b.date.m);
  if (a.date.y !== b.date.y) return a.date.y - b.date.y;
  if (am !== bm) return am - bm;
  return parseInt(a.date.d) - parseInt(b.date.d);
});
const PAST_ROWS = [...HIFI_PAST, ...EXTRA_PAST];
const LEDGER_ROWS = [...FUTURE_ROWS, ...PAST_ROWS];

// State decoration helper — returns { barStyle, chipLabel, chipColor }
function stateDecor(state, kindColor, inkColor, faintColor) {
  if (state === 'tix') return {
    barStyle: `2px solid ${inkColor}`,
    chip: 'TIX', chipBg: inkColor, chipFg: SB.bg.dark,
  };
  if (state === 'watching') return {
    barStyle: `2px dashed ${inkColor}`,
    chip: 'WATCHING', chipBg: 'transparent', chipFg: inkColor, chipBorder: inkColor,
  };
  // past
  return {
    barStyle: `2px solid ${kindColor}`,
    chip: null,
  };
}

function ShowsHeader({mode, onMode, totalShown}) {
  const M='dark';
  const BG=SB.bg[M], SURF=SB.surface[M], INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const modes = [
    { k:'list',     l:'List',     Ic:Icon.Archive,  count:'94' },
    { k:'calendar', l:'Calendar', Ic:Icon.Calendar, count:'7 up' },
    { k:'stats',    l:'Stats',    Ic:Icon.Sort,     count:'8 yrs' },
  ];
  return (
    <>
      <div style={{
        padding:'16px 36px', display:'flex', alignItems:'center', justifyContent:'space-between',
        borderBottom:`1px solid ${RULE}`,
      }}>
        <div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.1em', textTransform:'uppercase'}}>
            All shows · one stream
          </div>
          <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:INK, letterSpacing:-0.9, marginTop:4}}>
            Shows
          </div>
        </div>
        <div style={{display:'flex', alignItems:'stretch', border:`1px solid ${RULE2}`}}>
          {modes.map(({k,l,Ic,count},i)=>{
            const active = k===mode;
            return (
              <button key={k} onClick={()=>onMode(k)} style={{
                border:'none', cursor:'pointer',
                borderRight: i===modes.length-1 ? 'none' : `1px solid ${RULE2}`,
                background: active ? INK : 'transparent',
                color: active ? BG : INK,
                padding:'10px 18px',
                fontFamily:SB.sans, fontSize:14, fontWeight: active?600:500, letterSpacing:-0.2,
                display:'flex', alignItems:'center', gap:8,
              }}>
                <Ic size={14} color={active?BG:INK}/>
                <span>{l}</span>
                <span style={{fontFamily:SB.mono, fontSize:10.5, color: active?BG:FAINT, opacity: active?.7:1, letterSpacing:'.04em', fontWeight:400}}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar — year · kind · status · sort */}
      <div style={{
        padding:'11px 36px', display:'flex', alignItems:'center', gap:18, flexWrap:'wrap',
        background: SURF, borderBottom:`1px solid ${RULE}`,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:0, border:`1px solid ${RULE2}`}}>
          {['All','2027','2026','2025','2024','older'].map((y,i,arr)=>{
            const active = y==='2026';
            return (
              <div key={y} style={{
                padding:'5px 11px',
                borderRight: i===arr.length-1 ? 'none' : `1px solid ${RULE2}`,
                background: active?INK:'transparent',
                color: active?BG:INK,
                fontFamily:SB.mono, fontSize:11, fontWeight:active?500:400, cursor:'pointer',
                letterSpacing:'.02em',
              }}>{y}</div>
            );
          })}
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {Object.entries(HIFI_KINDS).map(([k,v])=>{
            const KIc = KindIcon[k];
            return (
              <span key={k} style={{
                display:'inline-flex', alignItems:'center', gap:5,
                padding:'4px 9px', border:`1px solid ${RULE2}`,
                fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.04em', cursor:'pointer',
              }}>
                <KIc size={12} color={window.kindInk(k,true)}/>
                {v.label.toLowerCase()}
              </span>
            );
          })}
        </div>
        <span style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.04em'}}>·</span>
        <div style={{display:'flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:MUTED, cursor:'pointer'}}>
          <Icon.Sort size={12} color={MUTED}/> newest first
        </div>
        <div style={{flex:1}}/>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT, letterSpacing:'.04em'}}>
          {totalShown}
        </div>
      </div>
    </>
  );
}

// ─── LIST MODE ─────────────────────────────────────────────────────────
function ListMode() {
  const M='dark';
  const SURF=SB.surface[M], SURF2=SB.surface2[M], INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const ACCENT=SB.accent[M], ACCENT_TEXT=SB.accent.text;
  const [hovId, setHovId] = React.useState(null);
  const [selId, setSelId] = React.useState(null);

  return (
    <div style={{flex:1, minHeight:0, overflow:'auto', background:SB.bg[M]}}>
      {/* Single unified stream · newest-future on top, past below */}
      <div style={{padding:'18px 36px 8px', display:'flex', alignItems:'baseline', gap:14}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
          All shows · 94
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT}}>
          3 tix · 3 watching · 87 past · today marked
        </div>
      </div>

      <div style={{margin:'4px 36px 36px', background:SURF}}>
        <div style={{
          display:'grid', gridTemplateColumns:'14px 80px 110px 1.2fr 1fr 110px 64px 88px', columnGap:16,
          padding:'10px 20px 10px 10px', borderBottom:`1px solid ${RULE}`,
          fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.12em', textTransform:'uppercase',
        }}>
          <div/><div>Date</div><div>Kind</div><div>Headline</div><div>Venue</div><div>Seat</div>
          <div style={{textAlign:'right'}}>Paid</div><div style={{textAlign:'right'}}>State</div>
        </div>
        {LEDGER_ROWS.map(s=>{
          const kc = window.kindInk(s.kind, true);
          const KIc = KindIcon[s.kind];
          const st = s.state || 'past';
          const d = stateDecor(st, kc, INK, FAINT);
          const isHov = hovId===s.id;
          const isSel = selId===s.id;
          return (
            <React.Fragment key={s.id}>
            <div
              onMouseEnter={()=>setHovId(s.id)}
              onMouseLeave={()=>setHovId(null)}
              onClick={()=>setSelId(isSel ? null : s.id)}
              style={{
              display:'grid', gridTemplateColumns:'14px 80px 110px 1.2fr 1fr 110px 64px 88px', columnGap:16,
              padding:'13px 20px 13px 10px', borderBottom:`1px solid ${RULE}`, alignItems:'center',
              position:'relative', cursor:'pointer',
              background: isSel ? SURF2 : (isHov ? `rgba(245,245,243,.04)` : 'transparent'),
              transition:'background .12s',
            }}>
              {/* Left-edge bar */}
              <div style={{
                width:0, height:'70%', alignSelf:'center',
                borderLeft: d.barStyle,
                marginLeft:4,
              }}/>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:16, color:INK, fontWeight:500, letterSpacing:-0.4, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                  {s.date.m} {s.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, marginTop:3}}>
                  {s.date.y} · {s.date.dow.toLowerCase()}
                </div>
              </div>
              <div style={{
                display:'inline-flex', alignItems:'center', gap:7,
                fontFamily:SB.mono, fontSize:10.5, color:kc,
                letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
              }}>
                <KIc size={14} color={kc}/>
                {HIFI_KINDS[s.kind].label}
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {s.headliner}
                </div>
                {s.support && s.support.length>0 && (
                  <div style={{fontFamily:SB.sans, fontSize:11.5, color:MUTED, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    + {s.support.join(', ')}
                  </div>
                )}
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:13, color:INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {s.venue}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:2}}>
                  {(s.neighborhood || s.city || '').toLowerCase()}
                </div>
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11, color:MUTED}}>
                {s.seat || '—'}
              </div>
              <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color: s.paid ? INK : FAINT, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                {s.paid ? `$${s.paid}` : '—'}
              </div>
              <div style={{textAlign:'right'}}>
                {d.chip ? (
                  <span style={{
                    display:'inline-block', padding:'3px 8px',
                    background: d.chipBg, color: d.chipFg,
                    border: d.chipBorder ? `1px solid ${d.chipBorder}` : 'none',
                    fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.12em', fontWeight:600,
                  }}>{d.chip}</span>
                ) : (
                  <Icon.ChevronRight size={14} color={isHov||isSel ? MUTED : FAINT}/>
                )}
              </div>
            </div>
            {/* Expanded detail panel */}
            {isSel && (
              <div style={{
                background:SURF2, borderBottom:`1px solid ${RULE}`,
                padding:'20px 24px 20px 34px',
                display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:24,
              }}>
                <div>
                  <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6}}>Details</div>
                  <div style={{fontFamily:SB.sans, fontSize:20, fontWeight:600, color:INK, letterSpacing:-0.5, lineHeight:1.1}}>
                    {s.headliner}
                  </div>
                  {s.support && s.support.length>0 && (
                    <div style={{fontFamily:SB.sans, fontSize:12.5, color:MUTED, marginTop:5}}>
                      with {s.support.join(', ')}
                    </div>
                  )}
                  {s.tour && (
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:8, letterSpacing:'.04em'}}>
                      {s.tour}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6}}>Venue</div>
                  <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:INK}}>{s.venue}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:3}}>
                    {(s.neighborhood || s.city || '').toLowerCase()}
                  </div>
                  {s.seat && s.seat !== '—' && (
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:6}}>
                      <span style={{color:FAINT}}>seat</span> {s.seat}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:6}}>Date</div>
                  <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:INK, fontFeatureSettings:'"tnum"'}}>
                    {s.date.dow}, {s.date.m} {s.date.d}, {s.date.y}
                  </div>
                  {s.countdown && (
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:ACCENT, marginTop:4}}>{s.countdown}</div>
                  )}
                  {s.paid && (
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:6}}>
                      <span style={{color:FAINT}}>paid</span> ${s.paid}
                    </div>
                  )}
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start'}}>
                  <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:2}}>Actions</div>
                  {st === 'watching' && (
                    <button style={{
                      padding:'8px 14px', background:ACCENT, color:ACCENT_TEXT, border:'none',
                      fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
                      display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
                    }}>
                      <Icon.Ticket size={13} color={ACCENT_TEXT}/> Buy tickets
                    </button>
                  )}
                  <button style={{
                    padding:'8px 14px', background:'transparent', border:`1px solid ${RULE2}`, color:INK,
                    fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
                    display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
                  }}>
                    <Icon.ArrowUpRight size={13} color={INK}/> Full detail
                  </button>
                  <button style={{
                    padding:'8px 14px', background:'transparent', border:`1px solid ${RULE2}`, color:INK,
                    fontFamily:SB.sans, fontSize:12.5, fontWeight:500,
                    display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
                  }}>
                    <Icon.More size={13} color={INK}/> Edit
                  </button>
                </div>
              </div>
            )}
            </React.Fragment>
          );
        })}
        <div style={{
          padding:'16px 20px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10.5, color:FAINT, letterSpacing:'.1em',
        }}>load 75 older shows</div>
      </div>
    </div>
  );
}

// ─── CALENDAR MODE ─────────────────────────────────────────────────────
// Events keyed by "YYYY-MM-D" so ‹ / › navigation works across months.
const CAL_EVENTS = {
  '2026-2-14': [{kind:'comedy',   label:'John Mulaney',     when:'past'}],
  '2026-3-8':  [{kind:'concert',  label:'Mitski',           when:'past'}],
  '2026-3-22': [{kind:'theatre', label:'Hadestown',        when:'past'}],
  '2026-4-4':  [{kind:'concert',  label:'Fontaines D.C.',   when:'past'}],
  '2026-4-20': [{kind:'concert',  label:'today',            when:'today'}],
  '2026-4-26': [{kind:'concert',  label:'Caroline Polachek',when:'up'}],
  '2026-5-4':  [{kind:'concert',  label:'Big Thief',        when:'up'}],
  '2026-5-12': [{kind:'theatre', label:'Oh, Mary!',        when:'up'}],
  '2026-5-28': [{kind:'festival', label:'Governors Ball',   when:'up'}],
  '2026-6-7':  [{kind:'concert',  label:'Yo La Tengo',      when:'watch'}],
  '2026-6-19': [{kind:'comedy',   label:'Nikki Glaser',     when:'watch'}],
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function CalendarMode() {
  const M='dark';
  const BG=SB.bg[M], SURF=SB.surface[M], INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];

  // Month state — 0-indexed month, 4-digit year. Default April 2026.
  const [cursor, setCursor] = React.useState({y:2026, m:3});
  const step = (d) => setCursor(c => {
    const m = c.m + d;
    if (m < 0)  return {y: c.y-1, m: 11};
    if (m > 11) return {y: c.y+1, m: 0};
    return {y: c.y, m};
  });
  const goToday = () => setCursor({y:2026, m:3});

  const y = cursor.y, mo = cursor.m; // 0-indexed
  const firstDow = new Date(y, mo, 1).getDay();
  const daysIn = new Date(y, mo+1, 0).getDate();
  const cells = [];
  for (let i=0; i<firstDow; i++) cells.push(null);
  for (let d=1; d<=daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const evFor = (d) => d ? (CAL_EVENTS[`${y}-${mo+1}-${d}`] || []) : [];
  const isToday = (d) => y===2026 && mo===3 && d===20;

  // counts for subtitle
  let past=0, up=0, watch=0;
  for (let d=1; d<=daysIn; d++) {
    evFor(d).forEach(e => {
      if (e.when==='past') past++;
      else if (e.when==='up') up++;
      else if (e.when==='watch') watch++;
    });
  }

  const dows = ['S','M','T','W','T','F','S'];

  return (
    <div style={{flex:1, minHeight:0, overflow:'auto', background:BG, padding:'22px 36px 36px'}}>
      {/* Month toolbar */}
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'baseline', gap:14}}>
          <div style={{fontFamily:SB.sans, fontSize:30, fontWeight:600, color:INK, letterSpacing:-0.9}}>
            {MONTH_NAMES[mo]} <span style={{color:FAINT, fontWeight:400}}>{y}</span>
          </div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:MUTED, letterSpacing:'.06em'}}>
            {past} past · {up} upcoming · {watch} watching
          </div>
        </div>
        <div style={{display:'flex', alignItems:'stretch', border:`1px solid ${RULE2}`}}>
          {[
            {l:'‹',     onClick:()=>step(-1)},
            {l:'Today', onClick:goToday},
            {l:'›',     onClick:()=>step(+1)},
          ].map(({l,onClick},i)=>(
            <button key={i} onClick={onClick} style={{
              padding:'7px 14px', fontFamily:SB.sans, fontSize:13, color:INK, cursor:'pointer',
              borderRight: i===2 ? 'none' : `1px solid ${RULE2}`,
              border:'none', background:'transparent', fontWeight:500,
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:22, minHeight:0}}>
        {/* calendar */}
        <div style={{background:SURF, border:`1px solid ${RULE}`}}>
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(7, 1fr)',
            borderBottom:`1px solid ${RULE}`,
          }}>
            {dows.map((d,i)=>(
              <div key={i} style={{
                padding:'9px 10px', fontFamily:SB.mono, fontSize:10, color:FAINT,
                letterSpacing:'.12em', textTransform:'uppercase',
              }}>{d}</div>
            ))}
          </div>
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gridAutoRows:'minmax(92px, 1fr)',
          }}>
            {cells.map((d, i)=>{
              const today = isToday(d);
              const evs = evFor(d);
              return (
                <div key={i} style={{
                  padding:'7px 9px',
                  borderRight: (i%7)===6 ? 'none' : `1px solid ${RULE}`,
                  borderBottom: `1px solid ${RULE}`,
                  background: today ? SB.surface2[M] : 'transparent',
                  opacity: d ? 1 : .35,
                  display:'flex', flexDirection:'column', gap:5,
                }}>
                  <div style={{
                    fontFamily:SB.mono, fontSize:11,
                    color: today ? INK : (d ? MUTED : FAINT),
                    fontWeight: today ? 600 : 400, letterSpacing:'.02em',
                  }}>
                    {d ?? ''}
                  </div>
                  {evs.map((e,j)=>(
                    <div key={j} style={{
                      fontFamily:SB.mono, fontSize:10, color:INK,
                      padding:'3px 6px',
                      background: e.when==='past' ? 'transparent' : window.kindInk(e.kind,true)+'22',
                      borderLeft:`2px solid ${window.kindInk(e.kind,true)}`,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                      letterSpacing:'.01em',
                    }}>
                      {e.label}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail — chronological list */}
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            This month & next
          </div>
          {[
            { date:'Apr 04', dow:'sat', headliner:'Fontaines D.C.', venue:'Kings Theatre', kind:'concert', tag:'past' },
            { date:'Apr 20', dow:'mon', headliner:'— today —',       venue:'',              kind:'concert', tag:'today' },
            { date:'Apr 26', dow:'sun', headliner:'Caroline Polachek', venue:'Knockdown Center', kind:'concert', tag:'tix' },
            { date:'May 04', dow:'mon', headliner:'Big Thief',       venue:'Forest Hills Stadium', kind:'concert', tag:'tix' },
            { date:'May 12', dow:'tue', headliner:'Oh, Mary!',       venue:'Lyceum Theatre', kind:'theatre', tag:'tix' },
            { date:'May 28', dow:'thu', headliner:'Governors Ball',  venue:'Flushing Meadows', kind:'festival', tag:'watch' },
          ].map((r,i)=>(
            <div key={i} style={{
              padding:'12px 14px', background:SURF,
              borderLeft: `2px solid ${window.kindInk(r.kind,true)}`,
              display:'grid', gridTemplateColumns:'58px 1fr auto', columnGap:12, alignItems:'start',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:15, fontWeight:500, color:r.tag==='past'?MUTED:INK, letterSpacing:-0.3, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                  {r.date}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, marginTop:3}}>
                  {r.dow}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:13, fontWeight:r.tag==='today'?400:500, fontStyle:r.tag==='today'?'italic':'normal', color:r.tag==='past'?MUTED:INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {r.headliner}
                </div>
                {r.venue && (
                  <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {r.venue.toLowerCase()}
                  </div>
                )}
              </div>
              <div style={{
                fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.06em', textTransform:'uppercase',
                color: r.tag==='past' ? FAINT : (r.tag==='watch' ? MUTED : INK), fontWeight:500,
              }}>
                {r.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── STATS MODE ────────────────────────────────────────────────────────
function StatsMode() {
  const M='dark';
  const BG=SB.bg[M], SURF=SB.surface[M], SURF2=SB.surface2[M];
  const INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const topArtists = [
    ['Big Thief', 5, 'concert'],
    ['Mitski', 4, 'concert'],
    ['Fontaines D.C.', 3, 'concert'],
    ['Hadestown', 2, 'theatre'],
    ['John Mulaney', 2, 'comedy'],
  ];
  const topVenues = [
    ['Radio City Music Hall', 8, 'Midtown'],
    ['Brooklyn Steel', 6, 'East Williamsburg'],
    ['Kings Theatre', 5, 'Flatbush'],
    ['Webster Hall', 4, 'East Village'],
    ['Beacon Theatre', 3, 'Upper West Side'],
  ];
  const MAX = 8;

  return (
    <div style={{flex:1, minHeight:0, overflow:'auto', background:BG, padding:'22px 36px 36px'}}>
      {/* Big headline numbers */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:1, background:RULE, marginBottom:22,
      }}>
        {[
          ['87',     'shows',  'all time'],
          ['$8,042', 'spent',  'avg $92 / show'],
          ['34',     'venues', '9 in rotation'],
          ['142',    'artists','+ 3 new in 2026'],
        ].map(([v,l,sub])=>(
          <div key={l} style={{background:SURF, padding:'22px 22px 20px'}}>
            <div style={{fontFamily:SB.sans, fontSize:44, fontWeight:500, color:INK, letterSpacing:-1.6, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>
              {v}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', marginTop:10, fontWeight:500}}>
              {l}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT, marginTop:3}}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      {/* Rhythm — the ONE place it lives */}
      <div style={{background:SURF, padding:'22px 26px', marginBottom:22}}>
        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:18}}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
              Rhythm · 2026
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT, marginTop:4}}>
              14 shows year-to-date · pace for ~28
            </div>
          </div>
          <div style={{display:'flex', gap:16, fontFamily:SB.mono, fontSize:10.5, color:MUTED}}>
            <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
              <Icon.SquareFilled size={9} color={INK}/> attended
            </span>
            <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
              <Icon.Square size={9} color={INK}/> ticketed
            </span>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:6, alignItems:'end', height:96, position:'relative'}}>
          {HIFI_RHYTHM.map((m,i)=>{
            const isNow = i===3;
            return (
              <div key={i} style={{display:'flex', flexDirection:'column-reverse', gap:2, height:'100%', position:'relative'}}>
                {Array.from({length:m.a}).map((_,j)=>(
                  <div key={'a'+j} style={{height:18, background:INK}}/>
                ))}
                {Array.from({length:m.t}).map((_,j)=>(
                  <div key={'t'+j} style={{height:18, border:`1.25px solid ${INK}`, background:'transparent'}}/>
                ))}
                {isNow && (
                  <div style={{
                    position:'absolute', top:-16, left:'50%', transform:'translateX(-50%)',
                    fontFamily:SB.mono, fontSize:9, color:SB.kinds.concert.inkDark,
                    letterSpacing:'.1em', whiteSpace:'nowrap', fontWeight:500,
                  }}>TODAY</div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:6, marginTop:10}}>
          {months.map((m,i)=>(
            <div key={i} style={{
              textAlign:'center', fontFamily:SB.mono, fontSize:10,
              color: i===3 ? INK : FAINT, letterSpacing:'.06em',
              fontWeight: i===3 ? 500 : 400,
            }}>{m}</div>
          ))}
        </div>
      </div>

      {/* Three columns: most seen artists / most frequented venues / kind mix */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 340px', gap:22}}>
        {/* Most seen */}
        <div style={{background:SURF, padding:'22px 22px 18px'}}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:16}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
              Most seen
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT}}>all time</div>
          </div>
          {topArtists.map(([name,count,kind])=>(
            <div key={name} style={{
              display:'grid', gridTemplateColumns:'1fr 130px 30px', columnGap:14,
              alignItems:'center', padding:'11px 0', borderBottom:`1px solid ${RULE}`,
            }}>
              <div style={{fontFamily:SB.sans, fontSize:14, color:INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {name}
              </div>
              <div style={{display:'flex', gap:2}}>
                {Array.from({length:MAX}).map((_,i)=>(
                  <div key={i} style={{
                    height:9, flex:1,
                    background: i<count ? window.kindInk(kind,true) : 'transparent',
                    border: i<count ? 'none' : `1px solid ${RULE2}`,
                  }}/>
                ))}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11.5, color:INK, textAlign:'right', fontWeight:500}}>{count}×</div>
            </div>
          ))}
        </div>

        {/* Venues */}
        <div style={{background:SURF, padding:'22px 22px 18px'}}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:16}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
              Most frequented
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT}}>venues · all time</div>
          </div>
          {topVenues.map(([name,count,hood])=>(
            <div key={name} style={{
              display:'grid', gridTemplateColumns:'1fr 130px 30px', columnGap:14,
              alignItems:'center', padding:'11px 0', borderBottom:`1px solid ${RULE}`,
            }}>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, color:INK, letterSpacing:-0.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {name}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:2}}>
                  {hood.toLowerCase()}
                </div>
              </div>
              <div style={{display:'flex', gap:2}}>
                {Array.from({length:MAX}).map((_,i)=>(
                  <div key={i} style={{
                    height:9, flex:1,
                    background: i<count ? INK : 'transparent',
                    border: i<count ? 'none' : `1px solid ${RULE2}`,
                  }}/>
                ))}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11.5, color:INK, textAlign:'right', fontWeight:500}}>{count}</div>
            </div>
          ))}
        </div>

        {/* Kind mix — just a column of percentages */}
        <div style={{background:SURF, padding:'22px 22px 18px'}}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:16}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
              By kind
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT}}>all 87</div>
          </div>
          {[
            ['concert',  62, '71%'],
            ['theatre', 14, '16%'],
            ['comedy',    8,  '9%'],
            ['festival',  3,  '4%'],
          ].map(([k,n,pct])=>{
            const KIc = KindIcon[k];
            return (
            <div key={k} style={{padding:'12px 0', borderBottom:`1px solid ${RULE}`}}>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:6}}>
                <span style={{
                  display:'inline-flex', alignItems:'center', gap:7,
                  fontFamily:SB.mono, fontSize:11, color:window.kindInk(k,true), letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                }}>
                  <KIc size={13} color={window.kindInk(k,true)}/>
                  {HIFI_KINDS[k].label}
                </span>
                <span style={{fontFamily:SB.mono, fontSize:11, color:INK, fontWeight:500}}>{n} · {pct}</span>
              </div>
              <div style={{height:6, background:SURF2}}>
                <div style={{width:pct, height:'100%', background:window.kindInk(k,true)}}/>
              </div>
            </div>
          );})}
        </div>
      </div>

      {/* Superlatives strip */}
      <div style={{marginTop:22, background:SURF, padding:'20px 26px'}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, marginBottom:14}}>
          Superlatives · 2026
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:24}}>
          {[
            ['Priciest',     '$189', 'Gypsy · Dec 29'],
            ['Longest show', '2h 44m', 'Hadestown · Mar 22'],
            ['Longest walk', '11 blk', 'Kings → Prospect'],
            ['Best streak',  '3 wks', 'Feb 1 → Feb 22'],
          ].map(([l, v, sub])=>(
            <div key={l}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{l}</div>
              <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:500, color:INK, letterSpacing:-0.7, marginTop:6, fontFeatureSettings:'"tnum"'}}>{v}</div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:4}}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────────
function ShowsV2Web({initialMode='list'}) {
  const [mode, setMode] = React.useState(initialMode);
  const M='dark';
  const counts = {list:'91 shows', calendar:'april 2026', stats:'8 years'};
  return (
    <div style={{
      width:'100%', height:'100%', background:SB.bg[M], color:SB.ink[M],
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <V2Sidebar active="shows"/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        <ShowsHeader mode={mode} onMode={setMode} totalShown={counts[mode]}/>
        {mode==='list' && <ListMode/>}
        {mode==='calendar' && <CalendarMode/>}
        {mode==='stats' && <StatsMode/>}
      </div>
    </div>
  );
}

// ── Mobile: mode switcher as segmented row, content below ──
function ShowsV2Mobile({initialMode='list'}) {
  const [mode, setMode] = React.useState(initialMode);
  const M='light';
  const BG=SB.bg[M], SURF=SB.surface[M], INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const kInk = (k) => SB.kinds[k].ink;

  const modes = [
    { k:'list',     l:'List',     Ic:Icon.Archive },
    { k:'calendar', l:'Calendar', Ic:Icon.Calendar },
    { k:'stats',    l:'Stats',    Ic:Icon.Sort },
  ];

  return (
    <div style={{
      height:'100%', background:BG, color:INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      <div style={{padding:'60px 20px 14px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
          <div style={{fontFamily:SB.sans, fontSize:28, fontWeight:600, letterSpacing:-0.9, color:INK}}>
            Shows
          </div>
          <div style={{display:'flex', gap:14}}>
            <Icon.Search size={18} color={INK}/>
            <Icon.Filter size={18} color={INK}/>
          </div>
        </div>
        <div style={{display:'flex', border:`1px solid ${RULE2}`}}>
          {modes.map(({k,l,Ic},i)=>{
            const active = k===mode;
            return (
              <button key={k} onClick={()=>setMode(k)} style={{
                flex:1, border:'none', cursor:'pointer',
                borderRight: i===modes.length-1 ? 'none' : `1px solid ${RULE2}`,
                background: active ? INK : 'transparent',
                color: active ? BG : INK,
                padding:'9px 10px', fontFamily:SB.sans, fontSize:13, fontWeight:active?600:500,
                letterSpacing:-0.1,
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              }}>
                <Ic size={13} color={active?BG:INK}/>{l}
              </button>
            );
          })}
        </div>
      </div>

      {mode==='list' && (
        <div style={{flex:1, overflow:'auto'}}>
          <div style={{padding:'10px 20px 6px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>All shows · 94</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED}}>tix · watching · past</div>
          </div>
          {[...FUTURE_ROWS, ...LEDGER_ROWS.filter(r=>r.state==='past')].slice(0,12).map(s=>{
            const st = s.state || 'past';
            const KIc = KindIcon[s.kind];
            const kc = kInk(s.kind);
            const barStyle = st==='tix' ? `2px solid ${INK}` : (st==='watching' ? `2px dashed ${INK}` : `2px solid ${kc}`);
            const chip = st==='tix' ? 'TIX' : (st==='watching' ? 'WATCH' : null);
            return (
              <div key={s.id} style={{
                padding:'13px 20px 13px 16px', borderTop:`1px solid ${RULE}`,
                display:'grid', gridTemplateColumns:'6px 42px 1fr auto', columnGap:10, alignItems:'start',
                position:'relative',
              }}>
                <div style={{width:0, height:'70%', alignSelf:'center', borderLeft:barStyle, marginLeft:2}}/>
                <div>
                  <div style={{fontFamily:SB.sans, fontSize:20, fontWeight:500, color:st==='past'?INK:INK, letterSpacing:-0.6, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>{s.date.d}</div>
                  <div style={{fontFamily:SB.mono, fontSize:9.5, color:st==='past'?FAINT:kc, marginTop:3, letterSpacing:'.04em', fontWeight:500, textTransform:'uppercase'}}>{s.date.m}</div>
                </div>
                <div style={{minWidth:0}}>
                  <div style={{display:'inline-flex', alignItems:'center', gap:5,
                    fontFamily:SB.mono, fontSize:9.5, fontWeight:500, color:kc,
                    letterSpacing:'.04em', textTransform:'lowercase'}}>
                    <KIc size={11} color={kc}/>
                    {HIFI_KINDS[s.kind].label}
                  </div>
                  <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:INK, letterSpacing:-0.2, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{s.headliner}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{(s.venue||'').toLowerCase()}</div>
                </div>
                <div style={{textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4}}>
                  {chip ? (
                    <span style={{
                      padding:'2px 6px',
                      background: st==='tix'?INK:'transparent',
                      color: st==='tix'?BG:INK,
                      border: st==='watching' ? `1px solid ${INK}` : 'none',
                      fontFamily:SB.mono, fontSize:9, letterSpacing:'.1em', fontWeight:600,
                    }}>{chip}</span>
                  ) : (
                    s.paid && <span style={{fontFamily:SB.mono, fontSize:11, color:INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>${s.paid}</span>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{padding:'16px 20px 24px', textAlign:'center', fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.14em'}}>LOAD 80 OLDER</div>
        </div>
      )}

      {mode==='calendar' && (
        <div style={{flex:1, overflow:'auto', padding:'12px 20px 24px'}}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:INK, letterSpacing:-0.6}}>
              April <span style={{color:FAINT, fontWeight:400}}>2026</span>
            </div>
            <div style={{display:'flex', gap:12}}>
              <Icon.ChevronRight size={16} color={INK} style={{transform:'rotate(180deg)'}}/>
              <Icon.ChevronRight size={16} color={INK}/>
            </div>
          </div>
          {/* compact calendar grid */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:4}}>
            {['S','M','T','W','T','F','S'].map((d,i)=>(
              <div key={i} style={{textAlign:'center', fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.1em', padding:'2px 0 6px'}}>{d}</div>
            ))}
            {Array.from({length:3}).map((_,i)=>(<div key={'b'+i}/>))}
            {Array.from({length:30}).map((_,i)=>{
              const d = i+1;
              const ev = ({4:'concert',20:'today',26:'concert'})[d];
              const isToday = d===20;
              return (
                <div key={d} style={{
                  aspectRatio:'1 / 1', padding:'5px 6px',
                  background: isToday ? SB.surface2[M] : SURF,
                  border: `1px solid ${RULE}`,
                  display:'flex', flexDirection:'column',
                }}>
                  <div style={{fontFamily:SB.mono, fontSize:10.5, color: isToday?INK:MUTED, fontWeight:isToday?600:400}}>
                    {d}
                  </div>
                  {ev && ev!=='today' && (
                    <div style={{marginTop:'auto', height:3, background:kInk(ev)}}/>
                  )}
                  {ev==='today' && (
                    <div style={{marginTop:'auto', fontFamily:SB.mono, fontSize:8, color:kInk('concert'), letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>now</div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{marginTop:22, fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, marginBottom:8}}>
            this month
          </div>
          {[
            {date:'Apr 04', head:'Fontaines D.C.',   kind:'concert', tag:'past'},
            {date:'Apr 26', head:'Caroline Polachek', kind:'concert', tag:'tix'},
          ].map((r,i)=>(
            <div key={i} style={{
              padding:'11px 12px', background:SURF, borderLeft:`2px solid ${kInk(r.kind)}`,
              marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center',
            }}>
              <div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.04em'}}>{r.date.toLowerCase()}</div>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:r.tag==='past'?500:600, color:r.tag==='past'?MUTED:INK, marginTop:3}}>{r.head}</div>
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color: r.tag==='past'?FAINT:INK, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>{r.tag}</div>
            </div>
          ))}
        </div>
      )}

      {mode==='stats' && (
        <div style={{flex:1, overflow:'auto', padding:'12px 20px 24px'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:1, background:RULE, marginBottom:18}}>
            {[
              ['87',    'shows'],
              ['$8,042','spent'],
              ['34',    'venues'],
              ['142',   'artists'],
            ].map(([v,l])=>(
              <div key={l} style={{background:SURF, padding:'16px 16px 14px'}}>
                <div style={{fontFamily:SB.sans, fontSize:28, fontWeight:500, color:INK, letterSpacing:-0.9, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>{v}</div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, letterSpacing:'.1em', textTransform:'uppercase', marginTop:8, fontWeight:500}}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{background:SURF, padding:'16px 18px', marginBottom:16}}>
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14}}>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>Rhythm · 2026</div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT}}>pace ~28</div>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, alignItems:'end', height:60}}>
              {HIFI_RHYTHM.map((m,i)=>{
                const isNow = i===3;
                return (
                  <div key={i} style={{display:'flex', flexDirection:'column-reverse', gap:2, height:'100%', position:'relative'}}>
                    {Array.from({length:m.a}).map((_,j)=>(<div key={'a'+j} style={{height:11, background:INK}}/>))}
                    {Array.from({length:m.t}).map((_,j)=>(<div key={'t'+j} style={{height:11, border:`1.25px solid ${INK}`}}/>))}
                    {isNow && (<div style={{position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', width:2, height:4, background:SB.kinds.concert.ink}}/>)}
                  </div>
                );
              })}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, marginTop:8}}>
              {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m,i)=>(
                <div key={i} style={{textAlign:'center', fontFamily:SB.mono, fontSize:9.5, color:i===3?INK:FAINT, fontWeight:i===3?500:400}}>{m}</div>
              ))}
            </div>
          </div>

          <div style={{fontFamily:SB.mono, fontSize:10.5, color:INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, marginBottom:8}}>Most seen</div>
          {[
            ['Big Thief', 5, 'concert'],
            ['Mitski', 4, 'concert'],
            ['Fontaines D.C.', 3, 'concert'],
            ['Hadestown', 2, 'theatre'],
          ].map(([n,c,k])=>(
            <div key={n} style={{display:'grid', gridTemplateColumns:'1fr 96px 28px', columnGap:10, alignItems:'center', padding:'9px 0', borderBottom:`1px solid ${RULE}`}}>
              <div style={{fontFamily:SB.sans, fontSize:13, color:INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{n}</div>
              <div style={{display:'flex', gap:2}}>
                {Array.from({length:6}).map((_,i)=>(
                  <div key={i} style={{height:8, flex:1, background:i<c?kInk(k):'transparent', border:i<c?'none':`1px solid ${RULE2}`}}/>
                ))}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:11, color:INK, textAlign:'right', fontWeight:500}}>{c}×</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{display:'flex', borderTop:`1px solid ${RULE2}`, background:BG, padding:'12px 8px 30px'}}>
        {[
          { k:'home', l:'Home', Ic:Icon.Home },
          { k:'shows',l:'Shows',Ic:Icon.Archive, active:true },
          { k:'add',  l:'Add',  Ic:Icon.Plus, cta:true },
          { k:'map',  l:'Map',  Ic:Icon.Map },
          { k:'me',   l:'Me',   Ic:Icon.User },
        ].map(({k,l,Ic,active,cta})=>(
          <div key={k} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width:cta?34:26, height:cta?34:26,
              background:cta?INK:'transparent', color:cta?BG:(active?INK:MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius:cta?999:0,
            }}>
              <Ic size={cta?20:18}/>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color:active?INK:MUTED, fontWeight:active?500:400, textTransform:'lowercase'}}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.ShowsV2Web = ShowsV2Web;
window.ShowsV2Mobile = ShowsV2Mobile;
