// Single show detail — three variants, one per KIND.
// Concert  · setlist.fm powered
// Comedy   · no setlist — material / tour / special context
// Theatre · cast on the night (auto-scraped from Playbill), production timeline
// All data is AUTO-FETCHED. The user never types cast, setlist, or lineup.
const { Chrome, ImgPh, Annot } = window;

// ──────────── shared source badge ────────────
function Source({src, note}){
  return (
    <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'3px 8px',border:'1.25px dashed #c96442',background:'#fff',fontSize:10,fontFamily:'JetBrains Mono',color:'#c96442'}}>
      <span>⟲</span><span>auto · {src}</span>{note && <span style={{color:'#8a827a'}}>· {note}</span>}
    </div>
  );
}

function DataGrid({rows}){
  return (
    <div style={{border:'1.25px solid #2a2520',background:'#fff'}}>
      {rows.map(([k,v,mono],i)=>(
        <div key={k} style={{display:'grid',gridTemplateColumns:'100px 1fr',gap:12,padding:'10px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2'}}>
          <div className="wf-label" style={{alignSelf:'center'}}>{k}</div>
          <div style={{fontSize:13,fontFamily:mono?'JetBrains Mono':'Inter'}}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ──────────── CONCERT ────────────
function ShowConcert(){
  return (
    <Chrome active="History">
      <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr',height:'100%'}}>
        <div style={{padding:'22px 30px',borderRight:'1.25px solid #2a2520',overflow:'hidden'}}>
          <div className="wf-label">← history · Sat Apr 04 · 2026</div>
          <div style={{display:'flex',alignItems:'baseline',gap:12,marginTop:8,flexWrap:'wrap'}}>
            <div style={{fontSize:30,fontWeight:800,letterSpacing:-.5,lineHeight:1.05}}>
              Fontaines D.C.<span style={{fontWeight:400,color:'#6b645a'}}> · </span>
              <span style={{fontWeight:500,color:'#6b645a'}}>Been Stellar</span>
            </div>
            <div className="wf-chip" style={{background:'#2a2520',color:'#fff'}}>concert</div>
          </div>
          <div style={{fontSize:13,color:'#6b645a',marginTop:4}}>Kings Theatre · Brooklyn NY</div>

          <div style={{marginTop:14}}>
            <DataGrid rows={[
              ['date','Sat Apr 04 · 2026 · Doors 7:00 · Show 8:00'],
              ['venue','Kings Theatre'],
              ['seat','Orchestra · Row M · 14',true],
              ['source','Ticketmaster'],
              ['paid','$78.00',true],
            ]}/>
          </div>

          <div style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
              <div className="wf-label">lineup · 2 artists</div>
              <div className="wf-label" style={{fontSize:9}}>one show, many artists</div>
            </div>
            {[
              {name:'Fontaines D.C.',role:'headliner',set:'16 songs · 72 min',seen:'3rd time'},
              {name:'Been Stellar',role:'support',set:'8 songs · 35 min',seen:'1st time'},
            ].map((a,i)=>(
              <div key={i} className="wf-box" style={{padding:'11px 14px',marginBottom:6,background:'#fff',display:'grid',gridTemplateColumns:'1fr auto auto',gap:14,alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700}}>{a.name}</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:2}}>{a.role} · {a.set}</div>
                </div>
                <div style={{textAlign:'center',borderLeft:'1.25px solid #ece9e2',paddingLeft:14}}>
                  <div style={{fontSize:16,fontWeight:700}}>{a.seen}</div>
                </div>
                <div className="wf-chip" style={{fontSize:9}}>artist →</div>
              </div>
            ))}
          </div>

          <div style={{marginTop:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
              <div className="wf-label">setlist</div>
              <Source src="setlist.fm"/>
            </div>
            <div className="wf-box" style={{padding:'11px 16px',background:'#fff',columnCount:2,columnGap:24}}>
              {[['Romance',0],['Starburster',0],['Here\'s the Thing',1],['Jackie Down the Line',0],['In the Modern World',0],['Favourite',1],['Nabokov',0],['Bug',0],['I Love You',0],['Big Shot',1],['Boys in the Better Land',0],['A Hero\'s Death',1]].map(([t,n],i)=>(
                <div key={i} style={{fontSize:11,padding:'3px 0',fontFamily:'JetBrains Mono',display:'flex',gap:8,breakInside:'avoid'}}>
                  <span className="wf-label" style={{fontSize:9,width:16}}>{String(i+1).padStart(2,'0')}</span>
                  <span style={{flex:1}}>{t}</span>
                  {n?<span style={{color:'#c96442'}}>◆</span>:null}
                </div>
              ))}
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:6}}>◆ first-time live · 4 of 12 new to you · 47 unique Fontaines songs across 3 shows</div>
          </div>
        </div>

        <div style={{padding:'22px 24px',display:'flex',flexDirection:'column',gap:16,overflow:'hidden'}}>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <div className="wf-label">your photos · 3</div>
              <div className="wf-chip" style={{fontSize:9}}>+ attach</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
              {[1,2,3].map(i=><ImgPh key={i} label={`ph ${i}`} h={84}/>)}
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>at Kings Theatre · 12 visits</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[['APR 04 · 26','Fontaines D.C.',1],['OCT 11 · 25','Japanese Breakfast'],['JUN 02 · 25','Alvvays'],['OCT 14 · 24','Big Thief'],['APR 22 · 24','Waxahatchee']].map(([d,a,sel],i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 12px',borderTop:i===0?'none':'1.25px solid #ece9e2',fontSize:11,background:sel?'#ece9e2':'transparent'}}>
                  <span style={{fontWeight:sel?700:400}}>{a}</span>
                  <span className="wf-mono" style={{fontSize:10,color:'#6b645a'}}>{d}</span>
                </div>
              ))}
              <div className="wf-label" style={{padding:'6px 12px',borderTop:'1.25px solid #2a2520',fontSize:9}}>+7 earlier · venue →</div>
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>with Fontaines D.C. · 3rd time</div>
            <div style={{position:'relative',padding:'4px 0'}}>
              <div style={{position:'absolute',left:10,top:12,bottom:12,width:1.25,background:'#2a2520'}}/>
              {[['APR 04 · 26','Kings Theatre',1],['OCT 11 · 24','Terminal 5'],['JUN 22 · 22','Brooklyn Steel']].map(([d,v,cur],i)=>(
                <div key={i} style={{position:'relative',padding:'5px 0 5px 28px'}}>
                  <div style={{position:'absolute',left:6,top:10,width:10,height:10,borderRadius:'50%',background:cur?'#c96442':'#fff',border:'1.25px solid #2a2520'}}/>
                  <div style={{fontSize:12,fontWeight:cur?700:400}}>{v}</div>
                  <div className="wf-label" style={{fontSize:9}}>{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <Annot top={210} left={'32%'} w={170} rotate={-3}>setlist = fetched ·<br/>user never types it</Annot>
      </div>
    </Chrome>
  );
}

// ──────────── COMEDY ────────────
function ShowComedy(){
  return (
    <Chrome active="History">
      <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr',height:'100%'}}>
        <div style={{padding:'22px 30px',borderRight:'1.25px solid #2a2520',overflow:'hidden'}}>
          <div className="wf-label">← history · Sat Feb 14 · 2026</div>
          <div style={{display:'flex',alignItems:'baseline',gap:12,marginTop:8,flexWrap:'wrap'}}>
            <div style={{fontSize:30,fontWeight:800,letterSpacing:-.5,lineHeight:1.05}}>John Mulaney</div>
            <div style={{fontSize:15,fontFamily:'Fraunces, serif',fontStyle:'italic',color:'#6b645a'}}>"All Is Forgiven"</div>
            <div className="wf-chip" style={{background:'#2a2520',color:'#fff'}}>comedy</div>
          </div>
          <div style={{fontSize:13,color:'#6b645a',marginTop:4}}>Beacon Theatre · New York NY</div>

          <div style={{marginTop:14}}>
            <DataGrid rows={[
              ['date','Sat Feb 14 · 2026 · 8:00 pm'],
              ['venue','Beacon Theatre'],
              ['seat','Mezzanine · Row C · 22',true],
              ['tour','"All Is Forgiven" · 48-city run'],
              ['source','Ticketmaster'],
              ['paid','$95.00',true],
            ]}/>
          </div>

          <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div className="wf-box" style={{padding:'14px 16px',background:'#fff'}}>
              <div className="wf-label" style={{marginBottom:6}}>with Mulaney · 3rd time</div>
              <div style={{fontSize:26,fontWeight:800,letterSpacing:-.5,fontFamily:'Fraunces, serif'}}>3rd</div>
              <div className="wf-label" style={{fontSize:9}}>first: 2019 · Chicago Theatre</div>
            </div>
            <div className="wf-box" style={{padding:'14px 16px',background:'#fff'}}>
              <div className="wf-label" style={{marginBottom:6}}>opener</div>
              <div style={{fontSize:14,fontWeight:700}}>Marcello Hernández</div>
              <div className="wf-label" style={{fontSize:9,marginTop:2}}>1st time · now tracked</div>
            </div>
          </div>

          <div style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
              <div className="wf-label">material context</div>
              <Source src="Wikipedia + Netflix" note="tour → special linkage"/>
            </div>
            <div className="wf-box" style={{padding:'12px 16px',background:'#fff'}}>
              <div style={{fontSize:13,lineHeight:1.55,fontFamily:'Fraunces, serif'}}>
                Pre-special material. Mulaney's tours typically become a Netflix release 12–18 months after the run wraps.
                This is the first tour since "Baby J" (2023).
              </div>
              <div className="wf-label" style={{fontSize:9,marginTop:8}}>likely special release: late 2026 / early 2027</div>
            </div>
          </div>

          <div style={{marginTop:14}}>
            <div className="wf-label" style={{marginBottom:6}}>his specials · which you've already seen</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[
                {t:'"From Scratch"',net:'Netflix · 2024',saw:'saw the tour'},
                {t:'"Baby J"',net:'Netflix · 2023',saw:null},
                {t:'"Kid Gorgeous"',net:'Netflix · 2018',saw:'saw the tour'},
                {t:'"The Comeback Kid"',net:'Netflix · 2015',saw:null},
              ].map(sp=>(
                <div key={sp.t} className="wf-box" style={{padding:'10px 12px',background:'#fff'}}>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:'Fraunces, serif'}}>{sp.t}</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:2}}>{sp.net}</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:4,color:sp.saw?'#c96442':'#8a827a'}}>{sp.saw || '— not seen live'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{padding:'22px 24px',display:'flex',flexDirection:'column',gap:16,overflow:'hidden'}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your photos · 2</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              <ImgPh label="ph 1" h={100}/><ImgPh label="ph 2" h={100}/>
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>at Beacon · 6 visits</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[['FEB 14 · 26','John Mulaney',1],['JUL 22 · 25','Iliza Shlesinger'],['MAR 08 · 25','Matt Rife'],['NOV 12 · 24','Sarah Silverman']].map(([d,a,sel],i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 12px',borderTop:i===0?'none':'1.25px solid #ece9e2',fontSize:11,background:sel?'#ece9e2':'transparent'}}>
                  <span style={{fontWeight:sel?700:400}}>{a}</span>
                  <span className="wf-mono" style={{fontSize:10,color:'#6b645a'}}>{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your comedy footprint</div>
            <div className="wf-box" style={{padding:'12px 14px',background:'#fff',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontFamily:'JetBrains Mono'}}>
              <div><div style={{fontSize:18,fontWeight:700}}>8</div><div className="wf-label" style={{fontSize:8}}>stand-ups seen</div></div>
              <div><div style={{fontSize:18,fontWeight:700}}>6</div><div className="wf-label" style={{fontSize:8}}>distinct comics</div></div>
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>upcoming for Mulaney</div>
            <div className="wf-box" style={{padding:'10px 12px',background:'#fff',borderStyle:'dashed'}}>
              <div className="wf-mono" style={{fontSize:11}}>OCT 04 · 26 · MSG</div>
              <div className="wf-label" style={{fontSize:9,marginTop:4}}>notify me when on sale · ○</div>
            </div>
          </div>
        </div>
        <Annot top={204} left={'30%'} w={170} rotate={3}>comedy = tour + material ·<br/>no setlist equivalent</Annot>
      </div>
    </Chrome>
  );
}

// ──────────── THEATRE / MUSICAL ────────────
function ShowBroadway(){
  return (
    <Chrome active="History">
      <div style={{display:'grid',gridTemplateColumns:'1.6fr 1fr',height:'100%'}}>
        <div style={{padding:'22px 30px',borderRight:'1.25px solid #2a2520',overflow:'hidden'}}>
          <div className="wf-label">← history · Sun Mar 22 · 2026</div>
          <div style={{display:'flex',alignItems:'baseline',gap:12,marginTop:8,flexWrap:'wrap'}}>
            <div style={{fontSize:30,fontWeight:800,letterSpacing:-.5,fontFamily:'Fraunces, serif',fontStyle:'italic',lineHeight:1.05}}>Hadestown</div>
            <div className="wf-chip" style={{background:'#2a2520',color:'#fff'}}>theatre · musical</div>
          </div>
          <div style={{fontSize:13,color:'#6b645a',marginTop:4}}>Walter Kerr Theatre · West 48th St</div>

          <div style={{marginTop:14}}>
            <DataGrid rows={[
              ['date','Sun Mar 22 · 2026 · 3:00 pm matinée'],
              ['theatre','Walter Kerr Theatre'],
              ['seat','Orchestra · Row M · 14',true],
              ['production','Broadway · open run since 2019'],
              ['source','Telecharge'],
              ['paid','$148.00',true],
            ]}/>
          </div>

          <div style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
              <div className="wf-label">cast on the night · 2026-03-22</div>
              <Source src="Playbill" note="scraped by show-date"/>
            </div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[
                ['Orpheus','Jordan Fisher',true],
                ['Eurydice','Phillipa Soo'],
                ['Hades','Phillip Boykin'],
                ['Persephone','Lillias White',true],
                ['Hermes','Lillias White'],
                ['Fates','Emily Afton · Bex Odorisio · Belén Moyano'],
              ].map(([role,who,replace],i)=>(
                <div key={i} style={{display:'grid',gridTemplateColumns:'110px 1fr 70px',gap:10,padding:'9px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2',alignItems:'center'}}>
                  <div className="wf-label" style={{fontSize:10}}>{role}</div>
                  <div style={{fontSize:13,fontFamily:'Fraunces, serif'}}>{who}</div>
                  {replace && <div className="wf-label" style={{fontSize:8,color:'#c96442',textAlign:'right'}}>u/s · original out</div>}
                </div>
              ))}
            </div>
            <div className="wf-label" style={{fontSize:9,marginTop:6}}>auto-captured the day you saw it · never edit manually</div>
          </div>

          <div style={{marginTop:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="wf-box" style={{padding:'12px 14px',background:'#fff'}}>
              <div className="wf-label" style={{marginBottom:4}}>credits</div>
              <div style={{fontSize:12,lineHeight:1.6}}>
                <div><b>Book / Music</b> · Anaïs Mitchell</div>
                <div><b>Director</b> · Rachel Chavkin</div>
                <div><b>Choreo</b> · David Neumann</div>
              </div>
            </div>
            <div className="wf-box" style={{padding:'12px 14px',background:'#fff'}}>
              <div className="wf-label" style={{marginBottom:4}}>awards</div>
              <div style={{fontSize:12,lineHeight:1.6,fontFamily:'Fraunces, serif'}}>
                <div>8 Tony Awards · 2019</div>
                <div>Best Musical</div>
                <div>Grammy · Best Musical Album</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{padding:'22px 24px',display:'flex',flexDirection:'column',gap:16,overflow:'hidden'}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your photos · playbill</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              <ImgPh label="playbill" h={110}/><ImgPh label="inside" h={110}/>
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your Hadestown history · 2nd time</div>
            <div style={{position:'relative',padding:'4px 0'}}>
              <div style={{position:'absolute',left:10,top:12,bottom:12,width:1.25,background:'#2a2520'}}/>
              {[
                {d:'MAR 22 · 26',cast:'Fisher / Soo / Boykin',cur:true},
                {d:'NOV 09 · 22',cast:'Carney / Pfeiffer / Page'},
              ].map((s,i)=>(
                <div key={i} style={{position:'relative',padding:'6px 0 6px 28px'}}>
                  <div style={{position:'absolute',left:6,top:10,width:10,height:10,borderRadius:'50%',background:s.cur?'#c96442':'#fff',border:'1.25px solid #2a2520'}}/>
                  <div style={{fontSize:11,fontFamily:'Fraunces, serif'}}>{s.cast}</div>
                  <div className="wf-label" style={{fontSize:9}}>{s.d}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>at Walter Kerr · 3 visits</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[['MAR 22 · 26','Hadestown',1],['NOV 09 · 22','Hadestown'],['FEB 14 · 20','Six']].map(([d,a,sel],i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 12px',borderTop:i===0?'none':'1.25px solid #ece9e2',fontSize:11,background:sel?'#ece9e2':'transparent'}}>
                  <span style={{fontFamily:'Fraunces, serif',fontWeight:sel?700:400,fontStyle:'italic'}}>{a}</span>
                  <span className="wf-mono" style={{fontSize:10,color:'#6b645a'}}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <Annot top={210} left={'28%'} w={180} rotate={-3}>cast = Playbill scrape on<br/>your exact date · zero typing</Annot>
      </div>
    </Chrome>
  );
}

window.DetailVariants = [
  {id:'det_concert',  label:'Concert · Fontaines D.C. (setlist.fm-powered)',   render:()=><ShowConcert/>},
  {id:'det_comedy',   label:'Comedy · John Mulaney (tour + material context)', render:()=><ShowComedy/>},
  {id:'det_broadway', label:'Theatre · Hadestown (cast on the night, Playbill)', render:()=><ShowBroadway/>},
];
