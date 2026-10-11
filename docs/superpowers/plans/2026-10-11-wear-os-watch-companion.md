# Wear OS watch companion — plan

**Date:** 2026-10-11 · **Status:** pager UI (B revised 2026-10-11), building · **Lifecycle:** `deliver` (full)

## Goal

Hole19-style watch companion. The phone keeps the live scorecard open (as today, with the
round-tracking foreground service); the watch shows the current hole's distances to the
green and lets me enter my **strokes, putts, fairway/tee lie, sand shots and penalties**
without taking the phone out.

**v1 decisions (2026-10-11):** Wear OS only (Apple Watch later, if ever) · input =
strokes + putts + stats · watch edits **my own** score only (the me-player).

## Watch UI — pager: Distances | Score | Stats

Design B (picked 2026-10-11) was revised after on-device feedback the same day (Galaxy Watch
SM-R910): the Picker lagged, strokes started at net par, the sand/penalty caps felt broken, the
tee-shot screen was cluttered, and hole change / scoring were hard to reach. Mockups of B:
https://claude.ai/artifact/TZMXXaDAEjw65YFo7kdC94 (private, not committed).

A `HorizontalPager` with a dot indicator; page 0 on launch, and the watch **stays on its page**
when the hole changes. HUD palette from `src/theme/tokens.js` `hud`; Plus Jakarta Sans.

- **Distances:** `HOLE 7 · PAR 4` · back (small) · **centre (large)** · front (small) ·
  `SI 3 · +1 shot`; status lines for no fix / phone not connected / `2 holes waiting`.
  **Hole change = crown or vertical swipe (up = next, down = previous)**, sent as an absolute
  `hole` command; the header shows the target at once (distances dimmed) and snaps back after
  2.5 s if the phone does not confirm.
- **Score:** caption `HOLE n · PAR p`; **Strokes** large with `−`/`+` (52dp); **Putts** smaller
  below (44dp); footer `3 pts · 14 total`. Unscored = `–`; the first `+` (or first crown tick)
  lands on **par**, not net par. Putts `–` until strokes exist; the first `+` gives 2; range
  0..min(strokes, 10). The crown adjusts strokes with a light haptic per step (no Picker; the
  rotary delta is accumulated into whole steps).
- **Stats:** `TEE SHOT` and one row of four round toggles (Fwy · Rgh · Sand · Trbl, selected =
  accent fill), replaced by `Par 3 · no tee shot` on a par 3; then `Sand` and `Penalty` rows
  (`label − n +`). Rows whose Stats-tracking group is off are hidden; a page with no rows is
  dropped from the pager. The phone's cap stays (putts + sand + penalty <= strokes), explained
  by a hint: `Max for 4 strokes` when a `+` is blocked by it, `Set strokes first` (inputs off)
  while strokes are unset.
- **No Save.** Edits are sent ~1 s after the last change: `strokes` then `shot` (absolute
  values), through one outbox `enqueueAll`. Before a `hole` command (crown / swipe) pending
  edits are flushed in the same call, ahead of it. Edits are pinned to the round and hole they
  were made on: if the phone's state moves to another hole or round while edits are pending,
  they are sent at once for their own hole (the phone accepts them only if still on it) and are
  never re-targeted. The watch also flushes when the app stops.
- **States:** dispute -> Score/Stats show `Resolve on phone` with inputs off; viewOnly / official
  -> Distances only; no round -> "Open a round on your phone to start."; phone out of range ->
  edits queue on the watch ("2 holes waiting"); unsupported `v` -> "Update the watch app".

## Non-goals (v1)

- Standalone watch round (no phone). The phone is the brain; the watch is a remote.
- Scoring other players, resolving disputes, or official-tournament admin from the watch.
- Shot tracking / club picking / hazards on the watch.
- Apple Watch.

## Architecture

