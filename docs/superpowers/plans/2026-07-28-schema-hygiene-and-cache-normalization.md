# Schema Hygiene + Client Cache Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the denormalized leftovers sync-v2 left behind (duplicated player identity, embedded player copies in `round.pairs`, the dead `tournaments.data` blob), then begin normalizing the client-side cache so `saveLocal` stops rewriting one atomic JSON object.

**Architecture:** Batch 1 (Tasks 1–3) makes the *columns* authoritative and the JSONB bodies pure payload, projecting identity out of columns inside `get_game_tournament` so no client shape changes. Batch 2 (Tasks 4–5) splits the local AsyncStorage blob into per-entity parts behind the existing `readLocal`/`saveLocal` interface, so a realtime row event writes only its own part instead of the whole tournament.

**Tech Stack:** Supabase Postgres (SQL migrations under `supabase/migrations/`), React Native 0.81 / Expo SDK 54, Jest (jest-expo), AsyncStorage.

## Global Constraints

- Migrations live in `supabase/migrations/` named `YYYYMMDDHHMMSS_<slug>.sql`, are **idempotent** (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS`), and carry a `HOW TO RUN` + `VERIFY` comment block at the bottom, matching the existing files.
- Migrations reach production by pasting into the Supabase SQL editor. There is no automated migration runner. Apply and verify each one before starting the task that depends on it.
- `npm test` must be green after every task. `npm run lint` must report **0 errors** (warnings are pre-existing and tolerated).
- Domain logic lives in `src/store/`, not in screens (`CLAUDE.md`).
- Every commit ends with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Work in a git worktree **outside** the repo (e.g. `~/.config/superpowers/worktrees/golf-partner/<branch>`), symlink `node_modules`, copy `.env`. Nested worktrees under the repo get picked up by Jest and ESLint.
- **Backward compatibility with installed Android builds is required.** There is no OTA; the four users run whatever APK they last installed. Every change here either keeps the emitted `get_game_tournament` shape byte-identical (Task 1) or removes fields that every consumer already reads through a roster lookup (Task 2). Verified 2026-07-28 — do not weaken this without re-checking.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20260728000000_player_identity_from_columns.sql` | Project `id`/`user_id` from `game_players` columns in `get_game_tournament`; stop the claim/release body dual-write; add the body-id CHECK constraint | 1 |
| `supabase/migrations/20260728000001_thin_round_pairs.sql` | Rewrite existing `game_rounds.body->'pairs'` to id-only members | 2 |
| `supabase/migrations/20260728000002_drop_legacy_tournaments_data.sql` | Drop `backfill_game_tournament`, remove the legacy mirrors, drop `tournaments.data` | 3 |
| `src/store/scoring.js` | Add `thinPairs` beside the other pair builders | 2 |
| `src/store/tournamentStore.js` | Apply `thinPairs` at every site that assigns `round.pairs`; route persistence through the part cache | 2, 4 |
| `src/store/tournamentRepo.js` | Thin pairs at the write boundary; stop writing the `data` blob | 2, 3 |
| `src/store/tournamentCache.js` | **New.** Part-scoped local persistence: split/assemble, read, write-changed-parts | 4 |
| `src/store/realtimeSync.js` | Document and pin that row handlers now write one part | 5 |

---

## Task 1: Make the player-identity columns authoritative

`game_players` stores `player_id` and `user_id` both as columns **and** inside `body`. That duplication is why `claim_tournament_player` has to `jsonb_set` the body and update the column in one statement, and why an id-less body was representable at all (the column is `NOT NULL DEFAULT '{}'` and there is no CHECK — verified 2026-07-28: only a PK and an FK exist on the table).

Fix: `get_game_tournament` projects identity **out of the columns** into each emitted player, so `body` becomes pure payload. The emitted shape stays byte-identical — `user_id` is added only when non-null, matching what bodies carry today.

**Files:**
- Create: `supabase/migrations/20260728000000_player_identity_from_columns.sql`
- Test: `src/store/__tests__/playerIdentityProjection.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `get_game_tournament(p_id text) RETURNS jsonb` — unchanged signature, unchanged output shape. `claim_tournament_player(text, text) RETURNS text` and `release_tournament_player(text, text) RETURNS void` keep their signatures; they stop writing `body`.

- [ ] **Step 1: Check for rows that would violate the new constraint**

Run against production via the Management API (0 expected — verified 2026-07-28):

```sql
SELECT tournament_id, player_id, body->>'id' AS body_id
  FROM public.game_players
 WHERE body->>'id' IS DISTINCT FROM player_id;
```

Expected: 0 rows. **If any rows come back, repair them before continuing:**

```sql
UPDATE public.game_players
   SET body = body || jsonb_build_object('id', player_id)
 WHERE body->>'id' IS DISTINCT FROM player_id;
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260728000000_player_identity_from_columns.sql`:

```sql
-- ============================================================================
-- Player identity comes from the COLUMNS, not from body.
--
-- game_players stored player_id and user_id twice: as columns and inside the
-- body jsonb. The duplication forced claim/release to dual-write body, and
-- because body is NOT NULL DEFAULT '{}' with no CHECK, an id-less body was a
-- legal row. A realtime consumer that trusted body for the id therefore got a
-- player with no id -- nameless in the roster, and DUPLICATED by the next
-- event because it could no longer be matched (fixed client-side at 8548493;
-- this closes it at the source).
--
-- get_game_tournament now projects id/user_id from the columns. The emitted
-- shape is UNCHANGED: user_id is added only when non-null, exactly as bodies
-- carry it today, so already-installed builds see no difference.
--
-- Idempotent (CREATE OR REPLACE / IF EXISTS); safe to re-run.
-- ============================================================================

-- 1) Constraint: body's id must agree with the primary key. NOT VALID keeps
--    the DDL non-blocking; VALIDATE then checks the (small) existing table.
ALTER TABLE public.game_players
  DROP CONSTRAINT IF EXISTS game_players_body_id_matches;
