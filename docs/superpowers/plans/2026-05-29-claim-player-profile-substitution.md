# Claim Player Profile Substitution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a signed-in invitee claims an unlinked player slot, replace the slot's displayed identity with the invitee's profile while preserving the original player id, organiser handicap, and all scores.

**Architecture:** The server RPC remains the authoritative claim boundary because it already locks the tournament row and prevents double-claims. A pure JS helper in `tournamentStore.js` mirrors the identity-substitution rules for unit tests and future client-side reuse; the SQL migration applies the same rules to `data.players[]` and `data.rounds[].pairs`.

**Tech Stack:** Expo SDK 54, React Native, Jest, Supabase Postgres SQL migrations.

---

## File Structure

- Modify `src/store/tournamentStore.js`: export `applyClaimedPlayerProfileIdentity(tournament, playerId, userId, profile)` as a pure helper.
- Modify `src/store/__tests__/tournamentStore.test.js`: add focused tests for the helper.
- Create `supabase/migrations/20260529000000_claim_profile_substitution.sql`: supersede `claim_tournament_player` so it stamps profile identity and pair snapshots while preserving handicap and score maps.

## Task 1: Pure Helper Tests

**Files:**
- Modify: `src/store/__tests__/tournamentStore.test.js`

- [ ] **Step 1: Add failing tests**

Add `applyClaimedPlayerProfileIdentity` to the existing import:

```javascript
import {
  rowToTournament, reTeeRound,
  tournamentNoun, tournamentNounCapitalized, formatRoundLabel,
  applyClaimedPlayerProfileIdentity,
} from '../tournamentStore';
```

Append this test block:

```javascript
describe('applyClaimedPlayerProfileIdentity', () => {
  function tournament() {
    return {
      id: 't1',
      players: [
        { id: 'p1', name: 'Noel', handicap: 14 },
        { id: 'p2', name: 'Marcos', handicap: 9, user_id: 'u-marcos' },
      ],
      rounds: [
        {
          id: 'r1',
          pairs: [[
            { id: 'p1', name: 'Noel', handicap: 14 },
            { id: 'p2', name: 'Marcos', handicap: 9, user_id: 'u-marcos' },
          ]],
          scores: { p1: { 1: 5 } },
          shotDetails: { p1: { 1: { putts: 2 } } },
          scoreConflicts: { p1: { 1: { candidates: [{ value: 5 }] } } },
          playerHandicaps: { p1: 16, p2: 10 },
        },
      ],
      _meta: { players: 100 },
    };
  }

  test('substitutes claimed player display identity from profile', () => {
    const next = applyClaimedPlayerProfileIdentity(
      tournament(),
      'p1',
      'u-noe',
      { display_name: 'Noe', username: 'noe', avatar_url: 'https://cdn/noe.png' },
    );

    expect(next.players[0]).toEqual({
      id: 'p1',
      name: 'Noe',
      handicap: 14,
      user_id: 'u-noe',
      avatar_url: 'https://cdn/noe.png',
    });
    expect(next.rounds[0].pairs[0][0]).toEqual({
      id: 'p1',
      name: 'Noe',
      handicap: 14,
      user_id: 'u-noe',
      avatar_url: 'https://cdn/noe.png',
    });
  });

  test('preserves scores, shot details, conflicts, and organiser handicaps', () => {
    const next = applyClaimedPlayerProfileIdentity(
      tournament(),
      'p1',
      'u-noe',
      { display_name: 'Noe', handicap: 3 },
    );

    expect(next.players[0].handicap).toBe(14);
    expect(next.rounds[0].playerHandicaps.p1).toBe(16);
    expect(next.rounds[0].scores.p1).toEqual({ 1: 5 });
    expect(next.rounds[0].shotDetails.p1).toEqual({ 1: { putts: 2 } });
    expect(next.rounds[0].scoreConflicts.p1).toEqual({ 1: { candidates: [{ value: 5 }] } });
  });

  test('falls back to username, then existing name, when display name is blank', () => {
    const withUsername = applyClaimedPlayerProfileIdentity(
      tournament(),
      'p1',
      'u-noe',
      { display_name: '   ', username: 'noe_handle' },
    );
    expect(withUsername.players[0].name).toBe('noe_handle');

    const withExistingName = applyClaimedPlayerProfileIdentity(
      tournament(),
      'p1',
      'u-noe',
      { display_name: '', username: '' },
    );
    expect(withExistingName.players[0].name).toBe('Noel');
  });

  test('does not alter other players', () => {
    const next = applyClaimedPlayerProfileIdentity(
      tournament(),
      'p1',
      'u-noe',
      { display_name: 'Noe' },
    );

    expect(next.players[1]).toEqual({ id: 'p2', name: 'Marcos', handicap: 9, user_id: 'u-marcos' });
    expect(next.rounds[0].pairs[0][1]).toEqual({ id: 'p2', name: 'Marcos', handicap: 9, user_id: 'u-marcos' });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/store/__tests__/tournamentStore.test.js --runInBand
```

