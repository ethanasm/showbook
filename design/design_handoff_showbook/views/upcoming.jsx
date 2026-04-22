// Upcoming — refined. MERGE of A (chronological radar) + C (venue-grouped).
// One screen: filters → chronological list with venue sticky-groups.
// Discovery helpers (scan email / paste URL / upload PDF) sit in a small secondary rail — NOT primary.
const { Chrome, Annot, ArtistStack } = window;

const UP = [
  {d:'APR 26',w:'Sat',artists:[{name:'Caroline Polachek'}],v:'Knockdown Center',c:'Queens NY',k:'concert',tix:true,in:'6d',price:92,src:'Ticketmaster'},
  {d:'MAY 04',w:'Mon',artists:[{name:'Big Thief'},{name:'Madi Diaz',role:'support'}],v:'Forest Hills Stadium',c:'Queens NY',k:'concert',tix:true,in:'2w',price:78,src:'AXS'},
  {d:'MAY 12',w:'Tue',artists:[{name:'Oh, Mary!'}],v:'Lyceum Theatre',c:'New York NY',k:'theatre',tix:true,in:'3w',price:145,src:'Telecharge'},
  {d:'MAY 28',w:'Thu',artists:[{name:'Governors Ball'},{name:'Olivia Rodrigo',role:'headliner'},{name:'Tyler, The Creator',role:'headliner'},{name:'Hozier',role:'headliner'},{name:'+8 more'}],v:'Flushing Meadows',c:'Queens NY',k:'festival',tix:false,in:'5w',price:null,src:'watching'},
  {d:'JUN 07',w:'Sun',artists:[{name:'Matt Rife'}],v:'Beacon Theatre',c:'New York NY',k:'comedy',tix:false,in:'7w',price:null,src:'wishlist'},
  {d:'JUN 15',w:'Sun',artists:[{name:'& Juliet'}],v:'Stephen Sondheim',c:'New York NY',k:'theatre',tix:false,in:'8w',price:null,src:'wishlist'},
  {d:'JUL 12',w:'Sun',artists:[{name:'Phoebe Bridgers'}],v:'Forest Hills Stadium',c:'Queens NY',k:'concert',tix:true,in:'12w',price:110,src:'Ticketmaster'},
  {d:'AUG 03',w:'Mon',artists:[{name:'Hozier'}],v:'MSG',c:'New York NY',k:'concert',tix:false,in:'15w',price:null,src:'on sale fri'},
];

function FilterBar({activeKind='all'}){
  return (
    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <div className="wf-label" style={{marginRight:4}}>type:</div>
      {['all','concert','festival','theatre','comedy'].map(k=>(
        <div key={k} className="wf-chip" style={{fontSize:10,padding:'3px 8px',background:k===activeKind?'#2a2520':'#fff',color:k===activeKind?'#fff':'#2a2520'}}>{k}</div>
      ))}
      <div style={{width:1,height:18,background:'#8a827a',margin:'0 4px'}}/>
      <div className="wf-label" style={{marginRight:4}}>venue:</div>
      <div className="wf-chip" style={{fontSize:10,padding:'3px 8px'}}>all venues ▾</div>
      <div style={{flex:1}}/>
      <div className="wf-chip" style={{fontSize:10,padding:'3px 8px',background:'#2a2520',color:'#fff'}}>have tix</div>
      <div className="wf-chip" style={{fontSize:10,padding:'3px 8px'}}>watching</div>
      <div className="wf-chip" style={{fontSize:10,padding:'3px 8px'}}>both</div>
    </div>
  );
}

// Group UP by venue for the secondary lens. Also build date-sorted list for main column.
const byVenue = UP.reduce((acc,s)=>{(acc[s.v]=acc[s.v]||[]).push(s); return acc;},{});
const venueGroups = Object.entries(byVenue).sort((a,b)=>b[1].length-a[1].length);

