// Stats / year-in-review — refined from option 1 (newsprint dashboard).
// Must-have: "most attended venues", "most attended concerts", "concerts per year", "shows per year" per-type.
const { Chrome, Annot } = window;

const YEARS_BY_TYPE = [
  // y,   concert, festival, theatre, comedy
  {y:'2019',c:12,f:1,b:2,co:1},
  {y:'2020',c:0, f:0,b:0,co:0},
  {y:'2021',c:3, f:0,b:1,co:1},
  {y:'2022',c:11,f:1,b:1,co:1},
  {y:'2023',c:7, f:1,b:1,co:0},
  {y:'2024',c:14,f:2,b:1,co:1},
  {y:'2025',c:16,f:2,b:3,co:1},
  {y:'2026',c:8, f:0,b:3,co:3},
];

function Bar({segs,max,w=260,h=14}){
  // segs: [{v,fill}]
  const total = segs.reduce((a,s)=>a+s.v,0);
  const scale = max>0 ? total/max : 0;
  let x=0;
  return (
    <div style={{width:w,height:h,border:'1.25px solid #2a2520',background:'#fff',position:'relative'}}>
      <div style={{width:`${scale*100}%`,height:'100%',display:'flex'}}>
        {segs.map((s,i)=>{
          const flex = s.v/(total||1);
          return <div key={i} style={{flex:flex,background:s.fill}}/>;
        })}
      </div>
    </div>
  );
}

function legendFill(k){
  if(k==='c') return '#2a2520';
  if(k==='f') return '#6b645a';
  if(k==='b') return 'repeating-linear-gradient(45deg,#2a2520 0 2px,#fff 2px 5px)';
  if(k==='co')return 'repeating-linear-gradient(90deg,#2a2520 0 1.5px,#fff 1.5px 4px)';
}