Expected: FAIL with an import error similar to `applyClaimedPlayerProfileIdentity is not exported`.

## Task 2: Pure Helper Implementation

**Files:**
- Modify: `src/store/tournamentStore.js`

- [ ] **Step 1: Add the helper**

Insert near `findClaimedSlot`:

```javascript
function displayNameFromProfile(profile, fallback) {
  const displayName = profile?.display_name?.trim?.() || profile?.displayName?.trim?.();
  if (displayName) return displayName;
  const username = profile?.username?.trim?.();
  if (username) return username;
  return fallback;
}

function applyIdentityToPlayerSnapshot(player, playerId, userId, profile) {
  if (!player || player.id !== playerId) return player;
  const name = displayNameFromProfile(profile, player.name);
  const next = { ...player, name, user_id: userId };
  const avatarUrl = profile?.avatar_url ?? profile?.avatarUrl;
  if (avatarUrl) next.avatar_url = avatarUrl;
  return next;
}

export function applyClaimedPlayerProfileIdentity(tournament, playerId, userId, profile) {
  if (!tournament || !playerId || !userId) return tournament;
  const players = (tournament.players ?? []).map((p) =>
    applyIdentityToPlayerSnapshot(p, playerId, userId, profile));
  const rounds = (tournament.rounds ?? []).map((round) => ({
    ...round,
    pairs: round.pairs?.map((pair) =>
      pair.map((p) => applyIdentityToPlayerSnapshot(p, playerId, userId, profile))) ?? round.pairs,
  }));
  return { ...tournament, players, rounds };
}
```

- [ ] **Step 2: Run focused test and verify GREEN**

Run:

