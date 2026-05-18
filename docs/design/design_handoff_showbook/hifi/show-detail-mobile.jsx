// Mobile · Show detail — generic renderer; payload passed in.
// Used for concert / comedy / theatre variants.
const { SB, Icon } = window;

const SD_MODE = 'light';
const SD_BG    = SB.bg[SD_MODE];
const SD_SURF  = SB.surface[SD_MODE];
const SD_SURF2 = SB.surface2[SD_MODE];
const SD_INK   = SB.ink[SD_MODE];
const SD_MUTED = SB.muted[SD_MODE];
const SD_FAINT = SB.faint[SD_MODE];
const SD_RULE  = SB.rule[SD_MODE];
const SD_RULE2 = SB.ruleStrong[SD_MODE];

function srcBadge(accent, src) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontFamily:SB.mono, fontSize:9.5, color:accent,
      letterSpacing:'.06em', textTransform:'uppercase',
      padding:'2px 6px', border:`1px solid ${accent}40`,
    }}>
      <span style={{width:4, height:4, borderRadius:999, background:accent}}/>
      auto · {src}
    </span>
  );
}

function SDKindChip({kind, accent}) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontFamily:SB.mono, fontSize:10.5, fontWeight:500,
      letterSpacing:'.06em', color:accent, textTransform:'uppercase',
    }}>
      <span style={{width:5, height:5, borderRadius:999, background:accent}}/>
      {kind}
    </span>
  );
}

function MHero({s, accent}) {
  return (
    <div style={{padding:'8px 20px 22px'}}>
      <SDKindChip kind={s.kind} accent={accent}/>
      <div style={{
        fontFamily:SB.sans, fontSize:30, fontWeight:600, color:SD_INK,
        letterSpacing:-1.0, lineHeight:1.02, marginTop:10,
      }}>{s.headliner}</div>
      {s.subtitle && (
        <div style={{
          fontFamily:SB.sans, fontSize:15, color:SD_MUTED, marginTop:6,
          letterSpacing:-0.1, fontStyle: s.subtitleItalic ? 'italic' : 'normal',
        }}>{s.subtitle}</div>
      )}
      {s.support && (
        <div style={{fontFamily:SB.sans, fontSize:14, color:SD_MUTED, marginTop:6, letterSpacing:-0.1}}>
          {s.supportPrefix || 'with'} {s.support}
        </div>
      )}

      <div style={{
        display:'grid', gridTemplateColumns:'auto 1fr', columnGap:18,
        alignItems:'end', marginTop:22,
        paddingTop:18, borderTop:`1px solid ${SD_RULE2}`,
      }}>
        <div>
          <div style={{
            fontFamily:SB.sans, fontSize:64, fontWeight:500, color:SD_INK,
            letterSpacing:-2.8, lineHeight:.85, fontFeatureSettings:'"tnum"',
          }}>{s.date.d}</div>
          <div style={{
            fontFamily:SB.mono, fontSize:10.5, color:accent,
            letterSpacing:'.1em', marginTop:6, fontWeight:500,
          }}>{s.date.m} · {s.date.y}</div>
        </div>
        <div style={{textAlign:'right', paddingBottom:4}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:SD_MUTED, letterSpacing:'.06em', textTransform:'uppercase', lineHeight:1.5}}>
            {s.date.dow}
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:SD_FAINT, marginTop:3, letterSpacing:'.02em'}}>
            {s.time}
          </div>
        </div>
      </div>
    </div>
  );
}

