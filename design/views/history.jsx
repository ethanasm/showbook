// History archive — refined single direction.
// Merge of: C (year-rail timeline) + E (map-linked list).
// Year rails = navigation. List = dense data. Map = geographic lens that filters.
const { Chrome, Annot, ArtistStack, MapSketch } = window;

const PAST = [
  {d:'2026-04-04',date:'APR 04 · 26', artists:[{name:'Fontaines D.C.'},{name:'Been Stellar',role:'support'}], venue:'Kings Theatre', city:'Brooklyn NY', kind:'concert', cost:78},
  {d:'2026-03-22',date:'MAR 22 · 26', artists:[{name:'Hadestown'}], venue:'Walter Kerr', city:'New York NY', kind:'theatre', cost:148},
  {d:'2026-03-08',date:'MAR 08 · 26', artists:[{name:'Mitski'},{name:'Julia Jacklin',role:'support'}], venue:'Radio City', city:'New York NY', kind:'concert', cost:120},
  {d:'2026-02-14',date:'FEB 14 · 26', artists:[{name:'John Mulaney'}], venue:'Beacon Theatre', city:'New York NY', kind:'comedy', cost:95},
  {d:'2026-02-01',date:'FEB 01 · 26', artists:[{name:'Slowdive'},{name:'Drab Majesty',role:'support'}], venue:'Brooklyn Steel', city:'Brooklyn NY', kind:'concert', cost:65},
  {d:'2026-01-18',date:'JAN 18 · 26', artists:[{name:'The Outsiders'}], venue:'Bernard Jacobs', city:'New York NY', kind:'theatre', cost:132},
  {d:'2025-12-20',date:'DEC 20 · 25', artists:[{name:'Vampire Weekend'}], venue:'MSG', city:'New York NY', kind:'concert', cost:140},
  {d:'2025-11-02',date:'NOV 02 · 25', artists:[{name:'All Things Go'},{name:'Hozier',role:'headliner'},{name:'Laufey',role:'headliner'},{name:'+4 more'}], venue:'Forest Hills Stadium', city:'Queens NY', kind:'festival', cost:210},
  {d:'2025-10-11',date:'OCT 11 · 25', artists:[{name:'Japanese Breakfast'}], venue:'Kings Theatre', city:'Brooklyn NY', kind:'concert', cost:82},
];

function History(){
  return (
    <Chrome active="History">
      <div style={{display:'grid',gridTemplateColumns:'110px 1fr 360px',height:'100%'}}>
        {/* YEAR RAILS */}
        <div style={{padding:'24px 16px',borderRight:'1.25px solid #2a2520',background:'#fff'}}>
          <div className="wf-label" style={{marginBottom:10}}>years</div>
          {[['2026',14,true],['2025',22],['2024',18],['2023',9],['2022',14],['2021',5],['2020',0],['2019',3]].map(([y,c,sel])=>(
            <div key={y} style={{padding:'8px 10px',fontFamily:'JetBrains Mono',borderLeft:sel?'3px solid #2a2520':'1.25px solid #ece9e2',background:sel?'#ece9e2':'transparent',marginBottom:2}}>
              <div style={{fontSize:sel?16:13,fontWeight:sel?700:400,color:c===0?'#bbb':'#2a2520'}}>{y}</div>
              <div className="wf-label" style={{fontSize:8,marginTop:2}}>{c} shows</div>
            </div>
          ))}
          <div className="wf-label" style={{marginTop:14}}>all · 87</div>
        </div>

        {/* MAIN LIST */}
        <div style={{padding:'20px 28px',display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:10}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:-.3}}>2026 · 14 shows</div>
              <div className="wf-label">$1,284 · 9 venues · 22 artists</div>
            </div>
            <div style={{display:'flex',gap:6}}>
              <div className="wf-chip">all kinds ▾</div>
              <div className="wf-chip">all venues ▾</div>
              <div className="wf-chip">sort: date ▾</div>
            </div>
          </div>

          {/* column header */}
          <div style={{display:'grid',gridTemplateColumns:'88px 1.3fr 1fr 90px 64px',padding:'6px 10px',background:'#ece9e2',border:'1.25px solid #2a2520'}} className="wf-label">
            <div>date</div><div>lineup</div><div>venue · city</div><div>kind</div><div style={{textAlign:'right'}}>cost</div>
          </div>
          <div style={{borderLeft:'1.25px solid #2a2520',borderRight:'1.25px solid #2a2520',borderBottom:'1.25px solid #2a2520',background:'#fff'}}>
            {PAST.map((s,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'88px 1.3fr 1fr 90px 64px',padding:'11px 10px',borderTop:i===0?'none':'1.25px solid #ece9e2',alignItems:'center'}}>
                <div className="wf-mono" style={{fontSize:10}}>{s.date}</div>
                <div>
                  <ArtistStack artists={s.artists.slice(0,3)} size={13} showRole={s.artists.length>1}/>
                  {s.artists.length>3 && <div className="wf-label" style={{fontSize:8,marginTop:1}}>{s.artists[s.artists.length-1].name}</div>}
                </div>
                <div style={{fontSize:12}}>
                  <div>{s.venue}</div>
                  <div className="wf-label" style={{fontSize:9}}>{s.city}</div>
                </div>
                <div><span className="wf-chip" style={{fontSize:9}}>{s.kind}</span></div>
                <div className="wf-num" style={{fontSize:12,textAlign:'right'}}>${s.cost}</div>
              </div>
            ))}
          </div>
        </div>

        {/* MAP PANEL */}
        <div style={{borderLeft:'1.25px solid #2a2520',padding:'20px 22px',background:'#fafaf7',display:'flex',flexDirection:'column',gap:14,overflow:'hidden'}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>geography · 2026</div>
            <div style={{height:220}}>
              <MapSketch style={{width:'100%',height:'100%',border:'1.25px solid #2a2520'}} dots={[
                {x:355,y:210,r:8,count:4},{x:360,y:232,r:6,count:2},{x:340,y:200,r:5,count:2},
                {x:380,y:240,r:4},{x:320,y:250,r:3},
              ]} labels={[{x:370,y:260,t:'NYC · 12'}]}/>
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:4}}>click a pin to filter list ↑</div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>venues this year</div>
            {[['Kings Theatre',4],['Walter Kerr',2],['Radio City',2],['Beacon',1],['Bklyn Steel',1]].map(([n,c],i)=>(
              <div key={n} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderTop:i===0?'1.25px solid #2a2520':'1.25px solid #ece9e2',fontSize:11}}>
                <span>{n}</span>
                <span className="wf-num">{c}</span>
              </div>
            ))}
          </div>
        </div>

        <Annot top={50} left={'10%'} w={150} rotate={-3}>year = primary nav · dense rhythm is visible</Annot>
        <Annot top={50} right={30} w={170} rotate={3}>map = geographic filter ·<br/>same data, new lens</Annot>
      </div>
    </Chrome>
  );
}

window.HistoryVariants = [
  {id:'history', label:'History · refined (year rails + ledger + map filter)', render:()=><History/>},
];
