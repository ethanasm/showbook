// Web · Artist page — concert / comedy / theatre variants.
// Dark theme to match show-detail web.
const { SB, Icon } = window;

const AW_MODE = 'dark';
const AW_BG    = SB.bg[AW_MODE];
const AW_SURF  = SB.surface[AW_MODE];
const AW_SURF2 = SB.surface2[AW_MODE];
const AW_INK   = SB.ink[AW_MODE];
const AW_MUTED = SB.muted[AW_MODE];
const AW_FAINT = SB.faint[AW_MODE];
const AW_RULE  = SB.rule[AW_MODE];
const AW_RULE2 = SB.ruleStrong[AW_MODE];

function awSrcBadge(accent, src) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      fontFamily:SB.mono, fontSize:10, color:accent,
      letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
      padding:'3px 8px', border:`1px solid ${accent}40`,
    }}>
      <span style={{width:4, height:4, borderRadius:999, background:accent}}/>
      auto · {src}
    </span>
  );
}

function AWSidebar({accent, kind}) {
  const items = [
    { key:'home',    label:'Home',     Icon:Icon.Home },
    { key:'past',    label:'Archive',  Icon:Icon.Archive },
    { key:'up',      label:'Upcoming', Icon:Icon.Calendar },
    { key:'artists', label: kind==='theatre'?'Productions':(kind==='comedy'?'Comedians':'Artists'), Icon:Icon.Music, active:true },
    { key:'venues',  label:'Venues',   Icon:Icon.MapPin },
    { key:'map',     label:'Map',      Icon:Icon.Map },
  ];
  return (
    <div style={{width:224, background:AW_BG, borderRight:`1px solid ${AW_RULE}`, display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0}}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:AW_INK, letterSpacing:-0.5}}>
          showbook<span style={{color:AW_FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:AW_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>v · 2026.04</div>
      </div>
      <div style={{padding:'0 16px 20px'}}>
        <button style={{width:'100%', padding:'9px 12px', background:AW_INK, color:AW_BG, border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer'}}>
          <Icon.Plus size={15} color={AW_BG}/> Add a show
        </button>
      </div>
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:AW_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Navigate</div>
        {items.map(({key, label, Icon:Ic, active})=>(
          <div key={key} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 12px', margin:'1px 0', background: active ? AW_SURF : 'transparent', color: active ? AW_INK : AW_MUTED, fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400, borderLeft: active ? `2px solid ${accent}` : '2px solid transparent'}}>
            <Ic size={15} color={active ? AW_INK : AW_MUTED}/>
            <span style={{flex:1}}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px', borderTop:`1px solid ${AW_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:AW_SURF2, color:AW_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, fontFamily:SB.sans, fontSize:13, color:AW_INK, fontWeight:500}}>m</div>
        <Icon.More size={14} color={AW_MUTED}/>
      </div>
    </div>
  );
}

function AWCrumb({a}) {
  const parent = a.kindKey === 'theatre' ? 'productions' : a.kindKey === 'comedy' ? 'comedians' : 'artists';
  return (
    <div style={{padding:'14px 40px', borderBottom:`1px solid ${AW_RULE}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:11, color:AW_MUTED, letterSpacing:'.04em'}}>
        <span style={{color:AW_FAINT}}>{parent}</span>
        <Icon.ChevronRight size={11} color={AW_FAINT}/>
        <span style={{color:AW_INK}}>{a.name.toLowerCase()}</span>
      </div>
      <div style={{display:'flex', gap:6, alignItems:'center'}}>
        <div style={{padding:'5px 10px', border:`1px solid ${AW_RULE2}`, fontFamily:SB.mono, fontSize:11, color:AW_MUTED, cursor:'pointer'}}>follow</div>
        <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:AW_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
          <Icon.ArrowUpRight size={11} color={AW_MUTED}/> share
        </div>
      </div>
    </div>
  );
}

function AWHero({a, accent}) {
  return (
    <div style={{padding:'30px 40px 26px', borderBottom:`1px solid ${AW_RULE}`, display:'grid', gridTemplateColumns:'1fr auto', columnGap:40, alignItems:'end'}}>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:14}}>
          <span style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:accent, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            <Icon.Dot size={9} color={accent}/>{a.kind}
          </span>
          <span style={{fontFamily:SB.mono, fontSize:10.5, color:AW_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>{a.tagline}</span>
        </div>
        <div style={{fontFamily:SB.sans, fontSize:72, fontWeight:600, color:AW_INK, letterSpacing:-2.8, lineHeight:.92}}>
          {a.name}
        </div>
        {a.bio && (
          <div style={{fontFamily:SB.sans, fontSize:15, color:AW_MUTED, marginTop:16, letterSpacing:-0.1, lineHeight:1.5, maxWidth:680}}>
            {a.bio}
          </div>
        )}
      </div>
      <div style={{textAlign:'right', paddingLeft:40, borderLeft:`1px solid ${AW_RULE}`, minWidth:220}}>
        <div style={{fontFamily:SB.sans, fontSize:110, fontWeight:500, color:AW_INK, letterSpacing:-4.5, lineHeight:.85, fontFeatureSettings:'"tnum"'}}>
          {a.stats[0][1]}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:12, color:accent, marginTop:10, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:500}}>
          {a.stats[0][0]}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:AW_MUTED, marginTop:6, letterSpacing:'.04em'}}>
          {a.stats[0][2]}
        </div>
      </div>
    </div>
  );
}

function AWStatBar({a, accent}) {
  return (
    <div style={{padding:'16px 40px', background:AW_SURF, borderBottom:`1px solid ${AW_RULE}`, display:'grid', gridTemplateColumns:'repeat(5, 1fr)', columnGap:28}}>
      {a.stats.map(([l, v, sub], i)=>(
        <div key={l+i} style={{borderLeft: i===0 ? 'none' : `1px solid ${AW_RULE}`, paddingLeft: i===0 ? 0 : 20}}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>{l}</div>
          <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:AW_INK, letterSpacing:-0.7, marginTop:4, fontFeatureSettings:'"tnum"'}}>{v}</div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:AW_MUTED, marginTop:4, letterSpacing:'.02em'}}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Middle column pieces ──────────────────────────────────────
function AWShowsTable({a, accent, showCtx}) {
  return (
    <div style={{padding:'24px 32px 10px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Archive size={14} color={AW_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Your shows · {a.shows.length}
          </div>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:AW_FAINT, letterSpacing:'.04em'}}>chronological · newest first</div>
      </div>
      <div style={{background:AW_SURF}}>
        <div style={{display:'grid', gridTemplateColumns:'110px 1fr 1.2fr 90px', columnGap:14, padding:'9px 16px', borderBottom:`1px solid ${AW_RULE}`, fontFamily:SB.mono, fontSize:9.5, color:AW_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>
          <div>Date</div><div>Venue · city</div><div>Tour / material</div><div style={{textAlign:'right'}}>Songs</div>
        </div>
        {a.shows.map((r,i)=>(
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'110px 1fr 1.2fr 90px', columnGap:14,
            padding:'12px 16px',
            borderTop: i===0 ? 'none' : `1px solid ${AW_RULE}`,
            background: r.cur ? `${accent}1A` : 'transparent',
            borderLeft: r.cur ? `2px solid ${accent}` : '2px solid transparent',
            alignItems:'baseline',
          }}>
            <div style={{fontFamily:SB.mono, fontSize:11, color: r.cur ? accent : AW_MUTED, letterSpacing:'.04em'}}>{r.d}</div>
            <div>
              <div style={{fontFamily:SB.sans, fontSize:14, fontWeight: r.cur ? 600 : 500, color:AW_INK, letterSpacing:-0.2}}>{r.v}</div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, marginTop:3}}>{r.city}</div>
            </div>
            <div>
              <div style={{fontFamily:SB.sans, fontSize:13, color:AW_INK, letterSpacing:-0.1, fontStyle:'italic'}}>{r.tour}</div>
              {showCtx && r.ctx && (
                <div style={{fontFamily:SB.mono, fontSize:10, color:AW_MUTED, marginTop:3, letterSpacing:'.02em'}}>{r.ctx}</div>
              )}
            </div>
            <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:11, color:AW_MUTED}}>{r.songs != null ? `${r.songs} songs` : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWSongsLive({a, accent}) {
  if (!a.songs) return null;
  const half = Math.ceil(a.songs.length / 2);
  const Col = ({items, start=0}) => (
    <div>
      {items.map(([t, newly], i)=>(
        <div key={i} style={{display:'grid', gridTemplateColumns:'24px 1fr auto', columnGap:10, padding:'8px 0', borderBottom:`1px solid ${AW_RULE}`, alignItems:'center'}}>
          <span style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT}}>{String(start+i+1).padStart(2,'0')}</span>
          <span style={{fontFamily:SB.sans, fontSize:13, color:AW_INK, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t}</span>
          {newly ? <span style={{fontFamily:SB.mono, fontSize:9, color:accent, letterSpacing:'.08em'}}>NEW</span> : <span/>}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{padding:'24px 32px 10px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Music size={14} color={AW_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Songs heard live · {a.songs.length} of 82
          </div>
        </div>
        {awSrcBadge(accent, 'setlist.fm')}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:24}}>
        <Col items={a.songs.slice(0, half)} start={0}/>
        <Col items={a.songs.slice(half)} start={half}/>
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10.5, color:AW_MUTED, marginTop:12, letterSpacing:'.04em'}}>{a.songsMeta}</div>
    </div>
  );
}

function AWSpecialsGrid({a, accent}) {
  if (!a.specials) return null;
  return (
    <div style={{padding:'24px 32px 10px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Eye size={14} color={AW_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Specials · you saw {a.specials.filter(s=>s.mine).length} of {a.specials.length}
          </div>
        </div>
        {awSrcBadge(accent, 'wikipedia')}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8}}>
        {a.specials.map((sp,i)=>(
          <div key={i} style={{
            padding:'14px 16px', background:AW_SURF,
            borderLeft:`2px solid ${sp.mine ? accent : AW_FAINT}`,
          }}>
            <div style={{fontFamily:SB.sans, fontSize:15, color:AW_INK, fontWeight:500, letterSpacing:-0.3, fontStyle:'italic'}}>{sp.t}</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:AW_MUTED, marginTop:4, letterSpacing:'.04em'}}>{sp.net} · {sp.yr}</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color: sp.mine ? accent : AW_FAINT, marginTop:10, letterSpacing:'.06em', textTransform:'uppercase'}}>
              {sp.saw || '— not seen live'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWVisits({a, accent}) {
  if (!a.visits) return null;
  return (
    <div style={{padding:'24px 32px 10px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Ticket size={14} color={AW_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Your visits · cast on the night
          </div>
        </div>
        {awSrcBadge(accent, 'playbill')}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
        {a.visits.map((v,i)=>(
          <div key={i} style={{
            background:AW_SURF,
            borderLeft:`2px solid ${v.cur ? accent : AW_FAINT}`,
            padding:'14px 16px',
          }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
              <div style={{fontFamily:SB.mono, fontSize:11, color: v.cur ? accent : AW_MUTED, letterSpacing:'.06em'}}>{v.d}</div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, letterSpacing:'.02em'}}>{v.theatre} · {v.seat}</div>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:12}}>
              {v.cast.map(([role, who])=>(
                <div key={role} style={{padding:'7px 9px', background:AW_BG, border:`1px solid ${AW_RULE}`}}>
                  <div style={{fontFamily:SB.mono, fontSize:9, color:AW_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>{role}</div>
                  <div style={{fontFamily:SB.sans, fontSize:13, color:AW_INK, letterSpacing:-0.2, marginTop:3, fontWeight:500}}>{who}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWShowSongs({a, accent}) {
  // For theatre: songs heard (compact)
  if (!a.songs) return null;
  return (
    <div style={{padding:'20px 32px 10px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Music size={14} color={AW_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Songs from the show · {a.songs.length}
          </div>
        </div>
        {awSrcBadge(accent, 'playbill')}
      </div>
      <div style={{background:AW_SURF, padding:'10px 14px'}}>
        <div style={{columnCount:3, columnGap:22}}>
          {a.songs.map(([t, newly], i)=>(
            <div key={i} style={{fontFamily:SB.mono, fontSize:11, padding:'4px 0', display:'flex', gap:6, breakInside:'avoid', color:AW_INK}}>
              <span style={{color:AW_FAINT, width:22}}>{String(i+1).padStart(2,'0')}</span>
              <span style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t}</span>
              {newly && <span style={{color:accent, fontSize:9}}>◆</span>}
            </div>
          ))}
        </div>
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10.5, color:AW_MUTED, marginTop:10, letterSpacing:'.04em'}}>{a.songsMeta}</div>
    </div>
  );
}

// ─── Right column ──────────────────────────────────────────────
function AWUpcomingSide({a, accent}) {
  if (!a.upcoming) return null;
  const u = a.upcoming;
  return (
    <div>
      <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, marginBottom:12}}>Upcoming</div>
      <div style={{background:AW_SURF, borderLeft:`2px solid ${accent}`, padding:'14px 16px'}}>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:accent, letterSpacing:'.06em'}}>{u.d}</div>
        <div style={{fontFamily:SB.sans, fontSize:16, fontWeight:600, color:AW_INK, marginTop:4, letterSpacing:-0.3}}>{u.v}</div>
        <div style={{fontFamily:SB.sans, fontSize:13, color:AW_MUTED, marginTop:3, letterSpacing:-0.1}}>{u.city}</div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, marginTop:10, letterSpacing:'.04em'}}>○ {u.note}</div>
      </div>
      {a.upcomingExtra && (
        <div style={{marginTop:8, background:AW_SURF}}>
          {a.upcomingExtra.map((e,i)=>(
            <div key={i} style={{
              padding:'10px 14px',
              borderTop: i===0 ? 'none' : `1px solid ${AW_RULE}`,
              display:'grid', gridTemplateColumns:'auto 1fr', columnGap:12,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:10, color:AW_MUTED}}>{e.d}</div>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:13, color:AW_INK, fontWeight:500}}>{e.v}</div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:AW_FAINT, marginTop:2}}>{e.note}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AWMapSide({a, accent}) {
  if (!a.cities) return null;
  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>Where you've caught them</div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT}}>{a.cities.length} cities</div>
      </div>
      <div style={{
        height:200, position:'relative', background:AW_SURF,
        backgroundImage:`radial-gradient(circle, ${AW_RULE2} 1px, transparent 1.2px)`,
        backgroundSize:'16px 16px',
      }}>
        {a.cities.map((c,i)=>(
          <div key={i} style={{
            position:'absolute', left:`${c.x}%`, top:`${c.y}%`,
            transform:'translate(-50%,-50%)', display:'flex', alignItems:'center', gap:8,
          }}>
            <div style={{
              width:c.r*2, height:c.r*2, borderRadius:999,
              background:`${accent}40`, border:`1.5px solid ${accent}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:SB.mono, fontSize:11, color:AW_INK, fontWeight:600,
            }}>{c.label.split('·')[1].trim()}</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:AW_INK, letterSpacing:'.04em', whiteSpace:'nowrap'}}>
              {c.label.split('·')[0].trim()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWTimelineSide({a, accent, title}) {
  const list = a.discography || a.timeline || a.productionTimeline;
  if (!list) return null;
  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>{title}</div>
        {awSrcBadge(accent, 'wikipedia')}
      </div>
      <div style={{position:'relative', padding:'2px 0'}}>
        <div style={{position:'absolute', left:7, top:10, bottom:10, width:1, background:AW_RULE2}}/>
        {list.map((e,i)=>(
          <div key={i} style={{position:'relative', padding:'6px 0 14px 26px'}}>
            <div style={{position:'absolute', left:2, top:10, width:11, height:11, borderRadius:999, background: e.you ? accent : AW_BG, border:`1.5px solid ${e.you ? accent : AW_INK}`}}/>
            <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, letterSpacing:'.06em'}}>{e.y}</div>
            <div style={{fontFamily:SB.sans, fontSize:14, fontWeight: e.you ? 600 : 500, color:AW_INK, letterSpacing:-0.2, marginTop:2}}>{e.t}</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color: e.you ? accent : AW_MUTED, marginTop:3, letterSpacing:'.02em'}}>
              {e.note ? e.note : e.you ? 'you were there' : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWCreditsSide({a, accent}) {
  if (!a.credits) return null;
  return (
    <div>
      <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, marginBottom:12}}>Credits</div>
      <div style={{background:AW_SURF, padding:'6px 16px'}}>
        {a.credits.map(([k,v],i)=>(
          <div key={k} style={{
            display:'grid', gridTemplateColumns:'88px 1fr', padding:'10px 0',
            borderTop: i===0 ? 'none' : `1px solid ${AW_RULE}`, alignItems:'baseline',
          }}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:AW_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>{k}</div>
            <div style={{fontFamily:SB.sans, fontSize:13.5, color:AW_INK, letterSpacing:-0.2}}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AWRunningSide({a, accent}) {
  if (!a.running) return null;
  return (
    <div>
      <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, marginBottom:12}}>Currently playing</div>
      <div style={{background:AW_SURF, borderLeft:`2px solid ${accent}`, padding:'14px 16px'}}>
        <div style={{fontFamily:SB.sans, fontSize:14.5, fontWeight:600, color:AW_INK, letterSpacing:-0.2}}>{a.running.theatre}</div>
        <div style={{fontFamily:SB.sans, fontSize:12.5, color:AW_MUTED, marginTop:5, letterSpacing:-0.1}}>{a.running.schedule}</div>
        <div style={{display:'flex', gap:6, marginTop:12, flexWrap:'wrap'}}>
          {a.running.actions.map(x=>(
            <span key={x} style={{fontFamily:SB.mono, fontSize:10, color:AW_INK, padding:'5px 9px', border:`1px solid ${AW_RULE2}`, letterSpacing:'.04em'}}>{x}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AWRelatedSide({a, accent}) {
  if (!a.related) return null;
  return (
    <div>
      <div style={{fontFamily:SB.mono, fontSize:11, color:AW_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, marginBottom:12}}>Related · you've seen</div>
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {a.related.map(x=>(
          <span key={x} style={{
            fontFamily:SB.sans, fontSize:12.5, color:AW_INK,
            padding:'6px 10px', background:AW_SURF, border:`1px solid ${AW_RULE2}`,
            letterSpacing:-0.1,
          }}>{x}</span>
        ))}
      </div>
    </div>
  );
}

function AWSide({a, accent}) {
  return (
    <div style={{padding:'24px 32px 24px', borderLeft:`1px solid ${AW_RULE}`, display:'flex', flexDirection:'column', gap:28, minHeight:0, overflow:'auto'}}>
      {a.kindKey === 'concert' && (
        <>
          <AWUpcomingSide a={a} accent={accent}/>
          <AWMapSide a={a} accent={accent}/>
          <AWTimelineSide a={a} accent={accent} title="Discography"/>
          <AWRelatedSide a={a} accent={accent}/>
        </>
      )}
      {a.kindKey === 'comedy' && (
        <>
          <AWUpcomingSide a={a} accent={accent}/>
          <AWTimelineSide a={a} accent={accent} title="Career · tour timeline"/>
          <AWRelatedSide a={a} accent={accent}/>
        </>
      )}
      {a.kindKey === 'theatre' && (
        <>
          <AWRunningSide a={a} accent={accent}/>
          <AWCreditsSide a={a} accent={accent}/>
          <AWTimelineSide a={a} accent={accent} title="Production timeline"/>
          <AWRelatedSide a={a} accent={accent}/>
        </>
      )}
    </div>
  );
}

function ArtistWeb({payload}) {
  const a = payload;
  const accent = SB.kinds[a.kindKey].inkDark;
  return (
    <div style={{width:'100%', height:'100%', background:AW_BG, color:AW_INK, display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden'}}>
      <AWSidebar accent={accent} kind={a.kindKey}/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden'}}>
        <AWCrumb a={a}/>
        <div style={{flex:1, overflow:'auto', minHeight:0}}>
          <AWHero a={a} accent={accent}/>
          <AWStatBar a={a} accent={accent}/>
          <div style={{display:'grid', gridTemplateColumns:'1fr 420px', minHeight:0}}>
            <div>
              {a.kindKey === 'concert' && (
                <>
                  <AWShowsTable a={a} accent={accent}/>
                  <AWSongsLive a={a} accent={accent}/>
                </>
              )}
              {a.kindKey === 'comedy' && (
                <>
                  <AWShowsTable a={a} accent={accent} showCtx/>
                  <AWSpecialsGrid a={a} accent={accent}/>
                </>
              )}
              {a.kindKey === 'theatre' && (
                <>
                  <AWVisits a={a} accent={accent}/>
                  <AWShowSongs a={a} accent={accent}/>
                </>
              )}
            </div>
            <AWSide a={a} accent={accent}/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ArtistWeb = ArtistWeb;
