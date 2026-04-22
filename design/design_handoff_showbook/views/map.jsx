// Map view — refined from option 1 (full-bleed + inspector).
// Full map, clickable venue → right inspector with all shows there.
const { Chrome, Annot, MapSketch } = window;

function MapView(){
  const dots = [
    {x:355,y:215,r:10,count:12,label:'Kings Theatre',selected:true},
    {x:365,y:200,r:8,count:8,label:'Brooklyn Steel'},
    {x:370,y:180,r:7,count:6,label:'Beacon'},
    {x:380,y:190,r:7,count:5,label:'MSG'},
    {x:410,y:175,r:6,count:4,label:'Forest Hills'},
    {x:340,y:230,r:5,count:3,label:'Bell House'},
    {x:420,y:150,r:4,count:2,label:'Webster Hall'},
    {x:320,y:250,r:4,count:2,label:'Warsaw'},
    {x:450,y:165,r:4,count:2},
    {x:220,y:300,r:4,count:2,label:'9:30 Club · DC'},
    {x:150,y:220,r:3,count:1,label:'Fenway · Boston'},
    {x:560,y:300,r:3,count:1},
  ];
  const kingsShows = [
    {d:'APR 04 · 26',a:'Fontaines D.C.',k:'concert'},
    {d:'OCT 11 · 25',a:'Japanese Breakfast',k:'concert'},
    {d:'JUN 02 · 25',a:'Alvvays',k:'concert'},
    {d:'OCT 14 · 24',a:'Big Thief',k:'concert'},
    {d:'APR 22 · 24',a:'Waxahatchee',k:'concert'},
    {d:'DEC 18 · 23',a:'Bright Eyes',k:'concert'},
    {d:'SEP 09 · 23',a:'Wilco',k:'concert'},
    {d:'APR 30 · 23',a:'black midi',k:'concert'},
  ];
  return (
    <Chrome active="Map">
      <div style={{display:'grid',gridTemplateColumns:'1fr 360px',height:'100%'}}>
        {/* MAP */}
        <div style={{position:'relative',overflow:'hidden'}}>
          <MapSketch style={{width:'100%',height:'100%'}} dots={dots} labels={[
            {x:370,y:260,t:'NYC · 34 venues'},
            {x:210,y:320,t:'DC · 1 venue'},
            {x:140,y:240,t:'BOS · 1'},
          ]}/>
          {/* overlay controls */}
          <div style={{position:'absolute',top:16,left:16,display:'flex',gap:6,flexDirection:'column'}}>
            <div className="wf-box" style={{padding:'8px 12px',background:'#fff'}}>
              <div className="wf-label" style={{fontSize:9,marginBottom:4}}>showing</div>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                {['all','concert','festival','theatre','comedy'].map((k,i)=>(
                  <div key={k} className="wf-chip" style={{fontSize:9,padding:'2px 7px',background:i===0?'#2a2520':'#fff',color:i===0?'#fff':'#2a2520'}}>{k}</div>
                ))}
              </div>
            </div>
            <div className="wf-box" style={{padding:'8px 12px',background:'#fff'}}>
              <div className="wf-label" style={{fontSize:9,marginBottom:4}}>years</div>
              <div style={{display:'flex',gap:4}}>
                <div className="wf-chip" style={{fontSize:9,padding:'2px 7px',background:'#2a2520',color:'#fff'}}>all-time</div>
                <div className="wf-chip" style={{fontSize:9,padding:'2px 7px'}}>2026</div>
                <div className="wf-chip" style={{fontSize:9,padding:'2px 7px'}}>range ▾</div>
              </div>
            </div>
          </div>
          <div style={{position:'absolute',bottom:16,left:16}}>
            <div className="wf-box" style={{padding:'8px 12px',background:'#fff'}}>
              <div className="wf-label" style={{fontSize:9}}>legend · dot size = # of shows</div>
              <div style={{display:'flex',gap:10,marginTop:4,alignItems:'center'}}>
                <div style={{display:'flex',gap:4,alignItems:'center'}}><div style={{width:6,height:6,borderRadius:'50%',background:'#2a2520'}}/><span style={{fontSize:10}}>1</span></div>
                <div style={{display:'flex',gap:4,alignItems:'center'}}><div style={{width:10,height:10,borderRadius:'50%',background:'#2a2520'}}/><span style={{fontSize:10}}>4</span></div>
                <div style={{display:'flex',gap:4,alignItems:'center'}}><div style={{width:14,height:14,borderRadius:'50%',background:'#2a2520'}}/><span style={{fontSize:10}}>8</span></div>
                <div style={{display:'flex',gap:4,alignItems:'center'}}><div style={{width:18,height:18,borderRadius:'50%',background:'#2a2520'}}/><span style={{fontSize:10}}>12+</span></div>
              </div>
            </div>
          </div>
          <div style={{position:'absolute',top:16,right:16}}>
            <div className="wf-box" style={{padding:'8px 12px',background:'#fff',fontSize:11,fontFamily:'JetBrains Mono'}}>
              34 venues · 87 shows
            </div>
          </div>
        </div>

        {/* INSPECTOR */}
        <div style={{borderLeft:'1.25px solid #2a2520',padding:'22px 24px',background:'#fafaf7',display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div className="wf-label">selected pin</div>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:-.3,marginTop:4,fontFamily:'Fraunces, serif'}}>Kings Theatre</div>
          <div className="wf-label" style={{fontSize:10,marginTop:2,textTransform:'none',letterSpacing:0,fontFamily:'Inter'}}>1027 Flatbush Ave · Brooklyn NY</div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0,border:'1.25px solid #2a2520',background:'#fff',marginTop:14}}>
            {[['12','shows'],['9','artists'],['$1,084','spent']].map(([v,l],i)=>(
              <div key={l} style={{padding:'10px 12px',borderLeft:i===0?'none':'1.25px solid #2a2520'}}>
                <div style={{fontSize:18,fontWeight:700,letterSpacing:-.3}}>{v}</div>
                <div className="wf-label" style={{fontSize:9}}>{l}</div>
              </div>
            ))}
          </div>

          <div className="wf-label" style={{marginTop:18,marginBottom:6}}>all visits</div>
          <div className="wf-box" style={{background:'#fff',flex:1,overflow:'auto'}}>
            {kingsShows.map((s,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'78px 1fr auto',gap:10,padding:'9px 12px',borderTop:i===0?'none':'1.25px solid #ece9e2',alignItems:'center'}}>
                <div className="wf-mono" style={{fontSize:10}}>{s.d}</div>
                <div style={{fontSize:12}}>{s.a}</div>
                <div className="wf-chip" style={{fontSize:9}}>{s.k}</div>
              </div>
            ))}
            <div className="wf-label" style={{padding:'9px 12px',borderTop:'1.25px solid #2a2520',fontSize:9}}>+4 more · since 2019</div>
          </div>

          <div className="wf-label" style={{marginTop:14,marginBottom:6}}>upcoming here</div>
          <div className="wf-box" style={{background:'#fff',padding:'10px 12px',borderStyle:'dashed'}}>
            <div style={{fontSize:12}}>nothing booked yet.</div>
            <div className="wf-label" style={{fontSize:9,marginTop:4}}>notify me when new shows post · ○</div>
          </div>
        </div>

        <Annot top={24} left={'28%'} w={170} rotate={-2}>dot size = # of shows ·<br/>quick sense of where you go</Annot>
        <Annot top={340} left={'48%'} w={170} rotate={2}>click pin → all shows there ·<br/>same data, geographic lens</Annot>
      </div>
    </Chrome>
  );
}

window.MapVariants = [
  {id:'map', label:'Map · refined (full-bleed + venue inspector)', render:()=><MapView/>},
];
