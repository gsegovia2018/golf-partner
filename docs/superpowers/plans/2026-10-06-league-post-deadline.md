# League post deadline

Decided 2026-10-06 with Marcos. Builds on `2026-10-04-league.md`.

## Why

Announcing exists so a member commits to a round before playing it. Today
nothing makes them post afterwards: an announced card can be submitted at any
time while its month is open, and an unannounced card can be added later and
still counts. Both let a member play several rounds and post only the good one.

## Rules

| # | Rule |
|---|------|
| R1 | Announcing sets a tee day and time. The card must be **posted within 8 hours of the tee time** (fixed, not a league setting). `post_by = tee_time + 8 h`. App cards announce on Start, so their tee time is `now()`. |
| R2 | A card not posted by `post_by` becomes **`missed`**: no score, and it **still uses the month** (the member can't announce again). Replaces D1 ("not submitted by month end") with a much earlier cut. |
| R3 | **Reminder:** a push to the card's owner 2 hours before `post_by` while the card is still `announced`/`playing`. Type `league_post_reminder`, switchable in League settings like the others. |
| R4 | **No signal on the course:** an app card whose round `finishedAt` (client stamp, first write wins) is on or before `post_by`, and not before the round started, may still be submitted after the deadline, even once it is `missed`, for up to 24 h after `post_by`. Off-app cards are judged by the server clock only. |
| R4b | **Off-app cards** can't be announced with a tee time already past (15 min slack; a played round is an unannounced card) and can't be posted before their tee time. Their played date is the tee day. App cards' tee time is the server clock at Start. |
| R4c | **After the deadline a posted card is frozen**, unless a marker sent it back. A resubmission clears an admin's approval. |
| R5 | **Rescheduling:** the owner may change an off-app card's tee time until the original tee time passes. The new time must stay in the same month and season. `post_by` moves with it and the reminder re-arms. |
| R6 | **Reopen:** an admin may reopen a `missed` card (not their own). It goes back to `announced`/`playing` with `post_by = now() + 8 h`. |
| R7 | **Unannounced cards need an admin's approval.** A card with `not_announced = true` (added without announcing, or app card whose first shot came before the announcement) scores nothing until an admin approves it. An admin can't approve their own card. |
| R8 | **Existing data:** cards that exist when this ships have no deadline (`post_by` NULL). Existing `not_announced` cards are approved automatically. |

## Contract (shared by B1-B4)

- Columns: `post_by`, `reminded_at`, `approved_by`, `approved_at`; status `missed`.
- `submit_league_card` hints `post_deadline_passed`, `before_tee_time`; `announce_league_card` hint `tee_time_passed` (off-app, past tee time).
- `reschedule_league_card(p_card uuid, p_tee_time timestamptz)` → `{id, tee_time, post_by}`;
  hints `tee_time_passed`, `month_change`, `outside_season`, `not_offapp`, `not_open`.
- `reopen_league_card(p_card uuid)` → `{id, status, post_by}`; hints `not_missed`, `past_month`, `own_card` (42501 for non-admins).
- `approve_league_card(p_card uuid)` → `{id, approved_at}`; hints `not_needed`, `own_card` (42501 for non-admins).
- Notification `league_post_reminder` to the owner only: `data = {league_id, league_name, card_id, post_by, course_name, source, tournament_id, round_id}`.
- Clients treat a live card whose `post_by` has passed as missed, without waiting for the sweep.

## Design

Option B of https://claude.ai/artifact/E6Us5WaTcjAr6BeEK746bA, picked 2026-10-07: a shared
`DeadlineLine` (clock, "Post by 18:30", countdown, amber with words under 2 h), countdown in
the board rows' points column, bottom sheets for reschedule/reopen/approve that state the
consequence, an "Awaiting approval" board section. The Card screen opens status-only cards.

## Backend: one migration, `20261006000006_league_post_deadline.sql`

- `CREATE EXTENSION IF NOT EXISTS pg_cron` (available on the project, not installed today).
- `league_cards`: add `post_by timestamptz`, `reminded_at timestamptz`,
  `approved_by uuid → auth.users ON DELETE SET NULL`, `approved_at timestamptz`.
  Status CHECK gains `'missed'`. The one-card-per-month index (`status <> 'void'`) already counts `missed` cards as taken.
- Backfill per R8.
- `announce_league_card`: sets `post_by`.
- `submit_league_card`: refuses after `post_by` (hint `post_deadline_passed`) unless R4 applies; accepts `missed` only under R4.
- New RPCs, all `SECURITY DEFINER`, granted to `authenticated`:
  - `reschedule_league_card(p_card, p_tee_time)`: owner, R5.
  - `reopen_league_card(p_card)`: admin, R6.
  - `approve_league_card(p_card)`: admin, not the owner, R7.
- `league_sweep_cards()` (not granted to anyone), scheduled with
  `cron.schedule('league-sweep', '*/15 * * * *', ...)`:
  sends due reminders (sets `reminded_at`) and turns overdue cards `missed`.
  Notifications are rows in `public.notifications`; the existing database webhook sends the push.
- The 15-minute cron means a card can still look live for up to 15 minutes
  after its deadline. That's fine, because `submit` checks the deadline itself.

This is a cloud scheduling change (handbook: plan before infra). It runs inside
the database, with no new edge function and no new secret.

## Client

- `leagueStore`: map `postBy`, `approvedAt`, `approvedByName`; wrappers for the three RPCs;
  messages for `post_deadline_passed` and the reschedule errors.
- `leagueStandings.monthResults`: a `notAnnounced` card without `approvedAt` scores nothing.
- `leagueView.cardStatus`: a `missed` state ("Not posted"); the deadline on live cards;
  an "awaiting approval" flag.
- Screens (the design is picked first): Board month list, Card screen (deadline, reschedule, admin reopen/approve),
  Announce screen (the 8-hour rule up front), Add unannounced score (admin approval up front),
  League settings (new reminder switch).
- `notificationContent.js` + `supabase/functions/send-push/index.ts`: `league_post_reminder`
  (redeploy `send-push`).

## Build items

| # | Item | Model |
|---|------|-------|
| B1 | Migration + SQL dry-run of every path (BEGIN/ROLLBACK on the hosted DB) | Opus |
| B2 | Store, view, standings + Jest | Sonnet |
| B3 | Screens per the chosen design | Sonnet |
| B4 | Notification type: push copy, deep link, prefs row, send-push | Haiku |
| — | Review of B1 | Opus |

## Verification

- Jest + lint green; `npm run build:web`.
- SQL dry-run: announce → submit inside the window; submit after the deadline refused;
  R4 offline app card accepted; sweep sends one reminder and turns the card missed;
  reschedule after the tee time refused; reopen by a non-admin refused; approve own card refused.
- Web walkthrough on the static build, QA throwaway league only, as an admin and a member:
  announce shows the deadline; a card past its deadline reads "Not posted"; the admin reopens it;
  an unannounced card shows "awaiting approval" and leaves the standings until approved.
- After deploy: `cron.job` lists `league-sweep`; one QA card with `post_by` 2h out gets the reminder push.
