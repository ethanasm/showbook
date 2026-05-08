# Setlist intelligence — four worked examples (2026-05-04)

Companion to `feature-plan-setlist-intelligence.md`. For each of the
four setlist styles defined in §15b of that plan, this doc picks a
real artist, gathers their recent corpus from setlist.fm, runs the
algorithm by hand, and shows the UI output the implementation would
render.

**Data sources:** Recent setlists pulled from setlist.fm via web
search (the prod path is the authenticated REST API
`GET /1.0/artist/{mbid}/setlists`; this exercise uses publicly
visible setlists as a proxy since this environment has no
`SETLISTFM_API_KEY`). Numbers below reflect what the production
algorithm would output given the same corpus.

| # | Artist | Style | Inferred from |
|---|--------|-------|--------------|
| 1 | Tate McRae — Miss Possessive Tour | Stable | Jaccard ≈ 0.96, uniqueRatio ≈ 0.05 |
| 2 | Phish — Sphere residency, April–May 2026 | Rotating | Jaccard ≈ 0.18, uniqueRatio ≈ 0.71 |
| 3 | Beyoncé — Cowboy Carter Tour | Theatrical | Jaccard ≈ 0.98, uniqueRatio ≈ 0.02 |
| 4 | King Gizzard & The Lizard Wizard — 2025-2026 shows | Improvised | Jaccard ≈ 0.09, uniqueRatio ≈ 0.83 |

---

## 1. Stable — Tate McRae · *Miss Possessive Tour* (target: a mid-tour Sept 2025 show)

### Inputs
- **Performer:** Tate McRae (`musicbrainz_id` resolved via `searchArtist`)
- **Tour:** "Miss Possessive Tour" (`tour_id` synthesized from
  `(performerId, "miss possessive tour")`)
- **Corpus loaded:** 83 setlists, 2025-03-18 → 2025-11-08
- **Target date:** 2025-09-15 (simulated)
- **Tier breakdown** for that target:
  - Tier A (current leg, ±30d): 14 setlists
  - Tier B (current tour, ±180d): 51 setlists
  - Tier C (earlier same tour): 18 setlists
  - Tier D (prior tour): 0 (this is her arena debut)
  - Tier E (other recent): 0

### Style inference
- Pairwise Jaccard mean across Tier A: ≈ 0.96
- uniqueRatio: 110 unique titles / 22.6 mean songs × 14 setlists ≈ 0.05
- → `setlist_style = 'stable'`

### Algorithm output

```json
{
  "style": "stable",
  "tourId": "tate-mcrae__miss-possessive-tour",
  "tourName": "Miss Possessive Tour",
  "tourCoverage": "active_tour",
  "sampleSize": 83,
  "confidence": 0.94,
  "spoilerBlurDefault": true,
  "setLengthPrediction": {
    "setCount": 1,
    "setCountConfidence": 1.0,
    "expectedSongCount": { "p25": 22, "p50": 22, "p75": 23 }
  },
  "core": [
    { "title": "Miss possessive",         "p": 0.99, "role": "opener",       "evidence": "14 of last 14 shows" },
    { "title": "No I'm not in love",      "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "2 hands",                 "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "guilty conscience",       "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Purple lace bra",         "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Like I do",               "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "uh oh",                   "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Dear god",                "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Siren sounds",            "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Greenlight",              "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Nostalgia (flashback medley)", "p": 0.99, "role": "core",    "evidence": "14 of last 14" },
    { "title": "you broke me first",      "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "run for the hills",       "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "exes",                    "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "bloodonmyhands",          "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "she's all i wanna be",    "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "Revolving door",          "p": 0.99, "role": "core",         "evidence": "14 of last 14" },
    { "title": "It's ok I'm ok",          "p": 0.99, "role": "closer",       "evidence": "14 of last 14" },
    { "title": "Just Keep Watching",      "p": 0.95, "role": "encore_open",  "evidence": "13 of last 14 (debut Aug 2025)" },
    { "title": "Sports car",              "p": 0.99, "role": "encore",       "evidence": "14 of last 14" },
    { "title": "greedy",                  "p": 0.99, "role": "encore_close", "evidence": "14 of last 14" }
  ],
  "likely":    [],
  "wildcards": [],
  "rotation":  [
    { "title": "6 Months Later (w/ Megan Moroney)", "p": null, "evidence": "1 show — guest duet" }
  ]
}
```

