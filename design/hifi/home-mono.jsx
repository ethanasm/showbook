// Direction 2 · Minimal / monospace (setlist.fm energy)
// All-mono, data-forward. Tight density. Accents ONLY via kind color dot.
// No gradients, no rounded cards — horizontal rules and whitespace.

const { HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_RHYTHM, HIFI_TOTALS } = window;

const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", monospace';
const INK = '#0B0B0B';
const MUTED = 'rgba(11,11,11,.5)';
const FAINT = 'rgba(11,11,11,.2)';
const RULE = 'rgba(11,11,11,.12)';
const PAPER = '#F7F6F2';

function KindDot({kind, size=8}) {
  return <span style={{
    display:'inline-block', width:size, height:size, borderRadius:'50%',
    background: HIFI_KINDS[kind].ink,
    verticalAlign:'middle',
  }}/>;
}

function PastRow({show, idx}) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{
      padding:'14px 20px', borderBottom:`1px solid ${RULE}`,
      display:'grid', gridTemplateColumns:'52px 1fr auto', columnGap:14,
      alignItems:'start',
    }}>
      <div>
        <div style={{fontFamily:MONO, fontSize:10, color:MUTED, letterSpacing:.05}}>
          {show.date.m}
        </div>
        <div style={{
          fontFamily:MONO, fontSize:22, fontWeight:500, color:INK,
          letterSpacing:-.5, marginTop:1, lineHeight:1,
        }}>{show.date.d}</div>
        <div style={{fontFamily:MONO, fontSize:9, color:MUTED, marginTop:3, letterSpacing:.1}}>
          {show.date.dow}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
          <KindDot kind={show.kind} size={7}/>
          <span style={{fontFamily:MONO, fontSize:9.5, color:k.ink, letterSpacing:.12, textTransform:'uppercase'}}>
            {k.label}
          </span>
        </div>
        <div style={{
          fontFamily:'Fraunces, serif', fontWeight:600, fontSize:19,
          lineHeight:1.15, letterSpacing:-.35, color:INK,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:'Inter, sans-serif', fontSize:12, color:MUTED,
            marginTop:2, fontWeight:400,
          }}>+ {show.support.join(', ')}</div>
        )}
        <div style={{
          fontFamily:MONO, fontSize:10, color:'rgba(11,11,11,.7)',
          marginTop:6, letterSpacing:.02,
        }}>{show.venue.toLowerCase()} · {show.neighborhood.toLowerCase()}</div>
        {show.setlistCount && (
          <div style={{fontFamily:MONO, fontSize:9, color:MUTED, marginTop:3, letterSpacing:.02}}>
            setlist · {show.setlistCount} songs{show.encore ? ' · encore' : ''}
          </div>
        )}
        {show.cast && (
          <div style={{fontFamily:MONO, fontSize:9, color:MUTED, marginTop:3, letterSpacing:.02}}>
            cast · {show.cast.join(', ').toLowerCase()}
          </div>
        )}
      </div>
      <div style={{textAlign:'right'}}>
        <div style={{fontFamily:MONO, fontSize:12, color:INK, fontWeight:500}}>
          ${show.paid}
        </div>
        <div style={{fontFamily:MONO, fontSize:9, color:MUTED, marginTop:2, letterSpacing:.02}}>
          {show.seat.toLowerCase()}
        </div>
      </div>
    </div>
  );
}

