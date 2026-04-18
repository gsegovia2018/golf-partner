# Tournament Media — Photos & Videos for Rounds

Date: 2026-04-19
Branch: worktree-fix-ui

## Goal

Let the 4 friends attach photos and short videos to a round during play, then browse those memories per round and per tournament. Capture must feel instant even with the patchy mobile signal typical of a golf course.

## Decisions

- **Granularity:** attach to a round, optionally tag a hole. Hole tag is metadata, not a hierarchy.
- **Surfaces:** inline strip in `ScorecardScreen`, "Recuerdos" section in the tournament view, dedicated `GalleryScreen` with filters.
- **Media types:** photos and videos. Videos capped at 20 seconds.
- **Auth:** none. The app already runs on a shared anon key for the 4 friends; storage uses a public bucket.
- **Capture entry point:** single camera button in the Scorecard header. Hole tag is offered after capture, pre-filled with the last edited hole, with a "Sin hoyo" option.
- **Network model:** optimistic. Local thumbnail appears instantly; upload runs in background with retry; failure shows a tap-to-retry indicator.

## Architecture

### Storage

Supabase Storage bucket `tournament-media`, public-read, anon-write.

Paths:
- Original: `{tournamentId}/{roundId}/{mediaId}.{ext}`
- Thumbnail: `{tournamentId}/{roundId}/thumbs/{mediaId}.jpg`

`mediaId` is a client-generated UUID so the path is known before upload completes (lets us write the row optimistically).

### Database

New table `tournament_media`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | client-generated |
| `tournament_id` | text | matches existing `tournaments.id` |
| `round_id` | text | id of the round inside `tournaments.data.rounds` |
| `hole_index` | int nullable | 0–17, or null for "Sin hoyo" |
| `kind` | text | `'photo'` or `'video'` |
| `storage_path` | text | full path in `tournament-media` bucket |
| `thumb_path` | text | always generated client-side at 400px before insert; never null in a persisted row |
| `duration_s` | numeric nullable | videos only |
| `caption` | text nullable | optional, free-form |
| `uploader_label` | text nullable | free-form text shown in lightbox footer; the AttachMediaSheet remembers the last value used (AsyncStorage) and pre-fills the next capture |
| `created_at` | timestamptz | default `now()` |

Indexes: `(tournament_id, created_at desc)` and `(round_id, created_at desc)`.

Why a separate table instead of stuffing into `tournaments.data` JSON: media listings need their own pagination and updates; pushing them into the existing JSON blob would force a full re-upsert on every photo and bloat the document.

### Client modules

- `src/store/mediaStore.js` — CRUD + subscriptions. Mirrors the shape of `tournamentStore.js` (subscribe pattern, async functions, Supabase as source of truth).
- `src/store/mediaQueue.js` — offline queue. Persists pending uploads in AsyncStorage under `@golf_media_queue`. Each entry: `{ id, tournamentId, roundId, holeIndex, kind, localUri, status, attempts, lastError }`.
- `src/lib/mediaUpload.js` — single-item upload pipeline: compress → derive thumbnail → upload original → upload thumbnail → insert row. Idempotent on `id`.
- `src/hooks/useRoundMedia.js`, `src/hooks/useTournamentMedia.js` — subscribe to mediaStore + queue, return merged list (uploaded + pending).

### Offline queue lifecycle

1. User captures media. App writes file to local cache, generates `mediaId`, enqueues entry, returns to caller.
2. Optimistic UI: hooks return the local URI as a synthetic media item with `status: 'uploading'`.
3. Worker (started on app foreground and on `NetInfo` connectivity gain) drains the queue with exponential backoff (1s, 4s, 15s, 60s, then 5 min).
4. On success: insert row in `tournament_media`, remove queue entry, emit change.
5. On terminal failure (e.g., file missing): mark `status: 'failed'`, surface tap-to-retry in UI.

### Compression