```
 ┌──────────────── phone (com.golfpartner.app) ─────────────────┐        ┌────── watch (com.golfpartner.app, :wear) ──────┐
 │ ScorecardScreen                                              │        │ Compose for Wear OS                             │
 │  ├ useGpsDistances ─┐                                        │        │  ├ HoleScreen (distances F/C/B)                 │
 │  ├ useRoundCards ───┼─► watchStateOf() ─► useWatchBridge ────┼─Data──►│  ├ ScoreScreen (strokes, putts)                 │
 │  │                  │   (pure, tested)     │                 │ Layer  │  ├ StatsScreen (lie, sand, penalties)           │
 │  └ writeEntry / setShot / leaveHole ◄──────┘◄─ commands ◄────┼─Msg────┤  └ own location → distances from green coords  │
 │ modules/golf-watch-bridge (Expo module, Kotlin)              │        │                                                 │
 └──────────────────────────────────────────────────────────────┘        └─────────────────────────────────────────────────┘
```

- **Phone → watch: state** as a Wearable `DataItem` at `/golf/state` (setUrgent). DataItems
  are the right primitive: last-write-wins, delivered on (re)connect, readable by the watch
  at launch with no request.
- **Watch → phone: commands** via `MessageClient` at `/golf/cmd`. Commands carry
  **absolute values, not deltas** — a retried or duplicated message is idempotent.
- **Phone state republish = ack.** After applying a command, the phone pushes fresh state;
  the watch shows its optimistic value until the next state with `rev` > its command's
  `baseRev` arrives, then the phone's truth wins.
- **Distances are computed on the watch** from the green's front/centre/back coordinates the
  phone sends with the hole. Wear OS fused location uses the phone's GPS while connected
  and the watch's own GPS otherwise. This keeps distances live even when the phone's JS is
  throttled in a pocket; the phone's own F/C/B ride along as a fallback for holes without
  a fix on the watch yet.
- **Every write goes through the scorecard's existing callbacks** (`writeEntry`, `setShot`,
  hole navigation via `leaveHole`). The watch never touches the cards engine directly, so
  drafts, publish-on-leave, seeding from the card, agreements and disputes behave exactly
  as for a tap. Changing hole from the watch = the phone pager moving; if leaving opens
  the dispute sheet, state goes out with `blocked: 'dispute'` and the watch says
  "Resolve on phone".

## Contract (v1) — event contract, top-tier review

`/golf/state` DataItem, key `json` (UTF-8 JSON):

```js
{
  v: 1, rev,                    // rev: ms-based monotonic counter, see below
  ack: null | string,           // id of the last watch command processed, see below
  roundId, courseName,
  active: true,                 // false → watch shows "Open a round on your phone"
  blocked: null | 'dispute' | 'viewOnly' | 'official',
  units: 'm' | 'yd',
  hole: { number, count, par, si, extraShots,
          green: { front:[lat,lng], center:[lat,lng], back:[lat,lng] } | null,
          phone: { front, center, back, source:'gps'|'tee' } | null },
  me: { playerId, name, strokes|null, points|null, totalPoints, thru,
        putts|null, driveLie|null, sandShots, penalties },   // penalties = otherPenalties
  track: { putting, teeShot, shortGame, penalties }           // Settings → Stats tracking
}
```

`/golf/cmd` message (JSON):

```js
{ v: 1, id, roundId, baseRev, hole, type: 'strokes', value: int|null }
{ v: 1, id, roundId, baseRev, hole, type: 'shot', patch: { putts?|driveLie?|sandShots?|otherPenalties? } }
{ v: 1, id, roundId, baseRev, type: 'hole', to: int }
```

Phone rejects (and just republishes state) when `v`, `roundId` or — for `strokes`/`shot` —
`hole` ≠ current hole, or when `blocked` is set.

**`rev`, `baseRev`, `id` (revised 2026-10-11 after review):**

- `rev` is `max(previous rev + 1, Date.now())` on the phone — a millisecond-based
  counter, monotonic within a JS session and, because it starts from the wall clock, above
  the last session's revs after an app restart or OTA reload. It exceeds 2³¹: **parse it as
  a 64-bit integer (Kotlin `Long`)**. `baseRev` is the `rev` of the newest state the watch
  had when it built the command.
- **Watch side:** a state whose `roundId` differs from the one held is a new round —
  replace everything and drop optimistic values. Queued commands for the old round are
  kept but not sent (the phone would reject them as `round`); they go if that round is
  not active again within 12 h.
  Within one `roundId`, ignore a state with a lower `rev` than the one held (an
  out-of-order delivery) — except the first state after the watch app starts or the phone
  reconnects, which is always accepted: the phone's clock can step backwards (manual
  change, NTP), and a watch that waits for a higher `rev` would freeze.
