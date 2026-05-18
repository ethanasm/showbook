// Home / Dashboard — refined single direction.
// Merge of: V1 (split-column honesty) + V4 (asymmetric w/ sidebar) + V5 (calendar-grid clarity).
// Tracking-focused. No social/friends feed.
const { Chrome, Annot, ArtistStack, MapSketch } = window;

const RECENT = [
  { date:'APR 04 · 26', artists:[{name:'Fontaines D.C.'},{name:'Been Stellar',role:'support'}], venue:'Kings Theatre', city:'Brooklyn NY', kind:'concert', cost:78},
  { date:'MAR 22 · 26', artists:[{name:'Hadestown'}], venue:'Walter Kerr', city:'New York NY', kind:'theatre', cost:148},
  { date:'MAR 08 · 26', artists:[{name:'Mitski'},{name:'Julia Jacklin',role:'support'}], venue:'Radio City', city:'New York NY', kind:'concert', cost:120},
  { date:'FEB 14 · 26', artists:[{name:'John Mulaney'}], venue:'Beacon Theatre', city:'New York NY', kind:'comedy', cost:95},
  { date:'FEB 01 · 26', artists:[{name:'Slowdive'},{name:'Drab Majesty',role:'support'}], venue:'Brooklyn Steel', city:'Brooklyn NY', kind:'concert', cost:65},
  { date:'JAN 18 · 26', artists:[{name:'The Outsiders'}], venue:'Bernard Jacobs', city:'New York NY', kind:'theatre', cost:132},
];
const UPCOMING = [
  { when:'in 6 days',  date:'APR 26', artists:[{name:'Caroline Polachek'}], venue:'Knockdown Center', city:'Queens NY', kind:'concert', hasTix:true, price:92},
  { when:'in 2 weeks', date:'MAY 04', artists:[{name:'Big Thief'},{name:'Madi Diaz',role:'support'}], venue:'Forest Hills Stadium', city:'Queens NY', kind:'concert', hasTix:true, price:78},
  { when:'in 3 weeks', date:'MAY 12', artists:[{name:'Oh, Mary!'}], venue:'Lyceum Theatre', city:'New York NY', kind:'theatre', hasTix:true, price:145},
  { when:'in 5 weeks', date:'MAY 28', artists:[{name:'Governors Ball'},{name:'Olivia Rodrigo',role:'headliner'},{name:'Tyler, The Creator',role:'headliner'},{name:'+8 more'}], venue:'Flushing Meadows', city:'Queens NY', kind:'festival', hasTix:false},
  { when:'in 8 weeks', date:'JUN 15', artists:[{name:'& Juliet'}], venue:'Stephen Sondheim', city:'New York NY', kind:'theatre', hasTix:false},
];