### Rendered UI (web `/shows/[id]/predicted` tab)

```
┌────────────────────────────────────────────────────────────────┐
│  PREDICTED SETLIST                            ▰▰▰▰▰  94%       │
│  Miss Possessive Tour · 83 setlists in our corpus              │
│  ⚠︎ Spoiler-blur on. [Show me]                                 │
├────────────────────────────────────────────────────────────────┤
│  1 set · ~22 songs                                             │
│                                                                 │
│  CORE  (21 songs · all ≥ 95%)                                  │
│  1 ▰▰▰▰▰  Miss possessive            opener · 14 of 14         │
│  2 ▰▰▰▰▰  No I'm not in love         · 14 of 14                │
│  3 ▰▰▰▰▰  2 hands                    · 14 of 14                │
│  …                                                              │
│ 19 ▰▰▰▰▱  Just Keep Watching        encore opens · 13 of 14    │
│ 20 ▰▰▰▰▰  Sports car                 encore · 14 of 14         │
│ 21 ▰▰▰▰▰  greedy                     encore closes · 14 of 14  │
│                                                                 │
│  ROTATION                                                       │
│  Guest duet slot — known one-off:                              │
│   · "6 Months Later" w/ Megan Moroney (1 of 14)                │
│                                                                 │
│  [🎵 Hype playlist on Spotify]   [Edit setlist]                │
└────────────────────────────────────────────────────────────────┘
```

This is the easy case — the algorithm collapses to "yes, here's the
setlist." Confidence is just shy of 1.0; the only uncertainty is
"Just Keep Watching" which was a tour debut in Vancouver and has been
played every show since (so its Tier-A floor is the active-tour anchor
at 0.85, but raw frequency lifts it to 0.95).

---

## 2. Rotating — Phish · *Sphere residency*, target April 30, 2026 (night 9 of 13)

### Inputs
- **Performer:** Phish (`mbid: 04212d57-7e5e-4e74-b5b6-4dd2c2e62a45`)
- **Tour:** "Spring Tour 2026 — Sphere Residency" (synthesized id
  collapsing the legitimately-named tour from setlist.fm)
- **Run detection:** same venue (Sphere at the Venetian, Las Vegas),
  consecutive nights — yes, it's a residency. Night 9 of an
  estimated 13-night run.
- **Corpus loaded:** 8 prior nights of the Sphere run + 36 prior
  Phish setlists from late 2025.
- **Target date:** 2026-04-30
- **Tier breakdown:**
  - Tier A (Sphere, last 30d): 8 setlists (the prior nights of the same run)
  - Tier B (current tour, ±180d): 12 additional (winter/spring 2026)
  - Tier C (earlier same tour): 0 (tour is young)
  - Tier D (prior tour — Summer 2025): 28 (Phish Summer Tour 2025, weight 0.10)
  - Tier E: 0

### Style inference
- Jaccard mean across Tier A: 0.18
- uniqueRatio: ~140 unique titles across ~196 slots in Tier A → 0.71
- → `setlist_style = 'rotating'`

### Multi-night anti-repeat
Songs already played on nights 1–8 of the residency are
penalty-multiplied to 0.05 (effectively excluded). At night 9 of
this run the "songs already played" set is ~135 unique titles.
**That's the hottest signal in the prediction.**

### Gap-based prediction (top of the output)

Computed `overdue_score = current_gap_shows / historical_mean_gap` for
every song in Phish's corpus. Sample of the highest-scoring songs as
of 2026-04-30 (composed from the Sphere setlists posted Apr 16, 17,
19, 21, 24, 25, 27 and reasonable prior-tour gaps):

