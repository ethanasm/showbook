// Direction 1 · Ticket-stub / playbill
// Warm paper, perforated edges, letterpress type.
// Each past show renders as a ticket stub; upcoming as "will call" envelopes.
// Per-kind ink + paper tones.

const { HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_RHYTHM, HIFI_TOTALS } = window;

// ─── Paper texture (subtle noise + fiber) ────────────────────────────────
const paperBg = (base='#F2E8D5') => ({
  background: `
    radial-gradient(circle at 20% 10%, rgba(120,80,40,.05) 0%, transparent 40%),
    radial-gradient(circle at 80% 85%, rgba(100,70,30,.06) 0%, transparent 40%),
    repeating-linear-gradient(115deg, transparent 0 3px, rgba(90,60,30,.012) 3px 4px),
    ${base}
  `,
});

// ─── Perforation (dashed between stub + body) ────────────────────────────
const Perf = ({ vertical=false, color='rgba(90,60,30,.35)' }) => (
  <div style={{
    [vertical ? 'width' : 'height']: 1,
    [vertical ? 'height' : 'width']: '100%',
    backgroundImage: vertical
      ? `linear-gradient(to bottom, ${color} 50%, transparent 50%)`
      : `linear-gradient(to right, ${color} 50%, transparent 50%)`,
    backgroundSize: vertical ? '1px 5px' : '5px 1px',
    flexShrink: 0,
  }} />
);

// ─── Ticket number barcode-ish glyph ─────────────────────────────────────
const Barcode = ({ color='#2A1F14', h=26 }) => {
  const bars = [2,1,3,1,2,1,1,3,2,1,1,2,3,1,2,1,1,2,3,1,1];
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:1,height:h}}>
      {bars.map((w,i)=>(
        <div key={i} style={{width:w,height:'100%',background:color}}/>
      ))}
    </div>
  );
};

// ─── Past ticket stub ────────────────────────────────────────────────────
function PastStub({ show }) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{
      position:'relative',
      margin:'0 16px 14px',
      borderRadius:3,
      ...paperBg(k.paper),
      boxShadow:'0 1px 0 rgba(90,60,30,.25), 0 1px 6px rgba(90,60,30,.12), 0 2px 14px rgba(90,60,30,.08)',
      overflow:'hidden',
      border:'1px solid rgba(90,60,30,.15)',
    }}>
      {/* Top notch scallops */}
      <div style={{
        position:'absolute', top:-4, left:0, right:0, height:8,
        backgroundImage:'radial-gradient(circle at 6px 0px, #f8f3e5 3px, transparent 3.5px)',
        backgroundSize:'12px 8px',
      }}/>
      <div style={{display:'flex',alignItems:'stretch',minHeight:120}}>
        {/* STUB (left, narrow) */}
        <div style={{
          width:76, padding:'14px 10px 12px',
          display:'flex', flexDirection:'column', alignItems:'center',
          borderRight:`1.5px dashed ${k.ink}55`,
          background:`linear-gradient(180deg, ${k.ink}08 0%, transparent 60%)`,
        }}>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:8,
            letterSpacing:'.18em', color:k.ink, marginBottom:4,
          }}>ADMIT ONE</div>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:600, fontSize:11,
            color:k.ink, letterSpacing:.2, marginBottom:6,
          }}>{show.date.dow}</div>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontSize:28,
            color:'#2A1F14', lineHeight:1, letterSpacing:-.5,
          }}>{show.date.d}</div>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:600, fontSize:11,
            color:'#2A1F14', letterSpacing:.2, marginTop:2,
          }}>{show.date.m}</div>
          <div style={{flex:1}}/>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:7,
            color:'rgba(42,31,20,.5)', letterSpacing:.1, marginTop:6,
          }}>№ {String(show.id).padStart(4,'0')}·{show.date.y}</div>
        </div>

        {/* BODY */}
        <div style={{flex:1, padding:'14px 16px 12px', display:'flex', flexDirection:'column', minWidth:0}}>
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6,
          }}>
            <div style={{
              display:'inline-flex', alignItems:'center', gap:6,
              fontFamily:'"JetBrains Mono", monospace', fontSize:8.5,
              letterSpacing:'.2em', color:k.ink, textTransform:'uppercase',
            }}>
              <span style={{
                width:6, height:6, borderRadius:'50%', background:k.ink,
                display:'inline-block',
              }}/>
              {k.label}
            </div>
            <div style={{
              fontFamily:'"JetBrains Mono", monospace', fontSize:9,
              color:'rgba(42,31,20,.55)', letterSpacing:.05,
            }}>${show.paid}</div>
          </div>

          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontSize:21,
            lineHeight:1.05, color:'#1B1209', letterSpacing:-.4,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>{show.headliner}</div>

          {show.support.length > 0 && (
            <div style={{
              fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:11.5,
              color:'rgba(42,31,20,.7)', marginTop:2, letterSpacing:.1,
            }}>with {show.support.join(' · ')}</div>
          )}

          <div style={{flex:1}}/>

          <div style={{
            display:'flex', alignItems:'flex-end', justifyContent:'space-between',
            gap:10, marginTop:10,
          }}>
            <div style={{minWidth:0, flex:1}}>
              <div style={{
                fontFamily:'Inter, sans-serif', fontSize:11.5, fontWeight:500,
                color:'#2A1F14', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>{show.venue}</div>
              <div style={{
                fontFamily:'Inter, sans-serif', fontSize:10,
                color:'rgba(42,31,20,.55)', marginTop:1,
              }}>{show.neighborhood} · {show.seat}</div>
            </div>
            <Barcode color={k.ink} h={22}/>
          </div>
        </div>
      </div>
      {/* Bottom scallops */}
      <div style={{
        position:'absolute', bottom:-4, left:0, right:0, height:8,
        backgroundImage:'radial-gradient(circle at 6px 8px, #f8f3e5 3px, transparent 3.5px)',
        backgroundSize:'12px 8px',
      }}/>
    </div>
  );
}