function MFacts({s, accent}) {
  return (
    <div style={{margin:'0 20px', background:SD_SURF, borderLeft:`2px solid ${accent}`}}>
      {s.facts.map(([k,v,ic,meta],i)=>(
        <div key={k+i} style={{
          display:'grid', gridTemplateColumns:'62px 1fr auto', columnGap:12,
          padding:'11px 14px',
          borderTop: i===0 ? 'none' : `1px solid ${SD_RULE}`,
          alignItems:'center',
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:SD_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{k}</div>
          <div style={{fontFamily:SB.sans, fontSize:13.5, color:SD_INK, letterSpacing:-0.1, display:'flex', alignItems:'center', gap:7, minWidth:0}}>
            {ic}
            <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{v}</span>
          </div>
          {meta && <div style={{fontFamily:SB.mono, fontSize:10, color:SD_FAINT, letterSpacing:'.02em'}}>{meta}</div>}
        </div>
      ))}
    </div>
  );
}

function MSection({title, icon, meta, badge, children}) {
  return (
    <div style={{padding:'26px 20px 0'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {icon}
          <div style={{fontFamily:SB.mono, fontSize:11, color:SD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            {title}
          </div>
        </div>
        {badge || (meta && <div style={{fontFamily:SB.mono, fontSize:10, color:SD_FAINT, letterSpacing:'.04em'}}>{meta}</div>)}
      </div>
      {children}
    </div>
  );
}

function MLineup({s, accent}) {
  if (!s.lineup) return null;
  return (
    <MSection title={s.lineupTitle || `Lineup · ${s.lineup.length}`} icon={<Icon.Music size={13} color={SD_INK}/>} meta={s.lineupMeta}>
      {s.lineup.map((a,i)=>(
        <div key={i} style={{
          background:SD_SURF, padding:'13px 16px',
          borderBottom:`1px solid ${SD_RULE}`,
          borderTop: i===0 ? `1px solid ${SD_RULE}` : 'none',
          display:'grid', gridTemplateColumns:'1fr auto', gap:10, alignItems:'center',
        }}>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:SD_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>
              {a.role}
            </div>
            <div style={{fontFamily:SB.sans, fontSize:16, fontWeight:600, color:SD_INK, letterSpacing:-0.3, marginTop:2, fontStyle: a.italic ? 'italic' : 'normal'}}>
              {a.name}
            </div>
            {a.detail && (
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:SD_MUTED, marginTop:4, letterSpacing:'.02em'}}>
                {a.detail}
              </div>
            )}
          </div>
          {a.seen && (
            <div style={{
              textAlign:'right', paddingLeft:14,
              borderLeft:`1px solid ${SD_RULE}`, alignSelf:'stretch',
              display:'flex', flexDirection:'column', justifyContent:'center',
            }}>
              <div style={{fontFamily:SB.sans, fontSize:18, fontWeight:500, color:SD_INK, letterSpacing:-0.5, lineHeight:1}}>
                {a.seen}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:9, color:SD_FAINT, marginTop:4, letterSpacing:'.08em', textTransform:'uppercase'}}>
                {a.seenLabel || 'seen live'}
              </div>
            </div>
          )}
        </div>
      ))}
    </MSection>
  );
}

function MSetlist({s, accent}) {
  if (!s.setlist) return null;
  return (
    <MSection
      title={`Setlist · ${s.setlist.length}`}
      icon={<Icon.Music size={13} color={SD_INK}/>}
      badge={srcBadge(accent, 'setlist.fm')}
    >
      <div style={{background:SD_SURF, padding:'12px 4px', borderTop:`1px solid ${SD_RULE}`, borderBottom:`1px solid ${SD_RULE}`}}>
        <div style={{columnCount:2, columnGap:16}}>
          {s.setlist.map(([t,newly],i)=>(
            <div key={i} style={{fontFamily:SB.mono, fontSize:11, padding:'4px 12px', display:'flex', gap:8, breakInside:'avoid', color:SD_INK}}>
              <span style={{width:18, color:SD_FAINT, fontSize:9.5}}>{String(i+1).padStart(2,'0')}</span>
              <span style={{flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t}</span>
              {newly && <span style={{color:accent, fontSize:9}}>◆</span>}
            </div>
          ))}
        </div>
      </div>
      {s.setlistNote && (
        <div style={{fontFamily:SB.mono, fontSize:10, color:SD_MUTED, marginTop:10, letterSpacing:'.02em', display:'flex', alignItems:'center', gap:6}}>
          <span style={{color:accent}}>◆</span>{s.setlistNote}
        </div>
      )}
    </MSection>
  );
}

function MCast({s, accent}) {
  if (!s.cast) return null;
  return (
    <MSection
      title={s.castTitle || 'Cast on the night'}
      icon={<Icon.User size={13} color={SD_INK}/>}
      badge={srcBadge(accent, 'playbill')}
    >
      <div style={{background:SD_SURF, border:`1px solid ${SD_RULE}`}}>
        {s.cast.map(([role, who, replace], i)=>(
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'86px 1fr auto', columnGap:10,
            padding:'10px 14px',
            borderTop: i===0 ? 'none' : `1px solid ${SD_RULE}`,
            alignItems:'center',
          }}>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:SD_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>
              {role}
            </div>
            <div style={{fontFamily:SB.sans, fontSize:13.5, color:SD_INK, letterSpacing:-0.1}}>
              {who}
            </div>
            {replace && (
              <div style={{fontFamily:SB.mono, fontSize:9, color:accent, letterSpacing:'.06em', textTransform:'uppercase'}}>
                u/s
              </div>
            )}
          </div>
        ))}
      </div>
      {s.castNote && (
        <div style={{fontFamily:SB.mono, fontSize:10, color:SD_MUTED, marginTop:10, letterSpacing:'.02em'}}>
          {s.castNote}
        </div>
      )}
    </MSection>
  );
}

function MMaterial({s, accent}) {
  if (!s.materialContext) return null;
  return (
    <MSection
      title="Material context"
      icon={<Icon.Music size={13} color={SD_INK}/>}
      badge={srcBadge(accent, 'wikipedia')}
    >
      <div style={{background:SD_SURF, padding:'14px 16px', borderLeft:`2px solid ${accent}`}}>
        <div style={{fontFamily:SB.sans, fontSize:13.5, color:SD_INK, lineHeight:1.55, letterSpacing:-0.1}}>
          {s.materialContext}
        </div>
        {s.materialMeta && (
          <div style={{fontFamily:SB.mono, fontSize:10, color:SD_MUTED, marginTop:10, letterSpacing:'.04em', textTransform:'uppercase'}}>
            {s.materialMeta}
          </div>
        )}
      </div>
    </MSection>
  );
}

function MWithArtist({s, accent}) {
  if (!s.withArtist) return null;
  return (
    <MSection
      title={s.withArtistTitle}
      icon={<Icon.Archive size={13} color={SD_INK}/>}
      badge={<div style={{fontFamily:SB.mono, fontSize:10.5, color:accent, fontWeight:500, letterSpacing:'.04em'}}>{s.seenOrdinal?.toLowerCase()}</div>}
    >
      <div style={{position:'relative', paddingLeft:4}}>
        <div style={{position:'absolute', left:8, top:8, bottom:8, width:1, background:SD_RULE2}}/>
        {s.withArtist.map((t,i)=>(
          <div key={i} style={{position:'relative', padding:'4px 0 14px 26px'}}>
            <div style={{
              position:'absolute', left:3, top:6,
              width:11, height:11, borderRadius:999,
              background: t.cur ? accent : SD_BG,
              border: `1.5px solid ${t.cur ? accent : SD_INK}`,
            }}/>
            <div style={{fontFamily:SB.sans, fontSize:14, fontWeight: t.cur ? 600 : 500, color:SD_INK, letterSpacing:-0.2}}>
              {t.v}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:SD_MUTED, marginTop:3, letterSpacing:'.04em'}}>
              {t.d}{t.sub ? ` · ${t.sub}` : ''}
            </div>
          </div>
        ))}
      </div>
    </MSection>
  );
}

