# The Music Layer — what Spotify integration means for Showbook

A plain-language expansion of §13 of `feature-plan.md`. The
technical version is for engineers. This one is for thinking through *what
the user actually experiences* before we build it.

If §13 is "here are the API endpoints," this doc is "here's what it feels like
when you open the app the morning after a Phoebe Bridgers show."

---

## The one-line version

Tying your Spotify account to Showbook turns the app from *a list of shows
you went to* into *a soundtrack for your concert life.*

That's the whole pitch. Everything below is what it looks like in practice.

---

## What "the music layer" actually adds

There are ten distinct capabilities that come out of connecting Spotify.
Some are buttons you tap. Some are facts that quietly appear on a show.
Some are background jobs that fire once a year. Ranked by how much you'd
notice them on day one.

### 1. The hype playlist *(pre-show)*

**What you'd do:**

You just bought tickets to Phoebe Bridgers at MSG, three weeks out. You
open the show in Showbook. There's a button at the bottom: **🎵 Hype
playlist on Spotify.** You tap it. Three seconds later, a confirmation:
*"Created — opened in Spotify."*

You switch to Spotify. There's a new playlist on your account:

> **Hype: Phoebe Bridgers — Mar 22 @ Madison Square Garden**
> 16 songs · 58 min · made by Showbook

Cover art is a dark editorial card with the show date and venue. The
tracks are roughly the songs we predicted she'll play, in roughly the
order she'll play them. You can listen to it on the train, in the gym,
in the car ride to the venue.

**Why it matters:**

You're going to listen to her in the run-up anyway — most fans do.
Without this, you're putting on her studio albums or some "best of"
playlist, both of which are out of date with her current setlist.
With this, you're rehearsing the actual show.

The accuracy of the playlist is exactly the accuracy of our prediction
algorithm. For a stable-style artist (most pop tours) it's near-perfect.
For Phish it would be useless — and we know that, so we just don't
offer the button for rotating-style artists.

**What's on screen:**

- A button on the show detail page in the action bar.
- A toast on success.
- The playlist URL is saved on the show, so re-tapping the button just
  reopens it instead of making a duplicate.
- If 3 songs in the predicted setlist aren't on Spotify (live-only
  tracks, deep cuts), the toast says *"Created — 13 of 16 songs found"*
  and we don't pretend otherwise.

**What we ask for:**

A one-tap "connect Spotify" if you haven't already. After that, the
button just works.

---

### 2. The "what I heard" playlist *(post-show)*

**What you'd do:**

You get home from the show, ears ringing. The show transitions from
"ticketed" to "past" overnight. The next day, when you open the show
to upload photos, there's a new button you didn't notice before:
**🎵 Save tonight to Spotify.**

You tap it. A new playlist appears on your account:

> **Live: Phoebe Bridgers — Mar 22 @ Madison Square Garden**
> 18 songs · 1h 47m · made by Showbook

These are the actual songs she actually played, in the actual order,
including the encore. The cover art shows the date.

**Why it matters:**

Three years from now you'll be on a flight, scrolling Spotify, and
you'll see "Live: Phoebe Bridgers — Mar 22 @ MSG." Hit play. You're
back in the room.

This is the artifact half the feature exists for. Photos capture
the visual. This captures the audio.

**What's on screen:**

Same button as #1 but only on past shows that have a populated setlist
(either we pulled it from setlist.fm or you typed it in). If the
setlist is empty, the button is replaced by a disabled hint:
*"Save to Spotify when the setlist is in."*

---

### 3. Show vibe at a glance

**What you'd do:**

On any past show's detail page, you scroll past the photos and find a
small card:

```
┌─ THE VIBE ─────────────────────────────────┐
│                                              │
│            ENERGY                            │
│              ●                               │
│       ●         ●                            │
│   ACOUSTIC  HAPPINESS                        │
│       ●         ●                            │
│              ●                               │
│         DANCEABILITY                         │
│                                              │
│  high-energy · sad · acoustic                │
└──────────────────────────────────────────────┘
```

