// Preferences · Settings page — web (dark) + mobile (light)
// Sections: Account, Notifications, Regions, Appearance, Data Sources

const { SB, Icon, KindIcon, HIFI_KINDS, V2Sidebar } = window;
const ACCENT_D = SB.accent.dark, ACCENT_L = SB.accent.light, ACCENT_TEXT = SB.accent.text;

// ── Shared toggle component ────────────────────────────────────────────
function Toggle({on, accent}) {
  return (
    <div style={{
      width:36, height:20, borderRadius:10, padding:2,
      background: on ? accent : 'rgba(128,128,128,.3)',
      cursor:'pointer', transition:'background .15s',
      display:'flex', alignItems: 'center',
      justifyContent: on ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        width:16, height:16, borderRadius:8,
        background: on ? ACCENT_TEXT : 'rgba(255,255,255,.7)',
        transition:'all .15s',
      }}/>
    </div>
  );
}

// ── Shared radio pill ──────────────────────────────────────────────────
function RadioPill({options, value, accent, bg, ink, rule}) {
  return (
    <div style={{display:'flex', border:`1px solid ${rule}`}}>
      {options.map((o,i) => {
        const active = o.k===value;
        return (
          <div key={o.k} style={{
            padding:'8px 16px',
            background: active ? accent : 'transparent',
            color: active ? ACCENT_TEXT : ink,
            fontFamily:SB.sans, fontSize:13, fontWeight: active?600:500,
            borderRight: i<options.length-1 ? `1px solid ${rule}` : 'none',
            cursor:'pointer', letterSpacing:-0.1,
          }}>{o.l}</div>
        );
      })}
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────
function SHead({label, sub, ink, faint}) {
  return (
    <div style={{marginBottom:18}}>
      <div style={{fontFamily:SB.mono, fontSize:11, color:ink, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500}}>
        {label}
      </div>
      {sub && <div style={{fontFamily:SB.mono, fontSize:10.5, color:faint, marginTop:3, letterSpacing:'.04em'}}>{sub}</div>}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function PrefRow({label, sub, children, ink, muted, rule, last}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'14px 0', borderBottom: last ? 'none' : `1px solid ${rule}`,
      gap:16,
    }}>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:500, color:ink, letterSpacing:-0.15}}>{label}</div>
        {sub && <div style={{fontFamily:SB.mono, fontSize:10.5, color:muted, marginTop:3, letterSpacing:'.04em'}}>{sub}</div>}
      </div>
      <div style={{flexShrink:0}}>{children}</div>
    </div>
  );
}

