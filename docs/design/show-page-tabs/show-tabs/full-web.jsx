// Full-size desktop web (1440×900) — sidebar + tabbed show page
// + a sticky right rail with music-layer extras when there's room.

const { SB: __SB_FW, Icon: __Icon_FW, ShowHero: __Hero_FW, ShowTitleBlock: __Title_FW,
        TabBar: __Tabs_FW, ShowTabsBody: __Body_FW, CrumbBar: __Crumb_FW,
        ST_TOKENS: __STT_FW } = window;

function FullWebShell({ tab='setlist', past=false, width=1440, height=900 }) {
  const [active, setActive] = React.useState(tab);
  React.useEffect(()=>setActive(tab),[tab]);
  const T = __STT_FW;
  const D = past ? window.PAST_SHOW : window.SHOW;
  const ml = D.musicLayer;
  return (
    <div style={{ width, height, background:T.BG, color:T.INK, display:'flex', overflow:'hidden', fontFamily:__SB_FW.sans }}>
      {/* Expanded sidebar */}
      <div style={{ width:208, background:T.BG, borderRight:`1px solid ${T.RULE}`, display:'flex', flexDirection:'column', padding:'18px 0', gap:4, flexShrink:0 }}>
        <div style={{ padding:'0 22px 18px', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontFamily:__SB_FW.sans, fontSize:18, fontWeight:600, color:T.INK, letterSpacing:-1 }}>showbook</div>
        </div>
        <div style={{ padding:'0 14px 14px' }}>
          <div style={{ background:T.INK, color:T.BG, padding:'9px 12px', display:'flex', alignItems:'center', gap:8, fontFamily:__SB_FW.sans, fontSize:13, fontWeight:500 }}>
            <__Icon_FW.Plus size={12} color={T.BG}/> New show
          </div>
        </div>
        {[
          ['Home', __Icon_FW.Home, false],
          ['Shows', __Icon_FW.Archive, true],
          ['Map', __Icon_FW.Map, false],
          ['Discover', __Icon_FW.Music, false],
        ].map(([l,Ic,on])=>(
          <div key={l} style={{ padding:'10px 22px', display:'flex', alignItems:'center', gap:10, color: on?T.INK:T.MUTED, fontFamily:__SB_FW.sans, fontSize:13.5, fontWeight: on?500:400, borderLeft: on?`2px solid ${T.ACCENT}`:'2px solid transparent', cursor:'pointer' }}>
            <Ic size={15} color={on?T.INK:T.MUTED}/>{l}
          </div>
        ))}
        <div style={{ flex:1 }}/>
        <div style={{ padding:'14px 22px', borderTop:`1px solid ${T.RULE}`, fontFamily:__SB_FW.mono, fontSize:10.5, color:T.FAINT, letterSpacing:'.04em', lineHeight:1.6 }}>
          <div>{past ? '34 shows logged' : '33 shows · 1 upcoming'}</div>
          <div>connected to spotify</div>
        </div>
        <div style={{ padding:'12px 22px', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:999, background:'#1C1C1C', color:T.INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:__SB_FW.mono, fontSize:11 }}>m</div>
          <div style={{ fontFamily:__SB_FW.sans, fontSize:12, color:T.INK }}>milo</div>
        </div>
      </div>

      {/* Main column */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <__Crumb_FW padX={36}/>
        <div style={{ flex:1, overflow:'auto', display:'flex' }}>
          {/* Center column */}
          <div style={{ flex:1, minWidth:0, borderRight:`1px solid ${T.RULE}` }}>
            <__Hero_FW compact={false}/>
            <__Title_FW compact={false} past={past} padX={36}/>
            <__Tabs_FW active={active} onSelect={setActive} compact={false} padX={36} past={past}/>
            <__Body_FW activeTab={active} compact={false} past={past} twoCol={true}/>
          </div>
          {/* Right rail — music layer extras */}
          <div style={{ width:336, flexShrink:0, padding:'24px 24px', display:'flex', flexDirection:'column', gap:18, background:T.BG }}>
            <div>
              <div style={{ fontFamily:__SB_FW.mono, fontSize:10, color:T.FAINT, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:10 }}>{past?'Vibe of the night':'Predicted vibe'}</div>
              <div style={{ background:T.SURF, border:`1px solid ${T.RULE}`, padding:'18px 14px' }}>
                <window.VibeRadar size={220} profile={past?ml.vibeActual:ml.vibePredicted} label={past?ml.vibeLabel:'high-energy · upbeat · danceable'}/>
              </div>
            </div>
            {past ? (
              <div>
                <div style={{ fontFamily:__SB_FW.mono, fontSize:10, color:T.FAINT, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:10 }}>Fan loyalty</div>
                <div style={{ background:T.SURF, border:`1px solid ${T.RULE}`, padding:'16px' }}>
                  <window.FanLoyaltyRing pct={Math.round(ml.libraryHave/ml.libraryTotal*100)} total={ml.libraryTotal} size={88}/>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontFamily:__SB_FW.mono, fontSize:10, color:T.FAINT, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:10 }}>Hype playlist</div>
                <window.HypePlaylistCard artist={D.headliner} count={14} mins={92}/>
              </div>
            )}
            <div>
              <div style={{ fontFamily:__SB_FW.mono, fontSize:10, color:T.FAINT, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:10 }}>{past?'Energy arc':'Predicted arc'}</div>
              <window.EnergyArc values={past?ml.energyActual:ml.energyPredicted} encoreStart={past?ml.encoreStart:window.SHOW.musicLayer.encoreStart} width={288} height={92}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.FullWebShell = FullWebShell;
