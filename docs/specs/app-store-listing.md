# App Store listing copy

Store listing copy for the first Showbook submission (App Store Connect +
Google Play Console). Companion to
[`mobile-deployment.md`](mobile-deployment.md) — that doc covers the build /
submit mechanics and the first-submission checklist; this one is the copy you
paste into the store consoles. Field character limits are noted inline; the
"Verify limits" section at the bottom has a one-liner to re-check counts after
edits.

Scope notes (keep the copy honest):

- **No push-notification claims.** The client-side toggle exists but
  server-side delivery isn't wired yet (tracked in the knowledge vault
  backlog, `brain/projects/showbook/plans/planned-improvements.md`).
  Announcements are surfaced in the Discover feed and the daily email digest
  only — the copy says exactly that.
- **No social claims.** Showbook is deliberately personal — no friend graph,
  no sharing feed (decision history in `decisions.md`).
- Spotify features require the user's own Spotify account; the copy says
  "connect Spotify" rather than implying it's built-in.

---

## Apple App Store

### Name — limit 30 chars

```
Showbook
```

### Subtitle — limit 30 chars

```
Your live show logbook
```

Alternates (all ≤30):

- `Concerts, theatre & setlists`
- `Log shows. Predict setlists.`

### Promotional text — limit 170 chars

(Editable without a new binary — use it for seasonal angles later.)

```
Log every concert, play, and comedy night. See predicted setlists before the show, turn what you heard into Spotify playlists, and catch every announcement.
```

### Description — limit 4,000 chars

```
Every show you've ever seen, in one place — and every show you're about to see, never missed.

Showbook is a personal logbook for live entertainment: concerts, theatre, comedy, and festivals. Log the nights you'll never forget, relive them through setlists and photos, and discover what's coming next from the artists and venues you love.

ADD SHOWS WITHOUT THE BUSYWORK
• Just type it — "Phoebe Bridgers at the Greek on 8/15" becomes a complete entry, enriched with the venue, lineup, and tour
• Snap a festival poster and Showbook reads the lineup for you
• Import tickets from Apple Wallet passes, PDF playbills, and email confirmations
• Pull your past shows from setlist.fm, or your followed artists from Spotify, in one pass

RELIVE EVERY NIGHT
• Setlists: import what was actually played, or compose your own — song order, encores and all
• Photos and videos attached to each show, with performers tagged in them
• Seats, ticket prices, who you went with, and the notes you'll want in ten years
• Theatre casts with roles, comedy bills, full festival lineups

KNOW THE SETLIST BEFORE DOORS
• Predicted setlists for upcoming concerts, built from each artist's recent tour history — with a confidence score, and spoiler-blurred until you choose to peek
• One tap builds a Hype playlist on Spotify so you know every word going in
• Afterwards, save the songs you actually heard to a Heard playlist
• Spot rare catches, tour debuts, and how many times you've heard a song live

NEVER MISS AN ANNOUNCEMENT
• Follow artists, venues, and your home region
• A Discover feed of newly announced shows that match, with direct ticket links
• An optional daily email digest of what's coming up and what just went on sale

YOUR HISTORY, MAPPED AND MEASURED
• A map of every venue you've set foot in, clustered as you zoom
• Timeline and calendar views of your entire show history
• Stats: shows per year, top artists, top venues, spend, and your by-genre mix
• Artist and venue pages that tell the story of your history with them

BUILT FOR REAL LIFE
• Works offline — your whole logbook is on your device, and anything you add syncs when you're back online
• Add to your calendar with one tap
• Light and dark themes, phone and tablet layouts
• Sign in with Google; export your data anytime

Showbook is personal. No followers, no feeds, no algorithm — just every show you've seen and every show you're chasing.
```

### Keywords — limit 100 chars

(Comma-separated, no spaces after commas; don't include "showbook" — the app
name is already indexed — and no third-party brand names.)

```
concert,setlist,gig,live music,theatre,comedy,festival,tracker,playlist,venue,diary,logbook
```

### Support / marketing URLs

- Support URL: the prod web origin's `/account-deletion` page links and
  `LEGAL_CONTACT_EMAIL` cover support; point this at the prod web origin.
- Privacy Policy URL: prod `/privacy` (required; must be live before review —
  see the checklist in `mobile-deployment.md`).

---

## Google Play

### App name — limit 30 chars

```
Showbook
```

### Short description — limit 80 chars

```
Track concerts, theatre & comedy. Predict setlists. Never miss a show.
```

### Full description — limit 4,000 chars

Reuse the App Store description verbatim, with one substitution: in the
"ADD SHOWS WITHOUT THE BUSYWORK" section, drop "Apple Wallet passes, " from
the import bullet (the `.pkpass` share-sheet flow is iOS-only), leaving:

```
• Import tickets from PDF playbills and email confirmations
```

---

## Verify limits

After editing any field, re-check the counts (Apple counts characters, not
bytes; these fields are ASCII apart from the bullets/em-dashes, which still
count as one character each):

```bash
node -e 's=require("fs").readFileSync(0,"utf8").trim();console.log([...s].length)' <<'EOF'
<paste field text here>
EOF
```

Limits: name/subtitle 30 · promotional text 170 · description 4,000 ·
keywords 100 · Play short description 80.
