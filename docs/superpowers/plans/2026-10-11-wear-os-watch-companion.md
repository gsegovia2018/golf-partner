# Wear OS watch companion — plan

**Date:** 2026-10-11 · **Status:** design B picked, building · **Lifecycle:** `deliver` (full)

## Goal

Hole19-style watch companion. The phone keeps the live scorecard open (as today, with the
round-tracking foreground service); the watch shows the current hole's distances to the
green and lets me enter my **strokes, putts, fairway/tee lie, sand shots and penalties**
without taking the phone out.

**v1 decisions (2026-10-11):** Wear OS only (Apple Watch later, if ever) · input =
strokes + putts + stats · watch edits **my own** score only (the me-player).

## Watch UI — design B (picked 2026-10-11)

Mockups: https://claude.ai/artifact/TZMXXaDAEjw65YFo7kdC94 (private, not committed).

- **Home (one per hole):** `HOLE 7 · PAR 4` · back (small) · **centre (large)** · front
  (small) · `SI 3 · +1 shot` · bottom pill: `Score hole` when unscored, else ghost pill
  `5 · 2 pts`. Crown on home = previous/next hole (sends `hole` command).
- **Entry flow** (tap the pill): ① Strokes — crown picker starting at **net par**
  (par + extraShots) or the saved value, shows the Stableford points live and "net par"
  when equal, `Next`. ② Putts — crown, 0…strokes, starts at saved or 2, `Next` (`Save` on
  par 3). ③ Tee shot — 2×2 chips Fairway/Rough/Sand/Trouble (toggle), `More` → Sand and
  Penalty steppers, `Save`. Steps whose stats group is off in Settings are skipped.
- **Saved:** `Hole 7 saved` · strokes · `2 pts · 14 total` · `2 putts · fairway` ·
  `Hole 8 ›` (sends `hole`). Swipe back from any step returns home without saving.
- **Save** sends one `strokes` command then one `shot` command (absolute values).
- **States:** no GPS fix (`— m` + "Getting GPS fix"), phone out of range (entries queued
  on the watch, "2 holes waiting"), `blocked: 'dispute'` ("Resolve on phone", distances
  live), no round ("Open a round on your phone to start."), par 3 (no tee step).
- HUD palette from `src/theme/tokens.js` `hud`; Plus Jakarta Sans.

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