function MAtVenue({s, accent}) {
  if (!s.atVenue) return null;
  return (
    <MSection
      title={s.atVenueTitle}
      icon={<Icon.MapPin size={13} color={SD_INK}/>}
      meta={s.atVenueMeta}
    >
      <div style={{background:SD_SURF, border:`1px solid ${SD_RULE}`}}>
        {s.atVenue.map(([d,a,cur],i)=>(
          <div key={i} style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'10px 14px',
            borderTop: i===0 ? 'none' : `1px solid ${SD_RULE}`,
            background: cur ? `${accent}0F` : 'transparent',
          }}>
            <div style={{fontFamily:SB.sans, fontSize:13.5, fontWeight: cur ? 600 : 400, color:SD_INK, letterSpacing:-0.1}}>{a}</div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:SD_MUTED, letterSpacing:'.04em'}}>{d}</div>
          </div>
        ))}
        <div style={{
          padding:'10px 14px', borderTop:`1px solid ${SD_RULE2}`,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          fontFamily:SB.mono, fontSize:10, color:SD_MUTED, letterSpacing:'.06em', textTransform:'uppercase',
        }}>
          <span>{s.atVenueMore || '+ more'}</span>
          <Icon.ChevronRight size={12} color={SD_MUTED}/>
        </div>
      </div>
    </MSection>
  );
}

