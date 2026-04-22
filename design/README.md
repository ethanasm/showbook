# Showbook

A personal entertainment tracker for live shows — concerts, Theatre, comedy, and festivals. Showbook is a record of every show you've been to, every show you're going to, and every show you're watching for.

## What it does

**Track your live show history.** Log every show with venue, seat, price, setlist, and support acts. Auto-enrichment pulls data from setlist.fm, Ticketmaster, and Playbill so you don't have to type everything.

**Discover upcoming shows.** Follow your favorite venues and get a feed of newly announced shows. Filter by venue, browse up to a year out, and watchlist anything you're interested in. A separate "Near you" feed surfaces shows at venues you don't follow, based on your region settings.

**Plan ahead.** Watchlisted shows live alongside your past and ticketed shows in one unified timeline. When tickets go on sale, you're ready.

**See your patterns.** Stats mode shows your rhythm (shows per month), spend by year, kind breakdown, top venues, and most-seen artists.

## Pages

| Page | What it does |
|------|-------------|
| **Home** | Next up (hero card with venue/seat/doors) + recent 5 shows |
| **Discover** | Announcements from followed venues + near-you feed. Filter by venue. Watchlist to track. |
| **Shows** | Unified list of all shows (past, ticketed, watching). Calendar and Stats modes. Click any row to expand details. |
| **Map** | Full-bleed map of every venue you've been to. Click a pin to inspect — show count, kinds, visit history. Follow button. |
| **Add** | Two ways to log a show: structured form or conversational chat. Auto-enrichment from data sources. |
| **Preferences** | Notification settings (digest frequency, email/push, show-day reminders), region configuration (cities + radius), appearance (dark/light/auto), followed venues, data source connections. |

## Design system

### Typography
- **Geist** (sans) — headliners, body, section titles
- **Geist Mono** — labels, metadata, timestamps, navigation chrome

### The "Marquee" Palette

**Kind colors** — each show type has a distinctive color used on left-border stripes, kind icons, and uppercase labels. Cards stay on neutral backgrounds; kind color is always an accent, never a fill.

| Kind | Color name | Light | Dark |
|------|-----------|-------|------|
| Concert | Stage Blue | `#2E6FD9` | `#3A86FF` |
| Theatre | Curtain Crimson | `#D42F3A` | `#E63946` |
| Comedy | Quirky Amethyst | `#8340C4` | `#9D4EDD` |
| Festival | Outdoor Teal | `#238577` | `#2A9D8F` |

**Kind icons** — Concert (microphone), Theatre (proscenium arch), Comedy (spotlight), Festival (tent with flag).

**Accent: Marquee Gold** — the product's signature color, used on CTAs, active navigation, tix/watch badges, and interactive links. Never on kind labels.

| Context | Hex | Notes |
|---------|-----|-------|
| Light mode | `#E5A800` | Warm gold for light surfaces |
| Dark mode | `#FFD166` | Sunray gold — luminous on dark |
| Text on gold | `#0C0C0C` | Always dark text on gold fills |

**Neutral surfaces** — near-black for dark mode (`#0C0C0C`), warm off-white for light (`#FAFAF8`). Both share the same token structure indexed by mode.

### Dark / Light / Auto

Both themes are fully defined in the token system. The plan is a three-way toggle (System / Light / Dark) in Preferences, persisted to localStorage. Currently web defaults to dark, mobile to light. The `theme-demo.jsx` file demonstrates how any page can render in either mode.

## Interactions

- **Shows List** — rows highlight on hover; click to expand an inline detail panel (headliner, venue, date, actions). Click again to collapse.
- **Discover** — rows highlight on hover; watch/unwatch toggles inline with gold accent.
- **Map** — click pins to open venue inspector with visit history and Follow button.
- **Segmented controls** — Shows (List/Calendar/Stats) and Discover (Followed/Near you) switch on click.
- **Venue filter** — Discover web has a left rail of followed venues; mobile has a horizontal chip row. Select a venue to filter, or "All" to see grouped by venue.

## File structure

```
hifi-v2.html .............. Main prototype — all pages on a pannable design canvas
Theme Demo.html ........... Light vs dark comparison (Home, 4 artboards)
README.md ................. This file

hifi/
  sb-tokens.jsx ........... Design tokens, icon set, kind colors, accent
  shared-data.jsx ......... Mock data (shows, announcements, followed venues)
  v2-shell.jsx ............ Sidebar component
  v2-home.jsx ............. Home (mobile light + web dark)
  v2-shows.jsx ............ Shows — list/calendar/stats
  discover.jsx ............ Discover — venue-filtered announcement feed
  prefs.jsx ............... Preferences (web dark + mobile light)
  map-shared.jsx .......... Map shared utilities
  map-data.jsx ............ Map pin data
  map-web.jsx ............. Map (web dark)
  map-mobile.jsx .......... Map (mobile light)
  add-mobile.jsx .......... Add show — mobile form
  add-web.jsx ............. Add show — web form
  add-chat.jsx ............ Add show — chat mode
  theme-demo.jsx .......... Theme demo components
  design-canvas.jsx ....... Design canvas component
```
