// Web · Add a Show — dark dashboard overlay
// Lives inside the WebHome dark shell. Full-screen "Add" view with:
//  · left: form (form/chat tabs)
//  · right: live preview card + data-source log
// Matches WebHome dark theme (Geist + Geist Mono, accents via HIFI_KINDS).

const { SB, Icon, HIFI_KINDS, kindInk } = window;

const D_BG   = SB.bg.dark;
const D_SURF = SB.surface.dark;
const D_SURF2= SB.surface2.dark;
const D_INK  = SB.ink.dark;
const D_MUTED= SB.muted.dark;
const D_FAINT= SB.faint.dark;
const D_RULE = SB.rule.dark;
const D_RULE2= SB.ruleStrong.dark;
const wk = (k) => kindInk(k, true);

// ─── Sidebar (condensed — mirrors WebHome but with Add active) ──
function AddSidebar() {
  const items = [
    { key:'home',   label:'Home',      Icon:Icon.Home },
    { key:'past',   label:'Archive',   Icon:Icon.Archive,  count:'87' },
    { key:'up',     label:'Upcoming',  Icon:Icon.Calendar, count:'4' },
    { key:'artists',label:'Artists',   Icon:Icon.Music,    count:'22' },
    { key:'venues', label:'Venues',    Icon:Icon.MapPin,   count:'9' },
    { key:'map',    label:'Map',       Icon:Icon.Map },
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
        <div style={{fontFamily:SB.mono, fontSize:10, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginTop:3}}>
          v · 2026.04
        </div>
      </div>

      {/* Add CTA — active state */}
      <div style={{padding:'0 16px 20px'}}>
        <div style={{
          padding:'9px 12px', background:wk('concert'), color:'#120403',
          fontFamily:SB.sans, fontSize:13, fontWeight:600,
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          letterSpacing:-0.1,
        }}>
          <Icon.Plus size={15} color={'#120403'}/> Adding show…
        </div>
      </div>

      <div style={{padding:'0 8px', flex:1}}>
        <div style={{padding:'6px 12px 8px', fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.08em', textTransform:'uppercase'}}>Navigate</div>
        {items.map(({key, label, Icon:Ic, count})=>(
          <div key={key} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'7px 12px', margin:'1px 0',
            color:D_MUTED,
            fontFamily:SB.sans, fontSize:13.5, letterSpacing:-0.1,
            borderLeft:'2px solid transparent',
          }}>
            <Ic size={15} color={D_MUTED}/>
            <span style={{flex:1}}>{label}</span>
            {count && <span style={{fontFamily:SB.mono, fontSize:11, color:D_FAINT}}>{count}</span>}
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

// ─── Form pieces ──────────────────────────────────────────────────────
function FieldLabel({children, hint, optional}) {
  return (
    <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:8}}>
      <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_INK, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, display:'flex', gap:8, alignItems:'center'}}>
        {children}
        {optional && <span style={{color:D_FAINT, fontWeight:400}}>· optional</span>}
      </div>
      {hint && <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.02em'}}>{hint}</div>}
    </div>
  );
}

function SegTabs({items, activeIdx}) {
  return (
    <div style={{display:'inline-flex', border:`1px solid ${D_RULE2}`}}>
      {items.map((it,i)=>(
        <div key={i} style={{
          padding:'7px 14px',
          background: i===activeIdx ? D_INK : 'transparent',
          color: i===activeIdx ? D_BG : D_MUTED,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          borderLeft: i===0 ? 'none' : `1px solid ${D_RULE2}`,
          display:'inline-flex', alignItems:'center', gap:6,
        }}>
          {it}
        </div>
      ))}
    </div>
  );
}

function KindCard({kind, active}) {
  const c = wk(kind);
  return (
    <div style={{
      flex:1, padding:'14px 14px',
      background: active ? D_SURF : 'transparent',
      borderLeft: active ? `2px solid ${c}` : `2px solid transparent`,
      borderTop:`1px solid ${D_RULE2}`,
      borderRight:`1px solid ${D_RULE2}`,
      borderBottom:`1px solid ${D_RULE2}`,
      display:'flex', flexDirection:'column', gap:6,
      cursor:'pointer',
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:7,
        fontFamily:SB.mono, fontSize:10.5, color:c, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
      }}>
        <span style={{width:7, height:7, borderRadius:999, background:c}}/>
        {HIFI_KINDS[kind].label}
      </div>
      <div style={{
        fontFamily:SB.mono, fontSize:10, color: active ? D_MUTED : D_FAINT, letterSpacing:'.02em',
      }}>
        {kind==='concert' && 'setlist.fm'}
        {kind==='theatre' && 'playbill'}
        {kind==='comedy' && 'tour · material'}
        {kind==='festival' && 'multi-day lineup'}
      </div>
    </div>
  );
}

function ArtistChip({name, role, matched, headliner}) {
  const accent = wk('concert');
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'18px 1fr auto auto 18px',
      alignItems:'center', columnGap:14,
      padding:'12px 16px',
      background: headliner ? D_SURF : 'transparent',
      borderLeft: headliner ? `2px solid ${accent}` : `2px solid transparent`,
      borderTop:`1px solid ${D_RULE}`,
    }}>
      <div style={{color:D_FAINT, fontFamily:SB.mono, fontSize:11}}>⋮⋮</div>
      <div>
        <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:headliner?600:500, color:D_INK, letterSpacing:-0.15}}>{name}</div>
      </div>
      <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.06em', textTransform:'uppercase'}}>
        {role}
      </div>
      <div style={{
        fontFamily:SB.mono, fontSize:10, color: matched ? wk('festival') : D_FAINT,
        letterSpacing:'.04em', display:'inline-flex', alignItems:'center', gap:4,
      }}>
        {matched ? <><Icon.Check size={10} color={wk('festival')}/> setlist.fm</> : 'no match'}
      </div>
      <div style={{color:D_FAINT, fontFamily:SB.mono, fontSize:13, cursor:'pointer'}}>×</div>
    </div>
  );
}