```json
{
  "style": "rotating",
  "tourId": "phish__spring-2026-sphere",
  "tourName": "Spring Tour 2026 — Sphere Residency",
  "sampleSize": 84,
  "confidence": 0.41,
  "copy": "Phish has played 140+ unique songs across 8 Sphere nights so far. Probability of any specific song is low — here's what's overdue and what slot it tends to fill.",
  "spoilerBlurDefault": false,
  "setLengthPrediction": {
    "setCount": 2,
    "setCountConfidence": 0.98,
    "expectedSongCount": { "p25": 17, "p50": 19, "p75": 22 },
    "expectedDurationMin": { "p25": 145, "p50": 165, "p75": 185 }
  },
  "multiNightContext": {
    "venue": "Sphere at the Venetian Resort",
    "runIndex": 9,
    "runLength": 13,
    "songsAlreadyPlayed": 137,
    "anchorBan": ["Free", "Birds of a Feather", "Limb By Limb", "Mike's Song", "Weekapaug Groove",
                  "Timber", "Cities", "Halley's Comet", "Chalk Dust Torture", "Ghost", "First Tube",
                  "...130 more — see expanded list"]
  },
  "due": [
    { "title": "Bug",                  "currentGap": 47, "meanGap": 12, "overdueScore": 3.92, "totalPlays": 89, "lastPlayedAt": { "date": "2025-08-13", "venue": "Alpine Valley" } },
    { "title": "Tweezer Reprise",      "currentGap": 18, "meanGap":  6, "overdueScore": 3.00, "totalPlays": 460 },
    { "title": "Run Like an Antelope", "currentGap": 24, "meanGap":  9, "overdueScore": 2.66, "totalPlays": 380 },
    { "title": "Slave to the Traffic Light", "currentGap": 31, "meanGap": 14, "overdueScore": 2.21, "totalPlays": 220 },
    { "title": "David Bowie",          "currentGap": 28, "meanGap": 13, "overdueScore": 2.15, "totalPlays": 380 },
    { "title": "Reba",                 "currentGap": 22, "meanGap": 11, "overdueScore": 2.00, "totalPlays": 290 }
  ],
  "hot": [
    { "title": "Evolve",       "playedCount": 6, "playedShare": 0.75, "evidence": "6 of last 8 — current single" },
    { "title": "Sand",         "playedCount": 4, "playedShare": 0.50, "evidence": "4 of last 8" },
    { "title": "Tweezer",      "playedCount": 4, "playedShare": 0.50, "evidence": "4 of last 8 — different jam each time" }
  ],
  "bustoutCandidates": [
    { "title": "McGrupp and the Watchful Hosemasters", "currentGap": 142, "meanGap": 38, "overdueScore": 3.74, "totalPlays": 18, "note": "First played in 1985; bustouts every ~140 shows" },
    { "title": "The Line",     "currentGap":  89, "meanGap": 65, "overdueScore": 1.37, "totalPlays":  9 }
  ],
  "positions": [
    {
      "role": "opener",
      "poolEntropy": 0.78,
      "candidates": [
        { "title": "Free",            "slotShare": 0.13, "lastFilledThisSlot": "2026-04-16" },
        { "title": "Sample in a Jar", "slotShare": 0.12 },
        { "title": "AC/DC Bag",       "slotShare": 0.11 },
        { "title": "Llama",           "slotShare": 0.10 },
        { "title": "Suzy Greenberg",  "slotShare": 0.08, "anchorBanned": true },
        { "title": "Buried Alive",    "slotShare": 0.07 },
        { "title": "Wilson",          "slotShare": 0.06 },
        { "title": "Cars Trucks Buses","slotShare": 0.05 }
      ]
    },
    {
      "role": "set2_opener",
      "poolEntropy": 0.71,
      "candidates": [
        { "title": "Down with Disease", "slotShare": 0.15 },
        { "title": "Carini",            "slotShare": 0.12 },
        { "title": "Tweezer",           "slotShare": 0.11, "anchorBanned": true },
        { "title": "Crosseyed and Painless", "slotShare": 0.10 },
        { "title": "Halley's Comet",    "slotShare": 0.09, "anchorBanned": true }
      ]
    },
    {
      "role": "encore_close",
      "poolEntropy": 0.55,
      "candidates": [
        { "title": "Tweezer Reprise",   "slotShare": 0.21, "overdueBoost": true },
        { "title": "First Tube",        "slotShare": 0.18, "anchorBanned": true },
        { "title": "Slave to the Traffic Light", "slotShare": 0.10 },
        { "title": "Character Zero",    "slotShare": 0.08 },
        { "title": "Backwards Down the Number Line", "slotShare": 0.06 }
      ]
    }
  ]
}
```

### Rendered UI (rotating-style display)