function UpcomingRow({show, first=false}) {
  const k = HIFI_KINDS[show.kind];
  const daysOut = show.countdown;
  return (
    <div style={{
      padding:'14px 20px',
      borderTop: first ? 'none' : `1px solid ${RULE}`,
      borderLeft:`2px solid ${k.ink}`,
      display:'grid', gridTemplateColumns:'64px 1fr auto', columnGap:14,
      alignItems:'start', marginLeft:-2,
    }}>
      <div>
        <div style={{fontFamily:MONO, fontSize:9, color:k.ink, letterSpacing:.08, fontWeight:500}}>
          {show.date.m} {show.date.d}
        </div>
        <div style={{
          fontFamily:MONO, fontSize:11, fontWeight:500, color:INK,
          marginTop:2, letterSpacing:-.1,
        }}>{daysOut}</div>
        <div style={{
          fontFamily:MONO, fontSize:9, letterSpacing:.1,
          color: show.hasTix ? INK : MUTED, marginTop:6,
          textTransform:'uppercase', fontWeight:500,
        }}>
          {show.hasTix ? '◼ ticketed' : '◻ watching'}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
          <KindDot kind={show.kind} size={7}/>
          <span style={{fontFamily:MONO, fontSize:9.5, color:k.ink, letterSpacing:.12, textTransform:'uppercase'}}>
            {k.label}
          </span>
        </div>
        <div style={{
          fontFamily:'Fraunces, serif', fontWeight:600, fontSize:19,
          lineHeight:1.15, letterSpacing:-.35, color:INK,
        }}>{show.headliner}</div>
        {show.support.length>0 && (
          <div style={{
            fontFamily:'Inter, sans-serif', fontSize:12, color:MUTED,
            marginTop:2,
          }}>+ {show.support.slice(0,2).join(', ')}{show.support.length>2 && ` + ${show.support.length-2}`}</div>
        )}
        <div style={{fontFamily:MONO, fontSize:10, color:'rgba(11,11,11,.7)', marginTop:6}}>
          {show.venue.toLowerCase()} · {show.city.toLowerCase()}
        </div>
      </div>
      <div style={{textAlign:'right'}}>
        {show.paid ? (
          <div style={{fontFamily:MONO, fontSize:12, color:INK, fontWeight:500}}>${show.paid}</div>
        ) : (
          <div style={{fontFamily:MONO, fontSize:10, color:MUTED}}>—</div>
        )}
      </div>
    </div>
  );
}