function InputRow({value, placeholder, trailing, mono=false, prefixIcon}) {
  return (
    <div style={{
      padding:'10px 14px',
      background:D_SURF, border:`1px solid ${D_RULE2}`,
      display:'flex', alignItems:'center', gap:10,
    }}>
      {prefixIcon && <div>{prefixIcon}</div>}
      <div style={{
        flex:1, fontFamily: mono ? SB.mono : SB.sans, fontSize: mono ? 13 : 14,
        color: value ? D_INK : D_FAINT, letterSpacing:-0.1,
      }}>
        {value || placeholder}
      </div>
      {trailing}
    </div>
  );
}

// ─── Left column · the form ───────────────────────────────────────────
function AddForm() {
  return (
    <div style={{padding:'28px 36px 80px', overflow:'auto', minHeight:0}}>
      {/* Heading */}
      <div style={{display:'flex', alignItems:'flex-end', gap:20, marginBottom:20}}>
        <div>
          <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
            New record · draft
          </div>
          <div style={{fontFamily:SB.sans, fontSize:32, fontWeight:600, color:D_INK, letterSpacing:-1, marginTop:4}}>
            Add a show
          </div>
        </div>
        <div style={{flex:1}}/>
        <SegTabs items={[
          <><Icon.Command size={12} color={D_BG}/> FORM</>,
          <><Icon.ArrowUpRight size={12} color={D_MUTED}/> CONVERSATIONAL</>,
        ]} activeIdx={0}/>
      </div>

      {/* Timeframe */}
      <div style={{marginBottom:26}}>
        <FieldLabel>Timeframe</FieldLabel>
        <div style={{display:'flex', gap:6}}>
          {[
            ['past', 'already went', true],
            ['upcoming', 'have tickets', false],
            ['watching', 'radar · no tix', false],
          ].map(([k, sub, active])=>(
            <div key={k} style={{
              flex:1, padding:'12px 14px',
              background: active ? D_SURF : 'transparent',
              border: `1px solid ${active ? D_RULE2 : D_RULE}`,
              borderLeft: active ? `2px solid ${D_INK}` : `2px solid transparent`,
            }}>
              <div style={{fontFamily:SB.sans, fontSize:14, fontWeight:active?600:500, color: active ? D_INK : D_MUTED, letterSpacing:-0.2}}>
                {k}
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.04em', marginTop:3}}>
                {sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Kind */}
      <div style={{marginBottom:26}}>
        <FieldLabel hint="drives which data source is used">Kind</FieldLabel>
        <div style={{display:'flex', borderLeft:`1px solid ${D_RULE2}`}}>
          <KindCard kind="concert" active/>
          <KindCard kind="theatre"/>
          <KindCard kind="comedy"/>
          <KindCard kind="festival"/>
        </div>
      </div>

      {/* Lineup */}
      <div style={{marginBottom:26}}>
        <FieldLabel hint="drag to reorder · first is headliner">Lineup</FieldLabel>
        <div style={{border:`1px solid ${D_RULE2}`}}>
          <ArtistChip name="Fontaines D.C." role="headliner" matched headliner/>
          <ArtistChip name="Been Stellar" role="support" matched/>
          {/* search input */}
          <div style={{
            padding:'12px 16px', borderTop:`1px solid ${D_RULE}`,
            background:'transparent',
            display:'grid', gridTemplateColumns:'18px 1fr auto', columnGap:14, alignItems:'center',
          }}>
            <Icon.Search size={14} color={D_MUTED}/>
            <div style={{fontFamily:SB.sans, fontSize:14, color:D_FAINT, letterSpacing:-0.1}}>
              search artists…
            </div>
            <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.06em', padding:'2px 6px', border:`1px solid ${D_RULE2}`, textTransform:'uppercase'}}>
              setlist.fm
            </div>
          </div>
        </div>
      </div>

      {/* Venue + Date */}
      <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr 130px', columnGap:14, marginBottom:26}}>
        <div>
          <FieldLabel hint="auto · from ticket">Venue</FieldLabel>
          <InputRow
            value="Kings Theatre · Flatbush, Brooklyn"
            prefixIcon={<Icon.MapPin size={14} color={D_MUTED}/>}
            trailing={<div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.06em'}}>9 prior</div>}
          />
        </div>
        <div>
          <FieldLabel>Date</FieldLabel>
          <InputRow
            value="Sat · Apr 04 · 2026"
            mono
            prefixIcon={<Icon.Calendar size={14} color={D_MUTED}/>}
            trailing={<Icon.ChevronDown size={12} color={D_FAINT}/>}
          />
        </div>
        <div>
          <FieldLabel>Cost</FieldLabel>
          <InputRow value="$78.00" mono trailing={<div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.04em'}}>USD</div>}/>
        </div>
      </div>

      {/* Seat + Tour (auto) */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:14, marginBottom:26}}>
        <div>
          <FieldLabel hint="auto · from pdf" optional>Seat</FieldLabel>
          <InputRow value="ORCH L · 14" mono prefixIcon={<Icon.Ticket size={14} color={D_MUTED}/>}/>
        </div>
        <div>
          <FieldLabel hint="auto · setlist.fm" optional>Tour</FieldLabel>
          <InputRow value="Romance World Tour" prefixIcon={<Icon.Music size={14} color={D_MUTED}/>}/>
        </div>
      </div>

      {/* Photos */}
      <div style={{marginBottom:26}}>
        <FieldLabel hint="drop to upload · 3 attached" optional>Photos</FieldLabel>
        <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:6}}>
          {[1,2,3].map(i=>(
            <div key={i} style={{
              aspectRatio:'1 / 1',
              background:`repeating-linear-gradient(135deg, ${D_SURF2} 0 6px, ${D_SURF} 6px 12px)`,
              border:`1px solid ${D_RULE2}`, position:'relative',
              display:'flex', alignItems:'flex-end', padding:6,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:9, color:D_FAINT, letterSpacing:'.06em'}}>
                IMG_{String(i).padStart(2,'0')}
              </div>
              {i===1 && (
                <div style={{position:'absolute', top:6, right:6, background:wk('concert'), color:'#120403', padding:'1px 5px', fontFamily:SB.mono, fontSize:9, fontWeight:700, letterSpacing:'.04em'}}>
                  COVER
                </div>
              )}
            </div>
          ))}
          <div style={{
            aspectRatio:'1 / 1',
            border:`1px dashed ${D_RULE2}`, background:'transparent',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexDirection:'column', gap:4, color:D_MUTED, cursor:'pointer',
          }}>
            <Icon.Plus size={16} color={D_MUTED}/>
            <div style={{fontFamily:SB.mono, fontSize:9, letterSpacing:'.08em', textTransform:'uppercase'}}>attach</div>
          </div>
          <div style={{
            aspectRatio:'1 / 1', gridColumn:'span 2',
            border:`1px dashed ${D_RULE}`, background:'transparent',
            display:'flex', alignItems:'center', justifyContent:'center',
            flexDirection:'column', gap:4, color:D_FAINT, padding:10, textAlign:'center',
          }}>
            <div style={{fontFamily:SB.mono, fontSize:10, color:D_MUTED, letterSpacing:'.06em'}}>drop photos here</div>
            <div style={{fontFamily:SB.mono, fontSize:9, color:D_FAINT, letterSpacing:'.04em'}}>jpg · heic · png</div>
          </div>
        </div>
      </div>

      {/* Data-source chips */}
      <div style={{marginBottom:26}}>
        <FieldLabel hint="start from a source">Import from</FieldLabel>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
          {[
            ['Ticketmaster URL','url','paste a link'],
            ['PDF ticket','pdf','drag or upload'],
            ['Gmail receipts','mail','scan inbox'],
          ].map(([t, tag, sub])=>(
            <div key={tag} style={{
              padding:'12px 14px', background:D_SURF, border:`1px solid ${D_RULE2}`,
              display:'flex', flexDirection:'column', gap:4, cursor:'pointer',
            }}>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{fontFamily:SB.mono, fontSize:9.5, color:D_MUTED, letterSpacing:'.1em', padding:'2px 5px', border:`1px solid ${D_RULE2}`, textTransform:'uppercase'}}>{tag}</div>
                <div style={{fontFamily:SB.sans, fontSize:13, fontWeight:500, color:D_INK, letterSpacing:-0.1}}>{t}</div>
              </div>
              <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.04em'}}>
                {sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Commit bar */}
      <div style={{
        display:'flex', alignItems:'center', gap:12, marginTop:8,
        paddingTop:18, borderTop:`1px solid ${D_RULE}`,
      }}>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_FAINT, letterSpacing:'.04em', flex:1}}>
          6 fields auto-filled · 0 errors
        </div>
        <div style={{
          padding:'9px 14px', border:`1px solid ${D_RULE2}`, color:D_MUTED,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase',
        }}>Cancel</div>
        <div style={{
          padding:'9px 14px', border:`1px solid ${D_RULE2}`, color:D_INK,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase',
        }}>Save draft</div>
        <div style={{
          padding:'9px 16px', background:D_INK, color:D_BG,
          fontFamily:SB.mono, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500,
          display:'inline-flex', alignItems:'center', gap:6,
        }}>
          <Icon.Check size={12} color={D_BG}/> Save to history
        </div>
      </div>
    </div>
  );
}

// ─── Right column · live preview + provenance log ─────────────────────
function LivePreview() {
  return (
    <div style={{padding:'28px 28px 40px', display:'flex', flexDirection:'column', gap:22, minHeight:0, overflow:'auto'}}>
      <div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase'}}>
          Live preview
        </div>
        <div style={{fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.02em', marginTop:3}}>
          what the archive row will look like
        </div>
      </div>

      {/* Preview card mirrors the UpcomingHero vibe */}
      <div style={{
        padding:'22px 22px', background:D_SURF,
        borderLeft:`3px solid ${wk('concert')}`,
      }}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:6,
            fontFamily:SB.mono, fontSize:10.5, color:wk('concert'),
            letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500,
          }}>
            <Icon.Dot size={9} color={wk('concert')}/> Concert
          </span>
          <span style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.04em'}}>
            PAST · 16 DAYS AGO
          </span>
        </div>
        <div style={{fontFamily:SB.sans, fontSize:30, fontWeight:600, color:D_INK, letterSpacing:-1.1, lineHeight:1}}>
          Fontaines D.C.
        </div>
        <div style={{fontFamily:SB.sans, fontSize:14, color:D_MUTED, marginTop:6, letterSpacing:-0.15}}>
          with Been Stellar
        </div>
        <div style={{display:'flex', alignItems:'baseline', gap:10, marginTop:18}}>
          <div style={{fontFamily:SB.sans, fontSize:48, fontWeight:500, color:D_INK, letterSpacing:-1.8, lineHeight:.9, fontFeatureSettings:'"tnum"'}}>04</div>
          <div>
            <div style={{fontFamily:SB.mono, fontSize:11, color:wk('concert'), letterSpacing:'.1em', fontWeight:500}}>APR · SAT</div>
            <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.04em', marginTop:3}}>2026</div>
          </div>
        </div>
        <div style={{marginTop:18, fontFamily:SB.mono, fontSize:11, display:'grid', gridTemplateColumns:'1fr', rowGap:6}}>
          {[
            ['Venue','Kings Theatre'],
            ['City','Brooklyn, NY'],
            ['Seat','ORCH L · 14'],
            ['Paid','$78.00'],
            ['Tour','Romance World Tour'],
            ['Setlist','21 songs · encore'],
            ['Photos','3 attached · IMG_01 = cover'],
          ].map(([k,v])=>(
            <div key={k} style={{
              display:'grid', gridTemplateColumns:'82px 1fr', columnGap:10,
              padding:'6px 0', borderTop:`1px solid ${D_RULE}`,
              alignItems:'baseline',
            }}>
              <div style={{color:D_FAINT, letterSpacing:'.08em', textTransform:'uppercase', fontSize:10}}>{k}</div>
              <div style={{color:D_INK, letterSpacing:'.02em'}}>{v}</div>
            </div>
          ))}
        </div>
        {/* photo strip */}
        <div style={{marginTop:16, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6}}>
          {[1,2,3].map(i=>(
            <div key={i} style={{
              aspectRatio:'4/3',
              background:`repeating-linear-gradient(135deg, ${D_SURF2} 0 6px, ${D_BG} 6px 12px)`,
              border:`1px solid ${D_RULE}`, display:'flex', alignItems:'flex-end', padding:5,
            }}>
              <div style={{fontFamily:SB.mono, fontSize:9, color:D_FAINT, letterSpacing:'.06em'}}>
                IMG_{String(i).padStart(2,'0')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provenance log */}
      <div>
        <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_MUTED, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10}}>
          Provenance · auto-fetched
        </div>
        <div style={{border:`1px solid ${D_RULE2}`}}>
          {[
            ['setlist.fm', 'tour, setlist (21), encore', 'ok'],
            ['ticketmaster', 'venue, date, seat, price', 'ok'],
            ['playbill',     'cast on this night', 'skipped · not theatre'],
            ['musicbrainz',  'artist disambiguation', 'ok · 2 artists'],
            ['photos',       '3 local · IMG_01 cover', 'ok'],
          ].map(([src, what, status], i, arr)=>{
            const ok = status.startsWith('ok');
            return (
              <div key={src} style={{
                display:'grid', gridTemplateColumns:'110px 1fr auto', columnGap:12,
                padding:'10px 14px',
                borderTop: i===0 ? 'none' : `1px solid ${D_RULE}`,
                alignItems:'center',
              }}>
                <div style={{fontFamily:SB.mono, fontSize:10.5, color:D_INK, letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500}}>
                  {src}
                </div>
                <div style={{fontFamily:SB.sans, fontSize:12.5, color:D_MUTED, letterSpacing:-0.1}}>
                  {what}
                </div>
                <div style={{
                  fontFamily:SB.mono, fontSize:10, color: ok ? wk('festival') : D_FAINT,
                  letterSpacing:'.04em',
                  display:'inline-flex', alignItems:'center', gap:4,
                }}>
                  {ok ? <Icon.Check size={10} color={wk('festival')}/> : <span style={{fontSize:12, lineHeight:1}}>–</span>}
                  {status}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{marginTop:10, fontFamily:SB.mono, fontSize:10, color:D_FAINT, letterSpacing:'.04em', lineHeight:1.5}}>
          we never ask you to type cast, setlists, or tour names — these are
          fetched from sources when you pick an artist + date.
        </div>
      </div>
    </div>
  );
}

// ─── Add · web main ────────────────────────────────────────────────────
function AddWeb() {
  return (
    <div style={{
      width:'100%', height:'100%', background:D_BG, color:D_INK,
      display:'flex', fontFamily:SB.sans, WebkitFontSmoothing:'antialiased',
      overflow:'hidden',
    }}>
      <AddSidebar/>

      <div style={{flex:1, display:'flex', flexDirection:'column', minWidth:0}}>
        {/* Top bar — breadcrumb */}
        <div style={{
          padding:'14px 32px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          borderBottom:`1px solid ${D_RULE}`,
        }}>
          <div style={{display:'flex', alignItems:'center', gap:10, fontFamily:SB.mono, fontSize:11.5, color:D_MUTED, letterSpacing:'.04em'}}>
            <span>home</span>
            <Icon.ChevronRight size={12} color={D_FAINT}/>
            <span style={{color:D_INK, fontWeight:500}}>add a show</span>
            <span style={{color:D_FAINT}}>·</span>
            <span style={{color:D_FAINT}}>draft · autosaved 2s ago</span>
          </div>
          <div style={{display:'flex', gap:14, alignItems:'center', fontFamily:SB.mono, fontSize:11, color:D_MUTED}}>
            <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
              <span style={{width:6, height:6, borderRadius:999, background:wk('festival')}}/> 5 sources connected
            </span>
            <Icon.More size={15} color={D_MUTED}/>
          </div>
        </div>

        {/* Content — 2 cols */}
        <div style={{
          flex:1, display:'grid',
          gridTemplateColumns:'1fr 440px',
          minHeight:0, overflow:'hidden',
        }}>
          <div style={{minWidth:0, display:'flex', flexDirection:'column'}}>
            <AddForm/>
          </div>
          <div style={{minWidth:0, borderLeft:`1px solid ${D_RULE}`, background:D_BG}}>
            <LivePreview/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AddWeb = AddWeb;
