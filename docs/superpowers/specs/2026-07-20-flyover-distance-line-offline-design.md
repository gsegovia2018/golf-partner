# Hole Flyover: Two-Leg Distance Line + Offline Maps — Design

**Date:** 2026-07-20
**Status:** Approved (validated via interactive browser mockups)

## Overview

Upgrade the full-screen hole flyover (opened from the GPS strip on the
scorecard) with a two-leg measuring line — anchor → aim point → green, each leg
labeled with its distance on the map — and make the whole map work offline:
bundled libraries, cached satellite tiles with per-course pre-download, and a
vector-only fallback.

Two phases, one spec: Phase 1 (line + HUD) is independently shippable;
Phase 2 (offline) builds on the same files.

## Current state

- `src/components/scorecard/HoleFlyover.js` — modal hosting the map page.
- `src/lib/holeMapHtml.js` — self-contained Leaflet page (iframe on web,
  WebView on Android), talking to the host via postMessage. Loads Leaflet
  1.9.4 + leaflet-rotate 0.2.8 from unpkg and Esri World Imagery tiles from
  arcgisonline. Has a draggable aim ring with solid/dashed lines and a HUD
  (big "to green" top-right, front/back cards on the left edge, yellow
  "🎯 layup + carry" chip at the bottom).
- `onCourse()` uses a 2000 m threshold; off-course there is no anchor — just a
  drag-to-measure marker. `initView()` rotates via `setBearing` +
  `fitBounds`, which can misframe under rotation.
- `src/components/scorecard/HoleMap.js` (flat SVG diagram) is dead code —
  nothing imports it. Delete it (and its tests, if any) as part of Phase 1.
- Geometry (greens, tees, hazards) is bundled + hydrated from Supabase and
  works offline already; GPS is on-device. Only the map page's libraries and
  tiles need the network today.

## Phase 1 — Two-leg line, anchor rule, framing, HUD

All in `holeMapHtml.js` (view mode) + small host changes in `HoleFlyover.js`.

### Anchor rule

Extract a pure helper (new `src/lib/flyoverModel.js`, unit-tested):

```
anchorFor({ player, tee, greenCenter }) →
  { anchor: [lat,lng], source: 'gps' | 'tee' | null, playerDistance: m | null }
```

- `player` valid and within **700 m** of `greenCenter` → `source: 'gps'`.
- Else `tee` valid → `source: 'tee'`.
- Else `source: null` → keep today's drag-to-measure behavior (dashed
  ring→green line only).

The page receives the anchor with the rest of the hole data and on `player`
messages re-evaluates it (a player crossing 700 m flips the anchor live).

### Two-leg line + chips

- Solid white line anchor → aim ring; dashed white line ring → green center.
- A distance chip (dark pill, white bold tabular numerals, e.g. `183 m`)
  sits at the midpoint of each leg, rendered as a non-interactive
  `L.divIcon` marker so it never blocks dragging.
- The aim ring stays a persistent draggable marker (as today); dragging
  rebuilds only lines + chips. **New:** tapping anywhere on the map in view
  mode moves the ring there (edit mode keeps its tap-to-place behavior).
- Ring default position: midpoint of anchor → green.
- The bottom yellow "🎯 layup + carry" chip is removed — the on-line chips
  replace it. The bottom pill becomes:
  - `source: 'gps'` → "Drag the ring or tap anywhere" (hint).
  - `source: 'tee'` → "📍 X.X km away — measuring from the tee" (or
    "No GPS — measuring from the tee" when there is no fix).
  - `source: null` → "Drag the ring to measure" (unchanged).

### Tee-up framing

Replace `initView()`'s rotate+`fitBounds` with a deterministic computation:
bearing = tee → green center; center = midpoint; zoom from hole length vs
viewport height with ~45% padding (`zoomSnap: 0.25`, capped at 19.5). Applied
whenever the hole has both tee and green; fallbacks (no tee → frame
player→green or center on green) unchanged.

### Unified distance cluster (HUD)

One panel top-right replaces the big number + left-edge front/back cards:

