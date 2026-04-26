# Playwright Validation Findings (Re-Review)

## Issues Found

### FIXED (bugs #1-5)

- ~~#1 Light theme broken~~ — Fixed: ThemeProvider now sets `data-theme` attribute
- ~~#2-3 Stats name truncation~~ — Fixed: Sparkline column 130px → 80px
- ~~#4 Artists header count~~ — Fixed: Shows filtered count instead of total
- ~~#5 Discover Near You empty state~~ — Fixed: `hasRegions` flag drives correct message

---

### Category A — Hard Failures

(none)

### Category B — Functional Failures (Dead Buttons / Missing Click Handlers)

Every item below has `cursor: pointer` in CSS but **no onClick handler** — clicking does nothing.

| # | Page | Element | What should happen |
|---|------|---------|-------------------|
| 1 | /home | "see all N upcoming" link | Navigate to /shows filtered to upcoming |
| 2 | /home | "open in Shows" link | Navigate to /shows |
| 3 | /home | Recent show rows (all 5) — e.g., "Dave Chappelle", "Phoebe Bridgers", etc. | Navigate to show detail or expand in /shows |
| 4 | /home | Chevron arrows on recent rows | Same as row click |
| 5 | /add | "Ticketmaster URL" import card | Open URL input modal (unimplemented feature) |
| 6 | /add | "PDF ticket" import card | Open file upload (unimplemented feature) |
| 7 | /add | "Gmail receipts" import card | Open Gmail scan flow (unimplemented feature) |
| 8 | /add | "Save draft" button | Save form state (onClick is `() => {}`) |
| 9 | /discover | "venue page →" links on each venue group header | Navigate to venue detail page |
| 10 | /discover | Announcement rows (Alvvays, Bon Iver, Trevor Noah, etc.) | Navigate to show detail or expand row |
| 11 | /preferences | "Follow a venue" link | Open venue search modal |
| 12 | /shows | "Edit" button in detail panel | Shows `alert("Edit coming soon")` — placeholder |
| 13 | /map | "Export" button | No export functionality |

### Category C — Rendering Failures

(none remaining after fixes)

### Category D — Data Issues

(none remaining after fixes)

---

## Dead Button Summary by Page

### /home (4 unique dead interactions)
- "see all N upcoming" — `cursor: pointer`, no onClick, no navigation
- "open in Shows" — `cursor: pointer`, no onClick, no navigation
- All 5 recent show rows — `cursor: pointer` on each row div, no onClick
- Chevron arrows on rows — inherited `cursor: pointer`, no handler

### /shows (1)
- "Edit" button — has onClick but it's just `alert("Edit coming soon")`

### /add (4)
- Ticketmaster URL card — `cursor: pointer`, no onClick
- PDF ticket card — `cursor: pointer`, no onClick
- Gmail receipts card — `cursor: pointer`, no onClick
- Save draft button — onClick is `() => {}`

### /discover (2 patterns)
- "venue page →" links — `cursor: pointer`, no onClick
- Announcement rows — `cursor: pointer`, no onClick (Watch/Tix buttons inside DO work)

### /map (1)
- Export button — `cursor: pointer`, no onClick

### /preferences (1)
- "Follow a venue" link — `cursor: pointer`, no onClick

### /artists — CLEAN (0 dead buttons)
### /dev/components — CLEAN (0 dead buttons)
### /signin — CLEAN (0 dead buttons)

---

## Unimplemented Features (need to be built)

| Feature | Dead button location | What needs to be built |
|---------|---------------------|----------------------|
| TM URL import | /add import card | Accept TM URL → extract event ID → call TM API → auto-fill form |
| PDF ticket import | /add import card | File upload → Groq vision → extract venue/date/seat/price → auto-fill |
| Gmail receipt scan | /add import card | Gmail OAuth → scan inbox → parse ticket emails → import shows |
| Save draft | /add button | Persist form state to DB → restore later |
| Edit show | /shows Edit button | Navigate to /add with pre-filled data → update mutation |
| Map export | /map Export button | Client-side CSV/JSON export of filtered shows |
| Home "see all upcoming" | /home link | Navigate to /shows with upcoming filter |
| Home "open in Shows" | /home link | Navigate to /shows |
| Home row click | /home rows | Navigate to /shows with show highlighted/expanded |
| Venue page navigation | /discover links | Navigate to venue detail (or preferences venue section) |
| Discover row click | /discover rows | Navigate to show detail or expand with more info |
| Follow a venue (prefs) | /preferences link | Open venue search modal (same as discover's modal) |