```bash
npm test -- src/store/__tests__/tournamentStore.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit helper and tests**

Run:

```bash
git add src/store/tournamentStore.js src/store/__tests__/tournamentStore.test.js
git commit -m "test: cover claimed player profile substitution"
```

## Task 3: Claim RPC Migration

**Files:**
- Create: `supabase/migrations/20260529000000_claim_profile_substitution.sql`

- [ ] **Step 1: Create the migration**

Create the migration with this SQL:

```sql
-- ============================================================================
-- Shared invite claim: substitute claimed slot display identity from profile.
-- ============================================================================
--
-- Supersedes claim_tournament_player from
-- 20260522000002_fix_claim_jsonb_set.sql.
--
-- The claimed player id remains stable, so existing scores, shot details,
-- conflicts, notes, and per-round handicaps stay attached to the same player.
-- Only display/account identity fields are substituted.
-- ============================================================================

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
  v_uid          uuid   := auth.uid();
  v_idx          int;
  v_data         jsonb;
  v_players      jsonb;
  v_rounds       jsonb;
  v_slot         jsonb;
  v_claimed_slot jsonb;
  v_display_name text;
  v_username     text;
  v_avatar_url   text;
  v_name         text;
  v_now_ms       bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;

  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT data INTO v_data
    FROM public.tournaments
   WHERE id = p_tournament_id
   FOR UPDATE;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;

  v_players := v_data -> 'players';
  IF v_players IS NULL THEN
    RAISE EXCEPTION 'Tournament has no players';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  IF v_slot ->> 'user_id' IS NOT NULL
     AND v_slot ->> 'user_id' <> v_uid::text THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  SELECT display_name, username, avatar_url
    INTO v_display_name, v_username, v_avatar_url
    FROM public.profiles
   WHERE user_id = v_uid;

  v_name := COALESCE(NULLIF(trim(v_display_name), ''),
                     NULLIF(trim(v_username), ''),
                     v_slot ->> 'name');

  v_claimed_slot := v_slot || jsonb_build_object(
    'user_id', v_uid::text,
    'name', v_name
  );

  IF v_avatar_url IS NOT NULL AND length(trim(v_avatar_url)) > 0 THEN
    v_claimed_slot := v_claimed_slot || jsonb_build_object('avatar_url', v_avatar_url);
  END IF;

  v_data := v_data || jsonb_build_object(
              '_meta', COALESCE(v_data -> '_meta', '{}'::jsonb));
  v_data := jsonb_set(v_data,
              ARRAY['players', v_idx::text],
              v_claimed_slot, false);

  v_rounds := COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(round_elem -> 'pairs') = 'array' THEN
          jsonb_set(
            round_elem,
            '{pairs}',
            (
              SELECT jsonb_agg(
                (
                  SELECT jsonb_agg(
                    CASE
                      WHEN player_elem ->> 'id' = p_player_id THEN
                        player_elem || jsonb_build_object(
                          'user_id', v_uid::text,
                          'name', v_name
                        )
                        || CASE
                             WHEN v_avatar_url IS NOT NULL AND length(trim(v_avatar_url)) > 0
                             THEN jsonb_build_object('avatar_url', v_avatar_url)
                             ELSE '{}'::jsonb
                           END
                      ELSE player_elem
                    END
                    ORDER BY player_ord
                  )
                  FROM jsonb_array_elements(pair_elem) WITH ORDINALITY AS player_items(player_elem, player_ord)
                )
                ORDER BY pair_ord
              )
              FROM jsonb_array_elements(round_elem -> 'pairs') WITH ORDINALITY AS pair_items(pair_elem, pair_ord)
            ),
            false
          )
        ELSE round_elem
      END
      ORDER BY round_ord
    )
    FROM jsonb_array_elements(COALESCE(v_data -> 'rounds', '[]'::jsonb)) WITH ORDINALITY AS round_items(round_elem, round_ord)
  ), '[]'::jsonb);

  v_data := jsonb_set(v_data, '{rounds}', v_rounds, false);
  v_data := jsonb_set(v_data,
              ARRAY['_meta', 'players'],
              to_jsonb(v_now_ms), true);

  UPDATE public.tournaments SET data = v_data WHERE id = p_tournament_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;
```

- [ ] **Step 2: Commit the migration**

Run:

```bash
git add supabase/migrations/20260529000000_claim_profile_substitution.sql
git commit -m "fix: substitute claimed player identity from profile"
```

## Task 4: Verification

**Files:**
- No edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/store/__tests__/tournamentStore.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Review staged/uncommitted task files**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated dirty files remain; files from this plan are committed.

- [ ] **Step 4: Manual verification after migration deploy**

In Supabase SQL editor, run `supabase/migrations/20260529000000_claim_profile_substitution.sql`. Then:

1. Create a tournament with an unlinked player named `Noel`.
2. Enter a score for `Noel` if the round already exists.
3. Share an editor invite link.
4. Log in as account `Noe` and claim `Noel`.
5. Confirm roster, scorecard, and stats show `Noe`.
6. Confirm the old scores still appear under Noe's player row.
7. Confirm handicap remains the organiser-entered value.