That's a radar chart of the show's *audio profile*, averaged across
all 18 songs. A one-line summary at the bottom labels what the shape
means.

**Why it matters:**

You couldn't tell someone *"the show was high-energy and sad"* without
sounding like a Pitchfork review, but you'd recognize it the moment
you saw the chart. It's the difference between knowing a thing and
seeing the data that proves it.

You can compare two shows by the same artist a year apart — did they
get more upbeat? Did your favorite arena tour swing more acoustic on
the European leg? The radar tells you.

**Where the data comes from:**

Spotify scores every track in their catalog on a hidden 7-axis profile
(loudness, beat strength, "happiness," etc. — they actually publish
these as numeric scores per song). We average them across the setlist.
You don't see the math; you see the shape.

**The catch:**

This is the one feature that's affected by Spotify's late-2024 API
deprecation — see "the catch" section near the bottom of this doc.
We may need a backup data source for newer tracks.

---

### 4. The energy arc

**What you'd do:**

Right below the vibe radar, a long horizontal sparkline:

```
ENERGY ARC

   ▁▂▃▅▆▆▅▄▆▇▆▇█▆▃▁▂▆█
   1 2 3 4 5 6 7 8 9 ▲ ▲ ▲ ▲ ▲ ▲ E E E
                     10 11 12 13 14 15
                                       ↑
                                       encore
```

One dot per song in order. Height = the song's energy score. You can
see the show open mellow, build for an hour, peak at song 14, drop
for the encore opener (acoustic ballad), then climb again on the
closer.

**Why it matters:**

This is what artists actually *design.* When you cried at song 14
and weren't sure why, this chart shows you the song was the energy
peak of a 90-minute build. The math is on screen.

For a Phish show this chart would be incomprehensible (no consistent
arc), so we just don't render it for rotating-style artists.

**What's on screen:**

A 200pt-wide horizontal sparkline. Long-press a dot to see the song
name + score. Tap the chart to flip it to "happiness" or
"danceability" instead of energy. Three taps and you've explored
the whole audio profile.

---

### 5. Set length to the second

**What you'd do:**

A single line of text on the show detail:

> *1h 47m 22s on stage.*

Not "about two hours." Not "12 songs." The actual time, summed from
each track's duration on Spotify.

**Why it matters:**

It's a small thing, but it makes the data feel *real.* Showbook is
the kind of app where the small things stack into a feeling that
the system actually knows what happened.

**Where it goes:**

Inline in the show metadata strip, between the venue and the seat:
*"Madison Square Garden · ORCH L 14 · 1h 47m 22s on stage."*

---

### 6. Songs you discovered live

**What you'd do:**

After a show, a rail appears on the show detail:

```
┌─ SONGS YOU HEARD FOR THE FIRST TIME ─────────┐
│                                                │
│  Funeral                                       │
│  Phoebe Bridgers · 2017                        │
│  [💛 save]   [▶ preview]                       │
│  ───────────────────────────────              │
│  Steamroller                                   │
│  Phoebe Bridgers · 2018                        │
│  [💛 save]   [▶ preview]                       │
│  ───────────────────────────────              │
│  Pope Innocent V                               │
│  Phoebe Bridgers · 2024                        │
│  [💛 save]   [▶ preview]                       │
└────────────────────────────────────────────────┘
```

Three songs that were in last night's setlist but *aren't* in your
Spotify library. Each has a "save" button that adds it to your
library, and a "preview" button that plays the 30-second clip.

**Why it matters:**

Concerts are how you discover bands' deep cuts. The whole point of
seeing someone live is that they play three songs you've never
heard. Without this rail, those songs disappear into the night.
With it, you get a curated list of "you heard these last night —
keep them."

**The fan-loyalty ring (companion feature):**

Above the rail, a small ring shows your overall match:

```
   ╭───────╮
   │  67%  │   12 OF 18 SONGS
   ╰───────╯   IN YOUR LIBRARY
```

That's your "fan loyalty" for this show — you had 12 of the 18
songs saved before walking in. Over time, on the artist's profile
page, you can watch this percentage climb as you become more of a
fan.

