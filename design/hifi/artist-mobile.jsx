// Mobile · Artist page — concert / comedy / theatre variants.
// Light theme (warm off-white) to match show-detail mobile.
const { SB, Icon } = window;

const AM_MODE = 'light';
const AM_BG    = SB.bg[AM_MODE];
const AM_SURF  = SB.surface[AM_MODE];
const AM_SURF2 = SB.surface2[AM_MODE];
const AM_INK   = SB.ink[AM_MODE];
const AM_MUTED = SB.muted[AM_MODE];
const AM_FAINT = SB.faint[AM_MODE];
const AM_RULE  = SB.rule[AM_MODE];
const AM_RULE2 = SB.ruleStrong[AM_MODE];

function amSrcBadge(accent, src) {
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

function AMKindChip({kind, accent}) {
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

function AMSection({title, icon, meta, badge, children, pad='26px 20px 0'}) {
  return (
    <div style={{padding:pad}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {icon}
          <div style={{fontFamily:SB.mono, fontSize:11, color:AM_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            {title}
          </div>
        </div>
        {badge || (meta && <div style={{fontFamily:SB.mono, fontSize:10, color:AM_FAINT, letterSpacing:'.04em'}}>{meta}</div>)}
      </div>
      {children}
    </div>
  );
}

function AMTopBar({kind}) {
  return (
    <div style={{
      position:'absolute', top:54, left:0, right:0, zIndex:30,
      background:AM_BG, padding:'10px 20px 10px',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      borderBottom:`1px solid ${AM_RULE}`,
    }}>
      <div style={{display:'flex', alignItems:'center', gap:6, color:AM_INK}}>
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M8 2 2 8l6 6" stroke={AM_INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{fontFamily:SB.mono, fontSize:11, color:AM_MUTED, letterSpacing:'.04em'}}>{kind === 'comedy' ? 'comedians' : kind === 'theatre' ? 'productions' : 'artists'}</span>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:16}}>
        <Icon.Search size={17} color={AM_INK}/>
        <Icon.More size={17} color={AM_INK}/>
      </div>
    </div>
  );
}

function AMHero({a, accent}) {
  return (
    <div style={{padding:'8px 20px 22px'}}>
      <AMKindChip kind={a.kind} accent={accent}/>
      <div style={{
        fontFamily:SB.sans, fontSize:34, fontWeight:600, color:AM_INK,
        letterSpacing:-1.2, lineHeight:1.0, marginTop:10,
      }}>{a.name}</div>
      <div style={{fontFamily:SB.sans, fontSize:15, color:AM_MUTED, marginTop:6, letterSpacing:-0.1}}>
        {a.tagline}
      </div>
      {a.bio && (
        <div style={{fontFamily:SB.sans, fontSize:13.5, color:AM_MUTED, marginTop:12, lineHeight:1.55, letterSpacing:-0.1}}>
          {a.bio}
        </div>
      )}
    </div>
  );
}

function AMStats({a, accent}) {
  // Horizontal scroll row of stat tiles — first three shown, hint of 4th
  return (
    <div style={{padding:'0 20px 4px'}}>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', border:`1px solid ${AM_RULE2}`, background:AM_SURF}}>
        {a.stats.slice(0,3).map(([l,v,sub],i)=>(
          <div key={l+i} style={{padding:'12px 12px', borderLeft: i===0 ? 'none' : `1px solid ${AM_RULE}`}}>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{l}</div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:AM_INK, letterSpacing:-0.7, marginTop:4, fontFeatureSettings:'"tnum"'}}>{v}</div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_MUTED, marginTop:3, letterSpacing:'.02em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AMShowRow({row, accent, i, showCtx}) {
  return (
    <div key={i} style={{
      background: row.cur ? `${accent}0F` : AM_SURF,
      padding:'12px 16px',
      borderTop: i===0 ? 'none' : `1px solid ${AM_RULE}`,
      borderLeft: row.cur ? `2px solid ${accent}` : '2px solid transparent',
    }}>
      <div style={{display:'grid', gridTemplateColumns:'auto 1fr auto', columnGap:12, alignItems:'baseline'}}>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color: row.cur ? accent : AM_MUTED, letterSpacing:'.06em'}}>{row.d}</div>
        <div style={{fontFamily:SB.sans, fontSize:14, fontWeight: row.cur ? 600 : 500, color:AM_INK, letterSpacing:-0.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{row.v}</div>
        {row.songs != null && <div style={{fontFamily:SB.mono, fontSize:10, color:AM_MUTED}}>{row.songs} songs</div>}
      </div>
      <div style={{fontFamily:SB.sans, fontSize:12.5, color:AM_MUTED, marginTop:3, letterSpacing:-0.1, fontStyle:'italic'}}>
        {row.tour}{row.city ? ` · ${row.city}` : ''}
      </div>
      {showCtx && row.ctx && (
        <div style={{fontFamily:SB.mono, fontSize:10, color:AM_FAINT, marginTop:4, letterSpacing:'.02em'}}>{row.ctx}</div>
      )}
    </div>
  );
}

function AMShows({a, accent, showCtx}) {
  return (
    <AMSection
      title={`Your shows · ${a.shows.length}`}
      icon={<Icon.Archive size={13} color={AM_INK}/>}
      meta="most recent first"
    >
      <div style={{border:`1px solid ${AM_RULE2}`}}>
        {a.shows.map((r,i)=><AMShowRow row={r} accent={accent} i={i} key={i} showCtx={showCtx}/>)}
      </div>
    </AMSection>
  );
}

function AMUpcoming({a, accent}) {
  if (!a.upcoming) return null;
  const u = a.upcoming;
  return (
    <AMSection
      title="Upcoming"
      icon={<Icon.Calendar size={13} color={AM_INK}/>}
      meta={a.upcomingExtra ? `${1 + a.upcomingExtra.length} dates` : '1 date'}
    >
      <div style={{background:AM_SURF, borderLeft:`2px solid ${accent}`, padding:'12px 14px', border:`1px solid ${AM_RULE}`, borderLeft:`2px solid ${accent}`}}>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:accent, letterSpacing:'.06em'}}>{u.d}</div>
        <div style={{fontFamily:SB.sans, fontSize:15, fontWeight:600, color:AM_INK, marginTop:3, letterSpacing:-0.2}}>{u.v}</div>
        <div style={{fontFamily:SB.sans, fontSize:12.5, color:AM_MUTED, marginTop:3, letterSpacing:-0.1}}>{u.city}</div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:AM_FAINT, marginTop:8, letterSpacing:'.04em'}}>○ {u.note}</div>
      </div>
      {a.upcomingExtra && (
        <div style={{marginTop:8, border:`1px solid ${AM_RULE}`}}>
          {a.upcomingExtra.map((e,i)=>(
            <div key={i} style={{
              padding:'9px 14px', background:AM_SURF,
              borderTop: i===0 ? 'none' : `1px solid ${AM_RULE}`,
              display:'grid', gridTemplateColumns:'auto 1fr', columnGap:12, alignItems:'baseline',
            }}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:AM_MUTED}}>{e.d}</div>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:13, color:AM_INK, fontWeight:500}}>{e.v}</div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_FAINT, marginTop:2}}>{e.note}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AMSection>
  );
}

function AMMap({a, accent}) {
  if (!a.cities) return null;
  // Minimal abstract map — a simple NE-US outline dot cluster; placeholder rect with dots
  return (
    <AMSection
      title="Where you've caught them"
      icon={<Icon.MapPin size={13} color={AM_INK}/>}
      meta={`${a.cities.length} cities`}
    >
      <div style={{
        height:160, position:'relative', background:AM_SURF,
        border:`1px solid ${AM_RULE2}`,
        backgroundImage:`radial-gradient(circle, ${AM_RULE2} 1px, transparent 1.2px)`,
        backgroundSize:'14px 14px',
      }}>
        {a.cities.map((c,i)=>(
          <div key={i} style={{
            position:'absolute', left:`${c.x}%`, top:`${c.y}%`,
            transform:'translate(-50%,-50%)',
          }}>
            <div style={{
              width:c.r*2, height:c.r*2, borderRadius:999,
              background:`${accent}55`, border:`1.5px solid ${accent}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:SB.mono, fontSize:10, color:AM_INK, fontWeight:600,
            }}>{c.label.split('·')[1].trim()}</div>
            <div style={{
              position:'absolute', left:c.r*2+6, top:'50%', transform:'translateY(-50%)',
              fontFamily:SB.mono, fontSize:9.5, color:AM_INK, letterSpacing:'.04em',
              whiteSpace:'nowrap',
            }}>{c.label.split('·')[0].trim()}</div>
          </div>
        ))}
      </div>
    </AMSection>
  );
}

function AMSongs({a, accent}) {
  if (!a.songs) return null;
  return (
    <AMSection
      title={`Songs heard live · ${a.songs.length}`}
      icon={<Icon.Music size={13} color={AM_INK}/>}
      badge={amSrcBadge(accent, 'setlist.fm')}
    >
      <div style={{background:AM_SURF, border:`1px solid ${AM_RULE}`, padding:'12px 6px'}}>
        <div style={{columnCount:2, columnGap:16}}>
          {a.songs.map(([t, newly], i)=>(
            <div key={i} style={{fontFamily:SB.mono, fontSize:11, padding:'3.5px 12px', display:'flex', gap:8, breakInside:'avoid', color:AM_INK}}>
              <span style={{flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t}</span>
              {newly && <span style={{color:accent, fontSize:9}}>◆</span>}
            </div>
          ))}
        </div>
      </div>
      <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_MUTED, marginTop:8, letterSpacing:'.04em'}}>{a.songsMeta}</div>
    </AMSection>
  );
}

function AMDiscography({a, accent, title='Discography', bigType=false}) {
  const list = a.discography || a.timeline || a.productionTimeline;
  if (!list) return null;
  return (
    <AMSection
      title={title}
      icon={<Icon.Archive size={13} color={AM_INK}/>}
      badge={amSrcBadge(accent, 'wikipedia')}
    >
      <div style={{position:'relative', paddingLeft:4}}>
        <div style={{position:'absolute', left:8, top:8, bottom:8, width:1, background:AM_RULE2}}/>
        {list.map((e,i)=>(
          <div key={i} style={{position:'relative', padding:'4px 0 14px 26px'}}>
            <div style={{
              position:'absolute', left:3, top:6,
              width:11, height:11, borderRadius:999,
              background: e.you ? accent : AM_BG,
              border: `1.5px solid ${e.you ? accent : AM_INK}`,
            }}/>
            <div style={{fontFamily:SB.mono, fontSize:10, color:AM_FAINT, letterSpacing:'.06em'}}>{e.y}</div>
            <div style={{fontFamily:SB.sans, fontSize:bigType?15:14, fontWeight: e.you ? 600 : 500, color:AM_INK, letterSpacing:-0.2, marginTop:2}}>
              {e.t}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color: e.you ? accent : AM_MUTED, marginTop:3, letterSpacing:'.04em'}}>
              {e.note ? e.note : e.you ? 'you were there' : '—'}
            </div>
          </div>
        ))}
      </div>
    </AMSection>
  );
}

function AMSpecials({a, accent}) {
  if (!a.specials) return null;
  return (
    <AMSection
      title={`Specials · ${a.specials.length}`}
      icon={<Icon.Eye size={13} color={AM_INK}/>}
      badge={amSrcBadge(accent, 'wikipedia')}
    >
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
        {a.specials.map((sp,i)=>(
          <div key={i} style={{
            padding:'10px 12px', background:AM_SURF,
            borderLeft:`2px solid ${sp.mine ? accent : AM_FAINT}`,
            border:`1px solid ${AM_RULE}`, borderLeft:`2px solid ${sp.mine ? accent : AM_FAINT}`,
          }}>
            <div style={{fontFamily:SB.sans, fontSize:12.5, color:AM_INK, fontWeight:600, letterSpacing:-0.2, fontStyle:'italic'}}>{sp.t}</div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_MUTED, marginTop:3}}>{sp.net} · {sp.yr}</div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color: sp.mine ? accent : AM_FAINT, marginTop:6, letterSpacing:'.04em', textTransform:'uppercase'}}>
              {sp.saw || '— not seen live'}
            </div>
          </div>
        ))}
      </div>
    </AMSection>
  );
}

function AMVisits({a, accent}) {
  if (!a.visits) return null;
  return (
    <AMSection
      title={`Your visits · ${a.visits.length}`}
      icon={<Icon.Ticket size={13} color={AM_INK}/>}
      badge={amSrcBadge(accent, 'playbill')}
    >
      {a.visits.map((v,i)=>(
        <div key={i} style={{
          marginTop: i===0 ? 0 : 10,
          background:AM_SURF, borderLeft:`2px solid ${v.cur ? accent : AM_FAINT}`,
          border:`1px solid ${AM_RULE}`, borderLeft:`2px solid ${v.cur ? accent : AM_FAINT}`,
          padding:'12px 14px',
        }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color: v.cur ? accent : AM_MUTED, letterSpacing:'.06em'}}>{v.d}</div>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_FAINT}}>{v.theatre} · {v.seat}</div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:10}}>
            {v.cast.map(([role, who])=>(
              <div key={role} style={{padding:'6px 8px', background:AM_BG, border:`1px solid ${AM_RULE}`}}>
                <div style={{fontFamily:SB.mono, fontSize:8.5, color:AM_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{role}</div>
                <div style={{fontFamily:SB.sans, fontSize:12, color:AM_INK, letterSpacing:-0.1, marginTop:2}}>{who}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </AMSection>
  );
}

function AMCredits({a, accent}) {
  if (!a.credits) return null;
  return (
    <AMSection
      title="Credits"
      icon={<Icon.User size={13} color={AM_INK}/>}
      badge={amSrcBadge(accent, 'playbill')}
    >
      <div style={{background:AM_SURF, border:`1px solid ${AM_RULE}`, padding:'4px 14px'}}>
        {a.credits.map(([k,v],i)=>(
          <div key={k} style={{
            display:'grid', gridTemplateColumns:'90px 1fr', padding:'8px 0',
            borderTop: i===0 ? 'none' : `1px solid ${AM_RULE}`,
          }}>
            <div style={{fontFamily:SB.mono, fontSize:9.5, color:AM_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{k}</div>
            <div style={{fontFamily:SB.sans, fontSize:13, color:AM_INK, letterSpacing:-0.1}}>{v}</div>
          </div>
        ))}
      </div>
    </AMSection>
  );
}

function AMRunning({a, accent}) {
  if (!a.running) return null;
  return (
    <AMSection
      title="Currently playing"
      icon={<Icon.MapPin size={13} color={AM_INK}/>}
    >
      <div style={{background:AM_SURF, borderLeft:`2px solid ${accent}`, padding:'12px 14px', border:`1px solid ${AM_RULE}`, borderLeft:`2px solid ${accent}`}}>
        <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:AM_INK, letterSpacing:-0.2}}>{a.running.theatre}</div>
        <div style={{fontFamily:SB.sans, fontSize:12.5, color:AM_MUTED, marginTop:4, letterSpacing:-0.1}}>{a.running.schedule}</div>
        <div style={{display:'flex', gap:6, marginTop:10, flexWrap:'wrap'}}>
          {a.running.actions.map(x=>(
            <span key={x} style={{fontFamily:SB.mono, fontSize:10, color:AM_INK, padding:'4px 8px', border:`1px solid ${AM_RULE2}`, letterSpacing:'.04em'}}>{x}</span>
          ))}
        </div>
      </div>
    </AMSection>
  );
}

function AMRelated({a, accent}) {
  if (!a.related) return null;
  return (
    <AMSection
      title="Related · you've seen"
      icon={<Icon.ArrowUpRight size={13} color={AM_INK}/>}
      pad="26px 20px 30px"
    >
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {a.related.map(x=>(
          <span key={x} style={{
            fontFamily:SB.sans, fontSize:12.5, color:AM_INK,
            padding:'6px 10px', background:AM_SURF, border:`1px solid ${AM_RULE2}`,
            letterSpacing:-0.1,
          }}>{x}</span>
        ))}
      </div>
    </AMSection>
  );
}

function ArtistMobile({payload}) {
  const a = payload;
  const accent = SB.kinds[a.kindKey].ink;
  return (
    <div style={{
      height:'100%', background:AM_BG, color:AM_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, position:'relative', WebkitFontSmoothing:'antialiased',
    }}>
      <AMTopBar kind={a.kindKey}/>
      <div style={{flex:1, overflow:'auto', paddingTop:98}}>
        <AMHero a={a} accent={accent}/>
        <AMStats a={a} accent={accent}/>

        {a.kindKey === 'concert' && (
          <>
            <AMShows a={a} accent={accent}/>
            <AMUpcoming a={a} accent={accent}/>
            <AMMap a={a} accent={accent}/>
            <AMSongs a={a} accent={accent}/>
            <AMDiscography a={a} accent={accent} title="Discography"/>
          </>
        )}

        {a.kindKey === 'comedy' && (
          <>
            <AMShows a={a} accent={accent} showCtx/>
            <AMSpecials a={a} accent={accent}/>
            <AMUpcoming a={a} accent={accent}/>
            <AMDiscography a={a} accent={accent} title="Career · tour timeline"/>
          </>
        )}

        {a.kindKey === 'theatre' && (
          <>
            <AMVisits a={a} accent={accent}/>
            <AMCredits a={a} accent={accent}/>
            <AMRunning a={a} accent={accent}/>
            <AMSongs a={a} accent={accent}/>
            <AMDiscography a={a} accent={accent} title="Production timeline"/>
          </>
        )}

        <AMRelated a={a} accent={accent}/>
        <div style={{padding:'20px 20px 30px', textAlign:'center', fontFamily:SB.mono, fontSize:10, color:AM_FAINT, letterSpacing:'.14em'}}>— END —</div>
      </div>
    </div>
  );
}

window.ArtistMobile = ArtistMobile;