- **Order:** the phone applies commands strictly one at a time in arrival order, each
  judged against where the previous one left the scorecard, so an offline queue
  (`strokes 7`, `shot 7`, `hole 8`, `strokes 8`, …) replays as it was entered.
- **Stale `hole`:** a `hole` command with `baseRev` older than the state in which the phone
  arrived on its current hole **by its own doing** (pager swipe, Next, auto-advance) is
  rejected (`stale`) — the watch never saw that move. Moves the watch itself asked for do
  not reset this, so two crown steps sent on the same `baseRev` (to 8, then to 9, before the
  state for 8 came back) both apply. A phone move not published yet makes every `hole`
  command stale.
- **`ack`:** the `id` of the last command the phone *finished* processing — applied or
  rejected, duplicates included; unchanged by an unparseable message; `null` until the
  open scorecard has processed a command (reopening the scorecard starts over at `null`).
  Every state carries it, including the inactive one sent when the scorecard closes. The watch ends a command's optimistic overlay when it
  sees that command's `id` in `ack` (or an `ack` of a command it sent later, since the
  phone processes in arrival order), **not** on a higher `rev`: a distance push can go out
  between receiving a command and applying it, and it still carries the previous `ack`.
- **Offline (watch side, v1):** the watch drops `hole` commands while disconnected rather
  than queueing them; queued `strokes`/`shot` commands are replayed on reconnect and the
  phone accepts them only if it is still on that hole (otherwise rejected and acked).
  Accepted for v1.
- **Watch outbox:** a command leaves the watch's queue only when `ack` names it or a
  command of the same round queued after it (one sequence number per command, assigned at
  enqueue; a re-save removes the old entry and appends, so `strokes` stays ahead of its
  `shot`). A `sendMessage` success proves nothing (the hub may drop it after 30 s), so an
  unacked command is re-sent **with the same `id`** after 35 s, on reconnect, on app
  start and when its round becomes active again — together with everything queued after
  it, to keep order. Nothing is sent while the held state is inactive, and only commands
  whose `roundId` is the active round's. `hole` is sent once and never re-sent. The
  optimistic overlay ends on that ack, or 45 s after the command's first hand-off
  (connected time only) as a fallback.
- **Entry is pinned to its hole:** the entry flow captures round + hole when opened; if
  the phone's state moves to another hole or round before Save, the watch goes home and
  writes nothing. Sand/penalty steppers are capped so putts + sand + penalties stay
  within strokes, and the save is trimmed like `reconcileShotDetail` (putts, then sand,
  then penalties; tee penalties are invisible to the watch and count as 0).
- **Duplicates:** the phone remembers the last 64 command `id`s; a repeat is acked
  (state republished) and not applied again. A retry of the same command must reuse its
  `id`; a new entry must get a new one.
- **Not checked (v1):** `strokes`/`shot` are not compared with `baseRev` per cell. A
  `strokes` built before a phone-side edit of the same cell still overwrites it (last
  writer wins, values are absolute). The watch shows the phone's truth on the ack.
- **Writes the phone refuses** on top of the above: a `strokes`/`shot` for a hole whose
  leave/finish publish is already under way (it would land in a draft nobody publishes),
  and a `shot` while my strokes on that hole are empty. A `shot` is merged onto my
  *current* detail for the hole (after the preceding `strokes` trimmed it), then trimmed to
  the strokes again.
- **Ack:** state is republished after the command's write has landed on disk, so the
  ack's `rev` already carries the new value. Distance-only refreshes are put without
  `setUrgent`; everything else is urgent.
- **Buffered on the phone:** commands that arrive while the scorecard JS is not
  listening wait in the native hub for at most 30 s; older ones are dropped. `driveLie` is the existing
`'fairway'|'rough'|'sand'|'trouble'` model (no left/right miss — no schema change); hidden
on par 3s like the phone. Penalties map to `otherPenalties` only (tee penalties stay a
phone input).

## Build items

