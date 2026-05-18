// Discover · 6th tab. Dense feed of announcements from followed venues + near-you.
// Web: left rail = venue filter (All / per-venue); main = dense table grouped by venue when All.
// Mobile: chip row of venues; list rows. Watchlisting moves a row into Shows with state `watching`.

const { SB, Icon, KindIcon, HIFI_KINDS, HIFI_ANNOUNCEMENTS, HIFI_FOLLOWED_VENUES, V2Sidebar } = window;
const D_ACCENT_D = SB.accent.dark, D_ACCENT_L = SB.accent.light, D_ACCENT_TEXT = SB.accent.text;

const reasonLabel = (r) => ({
  'followed-venue':'followed venue', 'nearby':'near you', 'tracked-artist':'tracked artist',
}[r] || r);

// ─── Web ───────────────────────────────────────────────────────────────
function DiscoverWeb({initialTab='followed'}) {
  const [tab, setTab] = React.useState(initialTab);
  const [venue, setVenue] = React.useState('all'); // venueId or 'all'
  const [watched, setWatched] = React.useState({});
  const [hovId, setHovId] = React.useState(null);
  const M='dark';
  const BG=SB.bg[M], SURF=SB.surface[M], SURF2=SB.surface2[M];
  const INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];

  const allForTab = HIFI_ANNOUNCEMENTS.filter(a =>
    tab==='followed' ? a.reason!=='nearby' : a.reason==='nearby'
  );
  const rows = venue==='all' ? allForTab : allForTab.filter(a=>a.venueId===venue);

  // For the venue rail we show followed venues only when on "followed",
  // for nearby we show venue chips derived from the nearby rows.
  const venueList = tab==='followed'
    ? HIFI_FOLLOWED_VENUES.map(v => ({
        id:v.id, name:v.name, nbhd:v.nbhd,
        count: allForTab.filter(a=>a.venueId===v.id).length
      })).filter(v=>v.count>0)
    : Array.from(new Map(allForTab.map(a=>[a.venueId, {id:a.venueId, name:a.venue, nbhd:a.venueNbhd}])).values())
        .map(v=>({...v, count: allForTab.filter(a=>a.venueId===v.id).length}));

  const tabs = [
    { k:'followed', l:'Followed venues', c: HIFI_ANNOUNCEMENTS.filter(a=>a.reason!=='nearby').length },
    { k:'nearby',   l:'Near you',        c: HIFI_ANNOUNCEMENTS.filter(a=>a.reason==='nearby').length },
  ];

  // Group rows by venue for 'all'; otherwise just a flat list
  const groups = venue==='all'
    ? venueList.map(v => ({ v, items: allForTab.filter(a=>a.venueId===v.id) }))
    : [{ v: venueList.find(v=>v.id===venue) || {name:'', nbhd:''}, items: rows }];

  return (
    <div style={{
      width:'100%', height:'100%', background:BG, color:INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <V2Sidebar active="discover"/>
      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Header */}
        <div style={{
          padding:'16px 36px', display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.1em', textTransform:'uppercase'}}>
              {allForTab.length} announcements · daily 8am digest
            </div>
            <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:INK, letterSpacing:-0.9, marginTop:4}}>
              Discover
            </div>
          </div>
          <div style={{display:'flex', gap:10, fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.04em', alignItems:'center'}}>
            <Icon.MapPin size={12} color={MUTED}/>
            nyc · 30mi radius
            <span style={{color:FAINT}}>·</span>
            updated 12m ago
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          padding:'11px 36px', display:'flex', alignItems:'center', gap:14,
          background:SURF, borderBottom:`1px solid ${RULE}`,
        }}>
          <div style={{display:'flex', border:`1px solid ${RULE2}`}}>
            {tabs.map(({k,l,c},i)=>{
              const active = k===tab;
              return (
                <button key={k} onClick={()=>{setTab(k); setVenue('all');}} style={{
                  border:'none', cursor:'pointer',
                  borderRight: i===tabs.length-1 ? 'none' : `1px solid ${RULE2}`,
                  background: active ? INK : 'transparent',
                  color: active ? BG : INK,
                  padding:'8px 16px',
                  fontFamily:SB.sans, fontSize:13, fontWeight: active?600:500, letterSpacing:-0.2,
                  display:'flex', alignItems:'center', gap:8,
                }}>
                  <span>{l}</span>
                  <span style={{fontFamily:SB.mono, fontSize:10.5, color: active?BG:FAINT, opacity: active?.7:1, fontWeight:400}}>{c}</span>
                </button>
              );
            })}
          </div>
          <div style={{flex:1}}/>
          <div style={{
            display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:10.5, color:MUTED,
            padding:'6px 10px', border:`1px solid ${RULE}`,
          }}>
            <Icon.Filter size={11} color={MUTED}/>
            <span>next 12 months</span>
            <span style={{color:FAINT}}>·</span>
            <span>all kinds</span>
            <Icon.ChevronDown size={10} color={MUTED}/>
          </div>
          <div style={{
            display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:10.5, color:MUTED,
            padding:'6px 10px', border:`1px solid ${RULE}`,
          }}>
            <Icon.Search size={11} color={MUTED}/>
            <span>search artists…</span>
          </div>
        </div>

        {/* Main: venue rail + feed */}
        <div style={{flex:1, minHeight:0, display:'flex', overflow:'hidden'}}>
          {/* Venue rail */}
          <div style={{
            width:240, borderRight:`1px solid ${RULE}`, padding:'16px 0',
            overflow:'auto', flexShrink:0, background:BG,
          }}>
            <div style={{padding:'0 18px 10px', fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.1em', textTransform:'uppercase'}}>
              {tab==='followed' ? 'Followed venues' : 'Nearby venues'}
            </div>

            {/* All row */}
            {[{id:'all', name: tab==='followed' ? 'All followed' : 'All nearby', nbhd:'', count: allForTab.length}, ...venueList].map(v=>{
              const active = v.id===venue;
              return (
                <div key={v.id} onClick={()=>setVenue(v.id)} style={{
                  padding:'10px 18px', cursor:'pointer',
                  background: active ? SURF : 'transparent',
                  borderLeft: active ? `2px solid ${D_ACCENT_D}` : '2px solid transparent',
                  display:'flex', alignItems:'center', gap:10,
                }}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{
                      fontFamily:SB.sans, fontSize:13, fontWeight: active?600:500, color: active?INK:INK,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', letterSpacing:-0.2,
                    }}>
                      {v.name}
                    </div>
                    {v.nbhd && (
                      <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, marginTop:2, letterSpacing:'.04em'}}>
                        {v.nbhd.toLowerCase()}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontFamily:SB.mono, fontSize:11, color: active?INK:MUTED,
                    fontWeight: active?500:400, fontFeatureSettings:'"tnum"',
                  }}>{v.count}</div>
                </div>
              );
            })}

            {tab==='followed' && (
              <div style={{padding:'14px 18px 4px', borderTop:`1px solid ${RULE}`, marginTop:10}}>
                <div style={{
                  display:'flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5,
                  color:MUTED, letterSpacing:'.04em', cursor:'pointer',
                }}>
                  <Icon.Plus size={11} color={D_ACCENT_D}/> Follow another venue
                </div>
              </div>
            )}
          </div>

          {/* Feed */}
          <div style={{flex:1, minWidth:0, overflow:'auto', padding:'20px 28px 36px'}}>
            {/* Column heads */}
            <div style={{
              display:'grid',
              gridTemplateColumns:'72px 100px 1fr 120px 110px 200px',
              columnGap:16, padding:'0 12px 10px',
              fontFamily:SB.mono, fontSize:9.5, color:FAINT,
              letterSpacing:'.12em', textTransform:'uppercase',
              borderBottom:`1px solid ${RULE}`,
            }}>
              <div>Show date</div>
              <div>Kind</div>
              <div>Headliner</div>
              <div>On sale</div>
              <div>Status</div>
              <div/>
            </div>

            {groups.map(({v, items})=>(
              <div key={v.id||'flat'} style={{marginTop:18}}>
                {venue==='all' && (
                  <div style={{
                    display:'flex', alignItems:'baseline', gap:10, padding:'0 12px 8px',
                  }}>
                    <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:INK, letterSpacing:-0.3}}>
                      {v.name}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.04em'}}>
                      {v.nbhd ? v.nbhd.toLowerCase() : ''} · {items.length} upcoming
                    </div>
                    <div style={{flex:1, borderBottom:`1px dashed ${RULE}`, marginBottom:3}}/>
                    <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, letterSpacing:'.04em', cursor:'pointer'}}>
                      venue page →
                    </div>
                  </div>
                )}

                {items.map(a=>{
                  const kc = window.kindInk(a.kind, true);
                  const KIc = KindIcon[a.kind];
                  const isWatched = watched[a.id] || a.watchlisted;
                  const onSale = a.status==='on-sale';
                  return (
                    <div key={a.id}
                      onMouseEnter={()=>setHovId(a.id)}
                      onMouseLeave={()=>setHovId(null)}
                      style={{
                      display:'grid',
                      gridTemplateColumns:'72px 100px 1fr 120px 110px 200px',
                      columnGap:16, padding:'12px 12px', alignItems:'center',
                      borderBottom:`1px solid ${RULE}`,
                      borderLeft:`2px solid ${kc}`,
                      background: isWatched ? SURF2 : (hovId===a.id ? 'rgba(245,245,243,.04)' : 'transparent'),
                      cursor:'pointer', transition:'background .12s',
                    }}>
                      {/* Date */}
                      <div>
                        <div style={{fontFamily:SB.sans, fontSize:15, color:INK, fontWeight:500, letterSpacing:-0.3, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                          {a.showDate.m} {a.showDate.d}
                        </div>
                        <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, marginTop:3, letterSpacing:'.04em'}}>
                          {a.showDate.y} · {a.showDate.dow.toLowerCase()}
                        </div>
                      </div>
                      {/* Kind */}
                      <div style={{
                        display:'inline-flex', alignItems:'center', gap:6,
                        fontFamily:SB.mono, fontSize:10, color:kc,
                        letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                      }}>
                        <KIc size={12} color={kc}/>
                        {HIFI_KINDS[a.kind].label}
                      </div>
                      {/* Headliner */}
                      <div style={{minWidth:0}}>
                        <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:INK, letterSpacing:-0.25, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                          {a.headliner}
                        </div>
                        {a.support && a.support.length>0 && (
                          <div style={{fontFamily:SB.sans, fontSize:11.5, color:MUTED, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                            + {a.support.join(', ')}
                          </div>
                        )}
                        {venue!=='all' && null}
                        {venue==='all' && a.reason!=='followed-venue' && a.reason!=='nearby' && (
                          <div style={{fontFamily:SB.mono, fontSize:9.5, color:FAINT, marginTop:3, letterSpacing:'.06em', textTransform:'uppercase'}}>
                            {reasonLabel(a.reason)}
                          </div>
                        )}
                      </div>
                      {/* On sale */}
                      <div style={{fontFamily:SB.mono, fontSize:11, color: onSale?INK:MUTED, fontWeight: onSale?500:400, letterSpacing:'.02em', fontFeatureSettings:'"tnum"'}}>
                        {a.onSaleDate}
                      </div>
                      {/* Status */}
                      <div>
                        <span style={{
                          fontFamily:SB.mono, fontSize:9.5,
                          color: onSale?BG:INK,
                          background: onSale?kc:'transparent',
                          padding:'3px 7px', border: onSale?'none':`1px solid ${RULE2}`,
                          letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                        }}>{onSale?'on sale':'announced'}</span>
                      </div>
                      {/* Actions */}
                      <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                        <button onClick={()=>setWatched(w=>({...w,[a.id]:!w[a.id]}))} style={{
                          padding:'6px 10px',
                          background: isWatched ? D_ACCENT_D : 'transparent',
                          color: isWatched ? D_ACCENT_TEXT : INK,
                          border: isWatched ? 'none' : `1px solid ${RULE2}`,
                          fontFamily:SB.sans, fontSize:11.5, fontWeight:500,
                          display:'inline-flex', alignItems:'center', gap:5, cursor:'pointer',
                        }}>
                          {isWatched ? <><Icon.Check size={11} color={D_ACCENT_TEXT}/>Watching</> : <><Icon.Eye size={11} color={INK}/>Watch</>}
                        </button>
                        <button style={{
                          padding:'6px 10px', background:'transparent', border:`1px solid ${RULE2}`, color:INK,
                          fontFamily:SB.sans, fontSize:11.5, fontWeight:500,
                          display:'inline-flex', alignItems:'center', gap:5, cursor:'pointer',
                        }}>
                          <Icon.ArrowUpRight size={11} color={INK}/>Tix
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{
              marginTop:22, padding:'12px 14px', background:SURF, border:`1px solid ${RULE}`,
              fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.04em',
              display:'flex', alignItems:'center', justifyContent:'space-between',
            }}>
              <span>past items fall off silently after show date · no dismiss needed</span>
              <span style={{color:FAINT}}>daily digest · 08:00 · email</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mobile ────────────────────────────────────────────────────────────
function DiscoverMobile({initialTab='followed'}) {
  const [tab, setTab] = React.useState(initialTab);
  const [venue, setVenue] = React.useState('all');
  const [watched, setWatched] = React.useState({});
  const M='light';
  const BG=SB.bg[M], SURF=SB.surface[M], SURF2=SB.surface2[M];
  const INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const kInk = (k) => SB.kinds[k].ink;

  const allForTab = HIFI_ANNOUNCEMENTS.filter(a =>
    tab==='followed' ? a.reason!=='nearby' : a.reason==='nearby'
  );
  const rows = venue==='all' ? allForTab : allForTab.filter(a=>a.venueId===venue);

  const venueChips = tab==='followed'
    ? HIFI_FOLLOWED_VENUES.map(v=>({id:v.id, name:v.name, count: allForTab.filter(a=>a.venueId===v.id).length})).filter(v=>v.count>0)
    : Array.from(new Map(allForTab.map(a=>[a.venueId, {id:a.venueId, name:a.venue}])).values())
        .map(v=>({...v, count: allForTab.filter(a=>a.venueId===v.id).length}));

  const tabs = [
    { k:'followed', l:'Followed' },
    { k:'nearby',   l:'Near you' },
  ];

  // Group by venue when 'all'
  const groups = venue==='all'
    ? venueChips.map(v=>({v, items: allForTab.filter(a=>a.venueId===v.id)}))
    : [{v: venueChips.find(v=>v.id===venue)||{name:''}, items: rows}];

  return (
    <div style={{
      height:'100%', background:BG, color:INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      <div style={{padding:'60px 20px 10px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
          <div>
            <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, letterSpacing:-0.9, color:INK}}>
              Discover
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, letterSpacing:'.04em', marginTop:3}}>
              {allForTab.length} upcoming · updated 12m ago
            </div>
          </div>
          <div style={{display:'flex', gap:14}}>
            <Icon.Search size={18} color={INK}/>
            <Icon.More size={18} color={INK}/>
          </div>
        </div>
        <div style={{display:'flex', border:`1px solid ${RULE2}`}}>
          {tabs.map(({k,l},i)=>{
            const active = k===tab;
            return (
              <button key={k} onClick={()=>{setTab(k); setVenue('all');}} style={{
                flex:1, border:'none', cursor:'pointer',
                borderRight: i===tabs.length-1 ? 'none' : `1px solid ${RULE2}`,
                background: active ? INK : 'transparent',
                color: active ? BG : INK,
                padding:'9px 10px', fontFamily:SB.sans, fontSize:13, fontWeight:active?600:500, letterSpacing:-0.1,
              }}>
                {l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Venue chip row */}
      <div style={{
        padding:'8px 14px 10px', display:'flex', gap:6, overflowX:'auto',
        borderBottom:`1px solid ${RULE}`, flexShrink:0,
      }}>
        {[{id:'all', name:'All', count:allForTab.length}, ...venueChips].map(v=>{
          const active = v.id===venue;
          return (
            <button key={v.id} onClick={()=>setVenue(v.id)} style={{
              flexShrink:0, padding:'6px 10px',
              background: active?INK:'transparent',
              color: active?BG:INK,
              border: `1px solid ${active?INK:RULE2}`,
              fontFamily:SB.sans, fontSize:11.5, fontWeight:active?600:500, letterSpacing:-0.1,
              cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5,
              whiteSpace:'nowrap',
            }}>
              {v.name}
              <span style={{fontFamily:SB.mono, fontSize:9.5, color: active?BG:FAINT, opacity:active?.7:1, fontWeight:400}}>{v.count}</span>
            </button>
          );
        })}
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {groups.map(({v, items})=>(
          <div key={v.id||'flat'}>
            {venue==='all' && (
              <div style={{
                padding:'14px 20px 6px', display:'flex', alignItems:'baseline', justifyContent:'space-between',
                borderTop:`1px solid ${RULE}`,
              }}>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:INK, letterSpacing:-0.25}}>
                  {v.name}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, letterSpacing:'.04em'}}>
                  {items.length} upcoming
                </div>
              </div>
            )}
            {items.map(a=>{
              const kc = kInk(a.kind);
              const KIc = KindIcon[a.kind];
              const isWatched = watched[a.id] || a.watchlisted;
              const onSale = a.status==='on-sale';
              return (
                <div key={a.id} style={{
                  padding:'12px 20px',
                  borderTop:`1px solid ${RULE}`,
                  borderLeft:`2px solid ${kc}`,
                  background: isWatched ? SURF : 'transparent',
                  display:'grid', gridTemplateColumns:'54px 1fr auto', columnGap:12, alignItems:'center',
                }}>
                  <div>
                    <div style={{fontFamily:SB.sans, fontSize:18, fontWeight:500, color:INK, letterSpacing:-0.4, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                      {a.showDate.m} {a.showDate.d}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:9, color:FAINT, marginTop:2, letterSpacing:'.04em'}}>
                      {a.showDate.y}
                    </div>
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{
                      display:'inline-flex', alignItems:'center', gap:5,
                      fontFamily:SB.mono, fontSize:9.5, color:kc,
                      letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                    }}>
                      <KIc size={10} color={kc}/>{HIFI_KINDS[a.kind].label}
                    </div>
                    <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:INK, letterSpacing:-0.25, marginTop:2, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {a.headliner}
                    </div>
                    {venue!=='all' ? null : (
                      <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.04em'}}>
                        {a.onSaleDate}
                      </div>
                    )}
                    {venue==='all' ? null : (
                      <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.04em'}}>
                        on sale {a.onSaleDate}
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6}}>
                    <span style={{
                      fontFamily:SB.mono, fontSize:8.5,
                      color: onSale?BG:INK,
                      background: onSale?kc:'transparent',
                      padding:'3px 6px', border: onSale?'none':`1px solid ${RULE2}`,
                      letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                    }}>{onSale?'on sale':'soon'}</span>
                    <button onClick={()=>setWatched(w=>({...w,[a.id]:!w[a.id]}))} style={{
                      padding:'5px 8px',
                      background: isWatched ? D_ACCENT_L : 'transparent',
                      color: isWatched ? D_ACCENT_TEXT : INK,
                      border: isWatched ? 'none' : `1px solid ${RULE2}`,
                      fontFamily:SB.sans, fontSize:11, fontWeight:500,
                      display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer',
                    }}>
                      {isWatched ? <Icon.Check size={10} color={D_ACCENT_TEXT}/> : <Icon.Eye size={10} color={INK}/>}
                      {isWatched ? 'Watching' : 'Watch'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{padding:'14px 20px 18px', fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.04em', textAlign:'center'}}>
          past items fall off silently · daily 8am digest
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex', borderTop:`1px solid ${RULE2}`, background:BG, padding:'12px 4px 30px'}}>
        {[
          { k:'home',    l:'Home',     Ic:Icon.Home },
          { k:'discover',l:'Discover', Ic:Icon.Eye, active:true },
          { k:'shows',   l:'Shows',    Ic:Icon.Archive },
          { k:'add',     l:'Add',      Ic:Icon.Plus, cta:true },
          { k:'map',     l:'Map',      Ic:Icon.Map },
          { k:'me',      l:'Me',       Ic:Icon.User },
        ].map(({k,l,Ic,active,cta})=>(
          <div key={k} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width:cta?32:24, height:cta?32:24,
              background:cta?INK:'transparent', color:cta?BG:(active?INK:MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius:cta?999:0,
            }}>
              <Ic size={cta?18:17}/>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:8.5, letterSpacing:'.04em',
              color:active?INK:MUTED, fontWeight:active?500:400, textTransform:'lowercase'}}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.DiscoverWeb = DiscoverWeb;
window.DiscoverMobile = DiscoverMobile;