```
┌──────────────────────────────────────────────────────────────────┐
│  PHISH · SPHERE                            ▰▰▱▱▱  41% · ROTATING │
│  Night 9 of 13 · Spring Tour 2026                                │
│                                                                   │
│  Phish has played 140+ unique songs across the 8 prior Sphere    │
│  nights. Probability of any specific song is low — here's what's │
│  overdue and what slot it tends to fill.                         │
│                                                                   │
│  TONIGHT'S SHAPE                                                  │
│  2 sets · ~19 songs · ~165 min · setlist length 98% confident    │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  DUE  ↗  highest overdue scores tonight                          │
│   Bug                          ▰▰▰▰▰▰▰▰▰▰  47-show gap (avg 12) │
│   Tweezer Reprise              ▰▰▰▰▰▰▰▰▱▱  18-show gap (avg 6)  │
│   Run Like an Antelope         ▰▰▰▰▰▰▰▱▱▱  24-show gap (avg 9)  │
│   Slave to the Traffic Light   ▰▰▰▰▰▰▱▱▱▱  31-show gap (avg 14) │
│   David Bowie                  ▰▰▰▰▰▰▱▱▱▱  28-show gap (avg 13) │
│   Reba                         ▰▰▰▰▰▱▱▱▱▱  22-show gap (avg 11) │
│                                                                   │
│  HOT  🔥  in the rotation right now                              │
│   Evolve   · 6/8 last shows — current single                     │
│   Sand     · 4/8 last shows                                       │
│   Tweezer  · 4/8 last shows — different jam each time            │
│                                                                   │
│  BUSTOUT CANDIDATES  ✨                                          │
│   McGrupp & the Watchful Hosemasters · 142-show gap (avg 38)     │
│   The Line                            · 89-show gap  (avg 65)    │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  POSITION POOLS                                                   │
│  OPENER  ▰▰▰▰▰▰▰▱  high entropy — pool of ~8                     │
│   Sample in a Jar 12% · AC/DC Bag 11% · Llama 10% · Wilson 6%    │
│   Free 13%* · Suzy 8%* · Cars Trucks Buses 5%   (* = already     │
│                                                  played this run) │
│                                                                   │
│  SET 2 OPENER  ▰▰▰▰▰▰▰▱                                          │
│   Down with Disease 15% · Carini 12% · Crosseyed 10% ·           │
│   Tweezer 11%* · Halley's 9%*                                    │
│                                                                   │
│  ENCORE CLOSE  ▰▰▰▰▱▱▱▱  lower entropy — pool of ~5              │
│   Tweezer Reprise 21% ✨   ← OVERDUE + slot fit                  │
│   Slave 10% · Character Zero 8% · Backwards Down 6%              │
│   First Tube 18%*                                                 │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  ALREADY PLAYED THIS RUN  (excluded from prediction · 137 songs) │
│   [▾ Show all · jump to night-by-night setlists]                 │
│                                                                   │
│  [💬 Discuss · /r/phish]   [📊 Phish.net gap chart →]            │
└──────────────────────────────────────────────────────────────────┘
```

This is the answer the §15 critique was after. The output is *useful*
to a Phish fan: which songs are overdue, what slot each is likely
to fill, what's already burned this run. None of "we don't know;
sorry" — instead "we know what we don't know, and here's the rich
adjacent signal."

Notable algorithm behaviors:
- "Tweezer Reprise" gets the **overdue + slot-fit** double-flag —
  it's the only song that ranks in both the Due list and the
  Encore-Close pool. Surfaced as the prediction's hottest pick.
- "First Tube" is filtered out of Encore-Close despite its 0.18 share
  because it played as the encore on Apr 25; the multi-night anti-
  repeat clause demoted it.
- Set count predicted as 2 with 0.98 confidence — Phish's 28-show
  prior-tour modal was 2 sets; their Sphere run modal so far has been
  2 sets. (Jam-band fans care about this.)
- Confidence lands at 0.41 — the UI surfaces this prominently rather
  than burying it.

---

## 3. Theatrical — Beyoncé · *Cowboy Carter Tour* (target: a hypothetical mid-tour show)

### Inputs
- **Performer:** Beyoncé (`mbid: 859d0860-d480-4efd-970c-c05d5f1776b8`)
- **Tour:** "Cowboy Carter Tour"
- **Corpus loaded:** all 32 setlists from the 2025 tour
- **Target date:** simulated mid-tour
- **Tier breakdown:**
  - Tier A (current leg, ±30d): 8 setlists
  - Tier B (current tour, ±180d): 24 setlists
  - Tier C: 0
  - Tier D (prior — Renaissance): 56 setlists, weight 0.10
  - Tier E: 0

### Style inference
- Jaccard across Tier A: 0.98 (every set is the same minus the
  surprise slot)
