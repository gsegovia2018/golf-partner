# Official Tournament Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Official Tournament" mode where an admin runs a small-club tournament, players join via per-player magic links without logging in, and every score is double-entered (self + round-robin marker) with discrepancy detection before a round can be finalized.

**Architecture:** Official tournaments are a new `kind` on the existing `tournaments` table. Casual tournaments keep their JSONB blob untouched; official scores live in new relational per-cell tables so concurrent dual-entry never clobbers. Guests write through token-validated `SECURITY DEFINER` Postgres RPCs. The existing `ScorecardScreen` is extended (not replaced) with a storage adapter, per-card write permission, a discrepancy badge, and an attest action.

**Tech Stack:** Expo / React Native (+ react-native-web), Supabase (Postgres + RLS + RPC), Jest, AsyncStorage, existing `scoring.js` math and `syncQueue`/`syncWorker` offline queue.

**Spec:** `docs/superpowers/specs/2026-05-17-official-tournament-core-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/20260517_official_tournaments.sql` — schema, RLS, and token RPCs (one deployable unit).
- `src/store/officialScoring.js` — pure logic: round-robin markers, party auto-balance, discrepancy state, withdrawal re-link. No I/O, no imports from the app.
- `src/store/__tests__/officialScoring.test.js` — tests for the above.
- `src/store/officialToken.js` — magic-token persistence + `redeemToken` RPC wrapper.
- `src/store/officialStore.js` — player-side data layer: `getRoundState`, `submitScore`, `attestCard`, offline-queue integration.
- `src/store/officialAdmin.js` — admin-side data layer: create tournament, roster CRUD, token generation, party save, start round, force-resolve/finalize, withdraw.
- `src/store/__tests__/officialStore.test.js` — tests for queue payload shape + state derivation.
- `src/store/officialLeaderboard.js` — leaderboard reduction from relational scores.
- `src/store/__tests__/officialLeaderboard.test.js` — tests for the above.
- `src/screens/OfficialSetupScreen.js` — create official tournament + roster builder.
- `src/screens/PartyBoardScreen.js` — per-round party & marker organization.
- `src/screens/JoinOfficialScreen.js` — magic-link landing / redeem.
- `src/screens/OfficialAdminScreen.js` — admin monitor: party status + notifications.
- `src/components/DiscrepancySheet.js` — compare/resolve a flagged hole.
- `src/hooks/useOfficialRound.js` — subscribes a scorecard to official round state.

**Modified files:**
- `src/screens/ScorecardScreen.js` — add an official-mode data-source seam, per-card write permission, discrepancy badge, attest action.
- `src/store/syncQueue.js` / `src/store/syncWorker.js` — add an `rpc` queue-entry kind.
- `App.js` — register new routes + magic-link deep-link handling.
- `src/screens/HomeScreen.js` — entry point to create/open official tournaments.

---

## Phase 1 — Schema & RPCs

### Task 1: Database schema migration

**Files:**
- Create: `supabase/migrations/20260517_official_tournaments.sql`

SQL migrations in this repo are not unit-tested; they carry inline `VERIFY` blocks and are applied by hand in the Supabase SQL editor (see `20260418_add_users.sql` for the established pattern). This task writes the table DDL; Task 2 appends the RPCs to the same file.

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/20260517_official_tournaments.sql`:

```sql
-- ============================================================================
-- Official Tournament Core — schema.
-- Spec: docs/superpowers/specs/2026-05-17-official-tournament-core-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Tournament type. Casual is unchanged; official tournaments score
--    through the relational tables below instead of the JSONB blob.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'casual';

-- 2) Roster: one row per player in an official tournament.
CREATE TABLE IF NOT EXISTS public.tournament_roster (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  handicap      numeric NOT NULL DEFAULT 0,
  magic_token   text NOT NULL UNIQUE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  withdrawn     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3) Rounds (relational — casual rounds stay in the blob).
CREATE TABLE IF NOT EXISTS public.tournament_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_index   int NOT NULL,
  course        jsonb NOT NULL DEFAULT '{}'::jsonb,
  format        text NOT NULL DEFAULT 'stableford'
                  CHECK (format IN ('gross_net','stableford','pairs','match')),
  status        text NOT NULL DEFAULT 'setup'
                  CHECK (status IN ('setup','live','locked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round_index)
);

-- 4) Parties — groups of ~4, per round.
CREATE TABLE IF NOT EXISTS public.tournament_parties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  number        int NOT NULL,
  locked        boolean NOT NULL DEFAULT false,
  UNIQUE (round_id, number)
);

-- 5) Party members. seat defines round-robin order; marks_roster_id is who
--    this player marks (round-robin default, admin-overridable).
CREATE TABLE IF NOT EXISTS public.tournament_party_members (
  party_id        uuid NOT NULL REFERENCES public.tournament_parties(id) ON DELETE CASCADE,
  roster_id       uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  seat            int NOT NULL,
  marks_roster_id uuid REFERENCES public.tournament_roster(id) ON DELETE SET NULL,
  pair_id         text,
  PRIMARY KEY (party_id, roster_id)
);

-- 6) Per-cell score rows. Two per player per hole (self + marker).
CREATE TABLE IF NOT EXISTS public.tournament_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  hole              int NOT NULL CHECK (hole BETWEEN 1 AND 18),
  subject_roster_id uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('self','marker')),
  author_roster_id  uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  strokes           int CHECK (strokes IS NULL OR strokes BETWEEN 1 AND 20),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, hole, subject_roster_id, source)
);

-- 7) Append-only audit of every value written.
CREATE TABLE IF NOT EXISTS public.tournament_score_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  hole              int NOT NULL,
  subject_roster_id uuid NOT NULL,
  source            text NOT NULL,
  strokes           int,
  author_roster_id  uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 8) Attestations — one row per player per round.
CREATE TABLE IF NOT EXISTS public.tournament_attestations (
  round_id    uuid NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  roster_id   uuid NOT NULL REFERENCES public.tournament_roster(id) ON DELETE CASCADE,
  attested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, roster_id)
);

-- 9) In-app admin notifications.
CREATE TABLE IF NOT EXISTS public.tournament_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_id      uuid REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_tournament_idx     ON public.tournament_roster (tournament_id);
CREATE INDEX IF NOT EXISTS rounds_tournament_idx     ON public.tournament_rounds (tournament_id);
CREATE INDEX IF NOT EXISTS parties_round_idx         ON public.tournament_parties (round_id);
CREATE INDEX IF NOT EXISTS scores_round_idx          ON public.tournament_scores (round_id);
CREATE INDEX IF NOT EXISTS notifications_tourn_idx   ON public.tournament_notifications (tournament_id);

-- Row-level security. The admin (tournament owner) is an authenticated user.
-- Guests are NOT authenticated — they reach data only through the RPCs in
-- Task 2, so the score tables get owner-only policies and no guest policy.
ALTER TABLE public.tournament_roster        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_parties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_party_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_score_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_attestations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_notifications ENABLE ROW LEVEL SECURITY;

-- Owner-only policy helper: a row is admin-visible when its tournament is
-- owned by the caller. Applied per table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tournament_roster','tournament_rounds','tournament_parties','tournament_notifications'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_owner ON public.%I FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.tournaments tt
                        WHERE tt.id = %I.tournament_id AND tt.created_by = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments tt
                        WHERE tt.id = %I.tournament_id AND tt.created_by = auth.uid()))
    $p$, t, t, t, t);
  END LOOP;
END $$;