function Stats(){
  const maxYear = Math.max(...YEARS_BY_TYPE.map(y=>y.c+y.f+y.b+y.co));
  return (
    <Chrome active="Stats">
      <div style={{padding:'22px 36px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        {/* masthead */}
        <div style={{borderTop:'3px solid #2a2520',borderBottom:'1.25px solid #2a2520',padding:'10px 0 12px',marginBottom:16,display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
          <div>
            <div className="wf-label">all-time · since 2019</div>
            <div style={{fontSize:28,fontWeight:800,letterSpacing:-.5,fontFamily:'Fraunces, serif'}}>The Ledger · 87 shows across 8 years</div>
          </div>
          <div style={{display:'flex',gap:6}}>
            <div className="wf-chip">2026</div>
            <div className="wf-chip">all-time</div>
          </div>
        </div>

        {/* top row — 4 big numbers */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:0,border:'1.25px solid #2a2520',background:'#fff',marginBottom:18}}>
          {[
            ['87','shows total'],
            ['142','distinct artists'],
            ['34','venues'],
            ['$7,482','spent all-time'],
          ].map(([v,l],i)=>(
            <div key={l} style={{padding:'14px 18px',borderLeft:i===0?'none':'1.25px solid #2a2520'}}>
              <div style={{fontSize:32,fontWeight:800,letterSpacing:-.8,fontFamily:'Fraunces, serif'}}>{v}</div>
              <div className="wf-label" style={{fontSize:10}}>{l}</div>
            </div>
          ))}
        </div>

        {/* grid — main charts */}
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:18}}>
          {/* shows per year, stacked by type */}
          <div className="wf-box" style={{padding:16,background:'#fff'}}>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:10}}>
              <div style={{fontSize:14,fontWeight:700}}>Shows per year · by type</div>
              <div className="wf-label" style={{fontSize:9}}>stacked</div>
            </div>
            {/* legend */}
            <div style={{display:'flex',gap:14,marginBottom:10,flexWrap:'wrap'}}>
              {[['concert','c'],['festival','f'],['theatre','b'],['comedy','co']].map(([l,k])=>(
                <div key={k} style={{display:'flex',gap:6,alignItems:'center'}}>
                  <div style={{width:12,height:10,border:'1.25px solid #2a2520',background:legendFill(k)}}/>
                  <span className="wf-label" style={{fontSize:9}}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:7}}>
              {YEARS_BY_TYPE.map(y=>{
                const total = y.c+y.f+y.b+y.co;
                return (
                  <div key={y.y} style={{display:'grid',gridTemplateColumns:'48px 1fr 40px',gap:10,alignItems:'center'}}>
                    <div className="wf-mono" style={{fontSize:11}}>{y.y}</div>
                    <Bar max={maxYear} w={'100%'} segs={[
                      {v:y.c,fill:legendFill('c')},
                      {v:y.f,fill:legendFill('f')},
                      {v:y.b,fill:legendFill('b')},
                      {v:y.co,fill:legendFill('co')},
                    ]}/>
                    <div className="wf-num" style={{fontSize:12,textAlign:'right'}}>{total}</div>
                  </div>
                );
              })}
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:10}}>peak: 2025 · 22 shows · including 3 theatre (a first)</div>
          </div>

          {/* most-attended venues + artists */}
          <div style={{display:'grid',gridTemplateRows:'1fr 1fr',gap:16}}>
            <div className="wf-box" style={{padding:16,background:'#fff'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Most-attended venues</div>
              {[
                ['Kings Theatre',12,'brooklyn'],
                ['Brooklyn Steel',8,'brooklyn'],
                ['Beacon Theatre',6,'manhattan'],
                ['MSG',5,'manhattan'],
                ['Forest Hills Stadium',4,'queens'],
              ].map(([n,v,n2],i)=>(
                <div key={n} style={{display:'grid',gridTemplateColumns:'1.3fr 1fr 32px',gap:8,padding:'5px 0',borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2',alignItems:'center',fontSize:11}}>
                  <div><div>{n}</div><div className="wf-label" style={{fontSize:8}}>{n2}</div></div>
                  <div style={{height:6,background:'#ece9e2',border:'1.25px solid #2a2520'}}><div style={{height:'100%',width:`${(v/12)*100}%`,background:'#2a2520'}}/></div>
                  <div className="wf-num" style={{fontSize:11,textAlign:'right'}}>{v}×</div>
                </div>
              ))}
            </div>

            <div className="wf-box" style={{padding:16,background:'#fff'}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Most-seen artists</div>
              {[
                ['Big Thief',6],
                ['Mitski',4],
                ['Fontaines D.C.',3],
                ['Vampire Weekend',3],
                ['Phoebe Bridgers',3],
              ].map(([n,v],i)=>(
                <div key={n} style={{display:'grid',gridTemplateColumns:'1.3fr 1fr 32px',gap:8,padding:'5px 0',borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2',alignItems:'center',fontSize:11}}>
                  <div>{n}</div>
                  <div style={{height:6,background:'#ece9e2',border:'1.25px solid #2a2520'}}><div style={{height:'100%',width:`${(v/6)*100}%`,background:'#2a2520'}}/></div>
                  <div className="wf-num" style={{fontSize:11,textAlign:'right'}}>{v}×</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* bottom row — secondary cuts */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginTop:16}}>
          <div className="wf-box" style={{padding:14,background:'#fff'}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>By kind · all-time</div>
            {[['concert',71],['festival',7],['theatre',12],['comedy',8]].map(([k,v],i)=>(
              <div key={k} style={{display:'grid',gridTemplateColumns:'80px 1fr 30px',gap:6,padding:'4px 0',alignItems:'center',fontSize:11,borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2'}}>
                <div>{k}</div>
                <div style={{height:6,background:'#ece9e2',border:'1.25px solid #2a2520'}}><div style={{height:'100%',width:`${(v/71)*100}%`,background:'#2a2520'}}/></div>
                <div className="wf-num" style={{fontSize:11,textAlign:'right'}}>{v}</div>
              </div>
            ))}
          </div>
          <div className="wf-box" style={{padding:14,background:'#fff'}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Spend by year</div>
            {[['2022','$682'],['2023','$910'],['2024','$1,140'],['2025','$2,204'],['2026','$1,284 (ytd)']].map(([y,v],i)=>(
              <div key={y} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:11,borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2',fontFamily:'JetBrains Mono'}}>
                <span>{y}</span><span>{v}</span>
              </div>
            ))}
          </div>
          <div className="wf-box" style={{padding:14,background:'#fff'}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Day-of-week</div>
            <div style={{display:'flex',gap:4,alignItems:'flex-end',height:60}}>
              {[['M',4],['T',6],['W',8],['T',11],['F',22],['S',24],['S',12]].map(([d,v],i)=>(
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                  <div style={{width:'100%',height:v*2.2,background:'#2a2520',border:'1.25px solid #2a2520'}}/>
                  <div className="wf-label" style={{fontSize:8}}>{d}</div>
                </div>
              ))}
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:6}}>most shows on Saturdays · 24 total</div>
          </div>
        </div>

        <Annot top={40} right={24} w={140} rotate={3}>"The Ledger" ·<br/>almanac vibe</Annot>
        <Annot top={310} left={'44%'} w={170} rotate={-3}>shows/year stacked by type ·<br/>answers "my rhythm of taste"</Annot>
      </div>
    </Chrome>
  );
}

window.StatsVariants = [
  {id:'stats', label:'Stats · refined (The Ledger · multi-chart dashboard)', render:()=><Stats/>},
];
