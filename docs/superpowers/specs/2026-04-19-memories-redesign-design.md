# Recuerdos Redesign — Round Stories + Hole Activity

Date: 2026-04-19
Branch: worktree-fix-ui

## Goal

Replace the current `GalleryScreen` layout with a design that makes a tournament's memories feel like a playable recap: each round can be watched as a stories reel, and the grid below lets the group filter by hole (seeing at a glance which holes have media) and by media kind. Also fixes the existing bug where the filter row chips render oversized on web.

## Decisions

- **Round = stories unit.** Tapping a round circle opens a fullscreen stories viewer that auto-advances through that round's media. Rounds are not a grid filter; the grid shows all rounds at once, disambiguated per card.
- **Hole filter is always visible.** The 18-hole grid doubles as an at-a-glance "which holes have recuerdos" indicator. Tap to filter, tap the active cell again to clear.
- **Kind filter is separate and combinable** with the hole filter (`Todo` / `📷 Foto` / `🎥 Vídeo`). Only one kind active at a time; kind and hole filter together via AND.
- **Round count is unbounded.** The round row scrolls horizontally; no assumption of exactly 3 rounds.
- **Captions are first-class.** In the grid, if a memory has a caption, it shows under the thumbnail (2 lines, ellipsis). Author + time always shown.
- **Masonry, not square grid.** Thumbnails keep their native aspect ratio in a 2-column masonry layout. Avoids forced-square cropping and looks richer on web.

## UI

### Header

- Title "Recuerdos" (Playfair) with count and tournament name as subtitle: `47 · Masters del Ebro 2026`.
- Back button top-left (unchanged).

### Round stories row

Horizontal scroll. One entry per round in `tournament.rounds[]`.

- Circle avatar (56×56): background is the round's cover thumbnail (most recent media in that round). If the round has no media, the circle is flat `bg.secondary` with muted content.
- Inside the circle: the round label (`R1`, `R2`, …) in Playfair, white with text-shadow for legibility over any photo.
- Below the circle: `round.courseName` (one line, ellipsis, muted color, max width = circle width). Empty string if absent.
- No badge, no progress ring, no count.
- Tap a round with media → open Stories viewer for that round. Tap an empty round → no-op (circle appears dimmed ~60% opacity).
- End-of-row affordance: right-edge fade gradient over the container so users know to scroll if the row overflows.

### Hole filter strip

Card with header "POR HOYO · `N / total`" where N = distinct `hole_index` values present in this tournament's media.

- Body renders only the holes that have media, sorted ascending, as wrapping pill buttons.
- Cell states:
  - **default**: accent border, normal text.
  - **on** (this hole is the active filter): accent background, inverse text.
- Tap a cell → sets hole filter. Tap active cell → clears filter.
- If no holes have media, the whole strip hides (returns null).

Computing the displayed list: a single `Set<number>` built from `items` on each render via `useMemo`, then `Array.from(set).sort((a,b) => a-b)`.

### Kind chips

Row of three pill chips under the hole grid: `Todo · N` / `📷 Foto` / `🎥 Vídeo`. Active chip uses accent color. `Todo` resets the kind filter (but keeps the hole filter).

### Masonry grid

2-column layout with staggered heights (natural aspect ratio). Each item:

- Image at native aspect ratio, rounded corners on the whole card.
- Overlay top-left: pill `R{roundIdx+1}·H{hole+1}` (or just `R{roundIdx+1}` if no hole). The round index is derived by looking up `items[].roundId` in `tournament.rounds[]`.
- Overlay top-right if video: `▶ 0:12` (duration).
- Caption block below the image inside the same card:
  - Caption text (if present), 2 lines, ellipsis. 11px normal.
  - Author + time line: `{uploader_label} · {HH:mm}` if `uploader_label` is set, else just `{HH:mm}`. Muted, 9px. Always rendered so every card has a bottom meta row.
- Tap → open `MediaLightbox` on that index, using the currently-filtered list.

Empty state (after filter): keep the current icon + "Sin recuerdos para este filtro."

### Stories viewer (new)

Fullscreen modal. One instance per round.

