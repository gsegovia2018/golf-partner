# Sync v2 — Live Schema Facts

Task 1 of the sync-v2 normalized-schema plan. Pure recon: no DDL, no writes,
no deletes — every query below is a `SELECT` against `information_schema` /
`pg_policies` or a read-only `tournaments` select, run against the **live**
production DB via the Supabase Management API
(`POST /v1/projects/{ref}/database/query`).

Scripts: `scripts/sync-v2/db.mjs`, `scripts/sync-v2/inspect-schema.mjs`,
`scripts/sync-v2/export-fixtures.mjs`.

---

## `information_schema.columns` for `tournaments` + `tournament_*`, and `pg_policies` for `tournaments`

Raw output of `node scripts/sync-v2/inspect-schema.mjs`, run 2026-07-11 (server time
2026-07-11T21:57:40Z):

### `tournament_attestations`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | round_id | uuid | uuid | NO |  |
| 2 | roster_id | uuid | uuid | NO |  |
| 3 | attested_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_invites`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | bigint | int8 | NO | nextval('tournament_invites_id_seq'::regclass) |
| 2 | tournament_id | text | text | NO |  |
| 3 | code | text | text | NO |  |
| 4 | created_by | uuid | uuid | YES |  |
| 5 | created_at | timestamp with time zone | timestamptz | NO | now() |
| 6 | role | text | text | NO | 'editor'::text |
| 7 | expires_at | timestamp with time zone | timestamptz | YES |  |
| 8 | max_uses | integer | int4 | YES |  |
| 9 | uses | integer | int4 | NO | 0 |
| 10 | revoked | boolean | bool | NO | false |

### `tournament_media`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO |  |
| 2 | tournament_id | text | text | NO |  |
| 3 | round_id | text | text | NO |  |
| 4 | hole_index | integer | int4 | YES |  |
| 5 | kind | text | text | NO |  |
| 6 | storage_path | text | text | NO |  |
| 7 | thumb_path | text | text | NO |  |
| 8 | duration_s | numeric | numeric | YES |  |
| 9 | caption | text | text | YES |  |
| 10 | uploader_label | text | text | YES |  |
| 11 | created_at | timestamp with time zone | timestamptz | NO | now() |
| 12 | uploader_id | uuid | uuid | YES |  |

### `tournament_members`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | tournament_id | text | text | NO |  |
| 2 | user_id | uuid | uuid | NO |  |
| 3 | role | text | text | NO | 'viewer'::text |
| 4 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_notifications`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | tournament_id | text | text | NO |  |
| 3 | round_id | uuid | uuid | YES |  |
| 4 | kind | text | text | NO |  |
| 5 | body | text | text | NO |  |
| 6 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_participants`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | tournament_id | text | text | NO |  |
| 2 | user_id | uuid | uuid | NO |  |
| 3 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_parties`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | round_id | uuid | uuid | NO |  |
| 3 | tournament_id | text | text | NO |  |
| 4 | number | integer | int4 | NO |  |
| 5 | locked | boolean | bool | NO | false |

### `tournament_party_members`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | party_id | uuid | uuid | NO |  |
| 2 | roster_id | uuid | uuid | NO |  |
| 3 | seat | integer | int4 | NO |  |
| 4 | marks_roster_id | uuid | uuid | YES |  |
| 5 | pair_id | text | text | YES |  |

### `tournament_roster`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | tournament_id | text | text | NO |  |
| 3 | display_name | text | text | NO |  |
| 4 | handicap | numeric | numeric | NO | 0 |
| 5 | magic_token | text | text | NO |  |
| 6 | user_id | uuid | uuid | YES |  |
| 7 | withdrawn | boolean | bool | NO | false |
| 8 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_rounds`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | tournament_id | text | text | NO |  |
| 3 | round_index | integer | int4 | NO |  |
| 4 | course | jsonb | jsonb | NO | '{}'::jsonb |
| 5 | format | text | text | NO | 'stableford'::text |
| 6 | status | text | text | NO | 'setup'::text |
| 7 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_score_audit`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | round_id | uuid | uuid | NO |  |
| 3 | hole | integer | int4 | NO |  |
| 4 | subject_roster_id | uuid | uuid | NO |  |
| 5 | source | text | text | NO |  |
| 6 | strokes | integer | int4 | YES |  |
| 7 | author_roster_id | uuid | uuid | NO |  |
| 8 | created_at | timestamp with time zone | timestamptz | NO | now() |

### `tournament_scores`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | uuid | uuid | NO | gen_random_uuid() |
| 2 | round_id | uuid | uuid | NO |  |
| 3 | hole | integer | int4 | NO |  |
| 4 | subject_roster_id | uuid | uuid | NO |  |
| 5 | source | text | text | NO |  |
| 6 | author_roster_id | uuid | uuid | NO |  |
| 7 | strokes | integer | int4 | YES |  |
| 8 | updated_at | timestamp with time zone | timestamptz | NO | now() |