-- Child tables reached via round_id → round → tournament owner.
DROP POLICY IF EXISTS party_members_owner ON public.tournament_party_members;
CREATE POLICY party_members_owner ON public.tournament_party_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tournament_parties p
                   JOIN public.tournaments tt ON tt.id = p.tournament_id
                  WHERE p.id = tournament_party_members.party_id AND tt.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_parties p
                   JOIN public.tournaments tt ON tt.id = p.tournament_id
                  WHERE p.id = tournament_party_members.party_id AND tt.created_by = auth.uid()));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tournament_scores','tournament_score_audit','tournament_attestations'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_owner ON public.%I FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.tournament_rounds r
                         JOIN public.tournaments tt ON tt.id = r.tournament_id
                        WHERE r.id = %I.round_id AND tt.created_by = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM public.tournament_rounds r
                         JOIN public.tournaments tt ON tt.id = r.tournament_id
                        WHERE r.id = %I.round_id AND tt.created_by = auth.uid()))
    $p$, t, t, t, t);
  END LOOP;
END $$;

/* VERIFY
   SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'tournament_%';
   SELECT relname, relrowsecurity FROM pg_class
    WHERE relname LIKE 'tournament_%';
*/
```

- [ ] **Step 2: Verify the migration parses**

Apply the file in the Supabase SQL editor (or `psql -f`). Run the `VERIFY` block.
Expected: all eight `tournament_*` tables listed, `relrowsecurity = true` for each.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517_official_tournaments.sql
git commit -m "feat: official tournament schema migration"
```

---

### Task 2: Token-validated RPCs

**Files:**
- Modify: `supabase/migrations/20260517_official_tournaments.sql` (append)

- [ ] **Step 1: Append the RPC functions**

Append to `supabase/migrations/20260517_official_tournaments.sql`:

```sql
-- ============================================================================
-- Token-validated RPCs. Guests call these with their magic_token; the
-- function validates the exact operation before acting. SECURITY DEFINER so
-- they bypass RLS, but each one re-checks authorization itself.
-- ============================================================================

-- Resolve a token to its roster player + tournament context.
CREATE OR REPLACE FUNCTION public.redeem_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT ro.id, ro.display_name, ro.handicap, ro.tournament_id, ro.withdrawn
    INTO r FROM public.tournament_roster ro WHERE ro.magic_token = p_token;
  IF r.id IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  RETURN jsonb_build_object(
    'roster_id', r.id, 'display_name', r.display_name,
    'handicap', r.handicap, 'tournament_id', r.tournament_id,
    'withdrawn', r.withdrawn);
END $$;

-- Optional account linking: when an authenticated user opens a link, bind
-- the roster row to their account so the round reaches their history.
CREATE OR REPLACE FUNCTION public.link_token_to_user(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.tournament_roster
     SET user_id = auth.uid()
   WHERE magic_token = p_token AND user_id IS NULL;
END $$;

-- Full round state visible to the token holder: parties, members, scores,
-- attestations. Scores are returned for the caller's whole party.
CREATE OR REPLACE FUNCTION public.get_round_state(p_token text, p_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_party uuid;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT pm.party_id INTO v_party
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = v_roster AND pa.round_id = p_round_id;
  IF v_party IS NULL THEN RAISE EXCEPTION 'not in this round'; END IF;
  RETURN jsonb_build_object(
    'party_id', v_party,
    'my_roster_id', v_roster,
    'round', (SELECT to_jsonb(r) FROM public.tournament_rounds r WHERE r.id = p_round_id),
    'members', (SELECT jsonb_agg(jsonb_build_object(
                  'roster_id', pm.roster_id, 'seat', pm.seat,
                  'marks_roster_id', pm.marks_roster_id, 'pair_id', pm.pair_id,
                  'display_name', ro.display_name, 'handicap', ro.handicap,
                  'withdrawn', ro.withdrawn) ORDER BY pm.seat)
                FROM public.tournament_party_members pm
                JOIN public.tournament_roster ro ON ro.id = pm.roster_id
               WHERE pm.party_id = v_party),
    'scores', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'hole', s.hole, 'subject_roster_id', s.subject_roster_id,
                  'source', s.source, 'strokes', s.strokes)), '[]'::jsonb)
                FROM public.tournament_scores s
                WHERE s.round_id = p_round_id
                  AND s.subject_roster_id IN (
                    SELECT roster_id FROM public.tournament_party_members WHERE party_id = v_party)),
    'attestations', (SELECT COALESCE(jsonb_agg(a.roster_id), '[]'::jsonb)
                FROM public.tournament_attestations a WHERE a.round_id = p_round_id));
END $$;

-- Write one score cell. Validates: self ⇒ subject is the caller; marker ⇒
-- subject is the caller's markee. Rejects writes to a locked party.
CREATE OR REPLACE FUNCTION public.submit_score(
  p_token text, p_round_id uuid, p_hole int,
  p_subject uuid, p_source text, p_strokes int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_party uuid; v_locked boolean; v_markee uuid;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT pm.party_id, pa.locked, pm.marks_roster_id
    INTO v_party, v_locked, v_markee
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = v_roster AND pa.round_id = p_round_id;
  IF v_party IS NULL THEN RAISE EXCEPTION 'not in this round'; END IF;
  IF v_locked THEN RAISE EXCEPTION 'party locked'; END IF;
  IF p_source NOT IN ('self','marker') THEN RAISE EXCEPTION 'bad source'; END IF;
  IF p_source = 'self' AND p_subject <> v_roster THEN
    RAISE EXCEPTION 'self score must be your own'; END IF;
  IF p_source = 'marker' AND p_subject <> v_markee THEN
    RAISE EXCEPTION 'marker score must be your markee'; END IF;

  INSERT INTO public.tournament_scores
    (round_id, hole, subject_roster_id, source, author_roster_id, strokes, updated_at)
  VALUES (p_round_id, p_hole, p_subject, p_source, v_roster, p_strokes, now())
  ON CONFLICT (round_id, hole, subject_roster_id, source)
  DO UPDATE SET strokes = excluded.strokes,
                author_roster_id = excluded.author_roster_id,
                updated_at = now();
  INSERT INTO public.tournament_score_audit
    (round_id, hole, subject_roster_id, source, strokes, author_roster_id)
  VALUES (p_round_id, p_hole, p_subject, p_source, p_strokes, v_roster);
END $$;

-- Attest the caller's own card. Allowed only when none of the caller's holes
-- are in discrepancy (both entries present and unequal).
CREATE OR REPLACE FUNCTION public.attest_card(p_token text, p_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roster uuid; v_conflicts int;
BEGIN
  SELECT id INTO v_roster FROM public.tournament_roster WHERE magic_token = p_token;
  IF v_roster IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  SELECT count(*) INTO v_conflicts FROM (
    SELECT hole FROM public.tournament_scores
     WHERE round_id = p_round_id AND subject_roster_id = v_roster
     GROUP BY hole
    HAVING count(*) FILTER (WHERE source='self')   = 1
       AND count(*) FILTER (WHERE source='marker') = 1
       AND max(strokes) FILTER (WHERE source='self')
         <> max(strokes) FILTER (WHERE source='marker')
  ) c;
  IF v_conflicts > 0 THEN RAISE EXCEPTION 'resolve discrepancies first'; END IF;
  INSERT INTO public.tournament_attestations (round_id, roster_id)
  VALUES (p_round_id, v_roster) ON CONFLICT DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_token(text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_token_to_user(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_state(text,uuid)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_score(text,uuid,int,uuid,text,int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attest_card(text,uuid)        TO anon, authenticated;
```

- [ ] **Step 2: Verify the RPCs install and authorize correctly**

