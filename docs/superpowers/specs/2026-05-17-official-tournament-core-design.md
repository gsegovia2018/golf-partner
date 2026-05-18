# Official Tournament Core — Design Spec

**Date:** 2026-05-17
**Status:** Approved (design)
**Scope:** Spec 1 of 3 — see "Decomposition" below.

## Summary

Add an "Official Tournament" mode to the golf app. An admin creates an
official tournament, builds a roster of players, and invites them via
per-player magic links. Players play without logging in — the link is
their identity. Players are organized into parties (~4) per round. Within
a party, markers are assigned round-robin: every player records their own
card *and* their markee's card, so each score is captured twice. Disagreement
between the two entries surfaces as a discrepancy; a round can only finalize
when every discrepancy is resolved. On finalization the round locks and the
admin is notified.

This spec covers the **Core**: tournament type, roster, identity, parties,
markers, dual-entry scoring, discrepancy detection/resolution, attestation,
locking, and a basic field leaderboard.

## Decomposition

The full "official tournament app" vision is delivered as three specs, each
with its own brainstorm → spec → plan → build cycle:

- **Spec 1 — Official Tournament Core** *(this document)* — type, roster,
  magic links + identity, parties, round-robin markers, dual-entry scoring,
  discrepancy detection + resolution, attest/lock/notify, basic field
  leaderboard, local rules & notes.
- **Spec 2 — Tournament Operations** *(deferred)* — flights/divisions,
  tee sheet / start times, prizes + tie-break countback, results export.
- **Spec 3 — Live & Spectators** *(deferred)* — public spectator
  leaderboard link, side games, admin live progress view.

Specs 2 and 3 layer onto Core without changing its data model.

## Goals

- An admin can run a small-club official tournament (≤24 players) end to end.
- Players join and score with no account and no friction — just a link.
- Every score is independently double-entered and cross-checked.
- A round cannot be finalized while any discrepancy is unresolved.
- Reuse the existing scorecard, leaderboard, scoring math, sync queue, and
  invite/role infrastructure. Casual tournaments are completely unchanged.

## Non-goals (Core)

- Flights/divisions, tee times, prizes, countback, results export (Spec 2).
- Public spectator link, side games, live progress dashboard (Spec 3).
- Push notifications (in-app status only).
- Field sizes above ~24 players.
- DQ/no-return prize handling (Core only needs "withdraw so the round closes").

## Architecture decisions

### A1 — Official is a new type on the shared engine
`tournaments` gains a `kind` column (`'casual'` default | `'official'`).
Casual tournaments keep the JSONB blob and all current behavior. Official
tournaments use the blob only for config (name, dates, rules text); all
scoring lives in new relational tables. The scoring **math** (`scoring.js`)
is shared by both.

### A2 — Per-cell score rows, not a blob
The dual-entry marker model guarantees that multiple devices write scores
for the same round simultaneously (A enters B's card while B enters their
own). The blob + whole-blob merge model would clobber on every hole.

Official scores are therefore stored as relational rows: one row per
`(round, hole, subject_player, source)` where `source ∈ {self, marker}`.
Concurrent writes never collide because they target different rows. A
discrepancy is simply two rows that disagree.

### A3 — Guests write through token-validated RPCs
Guests are not authenticated Supabase users, so RLS cannot cover them. All
guest reads and writes go through `SECURITY DEFINER` Postgres functions that
take the player's `magic_token`, validate that the token's player is allowed
to perform the exact operation, and then act. `tournament_scores` accepts no
direct client writes.

### A4 — Extend the scorecard, do not replace it
Official scoring reuses `ScorecardScreen` (hole + grid views, hero-card
steppers, celebrations, media, sync indicator). Official mode adds: per-card
write permission, a discrepancy badge, a storage adapter, and an attest
action. Casual mode is unchanged.

## Data model

`tournaments` — add `kind text NOT NULL DEFAULT 'casual'`.

New tables (Postgres / Supabase):