### `tournaments`

| ordinal_position | column_name | data_type | udt_name | is_nullable | column_default |
| --- | --- | --- | --- | --- | --- |
| 1 | id | text | text | NO |  |
| 2 | name | text | text | NO |  |
| 3 | created_at | timestamp with time zone | timestamptz | NO | now() |
| 4 | data | jsonb | jsonb | NO |  |
| 5 | created_by | uuid | uuid | YES |  |
| 6 | kind | text | text | NO | 'casual'::text |

### RLS policies on `tournaments`

| policyname | permissive | roles | cmd | qual | with_check |
| --- | --- | --- | --- | --- | --- |
| allow_all | PERMISSIVE | {public} | ALL | true | true |
| tournaments_delete | PERMISSIVE | {authenticated} | DELETE | (created_by = auth.uid()) |  |
| tournaments_insert | PERMISSIVE | {authenticated} | INSERT |  | ((created_by = auth.uid()) OR (created_by IS NULL)) |
| tournaments_select | PERMISSIVE | {authenticated} | SELECT | ((created_by = auth.uid()) OR (created_by IS NULL) OR is_tournament_member(id, auth.uid()) OR can_view_tournament_via_friend(id, auth.uid())) |  |
| tournaments_update | PERMISSIVE | {authenticated} | UPDATE | can_edit_tournament(id, auth.uid()) | can_edit_tournament(id, auth.uid()) |

---

## Decisions

1. **`tournaments.id` is `text`, confirmed.** Every existing FK that points at
   it (`tournament_invites.tournament_id`, `tournament_media.tournament_id`,
   `tournament_members.tournament_id`, `tournament_notifications.tournament_id`,
   `tournament_participants.tournament_id`, `tournament_parties.tournament_id`,
   `tournament_roster.tournament_id`, and the migration source for those
   tables) is also `text`. **Task 2's `game_*` tables must FK to
   `tournaments(id)` as `text`, not `uuid`** — the app generates ids
   client-side as `String(Date.now())` (see fixture ids below, e.g.
   `1783584580051`), not as UUIDs.

2. **The existing `tournament_*` tables are NOT the new sync-v2 schema.**
   They were created by `20260517000001_official_tournaments.sql` for
   **official tournaments only** (`tournament_roster`, `tournament_rounds`,
   `tournament_parties`, `tournament_party_members`, `tournament_scores`,
   `tournament_score_audit`, `tournament_attestations`,
   `tournament_notifications`), plus a few unrelated features
   (`tournament_media`, `tournament_members`, `tournament_participants`,
   `tournament_invites`). Per the plan's global constraints, the new
   normalized tables for **casual** tournaments (this plan's actual target)
   are named `game_*` (`game_players`, `game_rounds`, `game_scores`,
   `game_shot_details`, `game_round_notes`) specifically to avoid colliding
   with this pre-existing `tournament_*` family. Task 2 should treat the two
   families as orthogonal — do not reuse or alter the `tournament_*` tables.

3. **Drift found — stray permissive RLS policy on `tournaments`.** Besides
   the four expected owner/member policies
   (`tournaments_select/insert/update/delete`, all scoped to
   `{authenticated}`), the live table also carries an `allow_all` policy:
   `PERMISSIVE`, role `{public}` (i.e. including **unauthenticated**
   requests), `cmd = ALL`, `USING (true)`, `WITH CHECK (true)`. This is not
   created by any migration in `supabase/migrations/` — it predates the
   migrations directory (most likely a leftover from the table's original
   ad-hoc creation in the Supabase SQL editor, before RLS hardening
   happened). Since Postgres OR's together all applicable `PERMISSIVE`
   policies, `allow_all` means the four named policies are currently
   **inert** — any client (anon or authenticated) can already
   select/insert/update/delete any row in `tournaments`. This is a
   pre-existing production security gap, out of scope for Task 1 (read-only
   recon), but **Task 2 should not assume `tournaments_select/insert/
   update/delete` are actually enforced today**, and whoever owns
   production security should drop `allow_all` once the `game_*`
   RPCs/policies are live and verified (tracked as a follow-up, not blocking
   this plan).

4. **`.env` variable name differs from the plan's global constraint.** The
   plan text says "`.env` holds `SUPABASE_MANAGEMENT_API_TOKEN`", but the
   actual `.env` in this worktree stores the Management API PAT as
   `SUPABASE_ACCESS_TOKEN` (the name the Supabase CLI itself reads).
   `scripts/sync-v2/db.mjs` reads `SUPABASE_ACCESS_TOKEN` first, falling
   back to `SUPABASE_MANAGEMENT_API_TOKEN` if present, so later tasks can
   use either name without code changes.

5. **`dotenv` is not a direct dependency.** It resolves in `node_modules`
   only as a transitive/hoisted package (not listed in `package.json`), and
   the brief's own guidance was to avoid relying on an undeclared package.
   `db.mjs` therefore does not `import 'dotenv/config'` — it parses `.env`
   itself with an ~20-line inline reader (split on first `=`, strip matching
   quotes, skip keys already set in `process.env`). No new npm dependency
   was added.

6. **`id` vs `created_at` can diverge.** Tournament `id` is a client-side
   `Date.now()` timestamp string set once at creation, while `created_at` is
   the server's `INSERT` time (default `now()`). Two rows can have
   `created_at` values that don't sort the same way their `id`s would (a
   device with clock skew, or a later sync of an earlier local write, can
   invert the order). Confirmed concretely: the two "weekend" rows below
   share the identical `created_at` (`2026-07-09 08:09:40.051+00`) down to
   the millisecond despite different `id`s — see fixture note 2 below. Any
   later task ordering by recency should use `created_at`, not `id`.

