// Conversational Add — mobile + web.
// Two surfaces that share the same idea: you type/speak naturally,
// the assistant assembles a structured record on the side and you commit.
// Same Geist + Geist Mono system as AddMobile/AddWeb.

const { SB, Icon, HIFI_KINDS, kindInk } = window;

// ── Mobile (light) ─────────────────────────────────────────────────────
const C_BG   = SB.bg.light;
const C_SURF = SB.surface.light;
const C_SURF2= SB.surface2.light;
const C_INK  = SB.ink.light;
const C_MUTED= SB.muted.light;
const C_FAINT= SB.faint.light;
const C_RULE = SB.rule.light;
const C_RULE2= SB.ruleStrong.light;
const ck = (k) => SB.kinds[k].ink;

function MBubble({who, children, type}) {
  const you = who === 'you';
  if (type === 'sys') {
    return (
      <div style={{
        alignSelf:'center',
        padding:'6px 12px', border:`1px dashed ${ck('concert')}`,
        color:ck('concert'), fontFamily:SB.mono, fontSize:10.5,
        letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
        background:C_SURF,
      }}>{children}</div>
    );
  }
  return (
    <div style={{
      display:'flex', flexDirection: you ? 'row-reverse' : 'row',
      gap:8, alignItems:'flex-start',
    }}>
      {!you && (
        <div style={{
          width:26, height:26, flexShrink:0, background:C_INK, color:C_BG,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:11, fontWeight:600,
        }}>✦</div>
      )}
      <div style={{
        maxWidth:'78%', padding:'10px 12px',
        background: you ? C_INK : C_SURF,
        color: you ? C_BG : C_INK,
        border: you ? `1px solid ${C_INK}` : `1px solid ${C_RULE2}`,
        fontFamily:SB.sans, fontSize:13.5, lineHeight:1.4, letterSpacing:-0.15,
      }}>{children}</div>
    </div>
  );
}

function MChipSuggest({children}) {
  return (
    <div style={{
      padding:'7px 10px', border:`1px solid ${C_RULE2}`, background:C_SURF,
      fontFamily:SB.mono, fontSize:10.5, color:C_INK,
      letterSpacing:'.04em', whiteSpace:'nowrap',
    }}>{children}</div>
  );
}

