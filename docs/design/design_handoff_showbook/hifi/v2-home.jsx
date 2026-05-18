// v2 · Home · SLIM
// Home does ONLY what Home can do:
//   (a) Next up — one hero card with ticket/doors/seat
//   (b) Recent 5 — compact ledger preview with a single "see all" link into Shows
// Everything else (rhythm, map, most-seen, year filter) lives on its real page.

const { SB, Icon, HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_TOTALS, V2Sidebar } = window;

// ── Mobile ─────────────────────────────────────────────────────────────
const HM_MODE='light';
const HM_BG=SB.bg[HM_MODE], HM_SURF=SB.surface[HM_MODE];
const HM_INK=SB.ink[HM_MODE], HM_MUTED=SB.muted[HM_MODE], HM_FAINT=SB.faint[HM_MODE];
const HM_RULE=SB.rule[HM_MODE], HM_RULE2=SB.ruleStrong[HM_MODE];
const hmKind = (k) => SB.kinds[k].ink;

function HomeV2Mobile() {
  const next = HIFI_UPCOMING[0];
  return (
    <div style={{
      height:'100%', background:HM_BG, color:HM_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'60px 20px 18px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED, letterSpacing:'.04em'}}>
            mon · 20 apr
          </div>
          <div style={{display:'flex', gap:14}}>
            <Icon.Search size={18} color={HM_INK}/>
            <Icon.More size={18} color={HM_INK}/>
          </div>
        </div>
        <div style={{marginTop:22, display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.sans, fontSize:28, fontWeight:600, color:HM_INK, letterSpacing:-0.9}}>
            showbook<span style={{color:HM_FAINT, fontWeight:400}}>/m</span>
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:HM_MUTED, letterSpacing:'.06em'}}>NYC</div>
        </div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {/* NEXT UP hero */}
        <div style={{padding:'4px 20px 6px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            Next up
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED}}>
            {next.countdown}
          </div>
        </div>
        <div style={{
          margin:'6px 20px 10px', padding:'18px 18px 16px',
          background:HM_SURF, borderLeft:`3px solid ${hmKind(next.kind)}`,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <span style={{width:6, height:6, borderRadius:999, background:hmKind(next.kind)}}/>
            <span style={{fontFamily:SB.mono, fontSize:10.5, color:hmKind(next.kind), letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              {HIFI_KINDS[next.kind].label}
            </span>
            <span style={{flex:1}}/>
            <span style={{
              fontFamily:SB.mono, fontSize:10, color:HM_INK,
              padding:'2px 7px', border:`1px solid ${HM_RULE2}`, letterSpacing:'.06em', textTransform:'uppercase',
              display:'inline-flex', alignItems:'center', gap:4,
            }}>
              <Icon.Check size={10} color={HM_INK}/> tix
            </span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:16, alignItems:'end', marginTop:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, letterSpacing:-0.9, color:HM_INK, lineHeight:1}}>
                {next.headliner}
              </div>
              {next.support.length>0 && (
                <div style={{fontFamily:SB.sans, fontSize:13, color:HM_MUTED, marginTop:4}}>
                  with {next.support.join(', ')}
                </div>
              )}
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:SB.sans, fontSize:44, fontWeight:500, color:HM_INK, letterSpacing:-1.8, lineHeight:.85, fontFeatureSettings:'"tnum"'}}>
                {next.date.d}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:hmKind(next.kind), letterSpacing:'.08em', marginTop:4, textTransform:'uppercase', fontWeight:500}}>
                {next.date.m} · {next.date.dow}
              </div>
            </div>
          </div>
          <div style={{
            marginTop:14, paddingTop:12, borderTop:`1px solid ${HM_RULE}`,
            display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10,
            fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED,
          }}>
            <div>
              <div style={{color:HM_FAINT, fontSize:9.5, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:3}}>Venue</div>
              <div style={{color:HM_INK}}>{next.venue.toLowerCase()}</div>
            </div>
            <div>
              <div style={{color:HM_FAINT, fontSize:9.5, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:3}}>Seat</div>
              <div style={{color:HM_INK}}>{next.seat.toLowerCase()}</div>
            </div>
            <div>
              <div style={{color:HM_FAINT, fontSize:9.5, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:3}}>Doors</div>
              <div style={{color:HM_INK}}>7:00 pm</div>
            </div>
          </div>
        </div>

        {/* Quiet "then" strip — 2 more upcoming at a glance */}
        <div style={{padding:'2px 20px 18px'}}>
          {HIFI_UPCOMING.slice(1, 3).map((u, i) => (
            <div key={u.id} style={{
              padding:'10px 0',
              borderTop: i===0 ? `1px solid ${HM_RULE}` : 'none',
              display:'grid', gridTemplateColumns:'46px 1fr auto', columnGap:12, alignItems:'center',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:18, fontWeight:500, color:HM_INK, letterSpacing:-0.5, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                  {u.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:hmKind(u.kind), letterSpacing:'.04em', marginTop:2}}>
                  {u.date.m.toLowerCase()}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:HM_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {u.headliner}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:HM_MUTED, marginTop:2}}>
                  {u.venue.toLowerCase()} · {u.countdown}
                </div>
              </div>
              <Icon.ChevronRight size={14} color={HM_FAINT}/>
            </div>
          ))}
          <div style={{
            marginTop:8, paddingTop:10, borderTop:`1px solid ${HM_RULE}`,
            fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED, letterSpacing:'.04em',
            display:'flex', alignItems:'center', gap:6, cursor:'pointer',
          }}>
            <span>all 4 upcoming</span>
            <Icon.ArrowRight size={11} color={HM_MUTED}/>
          </div>
        </div>

        {/* RECENT 5 */}
        <div style={{
          padding:'14px 20px 10px', borderTop:`1px solid ${HM_RULE2}`,
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            Recent
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
            all 87 <Icon.ArrowRight size={11} color={HM_MUTED}/>
          </div>
        </div>
        <div>
          {HIFI_PAST.map((s,i)=>(
            <div key={s.id} style={{
              padding:'14px 20px',
              borderTop: `1px solid ${HM_RULE}`,
              display:'grid', gridTemplateColumns:'44px 1fr auto', columnGap:14, alignItems:'start',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:HM_INK, letterSpacing:-0.7, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>
                  {s.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:HM_FAINT, marginTop:3, letterSpacing:'.04em'}}>
                  {s.date.m.toLowerCase()}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:5,
                  fontFamily:SB.mono, fontSize:10, fontWeight:500, color:hmKind(s.kind),
                  letterSpacing:'.04em', textTransform:'lowercase',
                }}>
                  <span style={{width:5, height:5, borderRadius:999, background:hmKind(s.kind)}}/>
                  {HIFI_KINDS[s.kind].label}
                </div>
                <div style={{fontFamily:SB.sans, fontSize:15, fontWeight:600, color:HM_INK, letterSpacing:-0.3, marginTop:3, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {s.headliner}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:HM_MUTED, marginTop:5}}>
                  {s.venue.toLowerCase()}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:SB.mono, fontSize:11, color:HM_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>${s.paid}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{
          padding:'22px 20px 16px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:HM_FAINT, letterSpacing:'.14em',
        }}>— 82 MORE IN SHOWS —</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', borderTop:`1px solid ${HM_RULE2}`, background:HM_BG,
        padding:'12px 8px 30px',
      }}>
        {[
          { k:'home',    l:'Home',    Ic:Icon.Home,    active:true },
          { k:'shows',   l:'Shows',   Ic:Icon.Archive },
          { k:'add',     l:'Add',     Ic:Icon.Plus,    cta:true },
          { k:'map',     l:'Map',     Ic:Icon.Map },
          { k:'me',      l:'Me',      Ic:Icon.User },
        ].map(({k, l, Ic, active, cta})=>(
          <div key={k} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width: cta?34:26, height: cta?34:26,
              background: cta?HM_INK:'transparent',
              color: cta?HM_BG:(active?HM_INK:HM_MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta?999:0,
            }}>
              <Ic size={cta?20:18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active?HM_INK:HM_MUTED, fontWeight: active?500:400, textTransform:'lowercase',
            }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Web ────────────────────────────────────────────────────────────────
const HW_MODE='dark';
const HW_BG=SB.bg[HW_MODE], HW_SURF=SB.surface[HW_MODE], HW_SURF2=SB.surface2[HW_MODE];
const HW_INK=SB.ink[HW_MODE], HW_MUTED=SB.muted[HW_MODE], HW_FAINT=SB.faint[HW_MODE];
const HW_RULE=SB.rule[HW_MODE], HW_RULE2=SB.ruleStrong[HW_MODE];
const hwKind = (k) => window.kindInk(k, true);

function HomeV2Web() {
  const next = HIFI_UPCOMING[0];
  const then = HIFI_UPCOMING.slice(1, 4);
  return (
    <div style={{
      width:'100%', height:'100%', background:HW_BG, color:HW_INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <V2Sidebar active="home"/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar — minimal: greeting + 4 totals, no filter */}
        <div style={{
          padding:'16px 36px', display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${HW_RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              Mon · 20 apr · 2026
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:HW_INK, letterSpacing:-0.6, marginTop:3}}>
              Good evening, m
            </div>
          </div>
          <div style={{display:'flex', gap:28, alignItems:'center'}}>
            {[
              ['Shows',   HIFI_TOTALS.shows,   'this year'],
              ['Spent',   HIFI_TOTALS.spent,   '~$92/show'],
              ['Venues',  HIFI_TOTALS.venues,  'NYC'],
              ['Artists', HIFI_TOTALS.artists, '+ 3 new'],
            ].map(([l,v,sub])=>(
              <div key={l} style={{display:'flex', flexDirection:'column'}}>
                <div style={{display:'flex', alignItems:'baseline', gap:6}}>
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:HW_INK, letterSpacing:-0.6, lineHeight:1, fontFeatureSettings:'"tnum"'}}>{v}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:HW_FAINT, letterSpacing:'.04em'}}>{sub}</div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:HW_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:4}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div style={{
          flex:1, minHeight:0, overflow:'auto',
          padding:'28px 36px 40px',
          display:'grid', gridTemplateColumns:'1fr', gap:28,
        }}>
          {/* Block 1 — NEXT UP. Centered, editorial, one card. */}
          <section>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:12}}>
              <div style={{fontFamily:SB.mono, fontSize:11, color:HW_INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                Next up
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_FAINT}}>
                {next.countdown} · doors 7:00 pm
              </div>
              <div style={{flex:1}}/>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_MUTED, letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                see all 4 upcoming <Icon.ArrowRight size={11} color={HW_MUTED}/>
              </div>
            </div>

            <div style={{
              padding:'28px 32px', background:HW_SURF, borderLeft:`3px solid ${hwKind(next.kind)}`,
              display:'grid', gridTemplateColumns:'1fr auto', gap:32, alignItems:'center',
            }}>
              <div style={{minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:14}}>
                  <span style={{display:'inline-flex', alignItems:'center', gap:6,
                    fontFamily:SB.mono, fontSize:10.5, color:hwKind(next.kind),
                    letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                    <Icon.Dot size={9} color={hwKind(next.kind)}/>
                    {HIFI_KINDS[next.kind].label}
                  </span>
                  <span style={{
                    fontFamily:SB.mono, fontSize:10.5, color:HW_INK,
                    padding:'3px 8px', border:`1px solid ${HW_RULE2}`,
                    letterSpacing:'.06em', textTransform:'uppercase',
                    display:'inline-flex', alignItems:'center', gap:5,
                  }}>
                    <Icon.Check size={11} color={HW_INK}/> Ticketed
                  </span>
                </div>
                <div style={{fontFamily:SB.sans, fontSize:52, fontWeight:600, letterSpacing:-2, color:HW_INK, lineHeight:.95}}>
                  {next.headliner}
                </div>
                {next.support.length>0 && (
                  <div style={{fontFamily:SB.sans, fontSize:16, color:HW_MUTED, marginTop:8, letterSpacing:-0.2}}>
                    with {next.support.join(', ')}
                  </div>
                )}
                <div style={{
                  display:'flex', gap:32, marginTop:22,
                  fontFamily:SB.sans, fontSize:13, color:HW_INK,
                }}>
                  {[
                    [Icon.MapPin, next.venue, next.city],
                    [Icon.Ticket, next.seat, `$${next.paid} · paid`],
                    [Icon.Clock,  'doors 7:00 pm', 'show 8:00 pm'],
                  ].map(([Ic, a, b], i)=>(
                    <div key={i} style={{display:'flex', alignItems:'flex-start', gap:8}}>
                      <Ic size={14} color={HW_MUTED}/>
                      <div>
                        <div>{a}</div>
                        <div style={{fontFamily:SB.mono, fontSize:11, color:HW_MUTED, marginTop:2}}>{b}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{
                textAlign:'center', paddingLeft:32, borderLeft:`1px solid ${HW_RULE}`, minWidth:180,
              }}>
                <div style={{fontFamily:SB.mono, fontSize:11, color:hwKind(next.kind), letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500}}>
                  {next.date.dow}
                </div>
                <div style={{fontFamily:SB.sans, fontSize:120, fontWeight:500, color:HW_INK, letterSpacing:-5, lineHeight:.85, fontFeatureSettings:'"tnum"', marginTop:4}}>
                  {next.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:12, color:HW_INK, letterSpacing:'.14em', marginTop:4, textTransform:'uppercase', fontWeight:500}}>
                  {next.date.m}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_MUTED, marginTop:10, letterSpacing:'.06em'}}>
                  {next.countdown}
                </div>
              </div>
            </div>

            {/* then · 3 tiny cards */}
            <div style={{
              display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:1, marginTop:1, background:HW_RULE,
            }}>
              {then.map(u=>(
                <div key={u.id} style={{
                  padding:'14px 18px', background:HW_SURF,
                  borderLeft:`2px solid ${hwKind(u.kind)}`,
                }}>
                  <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:hwKind(u.kind), letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                      {HIFI_KINDS[u.kind].label}
                    </span>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:u.hasTix?HW_INK:HW_MUTED, letterSpacing:'.04em', display:'inline-flex', alignItems:'center', gap:4}}>
                      {u.hasTix ? <><Icon.SquareFilled size={8} color={HW_INK}/>tix</> : <><Icon.Eye size={10} color={HW_MUTED}/>watching</>}
                    </span>
                  </div>
                  <div style={{fontFamily:SB.sans, fontSize:16, fontWeight:600, letterSpacing:-0.35, color:HW_INK, lineHeight:1.15, marginTop:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {u.headliner}
                  </div>
                  <div style={{fontFamily:SB.sans, fontSize:12, color:HW_MUTED, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {u.venue}
                  </div>
                  <div style={{
                    marginTop:10, display:'flex', alignItems:'baseline', justifyContent:'space-between',
                  }}>
                    <span style={{fontFamily:SB.mono, fontSize:11, color:HW_INK, fontWeight:500}}>
                      {u.date.m} {u.date.d}
                    </span>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:HW_FAINT}}>{u.countdown}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Block 2 — RECENT 5. Just a compact ledger preview. */}
          <section>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:12}}>
              <div style={{fontFamily:SB.mono, fontSize:11, color:HW_INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                Recent
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_FAINT}}>
                last 5 · of 87
              </div>
              <div style={{flex:1}}/>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_MUTED, letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                open in Shows <Icon.ArrowRight size={11} color={HW_MUTED}/>
              </div>
            </div>

            <div style={{background:HW_SURF}}>
              {/* column heads */}
              <div style={{
                display:'grid', gridTemplateColumns:'72px 110px 1fr 1fr 110px 64px 28px', columnGap:16,
                padding:'10px 20px', borderBottom:`1px solid ${HW_RULE}`,
                fontFamily:SB.mono, fontSize:9.5, color:HW_FAINT,
                letterSpacing:'.12em', textTransform:'uppercase',
              }}>
                <div>Date</div><div>Kind</div><div>Headline</div><div>Venue</div><div>Seat</div>
                <div style={{textAlign:'right'}}>Paid</div><div/>
              </div>
              {HIFI_PAST.map((s,i)=>(
                <div key={s.id} style={{
                  display:'grid', gridTemplateColumns:'72px 110px 1fr 1fr 110px 64px 28px', columnGap:16,
                  padding:'14px 20px', borderBottom:`1px solid ${HW_RULE}`, alignItems:'center',
                }}>
                  <div>
                    <div style={{fontFamily:SB.sans, fontSize:17, color:HW_INK, fontWeight:500, letterSpacing:-0.5, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                      {s.date.m} {s.date.d}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:10, color:HW_FAINT, marginTop:3}}>
                      {s.date.y} · {s.date.dow.toLowerCase()}
                    </div>
                  </div>
                  <div style={{
                    display:'inline-flex', alignItems:'center', gap:6,
                    fontFamily:SB.mono, fontSize:10.5, color:hwKind(s.kind),
                    letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                  }}>
                    <span style={{width:6, height:6, borderRadius:999, background:hwKind(s.kind)}}/>
                    {HIFI_KINDS[s.kind].label}
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:HW_INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {s.headliner}
                    </div>
                    {s.support.length>0 && (
                      <div style={{fontFamily:SB.sans, fontSize:11.5, color:HW_MUTED, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                        + {s.support.join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:SB.sans, fontSize:13, color:HW_INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {s.venue}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:HW_MUTED, marginTop:2}}>
                      {s.neighborhood.toLowerCase()}
                    </div>
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:11, color:HW_MUTED}}>
                    {s.seat}
                  </div>
                  <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color:HW_INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                    ${s.paid}
                  </div>
                  <Icon.ChevronRight size={14} color={HW_FAINT}/>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

window.HomeV2Mobile = HomeV2Mobile;
window.HomeV2Web = HomeV2Web;
