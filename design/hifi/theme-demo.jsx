// Home · Theme Demo — B+C: auto dark/light + deep coral accent
// Shows the Home page in 4 modes to compare the unified palette.

const { SB, Icon, KindIcon, HIFI_KINDS, HIFI_PAST, HIFI_UPCOMING, HIFI_TOTALS } = window;

// ── Deep coral accent ──────────────────────────────────────────────────
const CORAL = {
  base:  '#E5A800',   // warm gold for light mode (slightly muted so it's not harsh on white)
  light: '#FFD166',   // sunray gold — bright, luminous spotlight for dark mode
  faded: 'rgba(255,209,102,.14)', // background wash for active states
};

// ── Theme-aware tokens ─────────────────────────────────────────────────
const t = (mode) => {
  const d = mode==='dark';
  return {
    BG:    d ? '#0C0C0C' : '#FAFAF8',
    SURF:  d ? '#141414' : '#FFFFFF',
    SURF2: d ? '#1C1C1C' : '#F2F1EC',
    INK:   d ? '#F5F5F3' : '#0B0B0A',
    MUTED: d ? 'rgba(245,245,243,.55)' : 'rgba(11,11,10,.55)',
    FAINT: d ? 'rgba(245,245,243,.32)' : 'rgba(11,11,10,.32)',
    RULE:  d ? 'rgba(245,245,243,.10)' : 'rgba(11,11,10,.10)',
    RULE2: d ? 'rgba(245,245,243,.22)' : 'rgba(11,11,10,.22)',
    kInk:  (k) => d ? SB.kinds[k].inkDark : SB.kinds[k].ink,
    accent: d ? CORAL.light : CORAL.base,
    accentBg: CORAL.faded,
    accentText: '#0C0C0C', // always dark text on gold — gold is bright enough in both modes
  };
};