function Home(){
  return (
    <Chrome active="Home">
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 320px',height:'100%'}}>
        {/* LEFT — HISTORY */}
        <div style={{padding:'24px 28px',borderRight:'1.25px solid #2a2520',display:'flex',flexDirection:'column',minHeight:0}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:14}}>
            <div>
              <div style={{fontSize:11,fontFamily:'JetBrains Mono',color:'#6b645a',letterSpacing:'.1em',textTransform:'uppercase'}}>← history</div>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:-.3,marginTop:2}}>Recent shows</div>
            </div>
            <div className="wf-label">87 total · see all →</div>
          </div>
          <div style={{borderTop:'1.25px solid #2a2520'}}>
            {RECENT.map((s,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'72px 1fr 70px 56px',gap:12,padding:'12px 0',borderBottom:'1.25px solid #ece9e2',alignItems:'center'}}>
                <div className="wf-mono" style={{fontSize:10}}>{s.date}</div>
                <div>
                  <ArtistStack artists={s.artists} size={13} showRole={s.artists.length>1}/>
                  <div style={{fontSize:10,color:'#6b645a',marginTop:2}}>{s.venue} · {s.city}</div>
                </div>
                <div className="wf-chip" style={{fontSize:9,justifySelf:'start'}}>{s.kind}</div>
                <div className="wf-num" style={{fontSize:12,textAlign:'right'}}>${s.cost}</div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER — UPCOMING */}
        <div style={{padding:'24px 28px',borderRight:'1.25px solid #2a2520',display:'flex',flexDirection:'column',minHeight:0}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:14}}>
            <div>
              <div style={{fontSize:11,fontFamily:'JetBrains Mono',color:'#6b645a',letterSpacing:'.1em',textTransform:'uppercase'}}>upcoming →</div>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:-.3,marginTop:2}}>Next 90 days</div>
            </div>
            <div className="wf-label">3 w/ tix · 2 watching</div>
          </div>
          <div style={{borderTop:'1.25px solid #2a2520'}}>
            {UPCOMING.map((s,i)=>{
              const dashed = !s.hasTix;
              return (
                <div key={i} style={{display:'grid',gridTemplateColumns:'54px 1fr auto',gap:12,padding:'12px 0',borderBottom:dashed?'1.25px dashed #8a827a':'1.25px solid #ece9e2',alignItems:'center'}}>
                  <div style={{paddingRight:8,borderRight:dashed?'1.25px dashed #8a827a':'1.25px solid #2a2520'}}>
                    <div className="wf-label" style={{fontSize:9}}>{s.date.split(' ')[0]}</div>
                    <div style={{fontSize:17,fontWeight:700,letterSpacing:-.3,fontFamily:'JetBrains Mono'}}>{s.date.split(' ')[1]}</div>
                    <div className="wf-label" style={{fontSize:8,marginTop:2,color:'#8a827a'}}>{s.when}</div>
                  </div>
                  <div>
                    <ArtistStack artists={s.artists.slice(0,3)} size={13} showRole={s.artists.length>1}/>
                    {s.artists.length>3 && <div className="wf-label" style={{fontSize:8,marginTop:2}}>{s.artists[s.artists.length-1].name}</div>}
                    <div style={{fontSize:10,color:'#6b645a',marginTop:2}}>{s.venue} · {s.city}</div>
                  </div>
                  <div style={{textAlign:'right',display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                    <div className="wf-chip" style={{fontSize:9,background:s.hasTix?'#2a2520':'#fff',color:s.hasTix?'#fff':'#2a2520'}}>{s.hasTix?'tix ✓':'watching'}</div>
                    <div className="wf-chip" style={{fontSize:9}}>{s.kind}</div>
                    {s.price && <div className="wf-num" style={{fontSize:11,marginTop:2}}>${s.price}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — AT-A-GLANCE */}
        <div style={{padding:'24px 22px',background:'#fff',display:'flex',flexDirection:'column',gap:18,overflow:'hidden'}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>this year · 2026</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[['14','shows'],['$1,284','spent'],['9','venues'],['22','artists']].map(([v,l])=>(
                <div key={l} className="wf-box" style={{padding:'8px 10px'}}>
                  <div style={{fontSize:22,fontWeight:700,letterSpacing:-.4}}>{v}</div>
                  <div className="wf-label" style={{fontSize:9}}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="wf-label" style={{marginBottom:6}}>year rhythm</div>
            <div className="wf-box" style={{padding:'10px 10px',background:'#fff'}}>
              <div style={{display:'flex',alignItems:'flex-end',gap:3,height:70}}>
                {[2,1,3,2,1,0,0,0,0,0,0,0].map((v,i)=>{
                  const future = i>3;
                  const h = 6 + v*16;
                  return (
                    <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                      <div style={{width:'100%',height:h,background:future?'transparent':'#2a2520',border:'1.25px solid '+(future?'#8a827a':'#2a2520'),borderStyle:future?'dashed':'solid'}}/>
                    </div>
                  );
                })}
              </div>
              <div style={{display:'flex',gap:3,marginTop:4}}>
                {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m,i)=>(
                  <div key={i} className="wf-label" style={{flex:1,textAlign:'center',fontSize:8}}>{m}</div>
                ))}
              </div>
              <div className="wf-label" style={{fontSize:9,marginTop:6}}>■ attended · ▢ have tix</div>
            </div>
          </div>

          <div>
            <div className="wf-label" style={{marginBottom:6}}>venue map · 9 this year</div>
            <div style={{height:120}}>
              <MapSketch style={{width:'100%',height:'100%',border:'1.25px solid #2a2520'}} dots={[
                {x:355,y:210,r:7,count:4},{x:360,y:230,r:5,count:2},{x:340,y:200,r:4},
                {x:380,y:240,r:4},{x:510,y:260,r:3},{x:180,y:280,r:3},
              ]}/>
            </div>
          </div>

          <div>
            <div className="wf-label" style={{marginBottom:6}}>most seen</div>
            {[['Big Thief',5],['Mitski',4],['Fontaines D.C.',3]].map(([n,v],i)=>(
              <div key={n} style={{display:'grid',gridTemplateColumns:'1fr 50px 24px',alignItems:'center',gap:6,fontSize:11,padding:'4px 0',borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2'}}>
                <span>{n}</span>
                <div style={{height:5,background:'#ece9e2',border:'1.25px solid #2a2520'}}><div style={{height:'100%',width:`${v*18}%`,background:'#2a2520'}}/></div>
                <span className="wf-num" style={{textAlign:'right'}}>{v}×</span>
              </div>
            ))}
          </div>
        </div>

        <Annot top={24} left={'34%'} w={170} rotate={-2}>past ← → future as equal halves ·<br/>sidebar = tracking metrics</Annot>
        <Annot top={240} left={'22%'} w={170} rotate={2}>multi-artist shows ·<br/>first row = headliner, stacked</Annot>
      </div>
    </Chrome>
  );
}

window.HomeVariants = [
  {id:'home', label:'Home · refined (split columns + tracking sidebar)', render:()=><Home/>},
];
