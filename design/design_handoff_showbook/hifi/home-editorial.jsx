// Direction 3 · Editorial / almanac
// Newspaper-grid composition. Fraunces display + Inter body.
// Muted per-kind accents. Rules, drop caps, bylines.

const { HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_RHYTHM, HIFI_TOTALS } = window;

const ED_PAPER = '#F4F0E8';
const ED_INK = '#17140F';
const ED_RULE = 'rgba(23,20,15,.18)';
const ED_MUTED = 'rgba(23,20,15,.55)';

function EdKindTag({kind}) {
  const k = HIFI_KINDS[kind];
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontFamily:'"JetBrains Mono", monospace', fontSize:9,
      letterSpacing:'.16em', textTransform:'uppercase',
      color:k.ink, fontWeight:500,
    }}>
      <span style={{width:5, height:5, borderRadius:'50%', background:k.ink}}/>
      {k.label}
    </span>
  );
}

// Lead story — the biggest upcoming show, full-width hero
function LeadStory({show}) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{
      padding:'20px 20px 22px', borderBottom:`1px solid ${ED_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
        <EdKindTag kind={show.kind}/>
        <div style={{
          fontFamily:'"JetBrains Mono", monospace', fontSize:9,
          letterSpacing:'.15em', color:ED_MUTED, textTransform:'uppercase',
        }}>LEAD · {show.countdown}</div>
      </div>
      <div style={{
        fontFamily:'Fraunces, serif', fontWeight:700, fontSize:40,
        lineHeight:.98, letterSpacing:-1.2, color:ED_INK,
      }}>{show.headliner}</div>
      <div style={{
        fontFamily:'Fraunces, serif', fontStyle:'italic', fontWeight:400,
        fontSize:16, color:'rgba(23,20,15,.7)', marginTop:8, lineHeight:1.35,
      }}>
        {show.support.length > 0
          ? `with ${show.support.join(', ')}, at ${show.venue}.`
          : `at ${show.venue}.`}
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'auto 1px 1fr auto', gap:12,
        alignItems:'center', marginTop:14, paddingTop:12,
        borderTop:`1px solid ${ED_RULE}`,
      }}>
        <div>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontSize:28,
            color:k.ink, lineHeight:.95, letterSpacing:-.3,
          }}>{show.date.d}</div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.14em', color:ED_MUTED, marginTop:3,
          }}>{show.date.m} · {show.date.dow}</div>
        </div>
        <div style={{width:1, height:32, background:ED_RULE}}/>
        <div>
          <div style={{fontFamily:'Inter, sans-serif', fontSize:12, fontWeight:500, color:ED_INK}}>
            {show.city}
          </div>
          <div style={{fontFamily:'Inter, sans-serif', fontSize:11, color:ED_MUTED, marginTop:2}}>
            {show.seat} · ${show.paid}
          </div>
        </div>
        <div style={{
          fontFamily:'"JetBrains Mono", monospace', fontSize:9,
          letterSpacing:'.14em', textTransform:'uppercase',
          color:show.hasTix ? ED_INK : ED_MUTED,
          border:`1px solid ${show.hasTix ? ED_INK : ED_MUTED}`,
          padding:'4px 8px',
        }}>
          {show.hasTix ? 'TICKETED' : 'WATCHING'}
        </div>
      </div>
    </div>
  );
}

// Smaller upcoming briefs — "also on the calendar"
function Brief({show}) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{padding:'12px 0', borderBottom:`1px solid ${ED_RULE}`, display:'grid', gridTemplateColumns:'44px 1fr auto', columnGap:10, alignItems:'start'}}>
      <div>
        <div style={{fontFamily:'Fraunces, serif', fontWeight:700, fontSize:20, color:k.ink, lineHeight:.95, letterSpacing:-.3}}>
          {show.date.d}
        </div>
        <div style={{fontFamily:'"JetBrains Mono", monospace', fontSize:8.5, letterSpacing:'.15em', color:ED_MUTED, marginTop:2}}>
          {show.date.m}
        </div>
      </div>
      <div style={{minWidth:0}}>
        <EdKindTag kind={show.kind}/>
        <div style={{
          fontFamily:'Fraunces, serif', fontWeight:600, fontSize:16,
          lineHeight:1.15, letterSpacing:-.3, color:ED_INK, marginTop:3,
        }}>{show.headliner}</div>
        <div style={{fontFamily:'Inter, sans-serif', fontSize:11, color:ED_MUTED, marginTop:2, lineHeight:1.35}}>
          {show.venue} · {show.countdown}
        </div>
      </div>
      <div style={{textAlign:'right'}}>
        <div style={{
          fontFamily:'"JetBrains Mono", monospace', fontSize:8.5,
          letterSpacing:'.14em', color: show.hasTix ? ED_INK : ED_MUTED,
          textTransform:'uppercase',
        }}>
          {show.hasTix ? '◼ tix' : '◻ watch'}
        </div>
      </div>
    </div>
  );
}

// Past entry — editorial review style with drop cap on most-recent
function PastEntry({show, first=false}) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{
      padding:'14px 0 16px', borderBottom:`1px solid ${ED_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
        <EdKindTag kind={show.kind}/>
        <div style={{
          fontFamily:'"JetBrains Mono", monospace', fontSize:9,
          letterSpacing:'.12em', color:ED_MUTED,
        }}>{show.date.m} {show.date.d} · {show.date.dow}</div>
      </div>
      <div style={{
        fontFamily:'Fraunces, serif', fontWeight:700, fontSize: first ? 24 : 20,
        lineHeight:1.08, letterSpacing: first ? -.5 : -.4, color:ED_INK,
      }}>{show.headliner}</div>
      {show.support.length > 0 && (
        <div style={{
          fontFamily:'Fraunces, serif', fontStyle:'italic',
          fontSize:13, color:'rgba(23,20,15,.65)', marginTop:3,
        }}>with {show.support.join(', ')}</div>
      )}
      <div style={{
        display:'flex', gap:14, alignItems:'center', marginTop:8,
        fontFamily:'Inter, sans-serif', fontSize:11, color:ED_MUTED,
      }}>
        <span style={{color:'rgba(23,20,15,.75)'}}>{show.venue}</span>
        <span style={{width:3, height:3, borderRadius:'50%', background:ED_RULE}}/>
        <span>{show.seat}</span>
        <span style={{width:3, height:3, borderRadius:'50%', background:ED_RULE}}/>
        <span style={{fontFamily:'"JetBrains Mono", monospace', fontSize:10.5, color:ED_INK}}>
          ${show.paid}
        </span>
      </div>
      {(show.setlistCount || show.tour) && (
        <div style={{
          fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:12,
          color:'rgba(23,20,15,.55)', marginTop:7, paddingLeft:10,
          borderLeft:`2px solid ${k.ink}55`,
        }}>
          {show.tour}{show.setlistCount && ` — ${show.setlistCount} songs${show.encore ? ', with encore' : ''}`}.
        </div>
      )}
    </div>
  );
}