For Phoebe Bridgers fans this will be a fun stat. For an artist
you saw on a whim, it might be 11% — also fun, in a different way.

---

### 7. The pre-show priming stat

**What you'd do:**

A tiny one-liner on a past show's detail:

> *You played 4 Phoebe Bridgers tracks in the 4 hours before the show.*

Or, if you really primed:

> *You played 'Funeral' 12 times the week leading up.*

Or if you didn't:

> *No prep — you walked in cold.*

**Why it matters:**

Memory is selective. The show you remember is the show. But the
*anticipation* — the playlist on the train, the "Funeral" loop on
the morning of — that fades. This stat captures it. It's the
quietest of the ten capabilities and possibly the most touching.

**Where it goes:**

A single line on the show detail, near the show date. No card, no
chart. Italics, mutedFg. You almost don't see it. That's the point.

**How it's collected:**

A nightly job pulls your last-50 plays from Spotify. We bucket the
ones that fall within ±6 hours of any of your shows. After the show
flips to "past," the count is frozen onto the show row. After 6
hours have passed, we don't update it again.

**The privacy posture:**

This requires "permission to read your recently-played" — a Spotify
scope you'd toggle on in Preferences. It's *off by default.* If
this stat appearing on your show makes you uncomfortable, the
toggle stays off and the stat never appears.

---

### 8. The year-end concert soundtrack

**What you'd do:**

On Dec 31, you get an email:

> **Your 2025 in concerts**
> 23 shows · 12 venues · 6,300 miles travelled
>
> Your year, as a single playlist:
> [▶ Open in Spotify]

You tap it. There's a Spotify playlist on your account:

> **Showbook · 2025**
> 23 songs · 1h 38m · made by Showbook

One signature song from each show, ordered DJ-set style — warming
up, peaking, winding down. The cover art is a Showbook editorial
card with "2025" and your show count.

**Why it matters:**

Spotify Wrapped is a 90-second slideshow you watch once and forget.
This is a 100-minute playlist you'll have for the rest of your
life. Every January, when it auto-rolls onto your "made for you"
shelf, it's the year coming back.

Three years from now this becomes the artifact. You scroll your
playlists and see Showbook · 2024, Showbook · 2025, Showbook · 2026,
Showbook · 2027. A decade of concerts, four taps away.

**How "signature song" is picked:**

For each show, the song with the highest combined score of *(played
× popularity × your-listening-frequency)*. So songs that played at
your show, that the artist's catalog rates highly, that you actually
streamed afterwards — those win. It's biased toward the song you'd
remember.

**Why it ships in v2:**

This is the most "wow" feature, but it requires the persistent token
storage that's the §13 prerequisite. Most other features can ship
without that.

---

### 9. The Spotify-follow rail

**What you'd do:**

You open the Discover page. Above "Followed venues" and "Followed
artists" there's a new rail:

```
┌─ YOU FOLLOW THESE ON SPOTIFY ────────────────┐
│                                                │
│  ◯ Big Thief         [follow]                  │
│  ◯ Wet Leg          [follow]                   │
│  ◯ Mitski           [follow]                   │
│  ◯ Lucy Dacus       [follow]                   │
│  ◯ boygenius        [follow]                   │
│  ◯ + 12 more …                                 │
│                                                │
│  Tap follow to track them on Showbook too.    │
└────────────────────────────────────────────────┘
```

Each row is an artist you follow on Spotify but *don't* follow on
Showbook. Tap "follow" → they're added to your Showbook follows,
which means we'll surface their tour announcements in your daily
digest, send you "tonight" alerts when they play near you, etc.

**Why it matters:**

Most users have a 10-year Spotify follow graph. Showbook follows
start from zero. This rail closes the gap in one tap each.

For first-time onboarding, we'd offer a "follow them all" button at
the top of the rail.

**What's on screen:**