| # | Item | Files | Model |
|---|------|-------|-------|
| W1 | Wear Gradle module + config plugin + EAS profile. `plugins/withWearApp.js` copies `wear/` into `android/` at prebuild and adds it to `settings.gradle`; same `applicationId` as the phone (Data Layer requires same package + signing key). EAS profile `wear-preview` with `gradleCommand: ":wear:assembleRelease"` + `applicationArchivePath` so the watch APK is signed with the same EAS keystore. Skeleton watch app that renders "hello". | `plugins/withWearApp.js`, `wear/**`, `app.json`, `eas.json` | **Opus** (native build plumbing, expensive to unwind) |
| W2 | Phone native bridge: local Expo module `modules/golf-watch-bridge` (Kotlin) — `setState(json)` → DataClient, `addListener('command')` from a `MessageClient` listener; `play-services-wearable` dep. JS facade `src/lib/watchBridge.js` (no-op on web/iOS, like `lib/roundTracking`). | `modules/golf-watch-bridge/**`, `src/lib/watchBridge.js` | **Opus** |
| W3 | Phone JS: `watchStateOf()` pure builder + `applyWatchCommand()` validator/dispatcher in `src/store/watchProtocol.js` (unit-tested), `src/hooks/useWatchBridge.js` (mirrors `useRoundTracking`), wired into `ScorecardScreen` next to `useRoundTracking` — no growth of the monolith beyond the hook call. | `src/store/watchProtocol.js` (+tests), `src/hooks/useWatchBridge.js`, `ScorecardScreen.js` | **Sonnet** |
| W4 | Watch UI (Compose for Wear OS, HUD palette) per the chosen design; distance maths + state parsing unit-tested (JVM). | `wear/src/**` | **Sonnet** (escalate to Opus on Gradle/Compose trouble) |
| W5 | Review of contract + native code. | — | **Opus** |

Order: W1 → W2 ∥ W3 → W4 → W5. W3 can start right after the contract is frozen.

## Risks

1. **Phone JS in the background.** Commands arrive in native code; the JS handler must
   run while the phone sleeps in a pocket. The round-tracking foreground service keeps the
   process alive; to be proven on device in step 4. Fallback: a native
   `WearableListenerService` that wakes the app, or queueing commands natively and
   draining them on resume (state shows "Saved on watch, syncing").
2. **Signing/package pairing.** Data Layer only connects apps with the same package and
   signing key — hence building the watch APK through EAS with the same credentials.
3. **Installing on the watch.** Internal APKs aren't offered to the watch by Play; v1
   installs via `adb` over Wi-Fi to the watch (documented in the PR). Play internal
   testing track is a later step.
4. **Runtime fingerprint.** W1/W2 change the native side → new phone APK
   (`preview-arm64`), and the fingerprint moves; OTA updates afterwards target the new APK.
5. **No web verification** for the watch itself — web stays unchanged (bridge is a no-op);
   on-device verification is the real check.

## Verification

- `npm test`, `npm run lint`, `npm run build:web` green; JVM tests for the watch.
- Web: scorecard walkthrough unchanged (no regressions from the hook).
- Dev on device: phone APK + watch APK installed; a throwaway round (qa account, not a real
  league/official round): distances update walking; strokes/putts/lie/sand/penalty from the
  watch land on the phone card; changing hole from the watch publishes; phone locked in a
  pocket for 5 min still accepts watch input; watch out of range then back reconciles.
- UAT = preview channel: same checks on the `preview-arm64` build.

## Open questions

- Which watch model (needs Wear OS 3+; e.g. Galaxy Watch4+ / Pixel Watch)? Decides the
  round-screen size used in W4 and how we install.

## v1.2 — whole-course state + full stats (device feedback 2026-10-11)

Feedback: vertical hole swipe sometimes skips >1 hole and waits on the phone; many
trackable stats missing; the watch's Fwy/Rgh/Sand/Trbl tee row doesn't match the
phone's direction model. User picked all stat groups: tee shot (full), approach,
putting, short game.

**Contract additions (still `v: 1`, additive — older watch builds ignore them):**