| Table | Key columns | Purpose |
|---|---|---|
| `tournament_roster` | `id`, `tournament_id`, `display_name`, `handicap`, `magic_token` (unique), `user_id` (nullable), `withdrawn` (bool) | One row per player. `magic_token` is the link credential. `user_id` is set when an app account opens the link. |
| `tournament_rounds` | `id`, `tournament_id`, `round_index`, `course` (jsonb), `format` (`gross_net`\|`stableford`\|`pairs`\|`match`), `status` (`setup`\|`live`\|`locked`) | One row per round. |
| `tournament_parties` | `id`, `round_id`, `tournament_id`, `number` | Groups of ~4, per round. |
| `tournament_party_members` | `party_id`, `roster_id`, `seat` (int), `marks_roster_id`, `pair_id` (nullable) | Player ↔ party. `seat` defines round-robin order; `marks_roster_id` is who this player marks (round-robin default, admin-overridable); `pair_id` groups pairs for pair formats. |
| `tournament_scores` | `id`, `round_id`, `hole`, `subject_roster_id`, `source` (`self`\|`marker`), `author_roster_id`, `strokes`, `updated_at` — unique `(round_id, hole, subject_roster_id, source)` | The per-cell score rows. Two rows per player per hole. |
| `tournament_score_audit` | `id`, `round_id`, `hole`, `subject_roster_id`, `source`, `strokes`, `author_roster_id`, `created_at` | Append-only history of every value written — powers discrepancy history and the audit trail. |
| `tournament_attestations` | `round_id`, `roster_id`, `attested_at` | One row per player per round when they attest their card. |
| `tournament_notifications` | `id`, `tournament_id`, `round_id`, `kind`, `body`, `created_at` | In-app admin notifications (party locked, round locked). |

RLS: existing `authenticated` policies cover the admin (tournament owner)
for all new tables. `tournament_scores` has no client INSERT/UPDATE policy —
writes only via the RPCs in A3.

## Identity & magic links

Each `tournament_roster` row has a unique `magic_token`. The admin shares one
link per player. Opening the link:

1. The app stores the token on-device and binds this device to that roster
   player. No login required.
2. If a signed-in app account is present on the device, `roster.user_id` is
   set to that account so the round flows into its stats/history.

A link opened on two devices binds both to the same player; both may write
that player's `self` cells (same person — acceptable). The admin can
regenerate a token if a link leaks.

## Token-validated RPCs

`SECURITY DEFINER` Postgres functions, all taking `magic_token`:

- `redeem_token(token)` → roster player + tournament/round context.
- `get_round_state(token, round_id)` → parties, party members, all score
  cells the caller is allowed to see, discrepancy status, attestations.
- `submit_score(token, round_id, hole, subject_roster_id, source, strokes)` —
  validates: `source = 'self'` ⇒ `subject = token player`; `source = 'marker'`
  ⇒ `subject = token player's markee`. Writes the `tournament_scores` row and
  appends to `tournament_score_audit`.
- `attest_card(token, round_id)` — allowed only when the caller's card has
  zero open discrepancies; writes `tournament_attestations`.

Admin actions (admin is `authenticated`, uses ordinary authed mutations or
admin-scoped RPCs): create roster, generate/regenerate tokens, organize
parties, assign/override markers, start round, force-resolve a discrepancy,
force-finalize a party, withdraw a player.

## Admin flow

Official tournaments have their own **dedicated setup screen**
(`OfficialCreateScreen`), separate from the casual `SetupScreen` wizard.
Tapping **New Tournament** presents a Casual / Official choice; choosing
Official opens the dedicated screen. `SetupScreen` stays purely casual
(New Game / New Tournament).

1. **Official setup screen** — a self-contained stepped flow
   `Roster → Rounds → Format → Review`. The Roster step lets the admin add
   named players (`display_name` + `handicap`) inline — no library picker,
   since roster players need not be app users. The Rounds step sets a course
   per round; the Format step picks one of the four official formats. Review
   creates the tournament with `kind = official`, one `tournament_roster` row
   per entry (each gets a `magic_token`), and the `tournament_rounds`, then
   opens the management screen.