// ─── Upcoming "Will Call" card ───────────────────────────────────────────
function UpcomingCard({ show, big=false }) {
  const k = HIFI_KINDS[show.kind];
  return (
    <div style={{
      minWidth: big ? '100%' : 220,
      width: big ? '100%' : 220,
      padding:'14px 14px 12px',
      borderRadius:3,
      ...paperBg('#FBF5E6'),
      border:`1.5px solid ${k.ink}`,
      boxShadow:'0 2px 10px rgba(90,60,30,.08)',
      position:'relative', overflow:'hidden',
      flexShrink:0,
      marginBottom: big ? 12 : 0,
    }}>
      {/* diagonal "WILL CALL" watermark */}
      <div style={{
        position:'absolute', top:10, right:-28, transform:'rotate(28deg)',
        fontFamily:'"JetBrains Mono", monospace', fontSize:8,
        letterSpacing:'.3em', color:k.ink, opacity:.35,
        border:`1px solid ${k.ink}55`, padding:'2px 22px',
      }}>
        {show.hasTix ? 'WILL · CALL' : 'WATCHING'}
      </div>
      <div style={{
        fontFamily:'"JetBrains Mono", monospace', fontSize:8.5,
        letterSpacing:'.2em', color:k.ink, textTransform:'uppercase',
      }}>{show.countdown}</div>
      <div style={{
        fontFamily:'Fraunces, serif', fontWeight:700, fontSize: big ? 22 : 18,
        lineHeight:1.05, color:'#1B1209', letterSpacing:-.3,
        marginTop:6,
      }}>{show.headliner}</div>
      {show.support.length > 0 && (
        <div style={{
          fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:11,
          color:'rgba(42,31,20,.65)', marginTop:2, lineHeight:1.3,
        }}>
          {show.support.slice(0,2).join(' · ')}
          {show.support.length > 2 && ` + ${show.support.length - 2}`}
        </div>
      )}
      <div style={{
        display:'flex', alignItems:'flex-end', gap:10, marginTop:10, paddingTop:10,
        borderTop:`1px dashed ${k.ink}55`,
      }}>
        <div style={{flex:1, minWidth:0}}>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontSize:26,
            color:k.ink, lineHeight:1,
          }}>{show.date.d}</div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.18em', color:k.ink, marginTop:2,
          }}>{show.date.m} · {show.date.dow}</div>
        </div>
        <div style={{textAlign:'right', minWidth:0}}>
          <div style={{
            fontFamily:'Inter, sans-serif', fontSize:10.5, fontWeight:500,
            color:'#2A1F14', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
            maxWidth:140,
          }}>{show.venue}</div>
          <div style={{
            fontFamily:'Inter, sans-serif', fontSize:9.5,
            color:'rgba(42,31,20,.55)', marginTop:1,
          }}>{show.city}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Year rhythm as perforated strip ─────────────────────────────────────