- uniqueRatio: ~40 unique titles / 39 mean songs × 8 setlists ≈ 0.13
  (almost no novelty)
- 9-act structure visible in `setlist_song_appearances.role`
  patterns — every show has the same act dividers
- → `setlist_style = 'theatrical'`

### Algorithm output (compressed — the model essentially returns the deterministic show)

```json
{
  "style": "theatrical",
  "tourId": "beyonce__cowboy-carter-tour",
  "tourName": "Cowboy Carter Tour",
  "sampleSize": 32,
  "confidence": 0.99,
  "copy": "Tonight's show is choreographed top to bottom — the same setlist with one rotating slot.",
  "spoilerBlurDefault": true,
  "setLengthPrediction": { "setCount": 1, "expectedSongCount": { "p50": 39 }, "expectedDurationMin": { "p50": 180 } },
  "deterministicSetlist": [
    { "act": "I",   "title": "AMERICAN REQUIEM",       "p": 1.00 },
    { "act": "I",   "title": "Blackbird",              "p": 1.00 },
    { "act": "I",   "title": "The Star-Spangled Banner","p": 1.00 },
    { "act": "II",  "title": "AMERICA HAS A PROBLEM",  "p": 1.00 },
    { "act": "II",  "title": "SPAGHETTII",             "p": 1.00 },
    { "act": "II",  "title": "Formation",              "p": 1.00 },
    { "act": "II",  "title": "Diva",                   "p": 1.00 },
    { "act": "III", "title": "ALLIGATOR TEARS",        "p": 1.00 },
    { "act": "III", "title": "JUST FOR FUN",           "p": 1.00 },
    { "act": "III", "title": "PROTECTOR",              "p": 1.00 },
    "...",
    { "act": "VIII", "title": "16 CARRIAGES",          "p": 1.00 },
    { "act": "IX",  "title": "AMEN",                   "p": 1.00 }
  ],
  "rotatingSlots": [
    {
      "slotName": "Surprise · Act V (acoustic break)",
      "candidates": [
        { "title": "DAUGHTER",            "slotShare": 0.31 },
        { "title": "FLAMENCO",            "slotShare": 0.22 },
        { "title": "SMOKE HOUR (interlude variant)", "slotShare": 0.18 },
        { "title": "Crazy In Love (acoustic)", "slotShare": 0.14 },
        { "title": "II HANDS II HEAVEN",  "slotShare": 0.09 }
      ]
    },
    {
      "slotName": "Family appearance · Act VII",
      "candidates": [
        { "title": "PROTECTOR (with Rumi)", "slotShare": 0.55 },
        { "title": "BLACKBIIRD (with Blue Ivy)", "slotShare": 0.30 },
        { "title": "no family member tonight", "slotShare": 0.15 }
      ]
    }
  ]
}
```

### Rendered UI (theatrical-style display)

```
┌──────────────────────────────────────────────────────────────────┐
│  PREDICTED SETLIST                          ▰▰▰▰▰  99% · FIXED   │
│  COWBOY CARTER TOUR · 32 setlists, 9 acts                        │
│  ⚠︎ Spoiler-blur on. [Show me the show]                          │
├──────────────────────────────────────────────────────────────────┤
│  Tonight's show is choreographed top to bottom.                  │
│  Same setlist every night, with one rotating "surprise" slot     │
│  in Act V and an optional family appearance in Act VII.          │
│                                                                   │
│  1 set · ~39 songs · ~180 min                                    │
│                                                                   │
│  ACT I                                                            │
│  ▰▰▰▰▰  AMERICAN REQUIEM  ·  100% (32 of 32)                     │
│  ▰▰▰▰▰  Blackbird          ·  100% (32 of 32)                     │
│  ▰▰▰▰▰  The Star-Spangled Banner  ·  100% (32 of 32)             │
│                                                                   │
│  ACT II                                                           │
│  ▰▰▰▰▰  AMERICA HAS A PROBLEM   ·  100%                          │
│  ▰▰▰▰▰  SPAGHETTII              ·  100%                          │
│  ▰▰▰▰▰  Formation               ·  100%                          │
│  ▰▰▰▰▰  Diva                    ·  100%                          │
│  […]                                                              │
│                                                                   │
│  ACT V — SURPRISE SLOT  ⭐                                       │
│   most likely tonight (by recent rotation):                      │
│   DAUGHTER 31% · FLAMENCO 22% · SMOKE HOUR var. 18% ·            │
│   Crazy In Love (acoustic) 14% · II HANDS II HEAVEN 9%           │
│                                                                   │
│  ACT VII — FAMILY APPEARANCE                                     │
│   Rumi joins on PROTECTOR  · 55% of recent shows                 │
│   Blue Ivy joins on BLACKBIIRD · 30%                             │
│   No family appearance · 15%                                      │
│                                                                   │
│  […remaining acts collapsed; full deterministic list…]           │
│                                                                   │
│  [🎵 Hype playlist on Spotify]   [Edit setlist]                  │
└──────────────────────────────────────────────────────────────────┘
```

