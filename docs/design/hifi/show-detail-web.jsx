// Web · Show detail — generic renderer; payload passed in.
const { SB, Icon } = window;

const WD_MODE = 'dark';
const WD_BG    = SB.bg[WD_MODE];
const WD_SURF  = SB.surface[WD_MODE];
const WD_SURF2 = SB.surface2[WD_MODE];
const WD_INK   = SB.ink[WD_MODE];
const WD_MUTED = SB.muted[WD_MODE];
const WD_FAINT = SB.faint[WD_MODE];
const WD_RULE  = SB.rule[WD_MODE];
const WD_RULE2 = SB.ruleStrong[WD_MODE];

function WDSidebar({accent}) {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive, active:true },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar },
    { key:'artists',label:'Artists',   Icon:Icon.Music },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin },
    { key:'map',    label:'Map',       Icon:Icon.Map },
  ];
  return (
    <div style={{width:224, background:WD_BG, borderRight:`1px solid ${WD_RULE}`, display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0}}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:WD_INK, letterSpacing:-0.5}}>
          showbook
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:WD_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>v · 2026.04</div>
      </div>
      <div style={{padding:'0 16px 20px'}}>
        <button style={{width:'100%', padding:'9px 12px', background:WD_INK, color:WD_BG, border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer'}}>
          <Icon.Plus size={15} color={WD_BG}/> Add a show
        </button>
      </div>
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:WD_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Navigate</div>
        {items.map(({key, label, Icon:Ic, active})=>(
          <div key={key} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 12px', margin:'1px 0', background: active ? WD_SURF : 'transparent', color: active ? WD_INK : WD_MUTED, fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400, borderLeft: active ? `2px solid ${accent}` : '2px solid transparent'}}>
            <Ic size={15} color={active ? WD_INK : WD_MUTED}/>
            <span style={{flex:1}}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px', borderTop:`1px solid ${WD_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:WD_SURF2, color:WD_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, fontFamily:SB.sans, fontSize:13, color:WD_INK, fontWeight:500}}>m</div>
        <Icon.More size={14} color={WD_MUTED}/>
      </div>
    </div>
  );
}

function WDCrumb({s}) {
  return (
    <div style={{padding:'14px 40px', borderBottom:`1px solid ${WD_RULE}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:11, color:WD_MUTED, letterSpacing:'.04em'}}>
        <span style={{color:WD_FAINT}}>archive</span>
        <Icon.ChevronRight size={11} color={WD_FAINT}/>
        <span style={{color:WD_FAINT}}>{s.date.y}</span>
        <Icon.ChevronRight size={11} color={WD_FAINT}/>
        <span style={{color:WD_INK}}>{s.headliner.toLowerCase()} · {s.venue.toLowerCase()}</span>
      </div>
      <div style={{display:'flex', gap:6, alignItems:'center'}}>
        <div style={{padding:'5px 10px', border:`1px solid ${WD_RULE2}`, fontFamily:SB.mono, fontSize:11, color:WD_MUTED, cursor:'pointer'}}>← prev</div>
        <div style={{padding:'5px 10px', border:`1px solid ${WD_RULE2}`, fontFamily:SB.mono, fontSize:11, color:WD_MUTED, cursor:'pointer'}}>next →</div>
        <div style={{width:1, height:18, background:WD_RULE, margin:'0 6px'}}/>
        <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:WD_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
          <Icon.ArrowUpRight size={11} color={WD_MUTED}/> share
        </div>
        <div style={{padding:'5px 10px', fontFamily:SB.mono, fontSize:11, color:WD_MUTED, cursor:'pointer'}}>edit</div>
      </div>
    </div>
  );
}

function WDHero({s, accent}) {
  return (
    <div style={{padding:'26px 40px 24px', borderBottom:`1px solid ${WD_RULE}`, display:'grid', gridTemplateColumns:'1fr auto', columnGap:40, alignItems:'end'}}>
      <div style={{minWidth:0}}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:12}}>
          <span style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5, color:accent, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            <Icon.Dot size={9} color={accent}/>{s.kind}
          </span>
          <span style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>{s.tour}</span>
        </div>
        <div style={{fontFamily:SB.sans, fontSize:54, fontWeight:600, color:WD_INK, letterSpacing:-2.0, lineHeight:.95}}>
          {s.headliner}
        </div>
        {s.subtitle && (
          <div style={{fontFamily:SB.sans, fontSize:18, color:WD_MUTED, marginTop:10, letterSpacing:-0.3, fontStyle: s.subtitleItalic ? 'italic' : 'normal'}}>
            {s.subtitle}
          </div>
        )}
        {s.support && (
          <div style={{fontFamily:SB.sans, fontSize:16, color:WD_MUTED, marginTop:8, letterSpacing:-0.2}}>
            with {s.support} · at {s.venue}
          </div>
        )}
        <div style={{display:'flex', gap:28, marginTop:22, fontFamily:SB.sans, fontSize:13, color:WD_INK}}>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.MapPin size={14} color={WD_MUTED}/>
            <span>{s.venue}</span>
            <span style={{color:WD_FAINT}}>·</span>
            <span style={{color:WD_MUTED}}>{s.neighborhood}</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:7}}>
            <Icon.Clock size={14} color={WD_MUTED}/>
            <span style={{fontFamily:SB.mono, color:WD_MUTED}}>{s.time}</span>
          </div>
        </div>
      </div>
      <div style={{textAlign:'right', paddingLeft:40, borderLeft:`1px solid ${WD_RULE}`, minWidth:220}}>
        <div style={{fontFamily:SB.sans, fontSize:88, fontWeight:500, color:WD_INK, letterSpacing:-3.6, lineHeight:.85, fontFeatureSettings:'"tnum"'}}>{s.date.d}</div>
        <div style={{fontFamily:SB.mono, fontSize:12, color:accent, marginTop:10, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500}}>
          {s.date.m} · {s.date.dow}
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, marginTop:6, letterSpacing:'.04em'}}>
          {s.date.y} · ${s.paid} via {s.source}
        </div>
      </div>
    </div>
  );
}

function WDStatBar({s, accent}) {
  return (
    <div style={{padding:'16px 40px', background:WD_SURF, borderBottom:`1px solid ${WD_RULE}`, display:'grid', gridTemplateColumns:'repeat(5, 1fr)', columnGap:28}}>
      {s.stats.map(([l, v, sub], i)=>(
        <div key={l+i} style={{borderLeft: i===0 ? 'none' : `1px solid ${WD_RULE}`, paddingLeft: i===0 ? 0 : 20}}>
          <div style={{fontFamily:SB.mono, fontSize:10, color:WD_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>{l}</div>
          <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:WD_INK, letterSpacing:-0.7, marginTop:4, fontFeatureSettings:'"tnum"'}}>{v}</div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, marginTop:4, letterSpacing:'.02em'}}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

function WDSetlist({s, accent}) {
  if (!s.setlist) return null;
  const half = Math.ceil(s.setlist.length / 2);
  const SongRow = ({idx, t, newly, dur}) => (
    <div style={{display:'grid', gridTemplateColumns:'24px 1fr auto auto', columnGap:10, padding:'8px 0', borderBottom:`1px solid ${WD_RULE}`, alignItems:'center'}}>
      <span style={{fontFamily:SB.mono, fontSize:10, color:WD_FAINT}}>{String(idx).padStart(2,'0')}</span>
      <span style={{fontFamily:SB.sans, fontSize:13, color:WD_INK, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t}</span>
      {newly ? <span style={{fontFamily:SB.mono, fontSize:9, color:accent, letterSpacing:'.08em'}}>NEW</span> : <span/>}
      <span style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED}}>{dur}</span>
    </div>
  );
  return (
    <div style={{padding:'24px 0'}}>
      <div style={{padding:'0 32px 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Music size={14} color={WD_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Setlist · {s.setlist.length + (s.encore ? s.encore.length : 0)} songs
          </div>
        </div>
        <div style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10, color:accent, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, padding:'3px 8px', border:`1px solid ${accent}40`}}>
          <span style={{width:4, height:4, borderRadius:999, background:accent}}/>auto · setlist.fm
        </div>
      </div>
      <div style={{padding:'0 32px', display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:24}}>
        <div>{s.setlist.slice(0, half).map(([t,nw,d],i)=><SongRow key={i} idx={i+1} t={t} newly={nw} dur={d||''}/>)}</div>
        <div>{s.setlist.slice(half).map(([t,nw,d],i)=><SongRow key={i} idx={i+1+half} t={t} newly={nw} dur={d||''}/>)}</div>
      </div>
      {s.encore && (
        <>
          <div style={{padding:'18px 32px 6px', display:'flex', alignItems:'center', gap:10}}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:accent, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500}}>— Encore</div>
            <div style={{flex:1, height:1, background:WD_RULE}}/>
          </div>
          <div style={{padding:'0 32px'}}>
            {s.encore.map(([t,nw,d],i)=>(<SongRow key={i} idx={s.setlist.length+i+1} t={t} newly={nw} dur={d||''}/>))}
          </div>
        </>
      )}
    </div>
  );
}

function WDCast({s, accent}) {
  if (!s.cast) return null;
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.User size={14} color={WD_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Cast on the night · {s.date.y}-{s.date.m}-{s.date.d}
          </div>
        </div>
        <div style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10, color:accent, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, padding:'3px 8px', border:`1px solid ${accent}40`}}>
          <span style={{width:4, height:4, borderRadius:999, background:accent}}/>auto · playbill
        </div>
      </div>
      <div style={{background:WD_SURF}}>
        {s.cast.map(([role, who, replace], i)=>(
          <div key={i} style={{display:'grid', gridTemplateColumns:'130px 1fr auto', columnGap:10, padding:'12px 16px', borderTop: i===0 ? 'none' : `1px solid ${WD_RULE}`, alignItems:'center'}}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:WD_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>{role}</div>
            <div style={{fontFamily:SB.sans, fontSize:15, color:WD_INK, letterSpacing:-0.2, fontWeight:500}}>{who}</div>
            {replace ? (
              <div style={{fontFamily:SB.mono, fontSize:9.5, color:accent, letterSpacing:'.08em', textTransform:'uppercase'}}>u/s</div>
            ) : <div/>}
          </div>
        ))}
      </div>
      {s.castNote && (
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, marginTop:12, letterSpacing:'.04em'}}>
          {s.castNote}
        </div>
      )}
    </div>
  );
}

function WDMaterial({s, accent}) {
  if (!s.materialContext) return null;
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon.Music size={14} color={WD_INK}/>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Material context
          </div>
        </div>
        <div style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10, color:accent, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, padding:'3px 8px', border:`1px solid ${accent}40`}}>
          <span style={{width:4, height:4, borderRadius:999, background:accent}}/>auto · wikipedia
        </div>
      </div>
      <div style={{padding:'18px 22px', background:WD_SURF, borderLeft:`2px solid ${accent}`}}>
        <div style={{fontFamily:SB.sans, fontSize:15, color:WD_INK, lineHeight:1.6, letterSpacing:-0.1}}>
          {s.materialContext}
        </div>
        {s.materialMeta && (
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, marginTop:12, letterSpacing:'.04em', textTransform:'uppercase'}}>
            {s.materialMeta}
          </div>
        )}
      </div>
      {s.specials && (
        <div style={{marginTop:20}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_FAINT, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:10}}>
            His specials
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
            {s.specials.map((sp,i)=>(
              <div key={i} style={{padding:'12px 14px', background:WD_SURF, borderLeft:`2px solid ${sp.saw ? accent : WD_FAINT}`}}>
                <div style={{fontFamily:SB.sans, fontSize:14, color:WD_INK, fontWeight:500, letterSpacing:-0.2}}>{sp.t}</div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:WD_MUTED, marginTop:3}}>{sp.net}</div>
                <div style={{fontFamily:SB.mono, fontSize:10, color: sp.saw ? accent : WD_FAINT, marginTop:6, letterSpacing:'.04em', textTransform:'uppercase'}}>
                  {sp.saw || '— not seen live'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WDSide({s, accent}) {
  return (
    <div style={{padding:'24px 32px 24px', borderLeft:`1px solid ${WD_RULE}`, display:'flex', flexDirection:'column', gap:26, minHeight:0, overflow:'auto'}}>
      {/* Lineup */}
      {s.lineup && (
        <div>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:12}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              {s.lineupTitle || 'Lineup'}
            </div>
          </div>
          {s.lineup.map((a,i)=>(
            <div key={i} style={{padding:'14px 16px', background:WD_SURF, borderLeft:`2px solid ${accent}`, marginBottom:8, display:'grid', gridTemplateColumns:'1fr auto', gap:14, alignItems:'center'}}>
              <div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:WD_FAINT, letterSpacing:'.12em', textTransform:'uppercase'}}>{a.role}</div>
                <div style={{fontFamily:SB.sans, fontSize:17, fontWeight:600, color:WD_INK, letterSpacing:-0.4, marginTop:3}}>{a.name}</div>
                {a.detail && (
                  <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, marginTop:5, letterSpacing:'.02em'}}>{a.detail}</div>
                )}
              </div>
              {a.seen && (
                <div style={{textAlign:'right', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2}}>
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:WD_INK, letterSpacing:-0.7, lineHeight:1}}>{a.seen}</div>
                  <div style={{fontFamily:SB.mono, fontSize:9, color:WD_FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>seen live</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* With artist */}
      {s.withArtist && (
        <div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              {s.withArtistTitle}
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:accent, fontWeight:500, letterSpacing:'.04em'}}>{s.seenOrdinal?.toLowerCase()}</div>
          </div>
          <div style={{position:'relative', padding:'2px 0'}}>
            <div style={{position:'absolute', left:7, top:10, bottom:10, width:1, background:WD_RULE2}}/>
            {s.withArtist.map((t,i)=>(
              <div key={i} style={{position:'relative', padding:'6px 0 14px 26px'}}>
                <div style={{position:'absolute', left:2, top:10, width:11, height:11, borderRadius:999, background: t.cur ? accent : WD_BG, border:`1.5px solid ${t.cur ? accent : WD_INK}`}}/>
                <div style={{fontFamily:SB.mono, fontSize:10, color:WD_FAINT, letterSpacing:'.06em'}}>{t.d}</div>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight: t.cur ? 600 : 500, color:WD_INK, letterSpacing:-0.2, marginTop:2}}>{t.v}</div>
                {t.sub && (
                  <div style={{fontFamily:SB.mono, fontSize:10, color:WD_MUTED, marginTop:3, letterSpacing:'.02em'}}>{t.sub}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* At venue */}
      {s.atVenue && (
        <div>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
            <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>{s.atVenueTitle}</div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, letterSpacing:'.04em'}}>{s.atVenueMeta}</div>
          </div>
          <div style={{background:WD_SURF}}>
            {s.atVenue.map(([d,a,cur],i)=>(
              <div key={i} style={{display:'grid', gridTemplateColumns:'90px 1fr', columnGap:10, padding:'9px 14px', borderBottom: i===s.atVenue.length-1 ? 'none' : `1px solid ${WD_RULE}`, background: cur ? `${accent}1A` : 'transparent', alignItems:'center'}}>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED}}>{d}</div>
                <div style={{fontFamily:SB.sans, fontSize:13, fontWeight: cur ? 600 : 400, color:WD_INK, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{a}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {s.notes && (
        <div>
          <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, marginBottom:10}}>
            Your notes
          </div>
          <div style={{padding:'14px 16px', background:WD_SURF, borderLeft:`2px solid ${WD_FAINT}`, fontFamily:SB.sans, fontSize:13.5, color:WD_INK, lineHeight:1.55, letterSpacing:-0.1}}>
            "{s.notes}"
          </div>
        </div>
      )}
    </div>
  );
}

function WDPhotos({accent}) {
  return (
    <div style={{borderTop:`1px solid ${WD_RULE}`, padding:'20px 40px 24px'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
        <div style={{fontFamily:SB.mono, fontSize:11, color:WD_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
          Photos · 5
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:WD_MUTED, display:'flex', alignItems:'center', gap:5, cursor:'pointer'}}>
          <Icon.Plus size={12} color={WD_MUTED}/> attach
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:4}}>
        {[0,1,2,3,4].map(i=>(
          <div key={i} style={{aspectRatio:'4 / 3', background:WD_SURF2, backgroundImage:`repeating-linear-gradient(45deg, ${WD_RULE2} 0 2px, transparent 2px 12px)`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:10, color:WD_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
            Photo {String(i+1).padStart(2,'0')}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShowDetailWeb({payload}) {
  const s = payload;
  const accent = SB.kinds[s.kindKey].inkDark;
  return (
    <div style={{width:'100%', height:'100%', background:WD_BG, color:WD_INK, display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden'}}>
      <WDSidebar accent={accent}/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden'}}>
        <WDCrumb s={s}/>
        <div style={{flex:1, overflow:'auto', minHeight:0}}>
          <WDHero s={s} accent={accent}/>
          <WDStatBar s={s} accent={accent}/>
          <div style={{display:'grid', gridTemplateColumns:'1fr 440px', minHeight:0}}>
            <div>
              {s.kindKey === 'concert'  && <WDSetlist s={s} accent={accent}/>}
              {s.kindKey === 'comedy'   && <WDMaterial s={s} accent={accent}/>}
              {s.kindKey === 'theatre' && <WDCast s={s} accent={accent}/>}
            </div>
            <WDSide s={s} accent={accent}/>
          </div>
          <WDPhotos accent={accent}/>
        </div>
      </div>
    </div>
  );
}

window.ShowDetailWeb = ShowDetailWeb;