function YearAlmanac() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    <div style={{
      padding:'18px 20px',
      background:'#EDE7DA',
      borderTop:`1px solid ${ED_RULE}`, borderBottom:`1px solid ${ED_RULE}`,
    }}>
      <div style={{
        display:'flex', alignItems:'baseline', justifyContent:'space-between',
        marginBottom:14,
      }}>
        <div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.2em', color:ED_MUTED, textTransform:'uppercase',
          }}>ALMANAC</div>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontStyle:'italic',
            fontSize:22, color:ED_INK, marginTop:2, letterSpacing:-.3,
          }}>The year so far</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontFamily:'Fraunces, serif', fontWeight:700, fontSize:28, color:ED_INK, lineHeight:1, letterSpacing:-.5}}>
            {HIFI_TOTALS.shows}<span style={{fontSize:15, color:ED_MUTED}}>/87</span>
          </div>
          <div style={{fontFamily:'"JetBrains Mono", monospace', fontSize:8.5, color:ED_MUTED, letterSpacing:.12, marginTop:2}}>
            SHOWS · CAREER
          </div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, alignItems:'end', height:44}}>
        {HIFI_RHYTHM.map((m,i)=>(
          <div key={i} style={{display:'flex', flexDirection:'column-reverse', gap:1.5, height:'100%'}}>
            {Array.from({length:m.a}).map((_,j)=>(
              <div key={'a'+j} style={{height:8, background:ED_INK}}/>
            ))}
            {Array.from({length:m.t}).map((_,j)=>(
              <div key={'t'+j} style={{height:8, border:`1px solid ${ED_INK}`, background:'transparent'}}/>
            ))}
          </div>
        ))}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3, marginTop:6}}>
        {months.map((m,i)=>(
          <div key={i} style={{
            textAlign:'center',
            fontFamily:'Fraunces, serif', fontStyle:'italic',
            fontSize: 10, color: i===3 ? ED_INK : ED_MUTED,
            fontWeight: i===3 ? 600 : 400,
          }}>{m[0]}</div>
        ))}
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0,
        marginTop:16, paddingTop:14, borderTop:`1px solid ${ED_RULE}`,
      }}>
        {[
          ['Spent', HIFI_TOTALS.spent],
          ['Venues', HIFI_TOTALS.venues],
          ['Artists', HIFI_TOTALS.artists],
        ].map(([l,v],i)=>(
          <div key={l} style={{
            textAlign:'center',
            borderLeft: i>0 ? `1px solid ${ED_RULE}` : 'none',
          }}>
            <div style={{fontFamily:'Fraunces, serif', fontWeight:700, fontSize:20, color:ED_INK, letterSpacing:-.3}}>{v}</div>
            <div style={{fontFamily:'"JetBrains Mono", monospace', fontSize:8.5, color:ED_MUTED, letterSpacing:.14, textTransform:'uppercase', marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeEditorial() {
  return (
    <div style={{
      height:'100%', background:ED_PAPER, color:ED_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
    }}>
      {/* Masthead */}
      <div style={{padding:'64px 20px 14px', borderBottom:`2px solid ${ED_INK}`, position:'relative'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.2em', color:ED_MUTED, textTransform:'uppercase',
          }}>VOL · III  ·  № 104</div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.2em', color:ED_MUTED, textTransform:'uppercase',
          }}>MON · APR 20 · 2026</div>
        </div>
        <div style={{
          fontFamily:'Fraunces, serif', fontWeight:900, fontSize:42,
          letterSpacing:-1.5, lineHeight:.9, color:ED_INK, marginTop:8,
          textAlign:'center',
        }}>
          The <span style={{fontStyle:'italic', fontWeight:700}}>Showbook</span>
        </div>
        <div style={{
          fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:12,
          color:ED_MUTED, textAlign:'center', marginTop:6,
          letterSpacing:.1,
        }}>A personal almanac of live performance · since 2024</div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {/* Lead */}
        <LeadStory show={HIFI_UPCOMING[0]}/>

        {/* Section head · also on calendar */}
        <div style={{padding:'16px 20px 6px'}}>
          <div style={{
            display:'flex', alignItems:'baseline', justifyContent:'space-between',
          }}>
            <div>
              <div style={{
                fontFamily:'"JetBrains Mono", monospace', fontSize:9,
                letterSpacing:'.2em', color:ED_MUTED, textTransform:'uppercase',
              }}>CALENDAR</div>
              <div style={{
                fontFamily:'Fraunces, serif', fontWeight:700, fontStyle:'italic',
                fontSize:20, color:ED_INK, marginTop:2, letterSpacing:-.3,
              }}>Also on the schedule</div>
            </div>
            <div style={{
              fontFamily:'"JetBrains Mono", monospace', fontSize:9,
              color:ED_MUTED, letterSpacing:.1,
            }}>VIEW ALL →</div>
          </div>
        </div>
        <div style={{padding:'0 20px'}}>
          {HIFI_UPCOMING.slice(1).map(s=>(
            <Brief key={s.id} show={s}/>
          ))}
        </div>

        {/* Almanac */}
        <div style={{marginTop:8}}><YearAlmanac/></div>

        {/* Section head · recently */}
        <div style={{padding:'18px 20px 6px'}}>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
            <div>
              <div style={{
                fontFamily:'"JetBrains Mono", monospace', fontSize:9,
                letterSpacing:'.2em', color:ED_MUTED, textTransform:'uppercase',
              }}>DISPATCHES</div>
              <div style={{
                fontFamily:'Fraunces, serif', fontWeight:700, fontStyle:'italic',
                fontSize:20, color:ED_INK, marginTop:2, letterSpacing:-.3,
              }}>Recently attended</div>
            </div>
            <div style={{fontFamily:'"JetBrains Mono", monospace', fontSize:9, color:ED_MUTED, letterSpacing:.1}}>
              87 TOTAL →
            </div>
          </div>
        </div>
        <div style={{padding:'0 20px'}}>
          {HIFI_PAST.map((s,i)=>(
            <PastEntry key={s.id} show={s} first={i===0}/>
          ))}
        </div>

        <div style={{
          padding:'22px 20px 12px', textAlign:'center',
          fontFamily:'Fraunces, serif', fontStyle:'italic',
          fontSize:11, color:ED_MUTED,
        }}>
          · end of edition ·
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1.5px solid ${ED_INK}`, background:ED_PAPER,
        padding:'10px 8px 28px',
      }}>
        {[
          ['Home', true],
          ['Past', false],
          ['+', false, true],
          ['Map', false],
          ['Me', false],
        ].map(([label, active, cta])=>(
          <div key={label} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3}}>
            <div style={{
              width: cta ? 30 : 8, height: cta ? 30 : 8,
              background: cta ? ED_INK : (active ? ED_INK : 'transparent'),
              border: !cta && !active ? `1.5px solid ${ED_MUTED}` : 'none',
              borderRadius:'50%',
              color: cta ? ED_PAPER : ED_INK,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'Fraunces, serif', fontSize:cta ? 18 : 0, fontWeight:700,
            }}>{cta ? '+' : ''}</div>
            <div style={{
              fontFamily:'Fraunces, serif', fontStyle: active || cta ? 'italic' : 'normal',
              fontSize:11, letterSpacing:.1,
              color: active ? ED_INK : ED_MUTED, fontWeight: active ? 600 : 400,
              marginTop: cta ? 0 : 2,
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.HomeEditorial = HomeEditorial;