```js
state.course = { holes: [ { number, par, si, extraShots, green: {front,center,back}|null, tee: [lat,lng]|null } ] } // every hole of the round
state.mine = { "<hole>": { strokes|null, points|null, shot: ShotDetail|null } }              // what the phone SHOWS for me, every hole
state.track = { putting, teeShot, approach, shortGame, penalties }                            // + approach
// ShotDetail (watch-visible subset of DEFAULT_SHOT):
{ putts, drive, teeClub, driveDistBucket, teePenalties, otherPenalties, sandShots,
  recoveryOutcome, firstPuttBucket, approachBucket, approachResult, approachMiss, approachBunker }
```

`shot` patch keys now: `putts`, `drive` ('left'|'fairway'|'right'|'short'|'super'|null),
`teeClub` ('wood'|'hybrid'|'iron'|null — driver is null), `driveDistBucket`
('0-150'|'150-180'|'180-210'|'210-240'|'240+'|null), `teePenalties` / `otherPenalties` /
`sandShots` (0..9), `recoveryOutcome` ('up-and-down'|'sand-save'|'none'|null),
`firstPuttBucket` ('0-1'|'1-2'|'2-3'|'3-6'|'6+'|null), `approachBucket`
('0-50'|'50-100'|'100-150'|'150-200'|'200+'|null), `approachResult` ('green'|'miss'|null),
`approachMiss` ('long'|'short'|'left'|'right'|null), `approachBunker` (bool), and the
legacy `driveLie`. The phone normalizes a patch exactly the way its own ShotDetailPanel
handlers combine these fields (e.g. picking a drive direction / on-green vs a miss
direction), then reconciles against strokes.

**Watch:** switches hole instantly from `course` + `mine` (sends `hole`, phone catches up);
exactly one hole per vertical swipe gesture; pages Distances | Score | Tee | Approach |
Putting & short game. Groups off in Settings hide their rows/pages; par-3 rules mirror
the phone's ShotDetailPanel (what it hides on a par 3, the watch hides).

### v1.2 — phone-side decisions (implemented)

- **`course`** is built by `watchCourseOf` (`useWatchBridge.js`), memoized per round / me / course
  and the geometry version (`geomVersion` from the screen), so it does not change per GPS fix.
  `green` is the same triple as `hole.green`; `tee` is `holeFeatures(...).start`, the point
  `resolveScorecardDistances` measures from. A hole without course geometry has `green: null, tee: null`.
- **`mine`** has an entry for every hole: `strokes`/`points` from `visibleScores` (what the phone
  shows, drafts and resolutions included), `shot` = the watch-visible subset of the shown
  shot detail (`WATCH_SHOT_FIELDS` in `watchProtocol.js`; `driveLie` and `approachLie` are not
  sent), `null` when the hole has no detail. `track.approach` added.
- **Distance rule for the watch** = the phone's `resolveScorecardDistances`: a fix within
  `ANCHOR_MAX_GPS_METERS` (1000 m) of the green centre gives GPS distances to front/centre/back;
  otherwise distances are measured from `tee` and labelled source `tee`; with no `tee` the watch
  shows nothing (never a straight line from far away).
- **Patch validation** (`parseWatchCommand`): enums as listed above plus `recoveryOutcome: 'none'`;
  `approachBunker` must be a boolean (not null); `teePenalties` 0..9. Unknown keys (e.g.
  `approachLie`) are rejected.
- **Normalization** (`normalizeWatchShotPatch` in `store/scoring.js`; the panel's handlers were
  extracted into `driveDirectionPatch`, `teeClubPatch`, `approachBucketPatch`,
  `approachFinishPatch`, `recoveryOutcomePatch` and `ShotDetailPanel` uses the same functions):
  - `drive` -> `{drive, driveLie: null}` (a direction resets the explicit lie).
  - `driveLie` alone -> sets the lie and clears `drive` (legacy v1 behaviour); sent together with
    `drive` it only refines that direction's lie.
  - `teeClub` -> `null` for the driver (the watch sends null; `'driver'` is invalid).
  - `approachBucket: null` clears `approachResult/Miss/Bunker/Lie`.
  - Approach finish (needs an approach distance, otherwise ignored): `approachResult: 'green'` ->
    green, miss null, bunker false. `approachMiss` / `approachBunker` -> stored, and
    `approachResult` is derived (`'miss'` if a direction or bunker, else null); if the hole was on
    green, a direction or bunker replaces it (the other one resets). `approachResult: null`
    alone clears the finish. `approachResult: 'miss'` with no direction/bunker derives to null.
  - Par 3: `teeClub`, `drive`, `driveLie`, `driveDistBucket` and the approach-finish keys are
    ignored (the panel hides those rows). Approach distance, putts, penalties, sand and recovery
    still apply.
  - `recoveryOutcome`, `firstPuttBucket` and the counters are absolute. `firstPuttBucket` is not
    cleared when putts go to 0 by patch (as in the panel); `reconcileShotDetail` clears it only
    when putts are trimmed to 0.
  - Then `reconcileShotDetail(detail, strokes)`: putts, sand, other penalties, then **tee
    penalties** are trimmed in that order; tee penalties are now counted from the watch too.

