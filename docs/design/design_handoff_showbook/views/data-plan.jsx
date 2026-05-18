// Data provenance plan — explains what is AUTO vs what user enters.
// Lives as its own artboard in the intro section.

function DataPlanArtboard(){
  const rows = [
    // field, kind, source, userTypes
    ['date / time',            'all',      'Ticketmaster receipt · Gmail scan · PDF ticket', 'no'],
    ['venue + address',        'all',      'Ticketmaster receipt · Songkick',                'no'],
    ['seat',                   'all',      'Ticketmaster receipt · PDF ticket',              'no'],
    ['paid (total only)',      'all',      'Ticketmaster receipt · Gmail scan',              'no · confirm'],
    ['lineup (artists)',       'concert',  'Songkick / setlist.fm / Ticketmaster billing',   'no · can edit'],
    ['setlist',                'concert',  'setlist.fm (by artist + date + venue)',          'no'],
    ['tour name',              'concert · comedy', 'Songkick / Wikipedia',                   'no'],
    ['material / special link','comedy',   'Wikipedia · Netflix / HBO catalog',              'no'],
    ['cast on the night',      'theatre', 'Playbill (scraped by show-date)',                'no'],
    ['production credits',     'theatre', 'IBDB / Playbill',                                'no'],
    ['awards',                 'theatre', 'IBDB · Tony database',                           'no'],
    ['artist / show metadata', 'all',      'MusicBrainz · Wikipedia · IBDB',                 'no'],
    ['photos',                 'all',      '—',                                              'yes · attach'],
  ];
  return (
    <div style={{padding:'28px 32px',fontFamily:'Inter',height:'100%',boxSizing:'border-box',overflow:'hidden'}}>
      <div className="wf-label">planning doc</div>
      <div style={{fontSize:26,fontWeight:800,letterSpacing:-.5,fontFamily:'Fraunces, serif',marginTop:4}}>Data plan · what's auto-fetched vs typed</div>
      <div style={{fontSize:13,color:'#3a342d',marginTop:6,maxWidth:780,lineHeight:1.5}}>
        The user should <b>never</b> type setlists, cast, tour names, or credits. Every show is seeded from one of three inputs — then background jobs enrich from third-party sources keyed by (artist · venue · date) or (production · date).
      </div>

      {/* 3 input modes */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginTop:16}}>
        {[
          {t:'📧 Gmail scan',sub:'past + future',body:'OAuth · regex the receipt · extract date/venue/seat/price/source. Runs nightly.'},
          {t:'🔗 Paste Ticketmaster URL',sub:'past + future',body:'Playwright MCP hits the order page → same fields. Works for orders already fulfilled.'},
          {t:'📄 Upload PDF ticket',sub:'past + future',body:'OCR → structured fields. Catches paper stubs and Telecharge emails.'},
        ].map(m=>(
          <div key={m.t} className="wf-box" style={{padding:'12px 14px',background:'#fff'}}>
            <div style={{fontSize:13,fontWeight:700}}>{m.t}</div>
            <div className="wf-label" style={{fontSize:9,marginTop:2}}>{m.sub}</div>
            <div style={{fontSize:11,color:'#3a342d',marginTop:8,lineHeight:1.5}}>{m.body}</div>
          </div>
        ))}
      </div>

      {/* Enrichment pipeline */}
      <div style={{fontSize:14,fontWeight:700,marginTop:20,marginBottom:8}}>Enrichment · keyed by (artist · venue · date)</div>
      <div className="wf-box" style={{background:'#fff'}}>
        <div style={{display:'grid',gridTemplateColumns:'180px 110px 1.2fr 110px',padding:'7px 14px',background:'#ece9e2',borderBottom:'1.25px solid #2a2520'}} className="wf-label">
          <div>field</div><div>applies to</div><div>source</div><div style={{textAlign:'right'}}>user types?</div>
        </div>
        {rows.map((r,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'180px 110px 1.2fr 110px',padding:'8px 14px',borderTop:i===0?'none':'1.25px solid #ece9e2',alignItems:'center',fontSize:11}}>
            <div style={{fontWeight:600}}>{r[0]}</div>
            <div><span className="wf-chip" style={{fontSize:9}}>{r[1]}</span></div>
            <div style={{color:'#3a342d'}}>{r[2]}</div>
            <div style={{textAlign:'right',fontFamily:'JetBrains Mono',fontSize:10,color:r[3]==='no'?'#2a2520':r[3].startsWith('no')?'#6b645a':'#c96442'}}>{r[3]}</div>
          </div>
        ))}
      </div>
      <div className="wf-label" style={{fontSize:9,marginTop:8,lineHeight:1.5}}>
        artist / venue / production pages are aggregate views · they query your shows + third-party metadata · nothing lives there except what we derive.
      </div>
    </div>
  );
}

window.DataPlanArtboard = DataPlanArtboard;