// ── Mobile Home ────────────────────────────────────────────────────────
function HomeMobileThemed({mode='light'}) {
  const T = t(mode);
  const next = HIFI_UPCOMING[0];
  return (
    <div style={{
      height:'100%', background:T.BG, color:T.INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'60px 20px 18px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED, letterSpacing:'.04em'}}>
            mon · 20 apr
          </div>
          <div style={{display:'flex', gap:14}}>
            <Icon.Search size={18} color={T.INK}/>
            <Icon.More size={18} color={T.INK}/>
          </div>
        </div>
        <div style={{marginTop:22, display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.sans, fontSize:28, fontWeight:600, color:T.INK, letterSpacing:-0.9}}>
            showbook
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:T.MUTED, letterSpacing:'.06em'}}>NYC</div>
        </div>
      </div>

      <div style={{flex:1, overflow:'auto'}}>
        {/* NEXT UP hero */}
        <div style={{padding:'4px 20px 6px', display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            Next up
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED}}>
            {next.countdown}
          </div>
        </div>
        <div style={{
          margin:'6px 20px 10px', padding:'18px 18px 16px',
          background:T.SURF, borderLeft:`3px solid ${T.kInk(next.kind)}`,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            {React.createElement(KindIcon[next.kind], {size:12, color:T.kInk(next.kind)})}
            <span style={{fontFamily:SB.mono, fontSize:10.5, color:T.kInk(next.kind), letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
              {HIFI_KINDS[next.kind].label}
            </span>
            <span style={{flex:1}}/>
            <span style={{
              fontFamily:SB.mono, fontSize:10, color:T.accent,
              padding:'2px 7px', border:`1px solid ${T.accent}`, letterSpacing:'.06em', textTransform:'uppercase',
              display:'inline-flex', alignItems:'center', gap:4,
            }}>
              <Icon.Check size={10} color={T.accent}/> tix
            </span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:16, alignItems:'end', marginTop:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, letterSpacing:-0.9, color:T.INK, lineHeight:1}}>
                {next.headliner}
              </div>
              {next.support.length>0 && (
                <div style={{fontFamily:SB.sans, fontSize:13, color:T.MUTED, marginTop:4}}>
                  with {next.support.join(', ')}
                </div>
              )}
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:SB.sans, fontSize:44, fontWeight:500, color:T.INK, letterSpacing:-1.8, lineHeight:.85, fontFeatureSettings:'"tnum"'}}>
                {next.date.d}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:T.kInk(next.kind), letterSpacing:'.08em', marginTop:4, textTransform:'uppercase', fontWeight:500}}>
                {next.date.m} · {next.date.dow}
              </div>
            </div>
          </div>
          <div style={{
            marginTop:14, paddingTop:12, borderTop:`1px solid ${T.RULE}`,
            display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10,
            fontFamily:SB.mono, fontSize:10.5, color:T.MUTED,
          }}>
            {[['Venue', next.venue.toLowerCase()], ['Seat', next.seat.toLowerCase()], ['Doors', '7:00 pm']].map(([l,v])=>(
              <div key={l}>
                <div style={{color:T.FAINT, fontSize:9.5, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:3}}>{l}</div>
                <div style={{color:T.INK}}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* then strip */}
        <div style={{padding:'2px 20px 18px'}}>
          {HIFI_UPCOMING.slice(1, 3).map((u, i) => (
            <div key={u.id} style={{
              padding:'10px 0',
              borderTop: i===0 ? `1px solid ${T.RULE}` : 'none',
              display:'grid', gridTemplateColumns:'46px 1fr auto', columnGap:12, alignItems:'center',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:18, fontWeight:500, color:T.INK, letterSpacing:-0.5, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                  {u.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:T.kInk(u.kind), letterSpacing:'.04em', marginTop:2}}>
                  {u.date.m.toLowerCase()}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:T.INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {u.headliner}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:T.MUTED, marginTop:2}}>
                  {u.venue.toLowerCase()} · {u.countdown}
                </div>
              </div>
              <Icon.ChevronRight size={14} color={T.FAINT}/>
            </div>
          ))}
          <div style={{
            marginTop:8, paddingTop:10, borderTop:`1px solid ${T.RULE}`,
            fontFamily:SB.mono, fontSize:10.5, color:T.accent, letterSpacing:'.04em',
            display:'flex', alignItems:'center', gap:6, cursor:'pointer',
          }}>
            <span>all 4 upcoming</span>
            <Icon.ArrowRight size={11} color={T.accent}/>
          </div>
        </div>

        {/* RECENT 5 */}
        <div style={{
          padding:'14px 20px 10px', borderTop:`1px solid ${T.RULE2}`,
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
            Recent
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.accent, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
            all 87 <Icon.ArrowRight size={11} color={T.accent}/>
          </div>
        </div>
        <div>
          {HIFI_PAST.map((s,i)=>(
            <div key={s.id} style={{
              padding:'14px 20px',
              borderTop: `1px solid ${T.RULE}`,
              display:'grid', gridTemplateColumns:'44px 1fr auto', columnGap:14, alignItems:'start',
            }}>
              <div>
                <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:T.INK, letterSpacing:-0.7, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>
                  {s.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:T.FAINT, marginTop:3, letterSpacing:'.04em'}}>
                  {s.date.m.toLowerCase()}
                </div>
              </div>
              <div style={{minWidth:0}}>
                <div style={{
                  display:'inline-flex', alignItems:'center', gap:5,
                  fontFamily:SB.mono, fontSize:10, fontWeight:500, color:T.kInk(s.kind),
                  letterSpacing:'.04em', textTransform:'lowercase',
                }}>
                  {React.createElement(KindIcon[s.kind], {size:11, color:T.kInk(s.kind)})}
                  {HIFI_KINDS[s.kind].label}
                </div>
                <div style={{fontFamily:SB.sans, fontSize:15, fontWeight:600, color:T.INK, letterSpacing:-0.3, marginTop:3, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {s.headliner}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED, marginTop:5}}>
                  {s.venue.toLowerCase()}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:SB.mono, fontSize:11, color:T.INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>${s.paid}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{
          padding:'22px 20px 16px', textAlign:'center',
          fontFamily:SB.mono, fontSize:10, color:T.FAINT, letterSpacing:'.14em',
        }}>— 82 MORE IN SHOWS —</div>
      </div>

      {/* Tab bar — coral on active + CTA */}
      <div style={{
        display:'flex', borderTop:`1px solid ${T.RULE2}`, background:T.BG,
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
              background: cta?T.accent:'transparent',
              color: cta?T.accentText:(active?T.accent:T.MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius: cta?999:0,
            }}>
              <Ic size={cta?20:18}/>
            </div>
            <div style={{
              fontFamily:SB.mono, fontSize:9.5, letterSpacing:'.04em',
              color: active?T.accent:T.MUTED, fontWeight: active?500:400, textTransform:'lowercase',
            }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Web Home ───────────────────────────────────────────────────────────
function HomeWebThemed({mode='dark'}) {
  const T = t(mode);
  const next = HIFI_UPCOMING[0];
  const then = HIFI_UPCOMING.slice(1, 4);

  // Sidebar
  const SidebarThemed = () => {
    const items = [
      { key:'home',     label:'Home',     Ic:Icon.Home, active:true },
      { key:'discover', label:'Discover', Ic:Icon.Eye,    count:'10' },
      { key:'shows',    label:'Shows',    Ic:Icon.Archive, count:'94' },
      { key:'map',      label:'Map',      Ic:Icon.Map },
      { key:'artists',  label:'Artists',  Ic:Icon.Music,   count:'22' },
    ];
    return (
      <div style={{
        width:220, background:T.BG, borderRight:`1px solid ${T.RULE}`,
        display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
      }}>
        <div style={{padding:'0 20px 22px'}}>
          <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:T.INK, letterSpacing:-0.5}}>
            showbook
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:T.MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
            v2 · 2026.04
          </div>
        </div>

        <div style={{padding:'0 16px 18px'}}>
          <button style={{
            width:'100%', padding:'10px 12px', background:T.accent, color:T.accentText,
            border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
            display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
          }}>
            <Icon.Plus size={15} color={T.accentText}/> Add a show
          </button>
          <div style={{
            marginTop:8, padding:'7px 10px', background:T.SURF, border:`1px solid ${T.RULE}`,
            display:'flex', alignItems:'center', gap:8,
            fontFamily:SB.mono, fontSize:11, color:T.MUTED,
          }}>
            <Icon.Search size={13} color={T.MUTED}/>
            <span>search…</span>
            <span style={{flex:1}}/>
            <span style={{padding:'1px 6px', fontSize:9.5, border:`1px solid ${T.RULE2}`, color:T.MUTED}}>⌘K</span>
          </div>
        </div>

        <div style={{padding:'0 8px', flex:1}}>
          <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:T.FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
            Navigate
          </div>
          {items.map(({key, label, Ic, count, active})=>(
            <div key={key} style={{
              display:'flex', alignItems:'center', gap:10, padding:'8px 12px', margin:'1px 0',
              background: active ? T.accentBg : 'transparent',
              color: active ? T.INK : T.MUTED,
              fontFamily:SB.sans, fontSize:13.5, fontWeight: active ? 500 : 400,
              cursor:'pointer',
              borderLeft: active ? `2px solid ${T.accent}` : '2px solid transparent',
            }}>
              <Ic size={15} color={active ? T.accent : T.MUTED}/>
              <span style={{flex:1}}>{label}</span>
              {count && <span style={{fontFamily:SB.mono, fontSize:11, color:T.FAINT}}>{count}</span>}
            </div>
          ))}
        </div>

        <div style={{
          padding:'14px 16px', borderTop:`1px solid ${T.RULE}`,
          display:'flex', alignItems:'center', gap:10,
        }}>
          <div style={{
            width:28, height:28, borderRadius:999, background:T.accent, color:T.accentText,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:SB.mono, fontSize:12, fontWeight:500,
          }}>m</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontFamily:SB.sans, fontSize:13, color:T.INK, fontWeight:500}}>m</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:T.FAINT, marginTop:1}}>synced 3m ago</div>
          </div>
          <Icon.More size={14} color={T.MUTED}/>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      width:'100%', height:'100%', background:T.BG, color:T.INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <SidebarThemed/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar */}
        <div style={{
          padding:'16px 36px', display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${T.RULE}`,
        }}>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
              Mon · 20 apr · 2026
            </div>
            <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:600, color:T.INK, letterSpacing:-0.6, marginTop:3}}>
              Good evening
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
                  <div style={{fontFamily:SB.sans, fontSize:22, fontWeight:500, color:T.INK, letterSpacing:-0.6, lineHeight:1, fontFeatureSettings:'"tnum"'}}>{v}</div>
                  <div style={{fontFamily:SB.mono, fontSize:10, color:T.FAINT, letterSpacing:'.04em'}}>{sub}</div>
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:T.MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:4}}>{l}</div>
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
          {/* NEXT UP */}
          <section>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:12}}>
              <div style={{fontFamily:SB.mono, fontSize:11, color:T.INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                Next up
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.FAINT}}>
                {next.countdown} · doors 7:00 pm
              </div>
              <div style={{flex:1}}/>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.accent, letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                see all 4 upcoming <Icon.ArrowRight size={11} color={T.accent}/>
              </div>
            </div>

            <div style={{
              padding:'28px 32px', background:T.SURF, borderLeft:`3px solid ${T.kInk(next.kind)}`,
              display:'grid', gridTemplateColumns:'1fr auto', gap:32, alignItems:'center',
            }}>
              <div style={{minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:14}}>
                  <span style={{display:'inline-flex', alignItems:'center', gap:7,
                    fontFamily:SB.mono, fontSize:10.5, color:T.kInk(next.kind),
                    letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                    {React.createElement(KindIcon[next.kind], {size:13, color:T.kInk(next.kind)})}
                    {HIFI_KINDS[next.kind].label}
                  </span>
                  <span style={{
                    fontFamily:SB.mono, fontSize:10.5, color:T.accent,
                    padding:'3px 8px', border:`1px solid ${T.accent}`,
                    letterSpacing:'.06em', textTransform:'uppercase',
                    display:'inline-flex', alignItems:'center', gap:5,
                  }}>
                    <Icon.Check size={11} color={T.accent}/> Ticketed
                  </span>
                </div>
                <div style={{fontFamily:SB.sans, fontSize:52, fontWeight:600, letterSpacing:-2, color:T.INK, lineHeight:.95}}>
                  {next.headliner}
                </div>
                {next.support.length>0 && (
                  <div style={{fontFamily:SB.sans, fontSize:16, color:T.MUTED, marginTop:8, letterSpacing:-0.2}}>
                    with {next.support.join(', ')}
                  </div>
                )}
                <div style={{
                  display:'flex', gap:32, marginTop:22,
                  fontFamily:SB.sans, fontSize:13, color:T.INK,
                }}>
                  {[
                    [Icon.MapPin, next.venue, next.city],
                    [Icon.Ticket, next.seat, `$${next.paid} · paid`],
                    [Icon.Clock,  'doors 7:00 pm', 'show 8:00 pm'],
                  ].map(([Ic, a, b], i)=>(
                    <div key={i} style={{display:'flex', alignItems:'flex-start', gap:8}}>
                      <Ic size={14} color={T.MUTED}/>
                      <div>
                        <div>{a}</div>
                        <div style={{fontFamily:SB.mono, fontSize:11, color:T.MUTED, marginTop:2}}>{b}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{
                textAlign:'center', paddingLeft:32, borderLeft:`1px solid ${T.RULE}`, minWidth:180,
              }}>
                <div style={{fontFamily:SB.mono, fontSize:11, color:T.kInk(next.kind), letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500}}>
                  {next.date.dow}
                </div>
                <div style={{fontFamily:SB.sans, fontSize:120, fontWeight:500, color:T.INK, letterSpacing:-5, lineHeight:.85, fontFeatureSettings:'"tnum"', marginTop:4}}>
                  {next.date.d}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:12, color:T.INK, letterSpacing:'.14em', marginTop:4, textTransform:'uppercase', fontWeight:500}}>
                  {next.date.m}
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED, marginTop:10, letterSpacing:'.06em'}}>
                  {next.countdown}
                </div>
              </div>
            </div>

            {/* then · 3 tiny cards */}
            <div style={{
              display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:1, marginTop:1, background:T.RULE,
            }}>
              {then.map(u=>(
                <div key={u.id} style={{
                  padding:'14px 18px', background:T.SURF,
                  borderLeft:`2px solid ${T.kInk(u.kind)}`,
                }}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                    <span style={{display:'inline-flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10, color:T.kInk(u.kind), letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                      {React.createElement(KindIcon[u.kind], {size:11, color:T.kInk(u.kind)})}
                      {HIFI_KINDS[u.kind].label}
                    </span>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:u.hasTix?T.accent:T.MUTED, letterSpacing:'.04em', display:'inline-flex', alignItems:'center', gap:4}}>
                      {u.hasTix ? <><Icon.SquareFilled size={8} color={T.accent}/>tix</> : <><Icon.Eye size={10} color={T.MUTED}/>watching</>}
                    </span>
                  </div>
                  <div style={{fontFamily:SB.sans, fontSize:16, fontWeight:600, letterSpacing:-0.35, color:T.INK, lineHeight:1.15, marginTop:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {u.headliner}
                  </div>
                  <div style={{fontFamily:SB.sans, fontSize:12, color:T.MUTED, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {u.venue}
                  </div>
                  <div style={{
                    marginTop:10, display:'flex', alignItems:'baseline', justifyContent:'space-between',
                  }}>
                    <span style={{fontFamily:SB.mono, fontSize:11, color:T.INK, fontWeight:500}}>
                      {u.date.m} {u.date.d}
                    </span>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:T.FAINT}}>{u.countdown}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* RECENT 5 */}
          <section>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:12}}>
              <div style={{fontFamily:SB.mono, fontSize:11, color:T.INK, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
                Recent
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.FAINT}}>
                last 5 · of 87
              </div>
              <div style={{flex:1}}/>
              <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.accent, letterSpacing:'.04em', display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                open in Shows <Icon.ArrowRight size={11} color={T.accent}/>
              </div>
            </div>

            <div style={{background:T.SURF}}>
              <div style={{
                display:'grid', gridTemplateColumns:'72px 110px 1fr 1fr 110px 64px 28px', columnGap:16,
                padding:'10px 20px', borderBottom:`1px solid ${T.RULE}`,
                fontFamily:SB.mono, fontSize:9.5, color:T.FAINT,
                letterSpacing:'.12em', textTransform:'uppercase',
              }}>
                <div>Date</div><div>Kind</div><div>Headline</div><div>Venue</div><div>Seat</div>
                <div style={{textAlign:'right'}}>Paid</div><div/>
              </div>
              {HIFI_PAST.map((s,i)=>(
                <div key={s.id} style={{
                  display:'grid', gridTemplateColumns:'72px 110px 1fr 1fr 110px 64px 28px', columnGap:16,
                  padding:'14px 20px', borderBottom:`1px solid ${T.RULE}`, alignItems:'center',
                }}>
                  <div>
                    <div style={{fontFamily:SB.sans, fontSize:17, color:T.INK, fontWeight:500, letterSpacing:-0.5, lineHeight:1, fontFeatureSettings:'"tnum"'}}>
                      {s.date.m} {s.date.d}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:10, color:T.FAINT, marginTop:3}}>
                      {s.date.y} · {s.date.dow.toLowerCase()}
                    </div>
                  </div>
                  <div style={{
                    display:'inline-flex', alignItems:'center', gap:7,
                    fontFamily:SB.mono, fontSize:10.5, color:T.kInk(s.kind),
                    letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
                  }}>
                    {React.createElement(KindIcon[s.kind], {size:12, color:T.kInk(s.kind)})}
                    {HIFI_KINDS[s.kind].label}
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:T.INK, letterSpacing:-0.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {s.headliner}
                    </div>
                    {s.support.length>0 && (
                      <div style={{fontFamily:SB.sans, fontSize:11.5, color:T.MUTED, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                        + {s.support.join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:SB.sans, fontSize:13, color:T.INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {s.venue}
                    </div>
                    <div style={{fontFamily:SB.mono, fontSize:10.5, color:T.MUTED, marginTop:2}}>
                      {s.neighborhood.toLowerCase()}
                    </div>
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:11, color:T.MUTED}}>
                    {s.seat}
                  </div>
                  <div style={{textAlign:'right', fontFamily:SB.mono, fontSize:12, color:T.INK, fontWeight:500, fontFeatureSettings:'"tnum"'}}>
                    ${s.paid}
                  </div>
                  <Icon.ChevronRight size={14} color={T.FAINT}/>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

window.HomeMobileThemed = HomeMobileThemed;
window.HomeWebThemed = HomeWebThemed;