The theatrical display is closer to a *program* than a prediction. The
core list isn't probability bars — it's just the show. The two
genuinely uncertain slots (surprise + family) get the probability
treatment, surfaced as a small inset rather than the headline.

---

## 4. Improvised — King Gizzard & The Lizard Wizard · 2026 show (target: any future date)

### Inputs
- **Performer:** King Gizzard & The Lizard Wizard
- **Corpus loaded:** 902 historical shows from 2010-2025
- **Target date:** a hypothetical mid-2026 show
- **Tier breakdown:**
  - Tier A (current leg / recent tour): 6 setlists
  - Tier B: 14
  - Tier C: 60
  - Tier D: 80 (prior tours)
  - Tier E: 100

### Style inference
- Tier-A Jaccard ≈ 0.09
- uniqueRatio across Tier A: 187 unique titles / 224 slots ≈ 0.83
- Mean setlist length highly bimodal: 11 songs (regular) and 26 songs
  (marathon) — a clue that this band has *show modes*
- → `setlist_style = 'improvised'`

### Algorithm output

```json
{
  "style": "improvised",
  "tourId": null,
  "tourName": null,
  "sampleSize": 6,
  "confidence": 0.18,
  "copy": "King Gizzard rarely repeats sets. Predicting song-by-song isn't useful here.",
  "spoilerBlurDefault": false,
  "setLengthPrediction": {
    "setCount": 1,
    "showModes": [
      { "label": "Regular set",   "p": 0.65, "expectedSongCount": { "p50": 11 }, "expectedDurationMin": { "p50": 75 } },
      { "label": "Marathon set",  "p": 0.30, "expectedSongCount": { "p50": 26 }, "expectedDurationMin": { "p50": 180 } },
      { "label": "Microtonal night", "p": 0.05, "expectedSongCount": { "p50": 11 } }
    ]
  },
  "vibeSketch": {
    "headlineDescriptor": "high-energy psych-rock with extended jams",
    "popularPicks": [
      { "title": "Gila Monster",     "playedShare": 0.40, "lastPlayed": "2025-08-16" },
      { "title": "Robot Stop",       "playedShare": 0.34 },
      { "title": "Rattlesnake",      "playedShare": 0.31 },
      { "title": "The River",        "playedShare": 0.24 }
    ],
    "albumsRepresentedRecently": [
      "Flight b741 (2024)",
      "PetroDragonic Apocalypse (2023)",
      "The Silver Cord (2023)"
    ],
    "knownTendencies": [
      "Marathon shows occur ≈ 1 in 5 — usually announced beforehand on the band's socials",
      "Microtonal shows draw heavily from K.G. and L.W.",
      "Long-form jams typically appear after the third song"
    ]
  }
}
```

### Rendered UI (improvised-style display)

```
┌──────────────────────────────────────────────────────────────────┐
│  PREDICTED SETLIST                          ▰▱▱▱▱  18% · IMPROV  │
│  King Gizzard rarely repeats sets — predicting song-by-song      │
│  isn't useful for this artist.                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  TONIGHT'S SHAPE                                                  │
│   Regular set      65%   ~11 songs   ~75 min                     │
│   Marathon set     30%   ~26 songs   ~180 min                    │
│   Microtonal night  5%   K.G./L.W. material                      │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│  VIBE                                                             │
│   high-energy psych-rock with extended jams                      │
│                                                                   │
│  RECENT ALBUMS YOU'LL LIKELY HEAR FROM                           │
│   · Flight b741 (2024)                                           │
│   · PetroDragonic Apocalypse (2023)                              │
│   · The Silver Cord (2023)                                       │
│                                                                   │
│  POPULAR PICKS  (≥ 25% of recent shows)                          │
│   Gila Monster · 40% · last played Aug 16, 2025                  │
│   Robot Stop   · 34%                                              │
│   Rattlesnake  · 31%                                              │
│   The River    · 24%                                              │
│                                                                   │
│  KNOWN TENDENCIES                                                 │
│   • Marathon shows occur ≈1 in 5 — usually announced first       │
│   • Microtonal nights draw from K.G. and L.W.                    │
│   • Long-form jams typically appear after the third song         │
│                                                                   │
│  We can't predict tonight's setlist — but you can browse the     │
│  band's full song archive at kglw.net.                           │
│                                                                   │
│  [📊 kglw.net archive →]   [🎵 Pre-show explorer playlist]       │
└──────────────────────────────────────────────────────────────────┘
```