---

## Fixtures

`node scripts/sync-v2/export-fixtures.mjs` selected these from a widened
candidate set (see note 1 below), sanity-checked (`rounds[]`/`players[]`
present, JSON parses) and written to
`src/store/__tests__/fixtures/syncV2/`:

| file | tournament id | name | rounds | why picked |
| --- | --- | --- | --- | --- |
| `fixture-1780068305375.json` | `1780068305375` | Golf Lerma · 29 May | 2 | **Finished multi-round.** `finishedAt` set (`2026-05-31T08:13:55.829Z`). |
| `fixture-1782401157973.json` | `1782401157973` | Real Club de Golf Lom… · 25 Jun | 1 | **Has shotDetails/notes.** Round scores include per-hole `shotDetails`. |
| `fixture-1783584580051.json` | `1783584580051` | Weekend Golf | 3 | **The live weekend tournament** — this weekend's trip (see note 2). |
| `fixture-1783716675062.json` | `1783716675062` | Golf Torrequebrada · 10 Jul | 1 | **Single-round game.** Most recently created single-round casual game. |

### Note 1 — widened the candidate query beyond `LIMIT 12`

The brief's base query
(`ORDER BY created_at DESC LIMIT 12`) surfaces 12 rows, none of which is a
**finished** multi-round tournament — the two most recent multi-round
tournaments (the live weekend trip and its QA clone, see note 2) are both
still in progress. `export-fixtures.mjs` widened the same query to
`LIMIT 60` (33 rows currently match `data IS NOT NULL AND data != '{}'::jsonb`
in total) purely to find a real finished multi-round example
(`Golf Lerma · 29 May`, 2 rounds, `finishedAt` set). The other three fixtures
all come from within the original top-12 window. No writes; still a plain
`SELECT`.

### Note 2 — identifying "the live weekend tournament"

Applying the brief's heuristic literally (most recently created non-official
tournament with a 3-round blob) selects a tournament named **"QA Duel Rand"**
(`id=1783730416554`), not the real trip. Inspecting the data:

- `QA Duel Rand` and `Weekend Golf` (`id=1783584580051`) share the **exact
  same `created_at`** (`2026-07-09 08:09:40.051+00`), down to the
  millisecond — `QA Duel Rand` is a test clone created by the recent duel-
  randomizer verification work (see commits `800fb53`/`688e2bb`), not a
  second real trip.
- The other 3-round candidate, `Weekend Golf` (`id=1783530337143`), has a
  player list seeded with a `qa-prm-<timestamp>` name — also QA fixture data.
- `Weekend Golf` (`id=1783584580051`) has four real friend-group player
  names (Marcos, Alex, Guille, Noé) with real `user_id`/`avatar_url` values
  and none of the `qa-`/`verify-` naming markers seen on the QA rows.

`export-fixtures.mjs` therefore excludes any tournament whose name matches
`/\bqa\b/i` or whose player list has a name starting with `qa-`/`verify-`
before picking "most recent 3-round non-official" — landing on
`fixture-1783584580051.json` as the real live weekend tournament. That file
also happens to satisfy the "shotDetails/notes" criterion (its round 0 has
per-hole `shotDetails`), so a second, independent shotDetails/notes example
(`fixture-1782401157973.json`) was picked to keep the four fixtures
representing four distinct real tournaments.

### Fixture content note

Fixtures are raw production blobs and therefore contain real (if
first-name-only) player names, real player `id`/`user_id` UUIDs, and
Supabase Storage `avatar_url`s (already public via the `avatars` bucket's
public-read policy — no signed/private URLs). This matches the brief's
intent (real data for round-trip fidelity in later tasks) for a small
private friend-group app; there is no PII beyond first names/nicknames.

---

## Commands run

```
node scripts/sync-v2/inspect-schema.mjs
node scripts/sync-v2/export-fixtures.mjs
```

Both are read-only: `inspect-schema.mjs` runs two `SELECT`s
(`information_schema.columns`, `pg_policies`); `export-fixtures.mjs` runs one
`SELECT ... FROM tournaments ...` (no `INSERT`/`UPDATE`/`DELETE`/DDL anywhere
in either script).