A horizontally scrollable rail on Discover. Each card shows the
artist's image, name, and a "follow" pill. After you follow, the
card flips to a "✓ followed" state and falls off the rail on next
load (since they're no longer in the diff).

---

### 10. 30-second previews inline

**What you'd do:**

On a show's setlist tab, every song row gets a small play button:

```
1   Funeral                           [▶]
    PHOEBE BRIDGERS · 2017
2   Garden Song                       [▶]
3   Kyoto                             [▶]
4   I Know the End                    [▶]
```

Tap the button. The 30-second Spotify preview plays inline. A small
waveform animates across the row.

**Why it matters:**

Sometimes you remember the song was great but can't remember how it
goes. You're in the show detail anyway. You don't want to leave the
app and search Spotify for it. One tap, 30 seconds, you're back in
the moment.

**The Premium upsell:**

If you're a Spotify Premium subscriber, the row's play button can
trigger *full track playback* via Spotify's Web Playback SDK
(browser-only, not mobile). Premium users get the full song with
no leaving the app. Non-Premium users get the 30-second preview.
Both work; one is just deeper.

This is a small feature but it makes the show detail *playful* in
a way it currently isn't.

---

## The catch — resolved 2026-05-17: vibe radar + energy arc dropped from v1

In late 2024, Spotify closed `/audio-features` and `/audio-analysis`
to new applications. We probed our app registration on 2026-05-17
(via `pnpm --filter @showbook/api probe-audio-features`) and got
**HTTP 403** — we are not grandfathered. So:

**Cut from v1:**
- #3 Vibe radar
- #4 Energy arc
- The related-artists cross-tour discovery rail (which §15 had
  already deferred).

We considered the community-run AcousticBrainz project as a
fallback. It's frozen at 2022, so it'd be useless on every show
anyone's going to in 2026+ — we'd be shipping broken features
labelled "not enough data" 95% of the time. Not worth it.

**What remains:** the seven other capabilities (priming stat,
fan-loyalty ring, hype playlist export, post-show playlist export,
discovered-live rail, 30-second previews, year-end soundtrack)
all still ship.

We'll re-probe in v2 if Spotify changes their policy or a viable
third-party data source emerges.

The other seven capabilities are unaffected — they use endpoints
that aren't on the closed list.

---

## What's on screen, all in one place

| # | Capability | Surface |
|---|-----------|---------|
| 1 | Hype playlist | Button on show detail (watching/ticketed shows, concert kind) |
| 2 | What-I-heard playlist | Button on show detail (past shows with a setlist) |
| 3 | Vibe radar | Card on show detail |
| 4 | Energy arc | Sparkline below the radar |
| 5 | Set length | Inline in the show metadata strip |
| 6 | Discovered-live rail | Show detail rail (post-show) |
| 6b | Fan loyalty ring | Show detail (post-show) + artist profile aggregate |
| 7 | Pre-show priming stat | One-line italics on show detail |
| 8 | Year-end soundtrack | Email + Home banner late December |
| 9 | Spotify-follow rail | Discover page top rail |
| 10 | 30-second previews | Play button on every setlist row |

Plus three quieter things that don't have a single screen:

- **Branded playlist covers** on the playlists from #1, #2, and #8.
  Every Showbook-made playlist has a custom dark editorial cover
  card so it stands out in your Spotify library. You see them in
  the playlist grid; you don't actively look at them.
- **Better predicted setlists** that blend our prediction with
  each artist's Spotify top-tracks. Quietly improves the accuracy
  of the predicted setlist tab without adding any UI.
- **Cleaner song identity.** Every song the system tracks gets a
  Spotify ID and an ISRC code (the international song registry).
  This means "Heroes (Live 2003)" and "Heroes - 2002 Remaster"
  collapse into one canonical Heroes — which keeps your songs-
  heard-most stats from being double-counted by reissues.

---

## The opt-in posture

Every Spotify capability above is a deliberate opt-in. We don't ask
for everything in one big OAuth dialog. Instead, each toggle in
Preferences asks for the specific permission its feature needs:

```
┌─ SPOTIFY ────────────────────────────────────┐
│                                                │
│  ✓ Connected as @ethan.asm                    │
│                                                │
│  ✓ Import follows                              │
│    Pull artists you follow on Spotify.         │
│                                                │
│  ✓ Make playlists                              │
│    Create hype + what-I-heard playlists.       │
│                                                │
│  ☐ Library cross-reference                     │
│    See which songs you had saved before each  │
│    show. Powers the fan-loyalty ring + the     │
│    "discovered live" rail.                     │
│                                                │
│  ☐ Recently played                             │
│    Track which songs you played in the days    │
│    before each show. Powers the priming stat.  │
│                                                │
│  ☐ Save discovered songs                       │
│    Lets the "discovered live" rail's save      │
│    button add tracks to your Spotify library.  │
│                                                │
│       [ Disconnect Spotify ]                   │
└────────────────────────────────────────────────┘
```

Default: only "import follows" and "make playlists" turn on at first
connect. The other three are off until you flip them. Each toggle is
labeled with what it does and why we want it.

If you flip any toggle off later, the dependent feature degrades:
the fan-loyalty ring disappears, the priming stat hides, the save
button is replaced by a "open in Spotify" link. Nothing breaks; the
features just stop showing.

If you fully disconnect Spotify, every Spotify-derived stat is wiped
within 24 hours. We don't keep cached data after disconnect.

---

## What ships first vs. later

There are ten capabilities. They don't all need to ship at once. The
right order, by impact-to-effort:

**v1 (ships with the predicted-setlist feature itself):**

- ✅ #1 Hype playlist
- ✅ #2 What-I-heard playlist
- ✅ #5 Set length to the second
- ✅ #10 30-second previews

These four piggyback on the existing one-shot Spotify OAuth — no new
infrastructure required. They're the everyday features.

**v1.1 (a couple of weeks later):**

- ✅ #9 Spotify-follow rail (extends the existing artist-import flow)
- ✅ Branded playlist covers (cosmetic upgrade to v1's #1 and #2)

**v2 (after persistent-token storage lands):**

- ✅ #6 Discovered-live rail + fan loyalty ring
- ✅ #7 Pre-show priming stat
- ✅ #8 Year-end concert soundtrack

These three need a persistent connection to your Spotify so background
jobs can act on their own. That's the new infrastructure §13k
introduces.

**v2.1 (gated on Spotify API status):**

- ✅ #3 Vibe radar
- ✅ #4 Energy arc

These two are the audio-features features. Status TBD until we
probe the Spotify API.

---

## The one technical decision worth understanding in plain terms

Most of the features above happen *when you tap a button.* You tap
"hype playlist," we briefly borrow access to your Spotify, make the
playlist, and let go.

But three features need to act *on their own:*

- The "year-end soundtrack" email goes out on Dec 31 at 6 PM. You're
  not there.
- The priming stat needs to be checked the morning after each show,
  not when you click anything.

(An earlier draft also listed the fan-loyalty ring here. We
revised that — fan-loyalty is now a per-show "ask Spotify which of
these tracks you saved" call that runs only when you open the
show. No bulk copy of your library lives on our server.)

For these, we need to *keep* a key to your Spotify so the background
jobs can act when you're not around.

That key is what's called a "persistent token." The technical version
of this conversation has a lot of words about encryption, refresh
tokens, scope ladders, and so on. The plain-language version is:

- We ask permission once.
- We store the key, encrypted, on our server.
- It only unlocks the specific permissions you toggled on.
- You can revoke it any time by tapping "Disconnect Spotify" — both
  in Showbook and in your own Spotify account settings (Spotify
  exposes a list of every app that has a token; we appear there).
- We never use it for anything outside the toggled-on capabilities.

That's the one piece of new infrastructure §13 introduces. Every
other capability is just *plumbing* — connecting our existing data
to Spotify's existing endpoints.

---

## What this looks like for someone who hasn't connected Spotify

Important: the *whole core feature* — the predicted setlist, the
post-show analysis, the songs-heard-most stats — works without
Spotify. None of it is gated behind connecting.

If you never connect Spotify:
- The predicted setlist still appears, just without the "hype
  playlist" button.
- The setlist still shows on past shows, just without the "save to
  Spotify" button.
- Songs heard most still appear on artist pages, just without play
  buttons.
- No vibe radar, no energy arc, no fan-loyalty ring, no priming
  stat. The show detail is slightly leaner.
- The Spotify-follow rail just doesn't appear.

Connecting Spotify is *additive.* Showbook is a complete, working
app without it. With it, the music gets a layer.

---

## What's not in scope (deliberately)

A few things this layer *deliberately* doesn't include, even though
they'd be easy to add:

- **Apple Music / Tidal / YouTube Music parity.** The architecture
  supports adding them later (the song identity is keyed by ISRC,
  which all platforms share). But shipping all three at once would
  triple the OAuth complexity and the maintenance load. Spotify
  first. Apple Music in a later milestone if user demand exists.

- **Following other Showbook users via Spotify.** Tempting — "see
  what your friends are listening to" — but Showbook is deliberately
  single-user. The friend graph is a different feature for a
  different time.

- **Recommendations from us about what to listen to.** Spotify is
  great at recommendations; we should stay in our lane (live
  shows). The closest we come is "discovered live" (#6), which is
  100% reactive — we only surface songs the artist *actually played*
  at *your* show.

- **Audio playback of actual concert recordings.** Some artists
  (Phish, Dead & Co) release official live recordings of every show.
  Playing those in Showbook would be the holy grail — but the rights
  situation is messy, the catalog is artist-by-artist, and Spotify
  is the wrong source for it. Future feature, separate plan.

- **Sharing playlists publicly.** All Showbook-made playlists are
  *private* by default. You can change a playlist's visibility in
  Spotify itself if you want to share it; Showbook doesn't make
  that decision for you.

---

## How this connects to the rest of Showbook

The music layer is the *most ambitious* extension we've planned, but
every piece composes with features that already exist:

- **The setlist.fm setlist data** powers what shows up in playlists.
- **The performer + venue + show schema** is the join key for
  everything per-show.
- **The Spotify follow import flow** (already shipped) is the
  template for every new OAuth scope we'd request.
- **The daily digest email** (already shipped) is where the year-end
  soundtrack lands.
- **The Discover page** (already shipped) is where the Spotify-follow
  rail sits.
- **The brain** (planned) gets new tools — "what was the energy
  profile of my Phoebe Bridgers shows?" — that turn this layer into
  conversational answers.

We're not building a parallel system. We're tying an existing system
(Spotify) to an existing system (Showbook) and surfacing the joins
in the places they already live.

---

## A few quiet things this enables that aren't on the feature list

Once the music layer exists, several "third-order" capabilities
become possible without much extra effort:

- **The brain knowing things.** "What was my smallest, saddest, most
  acoustic show?" — answerable from the vibe data. "Which show
  primed me hardest beforehand?" — answerable from the priming
  stat.

- **The setlist intelligence eval gets better.** With Spotify track
  IDs locked in, we can detect when an artist is performing a song
  off a *new* album that just dropped and forward-weight it (the
  §15m album-drop signal).

- **Recommendation seeds for Discover.** "Tonight, near you" rails
  can be filtered by your audio-feature taste profile — show me
  high-energy concert recommendations only, hide acoustic singer-
  songwriter shows.

- **Concert taste profile.** A long-running "this is the music you
  like to see live" stat that's distinct from your Spotify listening
  taste. Some people listen to mellow indie at home but only see
  loud rock shows. The data would surface that.

None of these are on the feature list, but they all become natural
follow-ups once the music layer is in place.

---

## A summary in one paragraph

Connecting Spotify to Showbook lets the app act on three things it
currently can't: the songs an artist actually played, the songs you
already love by them, and the songs you played in the run-up to seeing
them. From those three streams come ten user-facing features —
playlists, charts, stats, and one annual artifact — that turn show
attendance into a richer trace of your music life. The technical
prerequisites are modest (one new piece of infrastructure to keep a
revocable connection to your Spotify alive between visits), the privacy
posture is opt-in per capability, and roughly half the features ship
without that infrastructure at all. The features are also independently
useful: each one stands alone, so Showbook stays a complete app for
users who never connect Spotify, while becoming much richer for those
who do.