function MDraftCard() {
  return (
    <div style={{
      padding:'12px 14px', background:C_SURF,
      borderLeft:`2px solid ${ck('concert')}`,
      border:`1px solid ${C_RULE2}`, borderLeftWidth:2,
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:6,
        fontFamily:SB.mono, fontSize:10, color:ck('concert'),
        letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
      }}>
        <Icon.Dot size={8} color={ck('concert')}/> Concert · DRAFT
      </div>
      <div style={{
        fontFamily:SB.sans, fontSize:17, fontWeight:600, color:C_INK,
        letterSpacing:-0.4, lineHeight:1.15, marginTop:4,
      }}>Fontaines D.C.</div>
      <div style={{fontFamily:SB.sans, fontSize:12, color:C_MUTED, marginTop:2, letterSpacing:-0.1}}>
        + Been Stellar (support)
      </div>
      <div style={{marginTop:10, fontFamily:SB.mono, fontSize:11, lineHeight:1.65}}>
        {[
          ['date','sat · apr 04 · 2026'],
          ['venue','kings theatre'],
          ['city','brooklyn, ny'],
          ['paid','$78.00'],
          ['setlist','21 · encore'],
          ['photos','3 attached'],
        ].map(([k,v])=>(
          <div key={k} style={{
            display:'flex', justifyContent:'space-between',
            padding:'3px 0', borderTop:`1px solid ${C_RULE}`,
          }}>
            <span style={{color:C_FAINT, letterSpacing:'.06em', textTransform:'uppercase', fontSize:9.5}}>{k}</span>
            <span style={{color:C_INK, letterSpacing:'.02em'}}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddChatMobile() {
  return (
    <div style={{
      height:'100%', background:C_BG, color:C_INK,
      display:'flex', flexDirection:'column', overflow:'hidden',
      fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
    }}>
      {/* Top bar */}
      <div style={{
        padding:'62px 20px 12px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        borderBottom:`1px solid ${C_RULE}`,
      }}>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:C_MUTED,
          letterSpacing:'.06em', textTransform:'uppercase',
          display:'flex', alignItems:'center', gap:6,
        }}>
          <span style={{fontSize:14, lineHeight:1}}>×</span> close
        </div>
        <div style={{
          fontFamily:SB.sans, fontSize:16, fontWeight:600, color:C_INK, letterSpacing:-0.3,
        }}>Add — chat</div>
        <div style={{
          fontFamily:SB.mono, fontSize:11, color:C_INK,
          letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          display:'flex', alignItems:'center', gap:4,
        }}>
          form <Icon.ArrowRight size={11} color={C_INK}/>
        </div>
      </div>

      {/* Mini draft strip — sticky at top */}
      <div style={{
        padding:'10px 20px 12px', background:C_BG,
        borderBottom:`1px solid ${C_RULE}`,
      }}>
        <div style={{
          padding:'10px 12px', background:C_SURF, border:`1px solid ${C_RULE2}`,
          borderLeft:`2px solid ${ck('concert')}`,
          display:'grid', gridTemplateColumns:'44px 1fr auto', columnGap:10, alignItems:'center',
        }}>
          <div>
            <div style={{fontFamily:SB.sans, fontSize:20, fontWeight:500, color:C_INK, letterSpacing:-0.7, lineHeight:.95, fontFeatureSettings:'"tnum"'}}>04</div>
            <div style={{fontFamily:SB.mono, fontSize:9, color:ck('concert'), letterSpacing:'.08em', marginTop:2}}>APR</div>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:600, color:C_INK, letterSpacing:-0.2, lineHeight:1.1}}>Fontaines D.C.</div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:C_MUTED, marginTop:3, letterSpacing:'.02em'}}>kings theatre · 6 fields filled</div>
          </div>
          <div style={{
            padding:'5px 9px', background:C_INK, color:C_BG,
            fontFamily:SB.mono, fontSize:10, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          }}>save</div>
        </div>
      </div>

      {/* Chat feed */}
      <div style={{
        flex:1, overflow:'auto', padding:'14px 18px 10px',
        display:'flex', flexDirection:'column', gap:10,
      }}>
        <MBubble who="bot">what show are we logging?</MBubble>
        <MBubble who="you">fontaines dc + been stellar at kings theatre last sat, I paid $78</MBubble>
        <MBubble who="bot">
          got it ·
          <div style={{marginTop:6, fontFamily:SB.mono, fontSize:12, lineHeight:1.5}}>
            <div>✓ <b>Fontaines D.C.</b> · headliner</div>
            <div>✓ <b>Been Stellar</b> · support</div>
            <div>✓ Kings Theatre · Brooklyn NY</div>
            <div>✓ Sat Apr 04 · 2026</div>
            <div>✓ $78.00 · kind: <b>concert</b></div>
          </div>
        </MBubble>
        <MBubble who="bot">pulled <b>21 songs + encore</b> from setlist.fm · tour is <b>Romance World Tour</b>. photos?</MBubble>

        <MBubble who="you">attach 3 from camera roll</MBubble>
        <MBubble who="bot">
          ok — tap to pick
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginTop:8}}>
            {[1,2,3].map(i=>(
              <div key={i} style={{
                aspectRatio:'1/1',
                background:`repeating-linear-gradient(135deg, ${C_SURF2} 0 6px, ${C_SURF} 6px 12px)`,
                border:`1px solid ${C_RULE2}`,
                display:'flex', alignItems:'flex-end', padding:4,
                fontFamily:SB.mono, fontSize:9, color:C_FAINT, letterSpacing:'.06em',
              }}>IMG_0{i}</div>
            ))}
          </div>
        </MBubble>
        <MBubble who="you">save</MBubble>
        <MBubble type="sys">✓ saved · added Been Stellar to artists</MBubble>
      </div>

      {/* Suggestion chips */}
      <div style={{
        padding:'8px 16px 0', display:'flex', gap:6, overflowX:'auto',
      }}>
        <MChipSuggest>+ add another artist</MChipSuggest>
        <MChipSuggest>note the encore</MChipSuggest>
        <MChipSuggest>view show</MChipSuggest>
      </div>

      {/* Composer */}
      <div style={{
        padding:'10px 14px 18px', borderTop:`1px solid ${C_RULE}`, background:C_BG,
        display:'flex', gap:8, alignItems:'center', marginTop:10,
      }}>
        <div style={{
          flex:1, padding:'10px 12px', background:C_SURF,
          border:`1px solid ${C_RULE2}`,
          fontFamily:SB.sans, fontSize:13, color:C_MUTED, letterSpacing:-0.1,
        }}>
          type, paste a URL, or attach a ticket pdf…
        </div>
        <div style={{
          width:38, height:38, background:C_SURF2, border:`1px solid ${C_RULE2}`,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C_INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15V5a2 2 0 0 0-2-2h-10a2 2 0 0 0-2 2v10a4 4 0 0 0 4 4h6"/><path d="M7 11V7h4"/></svg>
        </div>
        <div style={{
          width:38, height:38, background:C_INK, color:C_BG,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <Icon.ArrowUpRight size={16} color={C_BG}/>
        </div>
      </div>
    </div>
  );
}


// ── Web (dark) ─────────────────────────────────────────────────────────
const D_BG   = SB.bg.dark;
const D_SURF = SB.surface.dark;
const D_SURF2= SB.surface2.dark;
const D_INK  = SB.ink.dark;
const D_MUTED= SB.muted.dark;
const D_FAINT= SB.faint.dark;
const D_RULE = SB.rule.dark;
const D_RULE2= SB.ruleStrong.dark;
const dk = (k) => kindInk(k, true);

function WBubble({who, children, type}) {
  const you = who === 'you';
  if (type === 'sys') {
    return (
      <div style={{
        alignSelf:'center',
        padding:'6px 14px', border:`1px dashed ${dk('festival')}`,
        color:dk('festival'), fontFamily:SB.mono, fontSize:10.5,
        letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
      }}>{children}</div>
    );
  }
  return (
    <div style={{
      display:'flex', flexDirection: you ? 'row-reverse' : 'row',
      gap:10, alignItems:'flex-start',
    }}>
      {!you && (
        <div style={{
          width:28, height:28, flexShrink:0, background:D_SURF2, color:D_INK,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:SB.mono, fontSize:12, fontWeight:600,
          border:`1px solid ${D_RULE2}`,
        }}>✦</div>
      )}
      <div style={{
        maxWidth:620, padding:'12px 14px',
        background: you ? D_SURF2 : D_SURF,
        color: D_INK,
        border:`1px solid ${you ? D_RULE2 : D_RULE}`,
        borderLeft: you ? `2px solid ${D_INK}` : `2px solid transparent`,
        fontFamily:SB.sans, fontSize:14, lineHeight:1.45, letterSpacing:-0.15,
      }}>{children}</div>
    </div>
  );
}

function WChipSuggest({children}) {
  return (
    <div style={{
      padding:'7px 11px', border:`1px solid ${D_RULE2}`, background:D_SURF,
      fontFamily:SB.mono, fontSize:10.5, color:D_INK,
      letterSpacing:'.06em', whiteSpace:'nowrap', textTransform:'uppercase',
    }}>{children}</div>
  );
}

function WSidebar() {
  const items = [
    ['Home', Icon.Home, null],
    ['Archive', Icon.Archive, '87'],
    ['Upcoming', Icon.Calendar, '4'],
    ['Artists', Icon.Music, '22'],
    ['Venues', Icon.MapPin, '9'],
    ['Map', Icon.Map, null],
  ];
  return (
    <div style={{
      width:224, background:D_BG, borderRight:`1px solid ${D_RULE}`,
      display:'flex', flexDirection:'column', padding:'20px 0', flexShrink:0,
    }}>
      <div style={{padding:'0 20px 24px'}}>
        <div style={{fontFamily:SB.sans, fontSize:19, fontWeight:600, color:D_INK, letterSpacing:-0.5}}>
          showbook<span style={{color:D_FAINT, fontWeight:400}}>/m</span>
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>v · 2026.04</div>
      </div>
      <div style={{padding:'0 16px 20px'}}>
        <div style={{
          padding:'9px 12px', background:dk('concert'), color:'#120403',
          fontFamily:SB.sans, fontSize:13, fontWeight:600,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>
          <Icon.ArrowUpRight size={15} color={'#120403'}/> Chatting…
        </div>
      </div>
      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Navigate</div>
        {items.map(([l, Ic, c])=>(
          <div key={l} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'7px 12px', margin:'1px 0',
            color:D_MUTED,
            fontFamily:SB.sans, fontSize:13.5, letterSpacing:-0.1,
            borderLeft:'2px solid transparent',
          }}>
            <Ic size={15} color={D_MUTED}/>
            <span style={{flex:1}}>{l}</span>
            {c && <span style={{fontFamily:SB.mono, fontSize:11, color:D_FAINT}}>{c}</span>}
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px', borderTop:`1px solid ${D_RULE}`, display:'flex', alignItems:'center', gap:10}}>
        <div style={{width:28, height:28, borderRadius:999, background:D_SURF2, color:D_INK, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:SB.mono, fontSize:12, fontWeight:500}}>m</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontFamily:SB.sans, fontSize:13, color:D_INK, fontWeight:500}}>m</div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, marginTop:1, letterSpacing:'.02em'}}>synced 3m ago</div>
        </div>
      </div>
    </div>
  );
}

function WDraftPanel() {
  const filled = [
    ['Kind', 'Concert', true],
    ['Date', 'Sat · Apr 04 · 2026', true],
    ['Headliner', 'Fontaines D.C.', true],
    ['Support', 'Been Stellar', true],
    ['Venue', 'Kings Theatre · Brooklyn', true],
    ['Seat', 'ORCH L · 14', true],
    ['Paid', '$78.00', true],
    ['Tour', 'Romance World Tour', true],
    ['Setlist', '21 songs · encore', true],
    ['Photos', '3 attached · IMG_01 cover', true],
    ['Cast', '—', false],
    ['Notes', 'not captured · by design', false],
  ];
  return (
    <div style={{padding:'28px 28px 24px', display:'flex', flexDirection:'column', gap:18, minHeight:0, overflow:'auto'}}>
      <div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Live record · building
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.02em', marginTop:3}}>
          extracted from the conversation
        </div>
      </div>

      {/* Hero card */}
      <div style={{
        padding:'20px 20px', background:D_SURF,
        borderLeft:`3px solid ${dk('concert')}`,
      }}>
        <div style={{
          display:'inline-flex', alignItems:'center', gap:6,
          fontFamily:SB.mono, fontSize:10.5, color:dk('concert'),
          letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
        }}>
          <Icon.Dot size={9} color={dk('concert')}/> Concert
        </div>
        <div style={{fontFamily:SB.sans, fontSize:26, fontWeight:600, color:D_INK, letterSpacing:-0.9, lineHeight:1, marginTop:10}}>
          Fontaines D.C.
        </div>
        <div style={{fontFamily:SB.sans, fontSize:13, color:D_MUTED, marginTop:5, letterSpacing:-0.15}}>
          with Been Stellar
        </div>
        <div style={{display:'flex', alignItems:'baseline', gap:10, marginTop:16}}>
          <div style={{fontFamily:SB.sans, fontSize:44, fontWeight:500, color:D_INK, letterSpacing:-1.6, lineHeight:.9, fontFeatureSettings:'"tnum"'}}>04</div>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:dk('concert'), letterSpacing:'.1em', fontWeight:500}}>APR · SAT · 2026</div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.04em', marginTop:3}}>kings theatre · brooklyn</div>
          </div>
        </div>
      </div>

      {/* Field fill log */}
      <div>
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          marginBottom:10,
        }}>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500}}>
            Fields · 10 of 12
          </div>
          <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.04em'}}>
            click any row to edit
          </div>
        </div>
        <div style={{border:`1px solid ${D_RULE2}`}}>
          {filled.map(([k, v, ok], i)=>(
            <div key={k} style={{
              display:'grid', gridTemplateColumns:'100px 1fr 16px', columnGap:12,
              padding:'9px 14px',
              borderTop: i===0 ? 'none' : `1px solid ${D_RULE}`,
              alignItems:'center',
              background: ok ? 'transparent' : D_SURF,
            }}>
              <div style={{
                fontFamily:SB.mono, fontSize:10, color: ok ? dk('festival') : D_FAINT,
                letterSpacing:'.08em', textTransform:'uppercase',
                display:'flex', alignItems:'center', gap:5,
              }}>
                {ok ? <Icon.Check size={10} color={dk('festival')}/> : <span style={{fontSize:11, lineHeight:1}}>–</span>}
                {k}
              </div>
              <div style={{
                fontFamily: ok ? SB.mono : SB.sans, fontSize: 12,
                color: ok ? D_INK : D_MUTED, letterSpacing:'.02em',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>{v}</div>
              <Icon.ChevronRight size={12} color={D_FAINT}/>
            </div>
          ))}
        </div>
      </div>

      {/* Commit */}
      <div style={{display:'flex', gap:10}}>
        <div style={{
          flex:1, padding:'10px 14px', border:`1px solid ${D_RULE2}`, color:D_INK,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase',
          textAlign:'center',
        }}>Edit as form</div>
        <div style={{
          flex:1, padding:'10px 14px', background:D_INK, color:D_BG,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>
          <Icon.Check size={12} color={D_BG}/> Save
        </div>
      </div>
    </div>
  );
}

function AddChatWeb() {
  return (
    <div style={{
      width:'100%', height:'100%', background:D_BG, color:D_INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
      overflow:'hidden',
    }}>
      <WSidebar/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar */}
        <div style={{
          padding:'14px 32px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${D_RULE}`,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:10, fontFamily:SB.mono, fontSize:11.5, color:D_MUTED, letterSpacing:'.04em'}}>
            <span>home</span>
            <Icon.ChevronRight size={12} color={D_FAINT}/>
            <span>add a show</span>
            <Icon.ChevronRight size={12} color={D_FAINT}/>
            <span style={{color:D_INK, fontWeight:500}}>conversational</span>
          </div>
          <div style={{display:'inline-flex', border:`1px solid ${D_RULE2}`}}>
            <div style={{padding:'6px 12px', fontFamily:SB.mono, fontSize:11, color:D_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>Form</div>
            <div style={{padding:'6px 12px', fontFamily:SB.mono, fontSize:11, color:D_BG, background:D_INK, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>Chat</div>
          </div>
        </div>

        {/* Content — split */}
        <div style={{
          flex:1, display:'grid',
          gridTemplateColumns:'1fr 440px',
          minHeight:0, overflow:'hidden',
        }}>
          {/* Left: chat */}
          <div style={{minWidth:0, display:'flex', flexDirection:'column', background:D_BG}}>
            {/* Feed */}
            <div style={{
              flex:1, overflow:'auto',
              padding:'28px 48px 14px',
              display:'flex', flexDirection:'column', gap:14,
            }}>
              <div style={{
                alignSelf:'flex-start',
                fontFamily:SB.mono, fontSize:10.5, color:D_FAINT, letterSpacing:'.1em', textTransform:'uppercase',
                padding:'4px 10px', border:`1px solid ${D_RULE}`,
              }}>session · 20 apr · 11:32 pm</div>

              <WBubble who="bot">
                what show are we logging? paste a ticket URL, drop a PDF,
                or just describe it in your own words.
              </WBubble>

              <WBubble who="you">
                Fontaines DC and Been Stellar at Kings Theatre last Saturday,
                I paid $78, ORCH L 14
              </WBubble>

              <WBubble who="bot">
                got it — parsed as:
                <div style={{marginTop:8, fontFamily:SB.mono, fontSize:12.5, lineHeight:1.6}}>
                  <div>✓ <b style={{color:D_INK}}>Fontaines D.C.</b> · headliner · matched</div>
                  <div>✓ <b style={{color:D_INK}}>Been Stellar</b> · support · matched</div>
                  <div>✓ Kings Theatre · Brooklyn, NY</div>
                  <div>✓ Sat · Apr 04 · 2026</div>
                  <div>✓ ORCH L · 14 · $78.00</div>
                  <div>✓ kind: <b style={{color:D_INK}}>concert</b></div>
                </div>
              </WBubble>

              <WBubble who="bot">
                pulled the rest from setlist.fm —
                <div style={{marginTop:8, fontFamily:SB.mono, fontSize:12.5, lineHeight:1.6}}>
                  <div>+ tour · <b style={{color:D_INK}}>Romance World Tour</b></div>
                  <div>+ setlist · <b style={{color:D_INK}}>21 songs</b> with encore</div>
                </div>
                anything else? (photos, another artist, extra fees)
              </WBubble>

              <WBubble who="you">add 3 photos as attached</WBubble>

              <WBubble who="bot">
                <div style={{marginBottom:8}}>attached — tap any to set as cover.</div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, maxWidth:380}}>
                  {[1,2,3].map(i=>(
                    <div key={i} style={{
                      aspectRatio:'4/3',
                      background:`repeating-linear-gradient(135deg, ${D_SURF2} 0 6px, ${D_BG} 6px 12px)`,
                      border:`1px solid ${i===1 ? dk('concert') : D_RULE2}`,
                      position:'relative',
                      display:'flex', alignItems:'flex-end', padding:6,
                      fontFamily:SB.mono, fontSize:9.5, color:D_FAINT, letterSpacing:'.06em',
                    }}>
                      IMG_0{i}
                      {i===1 && (
                        <div style={{position:'absolute', top:6, right:6, background:dk('concert'), color:'#120403', padding:'1px 5px', fontFamily:SB.mono, fontSize:9, fontWeight:700, letterSpacing:'.04em'}}>
                          COVER
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </WBubble>

              <WBubble who="you">looks right, save it</WBubble>
              <WBubble type="sys">✓ saved · added Been Stellar to artists</WBubble>
            </div>

            {/* Suggestions */}
            <div style={{
              padding:'8px 48px 0', display:'flex', gap:8, flexWrap:'wrap',
            }}>
              <WChipSuggest>View show →</WChipSuggest>
              <WChipSuggest>Add another</WChipSuggest>
              <WChipSuggest>Undo last</WChipSuggest>
              <WChipSuggest>Edit as form</WChipSuggest>
            </div>

            {/* Composer */}
            <div style={{
              margin:'14px 48px 22px',
              padding:'12px 14px',
              background:D_SURF, border:`1px solid ${D_RULE2}`,
              display:'grid',
              gridTemplateColumns:'auto 1fr auto auto',
              columnGap:10, alignItems:'center',
            }}>
              <div style={{display:'flex', gap:6}}>
                {[
                  'URL','PDF','VOICE',
                ].map(t=>(
                  <div key={t} style={{
                    padding:'4px 8px', border:`1px solid ${D_RULE2}`,
                    fontFamily:SB.mono, fontSize:9.5, color:D_MUTED,
                    letterSpacing:'.08em',
                  }}>{t}</div>
                ))}
              </div>
              <div style={{
                fontFamily:SB.sans, fontSize:14, color:D_FAINT, letterSpacing:-0.1,
                padding:'4px 2px',
              }}>
                describe the show, paste a ticketmaster link, or drop a PDF…
              </div>
              <div style={{
                fontFamily:SB.mono, fontSize:10, color:D_FAINT,
                padding:'2px 6px', border:`1px solid ${D_RULE2}`,
                letterSpacing:'.04em',
              }}>⌘ ↵</div>
              <div style={{
                padding:'7px 12px', background:D_INK, color:D_BG,
                fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
                display:'inline-flex', alignItems:'center', gap:6,
              }}>
                <Icon.ArrowUpRight size={12} color={D_BG}/> Send
              </div>
            </div>
          </div>

          {/* Right: draft panel */}
          <div style={{minWidth:0, borderLeft:`1px solid ${D_RULE}`, background:D_BG}}>
            <WDraftPanel/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AddChatMobile = AddChatMobile;
window.AddChatWeb = AddChatWeb;
