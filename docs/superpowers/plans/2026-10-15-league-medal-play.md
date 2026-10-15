# League medal play

Status: approved 2026-10-15 (open questions answered below).

A league can be scored by **medal play** (strokes) as well as by net Stableford.
The wizard already has the Format field (#196, Stableford only); this adds the
two medal formats end to end.

## Decisions (owner, 2026-10-15)

- Formats: `stableford` (today), `medal_net`, `medal_gross`. The admin picks one.
- Medal months rank **against par**, lower wins: `net to par = gross − playing
  handicap − par`, `gross to par = gross − par`. Shown as `net −2` / `+4` /
  `E` (level). Fair across par-70 and par-72 courses; the playing handicap
  already carries slope and CR − par.
- A blank or **picked-up hole means the card doesn't count**.
- The format is **locked once the league has a card** (any status but void).
  Before that, the admin can change it in Settings.
- Season points per place, participation points, ties sharing the summed points
  and the month-close rules are unchanged. Only the month's ranking value and
  direction change.

## Answered questions (2026-10-15, all as proposed)

1. **Picking up in a medal league.** The app records a pick-up as a synthetic
   stroke count (`pickupStrokes` = par + 2 + extra shots, `scoring.js:346`).
   The server can't tell it from a real net double bogey. Proposal: when the
   round counts for a medal league, the scorecard **hides the pick-up action**
   (a note says "Medal league: hole out every hole"). A hole with no score
   still blocks Validate, so the card simply can't count. Hand-entered off-app
   cards already take only typed numbers. Gap: an old APK runtime with no
   league OTAs could still pick up. Accepted, since those runtimes no longer
   get league updates.
2. **Ties.** Keep today's rule (equal score = tie, summed points shared, no
   countback)? Proposal: yes, same as Stableford.
3. **Stats screen.** Its honours are per-hole Stableford (hot streaks, zero
   holes, 36+ bands). Proposal for v1: for medal leagues, show the season grid
   and rivals with to-par values, and hide the Stableford-only honours.

## Build items

| # | Item | Model |
|---|------|-------|
| M1 | Migration `20261020000000_league_medal_play.sql` (below) + smoke cases | Opus |
| M2 | Store: `leagueStore` mappers (`format`, `toPar`), `createLeague`/`updateLeagueRules` args, `leagueStandings.monthResults` ranking by format, `leagueView` strings (`formatScore`) | Opus |
| M3 | Screens: board, card, validate, home row, share/public board, grace banner, card action sheet, timeline, join/settings rules copy, wizard formats + review chip, hide cap row for gross | Sonnet |
| M4 | Scorecard: hide pick-up for medal-league rounds (`useScorecardLeague`) | Sonnet |
| M5 | Stats screen medal variant (per answer 3) | Sonnet |
| M6 | Push copy: `league_card_confirmed` shows the score by format (`_shared/notificationCopy.js` + `src/lib/notificationContent.js`), redeploy send-push | Sonnet |
| M7 | i18n en + es for all of the above | Haiku |

M1 → M2 → (M3, M4, M5, M6 in parallel) → M7 sweep. One PR per item group:
**PR A** = M1 + M2 (contract), **PR B** = M3–M7 (UI). The migration is applied
to the hosted DB only after PR A is approved, after a verified backup.

## M1 migration

- `leagues.format text NOT NULL DEFAULT 'stableford' CHECK (format IN
  ('stableford','medal_net','medal_gross'))`. Existing leagues stay Stableford.
- `league_cards.to_par int NULL`: the server's ranking value for medal
  leagues (NULL for Stableford leagues and unscored cards).
- `league_card_score` returns `par` too. New `league_card_to_par(score, format)`.
- `submit_league_card` and `add_unannounced_league_card` (current bodies in
  20261016000000) store `to_par` and return it. `points` stays computed for
  every card (cheap, and Stableford stats keep working if a league never
  changes).
- `create_league(..., p_format text DEFAULT 'stableford')` and
  `update_league_rules(..., p_format text DEFAULT NULL)`. The update refuses a
  change when the league has a non-void card: `ERRCODE P0001, HINT
  'format_locked'`. DROP + CREATE, and update the GRANT list (exact signatures).
- `get_league_by_code`, `get_league_invite_preview`, `get_marker_card` and
  `get_public_league_board` return `format`. The public board cards return
  `to_par` and order by format. Update the smoke keyset assertions.
- `league_confirm_card` notification data adds `format` and `to_par`.
- No backfill: every existing league is Stableford, so `to_par` stays NULL.
- Smoke (`league_server_scoring_smoke.sql`): net and gross to_par on a sample
  card, Stableford league leaves to_par NULL, format lock after a card, create
  with each format, bad format refused, grants on the new signatures.

## Verification

- Jest for the standings (ascending rank, ties, unranked), view strings and
  store mappers. Screen tests for the wizard formats.
- Smoke SQL dry-run in BEGIN/ROLLBACK on hosted, then apply after a backup of
  `leagues` + `league_cards`.
- Web walkthrough as QA users: create a medal-net league, two players post
  cards (one in the app, one off-app), board shows `net −2` ordering, the
  format is locked in Settings, a medal round has no pick-up button.
- OTA to f9a55c47 after fingerprint:compare. Redeploy send-push.