Apply the appended SQL. In the SQL editor, with two roster rows in one party,
confirm: `submit_score` with a `marker` source for a non-markee subject raises
`marker score must be your markee`; a valid call inserts one `tournament_scores`
row and one `tournament_score_audit` row.
Expected: the invalid call errors; the valid call writes exactly two rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517_official_tournaments.sql
git commit -m "feat: official tournament token-validated RPCs"
```

---

## Phase 2 — Pure logic (TDD)

All Phase 2 functions live in `src/store/officialScoring.js` and import nothing.
Tests run with `npx jest src/store/__tests__/officialScoring.test.js`.

### Task 3: Round-robin marker assignment

**Files:**
- Create: `src/store/officialScoring.js`
- Test: `src/store/__tests__/officialScoring.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/officialScoring.test.js`:

```js
import { assignRoundRobinMarkers } from '../officialScoring';

describe('assignRoundRobinMarkers', () => {
  test('each seat marks the next, last wraps to first', () => {
    const members = [
      { rosterId: 'd', seat: 4 }, { rosterId: 'a', seat: 1 },
      { rosterId: 'c', seat: 3 }, { rosterId: 'b', seat: 2 },
    ];
    expect(assignRoundRobinMarkers(members)).toEqual([
      { rosterId: 'a', marksRosterId: 'b' },
      { rosterId: 'b', marksRosterId: 'c' },
      { rosterId: 'c', marksRosterId: 'd' },
      { rosterId: 'd', marksRosterId: 'a' },
    ]);
  });

  test('three-player party still closes the loop', () => {
    const members = [
      { rosterId: 'a', seat: 1 }, { rosterId: 'b', seat: 2 }, { rosterId: 'c', seat: 3 },
    ];
    expect(assignRoundRobinMarkers(members).map((m) => m.marksRosterId))
      .toEqual(['b', 'c', 'a']);
  });

  test('empty party returns empty', () => {
    expect(assignRoundRobinMarkers([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t assignRoundRobinMarkers`
Expected: FAIL — "Cannot find module '../officialScoring'".

- [ ] **Step 3: Write minimal implementation**

Create `src/store/officialScoring.js`:

```js
// Pure logic for official tournaments — no I/O, no app imports.
// Round-robin markers, party auto-balance, discrepancy state, withdrawal
// re-link. Every function here is unit-tested in officialScoring.test.js.

// Each player marks the next player by seat order; the last wraps to the
// first. Returns [{ rosterId, marksRosterId }] in seat order.
export function assignRoundRobinMarkers(members) {
  const sorted = [...members].sort((a, b) => a.seat - b.seat);
  const n = sorted.length;
  if (n === 0) return [];
  return sorted.map((m, i) => ({
    rosterId: m.rosterId,
    marksRosterId: sorted[(i + 1) % n].rosterId,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t assignRoundRobinMarkers`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/officialScoring.js src/store/__tests__/officialScoring.test.js
git commit -m "feat: round-robin marker assignment"
```

---

### Task 4: Party auto-balance by handicap and random

**Files:**
- Modify: `src/store/officialScoring.js`
- Test: `src/store/__tests__/officialScoring.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/officialScoring.test.js`:

```js
import { autoBalanceParties } from '../officialScoring';

describe('autoBalanceParties', () => {
  const roster = [
    { rosterId: '1', handicap: 2 },  { rosterId: '2', handicap: 6 },
    { rosterId: '3', handicap: 10 }, { rosterId: '4', handicap: 14 },
    { rosterId: '5', handicap: 18 }, { rosterId: '6', handicap: 22 },
    { rosterId: '7', handicap: 26 }, { rosterId: '8', handicap: 30 },
  ];

  test('handicap mode snake-deals into balanced parties', () => {
    const parties = autoBalanceParties(roster, { partySize: 4, mode: 'handicap' });
    expect(parties).toHaveLength(2);
    const avg = (p) => p.reduce((s, x) => s + x.handicap, 0) / p.length;
    // Snake deal of 2..30 → both parties average 16.
    expect(avg(parties[0])).toBe(16);
    expect(avg(parties[1])).toBe(16);
  });

  test('random mode is deterministic given an rng and partitions everyone', () => {
    const seq = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const parties = autoBalanceParties(roster, { partySize: 4, mode: 'random', rng });
    expect(parties.flat()).toHaveLength(8);
    expect(new Set(parties.flat().map((p) => p.rosterId)).size).toBe(8);
  });

  test('non-multiple roster sizes still place everyone', () => {
    const parties = autoBalanceParties(roster.slice(0, 6), { partySize: 4, mode: 'handicap' });
    expect(parties.flat()).toHaveLength(6);
    expect(parties).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t autoBalanceParties`
Expected: FAIL — `autoBalanceParties is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/officialScoring.js`:

```js
// Split a roster into parties. mode 'handicap' snake-deals sorted players so
// each party gets a balanced spread; mode 'random' shuffles then deals.
// `rng` is injectable for deterministic tests.
export function autoBalanceParties(
  roster, { partySize = 4, mode = 'handicap', rng = Math.random } = {},
) {
  const players = [...roster];
  const partyCount = Math.max(1, Math.ceil(players.length / partySize));
  const parties = Array.from({ length: partyCount }, () => []);

  if (mode === 'random') {
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    players.forEach((p, i) => parties[i % partyCount].push(p));
    return parties;
  }

  players.sort((a, b) => (a.handicap ?? 0) - (b.handicap ?? 0));
  let idx = 0, dir = 1;
  for (const p of players) {
    parties[idx].push(p);
    idx += dir;
    if (idx === partyCount) { idx = partyCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return parties;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t autoBalanceParties`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/officialScoring.js src/store/__tests__/officialScoring.test.js
git commit -m "feat: party auto-balance by handicap and random"
```

---

### Task 5: Pair-average party balance

**Files:**
- Modify: `src/store/officialScoring.js`
- Test: `src/store/__tests__/officialScoring.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/officialScoring.test.js`:

```js
import { pairAverageHandicap, balancePartiesFromPairs } from '../officialScoring';

describe('pair-format balancing', () => {
  test('pairAverageHandicap averages the two players', () => {
    expect(pairAverageHandicap({ players: [{ handicap: 4 }, { handicap: 12 }] })).toBe(8);
  });

  test('balancePartiesFromPairs snake-deals pairs by average handicap', () => {
    const pairs = [
      { pairId: 'p1', players: [{ handicap: 2 }, { handicap: 2 }] },   // avg 2
      { pairId: 'p2', players: [{ handicap: 10 }, { handicap: 10 }] }, // avg 10
      { pairId: 'p3', players: [{ handicap: 18 }, { handicap: 18 }] }, // avg 18
      { pairId: 'p4', players: [{ handicap: 26 }, { handicap: 26 }] }, // avg 26
    ];
    const parties = balancePartiesFromPairs(pairs, { pairsPerParty: 2 });
    expect(parties).toHaveLength(2);
    // Snake deal: party0 = [p1(2), p4(26)] avg 14; party1 = [p2(10), p3(18)] avg 14.
    const partyAvg = (p) => p.reduce((s, x) => s + pairAverageHandicap(x), 0) / p.length;
    expect(partyAvg(parties[0])).toBe(14);
    expect(partyAvg(parties[1])).toBe(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t "pair-format"`
Expected: FAIL — `pairAverageHandicap is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/officialScoring.js`:

```js
// Mean handicap of a pair's two players.
export function pairAverageHandicap(pair) {
  const hs = pair.players.map((p) => p.handicap ?? 0);
  return hs.reduce((s, h) => s + h, 0) / hs.length;
}

// Snake-deal pre-formed pairs into parties so each party's pairs are balanced
// on average handicap. Used when a round's format is 'pairs'.
export function balancePartiesFromPairs(pairs, { pairsPerParty = 2 } = {}) {
  const sorted = [...pairs].sort(
    (a, b) => pairAverageHandicap(a) - pairAverageHandicap(b),
  );
  const partyCount = Math.max(1, Math.ceil(sorted.length / pairsPerParty));
  const parties = Array.from({ length: partyCount }, () => []);
  let idx = 0, dir = 1;
  for (const pair of sorted) {
    parties[idx].push(pair);
    idx += dir;
    if (idx === partyCount) { idx = partyCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return parties;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t "pair-format"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/officialScoring.js src/store/__tests__/officialScoring.test.js
git commit -m "feat: pair-average party balancing"
```

---

### Task 6: Discrepancy state

**Files:**
- Modify: `src/store/officialScoring.js`
- Test: `src/store/__tests__/officialScoring.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/officialScoring.test.js`:

```js
import { scoreCellState, cardDiscrepancyHoles } from '../officialScoring';

describe('discrepancy state', () => {
  test('scoreCellState classifies the four cases', () => {
    expect(scoreCellState(null, null)).toBe('empty');
    expect(scoreCellState(4, null)).toBe('waiting');
    expect(scoreCellState(null, 4)).toBe('waiting');
    expect(scoreCellState(4, 4)).toBe('agreed');
    expect(scoreCellState(4, 5)).toBe('discrepancy');
  });

  test('cardDiscrepancyHoles lists only holes in discrepancy for a subject', () => {
    const scores = [
      { hole: 1, subject_roster_id: 'a', source: 'self',   strokes: 4 },
      { hole: 1, subject_roster_id: 'a', source: 'marker', strokes: 4 },
      { hole: 2, subject_roster_id: 'a', source: 'self',   strokes: 5 },
      { hole: 2, subject_roster_id: 'a', source: 'marker', strokes: 6 },
      { hole: 3, subject_roster_id: 'a', source: 'self',   strokes: 3 },
      { hole: 4, subject_roster_id: 'b', source: 'self',   strokes: 9 },
      { hole: 4, subject_roster_id: 'b', source: 'marker', strokes: 2 },
    ];
    expect(cardDiscrepancyHoles(scores, 'a')).toEqual([2]);
    expect(cardDiscrepancyHoles(scores, 'b')).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t "discrepancy state"`
Expected: FAIL — `scoreCellState is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/officialScoring.js`:

```js
// Classify one player's hole given the two entries.
//   empty       — neither entered
//   waiting     — exactly one entered (the other side hasn't scored yet)
//   agreed      — both entered and equal
//   discrepancy — both entered and unequal
export function scoreCellState(selfStrokes, markerStrokes) {
  const hasSelf = selfStrokes != null;
  const hasMarker = markerStrokes != null;
  if (!hasSelf && !hasMarker) return 'empty';
  if (hasSelf !== hasMarker) return 'waiting';
  return selfStrokes === markerStrokes ? 'agreed' : 'discrepancy';
}

// Holes (ascending) where a subject's self/marker entries disagree. `scores`
// is the flat row list returned by get_round_state.
export function cardDiscrepancyHoles(scores, subjectRosterId) {
  const byHole = new Map();
  for (const s of scores) {
    if (s.subject_roster_id !== subjectRosterId) continue;
    const e = byHole.get(s.hole) || {};
    e[s.source] = s.strokes;
    byHole.set(s.hole, e);
  }
  return [...byHole.entries()]
    .filter(([, e]) => scoreCellState(e.self, e.marker) === 'discrepancy')
    .map(([hole]) => hole)
    .sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t "discrepancy state"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/officialScoring.js src/store/__tests__/officialScoring.test.js
git commit -m "feat: discrepancy state classification"
```

---

### Task 7: Withdrawal re-link

**Files:**
- Modify: `src/store/officialScoring.js`
- Test: `src/store/__tests__/officialScoring.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/officialScoring.test.js`:

```js
import { activeMarkerChain } from '../officialScoring';

describe('activeMarkerChain', () => {
  const members = [
    { rosterId: 'a', seat: 1 }, { rosterId: 'b', seat: 2 },
    { rosterId: 'c', seat: 3 }, { rosterId: 'd', seat: 4 },
  ];

  test('with no withdrawals it equals the full round-robin', () => {
    expect(activeMarkerChain(members, []).map((m) => m.marksRosterId))
      .toEqual(['b', 'c', 'd', 'a']);
  });

  test('a withdrawn player is skipped on both sides of the chain', () => {
    const chain = activeMarkerChain(members, ['c']);
    expect(chain.map((m) => m.rosterId)).toEqual(['a', 'b', 'd']);
    // b would have marked c; c is gone, so b now marks d.
    expect(chain.find((m) => m.rosterId === 'b').marksRosterId).toBe('d');
    expect(chain.find((m) => m.rosterId === 'd').marksRosterId).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t activeMarkerChain`
Expected: FAIL — `activeMarkerChain is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/officialScoring.js`:

```js
// Round-robin chain over only the players still in the round. Withdrawn
// players drop out and the chain re-closes around the remainder.
export function activeMarkerChain(members, withdrawnRosterIds = []) {
  const withdrawn = new Set(withdrawnRosterIds);
  const active = members.filter((m) => !withdrawn.has(m.rosterId));
  return assignRoundRobinMarkers(active);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialScoring.test.js -t activeMarkerChain`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/officialScoring.js src/store/__tests__/officialScoring.test.js
git commit -m "feat: withdrawal-aware marker chain"
```

---

## Phase 3 — Data layer

### Task 8: Magic-token persistence + redeem

**Files:**
- Create: `src/store/officialToken.js`

This module persists the device's magic token and redeems it. Token storage
follows the AsyncStorage key convention in `tournamentStore.js` (`@golf_*`).

- [ ] **Step 1: Write the module**

Create `src/store/officialToken.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// One active magic token per device. Set when a player opens an invite link.
const TOKEN_KEY = '@golf_official_token';

export async function saveToken(token) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function loadToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

// Resolve a token to its roster player + tournament context. If an app
// account is signed in on this device, link it so the round reaches that
// account's history (best-effort — link failure must not block play).
export async function redeemToken(token) {
  const { data, error } = await supabase.rpc('redeem_token', { p_token: token });
  if (error) throw error;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.rpc('link_token_to_user', { p_token: token }).catch(() => {});
  }
  return data; // { roster_id, display_name, handicap, tournament_id, withdrawn }
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `npx jest --listTests src/store` (smoke — confirms no syntax error in the import graph)
Expected: command exits 0, listing test files.

- [ ] **Step 3: Commit**

```bash
git add src/store/officialToken.js
git commit -m "feat: magic-token persistence and redeem"
```

---

### Task 9: Player-side official data layer

**Files:**
- Create: `src/store/officialStore.js`
- Test: `src/store/__tests__/officialStore.test.js`
- Modify: `src/store/syncQueue.js`, `src/store/syncWorker.js`

`submitScore` must work offline. The repo's offline queue is `src/store/syncQueue.js`; inspect its exported enqueue/drain API and follow it exactly. `submitScore` enqueues the RPC call and the existing `syncWorker` drains it. This task TDDs the pure payload-builder (`buildScorePayload`) and ships the I/O wrappers alongside.

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/officialStore.test.js`:

```js
import { buildScorePayload } from '../officialStore';

describe('buildScorePayload', () => {
  test('produces the exact RPC argument shape for submit_score', () => {
    const p = buildScorePayload({
      token: 'TKN', roundId: 'r1', hole: 7,
      subjectRosterId: 's1', source: 'self', strokes: 5,
    });
    expect(p).toEqual({
      fn: 'submit_score',
      args: { p_token: 'TKN', p_round_id: 'r1', p_hole: 7,
              p_subject: 's1', p_source: 'self', p_strokes: 5 },
    });
  });

  test('rejects a source outside self|marker', () => {
    expect(() => buildScorePayload({
      token: 'T', roundId: 'r', hole: 1,
      subjectRosterId: 's', source: 'admin', strokes: 3,
    })).toThrow('bad source');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialStore.test.js`
Expected: FAIL — "Cannot find module '../officialStore'".

- [ ] **Step 3: Write the implementation**

Create `src/store/officialStore.js`:

```js
import { supabase } from '../lib/supabase';
import { enqueue } from './syncQueue'; // NOTE: confirm the exported name in syncQueue.js

// Pure: build the queued RPC payload for one score write. Kept separate so
// it is unit-testable without touching the network or the queue.
export function buildScorePayload({ token, roundId, hole, subjectRosterId, source, strokes }) {
  if (source !== 'self' && source !== 'marker') throw new Error('bad source');
  return {
    fn: 'submit_score',
    args: {
      p_token: token, p_round_id: roundId, p_hole: hole,
      p_subject: subjectRosterId, p_source: source, p_strokes: strokes,
    },
  };
}

// Fetch the full round state for the token holder's party.
export async function getRoundState(token, roundId) {
  const { data, error } = await supabase.rpc('get_round_state', {
    p_token: token, p_round_id: roundId,
  });
  if (error) throw error;
  return data;
}

// Write one score cell. Enqueued through the offline queue so play works
// without signal; syncWorker drains it. The queue entry is a generic RPC
// call dispatched in Step 5.
export async function submitScore(params) {
  const payload = buildScorePayload(params);
  await enqueue({ kind: 'rpc', ...payload });
}

// Attest the caller's card. Online-only: attestation is a deliberate,
// terminal action, so surface failure immediately rather than queueing.
export async function attestCard(token, roundId) {
  const { error } = await supabase.rpc('attest_card', {
    p_token: token, p_round_id: roundId,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialStore.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the queue's RPC dispatch**

Open `src/store/syncQueue.js` and `src/store/syncWorker.js`. If the exported
enqueue function is named other than `enqueue`, update the import in
`officialStore.js` to match. If the drain handler does not already handle a
`kind: 'rpc'` entry, add a branch that calls
`supabase.rpc(entry.fn, entry.args)` and treats a returned `error` as a
retryable failure (same retry path as existing entry kinds). No new test here
— the existing syncWorker tests cover drain behavior; this is a new branch in
an established switch.

- [ ] **Step 6: Commit**

```bash
git add src/store/officialStore.js src/store/__tests__/officialStore.test.js \
        src/store/syncQueue.js src/store/syncWorker.js
git commit -m "feat: player-side official scoring data layer"
```

---

### Task 10: Admin-side official data layer

**Files:**
- Create: `src/store/officialAdmin.js`

Admin functions run as an authenticated user (the tournament owner) and use
ordinary Supabase table writes covered by the RLS in Task 1. Token generation
uses `uuid` (already a dependency).

- [ ] **Step 1: Write the module**

Create `src/store/officialAdmin.js`:

```js
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { assignRoundRobinMarkers } from './officialScoring';

// Create an official tournament shell. Reuses the tournaments table; kind
// flags it official. Returns the new tournament id.
export async function createOfficialTournament({ name }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('tournaments')
    .insert({ name, kind: 'official', created_by: user.id, data: {} })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Add a roster player. Each gets a unique magic token used as their link.
export async function addRosterPlayer(tournamentId, { displayName, handicap }) {
  const { data, error } = await supabase
    .from('tournament_roster')
    .insert({
      tournament_id: tournamentId, display_name: displayName,
      handicap: handicap ?? 0, magic_token: uuidv4(),
    })
    .select('id, display_name, handicap, magic_token, withdrawn')
    .single();
  if (error) throw error;
  return data;
}

export async function listRoster(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_roster')
    .select('id, display_name, handicap, magic_token, withdrawn, user_id')
    .eq('tournament_id', tournamentId)
    .order('created_at');
  if (error) throw error;
  return data;
}

// Issue a fresh token for a player (used when a link leaks).
export async function regenerateToken(rosterId) {
  const token = uuidv4();
  const { error } = await supabase
    .from('tournament_roster').update({ magic_token: token }).eq('id', rosterId);
  if (error) throw error;
  return token;
}

export async function withdrawPlayer(rosterId, withdrawn = true) {
  const { error } = await supabase
    .from('tournament_roster').update({ withdrawn }).eq('id', rosterId);
  if (error) throw error;
}

// Create a round in 'setup' status.
export async function createRound(tournamentId, { roundIndex, course, format }) {
  const { data, error } = await supabase
    .from('tournament_rounds')
    .insert({ tournament_id: tournamentId, round_index: roundIndex,
              course: course ?? {}, format: format ?? 'stableford' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Persist a round's party layout. `parties` is [[rosterId,...], ...]; each
// inner array is one party in seat order. Markers are derived round-robin.
// Replaces any existing parties for the round (only valid while status=setup).
export async function saveParties(tournamentId, roundId, parties) {
  await supabase.from('tournament_parties').delete().eq('round_id', roundId);
  for (let i = 0; i < parties.length; i++) {
    const { data: party, error: pErr } = await supabase
      .from('tournament_parties')
      .insert({ round_id: roundId, tournament_id: tournamentId, number: i + 1 })
      .select('id')
      .single();
    if (pErr) throw pErr;
    const members = parties[i].map((rosterId, seat) => ({ rosterId, seat: seat + 1 }));
    const markers = assignRoundRobinMarkers(members);
    const rows = members.map((m) => ({
      party_id: party.id,
      roster_id: m.rosterId,
      seat: m.seat,
      marks_roster_id: markers.find((x) => x.rosterId === m.rosterId).marksRosterId,
    }));
    const { error: mErr } = await supabase.from('tournament_party_members').insert(rows);
    if (mErr) throw mErr;
  }
}

// Admin override: set who a player marks.
export async function overrideMarker(partyId, rosterId, marksRosterId) {
  const { error } = await supabase
    .from('tournament_party_members')
    .update({ marks_roster_id: marksRosterId })
    .eq('party_id', partyId).eq('roster_id', rosterId);
  if (error) throw error;
}

export async function startRound(roundId) {
  const { error } = await supabase
    .from('tournament_rounds').update({ status: 'live' }).eq('id', roundId);
  if (error) throw error;
}

// Force-resolve a discrepancy: write both score rows to the agreed value.
export async function forceResolve(roundId, hole, subjectRosterId, strokes, adminRosterId) {
  for (const source of ['self', 'marker']) {
    await supabase.from('tournament_scores').upsert({
      round_id: roundId, hole, subject_roster_id: subjectRosterId,
      source, author_roster_id: adminRosterId, strokes, updated_at: new Date().toISOString(),
    }, { onConflict: 'round_id,hole,subject_roster_id,source' });
    await supabase.from('tournament_score_audit').insert({
      round_id: roundId, hole, subject_roster_id: subjectRosterId,
      source, strokes, author_roster_id: adminRosterId,
    });
  }
}

export async function forceFinalizeParty(partyId) {
  const { error } = await supabase
    .from('tournament_parties').update({ locked: true }).eq('id', partyId);
  if (error) throw error;
}

export async function listNotifications(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_notifications')
    .select('id, kind, body, created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `npx jest --listTests src/store`
Expected: command exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/store/officialAdmin.js
git commit -m "feat: admin-side official tournament data layer"
```

---

## Phase 4 — Admin UI

> UI tasks integrate into the existing navigation. Follow the patterns in
> `src/screens/EditTournamentScreen.js` and `src/screens/SetupScreen.js` for
> screen structure, `ScreenContainer` usage, and theme access (`useTheme`).
> Each screen below is a new focused file; no existing screen is restructured.

### Task 11: Official setup + roster builder screen

**Files:**
- Create: `src/screens/OfficialSetupScreen.js`
- Modify: `App.js` (register route)
- Modify: `src/screens/HomeScreen.js` (entry point)

- [ ] **Step 1: Build the screen**

Create `src/screens/OfficialSetupScreen.js`. It uses `ScreenContainer`,
`useTheme`, and the Task 10 data layer. Responsibilities:
- A name field + "Create" → `createOfficialTournament`; store the returned id.
- A roster list: each row shows name, handicap, and a "Link" action that
  copies `https://<app-url>/join/<magic_token>` to the clipboard and shows a
  QR via `react-native-qrcode-svg` (already a dependency).
- An "Add player" form (name + handicap) → `addRosterPlayer`, appends to list.
- Per-row "Regenerate link" (`regenerateToken`) and "Withdraw" (`withdrawPlayer`).
- A free-text "Local rules & notes" field saved into the tournament `data`
  blob (spec: local rules live in the config blob, no new table).
- A "Rounds" section: "Add round" → `createRound`, then navigate to
  `PartyBoard` (Task 12) for that round.

Match the form/list styling of `EditTournamentScreen.js`. Use `Clipboard` from
`expo-clipboard` if present, else `react-native` `Clipboard`.

- [ ] **Step 2: Register the route**

In `App.js`, add `OfficialSetupScreen` to the stack navigator alongside the
existing screens (e.g. near `EditTournamentScreen`):

```js
<Stack.Screen name="OfficialSetup" component={OfficialSetupScreen} />
```

Import it at the top with the other screen imports.

- [ ] **Step 3: Add the Home entry point**

In `src/screens/HomeScreen.js`, add an "Official Tournament" action to the
play menu that calls `navigation.navigate('OfficialSetup')`. Follow the
existing play-menu item pattern.

- [ ] **Step 4: Manually verify**

Run: `npm run web`. From Home, open "Official Tournament", create one, add
two players, confirm each shows a copyable link + QR.
Expected: tournament and roster rows persist across a reload.

- [ ] **Step 5: Commit**

```bash
git add src/screens/OfficialSetupScreen.js App.js src/screens/HomeScreen.js
git commit -m "feat: official tournament setup and roster builder screen"
```

---

### Task 12: Party & marker board screen

**Files:**
- Create: `src/screens/PartyBoardScreen.js`
- Modify: `App.js` (register route)

- [ ] **Step 1: Build the screen**

Create `src/screens/PartyBoardScreen.js`. Route params: `tournamentId`,
`roundId`. Responsibilities:
- Load the roster (`listRoster`) and current parties (query
  `tournament_parties` + `tournament_party_members` for the round).
- Method controls — Manual / Auto by handicap / Random / Re-roll — calling
  `autoBalanceParties` (Task 4) or `balancePartiesFromPairs` (Task 5, when the
  round format is `pairs`). The result is local state shaped `[[rosterId,...]]`.
- Render party cards. Each member row shows name, handicap, and the derived
  marker (`assignRoundRobinMarkers`) as "↓ marks <name>", with an edit control
  that updates the marker in local state (persisted via `overrideMarker` on save).
- Manual mode: move a player between parties (a simple "move to party N"
  menu is acceptable for ≤24 players — drag is not required).
- "Save" → `saveParties`. "Start Round" → `saveParties` then `startRound`,
  then navigate to the admin monitor (Task 18).

The visual reference is the approved mockup
`.superpowers/brainstorm/98616-1779046072/content/party-board.html`.

- [ ] **Step 2: Register the route**

In `App.js`:

```js
<Stack.Screen name="PartyBoard" component={PartyBoardScreen} />
```

- [ ] **Step 3: Manually verify**

Run: `npm run web`. Open a round's PartyBoard, click "Auto by handicap",
confirm parties fill with balanced average handicaps and each player shows a
round-robin marker. Save and reload — layout persists.
Expected: parties + markers persist; "Start Round" flips round status to `live`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/PartyBoardScreen.js App.js
git commit -m "feat: party and marker board screen"
```

---

## Phase 5 — Player UI

### Task 13: Magic-link route + redeem flow

**Files:**
- Create: `src/screens/JoinOfficialScreen.js`
- Modify: `App.js` (deep link config + a `JoinOfficial` route)

- [ ] **Step 1: Build the join screen**

Create `src/screens/JoinOfficialScreen.js`. Route param: `token`.
- On mount, call `redeemToken(token)` (Task 8). On success, `saveToken(token)`
  and show "You're in as <display_name>" with the tournament name.
- Show the player's rounds (query `tournament_rounds` for `tournament_id`; for
  each round the player is in, a "Score this round" button → navigate to
  `Scorecard` with `{ official: true, token, roundId }`).
- On `invalid token`, show a clear error and a "Re-enter link" affordance.

- [ ] **Step 2: Wire the deep link**

In `App.js`, extend the navigation `linking` config so
`https://<app-url>/join/:token` maps to the `JoinOfficial` route. Register:

```js
<Stack.Screen name="JoinOfficial" component={JoinOfficialScreen} />
```

If the app has no `linking` config yet, add one with `prefixes` for the web
origin and the `screens: { JoinOfficial: 'join/:token' }` mapping.

- [ ] **Step 3: Manually verify**

Run: `npm run web`. Open `/join/<a real magic_token>`; confirm the screen
greets the roster player by name and lists their round(s).
Expected: a valid token resolves; a garbage token shows the error state.

- [ ] **Step 4: Commit**

```bash
git add src/screens/JoinOfficialScreen.js App.js
git commit -m "feat: magic-link join flow for official tournaments"
```

---

### Task 14: Scorecard official-mode data source + per-card permission

**Files:**
- Create: `src/hooks/useOfficialRound.js`
- Modify: `src/screens/ScorecardScreen.js`

`ScorecardScreen` currently loads a tournament blob via `loadTournament` and
saves through `mutate`. Official mode supplies an alternative data source.
Before editing, read `ScorecardScreen.js` around the load effect, `scores`
state, `setScore`/`stepScore`, and the `HolePage` player-card render to find
the seams. Keep casual behavior on the existing path; branch on a route param.

- [ ] **Step 1: Build the official round hook**

Create `src/hooks/useOfficialRound.js`. Given `{ token, roundId }` it:
- Loads `getRoundState` (Task 9) into state; exposes `members`, `scores`
  (flat rows), `round`, `partyId`, `attestations`, `myRosterId`.
- Exposes `setScore(subjectRosterId, hole, strokes, source)` → calls
  `submitScore` (Task 9) and optimistically updates local `scores`.
- Exposes `refresh()` and polls `getRoundState` every ~20s while mounted
  (no realtime channel in Core — polling is sufficient at ≤24 players).
- Derives, for the token holder, the editable subjects: `myRosterId`
  (writes with source `self`) and the player they mark, found as the member
  whose `roster_id` equals the token holder's `marks_roster_id` (source
  `marker`).

- [ ] **Step 2: Add the official branch to ScorecardScreen**

In `ScorecardScreen.js`, read `route.params.official`, `route.params.token`,
`route.params.roundId`. When `official` is true:
- Call `useOfficialRound` instead of `loadTournament`. Map its `members` to
  the `players` array the existing `HolePage` expects, and its `scores` to the
  `scores` shape the render uses.
- Replace the score write path: `setScore`/`stepScore` call the hook's
  `setScore` with the correct `source` for the subject (`self` for the token
  holder, `marker` for their markee).
- Pass an `editable(subjectRosterId)` predicate into `HolePage`; for a
  non-editable player, render the card read-only (hide the +/− steppers —
  there is already a read-only display path for computed values; reuse it).

Casual mode (`official` falsey) keeps every existing code path unchanged.

- [ ] **Step 3: Manually verify**

Run: `npm run web`. From `JoinOfficial`, open a live round's scorecard as
player A. Confirm A's card and A's markee's card show steppers; the other two
party members render read-only. Enter a score for each editable card.
Expected: editable cards write; read-only cards have no steppers; a reload
shows the entered scores (via `get_round_state`).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOfficialRound.js src/screens/ScorecardScreen.js
git commit -m "feat: official-mode scorecard data source and per-card permission"
```

---

### Task 15: Discrepancy badge + resolve sheet

**Files:**
- Create: `src/components/DiscrepancySheet.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Build the resolve sheet**

Create `src/components/DiscrepancySheet.js` — a modal (follow `CommentsSheet.js`
for modal structure). Props: `visible`, `hole`, `subjectName`, `selfStrokes`,
`markerStrokes`, `markerName`, `editableSource` (`self` or `marker` — whichever
the viewer owns), `onChange(strokes)`, `onClose`. It shows the two entries
side by side: the viewer's own entry with +/− steppers, the other read-only.
Below, a line: "Resolves automatically when both entries match." It closes
itself when `scoreCellState(selfStrokes, markerStrokes) === 'agreed'`.

- [ ] **Step 2: Add the badge to the scorecard (official mode)**

In `ScorecardScreen.js` official branch:
- For each rendered player card, compute the hole's state with
  `scoreCellState` (Task 6) from the official `scores`. Show a small badge:
  green check (`agreed`), grey clock (`waiting`), red dot (`discrepancy`).
- On the hole strip / hole navigation, mark holes returned by
  `cardDiscrepancyHoles(scores, myRosterId)` with a red dot.
- Tapping a `discrepancy` badge opens `DiscrepancySheet` for that hole +
  subject; `onChange` routes through the hook's `setScore`.

- [ ] **Step 3: Manually verify**

Run two browser sessions (`npm run web`), each joined as a different party
member, scoring the same hole differently. Confirm both see the red
discrepancy badge within one poll cycle (~20s); when one edits to match,
the badge turns green and the sheet closes.
Expected: three states render correctly; resolution clears on match.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiscrepancySheet.js src/screens/ScorecardScreen.js
git commit -m "feat: discrepancy badge and resolve sheet"
```

---

### Task 16: Attest + party lock

**Files:**
- Modify: `supabase/migrations/20260517_official_tournaments.sql` (append a lock trigger)
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Add the party-lock trigger**

Append to `supabase/migrations/20260517_official_tournaments.sql` — when every
member of a party has attested, lock the party; when every party in a round is
locked, lock the round. Both write a `tournament_notifications` row.

```sql
CREATE OR REPLACE FUNCTION public.on_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_party uuid; v_tourn bigint; v_open int; v_round_open int;
BEGIN
  SELECT pm.party_id INTO v_party
    FROM public.tournament_party_members pm
    JOIN public.tournament_parties pa ON pa.id = pm.party_id
   WHERE pm.roster_id = NEW.roster_id AND pa.round_id = NEW.round_id;
  IF v_party IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_open
    FROM public.tournament_party_members pm
    JOIN public.tournament_roster ro ON ro.id = pm.roster_id
   WHERE pm.party_id = v_party AND ro.withdrawn = false
     AND NOT EXISTS (SELECT 1 FROM public.tournament_attestations a
                      WHERE a.round_id = NEW.round_id AND a.roster_id = pm.roster_id);
  IF v_open = 0 THEN
    UPDATE public.tournament_parties SET locked = true WHERE id = v_party;
    SELECT tournament_id INTO v_tourn FROM public.tournament_parties WHERE id = v_party;
    INSERT INTO public.tournament_notifications (tournament_id, round_id, kind, body)
    VALUES (v_tourn, NEW.round_id, 'party_locked',
            'A party finished and locked its scores.');

    SELECT count(*) INTO v_round_open
      FROM public.tournament_parties WHERE round_id = NEW.round_id AND locked = false;
    IF v_round_open = 0 THEN
      UPDATE public.tournament_rounds SET status = 'locked' WHERE id = NEW.round_id;
      INSERT INTO public.tournament_notifications (tournament_id, round_id, kind, body)
      VALUES (v_tourn, NEW.round_id, 'round_locked', 'A round is complete.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_on_attestation ON public.tournament_attestations;
CREATE TRIGGER trg_on_attestation
  AFTER INSERT ON public.tournament_attestations
  FOR EACH ROW EXECUTE FUNCTION public.on_attestation();
```

Apply this appended SQL in the Supabase SQL editor.

- [ ] **Step 2: Add the attest action to the scorecard**

In `ScorecardScreen.js` official branch, replace the round-complete overlay
trigger with an **Attest my card** button. It is disabled while
`cardDiscrepancyHoles(scores, myRosterId).length > 0`. On press it calls
`attestCard(token, roundId)` (Task 9). After attesting, the card renders
read-only and shows "Attested — waiting for your party".

- [ ] **Step 3: Manually verify**

Run: `npm run web`. With a 2-player test party, resolve all discrepancies,
attest both cards. Confirm the second attestation locks the party (cards
become read-only) and the round status flips to `locked`.
Expected: attest is blocked while a discrepancy is open; both attestations
lock the party; an all-parties-locked round locks.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js supabase/migrations/20260517_official_tournaments.sql
git commit -m "feat: attestation, party lock trigger and round finalize"
```

---

## Phase 6 — Leaderboard & admin monitor

### Task 17: Official leaderboard feed

**Files:**
- Create: `src/store/officialLeaderboard.js`
- Test: `src/store/__tests__/officialLeaderboard.test.js`
- Modify: `src/screens/ScorecardScreen.js` (wire the feed into the existing leaderboard component)

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/officialLeaderboard.test.js`:

```js
import { buildLeaderboard } from '../officialLeaderboard';

describe('buildLeaderboard', () => {
  const members = [
    { roster_id: 'a', display_name: 'Ann', handicap: 0 },
    { roster_id: 'b', display_name: 'Ben', handicap: 0 },
  ];
  const scores = [
    { hole: 1, subject_roster_id: 'a', source: 'self',   strokes: 4 },
    { hole: 1, subject_roster_id: 'a', source: 'marker', strokes: 4 },
    { hole: 2, subject_roster_id: 'a', source: 'self',   strokes: 5 },
    { hole: 2, subject_roster_id: 'a', source: 'marker', strokes: 5 },
    { hole: 1, subject_roster_id: 'b', source: 'self',   strokes: 6 },
    { hole: 1, subject_roster_id: 'b', source: 'marker', strokes: 6 },
  ];

  test('ranks by resolved gross strokes, lowest first, and counts holes thru', () => {
    const rows = buildLeaderboard({ members, scores, format: 'gross_net' });
    expect(rows.map((r) => r.rosterId)).toEqual(['b', 'a']);
    expect(rows.find((r) => r.rosterId === 'a').gross).toBe(9);
    expect(rows.find((r) => r.rosterId === 'a').thru).toBe(2);
    expect(rows.find((r) => r.rosterId === 'b').gross).toBe(6);
    expect(rows.find((r) => r.rosterId === 'b').thru).toBe(1);
  });

  test('omits holes still in discrepancy from the resolved total', () => {
    const withConflict = [
      ...scores,
      { hole: 3, subject_roster_id: 'a', source: 'self',   strokes: 4 },
      { hole: 3, subject_roster_id: 'a', source: 'marker', strokes: 7 },
    ];
    const rows = buildLeaderboard({ members, scores: withConflict, format: 'gross_net' });
    expect(rows.find((r) => r.rosterId === 'a').gross).toBe(9); // hole 3 excluded
    expect(rows.find((r) => r.rosterId === 'a').thru).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/officialLeaderboard.test.js`
Expected: FAIL — "Cannot find module '../officialLeaderboard'".

- [ ] **Step 3: Write the implementation**

Create `src/store/officialLeaderboard.js`:

```js
import { scoreCellState } from './officialScoring';

// One resolved stroke value per (subject, hole): the agreed number, or the
// single entered side. Holes still in discrepancy (or empty) are omitted.
function resolvedByPlayer(scores) {
  const byKey = new Map(); // `${subject}|${hole}` -> { self, marker }
  for (const s of scores) {
    const k = `${s.subject_roster_id}|${s.hole}`;
    const e = byKey.get(k) || {};
    e[s.source] = s.strokes;
    byKey.set(k, e);
  }
  const out = new Map(); // subject -> Map(hole -> strokes)
  for (const [k, e] of byKey) {
    const [subject, hole] = k.split('|');
    const state = scoreCellState(e.self, e.marker);
    if (state === 'discrepancy' || state === 'empty') continue;
    const strokes = e.self ?? e.marker;
    if (!out.has(subject)) out.set(subject, new Map());
    out.get(subject).set(Number(hole), strokes);
  }
  return out;
}

// Reduce the flat score rows to ranked leaderboard rows. Core ranks on gross
// strokes; net / Stableford columns are a follow-on (see note below).
export function buildLeaderboard({ members, scores }) {
  const resolved = resolvedByPlayer(scores);
  const rows = members.map((m) => {
    const holesMap = resolved.get(m.roster_id) || new Map();
    const gross = [...holesMap.values()].reduce((s, v) => s + v, 0);
    return {
      rosterId: m.roster_id,
      name: m.display_name,
      handicap: m.handicap,
      thru: holesMap.size,
      gross,
    };
  });
  rows.sort((a, b) => a.gross - b.gross);
  return rows;
}
```

> Net and Stableford columns: extend `buildLeaderboard` to compute them with
> `calcExtraShots` and `calcStablefordPoints` from `./scoring` when the round
> `format` is `stableford` or `gross_net`, ranking Stableford descending. Add
> a test mirroring Step 1 with a non-zero handicap and a `holes` par array
> before implementing that branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/officialLeaderboard.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the leaderboard into the UI**

Feed `buildLeaderboard` output into the existing tournament leaderboard
component (the one used for casual tournaments — locate it via the leaderboard
render in `ScorecardScreen.js` / round summary). Render it for official rounds
from `getRoundState` data. No new leaderboard component.

- [ ] **Step 6: Commit**

```bash
git add src/store/officialLeaderboard.js \
        src/store/__tests__/officialLeaderboard.test.js src/screens/ScorecardScreen.js
git commit -m "feat: official tournament leaderboard feed"
```

---

### Task 18: Admin monitor screen

**Files:**
- Create: `src/screens/OfficialAdminScreen.js`
- Modify: `App.js` (register route)

- [ ] **Step 1: Build the screen**

Create `src/screens/OfficialAdminScreen.js`. Route param: `tournamentId`.
- For the live round, list parties with a status line each: `locked`,
  `N discrepancies open`, or `scoring`. The admin reads `tournament_scores`,
  `tournament_parties`, and `tournament_party_members` directly (RLS allows
  the owner) and counts discrepancies with `cardDiscrepancyHoles` across each
  party's members.
- Show `listNotifications` (Task 10) newest-first.
- Per discrepancy: a "Force resolve" control opening a value picker →
  `forceResolve`. Per party: "Force finalize" → `forceFinalizeParty`.
- A "Withdraw player" control → `withdrawPlayer`, followed by a re-save of
  the affected round's parties via `saveParties` so the round-robin markers
  re-derive around the withdrawn player (`activeMarkerChain` is the pure
  reference for the expected result).

- [ ] **Step 2: Register the route**

In `App.js`:

```js
<Stack.Screen name="OfficialAdmin" component={OfficialAdminScreen} />
```

`PartyBoardScreen` "Start Round" (Task 12) navigates here.

- [ ] **Step 3: Manually verify**

Run: `npm run web`. Start a round, enter mismatching scores from a player
session, confirm the admin monitor shows the party as "1 discrepancy open"
and a notification appears when a party locks.
Expected: party statuses and notifications reflect live state; force-resolve
clears a discrepancy.

- [ ] **Step 4: Commit**

```bash
git add src/screens/OfficialAdminScreen.js App.js
git commit -m "feat: official tournament admin monitor screen"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `officialScoring`, `officialStore`,
and `officialLeaderboard` suites.

- [ ] **End-to-end smoke (web)**

Run: `npm run web`. As admin: create an official tournament, add 4 players,
add a round, auto-balance one party, start it. In four browser sessions open
each magic link, score 18 holes (introduce one discrepancy, resolve it),
attest all four cards. Confirm the party and round lock, the admin gets the
notifications, and the leaderboard ranks correctly.

- [ ] **Confirm casual tournaments are untouched**

Run a casual tournament through the scorecard. Expected: identical to before —
no official-mode code path is reachable without `route.params.official`.

---

## Self-review notes

- **Spec coverage** — type/`kind` (T1); roster + magic links + identity (T1,T2,T8,T11,T13); parties + round-robin markers + auto-balance incl. pair-average (T1,T3,T4,T5,T10,T12); per-cell storage (T1); token RPCs / guest auth (T2,T8,T9); dual-entry scoring on the reused scorecard (T14); 3-state discrepancy detection + resolution (T6,T15); attest/lock/notify (T2,T16); offline queue (T9); leaderboard (T17); admin force-resolve/finalize/withdraw + monitor (T10,T18); local rules & notes (tournament `data` blob, written by T11, surfaced by T13). Every spec section maps to a task.
- **Withdrawal re-link** — `activeMarkerChain` (T7) is the pure reference; the admin applies it operationally via `withdrawPlayer` + `saveParties` in T18 Step 1.
- **Naming consistency** — `assignRoundRobinMarkers`, `autoBalanceParties`, `balancePartiesFromPairs`, `pairAverageHandicap`, `scoreCellState`, `cardDiscrepancyHoles`, `activeMarkerChain`, `buildScorePayload`, `getRoundState`, `submitScore`, `attestCard`, `buildLeaderboard` are used identically across every task that references them. RPC names (`redeem_token`, `link_token_to_user`, `get_round_state`, `submit_score`, `attest_card`) match between Task 2 and the data-layer callers; `get_round_state` returns `my_roster_id` (Task 2) which `useOfficialRound` consumes as `myRosterId` (Task 14).
- **One open assumption flagged in-task** — Task 9 Step 5 requires confirming `syncQueue.js`'s exported enqueue name and adding an `rpc` drain branch; the engineer must read that file. This is the only place the plan depends on code it cannot fully quote.