ALTER TABLE public.game_players
  ADD CONSTRAINT game_players_body_id_matches
  CHECK (body->>'id' = player_id) NOT VALID;
ALTER TABLE public.game_players
  VALIDATE CONSTRAINT game_players_body_id_matches;

-- 2) Read path: project identity from the columns. ONLY the 'players'
--    aggregate changes; every other line is verbatim from
--    20260712000000_sync_v2_normalized.sql.
CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t   record;
  v_out jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_out := v_t.props || jsonb_build_object(
    'id', v_t.id, 'name', v_t.name,
    'kind', COALESCE(v_t.props->>'kind', v_t.kind),
    'createdAt', to_char(v_t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- id ALWAYS from the column. user_id added ONLY when non-null, so an
    -- unclaimed slot still has NO user_id key (not a null-valued one) and the
    -- emitted object matches today byte for byte.
    'players', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN gp.user_id IS NULL
             THEN (gp.body - 'user_id') || jsonb_build_object('id', gp.player_id)
             ELSE gp.body || jsonb_build_object('id', gp.player_id,
                                                'user_id', gp.user_id::text)
        END
        ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp WHERE gp.tournament_id = p_id), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(
        (gr.body - 'notes')
        || jsonb_build_object('id', gr.id)
        || jsonb_build_object('scores', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT s.player_id, jsonb_object_agg(s.hole::text, s.strokes) AS per
               FROM public.game_scores s
               WHERE s.round_id = gr.id AND s.tournament_id = gr.tournament_id AND s.strokes IS NOT NULL
               GROUP BY s.player_id) q), '{}'::jsonb))
        || jsonb_build_object('shotDetails', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT d.player_id, jsonb_object_agg(d.hole::text, d.detail) AS per
               FROM public.game_shot_details d
               WHERE d.round_id = gr.id AND d.tournament_id = gr.tournament_id AND d.detail IS NOT NULL
               GROUP BY d.player_id) q), '{}'::jsonb))
        || COALESCE((
             SELECT jsonb_build_object('notes',
               COALESCE((SELECT jsonb_build_object('round', n.note)
                         FROM public.game_round_notes n
                         WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key = 'round' AND n.note IS NOT NULL), '{}'::jsonb)
               || COALESCE((SELECT jsonb_build_object('hole', jsonb_object_agg(n.hole_key, n.note))
                            FROM public.game_round_notes n
                            WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key <> 'round' AND n.note IS NOT NULL
                            HAVING count(*) > 0), '{}'::jsonb))
             WHERE EXISTS (SELECT 1 FROM public.game_round_notes n2
                           WHERE n2.round_id = gr.id AND n2.tournament_id = gr.tournament_id AND n2.note IS NOT NULL)), '{}'::jsonb)
        ORDER BY gr.round_index, gr.id)
      FROM public.game_rounds gr WHERE gr.tournament_id = p_id), '[]'::jsonb));

  IF v_t.current_round IS NOT NULL THEN
    v_out := (v_out - 'currentRound') || jsonb_build_object('currentRound', v_t.current_round);
  ELSE
    v_out := v_out - 'currentRound';
  END IF;
  RETURN v_out;
END $$;

-- 3) Write path: the column is the source of truth, so stop touching body.
--    Everything else (auth checks, FOR UPDATE lock, legacy data mirror) is
--    verbatim from 20260713010000_claim_release_from_game_players.sql.
CREATE OR REPLACE FUNCTION public.claim_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_gp_user uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT user_id INTO v_gp_user
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  IF v_gp_user IS NOT NULL AND v_gp_user <> v_uid THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  -- Column only: get_game_tournament projects user_id from here.
  UPDATE public.game_players
     SET user_id    = v_uid,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- Legacy data mirror (removed entirely in 20260728000002).
  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text, 'user_id'],
                              to_jsonb(v_uid::text), true)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_claimer uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT user_id INTO v_claimer
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  UPDATE public.game_players
     SET user_id    = NULL,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text],
                              ((v_data -> 'players' -> v_idx) - 'user_id'), false)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   -- constraint present and validated
   SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid = 'public.game_players'::regclass
      AND conname = 'game_players_body_id_matches';

   -- a claimed slot still emits user_id; an unclaimed one still OMITS the key
   SELECT p->>'id' AS id, p ? 'user_id' AS has_user_id
     FROM jsonb_array_elements(
            public.get_game_tournament('<a tournament id>')->'players') p;
   =========================================================================== */
```

- [ ] **Step 3: Apply the migration and run the VERIFY block**

Paste into the Supabase SQL editor, Run, then run both VERIFY queries.
Expected: `convalidated = true`; a claimed slot shows `has_user_id = true`, an unclaimed slot `false`.

- [ ] **Step 4: Write the client-side regression test**

The client contract is "identity survives even if body lies". Create
`src/store/__tests__/playerIdentityProjection.test.js`:

```js
// The server now projects id/user_id from the game_players COLUMNS
// (migration 20260728000000), and the realtime patcher anchors on
// row.player_id. Both layers must agree that the column wins over body.
import { applyPlayerRow } from '../realtimeSync';

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(), saveLocal: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

