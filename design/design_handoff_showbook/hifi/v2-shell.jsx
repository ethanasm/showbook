// v2 · Shared shell pieces: sidebar + top bar for the simplified IA.
// Sidebar collapses to: Home / Shows / Map / Artists / Add.

const { SB, Icon, HIFI_KINDS } = window;

function V2Sidebar({active='home'}) {
  const M = 'dark';
  const BG = SB.bg[M], SURF = SB.surface[M], SURF2 = SB.surface2[M];
  const INK = SB.ink[M], MUTED = SB.muted[M], FAINT = SB.faint[M];
  const RULE = SB.rule[M], RULE2 = SB.ruleStrong[M];
  const items = [
    { key:'home',    label:'Home',    Icon:Icon.Home },
    { key:'shows',   label:'Shows',   Icon:Icon.Archive, count:'91' },
    { key:'map',     label:'Map',     Icon:Icon.Map },
    { key:'artists', label:'Artists', Icon:Icon.Music,   count:'22' },
  ];
  return (
    <div style={{
      width:220, background:BG, borderRight:`1px solid ${RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
    }}>
      <div style={{padding:'0 20px 22px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:INK, letterSpacing:-0.5}}>
          showbook<span style={{color:FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v2 · 2026.04
        </div>
      </div>

      <div style={{padding:'0 16px 18px'}}>
        <button style={{
          width:'100%', padding:'10px 12px', background:INK, color:BG,
          border:'none', fontFamily:SB.sans, fontSize:13, fontWeight:500,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer',
        }}>
          <Icon.Plus size={15} color={BG}/> Add a show
        </button>
        <div style={{
          marginTop:8, padding:'7px 10px', background:SURF, border:`1px solid ${RULE}`,
          display:'flex', alignItems:'center', gap:8,
          fontFamily:SB.mono, fontSize:11, color:MUTED,
        }}>
          <Icon.Search size={13} color={MUTED}/>
          <span>search…</span>
          <span style={{flex:1}}/>
          <span style={{padding:'1px 6px', fontSize:9.5, border:`1px solid ${RULE2}`, color:MUTED}}>⌘K</span>
        </div>
      </div>

      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Navigate
        </div>
        {items.map(({key, label, Icon:Ic, count})=>{
          const isActive = key===active;
          return (
            <div key={key} style={{
              display:'flex', alignItems:'center', gap:10, padding:'8px 12px', margin:'1px 0',
              background: isActive ? SURF : 'transparent',
              color: isActive ? INK : MUTED,
              fontFamily:SB.sans, fontSize:13.5, fontWeight: isActive ? 500 : 400,
              cursor:'pointer',
              borderLeft: isActive ? `2px solid ${SB.kinds.concert.inkDark}` : '2px solid transparent',
            }}>
              <Ic size={15} color={isActive ? INK : MUTED}/>
              <span style={{flex:1}}>{label}</span>
              {count && <span style={{fontFamily:SB.mono, fontSize:11, color:FAINT}}>{count}</span>}
            </div>
          );
        })}

        <div style={{padding:'20px 12px 6px', fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Pinned
        </div>
        {[
          ['Radio City', '8'],
          ['Brooklyn Steel', '6'],
          ['Big Thief', '5×'],
        ].map(([l,c])=>(
          <div key={l} style={{
            display:'flex', alignItems:'center', gap:10, padding:'6px 12px',
            color:MUTED, fontFamily:SB.sans, fontSize:12.5, cursor:'pointer',
          }}>
            <span style={{flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{l}</span>
            <span style={{fontFamily:SB.mono, fontSize:10.5, color:FAINT}}>{c}</span>
          </div>
        ))}
      </div>

      <div style={{
        padding:'14px 16px', borderTop:`1px solid ${RULE}`,
        display:'flex', alignItems:'center', gap:10,
      }}>
        <div style={{
          width:28, height:28, borderRadius:999, background:SURF2, color:INK,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:12, fontWeight:500,
        }}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:FAINT, marginTop:1}}>synced 3m ago</div>
        </div>
        <Icon.More size={14} color={MUTED}/>
      </div>
    </div>
  );
}

window.V2Sidebar = V2Sidebar;