function MPhotos() {
  return (
    <MSection title="Your photos · 3" meta={null}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4}}>
        {[0,1,2].map(i=>(
          <div key={i} style={{
            aspectRatio:'1', background:SD_SURF2,
            backgroundImage:`repeating-linear-gradient(45deg, ${SD_RULE} 0 2px, transparent 2px 10px)`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:SB.mono, fontSize:9, color:SD_FAINT, letterSpacing:'.06em',
          }}>PHOTO {i+1}</div>
        ))}
      </div>
    </MSection>
  );
}

function MTopBar() {
  return (
    <div style={{
      position:'absolute', top:54, left:0, right:0, zIndex:30,
      background:SD_BG, padding:'10px 20px 10px',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      borderBottom:`1px solid ${SD_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'center', gap:6, color:SD_INK}}>
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M8 2 2 8l6 6" stroke={SD_INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{fontFamily:SB.mono, fontSize:11, color:SD_MUTED, letterSpacing:'.04em'}}>history</span>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:16}}>
        <Icon.Ticket size={17} color={SD_INK}/>
        <Icon.More size={17} color={SD_INK}/>
      </div>
    </div>
  );
}

function ShowDetailMobile({payload}) {
  const s = payload;
  const accent = SB.kinds[s.kindKey].ink;
  return (
    <div style={{
      height:'100%', background:SD_BG, color:SD_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, position:'relative', WebkitFontSmoothing:'antialiased',
    }}>
      <MTopBar/>
      <div style={{flex:1, overflow:'auto', paddingTop:98}}>
        <MHero s={s} accent={accent}/>
        <MFacts s={s} accent={accent}/>
        {s.kindKey === 'concert'  && <MLineup s={s} accent={accent}/>}
        {s.kindKey === 'concert'  && <MSetlist s={s} accent={accent}/>}
        {s.kindKey === 'comedy'   && <MLineup s={s} accent={accent}/>}
        {s.kindKey === 'comedy'   && <MMaterial s={s} accent={accent}/>}
        {s.kindKey === 'theatre' && <MCast s={s} accent={accent}/>}
        <MWithArtist s={s} accent={accent}/>
        <MAtVenue s={s} accent={accent}/>
        <MPhotos/>
        <div style={{padding:'30px 20px 14px', textAlign:'center', fontFamily:SB.mono, fontSize:10, color:SD_FAINT, letterSpacing:'.14em'}}>— END —</div>
      </div>
    </div>
  );
}

window.ShowDetailMobile = ShowDetailMobile;