describe('player identity is column-derived', () => {
  test('a body whose id disagrees with the row PK does not win', () => {
    const t = { id: 't1', players: [{ id: 'p1', name: 'Yeyen' }], rounds: [] };
    const out = applyPlayerRow(t, {
      tournament_id: 't1',
      player_id: 'p2',
      pos: 1,
      body: { id: 'WRONG', name: 'Labarga' },
    }, 'INSERT');

    expect(out.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('repeated events for one player never grow the roster', () => {
    let t = { id: 't1', players: [{ id: 'p1', name: 'Yeyen' }], rounds: [] };
    for (const body of [{ name: 'Labarga' }, { id: 'WRONG', name: 'Labarga' }]) {
      t = applyPlayerRow(t, { tournament_id: 't1', player_id: 'p2', pos: 1, body }, 'UPDATE');
    }
    expect(t.players).toHaveLength(2);
    expect(t.players[1].id).toBe('p2');
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx jest src/store/__tests__/playerIdentityProjection.test.js`
Expected: PASS. (The client half already shipped at `8548493`; this pins it against regression alongside the server change.)

- [ ] **Step 6: Run the full suite and lint**

Run: `npx jest && npx eslint src supabase`
Expected: all suites pass; 0 errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260728000000_player_identity_from_columns.sql \
        src/store/__tests__/playerIdentityProjection.test.js
git commit -m "$(cat <<'EOF'
refactor(db): derive player identity from columns, not body

game_players stored player_id/user_id twice -- as columns and inside the
body jsonb -- so claim/release had to dual-write body, and an id-less body
was a legal row (NOT NULL DEFAULT '{}', no CHECK). That is what let a
nameless player into the roster and then duplicated them.

get_game_tournament now projects id/user_id out of the columns, so body is
pure payload. Emitted shape is unchanged: user_id is added only when
non-null, exactly as bodies carry it today, so installed builds see no
difference. A CHECK constraint makes a disagreeing body unrepresentable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Store ids in `round.pairs`, not whole player objects

`round.pairs` embeds full player objects (`id`, `name`, `handicap`, `user_id`, `gender`, `avatar_url`). Measured on production 2026-07-28: **143 embedded copies, 14 already carrying a stale `user_id`** versus the roster.

A scan of all 19 files that read `pairs` found **no consumer that reads a member's `name`/`handicap`/`user_id` directly** — every one either uses `p.id`, or resolves through the roster with the embedded value as a dead fallback (`scrambleUnits` at `scoring.js:697` does `byId[m.id] ?? m`; `nameFor` at `editTeams/EditTeamsView.js:84` does `players?.find(...)?.name ?? p.name`). So thinning members to `{ id }` needs **no consumer changes and stays backward compatible with installed builds.**

**Files:**
- Modify: `src/store/scoring.js` (add `thinPairs` after `buildTeamsForMode`, ~line 500)
- Modify: `src/store/tournamentStore.js:707, 947, 949, 1045, 1047, 1112, 1114` (the sites that assign `round.pairs`)
- Modify: `src/store/tournamentRepo.js:23-28` (`stripRoundHotKeys` — thin at the write boundary as a backstop)
- Create: `supabase/migrations/20260728000001_thin_round_pairs.sql`
- Test: `src/store/__tests__/thinPairs.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `thinPairs(pairs)` exported from `src/store/scoring.js` and re-exported from `src/store/tournamentStore.js` (which already re-exports the rest of the scoring API — see its "Re-export the pure scoring/handicap math" import block). Signature: takes `Array<Array<{id: string, ...}>>`, returns `Array<Array<{id: string}>>`; non-array input passes through unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/thinPairs.test.js`:

```js
import { thinPairs } from '../scoring';

describe('thinPairs', () => {
  test('reduces each member to its id', () => {
    const pairs = [
      [{ id: 'a', name: 'Ann', handicap: 12, user_id: 'u1' }, { id: 'b', name: 'Bo' }],
      [{ id: 'c', name: 'Cy', avatar_url: null }],
    ];
    expect(thinPairs(pairs)).toEqual([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]);
  });

  test('is idempotent', () => {
    const thin = [[{ id: 'a' }, { id: 'b' }]];
    expect(thinPairs(thinPairs(thin))).toEqual(thin);
  });

  test('passes through non-array input untouched', () => {
    expect(thinPairs(undefined)).toBeUndefined();
    expect(thinPairs(null)).toBeNull();
  });

  test('does not mutate its input', () => {
    const pairs = [[{ id: 'a', name: 'Ann' }]];
    thinPairs(pairs);
    expect(pairs[0][0].name).toBe('Ann');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/store/__tests__/thinPairs.test.js`
Expected: FAIL — `thinPairs is not a function`.

- [ ] **Step 3: Implement `thinPairs`**

In `src/store/scoring.js`, directly after `buildTeamsForMode`:

```js
// Pairs persist ids ONLY. They used to embed whole player objects, which went
// stale the moment a player was claimed, renamed, or re-handicapped (measured
// 2026-07-28: 14 of 143 embedded copies carried a user_id that disagreed with
// game_players). Every consumer already resolves members through the roster --
// scrambleUnits' `byId[m.id] ?? m`, EditTeamsView's `nameFor` -- so dropping
// the extra fields only removes the dead fallback, and an older installed
// build still renders names correctly.
//
// The team BUILDERS above still take and return whole player objects;
// thinning happens where pairs are assigned to a round, so pair construction
// keeps working on rich objects.
export function thinPairs(pairs) {
  if (!Array.isArray(pairs)) return pairs;
  return pairs.map((team) => (
    Array.isArray(team) ? team.map((p) => ({ id: p?.id })) : team
  ));
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/store/__tests__/thinPairs.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export from tournamentStore and apply at every assignment site**

In `src/store/tournamentStore.js`, add `thinPairs` to the existing `import { ... } from './scoring'` block and to its re-export list.

Then wrap each of the seven assignment sites:

```js
// ~line 707, the reveal patch
const patched = { ...round, pairs: thinPairs(nextPairs ?? round.pairs) };

// ~lines 947 and 1045, the fixedTeams shape-cache reads
pairs = thinPairs(fixedPairsByShape.get(shape).map((pr) => [...pr]));

// ~line 1112, the mode-change fixedTeams read (reads `fixedPairs`, not the map)
pairs = thinPairs(fixedPairs.map((pr) => [...pr]));

// ~lines 949, 1047, 1114 -- wrap the builder call results, args unchanged
pairs = thinPairs(buildPairsForAddedPlayer({ /* args unchanged */ }));
pairs = thinPairs(buildPairsForRemovedPlayer({ /* args unchanged */ }));
pairs = thinPairs(buildPairsForModeChange({ /* args unchanged */ }));
```

- [ ] **Step 6: Thin at the write boundary as a backstop**

In `src/store/tournamentRepo.js`, change `stripRoundHotKeys` so no rich pair can reach the server even from a code path added later:

```js
function stripRoundHotKeys(round) {
  const {
    scores, shotDetails, notes, scoreEntries, scoreResolutions, removedPlayerIds, ...body
  } = round;
  // Defense in depth: pairs persist ids only (see scoring.js thinPairs). The
  // assignment sites in tournamentStore already thin; this catches any future
  // caller that builds a round body without going through them. Lazy require
  // matches the module's existing cycle-avoidance style.
  const { thinPairs } = require('./scoring');
  return 'pairs' in body ? { ...body, pairs: thinPairs(body.pairs) } : body;
}
```

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: all suites pass. Watch `addPlayerRoundPatches.test.js`,
`removePlayerRoundPatches.test.js`, `setScoringModeRoundPatches.test.js` and
`EditTeamsScreen.test.js` — if any assert on embedded member fields inside an
expected `pairs` value, update those expectations to `{ id }`. That is the
intended behaviour change, not a regression.

- [ ] **Step 8: Write the data migration**

Create `supabase/migrations/20260728000001_thin_round_pairs.sql`:

```sql
-- ============================================================================
-- round.pairs stores ids only.
--
-- pairs embedded whole player objects, which drift: measured 2026-07-28,
-- 14 of 143 embedded copies carried a user_id that disagreed with
-- game_players. Every client consumer resolves members through the roster
-- already (scrambleUnits' `byId[m.id] ?? m`, EditTeamsView's `nameFor`), so
-- the embedded fields were a dead -- but lie-prone -- fallback.
--
-- Backward compatible with installed builds: an older client reading a thinned
-- pair still resolves names and handicaps from the roster.
--
-- Idempotent: re-running over already-thinned pairs is a no-op.
-- ============================================================================

UPDATE public.game_rounds gr
   SET body = jsonb_set(gr.body, '{pairs}', COALESCE((
         SELECT jsonb_agg(COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', pl->>'id'))
                    FROM jsonb_array_elements(team) pl
                ), '[]'::jsonb))
           FROM jsonb_array_elements(gr.body->'pairs') team
       ), '[]'::jsonb))
 WHERE gr.body ? 'pairs'
   AND jsonb_typeof(gr.body->'pairs') = 'array'
   AND jsonb_array_length(gr.body->'pairs') > 0;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT count(*) AS members,
          count(*) FILTER (
            WHERE pl ?| ARRAY['name','handicap','user_id','gender','avatar_url']
          ) AS still_rich
     FROM public.game_rounds gr,
          LATERAL jsonb_array_elements(COALESCE(gr.body->'pairs','[]'::jsonb)) team,
          LATERAL jsonb_array_elements(team) pl;
   -- expected: still_rich = 0
   =========================================================================== */
```

- [ ] **Step 9: Apply the migration and run the VERIFY block**

Expected: `still_rich = 0`; `members` ≈ 143 (higher if rounds were added since).

- [ ] **Step 10: Lint and commit**

```bash
npx eslint src supabase
git add src/store/scoring.js src/store/tournamentStore.js src/store/tournamentRepo.js \
        src/store/__tests__/thinPairs.test.js \
        supabase/migrations/20260728000001_thin_round_pairs.sql
git commit -m "$(cat <<'EOF'
refactor(store): persist ids in round.pairs, not whole player objects

pairs embedded full player objects, which drift: 14 of 143 embedded copies
on prod carried a user_id disagreeing with game_players. No consumer read
those fields -- all 19 files that touch pairs use p.id or resolve through
the roster with the embedded copy as a dead fallback -- so thinning removes
a lie without changing behaviour, and older installed builds still resolve
names from the roster.

Team builders keep working on rich objects; thinning happens where pairs are
assigned to a round, with a backstop in stripRoundHotKeys.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Drop the legacy `tournaments.data` blob

`tournaments.data` is the pre-sync-v2 blob. Nothing reads it as a source of truth. Verified on production 2026-07-28: **no RLS policy, no index and no view depends on it**; the only trigger on `tournaments` is `tournaments_created_by_immutable`, which does not touch it. Three functions reference it — `backfill_game_tournament` (the one-time blob → normalized backfill, obsolete) and the "best effort legacy mirror" blocks in claim/release. The client writes it in exactly one place, only because the column is `NOT NULL` (`tournamentRepo.js:260`).

Ship the code change **before** dropping the column, so a rollback at any point leaves a working system.

**Files:**
- Modify: `src/store/tournamentRepo.js:253-271` (stop writing `data`)
- Create: `supabase/migrations/20260728000002_drop_legacy_tournaments_data.sql`
- Test: `src/store/__tests__/tournamentRepo.test.js` (extend)

**Interfaces:**
- Consumes: `claim_tournament_player` / `release_tournament_player` as rewritten in Task 1 — this task deletes their trailing legacy-mirror blocks and nothing else.
- Produces: `createTournament` no longer emits a `data` key in its `tournaments` upsert row.

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/tournamentRepo.test.js`, inside the existing top-level `describe`, following the file's established supabase-mock style:

```js
  test('createTournament does not write the legacy data blob', async () => {
    const upsert = jest.fn(() => Promise.resolve({ error: null }));
    const { supabase } = require('../../lib/supabase');
    supabase.from.mockImplementation((table) => (
      table === 'tournaments'
        ? { upsert }
        : { upsert: jest.fn(() => Promise.resolve({ error: null })) }
    ));

    const repo = require('../tournamentRepo');
    await repo.createTournament({
      id: 't1', name: 'Saturday', kind: 'game',
      createdAt: '2026-07-28T10:00:00.000Z',
      currentRound: 0, players: [], rounds: [],
    });

    expect(upsert).toHaveBeenCalled();
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('data');
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/store/__tests__/tournamentRepo.test.js -t 'legacy data blob'`
Expected: FAIL — the row still carries `data`.

- [ ] **Step 3: Stop writing the blob**

In `src/store/tournamentRepo.js`, delete the `const data = { ... }` line together with its ten-line explanatory comment (lines ~253-260), and remove `data,` from `tournamentRow`:

```js
  const tournamentRow = {
    id,
    name,
    kind: kind === 'official' ? 'official' : 'casual',
    created_at: createdAt,
    props,
    current_round: currentRound ?? null,
  };
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/store/__tests__/tournamentRepo.test.js -t 'legacy data blob'`
Expected: PASS.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20260728000002_drop_legacy_tournaments_data.sql`:

```sql
-- ============================================================================
-- Drop the pre-sync-v2 tournaments.data blob.
--
-- Since sync-v2 the roster/rounds live in game_players/game_rounds and
-- get_game_tournament assembles from those. data was kept alive only because
-- the column is NOT NULL (so createTournament had to write a placeholder --
-- omitting it raised 23502, which the drain dropped as permanent, and no new
-- game reached the server) and because claim/release mirrored into it
-- best-effort.
--
-- Verified 2026-07-28 on prod: no RLS policy, index or view depends on the
-- column; the only trigger on tournaments (tournaments_created_by_immutable)
-- does not read it.
--
-- Ordering matters: the functions that reference data are replaced FIRST, so
-- the column drop cannot fail on a dependency.
--
-- Idempotent (CREATE OR REPLACE / IF EXISTS); safe to re-run.
-- ============================================================================

-- 1) The one-time blob -> normalized backfill has done its job.
DROP FUNCTION IF EXISTS public.backfill_game_tournament(text);

-- 2) claim/release: drop the legacy mirror blocks. Identical to the versions
--    in 20260728000000 minus the tournaments.data reads/writes.
CREATE OR REPLACE FUNCTION public.claim_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_gp_user uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT user_id INTO v_gp_user
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  IF v_gp_user IS NOT NULL AND v_gp_user <> v_uid THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  UPDATE public.game_players
     SET user_id    = v_uid,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_claimer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT user_id INTO v_claimer
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  UPDATE public.game_players
     SET user_id    = NULL,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;

-- 3) Relax first, so an in-flight old client that already stopped sending data
--    keeps working between this migration and the column drop.
ALTER TABLE public.tournaments ALTER COLUMN data DROP NOT NULL;

-- 4) Drop the column.
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS data;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run AFTER the tournamentRepo.js
   change has shipped. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT count(*) AS data_column_still_present
     FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'data';
   -- expected: 0

   SELECT p.proname::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~* '(v_data|SET data|data *->)';
   -- expected: only notification functions (they use notifications.data)
   =========================================================================== */
```

- [ ] **Step 6: Run the full suite and lint**

Run: `npx jest && npx eslint src supabase`
Expected: all pass, 0 errors.

- [ ] **Step 7: Commit, apply the migration, then create a real game**

```bash
git add src/store/tournamentRepo.js src/store/__tests__/tournamentRepo.test.js \
        supabase/migrations/20260728000002_drop_legacy_tournaments_data.sql
git commit -m "$(cat <<'EOF'
refactor(db): drop the pre-sync-v2 tournaments.data blob

Nothing read it as a source of truth since sync-v2 -- verified no policy,
index, view or trigger depends on it. It survived only because the column
was NOT NULL (forcing createTournament to write a placeholder) and because
claim/release mirrored into it best-effort. Both mirrors and the obsolete
backfill_game_tournament go with it.

Client change ships first; the column drop is safe to apply after.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then apply the migration, run both VERIFY queries, and **create one real game in the app**. This is the exact path that broke with 23502 before (see the comment being deleted in `tournamentRepo.js`), so confirm the insert succeeds and the game appears on Home.

---

## Task 4 (Batch 2 start): Part-scoped local cache behind `readLocal`/`saveLocal`

`saveLocal` serializes the **entire** tournament to one AsyncStorage key (`tournamentStore.js:472-491`). That is why every writer is a whole-object read-modify-write, why two concurrent writers lose each other's work, and why the fix at `8548493` needed a cross-module mutex. Splitting the persisted form into parts lets a realtime row event write only its own part.

This task is the enabling refactor and is **behaviour-preserving**: `readLocal`/`saveLocal` signatures do not change and the whole existing suite must stay green.

**Files:**
- Create: `src/store/tournamentCache.js`
- Modify: `src/store/tournamentStore.js:412-504` (the persistence block) and `deleteTournament` (~541-562)
- Test: `src/store/__tests__/tournamentCache.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces, from `src/store/tournamentCache.js`:
  - `splitTournament(t)` → `{ meta, players, rounds, roundOrder }` where `meta` is the tournament minus `players`/`rounds`, `players` is the roster array, `rounds` is `Record<roundId, roundObject>`, `roundOrder` is `string[]`
  - `assembleTournament(parts)` → the tournament object; exact inverse of `splitTournament`; returns `null` for null input
  - `readParts(id)` → `Promise<parts | null>`
  - `writeParts(id, parts)` → `Promise<string[]>`, the storage keys actually written
  - `removeParts(id)` → `Promise<void>`
  - `_resetWriteCache()` → `void` (test seam)
  - Key scheme: `@gt/<id>/meta`, `@gt/<id>/players`, `@gt/<id>/round/<roundId>`, `@gt/<id>/order`

- [ ] **Step 1: Write the failing round-trip test**

Create `src/store/__tests__/tournamentCache.test.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  splitTournament, assembleTournament, readParts, writeParts, _resetWriteCache,
} from '../tournamentCache';

const FIXTURE = {
  id: 't1',
  name: 'Saturday',
  kind: 'game',
  currentRound: 0,
  meId: 'p1',
  players: [{ id: 'p1', name: 'Yeyen' }, { id: 'p2', name: 'Labarga' }],
  rounds: [
    { id: 'r0', holes: [{ number: 1, par: 4 }], scores: { p1: { 1: 4 } }, shotDetails: {} },
    { id: 'r1', holes: [{ number: 1, par: 3 }], scores: {}, shotDetails: {} },
  ],
};

describe('tournamentCache', () => {
  beforeEach(() => {
    AsyncStorage.clear();
    _resetWriteCache();
  });

  test('split then assemble round-trips exactly', () => {
    expect(assembleTournament(splitTournament(FIXTURE))).toEqual(FIXTURE);
  });

  test('round order survives the round-trip', () => {
    const back = assembleTournament(splitTournament(FIXTURE));
    expect(back.rounds.map((r) => r.id)).toEqual(['r0', 'r1']);
  });

  test('writeParts then readParts round-trips through storage', async () => {
    await writeParts('t1', splitTournament(FIXTURE));
    expect(assembleTournament(await readParts('t1'))).toEqual(FIXTURE);
  });

  test('readParts returns null when nothing is stored', async () => {
    expect(await readParts('nope')).toBeNull();
  });

  test('writing one round touches only that round key', async () => {
    const parts = splitTournament(FIXTURE);
    await writeParts('t1', parts);
    const next = {
      ...parts,
      rounds: { ...parts.rounds, r1: { ...parts.rounds.r1, scores: { p2: { 1: 3 } } } },
    };
    expect(await writeParts('t1', next)).toEqual(['@gt/t1/round/r1']);
  });

  test('an unchanged write touches nothing', async () => {
    await writeParts('t1', splitTournament(FIXTURE));
    expect(await writeParts('t1', splitTournament(FIXTURE))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/store/__tests__/tournamentCache.test.js`
Expected: FAIL — cannot find module `../tournamentCache`.

- [ ] **Step 3: Implement `tournamentCache.js`**

Create `src/store/tournamentCache.js`:

```js
// Part-scoped persistence for one tournament.
//
// tournamentStore used to serialize the WHOLE tournament to a single
// AsyncStorage key on every write. That made every writer a read-modify-write
// over the entire object, so two concurrent writers lost each other's work --
// the race behind the roster flicker fixed at 8548493, which needed a
// cross-module mutex to contain. Splitting the persisted form lets a realtime
// row event write only the part it touched.
//
// Parts:
//   meta            -- the tournament minus players/rounds (name, kind,
//                      settings, currentRound, meId, finishedAt, ...)
//   players         -- the roster array
//   round/<roundId> -- one key per round; the hot path for score writes
//   order           -- round ids in array order. Rounds are ordered by ARRAY
//                      POSITION (see get_game_tournament's `ORDER BY
//                      round_index, id`), so the order has to be stored
//                      separately from the per-round keys.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@gt';
const metaKey = (id) => `${PREFIX}/${id}/meta`;
const playersKey = (id) => `${PREFIX}/${id}/players`;
const orderKey = (id) => `${PREFIX}/${id}/order`;
const roundKey = (id, roundId) => `${PREFIX}/${id}/round/${roundId}`;

export function splitTournament(t) {
  const { players, rounds, ...meta } = t ?? {};
  const roundList = Array.isArray(rounds) ? rounds : [];
  return {
    meta,
    players: Array.isArray(players) ? players : [],
    rounds: Object.fromEntries(roundList.map((r) => [r.id, r])),
    roundOrder: roundList.map((r) => r.id),
  };
}

export function assembleTournament(parts) {
  if (!parts) return null;
  const { meta, players, rounds, roundOrder } = parts;
  return {
    ...meta,
    players,
    // Drop ids the order references but that have no stored body -- a
    // half-written cache must not surface an undefined round to consumers
    // that read round.holes unguarded.
    rounds: (roundOrder ?? []).map((rid) => rounds?.[rid]).filter(Boolean),
  };
}

export async function readParts(id) {
  const [[, metaRaw], [, playersRaw], [, orderRaw]] = await AsyncStorage.multiGet(
    [metaKey(id), playersKey(id), orderKey(id)],
  );
  if (metaRaw == null) return null;
  const roundOrder = orderRaw ? JSON.parse(orderRaw) : [];
  const roundEntries = roundOrder.length
    ? await AsyncStorage.multiGet(roundOrder.map((rid) => roundKey(id, rid)))
    : [];
  const rounds = {};
  const roundPrefix = `${PREFIX}/${id}/round/`;
  for (const [key, raw] of roundEntries) {
    if (raw == null) continue;
    rounds[key.slice(roundPrefix.length)] = JSON.parse(raw);
  }
  return {
    meta: JSON.parse(metaRaw),
    players: playersRaw ? JSON.parse(playersRaw) : [],
    rounds,
    roundOrder,
  };
}

// Per-key JSON comparison -- the same trick saveLocal used at whole-blob
// granularity (_lastWrittenJson), kept because an identity write still emits a
// change event and drives a reload. At part granularity it also becomes the
// mechanism that keeps a score write from rewriting the roster.
const _lastWritten = new Map();

export async function writeParts(id, parts) {
  const pending = [
    [metaKey(id), JSON.stringify(parts.meta ?? {})],
    [playersKey(id), JSON.stringify(parts.players ?? [])],
    [orderKey(id), JSON.stringify(parts.roundOrder ?? [])],
    ...Object.entries(parts.rounds ?? {}).map(
      ([rid, round]) => [roundKey(id, rid), JSON.stringify(round)],
    ),
  ];
  const changed = pending.filter(([key, json]) => _lastWritten.get(key) !== json);
  if (changed.length) {
    await AsyncStorage.multiSet(changed);
    for (const [key, json] of changed) _lastWritten.set(key, json);
  }
  // A round dropped from the order leaves its key orphaned; remove it so a
  // later re-add cannot resurrect a stale body.
  const live = new Set((parts.roundOrder ?? []).map((rid) => roundKey(id, rid)));
  const stale = [..._lastWritten.keys()].filter(
    (k) => k.startsWith(`${PREFIX}/${id}/round/`) && !live.has(k),
  );
  if (stale.length) {
    await AsyncStorage.multiRemove(stale);
    for (const k of stale) _lastWritten.delete(k);
  }
  return changed.map(([key]) => key);
}

export async function removeParts(id) {
  const keys = [...new Set([
    metaKey(id), playersKey(id), orderKey(id),
    ...[..._lastWritten.keys()].filter((k) => k.startsWith(`${PREFIX}/${id}/`)),
  ])];
  await AsyncStorage.multiRemove(keys);
  for (const k of keys) _lastWritten.delete(k);
}

// Test seam: the module-level write cache would otherwise leak between Jest
// cases that share a module registry.
export function _resetWriteCache() {
  _lastWritten.clear();
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/store/__tests__/tournamentCache.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Route `readLocal` / `saveLocal` through the parts, keeping a legacy read**

In `src/store/tournamentStore.js`, add to the imports:

```js
import {
  splitTournament, assembleTournament, readParts, writeParts, removeParts,
} from './tournamentCache';
```

Then replace the bodies of `saveLocal` and `readLocal`. Keep `_localTournamentCache`, `_activeTournamentId`, the finished/active handling and the change emit exactly as they are — only the persistence mechanics change:

```js
export async function saveLocal(tournament, options = {}) {
  const { makeActive = true } = options ?? {};
  const finished = isTournamentFinished(tournament);
  const shouldWriteActive = makeActive && !finished && _activeTournamentId !== tournament.id;
  if (makeActive && !finished) _activeTournamentId = tournament.id;
  if (finished && _activeTournamentId === tournament.id) _activeTournamentId = null;
  _localTournamentCache.set(tournament.id, cloneTournament(tournament));
  const activeCleared = finished
    ? await clearActiveTournamentIfMatches(tournament.id, { emit: false })
    : false;
  // Only the parts that actually changed hit storage -- a score write no
  // longer rewrites the roster and every other round.
  const written = await writeParts(tournament.id, splitTournament(tournament));
  if (shouldWriteActive) await AsyncStorage.setItem(ACTIVE_ID_KEY, tournament.id);
  if (written.length === 0 && !shouldWriteActive && !activeCleared) return;
  _emitChange(tournament.id);
}

export async function readLocal(id) {
  if (_localTournamentCache.has(id)) {
    return cloneTournament(_localTournamentCache.get(id));
  }
  const parts = await readParts(id);
  if (parts) {
    const assembled = assembleTournament(parts);
    _localTournamentCache.set(id, assembled);
    return cloneTournament(assembled);
  }
  // Legacy single-blob key, written by builds from before the split. Read it,
  // migrate it into parts, and never write it again. Installed APKs still
  // write this key, so it must stay readable while any device runs an older
  // build.
  const raw = await AsyncStorage.getItem(ACTIVE_TOURNAMENT_KEY + id);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    _localTournamentCache.set(id, parsed);
    await writeParts(id, splitTournament(parsed));
    return cloneTournament(parsed);
  } catch { return null; }
}
```

- [ ] **Step 6: Point `deleteTournament` at `removeParts` and delete the dead map**

In `deleteTournament`, replace `await AsyncStorage.removeItem(ACTIVE_TOURNAMENT_KEY + id);` with:

```js
  // Clear both the part keys and the legacy blob key -- a tournament first
  // cached by an older build has both.
  await removeParts(id);
  await AsyncStorage.removeItem(ACTIVE_TOURNAMENT_KEY + id);
```

Then delete the now-unused `_lastWrittenJson` map: its declaration (~line 470, with the comment block above it) and the `_lastWrittenJson.delete(id)` call in `deleteTournament`. `writeParts` owns that responsibility now.

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: all 240+ suites pass. `loadTournamentCached.test.js`,
`tournamentStoreSync.test.js`, `activeTournamentSnapshot.test.js` and
`liveSyncStorm.test.js` are load-bearing — they exercise readLocal/saveLocal
directly. If a test asserts on the raw `@golf_tournament_<id>` key, rewrite it
to assert through `readLocal`; the storage layout is an implementation detail
now.

- [ ] **Step 8: Lint and commit**

```bash
npx eslint src
git add src/store/tournamentCache.js src/store/tournamentStore.js \
        src/store/__tests__/tournamentCache.test.js
git commit -m "$(cat <<'EOF'
refactor(store): persist tournaments as parts instead of one blob

saveLocal serialized the entire tournament to a single AsyncStorage key, so
every writer was a read-modify-write over the whole object and two concurrent
writers lost each other's work -- the race behind the roster flicker, which
needed a cross-module mutex to contain.

The persisted form is now meta / players / round-per-key / order, and
saveLocal writes only the parts that changed. readLocal still returns the
assembled object, so no caller changes; a legacy single-blob key is read once
and migrated, since installed builds still write it.

Behaviour-preserving groundwork: the mutex stays until the row handlers and
the refresh path are both part-scoped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 (Batch 2): Pin that a realtime row writes one part

With Task 4 in place, a `game_scores` row event writes just `@gt/<id>/round/<roundId>` instead of the whole tournament. Pin that property so a later change to `writeParts`' change detection cannot silently restore the whole-blob write.

Keep the mutex. It stays correct and cheap, and the refresh path still replaces every part at once; removing it is a later task once all writers are part-scoped.

**Files:**
- Modify: `src/store/realtimeSync.js` (the comment above `makeHandler`, added at `8548493`)
- Test: `src/store/__tests__/liveSyncStorm.test.js` (extend)

**Interfaces:**
- Consumes: `writeParts` / `splitTournament` from Task 4.
- Produces: no new exports. `makeHandler`'s observable behaviour is unchanged; only the number of storage keys it writes changes.

- [ ] **Step 1: Write the test**

Append to `src/store/__tests__/liveSyncStorm.test.js`:

```js
describe('realtime row writes are part-scoped', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('a score row rewrites only its own round key', async () => {
    jest.doMock('../../lib/supabase', () => supabaseStub);
    jest.doMock('../syncQueue', () => ({
      syncQueue: { all: jest.fn(() => Promise.resolve([])) },
    }));

    const { saveLocal, readLocal } = require('../tournamentStore');
    const { applyScoreRow } = require('../realtimeSync');
    const { writeParts, splitTournament } = require('../tournamentCache');

    const t = tournamentFixture();
    t.rounds.push({
      id: 'r1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: {}, shotDetails: {},
    });
    await saveLocal(t);

    const cached = await readLocal('t1');
    const patched = applyScoreRow(cached, {
      round_id: 'r1', tournament_id: 't1', player_id: 'p2', hole: 1, strokes: 5,
    }, 'UPDATE');

    expect(await writeParts('t1', splitTournament(patched))).toEqual(['@gt/t1/round/r1']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest src/store/__tests__/liveSyncStorm.test.js -t 'part-scoped'`
Expected: PASS — this pins the property Task 4 delivers. If it FAILS, Task 4's
`writeParts` change detection is wrong; fix that before continuing.

- [ ] **Step 3: Update the handler comment**

In `src/store/realtimeSync.js`, replace the paragraph above `makeHandler` that was added at `8548493`:

```js
// The row-handler read-modify-write runs under the SHARED per-tournament
// mutex (tournamentMutex.js). Since the local cache is stored as parts
// (tournamentCache.js), a row event's saveLocal only rewrites the part it
// touched -- a game_scores row rewrites one round key, not the roster and
// every other round. The mutex is STILL required: the refresh path replaces
// every part at once from a server snapshot, so it and a row handler can
// still interleave destructively. It comes out once every writer is
// part-scoped.
```

- [ ] **Step 4: Run the full suite and lint**

Run: `npx jest && npx eslint src`
Expected: all pass, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/realtimeSync.js src/store/__tests__/liveSyncStorm.test.js
git commit -m "$(cat <<'EOF'
test(sync): pin that a realtime score row writes one round key

With the part-scoped cache in place, a game_scores row event rewrites only
its own round key instead of the whole tournament. Pin that property so a
future change to writeParts' change detection cannot silently restore the
whole-blob write.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Not in this plan

Deliberately deferred, in the order they would come next:

1. **Removing the mutex.** Only correct once the refresh path also writes parts selectively — diffing the server snapshot against the cached parts rather than replacing all of them. That is the real end of Batch 2.
2. **Dropping the assembled-blob read interface.** `readLocal` still returns one assembled object, so screens re-render on any part change. Making screens subscribe to individual parts is a much larger UI change.
3. **Retiring `get_game_tournament`'s blob shape** in favour of an incremental "changes since `<timestamp>`" endpoint. This would cut the payload of the remaining polls, but it is an API redesign, not hygiene.
4. **The sync worker's post-drain reconcile fetch** (~1 `get_game_tournament` per local write, measured 2026-07-28). Pre-existing and out of scope here.