- **Progress bars top**: one segment per media in the round, gap 3px. Active segment fills in real-time (4s for photos, media duration for videos). Completed segments are fully filled; upcoming are empty (30% opacity).
- **Top bar**: left pill `R{n} · {courseName} · {i+1}/{total}`, right close `✕`. Both on dark translucent background.
- **Body**: photo (`expo-image`, `contentFit=contain`) or video (`expo-av`, no native controls — we drive playback).
- **Tap zones**: left 1/3 = back (prev), right 2/3 = forward (next). Press-and-hold anywhere = pause (progress pauses). Release = resume.
- **Swipe down** or tap `✕` = close.
- **Auto-advance**: photos 4 s; videos advance on `playbackStatus.didJustFinish`.
- **Footer overlay**: hole chip `Hoyo {n} · Par {par}` (par looked up from `round.holes[hole].par`; omit par if hole is null), caption (larger, up to 3 lines), author + time.
- **End of round**: tapping next on the last item closes the viewer.
- Navigation past the first item with "back" clamps to item 0 (doesn't close).

## Component changes

### `src/screens/GalleryScreen.js`

Rewrite the layout. Keep the screen's responsibilities (route params, loading tournament, using `useTournamentMedia`, hosting `MediaLightbox`). Add state for:
- `holeFilter: number | null`
- `kindFilter: 'all' | 'photo' | 'video'`
- `storiesRound: { roundIndex } | null`

Replace the horizontal `ScrollView` of chips with the new sections: `RoundStoriesRow`, `HoleActivityStrip`, `KindChips`, `MasonryGrid`.

Also: remove the `Por hoyo` modal picker (superseded by the always-visible hole strip).

### New components (new files under `src/components/`)

- `MemoriesHeader.js` — title + count + tournament name.
- `RoundStoriesRow.js` — the horizontal round circles, takes `{ tournament, itemsByRound, onOpenStories }`.
- `HoleActivityStrip.js` — takes `{ maxHoles, holesWithMedia: Set<number>, activeHole, onSelect }`.
- `KindChips.js` — takes `{ counts, active, onChange }`.
- `MemoryCard.js` — one masonry item. Takes `{ item, roundIndex, onOpen }`.
- `MasonryGrid.js` — wraps the 2-column layout. On React Native, implemented with two `FlatList` columns that alternate items by index; on Web, uses CSS columns. Keeps a thin shared API.
- `StoriesViewer.js` — the fullscreen stories component described above. Reuses `MediaLightbox`'s share/delete actions where trivial (extract a small `MediaActionsRow` if it helps; otherwise inline).

### `src/components/TournamentMemoriesSection.js`

No structural change now. Optionally swap the 9-tile square grid for a 2-column masonry preview, but out of scope for this spec.

### Data / hooks

No schema changes. `useTournamentMedia` already returns everything we need. We compute:
- `itemsByRound: Map<roundId, item[]>` — for the stories row (latest first) and cover thumbnail.
- `holesWithMedia: Set<number>` — holes with any media.
- `counts: { all, photo, video }` — for chips.
All via `useMemo` in `GalleryScreen`.

### Web chip stretching fix

The existing bug is rooted in the `ScrollView horizontal` + pill children without `alignItems: 'center'`. The rewrite removes that `ScrollView` entirely; the new chip row is a plain `View` with `flexDirection: 'row'` and explicit `alignItems: 'center'`. No separate hotfix needed.

## Interactions summary

| Action | Result |
|---|---|
| Tap round circle (has media) | Opens Stories viewer at item 0 of that round |
| Tap round circle (empty) | No-op, circle looks disabled |
| Tap hole cell (`has`) | Sets hole filter; strip shows it `on` |
| Tap active hole cell | Clears hole filter |
| Tap inactive hole cell | No-op |
| Tap kind chip | Sets kind filter (combinable with hole) |
| Tap `Todo` chip | Clears kind filter only |
| Tap masonry card | Opens `MediaLightbox` with current filtered list |
| Stories: tap right 2/3 | Next media (closes viewer after last) |
| Stories: tap left 1/3 | Previous media (clamped at 0) |
| Stories: press & hold | Pause progress + video |
| Stories: swipe down / tap ✕ | Close |

## Out of scope

- Reordering media, manual "cover" selection per round
- Per-round filter on the masonry (rounds are the stories channel only)
- Multi-select for bulk delete/share
- Reactions / comments
- Pinch-to-zoom inside the stories viewer
- Search by uploader or caption text
- Changes to `TournamentMemoriesSection` (home preview)
- Changes to capture/upload flow

## Risks / open questions

- **Masonry on React Native:** there's no built-in masonry. The two-column alternate-index approach is simple but can feel unbalanced when one column has a run of tall videos. Acceptable for v1; revisit if users complain.
- **Cover thumbnail freshness:** if the most-recent media is a video, we use its `thumbUrl` (already generated client-side). Works the same as today.
- **Stories progress timer accuracy:** 4 s is a guess. Easy to tune after user testing. Consider 3.5 s for photos with no caption, 5 s for photos with caption — out of scope for v1.
- **Hole labelling when `holeIndex` is null:** current data allows `null` (the "Sin hoyo" option). Those items appear in the grid with the chip reading just `R1` (no `·H?`). They do NOT count toward any hole cell's `has` state.