2. **Official tournament management screen** — the post-creation home for an
   existing official tournament: the roster with each player's invite link
   (copy / QR — QR lib already in deps), regenerate-token, withdraw, add a
   late entrant; the rounds list; and free-text **local rules & notes**
   (format notes, tee info, local rules).
3. **Party & Marker board** (per round) — assign players to parties via
   Manual drag / Auto-by-handicap / Random. Auto-balance spreads handicaps
   across parties; for pair formats it balances on pair-average handicap.
   Markers are auto-assigned round-robin by seat; admin can override any marker.
4. **Start Round** — locks parties, sets round `status = live`, opens scoring.
5. Monitor party status; force-resolve / force-finalize / withdraw as needed.

## Player flow

1. Open magic link → bound to roster player.
2. Score in `ScorecardScreen` (official mode). The card shows every party
   member; only **your card** and **your markee** are editable, the rest
   render read-only.
3. Each hole's two entries (self + marker) are cross-checked. A per-card
   badge and a hole-strip dot show one of three states:
   - **agreed** — both entries exist and match.
   - **waiting** — only one entry exists so far.
   - **discrepancy** — both exist and disagree.
4. Tapping a discrepancy opens a compare view: your entry (editable) beside
   the other entry (read-only to you). It resolves automatically when the two
   values match. Both originals remain in `tournament_score_audit`.
5. **Attest my card** — enabled only at zero open discrepancies.

Any local rules & notes the admin wrote are shown to the player before the
round starts and remain available from the scorecard. They are stored in the
official tournament's config blob — no new table.

## Finalization, leaderboard & notifications

- A party locks when all its members have attested with zero discrepancies;
  its scores become read-only.
- The round `status` flips to `locked` when every party has locked.
- The admin can **force-resolve** a discrepancy (writes both rows, logged)
  and **force-finalize** a party (no-show / abandoned round).
- Notifications: a `tournament_notifications` row is written when a party
  locks and when the round locks. The admin's tournament screen shows live
  party status (`locked` / `N discrepancies open` / `scoring`), reusing the
  existing in-app conflict-log pattern. No push notifications in Core.
- The leaderboard reuses the existing tournament leaderboard component, fed
  from resolved `tournament_scores`. Gross / net / Stableford toggles per the
  round format.

## Offline & sync

Official score writes cannot require live network. `submit_score` calls go
through the app's existing offline queue (`syncQueue` / `syncWorker`): the
entry is written locally, queued, and drained on reconnect. Discrepancy state
is eventually-consistent — recomputed whenever both entries have landed. The
scorecard's existing "pending sync" indicator covers the queued state.

## Edge cases

- **Markee not yet scored** — `waiting`, not `discrepancy`.
- **Odd party size (3)** — round-robin still closes the loop.
- **Withdrawal / no-show** — admin sets `roster.withdrawn`; round-robin
  re-links so the withdrawn player's marker and markee are not stranded;
  finalization stops waiting on them.
- **Re-pairing after start** — parties lock at Start Round; only the admin
  can move a player afterward, which re-derives markers.
- **Concurrent edits** — per-cell rows mean collisions only ever occur on a
  single cell owned by one person; last-write-wins on that cell is acceptable.
- **Leaderboard ties** — shown as ties (countback is Spec 2).

## Testing (TDD)

Pure functions, tests first:
- Round-robin marker assignment from party seats.
- Party auto-balance by handicap; pair-average balance for pair formats.
- Discrepancy detection and the three-state (agreed/waiting/discrepancy) badge.
- Withdrawal re-linking of the round-robin chain.

Integration tests:
- Token-RPC authorization — every "can player X write cell Y" rule for
  `submit_score` and `attest_card`.

`scoring.js` math is already covered and unchanged.

## Reused infrastructure

- `ScorecardScreen` — hole/grid views, hero-card steppers, celebrations,
  media, sync indicator.
- Existing tournament leaderboard component.
- `scoring.js` — Stableford / match / pair math.
- `syncQueue` / `syncWorker` — offline write queue.
- `tournament_invites` / role infrastructure — admin ownership model.
- `react-native-qrcode-svg` — already a dependency, for link QR codes.
