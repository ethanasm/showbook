// Shared wireframe primitives. All styles are .wf-* classes in index.html.
// Keep these tiny — they're just presentational glue.

const Chrome = ({ active='Home', children, compact }) => (
  <div className="wf" style={{height:'100%',display:'flex',flexDirection:'column',background:'#fafaf7'}}>
    <div style={{display:'flex',alignItems:'center',gap:24,padding:'14px 28px',borderBottom:'1.25px solid #2a2520',background:'#fff'}}>
      <div style={{fontFamily:'Caveat, cursive',fontSize:22,fontWeight:600,letterSpacing:-.5}}>
        <span style={{color:'#2a2520'}}>showbook</span><span style={{color:'#c96442'}}>.</span>
      </div>
      <div style={{display:'flex',gap:2,fontSize:12,fontFamily:'JetBrains Mono, monospace'}}>
        {['Home','History','Upcoming','Stats','Map','Friends'].map(t => (
          <div key={t} style={{padding:'6px 12px',border:active===t?'1.25px solid #2a2520':'1.25px solid transparent',background:active===t?'#2a2520':'transparent',color:active===t?'#f3f1ec':'#2a2520'}}>{t}</div>
        ))}
      </div>
      <div style={{flex:1}} />
      <div className="wf-pill">⌘K  search</div>
      <div className="wf-btn primary">+ add show</div>
      <div style={{width:28,height:28,borderRadius:'50%',border:'1.25px solid #2a2520',background:'#ece9e2',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontFamily:'JetBrains Mono'}}>m</div>
    </div>
    <div style={{flex:1,overflow:'hidden'}}>{children}</div>
  </div>
);

// Box with an X — classic wireframe placeholder for imagery
const ImgPh = ({label='poster', h=120, style={}}) => (
  <div className="wf-soft" style={{height:h,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',...style}}>
    <svg style={{position:'absolute',inset:0,width:'100%',height:'100%'}} preserveAspectRatio="none">
      <line x1="0" y1="0" x2="100%" y2="100%" stroke="#8a827a" strokeWidth="1" strokeDasharray="3 3"/>
      <line x1="100%" y1="0" x2="0" y2="100%" stroke="#8a827a" strokeWidth="1" strokeDasharray="3 3"/>
    </svg>
    <div className="wf-label" style={{background:'#fafaf7',padding:'1px 4px',zIndex:1}}>{label}</div>
  </div>
);

// Annotation arrow+text. dir = 'left'|'right'|'up'|'down'
const Annot = ({children, top, left, right, bottom, dir='left', rotate=-3, w=150}) => (
  <div className="wf-ann" style={{position:'absolute',top,left,right,bottom,width:w,transform:`rotate(${rotate}deg)`,pointerEvents:'none',zIndex:20}}>
    {dir==='left' && <span>↙ </span>}{dir==='up' && <span>↑ </span>}
    {children}
    {dir==='right' && <span> ↘</span>}{dir==='down' && <span> ↓</span>}
  </div>
);

// Stacked artist list on a single show (multi-artist support)
const ArtistStack = ({artists, size=12, showRole=false}) => (
  <div style={{display:'flex',flexDirection:'column',gap:2}}>
    {artists.map((a,i)=>(
      <div key={i} style={{display:'flex',alignItems:'baseline',gap:6}}>
        <div style={{fontSize:size,fontWeight:i===0?700:500,color:i===0?'#2a2520':'#6b645a'}}>{a.name}</div>
        {showRole && <div className="wf-label" style={{fontSize:8}}>{a.role||(i===0?'headliner':'support')}</div>}
      </div>
    ))}
  </div>
);

// Simple bar (for stats)
const Bar = ({v, max, w=20, h=60, fill='#2a2520'}) => (
  <div style={{width:w,height:h,background:'#ece9e2',position:'relative',border:'1.25px solid #2a2520'}}>
    <div style={{position:'absolute',bottom:0,left:0,right:0,height:`${(v/max)*100}%`,background:fill}} />
  </div>
);

// Tiny map sketch — stylized coastline + dots
const MapSketch = ({dots=[], labels=[], style={}, pinColor='#c96442'}) => (
  <div style={{position:'relative',background:'#ece9e2',overflow:'hidden',...style}}>
    <svg width="100%" height="100%" viewBox="0 0 600 400" preserveAspectRatio="none">
      {/* coastline-ish shapes */}
      <path d="M0,280 C60,260 120,300 180,270 C240,240 300,280 360,250 C420,220 480,260 600,230 L600,400 L0,400 Z" fill="#d4cec1" stroke="#8a827a" strokeWidth="1"/>
      <path d="M0,180 C80,170 140,200 220,180 C300,160 360,190 420,160 L420,180 C360,210 300,180 220,200 C140,220 80,190 0,200 Z" fill="#e2ded4" stroke="#8a827a" strokeWidth=".8"/>
      {/* grid */}
      {[...Array(10)].map((_,i)=><line key={'h'+i} x1="0" y1={i*40} x2="600" y2={i*40} stroke="#8a827a" strokeWidth=".3" strokeDasharray="2 4"/>)}
      {[...Array(15)].map((_,i)=><line key={'v'+i} x1={i*40} y1="0" x2={i*40} y2="400" stroke="#8a827a" strokeWidth=".3" strokeDasharray="2 4"/>)}
      {/* dots */}
      {dots.map((d,i)=>(
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={d.r||4} fill={pinColor} stroke="#2a2520" strokeWidth="1"/>
          {d.count && <text x={d.x} y={d.y+3} fontSize="8" textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono">{d.count}</text>}
        </g>
      ))}
      {labels.map((l,i)=>(
        <text key={i} x={l.x} y={l.y} fontSize="10" fill="#2a2520" fontFamily="JetBrains Mono">{l.t}</text>
      ))}
    </svg>
  </div>
);

// Legend artboard intro
function LegendArtboard(){
  return (
    <div style={{padding:32,fontFamily:'Inter',display:'grid',gridTemplateColumns:'1fr 1fr',gap:28,height:'100%',boxSizing:'border-box'}}>
      <div>
        <div className="wf-label" style={{marginBottom:8}}>system / aesthetic</div>
        <div style={{fontFamily:'Caveat',fontSize:32,lineHeight:1.1,marginBottom:14}}>Clean grayscale wireframes with<br/>editorial-script logotype & handwritten annotations.</div>
        <div style={{fontSize:13,lineHeight:1.55,color:'#3a342d',maxWidth:360}}>
          Inter for UI & numbers · JetBrains Mono for labels/data · Caveat for logo, annotations & section titles. One accent (burnt orange) reserved for annotations, CTAs-in-focus, and map pins. Everything else = paper, ink, and three grays.
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="wf-label">vocabulary</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <div className="wf-chip">chip</div>
          <div className="wf-pill">pill · meta</div>
          <div className="wf-btn">secondary</div>
          <div className="wf-btn primary">primary cta</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginTop:4}}>
          <div style={{height:36}} className="wf-tint"></div>
          <div style={{height:36}} className="wf-tint2"></div>
          <div style={{height:36}} className="wf-tint3"></div>
          <div style={{height:36}} className="wf-fill"></div>
          <div style={{height:36,background:'#c96442'}}></div>
          <div style={{height:36}} className="wf-ph"></div>
        </div>
        <div className="wf-ann" style={{marginTop:6}}>↙ orange only for attention-grabbing bits</div>
      </div>
    </div>
  );
}

Object.assign(window, { Chrome, ImgPh, Annot, ArtistStack, Bar, MapSketch, LegendArtboard });
