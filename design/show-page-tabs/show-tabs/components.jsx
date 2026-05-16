// Tab system + tab content components — used by all 3 viewports.
// Renderer is "responsive" via the `width` prop passed in (not media queries),
// because each artboard has its own fixed canvas size.

const { SB, Icon, SHOW } = window;

const M = 'dark';
const BG    = SB.bg[M];
const SURF  = SB.surface[M];
const SURF2 = SB.surface2[M];
const INK   = SB.ink[M];
const MUTED = SB.muted[M];
const FAINT = SB.faint[M];
const RULE  = SB.rule[M];
const RULE2 = SB.ruleStrong[M];
const ACCENT = SB.accent.dark;       // gold for upcoming/tix
const KIND   = SB.kinds.concert.inkDark; // stage blue

// ─────────────────────────────────────────── Hero (image + title block) ──
function ShowHero({ compact = false }) {
  const heroH = compact ? 160 : 240;
  return (
    <div>
      {/* Editorial placeholder for the band photo. Mirrors the No Doubt
          press shot — 4 figures in dark suits on white. */}
      <div style={{
        height: heroH,
        background: `
          linear-gradient(180deg, #1A1A1A 0%, #232323 50%, #F0EFEA 50%, #FAFAF8 100%)
        `,
        position: 'relative', overflow: 'hidden',
      }}>
        <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice"
             width="100%" height="100%" style={{ display:'block' }}>
          <defs>
            <linearGradient id="suit" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0E0E0E"/>
              <stop offset="0.55" stopColor="#1B1B1B"/>
              <stop offset="0.55" stopColor="#FAFAF8"/>
              <stop offset="1" stopColor="#FAFAF8"/>
            </linearGradient>
          </defs>
          {/* 4 silhouetted busts */}
          {[60, 145, 235, 325].map((cx,i)=>(
            <g key={i}>
              <circle cx={cx} cy={70} r={28} fill="#F0EFEA"/>
              <path d={`M ${cx-46} 240 L ${cx-46} 130 Q ${cx-46} 95 ${cx} 95 Q ${cx+46} 95 ${cx+46} 130 L ${cx+46} 240 Z`} fill="url(#suit)"/>
              {/* tie */}
              <path d={`M ${cx-3} 132 L ${cx+3} 132 L ${cx+5} 175 L ${cx} 200 L ${cx-5} 175 Z`} fill="#0A0A0A"/>
              {/* collar */}
              <path d={`M ${cx-14} 132 L ${cx} 145 L ${cx+14} 132 L ${cx+14} 138 L ${cx} 152 L ${cx-14} 138 Z`} fill="#FAFAF8"/>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function ShowTitleBlock({ compact = false, past = false, padX: padXOverride }) {
  const padX = padXOverride != null ? padXOverride : (compact ? 20 : 32);
  const SHOW_DATA = past ? window.PAST_SHOW : window.SHOW;
  const setLen = past ? SHOW_DATA.musicLayer.setLength : SHOW_DATA.musicLayer.setLengthEst;
  return (
    <div style={{ padding: `${compact?16:22}px ${padX}px ${compact?14:18}px` }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: compact?8:10 }}>
        <Icon.Music size={compact?12:13} color={MUTED}/>
        <span style={{ fontFamily:SB.mono, fontSize: compact?10:10.5, color:MUTED, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500 }}>
          {SHOW_DATA.kind}
        </span>
      </div>
      <div style={{
        fontFamily:SB.sans, fontWeight:600, color:INK, letterSpacing:-1.5,
        fontSize: compact ? 32 : 44, lineHeight:.96,
      }}>
        {SHOW_DATA.headliner}
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:14, gap:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontFamily:SB.sans, fontSize: compact?13:14, color:MUTED }}>
            {SHOW_DATA.date.full}
          </span>
          <span style={{ fontFamily:SB.mono, fontSize:11, color:ACCENT, letterSpacing:'.04em' }}>
            {SHOW_DATA.countdown}
          </span>
          {setLen && (
            <span style={{ fontFamily:SB.mono, fontSize:11, color: past? INK : MUTED, letterSpacing:'.04em', fontFeatureSettings:'"tnum"' }}>
              · {setLen}
            </span>
          )}
        </div>
        {past ? (
          <span style={{ padding:'4px 10px', background:'transparent', border:`1px solid ${RULE2}`, color:MUTED, fontFamily:SB.mono, fontSize:10.5, fontWeight:500, letterSpacing:'.18em', textTransform:'uppercase' }}>went</span>
        ) : (
          <span style={{ padding:'4px 10px', background:ACCENT, color:SB.accent.text, fontFamily:SB.mono, fontSize:10.5, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase' }}>tix</span>
        )}
      </div>
      {past && SHOW_DATA.musicLayer.priming && (
        <div style={{ marginTop:14, fontFamily:SB.sans, fontSize:13, color:MUTED, fontStyle:'italic', letterSpacing:-0.1, lineHeight:1.4 }}>
          {SHOW_DATA.musicLayer.priming}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── Tab bar ──
function TabBar({ active, onSelect, compact = false, padX = 32, past = false }) {
  const tabs = past ? [
    { key:'overview', label:'Overview' },
    { key:'setlist',  label:'Setlist',  badge: '16' },
    { key:'media',    label:'Media',    badge: '12' },
    { key:'notes',    label:'Notes',    badge: '·' },
  ] : [
    { key:'overview', label:'Overview' },
    { key:'setlist',  label:'Setlist',  badge: '92%' },
    { key:'media',    label:'Media',    badge: '0' },
    { key:'notes',    label:'Notes' },
  ];
  return (
    <div style={{
      display:'flex', gap:0,
      padding: `0 ${padX}px`,
      borderBottom:`1px solid ${RULE}`,
      background:BG, position:'sticky', top:0, zIndex:2,
    }}>
      {tabs.map(t=>{
        const on = t.key === active;
        return (
          <div key={t.key} onClick={()=>onSelect && onSelect(t.key)}
            style={{
              padding: compact ? '12px 0' : '14px 0',
              marginRight: compact ? 18 : 26,
              fontFamily:SB.mono, fontSize: compact?11:12,
              letterSpacing:'.04em',
              color: on ? INK : MUTED,
              fontWeight: on ? 500 : 400,
              borderBottom: on ? `2px solid ${ACCENT}` : '2px solid transparent',
              display:'inline-flex', alignItems:'center', gap:7,
              cursor:'pointer',
            }}>
            <span style={{ textTransform:'lowercase' }}>{t.label}</span>
            {t.badge && (
              <span style={{
                fontFamily:SB.mono, fontSize:9.5,
                color: on ? ACCENT : FAINT,
                padding: '1px 6px',
                border: `1px solid ${on ? ACCENT+'66' : RULE2}`,
                letterSpacing:'.04em',
              }}>{t.badge}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────── Stat row ──
function StatRow({ compact = false, padX = 32, past = false }) {
  const D = past ? window.PAST_SHOW : window.SHOW;
  const cells = past ? [
    ['VENUE',  D.venue,             D.city],
    ['SEAT',   D.seat,              `${D.tickets} tix`],
    ['ON STAGE', D.musicLayer.setLength.replace(' on stage',''), `doors ${D.doors}`],
    ['DROVE',  '4.4 mi',            'home by 11:30'],
  ] : [
    ['VENUE',  D.venue,             D.city],
    ['SEAT',   D.seat,              `${D.tickets} tix`],
    ['PAID',   `$${D.paid.toLocaleString()}`, `$${D.paidEach}/ea`],
    ['DOORS',  D.doors,             `show ${D.showtime}`],
  ];
  return (
    <div style={{
      padding: `${compact?14:18}px ${padX}px`,
      borderBottom:`1px solid ${RULE}`,
      background: SURF,
      display:'grid',
      gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
      columnGap: compact ? 14 : 22,
      rowGap: compact ? 14 : 0,
    }}>
      {cells.map(([l,v,sub], i)=>(
        <div key={l}>
          <div style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>{l}</div>
          <div style={{ fontFamily:SB.sans, fontSize: compact?15:17, fontWeight:500, color:INK, letterSpacing:-0.4, marginTop:4, fontFeatureSettings:'"tnum"', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{v}</div>
          <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.02em' }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────── OVERVIEW tab ──
function OverviewTab({ compact = false, past = false, twoCol = false }) {
  const padX = compact ? 20 : 32;
  const SHOW_DATA = past ? window.PAST_SHOW : window.SHOW;
  const ml = SHOW_DATA.musicLayer;
  return (
    <div>
      <StatRow compact={compact} padX={padX} past={past}/>
      {past && (
        <div style={{ padding: `${compact?20:24}px ${padX}px`, borderBottom:`1px solid ${RULE}` }}>
          <div style={{ display:'grid', gridTemplateColumns: compact?'1fr':'auto 1fr', gap: compact?16:28, alignItems:'center' }}>
            <window.VibeRadar size={compact?160:200} profile={ml.vibeActual} label={ml.vibeLabel} compact={compact}/>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <window.FanLoyaltyRing pct={Math.round(ml.libraryHave/ml.libraryTotal*100)} total={ml.libraryTotal} size={compact?80:96}/>
              <div style={{ fontFamily:SB.mono, fontSize:11, color:MUTED, lineHeight:1.6, letterSpacing:'.02em' }}>
                7-axis vibe averaged across all {ml.libraryTotal} songs played, scored on Spotify's audio-features data. Tap an axis to see which tracks pulled the shape that way.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lineup */}
      <Section title="Lineup" count={SHOW.lineup.length} action="Edit" padX={padX} compact={compact}>
        {SHOW.lineup.map((a,i)=>(
          <div key={i} style={{
            padding: compact ? '14px 14px' : '16px 18px',
            background: SURF, borderLeft:`2px solid ${ACCENT}`,
            display:'grid', gridTemplateColumns:'1fr', gap:4,
          }}>
            <div style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>{a.role}</div>
            <div style={{ fontFamily:SB.sans, fontSize: compact?17:19, fontWeight:600, color:INK, letterSpacing:-0.4 }}>{a.name}</div>
            {a.detail && <div style={{ fontFamily:SB.mono, fontSize:10.5, color:MUTED, marginTop:4, letterSpacing:'.02em' }}>{a.detail}</div>}
          </div>
        ))}
      </Section>

      {/* Your history with this venue/artist */}
      <Section title="Your history" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: compact?'1fr':'1fr 1fr', gap: compact?8:10 }}>
          {[
            ['ARTIST',  SHOW.artistHistory.ordinal, 'no Showbook history'],
            ['VENUE',   SHOW.venueHistory.ordinal,  'last seen U2 · Sep 2024'],
          ].map(([l,v,sub])=>(
            <div key={l} style={{ padding:'14px 16px', background:SURF, border:`1px solid ${RULE}` }}>
              <div style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>{l}</div>
              <div style={{ fontFamily:SB.sans, fontSize:15, color:INK, fontWeight:500, marginTop:4, letterSpacing:-0.2 }}>{v}</div>
              <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.02em' }}>{sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Actions */}
      <Section title="Actions" padX={padX} compact={compact}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <ActionBtn primary icon={<Icon.Check size={13} color={SB.accent.text}/>}>Mark as attended</ActionBtn>
          <ActionBtn icon={<Icon.Edit size={13} color={INK}/>}>Edit show</ActionBtn>
          <ActionBtn icon={<Icon.Calendar size={13} color={INK}/>}>Add to calendar</ActionBtn>
          <ActionBtn icon={<Icon.Trash size={13} color="#E63946"/>} danger>Delete</ActionBtn>
        </div>
      </Section>
    </div>
  );
}

function ActionBtn({ children, icon, primary, danger }) {
  return (
    <div style={{
      padding:'10px 14px',
      background: primary ? ACCENT : 'transparent',
      border: primary ? 'none' : `1px solid ${danger ? '#E6394640' : RULE2}`,
      color: primary ? SB.accent.text : (danger ? '#E63946' : INK),
      fontFamily:SB.sans, fontSize:13, fontWeight: primary?600:500,
      display:'inline-flex', alignItems:'center', gap:7,
      cursor:'pointer', whiteSpace:'nowrap',
    }}>
      {icon}{children}
    </div>
  );
}

function Section({ title, count, action, children, padX = 32, compact = false }) {
  return (
    <div style={{ padding: `${compact?20:24}px ${padX}px`, borderBottom:`1px solid ${RULE}` }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: compact?12:14 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <span style={{ fontFamily:SB.mono, fontSize:11, color:INK, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:500 }}>{title}</span>
          {count !== undefined && (
            <span style={{ fontFamily:SB.mono, fontSize:10.5, color:FAINT, letterSpacing:'.04em' }}>· {count}</span>
          )}
        </div>
        {action && (
          <span style={{ fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.04em', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5 }}>
            <Icon.Edit size={11} color={MUTED}/>{action.toLowerCase()}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────── SETLIST tab ──
function SetlistTab({ compact = false, past = false, twoCol = false }) {
  const padX = compact ? 20 : 32;
  if (past) return <SetlistTabPast compact={compact} padX={padX} twoCol={twoCol}/>;
  const ml = window.SHOW.musicLayer;
  return (
    <div>
      {/* Confidence + source banner */}
      <div style={{ padding: `${compact?16:20}px ${padX}px`, background:SURF, borderBottom:`1px solid ${RULE}`, display:'grid', gridTemplateColumns: compact?'1fr':'auto 1fr auto', columnGap:24, rowGap:14, alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <div style={{ fontFamily:SB.sans, fontSize:42, fontWeight:500, color:ACCENT, letterSpacing:-1.5, fontFeatureSettings:'"tnum"', lineHeight:.95 }}>{SHOW.confidence}<span style={{ fontSize:18, color:MUTED, letterSpacing:0 }}>%</span></div>
          <div>
            <div style={{ fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>Confidence</div>
            <div style={{ fontFamily:SB.mono, fontSize:11, color:INK, marginTop:2, letterSpacing:'.04em' }}>STABLE archetype</div>
          </div>
        </div>
        <div style={{ borderLeft: compact ? 'none' : `1px solid ${RULE}`, paddingLeft: compact ? 0 : 24 }}>
          <div style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>Predicted from</div>
          <div style={{ fontFamily:SB.sans, fontSize:14, color:INK, marginTop:4 }}>last 12 shows · Sphere residency nights 1-3 + Coachella</div>
          <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.02em' }}>median 14 songs · 92 min</div>
        </div>
      </div>

      {/* Hype playlist hero card */}
      <div style={{ padding: `${compact?16:20}px ${padX}px`, borderBottom:`1px solid ${RULE}` }}>
        <window.HypePlaylistCard artist={SHOW.headliner} count={14} mins={92} compact={compact}/>
      </div>

      {/* Predicted vibe + energy arc */}
      <Section title="Predicted shape" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: (compact||twoCol)?'1fr':'auto 1fr', gap: compact?16:24, alignItems:'center' }}>
          <window.VibeRadar size={compact?150:180} profile={ml.vibePredicted} label="high-energy · upbeat · danceable" compact={compact}/>
          <window.EnergyArc values={ml.energyPredicted} encoreStart={ml.encoreStart} width={compact?320:520} height={compact?80:96}/>
        </div>
      </Section>

      {/* Predicted setlist */}
      <Section title="Likely setlist" count={SHOW.predicted.length + SHOW.encorePredicted.length} action="See alternates" padX={padX} compact={compact}>
        <div style={{ display: (compact && !twoCol) ? 'block' : 'grid', gridTemplateColumns: (compact && !twoCol) ? '1fr' : '1fr 1fr', columnGap:24 }}>
          {[...SHOW.predicted, null, ...SHOW.encorePredicted].map((row, i)=>{
            if (row === null) {
              return (
                <div key="div" style={{ gridColumn: compact?'1/-1':'1/-1', padding:'14px 0 8px', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ fontFamily:SB.mono, fontSize:10, color:ACCENT, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:500 }}>— Encore</div>
                  <div style={{ flex:1, height:1, background:RULE }}/>
                </div>
              );
            }
            const [t, opener, freq] = row;
            const idx = i < SHOW.predicted.length ? i+1 : (i - SHOW.predicted.length);
            return (
              <div key={t+i} style={{
                display:'grid', gridTemplateColumns:'24px auto 1fr auto', columnGap:12,
                padding: compact?'9px 0':'10px 0', borderBottom:`1px solid ${RULE}`, alignItems:'center',
              }}>
                <span style={{ fontFamily:SB.mono, fontSize:10.5, color:FAINT, fontFeatureSettings:'"tnum"' }}>{String(idx).padStart(2,'0')}</span>
                <window.TrackPreview/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontFamily:SB.sans, fontSize:14, color:INK, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t}</div>
                  <div style={{ fontFamily:SB.mono, fontSize:9.5, color:MUTED, marginTop:2, letterSpacing:'.02em' }}>{freq}</div>
                </div>
                {opener && (
                  <span style={{ fontFamily:SB.mono, fontSize:9, color:ACCENT, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:500 }}>★</span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <div style={{ padding: `14px ${padX}px 24px`, fontFamily:SB.mono, fontSize:10.5, color:FAINT, letterSpacing:'.02em', lineHeight:1.6 }}>
        Setlist locks in after the show. We'll auto-pull the actual songs from setlist.fm and offer a "save tonight to Spotify" button.
      </div>
    </div>
  );
}

// ────────────────────────────────────── SETLIST tab — past show variant ──
function SetlistTabPast({ compact, padX, twoCol }) {
  const D = window.PAST_SHOW;
  const ml = D.musicLayer;
  return (
    <div>
      {/* CONFIRMED banner */}
      <div style={{ padding: `${compact?16:20}px ${padX}px`, background:SURF, borderBottom:`1px solid ${RULE}`, display:'grid', gridTemplateColumns: compact?'1fr':'auto 1fr', columnGap:24, rowGap:14, alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <div style={{ fontFamily:SB.sans, fontSize:42, fontWeight:500, color:INK, letterSpacing:-1.5, fontFeatureSettings:'"tnum"', lineHeight:.95 }}>16</div>
          <div>
            <div style={{ fontFamily:SB.mono, fontSize:10, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>Songs played</div>
            <div style={{ fontFamily:SB.mono, fontSize:11, color:ACCENT, marginTop:2, letterSpacing:'.04em' }}>{ml.setLength.toUpperCase()}</div>
          </div>
        </div>
        <div style={{ borderLeft: compact ? 'none' : `1px solid ${RULE}`, paddingLeft: compact ? 0 : 24 }}>
          <div style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, letterSpacing:'.14em', textTransform:'uppercase' }}>Source of truth</div>
          <div style={{ fontFamily:SB.sans, fontSize:14, color:INK, marginTop:4 }}>setlist.fm · confirmed by 8 attendees</div>
          <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:3, letterSpacing:'.02em' }}>locked in 2026-05-03 03:14 UTC</div>
        </div>
      </div>

      {/* What I heard playlist card */}
      <div style={{ padding: `${compact?16:20}px ${padX}px`, borderBottom:`1px solid ${RULE}` }}>
        <window.HypePlaylistCard artist={'I Heard ' + D.headliner} count={16} mins={107} compact={compact}/>
      </div>

      {/* Energy arc */}
      <Section title="How the night unfolded" padX={padX} compact={compact}>
        <window.EnergyArc values={ml.energyActual} encoreStart={ml.encoreStart} width={compact?320:560} height={compact?88:104}/>
      </Section>

      {/* Actual setlist with previews */}
      <Section title="Setlist" count={D.actual.length + D.encoreActual.length} action="Save to Spotify" padX={padX} compact={compact}>
        <div style={{ display: (compact && !twoCol) ? 'block' : 'grid', gridTemplateColumns: (compact && !twoCol) ? '1fr' : '1fr 1fr', columnGap:24 }}>
          {[...D.actual, null, ...D.encoreActual].map((row, i)=>{
            if (row === null) return (
              <div key="div" style={{ gridColumn:'1/-1', padding:'14px 0 8px', display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ fontFamily:SB.mono, fontSize:10, color:ACCENT, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:500 }}>— Encore</div>
                <div style={{ flex:1, height:1, background:RULE }}/>
              </div>
            );
            const [t, opener, energy, hadIt] = row;
            const idx = i < D.actual.length ? i+1 : (i - D.actual.length);
            return (
              <div key={t+i} style={{ display:'grid', gridTemplateColumns:'24px auto 1fr auto auto', columnGap:12, padding: compact?'9px 0':'10px 0', borderBottom:`1px solid ${RULE}`, alignItems:'center' }}>
                <span style={{ fontFamily:SB.mono, fontSize:10.5, color:FAINT, fontFeatureSettings:'"tnum"' }}>{String(idx).padStart(2,'0')}</span>
                <window.TrackPreview/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontFamily:SB.sans, fontSize:14, color:INK, letterSpacing:-0.1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:8 }}>
                    {t}
                    {!hadIt && <span style={{ fontFamily:SB.mono, fontSize:8.5, color:ACCENT, letterSpacing:'.14em', padding:'1px 5px', border:`1px solid ${ACCENT}66` }}>NEW</span>}
                  </div>
                  <div style={{ fontFamily:SB.mono, fontSize:9.5, color:MUTED, marginTop:2, letterSpacing:'.02em' }}>
                    energy {Math.round(energy*100)} · {hadIt ? 'in your library' : 'discovered tonight'}
                  </div>
                </div>
                {opener && (<span style={{ fontFamily:SB.mono, fontSize:9, color:ACCENT, letterSpacing:'.14em', textTransform:'uppercase', fontWeight:500 }}>★</span>)}
                <span style={{ fontFamily:SB.mono, fontSize:9.5, color:FAINT, fontFeatureSettings:'"tnum"' }}>{Math.floor(2.5+energy*1.5)}:{String(Math.floor(energy*60)).padStart(2,'0')}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Discovered live rail */}
      <Section title="Songs you heard for the first time" count={ml.discovered.length} padX={padX} compact={compact}>
        <window.DiscoveredRail tracks={ml.discovered} compact={compact}/>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────── MEDIA tab ──
function MediaTab({ compact = false, past = false }) {
  const padX = compact ? 20 : 32;
  if (past) return <MediaTabPast compact={compact} padX={padX}/>;
  return (
    <div>
      <Section title="Media" count={0} action="Upload" padX={padX} compact={compact}>
        <div style={{
          minHeight: compact?180:240,
          border:`1px dashed ${RULE2}`,
          background: `repeating-linear-gradient(45deg, transparent 0 12px, ${RULE} 12px 13px)`,
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding:'24px 16px', gap:8, textAlign:'center',
        }}>
          <Icon.Camera size={22} color={FAINT}/>
          <div style={{ fontFamily:SB.sans, fontSize:15, color:INK, fontWeight:500 }}>No media yet</div>
          <div style={{ fontFamily:SB.mono, fontSize:10.5, color:MUTED, letterSpacing:'.02em', maxWidth:280 }}>
            Photos and short clips you upload here will land in your Memory Wall after the show.
          </div>
          <div style={{ marginTop:6 }}>
            <ActionBtn primary icon={<Icon.Plus size={13} color={SB.accent.text}/>}>Upload media</ActionBtn>
          </div>
        </div>
      </Section>

      <Section title="What we'll add automatically" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: compact?'1fr':'1fr 1fr', gap:8 }}>
          {[
            ['🎫','Ticket stub','from Apple Wallet'],
            ['🎵','Live playlist','after setlist syncs'],
            ['📍','Map of venue','Sphere · LV strip'],
            ['📰','Press recap','Pitchfork / Variety'],
          ].map(([e,t,s])=>(
            <div key={t} style={{ padding:'14px 16px', background:SURF, border:`1px solid ${RULE}`, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:16 }}>{e}</span>
              <div>
                <div style={{ fontFamily:SB.sans, fontSize:13.5, color:INK, fontWeight:500 }}>{t}</div>
                <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:2 }}>{s}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────── MEDIA tab — past variant ──
function MediaTabPast({ compact, padX }) {
  return (
    <div>
      <Section title="Photos" count={12} action="Upload more" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: compact?'repeat(3, 1fr)':'repeat(4, 1fr)', gap:6 }}>
          {Array.from({length: compact?9:12}).map((_,i)=>{
            const tones = ['#1A1A1A','#2A2A2A','#0E0E0E','#202020','#161616','#1F1F1F'];
            return (
              <div key={i} style={{
                aspectRatio:'1', background:tones[i%6], position:'relative', overflow:'hidden',
              }}>
                {/* Simulated stage-light glow */}
                <div style={{ position:'absolute', inset:0, background:`radial-gradient(circle at ${30+i*7}% ${20+i*5}%, ${i%3===0?'#E2B14F44':'#1A1A1A44'}, transparent 60%)` }}/>
                <div style={{ position:'absolute', left:0, bottom:0, width:`${20+(i*7)%50}%`, height:`${30+(i*11)%40}%`, background:'#0A0A0A' }}/>
                {i===0 && <div style={{ position:'absolute', right:6, top:6, width:6, height:6, borderRadius:999, background:ACCENT, boxShadow:`0 0 0 2px ${SURF}` }}/>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="From the night" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: compact?'1fr':'1fr 1fr', gap:8 }}>
          {[
            ['🎫','Ticket stub','Apple Wallet · 2026-05-02'],
            ['🎵','I-heard playlist','16 songs · 1h 47m'],
            ['📍','Map of Sphere','tap for the walk-out gif'],
            ['📰','Variety recap','★★★★ "the comeback was real"'],
          ].map(([e,t,s])=>(
            <div key={t} style={{ padding:'14px 16px', background:SURF, border:`1px solid ${RULE}`, display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:16 }}>{e}</span>
              <div>
                <div style={{ fontFamily:SB.sans, fontSize:13.5, color:INK, fontWeight:500 }}>{t}</div>
                <div style={{ fontFamily:SB.mono, fontSize:10, color:MUTED, marginTop:2 }}>{s}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────── NOTES tab ──
function NotesTab({ compact = false, past = false }) {
  const padX = compact ? 20 : 32;
  const prompts = past ? [
    'My favorite moment',
    'Who I went with · vibe',
    'A song I’ll never forget',
    'Would I see them again?',
  ] : [
    'Songs I want to hear',
    'Who I\'m going with',
    'Pre-show plan',
    'What this show means to me',
  ];
  return (
    <div>
      <Section title="Your notes" padX={padX} compact={compact}>
        <div style={{ minHeight: compact?160:200, padding:'16px 18px', background:SURF, border:`1px solid ${RULE}`, borderLeft:`2px solid ${FAINT}` }}>
          <div style={{ fontFamily:SB.sans, fontSize:14, color:MUTED, fontStyle:'italic', lineHeight:1.6 }}>
            Capture a thought before the show — what you're hoping to hear, who you're going with, the bar plan.
          </div>
          <div style={{ fontFamily:SB.mono, fontSize:10, color:FAINT, marginTop:14, letterSpacing:'.04em' }}>
            tap to write · only you see this
          </div>
        </div>
      </Section>

      <Section title="Quick prompts" padX={padX} compact={compact}>
        <div style={{ display:'grid', gridTemplateColumns: compact?'1fr':'1fr 1fr', gap:8 }}>
          {prompts.map(p=>(
            <div key={p} style={{ padding:'12px 14px', background:'transparent', border:`1px solid ${RULE}`, fontFamily:SB.sans, fontSize:13, color:INK, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
              <Icon.Plus size={12} color={MUTED}/>{p}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────── Top bar / breadcrumb ──
function CrumbBar({ padX = 32 }) {
  return (
    <div style={{
      padding: `12px ${padX}px`, borderBottom:`1px solid ${RULE}`,
      display:'flex', alignItems:'center', gap:8, justifyContent:'space-between',
      background:BG,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, fontFamily:SB.mono, fontSize:11, color:MUTED, letterSpacing:'.04em', minWidth:0, overflow:'hidden' }}>
        <Icon.ChevronLeft size={12} color={MUTED}/>
        <span style={{ color:MUTED }}>shows</span>
        <span style={{ color:FAINT }}>/</span>
        <span style={{ color:INK, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>no doubt @ sphere · 2026-05-09</span>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <div style={{ width:24, height:24, border:`1px solid ${RULE}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <Icon.More size={13} color={MUTED}/>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── Main wrapper ──
function ShowTabsBody({ activeTab, compact = false, past = false, twoCol = false }) {
  return (
    <>
      {activeTab === 'overview' && <OverviewTab compact={compact} past={past} twoCol={twoCol}/>}
      {activeTab === 'setlist'  && <SetlistTab  compact={compact} past={past} twoCol={twoCol}/>}
      {activeTab === 'media'    && <MediaTab    compact={compact} past={past}/>}
      {activeTab === 'notes'    && <NotesTab    compact={compact} past={past}/>}
    </>
  );
}

Object.assign(window, {
  ShowHero, ShowTitleBlock, TabBar, StatRow,
  OverviewTab, SetlistTab, MediaTab, NotesTab,
  CrumbBar, ShowTabsBody, ActionBtn, Section,
  ST_TOKENS: { BG, SURF, SURF2, INK, MUTED, FAINT, RULE, RULE2, ACCENT, KIND },
});