function YearStrip() {
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  return (
    <div style={{
      margin:'0 16px 14px',
      padding:'12px 14px',
      borderRadius:3,
      ...paperBg('#EFE4CE'),
      border:'1px solid rgba(90,60,30,.18)',
    }}>
      <div style={{
        display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10,
      }}>
        <div style={{
          fontFamily:'"JetBrains Mono", monospace', fontSize:8.5,
          letterSpacing:'.22em', color:'rgba(42,31,20,.6)',
        }}>YEAR · 2026</div>
        <div style={{
          fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:11,
          color:'rgba(42,31,20,.65)',
        }}>■ attended  ▢ have tix</div>
      </div>
      <div style={{display:'flex', alignItems:'flex-end', gap:3, height:38}}>
        {HIFI_RHYTHM.map((m,i)=>{
          const total = m.a + m.t;
          return (
            <div key={i} style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end', gap:1, height:'100%'}}>
              {Array.from({length: m.t}).map((_,j)=>(
                <div key={'t'+j} style={{height:8, border:'1.25px solid #2A1F14', background:'transparent'}}/>
              ))}
              {Array.from({length: m.a}).map((_,j)=>(
                <div key={'a'+j} style={{height:8, background:'#2A1F14'}}/>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{display:'flex', gap:3, marginTop:6}}>
        {months.map((m,i)=>(
          <div key={i} style={{
            flex:1, textAlign:'center', fontFamily:'"JetBrains Mono", monospace',
            fontSize:8, color:'rgba(42,31,20,.5)', letterSpacing:.05,
          }}>{m}</div>
        ))}
      </div>
    </div>
  );
}

function HomeTicketStub() {
  return (
    <div style={{
      height:'100%', ...paperBg('#F8F1DE'),
      display:'flex', flexDirection:'column',
      fontFamily:'Inter, sans-serif', color:'#1B1209',
      overflow:'hidden',
    }}>
      {/* Header - playbill masthead */}
      <div style={{
        padding:'78px 20px 14px', position:'relative',
        borderBottom:'3px double rgba(90,60,30,.35)',
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.3em', color:'rgba(42,31,20,.55)',
          }}>EST · 2024 · NYC</div>
          <div style={{
            width:32, height:32, borderRadius:'50%',
            border:'1.5px solid rgba(42,31,20,.4)',
            background:'#E8DCC0',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:'Fraunces, serif', fontWeight:700, fontSize:14, color:'#2A1F14',
          }}>M</div>
        </div>
        <div style={{marginTop:10}}>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:900, fontSize:40,
            letterSpacing:-1.2, lineHeight:.95, color:'#1B1209',
            fontStyle:'italic',
          }}>the<br/>Showbook</div>
          <div style={{
            fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:12,
            color:'rgba(42,31,20,.65)', marginTop:6,
          }}>Mon · Apr 20 · 2026 — <b style={{fontStyle:'normal',fontWeight:600}}>{HIFI_TOTALS.shows}</b> shows this year</div>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1, overflow:'auto', paddingTop:14, paddingBottom:8}}>

        {/* Section · Up next */}
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          padding:'0 20px', marginBottom:10,
        }}>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontStyle:'italic',
            fontSize:22, letterSpacing:-.3,
          }}>Up next</div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.2em', color:'rgba(42,31,20,.55)',
          }}>3 W/ TIX · 1 WATCHING</div>
        </div>

        {/* Feature upcoming */}
        <div style={{padding:'0 16px', marginBottom:18}}>
          <UpcomingCard show={HIFI_UPCOMING[0]} big/>
          <div style={{
            display:'flex', gap:10, overflowX:'auto',
            paddingBottom:6, marginTop:2,
            scrollbarWidth:'none',
          }}>
            {HIFI_UPCOMING.slice(1).map(s=>(
              <UpcomingCard key={s.id} show={s}/>
            ))}
          </div>
        </div>

        {/* Divider · marquee rule */}
        <div style={{
          padding:'0 20px', display:'flex', alignItems:'center', gap:10,
          marginBottom:12,
        }}>
          <div style={{flex:1, height:1, background:'rgba(90,60,30,.35)'}}/>
          <div style={{
            fontFamily:'Fraunces, serif', fontStyle:'italic', fontSize:13,
            color:'rgba(42,31,20,.7)',
          }}>★</div>
          <div style={{flex:1, height:1, background:'rgba(90,60,30,.35)'}}/>
        </div>

        {/* Year rhythm */}
        <YearStrip/>

        {/* Section · Past */}
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          padding:'0 20px', marginBottom:10,
        }}>
          <div style={{
            fontFamily:'Fraunces, serif', fontWeight:700, fontStyle:'italic',
            fontSize:22, letterSpacing:-.3,
          }}>Recently</div>
          <div style={{
            fontFamily:'"JetBrains Mono", monospace', fontSize:9,
            letterSpacing:'.2em', color:'rgba(42,31,20,.55)',
          }}>87 TOTAL · ALL →</div>
        </div>

        {HIFI_PAST.slice(0,4).map(s=>(
          <PastStub key={s.id} show={s}/>
        ))}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        display:'flex', borderTop:'1.5px solid rgba(90,60,30,.3)',
        background:'#F2E8D0',
        padding:'10px 12px 28px',
      }}>
        {[
          ['home','●', true],
          ['stubs','▮', false],
          ['add','+', false, true],
          ['map','◉', false],
          ['me','○', false],
        ].map(([label, g, active, cta])=>(
          <div key={label} style={{
            flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', gap:2,
          }}>
            <div style={{
              width: cta ? 34 : 22, height: cta ? 34 : 22,
              background: cta ? '#2A1F14' : 'transparent',
              color: cta ? '#F8F1DE' : (active ? '#C4412A' : 'rgba(42,31,20,.55)'),
              borderRadius: cta ? '50%' : 0,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'Fraunces, serif', fontSize: cta ? 20 : 14, fontWeight:700,
            }}>{g}</div>
            <div style={{
              fontFamily:'"JetBrains Mono", monospace', fontSize:8,
              letterSpacing:'.12em', textTransform:'uppercase',
              color: active ? '#C4412A' : 'rgba(42,31,20,.5)',
            }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.HomeTicketStub = HomeTicketStub;