```
Back   145
      132 m     ← center, 40px, dominant
Front  121
TO GREEN [· FROM TEE]
```

Distances measured from the anchor. Vertical order (back above front) mirrors
the tee-up map. Front/back fall back to nearest/farthest green-polygon vertex
from the anchor when explicit `greenFront`/`greenBack` are missing (existing
`fcb()` logic, with `from` = anchor instead of player).

## Phase 2 — Offline

### 2a. Bundle the libraries

Add `leaflet@1.9.4` and `leaflet-rotate@0.2.8` as npm dependencies; inline
their dist JS/CSS into the HTML string built by `buildHoleMapHtml()` (read
once, cached in module scope). No more unpkg — the page boots offline and
loads faster online. Metro cannot import node_modules dist files as raw text,
so a small generation script (`scripts/build-leaflet-vendor.js`, run via a
`postinstall`/manual npm script) writes `src/lib/vendor/leafletBundle.js`
exporting the JS/CSS as string constants; the generated file is committed.

### 2b. Tile bridge + cache

The page stops loading Esri tiles directly. Instead:

- **Page side:** a custom `L.GridLayer` whose `createTile` posts
  `{ type:'tile', z, x, y, id }` to the host and fills the tile `<img>` when
  `{ type:'tile-data', id, dataUrl }` comes back. No answer / null → the tile
  stays transparent and the vector layer shows through.
- **Host side:** new `src/store/tileCache.js`:
  - `getTile(z, x, y)` → local hit, else fetch from Esri + store, else null.
  - Storage is keyed per course so deletion/eviction stays simple: Android
    `expo-file-system` under
    `documentDirectory/tiles/<courseKey>/<z>_<x>_<y>.jpg`; web Cache API with
    the courseKey in the cache name (`tiles:<courseKey>`). Tiles fetched by
    browsing outside any prefetch land in a shared `_browse` bucket. Rare
    cross-course duplicates are accepted for the simpler model.
  - Size cap (~150 MB) with oldest-course-first eviction (`_browse` evicted
    first); per-course delete.
- Vector context (green polygon, hazards, markers, lines, chips, HUD) renders
  regardless of tile availability — offline with no cache the flyover is a
  fully functional rangefinder on a dark background.

### 2c. Course pre-download

New `prefetchCourseTiles(courseName)` in `tileCache.js`:

- For each mapped hole: padded bbox around tee→green (plus hazards), tiles
  enumerated for zooms 15–19 (pure `tilesForBbox()` helper, unit-tested).
  Dedupe across holes; download with limited concurrency (~4) through the
  same cache.
- Triggers:
  - Automatically when a round is created/resumed on a course with geometry
    (skipped on cellular unless already partial — `expo-network` check).
  - Manually from the course detail screen: "Download for offline" row with
    progress, size estimate (~30–60 MB), and delete option.
- Progress surfaced via a small store subscription (same pattern as sync
  status), non-blocking.

## Error handling

- Tile fetch failures (offline, 4xx/5xx) → transparent tile, no retry storm
  (per-session negative cache).
- Storage full / quota errors → stop writing, keep serving hits, surface
  nothing to the user (imagery is best-effort by design).
- Prefetch is resumable: already-cached tiles skip instantly, so re-running
  after an interruption completes the remainder.
- postMessage bridge keeps working as today when the host never answers
  (edit mode unaffected).

## Testing

- Jest (existing store/lib pattern):
  - `flyoverModel.anchorFor()` — GPS/tee/null branches, 700 m boundary.
  - `tilesForBbox()` — counts, zoom clamping, dedupe.
  - `tileCache` keying + eviction with mocked storage.
- Manual: web app via the Playwright verify skill (drag, tap, tee fallback,
  offline mode with DevTools network off); Android via EAS preview build.

## Out of scope

- iOS builds (project ships web + Android).
- Vector *tiles* / other imagery providers.
- Persisting the aim point across holes or sessions.
- Changes to the GPS strip (`GpsDistancePanel`) or the geometry editor.