// ── Region chip ────────────────────────────────────────────────────────
function RegionChip({name, radius, active, accent, ink, rule, faint}) {
  return (
    <div style={{
      padding:'10px 14px',
      border: active ? `1.5px solid ${accent}` : `1px solid ${rule}`,
      background: active ? (accent+'18') : 'transparent',
      display:'flex', alignItems:'center', gap:10, cursor:'pointer',
    }}>
      <Icon.MapPin size={14} color={active ? accent : faint}/>
      <div style={{flex:1}}>
        <div style={{fontFamily:SB.sans, fontSize:13, fontWeight:active?600:500, color:ink, letterSpacing:-0.1}}>{name}</div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:faint, marginTop:2}}>{radius}mi radius</div>
      </div>
      {active && <Icon.Check size={14} color={accent}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WEB — dark mode
// ═══════════════════════════════════════════════════════════════════════
function PrefsWeb() {
  const M='dark';
  const BG=SB.bg[M], SURF=SB.surface[M], SURF2=SB.surface2[M];
  const INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const A=ACCENT_D;

  return (
    <div style={{
      width:'100%', height:'100%', background:BG, color:INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased', overflow:'hidden',
    }}>
      <V2Sidebar active="settings"/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Header */}
        <div style={{
          padding:'16px 36px', borderBottom:`1px solid ${RULE}`,
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.1em', textTransform:'uppercase'}}>
            Settings
          </div>
          <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:INK, letterSpacing:-0.9, marginTop:4}}>
            Preferences
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1, overflow:'auto', padding:'28px 36px 60px'}}>
          <div style={{maxWidth:720}}>

            {/* ── Account ─────────────────────────── */}
            <SHead label="Account" sub="your login" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'4px 20px 4px', marginBottom:36}}>
              <PrefRow label="Email" sub="for digests and account recovery" ink={INK} muted={MUTED} rule={RULE} last>
                <div style={{fontFamily:SB.mono, fontSize:12, color:MUTED}}>m@showbook.app</div>
              </PrefRow>
            </div>

            {/* ── Appearance ──────────────────────── */}
            <SHead label="Appearance" sub="theme and display" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'4px 20px 4px', marginBottom:36}}>
              <PrefRow label="Theme" sub="applies to all pages" ink={INK} muted={MUTED} rule={RULE}>
                <RadioPill
                  options={[{k:'system', l:'System'}, {k:'light', l:'Light'}, {k:'dark', l:'Dark'}]}
                  value="dark" accent={A} bg={BG} ink={INK} rule={RULE2}
                />
              </PrefRow>
              <PrefRow label="Compact mode" sub="denser rows in list views" ink={INK} muted={MUTED} rule={RULE} last>
                <Toggle on={false} accent={A}/>
              </PrefRow>
            </div>

            {/* ── Notifications ───────────────────── */}
            <SHead label="Notifications" sub="how and when we reach you" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'4px 20px 4px', marginBottom:36}}>
              <PrefRow label="Discover digest" sub="summary of new announcements from followed venues" ink={INK} muted={MUTED} rule={RULE}>
                <RadioPill
                  options={[{k:'daily', l:'Daily'}, {k:'weekly', l:'Weekly'}, {k:'off', l:'Off'}]}
                  value="daily" accent={A} bg={BG} ink={INK} rule={RULE2}
                />
              </PrefRow>
              <PrefRow label="Digest time" sub="when to send the email" ink={INK} muted={MUTED} rule={RULE}>
                <div style={{fontFamily:SB.mono, fontSize:13, color:A, fontWeight:500}}>8:00 AM</div>
              </PrefRow>
              <PrefRow label="Email notifications" sub="new shows, on-sale alerts, venue updates" ink={INK} muted={MUTED} rule={RULE}>
                <Toggle on={true} accent={A}/>
              </PrefRow>
              <PrefRow label="Push notifications" sub="mobile app alerts" ink={INK} muted={MUTED} rule={RULE}>
                <Toggle on={false} accent={A}/>
              </PrefRow>
              <PrefRow label="Show-day reminder" sub="morning of the show · doors, seat, venue" ink={INK} muted={MUTED} rule={RULE} last>
                <Toggle on={true} accent={A}/>
              </PrefRow>
            </div>

            {/* ── Regions ─────────────────────────── */}
            <SHead label="Regions" sub="where to look for nearby shows" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'16px 20px', marginBottom:36}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16}}>
                <RegionChip name="New York City" radius={30} active accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
                <RegionChip name="Bay Area" radius={40} active={false} accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
                <RegionChip name="Los Angeles" radius={25} active={false} accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
              </div>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div style={{
                  display:'flex', alignItems:'center', gap:6, fontFamily:SB.mono, fontSize:10.5,
                  color:A, letterSpacing:'.04em', cursor:'pointer',
                }}>
                  <Icon.Plus size={11} color={A}/> Add a region
                </div>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT, letterSpacing:'.04em'}}>
                  active regions appear in Discover → Near you
                </div>
              </div>
            </div>

            {/* ── Followed venues ─────────────────── */}
            <SHead label="Followed venues" sub="announcements from these venues appear in Discover" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'4px 20px 4px', marginBottom:36}}>
              {[
                ['Brooklyn Steel', 'East Williamsburg', 9],
                ['Kings Theatre', 'Flatbush', 8],
                ['Beacon Theatre', 'Upper West Side', 7],
                ['Knockdown Center', 'Maspeth', 6],
                ['Forest Hills Stadium', 'Forest Hills', 5],
                ['Walter Kerr Theatre', 'Theatre District', 4],
              ].map(([name, nbhd, count], i, arr) => (
                <div key={name} style={{
                  display:'flex', alignItems:'center', gap:12,
                  padding:'12px 0', borderBottom: i<arr.length-1 ? `1px solid ${RULE}` : 'none',
                }}>
                  <Icon.MapPin size={14} color={FAINT}/>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontFamily:SB.sans, fontSize:13.5, fontWeight:500, color:INK, letterSpacing:-0.15}}>{name}</div>
                    <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, marginTop:2}}>{nbhd.toLowerCase()}</div>
                  </div>
                  <div style={{fontFamily:SB.mono, fontSize:11, color:MUTED, fontFeatureSettings:'"tnum"'}}>{count} upcoming</div>
                  <div style={{
                    padding:'5px 10px', border:`1px solid ${RULE2}`, color:MUTED,
                    fontFamily:SB.mono, fontSize:10, letterSpacing:'.06em', textTransform:'uppercase',
                    cursor:'pointer',
                  }}>Unfollow</div>
                </div>
              ))}
              <div style={{
                padding:'12px 0', display:'flex', alignItems:'center', gap:6,
                fontFamily:SB.mono, fontSize:10.5, color:A, letterSpacing:'.04em', cursor:'pointer',
              }}>
                <Icon.Plus size={11} color={A}/> Follow a venue
              </div>
            </div>

            {/* ── Data Sources ────────────────────── */}
            <SHead label="Data sources" sub="auto-enrichment for show details" ink={INK} faint={FAINT}/>
            <div style={{background:SURF, padding:'4px 20px 4px', marginBottom:36}}>
              {[
                ['setlist.fm', 'Setlists, tour info, song data', true],
                ['Ticketmaster', 'Venue, date, seat, pricing', true],
                ['Playbill', 'Theatre cast on the night', true],
                ['Wikipedia', 'Material context, album info', false],
              ].map(([name, desc, connected], i, arr) => (
                <PrefRow key={name} label={name} sub={desc} ink={INK} muted={MUTED} rule={RULE} last={i===arr.length-1}>
                  {connected ? (
                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                      <Icon.Check size={12} color={A}/>
                      <span style={{fontFamily:SB.mono, fontSize:10.5, color:A, fontWeight:500}}>Connected</span>
                    </div>
                  ) : (
                    <div style={{
                      padding:'6px 12px', border:`1px solid ${RULE2}`, color:INK,
                      fontFamily:SB.sans, fontSize:12, fontWeight:500, cursor:'pointer',
                    }}>Connect</div>
                  )}
                </PrefRow>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MOBILE — light mode
// ═══════════════════════════════════════════════════════════════════════
function PrefsMobile() {
  const M='light';
  const BG=SB.bg[M], SURF=SB.surface[M];
  const INK=SB.ink[M], MUTED=SB.muted[M], FAINT=SB.faint[M];
  const RULE=SB.rule[M], RULE2=SB.ruleStrong[M];
  const A=ACCENT_L;

  return (
    <div style={{
      height:'100%', background:BG, color:INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Header */}
      <div style={{padding:'60px 20px 14px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Icon.ChevronRight size={18} color={INK} style={{transform:'rotate(180deg)'}}/>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>Back</div>
          </div>
          <Icon.More size={18} color={INK}/>
        </div>
        <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, letterSpacing:-0.9, color:INK}}>
          Preferences
        </div>
      </div>

      <div style={{flex:1, overflow:'auto', padding:'0 0 30px'}}>

        {/* ── Appearance ── */}
        <div style={{padding:'16px 20px 6px'}}>
          <SHead label="Appearance" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px'}}>
          <div style={{background:SURF, padding:'4px 16px'}}>
            <PrefRow label="Theme" ink={INK} muted={MUTED} rule={RULE}>
              <RadioPill
                options={[{k:'system', l:'Auto'}, {k:'light', l:'Light'}, {k:'dark', l:'Dark'}]}
                value="system" accent={A} bg={BG} ink={INK} rule={RULE2}
              />
            </PrefRow>
            <PrefRow label="Compact mode" ink={INK} muted={MUTED} rule={RULE} last>
              <Toggle on={false} accent={A}/>
            </PrefRow>
          </div>
        </div>

        {/* ── Notifications ── */}
        <div style={{padding:'24px 20px 6px'}}>
          <SHead label="Notifications" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px'}}>
          <div style={{background:SURF, padding:'4px 16px'}}>
            <PrefRow label="Discover digest" sub="daily / weekly / off" ink={INK} muted={MUTED} rule={RULE}>
              <RadioPill
                options={[{k:'daily', l:'Daily'}, {k:'weekly', l:'Wkly'}, {k:'off', l:'Off'}]}
                value="daily" accent={A} bg={BG} ink={INK} rule={RULE2}
              />
            </PrefRow>
            <PrefRow label="Digest time" ink={INK} muted={MUTED} rule={RULE}>
              <span style={{fontFamily:SB.mono, fontSize:13, color:A, fontWeight:500}}>8:00 AM</span>
            </PrefRow>
            <PrefRow label="Email alerts" ink={INK} muted={MUTED} rule={RULE}>
              <Toggle on={true} accent={A}/>
            </PrefRow>
            <PrefRow label="Push alerts" ink={INK} muted={MUTED} rule={RULE}>
              <Toggle on={false} accent={A}/>
            </PrefRow>
            <PrefRow label="Show-day reminder" sub="morning of the show" ink={INK} muted={MUTED} rule={RULE} last>
              <Toggle on={true} accent={A}/>
            </PrefRow>
          </div>
        </div>

        {/* ── Regions ── */}
        <div style={{padding:'24px 20px 6px'}}>
          <SHead label="Regions" sub="near-you feed radius" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px'}}>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            <RegionChip name="New York City" radius={30} active accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
            <RegionChip name="Bay Area" radius={40} active={false} accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
            <RegionChip name="Los Angeles" radius={25} active={false} accent={A} ink={INK} rule={RULE2} faint={FAINT}/>
          </div>
          <div style={{
            marginTop:12, display:'flex', alignItems:'center', gap:6,
            fontFamily:SB.mono, fontSize:10.5, color:A, letterSpacing:'.04em', cursor:'pointer',
          }}>
            <Icon.Plus size={11} color={A}/> Add a region
          </div>
        </div>

        {/* ── Followed venues ── */}
        <div style={{padding:'24px 20px 6px'}}>
          <SHead label="Followed venues" sub="6 venues" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px'}}>
          <div style={{background:SURF, padding:'4px 16px'}}>
            {[
              ['Brooklyn Steel', '9 upcoming'],
              ['Kings Theatre', '8 upcoming'],
              ['Beacon Theatre', '7 upcoming'],
              ['Knockdown Center', '6 upcoming'],
              ['Forest Hills Stadium', '5 upcoming'],
              ['Walter Kerr Theatre', '4 upcoming'],
            ].map(([name, count], i, arr) => (
              <div key={name} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'12px 0', borderBottom: i<arr.length-1 ? `1px solid ${RULE}` : 'none',
              }}>
                <Icon.MapPin size={13} color={FAINT}/>
                <div style={{flex:1, fontFamily:SB.sans, fontSize:13.5, fontWeight:500, color:INK, letterSpacing:-0.1}}>{name}</div>
                <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED}}>{count}</div>
                <Icon.ChevronRight size={13} color={FAINT}/>
              </div>
            ))}
            <div style={{
              padding:'12px 0', display:'flex', alignItems:'center', gap:6,
              fontFamily:SB.mono, fontSize:10.5, color:A, letterSpacing:'.04em', cursor:'pointer',
            }}>
              <Icon.Plus size={11} color={A}/> Follow a venue
            </div>
          </div>
        </div>

        {/* ── Data sources ── */}
        <div style={{padding:'24px 20px 6px'}}>
          <SHead label="Data sources" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px'}}>
          <div style={{background:SURF, padding:'4px 16px'}}>
            {[
              ['setlist.fm', true],
              ['Ticketmaster', true],
              ['Playbill', true],
              ['Wikipedia', false],
            ].map(([name, on], i, arr) => (
              <PrefRow key={name} label={name} ink={INK} muted={MUTED} rule={RULE} last={i===arr.length-1}>
                {on ? (
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <Icon.Check size={11} color={A}/>
                    <span style={{fontFamily:SB.mono, fontSize:10, color:A, fontWeight:500}}>On</span>
                  </div>
                ) : (
                  <span style={{fontFamily:SB.mono, fontSize:10, color:FAINT}}>Off</span>
                )}
              </PrefRow>
            ))}
          </div>
        </div>

        {/* ── Account ── */}
        <div style={{padding:'24px 20px 6px'}}>
          <SHead label="Account" ink={INK} faint={FAINT}/>
        </div>
        <div style={{padding:'0 20px 20px'}}>
          <div style={{background:SURF, padding:'4px 16px'}}>
            <PrefRow label="Email" ink={INK} muted={MUTED} rule={RULE} last>
              <span style={{fontFamily:SB.mono, fontSize:11, color:MUTED}}>m@showbook.app</span>
            </PrefRow>
          </div>
        </div>

      </div>

      {/* Tab bar */}
      <div style={{display:'flex', borderTop:`1px solid ${RULE2}`, background:BG, padding:'12px 4px 30px'}}>
        {[
          { k:'home',    l:'Home',     Ic:Icon.Home },
          { k:'discover',l:'Discover', Ic:Icon.Eye },
          { k:'shows',   l:'Shows',    Ic:Icon.Archive },
          { k:'add',     l:'Add',      Ic:Icon.Plus, cta:true },
          { k:'map',     l:'Map',      Ic:Icon.Map },
          { k:'me',      l:'Me',       Ic:Icon.User, active:true },
        ].map(({k,l,Ic,active,cta})=>(
          <div key={k} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
            <div style={{
              width:cta?32:24, height:cta?32:24,
              background:cta?A:'transparent', color:cta?ACCENT_TEXT:(active?A:MUTED),
              display:'flex', alignItems:'center', justifyContent:'center',
              borderRadius:cta?999:0,
            }}>
              <Ic size={cta?18:17}/>
            </div>
            <div style={{fontFamily:SB.mono, fontSize:8.5, letterSpacing:'.04em',
              color:active?A:MUTED, fontWeight:active?500:400, textTransform:'lowercase'}}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.PrefsWeb = PrefsWeb;
window.PrefsMobile = PrefsMobile;