function UpMerged(){
  return (
    <Chrome active="Upcoming">
      <div style={{display:'grid',gridTemplateColumns:'1fr 300px',height:'100%'}}>
        {/* MAIN — chronological radar (A) */}
        <div style={{padding:'22px 28px',borderRight:'1.25px solid #2a2520',display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:10}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:-.3}}>Upcoming</div>
              <div className="wf-label">3 with tickets · 5 watching · next 15 weeks</div>
            </div>
            <div className="wf-chip" style={{fontSize:10}}>sort: date ▾</div>
          </div>
          <div style={{marginBottom:12}}><FilterBar/></div>

          <div className="wf-box scroll-hide" style={{background:'#fff',flex:1,overflow:'auto'}}>
            <div style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 90px 70px 100px',padding:'7px 14px',background:'#ece9e2',borderBottom:'1.25px solid #2a2520',position:'sticky',top:0}} className="wf-label">
              <div>when</div><div>lineup</div><div>venue</div><div>kind</div><div style={{textAlign:'right'}}>price</div><div style={{textAlign:'right'}}>status</div>
            </div>
            {UP.map((s,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 90px 70px 100px',padding:'12px 14px',borderBottom:i===UP.length-1?'none':'1.25px solid #ece9e2',alignItems:'center'}}>
                <div>
                  <div className="wf-mono" style={{fontSize:12,fontWeight:700}}>{s.d}</div>
                  <div className="wf-label" style={{fontSize:9}}>{s.w} · {s.in}</div>
                </div>
                <div>
                  <ArtistStack artists={s.artists.slice(0,3)} size={13} showRole={s.artists.length>1}/>
                  {s.artists.length>3 && <div className="wf-label" style={{fontSize:8,marginTop:1}}>{s.artists[s.artists.length-1].name}</div>}
                </div>
                <div style={{fontSize:12}}>
                  <div>{s.v}</div>
                  <div className="wf-label" style={{fontSize:9}}>{s.c}</div>
                </div>
                <div><span className="wf-chip" style={{fontSize:9}}>{s.k}</span></div>
                <div className="wf-num" style={{fontSize:12,textAlign:'right'}}>{s.price?`$${s.price}`:'—'}</div>
                <div style={{textAlign:'right'}}>
                  {s.tix
                    ? <div className="wf-chip" style={{fontSize:9,background:'#2a2520',color:'#fff',borderColor:'#2a2520'}}>tix ✓</div>
                    : <div className="wf-chip" style={{fontSize:9,background:'#fafaf7',borderStyle:'dashed'}}>{s.src}</div>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — venue lens (C) + secondary discovery rail */}
        <div style={{padding:'22px 22px',background:'#fafaf7',display:'flex',flexDirection:'column',gap:18,overflow:'hidden'}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>by venue · click to filter list</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {venueGroups.map(([v,rows],i)=>(
                <div key={v} style={{padding:'9px 12px',borderTop:i===0?'none':'1.25px solid #ece9e2',display:'grid',gridTemplateColumns:'1fr auto',gap:8,alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600}}>{v}</div>
                    <div className="wf-label" style={{fontSize:8,marginTop:2}}>
                      {rows.map((s,j)=><span key={j}>{s.d}{j<rows.length-1?' · ':''}</span>)}
                    </div>
                  </div>
                  <div className="wf-chip" style={{fontSize:9}}>{rows.length}</div>
                </div>
              ))}
            </div>
          </div>

          {/* secondary — discovery helpers, NOT primary */}
          <div>
            <div className="wf-label" style={{marginBottom:6}}>or import from… <span style={{color:'#c96442',textTransform:'none',letterSpacing:0,fontFamily:'Inter'}}>— works for past & future</span></div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <div className="wf-soft" style={{padding:'9px 12px',fontSize:11,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>📧 scan gmail for receipts</span>
                <span className="wf-label" style={{fontSize:9}}>→</span>
              </div>
              <div className="wf-soft" style={{padding:'9px 12px',fontSize:11,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>🔗 paste ticketmaster URL</span>
                <span className="wf-label" style={{fontSize:9}}>→</span>
              </div>
              <div className="wf-soft" style={{padding:'9px 12px',fontSize:11,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>📄 upload PDF ticket</span>
                <span className="wf-label" style={{fontSize:9}}>→</span>
              </div>
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:6,lineHeight:1.5}}>
              also: ticketmaster API keeps this list fresh for saved artists & venues
            </div>
          </div>

          <div style={{marginTop:'auto'}}>
            <div className="wf-label" style={{marginBottom:6}}>totals · next 90d</div>
            <div className="wf-box" style={{padding:'10px 12px',background:'#fff',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontFamily:'JetBrains Mono'}}>
              <div><div style={{fontSize:18,fontWeight:700}}>6</div><div className="wf-label" style={{fontSize:8}}>shows</div></div>
              <div><div style={{fontSize:18,fontWeight:700}}>$425</div><div className="wf-label" style={{fontSize:8}}>tix paid</div></div>
            </div>
          </div>
        </div>

        <Annot top={90} left={'48%'} w={160} rotate={-2}>one chronological list ·<br/>filters do the work</Annot>
        <Annot top={150} right={24} w={150} rotate={3}>venue lens = secondary ·<br/>click row to filter</Annot>
        <Annot top={400} right={24} w={160} rotate={-2}>import tools tucked away ·<br/>not the primary UI</Annot>
      </div>
    </Chrome>
  );
}

window.UpcomingVariants = [
  {id:'up_merged', label:'Upcoming · merged (radar list + venue lens + import helpers)', render:()=><UpMerged/>},
];