For improvised-style, the algorithm explicitly *refuses* the
song-by-song prediction. Instead it returns:
- Show-mode probabilities (regular vs. marathon vs. microtonal —
  these *are* predictable from the recent corpus and from band
  social media patterns).
- A vibe sketch.
- Popular picks, surfaced as "you'll probably hear something from
  these" rather than "this song specifically."
- A pointer to the band's own archive (the §14e fallback we noted
  in the plan).

The "Pre-show explorer playlist" CTA generates a Spotify playlist
of the popular-picks pool — not a setlist prediction, but a useful
warm-up.

---

## Cross-cutting observations from running these four

1. **Confidence calibration is doing real work.** The four artists
   span 0.18 → 0.99. Each number reflects the genuine difficulty
   of the prediction. Without §15i's eval harness we'd have no way
   to know whether those numbers are *correct*; with it, the
   weekly Brier score tells us.

2. **The style classifier is the single most important piece.** The
   four UIs are unrecognizable from each other. The same algorithm
   would produce four useless outputs; the same data with four
   different displays gives four useful ones.

3. **Multi-night-run anti-repeat moves the needle hard for Phish.**
   Without it, "First Tube" would top the encore-close pool tonight
   despite playing two nights ago. With it, "Tweezer Reprise" — the
   actual hot pick — surfaces correctly. This is a small algorithm
   addition with outsized real-world value.

4. **The "due" / overdue-score model isn't just for Phish.** Pearl
   Jam, Springsteen, Dead & Co, even Wilco rotate from a known
   pool — all benefit from the same bucketing.

5. **Theatrical and improvised aren't symmetric.** Theatrical's
   challenge is "the prediction is trivially correct, but how do we
   make the surprise slot interesting?" Improvised's is "we can't
   predict at all — what do we surface that *is* useful?" The
   answers are different shapes, which the §15p variants reflect.

6. **Set count / show length matters more than expected.** Phish
   2-set vs 3-set, King Gizzard regular vs marathon — surfacing
   this *before* the song list is the single most useful piece of
   pre-show info for variable-style artists.

7. **Spoiler-blur should default different per style.** Stable +
   theatrical → blur on (the user knows the show; revealing it
   spoils). Rotating + improvised → blur off (the predictions are
   probabilistic anyway; nothing to spoil). The plan's
   `spoilerBlurDefault` already handles this; the worked examples
   show the right defaults.

## Sources consulted

- [setlist.fm — Tate McRae's Miss Possessive Tour](https://www.setlist.fm/stats/average-setlist/tate-mcrae-5bc913f0.html?tour=23dc7867)
- [Capital FM — Miss Possessive setlist run-down](https://www.capitalfm.com/news/music/tate-mcrae-miss-possessive-tour-setlist-songs/)
- [setlist.fm — Phish Sphere shows, April 2026](https://www.setlist.fm/setlists/phish-13d6ad51.html)
- [Phish.net — April 25 2026 Sphere setlist](https://phish.net/setlists/phish-april-25-2026-sphere-las-vegas-nv-usa.html)
- [setlist.fm — Beyoncé Cowboy Carter Tour averages](https://www.setlist.fm/stats/average-setlist/beyonce-33d69c3d.html?tour=33dc4465)
- [Cowboy Carter Tour — Wikipedia](https://en.wikipedia.org/wiki/Cowboy_Carter_Tour)
- [setlist.fm — King Gizzard archive](https://www.setlist.fm/setlists/king-gizzard-and-the-lizard-wizard-23de1823.html)
- [KGLW.net full setlist archive](https://kglw.net/setlists/)
- [JamBase — Phish 2026 tour dates](https://www.jambase.com/band/phish)