- Photos: `expo-image-picker` with `quality: 0.7`, max dimension 1920px (uses native compression). Thumbnails generated client-side at 400px via `expo-image-manipulator`.
- Videos: `videoMaxDuration: 20`, `videoQuality: 0.7` on iOS, `quality: 0.7` on Android (both export to ~720p). Video thumbnail extracted via `expo-video-thumbnails` (already required for the lightbox poster anyway).
- Web: standard `<input type="file">`. No compression; we assume web is not the primary capture surface.

New Expo dependencies: `expo-image-picker`, `expo-image-manipulator`, `expo-video-thumbnails`, `expo-file-system`, `@react-native-community/netinfo`, `expo-av` (video playback in lightbox).

## UI

### ScorecardScreen

- Header: add a camera icon next to existing icons.
- Tap → action sheet: "Tomar foto" / "Tomar video" / "Elegir de galería".
- After picker returns: `AttachMediaSheet` modal with preview, hole selector (chips: Sin hoyo, 1, 2, …, 18; pre-selects last edited hole), optional caption, "Guardar" button. Save enqueues and dismisses immediately.
- Below the scorecard table: `RoundMediaStrip` — horizontal scroll of thumbnails for this round only, plus a "+" tile that opens the same picker. Pending items show a spinner overlay; failed items show a warning icon (tap to retry).

### Tournament view (HomeScreen `viewMode='tournament'`)

- New section "Recuerdos" below the leaderboard.
- 3-column grid, max 9 thumbnails (most recent first).
- Footer button "Ver todos los N" → `GalleryScreen` with `tournamentId`.
- Empty state: muted illustration + "Aún no hay recuerdos".

### GalleryScreen (new)

- Filter chips: "Todo" | "R1" | "R2" | "R3" | "Por hoyo" (opens hole selector).
- 3-column grid, lazy-loaded.
- Tap thumbnail → `MediaLightbox` opened on that index.

### MediaLightbox (new)

- Full-screen modal, swipeable horizontally.
- Photo: `expo-image` for caching. Video: `expo-av` with native controls.
- Footer: hole tag (if any), caption, date, uploader label.
- Top bar actions: share (existing `expo-sharing`), delete (confirm dialog), close.

### Delete

- Confirm dialog: "¿Borrar este recuerdo? No se puede deshacer."
- On confirm: delete row, then delete original + thumb from Storage. Errors logged but don't block UI removal.
- No trash / undo in v1.

## Navigation

- Add `Gallery` route to the stack in `App.js`.
- Params: `{ tournamentId, initialFilter?, initialMediaId? }`.

## Reactivity

- `mediaStore` exposes `subscribeMediaChanges(tournamentId, fn)` and `subscribeRoundMediaChanges(roundId, fn)`.
- Hooks combine remote rows with queue entries and recompute on either source changing.
- After successful upload, both subscriptions emit so Scorecard, Tournament view, and Gallery refresh.

## Out of scope (v1)

- Reactions, likes, comments
- Tagging players in media
- Manual albums or selections
- Backup to Google Photos / iCloud
- Re-encoding videos server-side
- RLS / per-user permissions (no auth exists yet)
- Bulk download / export

## Risks

- **Storage cost:** 4 friends × 3 rounds × ~30 items × ~5MB ≈ 1.8GB per tournament if videos dominate. Within Supabase free tier for a few tournaments; revisit if usage grows.
- **Bucket is public:** anyone with a path can read. Acceptable for this group; if auth is added later, switch to signed URLs and RLS in one migration.
- **Background upload on iOS:** Expo's foreground-only model means uploads pause if the user fully closes the app. Queue resumes on next open — accepted tradeoff to avoid native modules.

## Migration

One Supabase migration:
1. Create `tournament-media` bucket (public).
2. Create `tournament_media` table with indexes above.
3. RLS off for v1 (matches `tournaments` table behavior).