## v1.3 — review fixes: no input ahead of the phone, refused saves, minimal patches

**Contract addition (still `v: 1`, additive):**

```js
state.lastReject = null | { id, reason, hole }   // also on the inactive state
```

- `lastReject` is the **most recent** watch command the phone refused: `reason` is
  `decideWatchCommand`'s (`invalid`, `round`, `blocked`, `stale`, `range`, `same-hole`, `hole`) or
  `refused` when the scorecard turned it down (a write behind the publish of the hole being left,
  a shot without strokes, a `hole` move after which the phone is not on `to`, e.g. the dispute sheet
  opened). `hole` is the command's hole (a move's `to`). It lives as long as `ack` (a ref in
  `useWatchBridge`), is not cleared by later applied commands (a coalesced Data Layer item must not
  lose it) and is unchanged by duplicates and unparseable messages.
- **Watch:** while a strokes/shot command is still shown as overlay, a state whose `lastReject.id`
  names it shows a brief, non-blocking `Not saved — hole N`; the ack in the same state ends the
  overlay, so the phone's values show again (no retry: the phone said no). Only the latest reject
  is visible, so a burst of refusals reports the last one.

**A hole shown ahead of the phone is look-only.** The phone takes `strokes`/`shot` only for its
current hole, so the watch never pins an edit to a hole the phone is not on:

- While the picked hole (`target`) ≠ the phone's hole, the target's Distances/Score/stats show at
  once (from `course` + `mine`), but the inputs and the Score crown are off and the hint/footer says
  `Moving to hole N…`. `WatchController.edit` also drops a change for a hole the phone is not on.
- Inputs come back when the phone's state shows the target hole.
- The move fails when the phone's state turns `blocked` while it is in flight (`dispute` →
  `Resolve on phone`, anything else → `Couldn't change hole — check phone`) or after
  `HOLE_SETTLE_MS` (4 s) without arrival (`Couldn't change hole — check phone`); the pager snaps
  back to the phone's hole.

**Drive lie survives watch saves.** `normalizeWatchShotPatch` resets `driveLie` only when the
patch's `drive` differs from the stored one; the same direction again keeps a lie picked on the
phone. The watch now sends only the shot keys whose values differ from what the hole showed when
the edit began (`me.shot`, the seed; still absolute values). The seed is compared unclamped, so a
counter the strokes reconcile trimmed is still sent; a strokes-only edit sends no `shot` command.

## v1.4 — watch UI polish after device feedback (SM-R910)

- Every `‹ value ›` stepper is now single-select **chips** (drive distance, approach distance, first
  putt, tee club): tap the lit chip to clear; the club defaults to Driver (null) and tapping the lit
  non-driver goes back to Driver. 5 options lay out 3 + 2, 4 options 2 + 2; chips are >= 40dp high.
- The Tee page is split: **Tee shot** (direction toggles) and **Drive** (club, drive distance, tee
  penalties). On a par 3 the phone ignores direction/club/distance, so Tee shot is hidden and Drive
  holds only the tee penalties (hidden too when penalties tracking is off).
  Order: Distances | Score | Tee shot | Drive | Approach | Short game.
- "Other pen." is now "Penalty"; row labels are single-line. Stats pages keep a 22dp strip free
  for the page dots, and scroll above it.
- A track group missing from the state is read as ON (the phone's ShotDetailPanel default).
