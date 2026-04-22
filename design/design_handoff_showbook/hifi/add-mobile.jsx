// Mobile · Add a Show — iOS
// A single scrollable sheet. Kind pill row → lineup autocomplete (artist search
// matched) → venue+date auto-filled from artist/ticket → photos → save.
// Style matches HomeMonoRefined (light mode, Geist + Geist Mono).

const { SB, Icon, HIFI_KINDS } = window;

const A_MODE = 'light';
const A_BG   = SB.bg[A_MODE];
const A_SURF = SB.surface[A_MODE];
const A_SURF2= SB.surface2[A_MODE];
const A_INK  = SB.ink[A_MODE];
const A_MUTED= SB.muted[A_MODE];
const A_FAINT= SB.faint[A_MODE];
const A_RULE = SB.rule[A_MODE];
const A_RULE2= SB.ruleStrong[A_MODE];
const aKind = (k) => SB.kinds[k].ink;

function Section({label, hint, children, last}) {
  return (
    <div style={{
      padding:'18px 20px',
      borderBottom: last ? 'none' : `1px solid ${A_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
        <div style={{
          fontFamily:SB.mono, fontSize:10, color:A_MUTED,
          letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500,
        }}>{label}</div>
        {hint && (
          <div style={{fontFamily:SB.mono, fontSize:10, color:A_FAINT, letterSpacing:'.02em'}}>
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function KindPill({kind, active, onClick}) {
  const c = aKind(kind);
  return (
    <div style={{
      padding:'9px 0', flex:1, textAlign:'center',
      background: active ? A_INK : 'transparent',
      color: active ? A_BG : A_INK,
      fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em',
      textTransform:'uppercase', fontWeight:500,
      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
      cursor:'pointer',
    }}>
      <span style={{
        width:6, height:6, borderRadius:999,
        background: active ? c : c,
        opacity: active ? 1 : .7,
      }}/>
      {HIFI_KINDS[kind].label}
    </div>
  );
}

function ArtistRow({name, role, matched, headliner}) {
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'14px 1fr auto 14px',
      alignItems:'center', columnGap:12,
      padding:'12px 14px',
      background: headliner ? A_SURF2 : A_SURF,
      border:`1px solid ${A_RULE2}`,
      marginBottom:6,
    }}>
      <div style={{
        color:A_FAINT, fontFamily:SB.mono, fontSize:11, letterSpacing:'-.05em',
      }}>⋮⋮</div>
      <div style={{minWidth:0}}>
        <div style={{
          fontFamily:SB.sans, fontSize:15, fontWeight: headliner ? 600 : 500,
          color:A_INK, letterSpacing:-0.2, lineHeight:1.1,
        }}>{name}</div>
        <div style={{
          fontFamily:SB.mono, fontSize:10, color:A_MUTED, marginTop:3,
          letterSpacing:'.04em',
          display:'flex', alignItems:'center', gap:6,
        }}>
          {role}
          {matched && (
            <>
              <span style={{color:A_FAINT}}>·</span>
              <span style={{display:'inline-flex', alignItems:'center', gap:3, color:aKind('festival')}}>
                <Icon.Check size={10} color={aKind('festival')}/> matched
              </span>
            </>
          )}
        </div>
      </div>
      <div/>
      <div style={{color:A_FAINT}}>
        <Icon.ChevronDown size={14} color={A_FAINT}/>
      </div>
    </div>
  );
}

function AutoField({label, value, source, mono=true, highlight=false}) {
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'72px 1fr 16px', columnGap:12,
      padding:'12px 0', borderBottom:`1px solid ${A_RULE}`, alignItems:'center',
    }}>
      <div style={{
        fontFamily:SB.mono, fontSize:10, color:A_MUTED,
        letterSpacing:'.06em', textTransform:'uppercase',
      }}>{label}</div>
      <div style={{minWidth:0}}>
        <div style={{
          fontFamily: mono ? SB.mono : SB.sans,
          fontSize: mono ? 13 : 14, fontWeight: mono ? 500 : 500,
          color: highlight ? aKind('concert') : A_INK, letterSpacing:-0.1,
          lineHeight:1.25, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{value}</div>
        {source && (
          <div style={{
            fontFamily:SB.mono, fontSize:9.5, color:A_FAINT, marginTop:3,
            letterSpacing:'.04em',
          }}>{source}</div>
        )}
      </div>
      <Icon.ChevronRight size={12} color={A_FAINT}/>
    </div>
  );
}

function PhotoTile({i, stripe}) {
  return (
    <div style={{
      aspectRatio:'1 / 1', position:'relative', overflow:'hidden',
      background: stripe
        ? `repeating-linear-gradient(135deg, ${A_SURF2} 0 6px, ${A_SURF} 6px 12px)`
        : A_SURF,
      border:`1px solid ${A_RULE2}`,
      display:'flex', alignItems:'flex-end', justifyContent:'space-between',
      padding:6,
    }}>
      <div style={{
        fontFamily:SB.mono, fontSize:9, color:A_FAINT,
        letterSpacing:'.06em',
      }}>IMG_{String(i).padStart(2,'0')}</div>
      {i===1 && (
        <div style={{
          position:'absolute', top:6, right:6,
          width:16, height:16, background:A_INK, color:A_BG,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:9, fontWeight:600,
        }}>★</div>
      )}
    </div>
  );
}

function AddMobile() {
  return (
    <div style={{
      height:'100%', background:A_BG, color:A_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Top nav — sheet */}
      <div style={{
        padding:'62px 20px 14px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        borderBottom:`1px solid ${A_RULE}`,
      }}>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:A_MUTED,
          letterSpacing:'.06em', textTransform:'uppercase',
          display:'flex', alignItems:'center', gap:6, cursor:'pointer',
        }}>
          <span style={{fontSize:14, lineHeight:1}}>×</span> cancel
        </div>
        <div style={{
          fontFamily:SB.sans, fontSize:16, fontWeight:600, color:A_INK, letterSpacing:-0.3,
        }}>Add a show</div>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:A_INK,
          letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          display:'flex', alignItems:'center', gap:4, cursor:'pointer',
        }}>
          save <Icon.ArrowRight size={11} color={A_INK}/>
        </div>
      </div>

      {/* Mode strip */}
      <div style={{
        display:'flex', padding:'10px 20px',
        gap:6, borderBottom:`1px solid ${A_RULE}`,
      }}>
        <div style={{
          padding:'6px 10px', background:A_INK, color:A_BG,
          fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em', fontWeight:500,
          display:'inline-flex', alignItems:'center', gap:5,
        }}><Icon.Check size={11} color={A_BG}/> past</div>
        <div style={{
          padding:'6px 10px', border:`1px solid ${A_RULE2}`,
          fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em',
          color:A_MUTED,
        }}>upcoming</div>
        <div style={{
          padding:'6px 10px', border:`1px solid ${A_RULE2}`,
          fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em',
          color:A_MUTED,
        }}>watching</div>
        <div style={{flex:1}}/>
        <div style={{
          padding:'6px 10px', border:`1px solid ${A_RULE2}`,
          fontFamily:SB.mono, fontSize:10.5, letterSpacing:'.06em',
          color:A_INK, display:'inline-flex', alignItems:'center', gap:5,
        }}>
          <Icon.ArrowUpRight size={11} color={A_INK}/> chat
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1, overflow:'auto'}}>

        {/* Kind */}
        <Section label="Kind">
          <div style={{
            display:'flex', border:`1px solid ${A_RULE2}`, overflow:'hidden',
          }}>
            {['concert','theatre','comedy','festival'].map((k,i)=>(
              <div key={k} style={{
                flex:1, borderLeft: i===0 ? 'none' : `1px solid ${A_RULE2}`,
              }}>
                <KindPill kind={k} active={k==='concert'}/>
              </div>
            ))}
          </div>
        </Section>

        {/* Lineup */}
        <Section label="Lineup" hint="first = headliner">
          <ArtistRow name="Fontaines D.C." role="headliner" matched headliner/>
          <ArtistRow name="Been Stellar" role="support" matched/>
          {/* search input */}
          <div style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'12px 14px', border:`1px dashed ${A_RULE2}`,
            background:A_BG,
          }}>
            <Icon.Search size={14} color={A_MUTED}/>
            <div style={{
              fontFamily:SB.sans, fontSize:14, color:A_MUTED, letterSpacing:-0.1,
              flex:1,
            }}>add another artist…</div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, color:A_FAINT,
              letterSpacing:'.06em', padding:'2px 6px', border:`1px solid ${A_RULE2}`,
            }}>SETLIST.FM</div>
          </div>
          {/* dropdown hint */}
          <div style={{
            marginTop:6, padding:'10px 14px',
            border:`1px solid ${A_RULE2}`, background:A_SURF,
            display:'flex', alignItems:'center', gap:10,
          }}>
            <span style={{
              width:26, height:26, background:A_SURF2,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:SB.mono, fontSize:11, color:A_MUTED, fontWeight:600,
            }}>BS</span>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:13.5, fontWeight:500, color:A_INK, letterSpacing:-0.1}}>
                Been Stellar
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:A_MUTED, marginTop:2, letterSpacing:'.02em'}}>
                indie rock · NYC · 0 prior
              </div>
            </div>
            <Icon.Plus size={14} color={A_INK}/>
          </div>
        </Section>

        {/* Auto-fetched details */}
        <Section label="Details" hint="auto · from ticket + setlist.fm">
          <AutoField label="Venue" value="Kings Theatre" source="Flatbush · Brooklyn, NY" mono={false}/>
          <AutoField label="Date" value="Sat · Apr 04 · 2026" source="setlist.fm · matched show #a7f3" highlight/>
          <AutoField label="Tour" value="Romance World Tour" source="setlist.fm"/>
          <AutoField label="Setlist" value="21 songs · encore"  source="tap to view"/>
          <AutoField label="Seat" value="ORCH L · 14" source="ticket pdf"/>
          <AutoField label="Paid" value="$78.00" source="ticketmaster.com"/>
        </Section>

        {/* Photos */}
        <Section label="Photos" hint="3 attached">
          <div style={{
            display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6,
          }}>
            <PhotoTile i={1}/>
            <PhotoTile i={2}/>
            <PhotoTile i={3}/>
            <div style={{
              aspectRatio:'1 / 1',
              border:`1px dashed ${A_RULE2}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              flexDirection:'column', gap:4,
              color:A_MUTED,
            }}>
              <Icon.Plus size={18} color={A_MUTED}/>
              <div style={{
                fontFamily:SB.mono, fontSize:9, letterSpacing:'.08em',
                textTransform:'uppercase',
              }}>attach</div>
            </div>
          </div>
        </Section>

        {/* Source strip */}
        <Section label="Also available" last>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            {[
              ['paste a ticketmaster URL', 'url'],
              ['upload PDF ticket', 'pdf'],
              ['scan gmail for receipts', 'mail'],
            ].map(([label, tag])=>(
              <div key={tag} style={{
                padding:'11px 14px',
                border:`1px solid ${A_RULE2}`, background:A_SURF,
                display:'flex', alignItems:'center', gap:10,
              }}>
                <div style={{
                  fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.1em',
                  color:A_MUTED, padding:'2px 5px', border:`1px solid ${A_RULE2}`,
                  textTransform:'uppercase',
                }}>{tag}</div>
                <div style={{fontFamily:SB.sans, fontSize:13, color:A_INK, flex:1, letterSpacing:-0.1}}>
                  {label}
                </div>
                <Icon.ChevronRight size={12} color={A_FAINT}/>
              </div>
            ))}
          </div>
        </Section>

        {/* Bottom commit button */}
        <div style={{padding:'18px 20px 24px'}}>
          <div style={{
            padding:'14px 16px', background:A_INK, color:A_BG,
            display:'flex', alignItems:'center', justifyContent:'center', gap:10,
            fontFamily:SB.sans, fontSize:14, fontWeight:600, letterSpacing:-0.2,
            cursor:'pointer',
          }}>
            <Icon.Check size={16} color={A_BG}/> Save to history
          </div>
          <div style={{
            marginTop:10, textAlign:'center',
            fontFamily:SB.mono, fontSize:10, color:A_FAINT,
            letterSpacing:'.04em',
          }}>
            we never ask for cast, setlist, or tour — it's fetched
          </div>
        </div>
      </div>
    </div>
  );
}

window.AddMobile = AddMobile;