function YearBars() {
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const MAX = 4;
  return (
    <div style={{padding:'16px 20px', borderTop:`1px solid ${RULE}`, borderBottom:`1px solid ${RULE}`}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <div style={{fontFamily:MONO, fontSize:11, color:INK, letterSpacing:.08, fontWeight:500}}>
          2026 · rhythm
        </div>
        <div style={{fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:.08}}>
          ◼ attended ◻ ticket
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:2, alignItems:'end', height:52}}>
        {HIFI_RHYTHM.map((m,i)=>{
          return (
            <div key={i} style={{display:'flex', flexDirection:'column-reverse', gap:1, height:'100%'}}>
              {Array.from({length:m.a}).map((_,j)=>(
                <div key={'a'+j} style={{height:10, background:INK}}/>
              ))}
              {Array.from({length:m.t}).map((_,j)=>(
                <div key={'t'+j} style={{height:10, border:`1.25px solid ${INK}`, background:'transparent'}}/>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:2, marginTop:6}}>
        {months.map((m,i)=>(
          <div key={i} style={{
            textAlign:'center', fontFamily:MONO, fontSize:9,
            color: i===3 ? INK : MUTED, letterSpacing:.05,
            fontWeight: i===3 ? 500 : 400,
          }}>{m}</div>
        ))}
      </div>
    </div>
  );
}

function HomeMono() {
  return (
    <div style={{
      height:'100%', background:PAPER, color:INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
    }}>
      {/* Header */}
      <div style={{padding:'66px 20px 16px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontFamily:MONO, fontSize:10, color:MUTED, letterSpacing:.12}}>
            mon · apr 20 · 2026
          </div>
          <div style={{display:'flex', gap:10, alignItems:'center'}}>
            <div style={{fontFamily:MONO, fontSize:11, color:INK, letterSpacing:.02}}>⌕</div>
            <div style={{fontFamily:MONO, fontSize:11, color:INK, letterSpacing:.02}}>⋯</div>
          </div>
        </div>
        <div style={{
          fontFamily:MONO, fontSize:22, fontWeight:500, color:INK,
          marginTop:18, letterSpacing:-.6,
        }}>
          showbook<span style={{color:MUTED}}>/</span>m
        </div>
        <div style={{display:'flex', gap:20, marginTop:14}}>
          <div>
            <div style={{fontFamily:MONO, fontSize:20, fontWeight:500, color:INK, letterSpacing:-.3}}>
              {HIFI_TOTALS.shows}
            </div>
            <div style={{fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:.08, marginTop:2}}>
              shows · 2026
            </div>
          </div>
          <div>
            <div style={{fontFamily:MONO, fontSize:20, fontWeight:500, color:INK, letterSpacing:-.3}}>
              {HIFI_TOTALS.spent}
            </div>
            <div style={{fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:.08, marginTop:2}}>
              spent
            </div>
          </div>
          <div>
            <div style={{fontFamily:MONO, fontSize:20, fontWeight:500, color:INK, letterSpacing:-.3}}>
              {HIFI_TOTALS.venues}
            </div>
            <div style={{fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:.08, marginTop:2}}>
              venues
            </div>
          </div>
          <div>
            <div style={{fontFamily:MONO, fontSize:20, fontWeight:500, color:INK, letterSpacing:-.3}}>
              {HIFI_TOTALS.artists}
            </div>
            <div style={{fontFamily:MONO, fontSize:9, color:MUTED, letterSpacing:.08, marginTop:2}}>
              artists
            </div>
          </div>
        </div>
      </div>

      {/* Scroll */}
      <div style={{flex:1, overflow:'auto'}}>
        {/* Section — upcoming */}
        <div style={{padding:'14px 20px 10px', borderTop:`1.5px solid ${INK}`, display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:MONO, fontSize:11, color:INK, letterSpacing:.12, textTransform:'uppercase', fontWeight:500}}>
            ↗ upcoming
          </div>
          <div style={{fontFamily:MONO, fontSize:10, color:MUTED}}>
            next 90d · 4
          </div>
        </div>
        <div>
          {HIFI_UPCOMING.map((s,i)=>(
            <UpcomingRow key={s.id} show={s} first={i===0}/>
          ))}
        </div>

        {/* Year bars */}
        <YearBars/>

        {/* Section — past */}
        <div style={{padding:'14px 20px 10px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:MONO, fontSize:11, color:INK, letterSpacing:.12, textTransform:'uppercase', fontWeight:500}}>
            ↙ recent
          </div>
          <div style={{fontFamily:MONO, fontSize:10, color:MUTED}}>
            87 total · all →
          </div>
        </div>
        <div style={{borderTop:`1px solid ${RULE}`}}>
          {HIFI_PAST.map(s=>(
            <PastRow key={s.id} show={s}/>
          ))}
        </div>

        <div style={{padding:'18px 20px 10px', textAlign:'center', fontFamily:MONO, fontSize:9, color:FAINT, letterSpacing:.15}}>
          — end of feed —
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1.5px solid ${INK}`, background:PAPER,
        padding:'10px 8px 28px',
      }}>
        {[
          ['home', '▮▮', true],
          ['past', '◼', false],
          ['+ add', '+', false, true],
          ['map', '◌', false],
          ['me', '◉', false],
        ].map(([label, g, active, cta])=>(
          <div key={label} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3}}>
            <div style={{
              width: cta ? 28 : 22, height: cta ? 28 : 22,
              background: cta ? INK : 'transparent',
              color: cta ? PAPER : (active ? INK : MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:MONO, fontSize: cta ? 15 : 11, fontWeight:500,
            }}>{g}</div>
            <div style={{
              fontFamily:MONO, fontSize:9, letterSpacing:.1,
              color: active ? INK : MUTED, fontWeight: active ? 500 : 400,
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.HomeMono = HomeMono;
