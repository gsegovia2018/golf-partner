# League review follow-ups

Decided 2026-10-13 with Marcos, after a critical review of the league on master
`df8e8cfe`. Builds on `2026-10-04-league.md` and `2026-10-06-league-post-deadline.md`.
The December Final is **out of scope** (not decided yet).

## Why

The review found four kinds of problem:

1. **The ranking trusts the phone.** `submit_league_card` takes the playing
   handicap, the tee's slope/rating/par/SI and the Stableford points from the
   client and ranks on them. `p_playing_handicap = -54` wins every month.
2. **"Announce first, one card a month" has side doors:** silent unlimited
   reschedules, app-card holes never compared with the game, a player can return
   their own marker QR to resubmit, an admin can void their own card or raise
   their own handicap, an existing member can claim a reserved spot, past months
   never close.
3. **Rules that don't fit the group:** places past the points table score the same
   as not playing (18 members, 12 entries); net differential is a number nobody in
   the group reads, and Stableford already carries slope and rating (see below).
4. **Flows that dead-end or are missing:** no withdraw/void, the Android link opens
   the browser, "Join with code" rejects league codes, a round can silently not count,
   two league members in one game, tournament rounds can't count, nothing shareable
   to WhatsApp, English only.

### Why Stableford again

The course handicap is `index × slope/113 + (CR − par)` (`scoring.calcPlayingHandicap`)
and a 0-point hole is exactly the net double bogey cap. So
`net differential ≈ (36 − points) × 113/slope` plus up to half a stroke of course
handicap rounding: the two rank the same cards in the same order almost always. The
differential only adds decimals (fewer ties) at the cost of a number the group has
to learn. Ties are fine — the league already shares summed points.

## Rules

