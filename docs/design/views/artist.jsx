// Artist page — different layouts for CONCERT, COMEDY, and THEATRE/MUSICAL.
// Each kind has its own data model:
//   concert  → tours + shows + songs-heard-live + setlist density
//   comedy   → specials seen + material context (HBO/Netflix releases) + tours
//   theatre → productions (show runs) + role played + Tony history + revivals
const { Chrome, Annot, MapSketch, ImgPh } = window;

function Hero({title,meta,stats,right}){
  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr',gap:28,marginTop:12}}>
        <div>
          <div style={{fontSize:40,fontWeight:800,letterSpacing:-1,fontFamily:'Fraunces, serif',lineHeight:1}}>{title}</div>
          <div className="wf-label" style={{marginTop:8}}>{meta}</div>
          <div style={{display:'flex',gap:10,marginTop:14,flexWrap:'wrap'}}>
            {stats.map(([v,l])=>(
              <div key={l} className="wf-box" style={{padding:'8px 14px',background:'#fff'}}>
                <div style={{fontSize:20,fontWeight:700,letterSpacing:-.3,fontFamily:'Fraunces, serif'}}>{v}</div>
                <div className="wf-label" style={{fontSize:9}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div>{right || <ImgPh label="photo" h={140}/>}</div>
      </div>
    </>
  );
}

// ─────────────────────────── CONCERT ───────────────────────────
function ArtistConcert(){
  return (
    <Chrome active="History">
      <div style={{padding:'22px 36px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10}}>
          <div className="wf-label">← artists</div>
          <div className="wf-chip" style={{fontSize:9,background:'#2a2520',color:'#fff'}}>concert</div>
        </div>
        <Hero
          title="Fontaines D.C."
          meta="post-punk · dublin · est. 2017"
          stats={[['3','times seen'],['1st','Jun 2022'],['47','songs heard live'],['4','tours tracked']]}
        />
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:22,marginTop:22}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>where you've caught them · 3 cities</div>
            <div style={{height:180}}>
              <MapSketch style={{width:'100%',height:'100%',border:'1.25px solid #2a2520'}} dots={[
                {x:355,y:215,r:8,count:2,label:'Brooklyn · 2'},
                {x:365,y:200,r:6,count:1,label:'Manhattan · 1'},
              ]} labels={[{x:370,y:180,t:'NYC · 3 shows'}]}/>
            </div>
            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>your shows · by tour</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[
                {d:'APR 04 · 26',v:'Kings Theatre',tour:'Romance Tour',songs:14},
                {d:'OCT 11 · 24',v:'Terminal 5',tour:'Skinty Fia',songs:15},
                {d:'JUN 22 · 22',v:'Brooklyn Steel',tour:'(supporting IDLES)',songs:8},
              ].map((s,i)=>(
                <div key={i} style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 60px',gap:10,padding:'10px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2',alignItems:'center'}}>
                  <div className="wf-mono" style={{fontSize:11}}>{s.d}</div>
                  <div style={{fontSize:12,fontWeight:600}}>{s.v}</div>
                  <div className="wf-label" style={{fontSize:10,fontStyle:'italic',letterSpacing:0,textTransform:'none',fontFamily:'Inter',color:'#6b645a'}}>{s.tour}</div>
                  <div className="wf-num" style={{fontSize:11,textAlign:'right'}}>{s.songs} songs</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>upcoming tour · not ticketed yet</div>
            <div className="wf-box" style={{background:'#fff',padding:'12px 14px',borderStyle:'dashed'}}>
              <div className="wf-mono" style={{fontSize:11}}>JUL 28 · 26</div>
              <div style={{fontSize:13,fontWeight:600,marginTop:2}}>Kilmainham, Dublin IE</div>
              <div className="wf-label" style={{fontSize:9,marginTop:6}}>notify when on sale · ○</div>
            </div>
            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>songs heard live · from setlist.fm</div>
            <div className="wf-box" style={{padding:'12px 14px',background:'#fff'}}>
              <div style={{fontSize:11,lineHeight:1.65,fontFamily:'JetBrains Mono',columnCount:2,columnGap:16}}>
                {['Boys in the Better Land','Big Shot ◆','Starburster','Favourite ◆','Romance','Nabokov','Bug','Jackie Down the Line','I Love You','In the Modern World','A Hero\'s Death ◆','Here\'s the Thing ◆'].map((t,i)=>(
                  <div key={i} style={{breakInside:'avoid'}}>{t}</div>
                ))}
              </div>
              <div className="wf-label" style={{fontSize:8,marginTop:6}}>◆ first time · 12 of 47 shown</div>
            </div>
            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>related artists you've seen</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['IDLES','Shame','Dry Cleaning','The Murder Capital','Been Stellar'].map(a=>(
                <div key={a} className="wf-chip" style={{fontSize:10}}>{a}</div>
              ))}
            </div>
          </div>
        </div>
        <Annot top={96} right={30} w={160} rotate={3}>concert page = tours +<br/>setlists + tour-map</Annot>
      </div>
    </Chrome>
  );
}

// ─────────────────────────── COMEDY ───────────────────────────
function ArtistComedy(){
  return (
    <Chrome active="History">
      <div style={{padding:'22px 36px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10}}>
          <div className="wf-label">← comedians</div>
          <div className="wf-chip" style={{fontSize:9,background:'#2a2520',color:'#fff'}}>comedy</div>
        </div>
        <Hero
          title="John Mulaney"
          meta="stand-up · sack lunch bunch era"
          stats={[['3','times seen'],['1st','Feb 2019'],['2','tours tracked'],['5','specials released']]}
        />

        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:22,marginTop:22}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your shows · by tour / material</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[
                {d:'FEB 14 · 26',v:'Beacon Theatre',tour:'"All Is Forgiven"',mat:'new material · pre-special'},
                {d:'MAR 09 · 23',v:'Radio City',tour:'"From Scratch"',mat:'became the Netflix special'},
                {d:'OCT 22 · 19',v:'Chicago Theatre',tour:'"Kid Gorgeous" run',mat:'last tour pre-rehab'},
              ].map((s,i)=>(
                <div key={i} style={{padding:'12px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2'}}>
                  <div style={{display:'grid',gridTemplateColumns:'90px 1fr 120px',gap:10,alignItems:'center'}}>
                    <div className="wf-mono" style={{fontSize:11}}>{s.d}</div>
                    <div style={{fontSize:12,fontWeight:600}}>{s.v}</div>
                    <div style={{fontSize:11,fontFamily:'Fraunces, serif',fontStyle:'italic',textAlign:'right'}}>{s.tour}</div>
                  </div>
                  <div className="wf-label" style={{fontSize:9,marginTop:4,letterSpacing:0,textTransform:'none',fontFamily:'Inter',color:'#6b645a'}}>{s.mat}</div>
                </div>
              ))}
            </div>

            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>specials you've seen become…</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[
                {t:'From Scratch',net:'Netflix',yr:'2024',saw:'YES · saw the tour'},
                {t:'Baby J',net:'Netflix',yr:'2023',saw:'no'},
                {t:'Kid Gorgeous',net:'Netflix',yr:'2018',saw:'YES · saw the tour'},
                {t:'The Comeback Kid',net:'Netflix',yr:'2015',saw:'no'},
              ].map(sp=>(
                <div key={sp.t} className="wf-box" style={{padding:'10px 12px',background:'#fff'}}>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:'Fraunces, serif'}}>"{sp.t}"</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:2}}>{sp.net} · {sp.yr}</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:4,color:sp.saw.startsWith('YES')?'#c96442':'#8a827a'}}>{sp.saw}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="wf-label" style={{marginBottom:6}}>upcoming · on tour</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[
                {d:'OCT 04 · 26',v:'MSG',c:'New York NY',note:'2 nights'},
                {d:'NOV 12 · 26',v:'Chicago Theatre',c:'Chicago IL',note:'6 nights'},
              ].map((s,i)=>(
                <div key={i} style={{padding:'11px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2'}}>
                  <div className="wf-mono" style={{fontSize:11}}>{s.d}</div>
                  <div style={{fontSize:12,fontWeight:600,marginTop:2}}>{s.v}</div>
                  <div className="wf-label" style={{fontSize:9,marginTop:2}}>{s.c} · {s.note}</div>
                </div>
              ))}
            </div>

            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>career · tour timeline</div>
            <div style={{position:'relative',padding:'6px 0 0 0'}}>
              <div style={{position:'absolute',left:8,top:14,bottom:10,width:1.25,background:'#2a2520'}}/>
              {[
                {y:'2026',t:'All Is Forgiven',saw:true},
                {y:'2023',t:'From Scratch',saw:true},
                {y:'2018',t:'Kid Gorgeous',saw:true},
                {y:'2015',t:'The Comeback Kid'},
                {y:'2012',t:'New In Town'},
              ].map((e,i)=>(
                <div key={i} style={{position:'relative',paddingLeft:24,padding:'5px 0 5px 24px'}}>
                  <div style={{position:'absolute',left:4,top:10,width:9,height:9,borderRadius:'50%',background:e.saw?'#c96442':'#fff',border:'1.25px solid #2a2520'}}/>
                  <div style={{fontSize:12,fontWeight:e.saw?700:400,fontFamily:'Fraunces, serif'}}>{e.t}</div>
                  <div className="wf-label" style={{fontSize:9}}>{e.y}{e.saw?' · you were there':''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Annot top={96} right={30} w={160} rotate={2}>comedy page = specials +<br/>material context, not setlists</Annot>
      </div>
    </Chrome>
  );
}

// ─────────────────────────── THEATRE / MUSICAL ───────────────────────────
function ArtistBroadway(){
  return (
    <Chrome active="History">
      <div style={{padding:'22px 36px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10}}>
          <div className="wf-label">← productions</div>
          <div className="wf-chip" style={{fontSize:9,background:'#2a2520',color:'#fff'}}>theatre · musical</div>
        </div>
        <Hero
          title="Hadestown"
          meta="by Anaïs Mitchell · 2019 premiere · running"
          stats={[['2','times seen'],['8','Tony wins'],['2019','opened'],['Walter Kerr','home theatre']]}
        />

        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:22,marginTop:22}}>
          <div>
            <div className="wf-label" style={{marginBottom:6}}>your visits · cast on the night</div>
            <div className="wf-box" style={{background:'#fff'}}>
              {[
                {d:'MAR 22 · 26',theatre:'Walter Kerr',seat:'Orch · Row M · 14',cast:[['Orpheus','Jordan Fisher'],['Eurydice','Phillipa Soo'],['Hades','Phillip Boykin']]},
                {d:'NOV 09 · 22',theatre:'Walter Kerr',seat:'Mezz · Row B · 8',cast:[['Orpheus','Reeve Carney'],['Eurydice','Solea Pfeiffer'],['Hades','Patrick Page']]},
              ].map((v,i)=>(
                <div key={i} style={{padding:'12px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                    <div className="wf-mono" style={{fontSize:11}}>{v.d}</div>
                    <div className="wf-label" style={{fontSize:9}}>{v.theatre} · {v.seat}</div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:8}}>
                    {v.cast.map(([role,who])=>(
                      <div key={role} className="wf-soft" style={{padding:'5px 8px',background:'#fff'}}>
                        <div className="wf-label" style={{fontSize:8}}>{role}</div>
                        <div style={{fontSize:11,fontFamily:'Fraunces, serif'}}>{who}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>the production · timeline</div>
            <div style={{position:'relative',padding:'6px 0 0 0'}}>
              <div style={{position:'absolute',left:8,top:14,bottom:10,width:1.25,background:'#2a2520'}}/>
              {[
                {y:'2024',t:'Post-Tony revival cast',note:''},
                {y:'2022',t:'You saw it · original tour cast',mine:true},
                {y:'2019',t:'Broadway premiere · 8 Tonys'},
                {y:'2017',t:'Off-Broadway at NYTW'},
                {y:'2016',t:'Edmonton workshop run'},
              ].map((e,i)=>(
                <div key={i} style={{position:'relative',paddingLeft:24,padding:'5px 0 5px 24px'}}>
                  <div style={{position:'absolute',left:4,top:10,width:9,height:9,borderRadius:'50%',background:e.mine?'#c96442':'#fff',border:'1.25px solid #2a2520'}}/>
                  <div style={{fontSize:12,fontFamily:'Fraunces, serif',fontWeight:e.mine?700:400}}>{e.t}</div>
                  <div className="wf-label" style={{fontSize:9}}>{e.y}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="wf-label" style={{marginBottom:6}}>credits · writer, composer</div>
            <div className="wf-box" style={{background:'#fff',padding:'12px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'90px 1fr',gap:8,fontSize:12,lineHeight:1.8}}>
                <div className="wf-label">book</div><div>Anaïs Mitchell</div>
                <div className="wf-label">music</div><div>Anaïs Mitchell</div>
                <div className="wf-label">director</div><div>Rachel Chavkin</div>
                <div className="wf-label">choreo</div><div>David Neumann</div>
              </div>
            </div>

            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>currently playing</div>
            <div className="wf-box" style={{background:'#fff',padding:'12px 14px'}}>
              <div style={{fontSize:13,fontWeight:600}}>Walter Kerr Theatre · 48th St</div>
              <div className="wf-label" style={{fontSize:10,marginTop:4,textTransform:'none',letterSpacing:0,fontFamily:'Inter'}}>Tue–Sun · open run · no scheduled close</div>
              <div style={{display:'flex',gap:6,marginTop:10}}>
                <div className="wf-chip" style={{fontSize:9}}>book a return →</div>
                <div className="wf-chip" style={{fontSize:9}}>lottery</div>
              </div>
            </div>

            <div className="wf-label" style={{marginTop:18,marginBottom:6}}>songs you've heard</div>
            <div className="wf-box" style={{padding:'12px 14px',background:'#fff'}}>
              <div style={{fontSize:11,lineHeight:1.65,fontFamily:'JetBrains Mono',columnCount:2,columnGap:16}}>
                {['Road to Hell','Any Way the Wind Blows','Come Home with Me','Wedding Song','Epic I','Way Down Hadestown','Hey, Little Songbird','When the Chips are Down','Chant','Wait for Me','Our Lady of the Underground','Flowers'].map((t,i)=>(
                  <div key={i} style={{breakInside:'avoid'}}>{t}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Annot top={96} right={30} w={170} rotate={-2}>theatre page = production ·<br/>cast on your night · songs</Annot>
      </div>
    </Chrome>
  );
}

window.ArtistVariants = [
  {id:'artist_concert',  label:'Concert · Fontaines D.C. (tours + setlists + map)', render:()=><ArtistConcert/>},
  {id:'artist_comedy',   label:'Comedy · John Mulaney (tours + specials + material)', render:()=><ArtistComedy/>},
  {id:'artist_broadway', label:'Theatre · Hadestown (production + cast on the night)', render:()=><ArtistBroadway/>},
];
