// Add a show — refined. Two entry modes side by side: FORM + CONVERSATIONAL.
// Removed: notes, went-with, rating. Added: photo attachment.
const { Chrome, Annot } = window;

function Field({label,children,hint}){
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
        <div className="wf-label">{label}</div>
        {hint && <div className="wf-label" style={{color:'#8a827a',textTransform:'none',letterSpacing:0,fontFamily:'Inter',fontStyle:'italic'}}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// A — Form mode
function AddForm(){
  return (
    <Chrome active="Home">
      <div style={{padding:'24px 40px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:14,marginBottom:10}}>
          <div style={{fontSize:24,fontWeight:700}}>Add a show</div>
          <div style={{display:'flex',gap:0,border:'1.25px solid #2a2520'}}>
            <div style={{padding:'4px 10px',background:'#2a2520',color:'#fff',fontSize:11,fontFamily:'JetBrains Mono'}}>form</div>
            <div style={{padding:'4px 10px',background:'#fff',fontSize:11,fontFamily:'JetBrains Mono'}}>conversational →</div>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:32,maxWidth:1100}}>
          <div>
            <div style={{display:'flex',border:'1.25px solid #2a2520',marginBottom:18}}>
              <div style={{flex:1,padding:'9px 12px',background:'#2a2520',color:'#fff',textAlign:'center',fontSize:12,fontWeight:600}}>past show</div>
              <div style={{flex:1,padding:'9px 12px',textAlign:'center',fontSize:12,color:'#6b645a'}}>upcoming (have tix)</div>
              <div style={{flex:1,padding:'9px 12px',textAlign:'center',fontSize:12,color:'#6b645a'}}>watching</div>
            </div>

            <Field label="date"><div className="wf-box" style={{padding:'10px 12px',fontSize:13,fontFamily:'JetBrains Mono'}}>2026-04-04  📅  Sat</div></Field>

            <Field label="kind">
              <div style={{display:'flex',gap:6}}>
                {['concert','festival','theatre','comedy'].map((k,i)=>(
                  <div key={k} className="wf-chip" style={{padding:'7px 12px',fontSize:11,background:i===0?'#2a2520':'#fff',color:i===0?'#fff':'#2a2520'}}>{k}</div>
                ))}
              </div>
            </Field>

            <Field label="lineup" hint="one show, many artists · order = billing (first is headliner)">
              <div>
                <div className="wf-box" style={{padding:'10px 12px',marginBottom:6,display:'grid',gridTemplateColumns:'16px 1fr 110px 20px',gap:10,alignItems:'center',background:'#ece9e2'}}>
                  <div style={{color:'#8a827a',cursor:'grab'}}>⋮⋮</div>
                  <div style={{fontSize:13,fontWeight:700}}>Fontaines D.C.</div>
                  <div className="wf-label" style={{fontSize:9}}>headliner · matched ✓</div>
                  <div className="wf-label" style={{textAlign:'center'}}>×</div>
                </div>
                <div className="wf-box" style={{padding:'10px 12px',marginBottom:6,display:'grid',gridTemplateColumns:'16px 1fr 110px 20px',gap:10,alignItems:'center'}}>
                  <div style={{color:'#8a827a',cursor:'grab'}}>⋮⋮</div>
                  <div style={{fontSize:13}}>Been Stellar</div>
                  <div className="wf-label" style={{fontSize:9}}>support · matched ✓</div>
                  <div className="wf-label" style={{textAlign:'center'}}>×</div>
                </div>
                <div className="wf-soft" style={{padding:'10px 12px',fontSize:12,color:'#6b645a'}}>🔎 + add another artist…</div>
              </div>
            </Field>

            <Field label="venue"><div className="wf-box" style={{padding:'10px 12px',fontSize:13}}>Kings Theatre · Brooklyn, NY</div></Field>

            <Field label="cost"><div className="wf-box" style={{padding:'10px 12px',fontSize:13,fontFamily:'JetBrains Mono'}}>$78.00</div></Field>

            <Field label="photos" hint="optional">
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {[1,2,3].map(i=>(
                  <div key={i} className="wf-soft" style={{height:80,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div className="wf-label" style={{fontSize:9}}>photo {i}</div>
                  </div>
                ))}
                <div className="wf-soft" style={{height:80,display:'flex',alignItems:'center',justifyContent:'center',borderStyle:'dashed',background:'#fff'}}>
                  <div className="wf-label" style={{fontSize:9}}>+ attach</div>
                </div>
              </div>
            </Field>

            <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:18}}>
              <div className="wf-btn">cancel</div>
              <div className="wf-btn primary">save to history</div>
            </div>
          </div>

          {/* right side — what's dropped */}
          <div>
            <div className="wf-label" style={{marginBottom:10}}>what changed</div>
            <div className="wf-box" style={{padding:14,background:'#fff'}}>
              <div style={{fontSize:12,lineHeight:1.7}}>
                <div style={{display:'grid',gridTemplateColumns:'14px 1fr',gap:6,padding:'4px 0'}}><span>+</span><span><b>photos</b> · attach multiple, camera roll</span></div>
                <div style={{display:'grid',gridTemplateColumns:'14px 1fr',gap:6,padding:'4px 0',color:'#8a827a'}}><span>−</span><span>rating · removed</span></div>
                <div style={{display:'grid',gridTemplateColumns:'14px 1fr',gap:6,padding:'4px 0',color:'#8a827a'}}><span>−</span><span>went with · removed</span></div>
                <div style={{display:'grid',gridTemplateColumns:'14px 1fr',gap:6,padding:'4px 0',color:'#8a827a'}}><span>−</span><span>note · removed</span></div>
              </div>
            </div>
            <div className="wf-label" style={{marginTop:18,marginBottom:8}}>also available</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <div className="wf-btn" style={{justifyContent:'flex-start'}}>📋 paste a ticketmaster URL</div>
              <div className="wf-btn" style={{justifyContent:'flex-start'}}>📄 upload PDF ticket</div>
              <div className="wf-btn" style={{justifyContent:'flex-start'}}>📧 scan gmail for receipts</div>
              <div className="wf-btn" style={{justifyContent:'flex-start'}}>💬 switch to conversational →</div>
            </div>
          </div>
        </div>
        <Annot top={150} right={30} w={160} rotate={2}>clean form · no rating,<br/>no +1s, photos only</Annot>
      </div>
    </Chrome>
  );
}

// B — Conversational mode
function AddChat(){
  return (
    <Chrome active="Home">
      <div style={{padding:'24px 40px',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:14,marginBottom:10}}>
          <div style={{fontSize:24,fontWeight:700}}>Add a show</div>
          <div style={{display:'flex',gap:0,border:'1.25px solid #2a2520'}}>
            <div style={{padding:'4px 10px',background:'#fff',fontSize:11,fontFamily:'JetBrains Mono'}}>form</div>
            <div style={{padding:'4px 10px',background:'#2a2520',color:'#fff',fontSize:11,fontFamily:'JetBrains Mono'}}>conversational</div>
          </div>
          <div className="wf-label" style={{marginLeft:'auto'}}>just describe it · we'll build the record</div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:24,height:'calc(100% - 50px)'}}>
          {/* Chat column */}
          <div className="wf-box" style={{background:'#fff',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flex:1,padding:'16px 20px',overflow:'auto',display:'flex',flexDirection:'column',gap:12}}>
              <Msg who="bot" text="what show are we logging?"/>
              <Msg who="you" text="Fontaines DC and Been Stellar at Kings Theatre last Saturday, I paid $78"/>
              <Msg who="bot" text={<span>got it ·<br/><ul style={{margin:'6px 0 0 16px',padding:0,fontSize:12,fontFamily:'Inter'}}><li><b>Fontaines D.C.</b> (headliner, matched)</li><li><b>Been Stellar</b> (support, matched)</li><li>Kings Theatre, Brooklyn NY</li><li>Sat Apr 04 · 2026</li><li>$78.00</li><li>kind: <b>concert</b></li></ul></span>}/>
              <Msg who="bot" text="anything else? (photos, more artists, or the fee breakdown)"/>
              <Msg who="you" text="add 3 photos"/>
              <Msg who="bot" text={<span>ok · tap to select from camera roll<br/><span style={{display:'inline-flex',gap:6,marginTop:8}}><span className="wf-soft" style={{width:48,height:48,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>1</span></span><span className="wf-soft" style={{width:48,height:48,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>2</span></span><span className="wf-soft" style={{width:48,height:48,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>3</span></span></span></span>}/>
              <Msg who="you" text="looks good, save"/>
              <Msg who="bot" system text="✓ saved to history · added Been Stellar to your artists · want to view the show?"/>
            </div>
            <div style={{borderTop:'1.25px solid #2a2520',padding:'10px 14px',display:'flex',gap:8,background:'#fafaf7'}}>
              <div className="wf-box" style={{flex:1,padding:'8px 10px',fontSize:12,color:'#6b645a'}}>type a show, paste a URL, or attach a ticket pdf…</div>
              <div className="wf-btn">📎</div>
              <div className="wf-btn primary">send</div>
            </div>
          </div>

          {/* Live preview card */}
          <div>
            <div className="wf-label" style={{marginBottom:6}}>live preview · edit before save</div>
            <div className="wf-box" style={{padding:16,background:'#fff'}}>
              <div className="wf-label" style={{fontSize:9}}>APR 04 · 26 · Sat</div>
              <div style={{fontSize:18,fontWeight:700,marginTop:4,letterSpacing:-.2}}>Fontaines D.C.</div>
              <div style={{fontSize:12,color:'#6b645a'}}>+ Been Stellar (support)</div>
              <div style={{marginTop:12,fontSize:12,lineHeight:1.7,fontFamily:'JetBrains Mono'}}>
                {[
                  ['venue','Kings Theatre'],
                  ['city', 'Brooklyn, NY'],
                  ['kind', 'concert'],
                  ['paid', '$78.00'],
                  ['photos','3 attached'],
                ].map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderTop:'1.25px solid #ece9e2'}}>
                    <span className="wf-label">{k}</span><span>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginTop:12}}>
                <div className="wf-soft" style={{height:50,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>1</span></div>
                <div className="wf-soft" style={{height:50,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>2</span></div>
                <div className="wf-soft" style={{height:50,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="wf-label" style={{fontSize:8}}>3</span></div>
              </div>
              <div style={{display:'flex',gap:6,marginTop:12}}>
                <div className="wf-btn" style={{flex:1}}>edit in form</div>
                <div className="wf-btn primary" style={{flex:1}}>save</div>
              </div>
            </div>
            <div className="wf-label" style={{marginTop:14,fontSize:9,lineHeight:1.5}}>
              also understands:<br/>
              · "book Caroline Polachek Apr 26, I have tickets"<br/>
              · "add my governors ball wishlist"<br/>
              · drag-drop a ticket PDF here
            </div>
          </div>
        </div>
        <Annot top={200} right={36} w={170} rotate={3}>speed-of-thought · still<br/>shows a structured record</Annot>
      </div>
    </Chrome>
  );
}

function Msg({who,text,system}){
  if (system) return <div style={{fontSize:11,fontFamily:'JetBrains Mono',color:'#c96442',alignSelf:'center',padding:'4px 10px',border:'1.25px dashed #c96442',background:'#fafaf7'}}>{text}</div>;
  const isYou = who==='you';
  return (
    <div style={{display:'flex',gap:10,flexDirection:isYou?'row-reverse':'row',alignItems:'flex-start'}}>
      <div style={{width:22,height:22,borderRadius:'50%',border:'1.25px solid #2a2520',background:isYou?'#2a2520':'#ece9e2',color:isYou?'#fff':'#2a2520',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{isYou?'M':'✦'}</div>
      <div style={{maxWidth:'75%',padding:'8px 12px',fontSize:13,lineHeight:1.4,border:'1.25px solid #2a2520',background:isYou?'#ece9e2':'#fff'}}>{text}</div>
    </div>
  );
}

window.AddVariants = [
  {id:'add_form', label:'A · Form mode', render:()=><AddForm/>},
  {id:'add_chat', label:'B · Conversational mode', render:()=><AddChat/>},
];