| # | Rule |
|---|------|
| R1 | **Months rank by net Stableford points**, highest first. Equal points tie and share the summed table points equally (2nd and 3rd tie → both get (300+190)/2). No tie-break. The net differential stays stored and shown on the card as secondary information. |
| R2 | **Points for playing:** every confirmed, counting card earns at least `leagues.participation_points` (default 10, admin-editable, 0 allowed) — `max(table share, participation)`. No card = 0. |
| R3 | **The server scores the card.** From the frozen league handicap and the frozen tee it computes the playing handicap, the Stableford points, the gross and the differential; client values are ignored. A card missing a score, par or SI on any of its 18 holes is refused. |
| R4 | **The tee comes from the library.** For a library course the server resolves slope/rating/par from `course_tees` by tee name and the player's gender (`rating_women`/`slope_women`), and freezes them on the card. A custom course keeps the client's tee and the card is marked `tee_verified = false`, shown as "Tee entered by hand". Rated tees stay required. |
| R5 | **App cards must match the game.** On submit, an app card's holes must equal that player's settled `game_scores` for the round. |
| R6 | **Deadline from the first shot.** An app card's `post_by` = first shot + 8 h (was Start + 8 h). Until the first shot it has no deadline but is withdrawn automatically 24 h after Start. |
| R7 | **Off-app announcing needs 2 hours' notice:** tee time ≥ now + 2 h. Reschedule: only while the current tee time is ≥ 2 h away, to a time ≥ 2 h away, same month; every reschedule notifies members and is logged. |
| R8 | **Off-app minimum round:** an off-app card can't be posted earlier than tee time + 3 h. |
| R9 | **Withdraw:** the owner can withdraw a card before its tee time (off-app) or before the first shot (app). The card becomes `void` (reason `withdrawn`), members are notified, and the month is free again. After that, only an admin can void it. |
| R10 | **Admins on their own card or handicap:** an admin can void, reopen, approve their own card or change their own handicap **only when no other active admin exists**. Every void, reopen, approval and handicap change notifies members and appears on the card's timeline. |
| R11 | **Marker returns:** neither the card's owner nor anyone signed in as the owner can confirm or return it. After a return the owner may resubmit **once, within 24 h**. |
| R12 | **Months close** at the end of the 3rd day of the next month (Europe/Madrid). After that no card of that month can be added, submitted, confirmed, approved, reopened or voided. |
| R13 | **Card timeline:** every card keeps an event log (announced, rescheduled, first shot, submitted, sent to marker, returned, confirmed by whom and how, approved, reopened, withdrawn, voided, questioned). Any member can see it. |
| R14 | **Question a card:** any member may question a confirmed or submitted card with a note (one open question per member per card). The admins and the owner get a push. An admin settles it by voiding the card or dismissing the question; both are on the timeline. |
| R15 | **Membership:** admin can remove a member (their past cards stay, like leaving) and generate a new invite code (old links stop working). A reserved spot can't be claimed by someone who is already a member; the claim is logged as the claimer's and the admin is notified; an admin can release a claimed spot. |
| R16 | **Several league cards per game:** every league member in a game may opt in their own card (each member's phone announces its own). |
| R17 | **Tournament rounds count:** any single round of a casual tournament can be a league card, opted in at that round's Start. |

## Build items

| ID | What | Model | Design? |
|----|------|-------|---------|
| **B1** | Migration: server scoring R1-R5, `participation_points`, `tee_verified`; ranking switch in `leagueStandings`/`leagueView`/`leagueStats`; push copy in `send-push`. Smoke test. | Opus | display → D2 |
| **B2** | Migration: integrity R6-R12, `league_card_events` + logging in every card RPC, `question_league_card`/`dismiss_league_question`, `withdraw_league_card`, `remove_league_member`, `rotate_league_invite_code`, invitee rules R15, R16 one card per member per game. Smoke test. | Opus | UI → D1, D3, D5 |
| **C1** | Client fixes, no design: `/league` Android intent filter (native → APK), Join-with-code falls back to leagues, copy (join screen ranking text, Validate "counts straight away", Declare→Announce, notification settings "apply to all your leagues"), `toLeagueError` only maps network errors to offline, no "Offline" flash on cold open, Setup shows "Checking your league…" / "Not counted: no connection" instead of silently dropping the switch, proof photo visible on app cards, marker note on Validate + "Edit in scorecard", QR screen "Send link". | Sonnet | no |
| **D1** | Card management UI: withdraw, admin void, timeline, question/dismiss. | Sonnet | **yes** |
| **D2** | Stableford ranking on board/card/stats/Play row; participation points in create + settings. | Sonnet | **yes** |
| **D3** | Members: remove member, new invite code, release spot. | Sonnet | **yes** |
| **D4** | Sharing: public read-only standings page (`/league-board/<token>`, anon RPC), share standings image/text, share my card, share announcement, month-end "ranking is in" text. | Sonnet (+ Opus review of the anon RPC) | **yes** |
| **D5** | Several league cards per game + tournament rounds in Setup/Scorecard. | Opus | **yes** |
| **I1** | i18n layer: pure JS (no native module, keeps OTA), locale from `Intl`, es/en catalogues, `t()` + plural + date helpers, Spanish golf glossary. League + marker page first. | Sonnet | no |
| **I2…** | Translate the rest of the app screen group by screen group. | Haiku (mechanical, against I1's glossary) | no |

Order: B1 → B2 (both migrations, applied by me after a BEGIN/ROLLBACK dry run and a
backup of the league tables) and C1 and I1 in parallel; D1-D5 after Marcos picks
designs; I2 batches last. Every client change ships to web (Vercel) and over the air
to the three Android runtimes; C1's intent filter waits for the next APK.

## Verification

- Smoke SQL per migration in `supabase/tests/` (the `RAISE` summary trick).
- Jest for every pure module; lint.
- Web walkthrough per UI item on the production build (`npm run build:web`) with
  throwaway QA users, light and dark, phone width.
- Hosted DB checks after apply: existing cards keep their status; standings of the
  live league recomputed in Stableford and compared by hand with the cards.

## Existing data

- Cards already confirmed keep their stored `points` only after the server recomputes
  them (B1 backfill); any card whose recomputed points differ is listed in the PR.
- `participation_points` defaults to 10 for existing leagues.
- Cards of a closed month (R12) are untouched.
