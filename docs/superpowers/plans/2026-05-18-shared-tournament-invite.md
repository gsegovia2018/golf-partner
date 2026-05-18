# Shared Tournament Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone join a casual tournament from one shared link/QR — playing anonymously if they have no account — and self-select (or auto-match) their player slot.

**Architecture:** "Continue without an account" calls Supabase anonymous sign-in, giving the guest a real `auth.uid()` so the entire existing casual stack (RLS, `tournament_members`, scoring via `mutate()`) works unchanged. A shared invite code (existing `tournament_invites` editor code) is turned into a path URL `/join-tournament/<code>` + QR. Claiming a player slot stamps `data.players[].user_id`; an atomic `SECURITY DEFINER` RPC makes the claim race-safe and locks the slot. Friends pre-bound to a slot skip selection.

**Tech Stack:** React Native (Expo) + React Navigation, Supabase (Postgres + RLS + RPCs), Jest for store/unit tests, `react-native-qrcode-svg`, Vercel for the web build.

**Spec:** `docs/superpowers/specs/2026-05-18-shared-tournament-invite-design.md`

**Pre-flight — read before starting:**
- `App.js:312-323` — `linking` config (currently routes only `JoinOfficial`).
- `App.js:235-261` — `AppNavigator`: renders `<AuthScreen />` when `!session`, else the Stack.
- `src/screens/JoinTournamentScreen.js` — 6-char code entry → `joinTournamentByCode` → `ClaimPlayer`.
- `src/screens/ClaimPlayerScreen.js` — "Which player are you?" picker; `claimExisting` uses `mutate('tournament.claimPlayer')`.
- `src/store/tournamentStore.js:392` `pushRemote` → `persistRemote` (full-blob `upsert` to `tournaments`).
- `src/store/mutate.js:115-121` — `tournament.claimPlayer` reducer (stamps `players` + `meId`).
- `supabase/migrations/20260418000000_add_users.sql:134-141` — `tournaments_update` policy (owner-only).
- `supabase/migrations/20260515000000_friends_and_feed.sql:123-141` — `can_edit_tournament` helper.
- `supabase/migrations/20260516000001_security_hardening.sql:116-162` — `redeem_invite_code` RPC.

**Manual step (do this once, in the Supabase dashboard — not code):** Auth → Providers → enable **Anonymous sign-ins**. Without it, Task 4's "Continue without an account" button fails at runtime. Note it in the PR description.

---

## Task 1: Vercel SPA rewrite + register the join-tournament deep link

**Files:**
- Create: `vercel.json`
- Modify: `App.js:312-323`

- [ ] **Step 1: Create `vercel.json`**

Path routes like `/join-tournament/ABC123` 404 on direct load/refresh without an SPA rewrite. Create `vercel.json` at the repo root:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 2: Add the `JoinTournament` route to the linking config**

In `App.js`, replace the `linking` block (currently lines 312-323):

```javascript
// Deep-link config: maps web URL paths to routes so invite links open the
// right flow directly. `join/:token` → official magic-token redeem;
// `join-tournament/:code` → casual shared-invite redeem + claim.
const linking = {
  prefixes: [typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://golf.app'],
  config: {
    screens: {
      JoinOfficial: 'join/:token',
      JoinTournament: 'join-tournament/:code',
    },
  },
};
```

- [ ] **Step 3: Verify the web build still bundles**

Run: `npx expo export --platform web`
Expected: completes without error; `dist/` is produced.

- [ ] **Step 4: Commit**

```bash
git add vercel.json App.js
git commit -m "feat: SPA rewrite + join-tournament deep link route"
```

---

## Task 2: Database migration — editor write access, immutable ownership, claim/release RPCs

This single migration does four things:
1. Rewrites `tournaments_update` to use `can_edit_tournament`, so **editor members** (including anonymous ones) can persist casual-tournament writes — required for guests to enter scores. `can_edit_tournament` already allows legacy `created_by IS NULL` rows, so this is safe for legacy data.
2. Adds a `BEFORE UPDATE` trigger that makes `tournaments.created_by` immutable. `persistRemote` (`tournamentStore.js`) sends `created_by = <current user>` on every save; once editors can UPDATE, that would silently transfer ownership. The trigger pins `created_by` to its original value.
3. `claim_tournament_player(tournament_id, player_id)` — atomically claims an open slot.
4. `release_tournament_player(tournament_id, player_id)` — owner-only; reopens a slot.

**Files:**
- Create: `supabase/migrations/20260518000004_shared_invite_claim.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260518000004_shared_invite_claim.sql`:

```sql
-- ============================================================================
-- Shared tournament invite: editor write access, immutable ownership,
-- and atomic player-slot claim / release.
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--
-- WHAT IT ADDS
-- ------------
--   1. tournaments_update policy now uses can_edit_tournament, so editor
--      members (incl. anonymous guests) can persist casual-tournament writes.
--   2. tournaments_created_by_immutable trigger pins created_by on UPDATE so
--      a non-owner editor's save cannot hijack ownership.
--   3. claim_tournament_player(text, text)   — atomic slot claim.
--   4. release_tournament_player(text, text) — owner-only slot release.
-- ============================================================================

-- 1) Editor members may UPDATE the tournament row -----------------------------
-- The original policy (20260418000000_add_users.sql) was owner-only. Casual
-- scoring by editor members goes through a direct UPDATE to tournaments.data,
-- so editors must be allowed. can_edit_tournament covers owner, legacy
-- NULL-owner rows, and editor/owner members.
DROP POLICY IF EXISTS tournaments_update ON public.tournaments;
CREATE POLICY tournaments_update ON public.tournaments
  FOR UPDATE TO authenticated
  USING (public.can_edit_tournament(id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(id, auth.uid()));

-- 2) created_by is immutable once set ----------------------------------------
-- persistRemote() upserts the whole row with created_by = the current user.
-- For a non-owner editor that would transfer ownership. Pin it.
CREATE OR REPLACE FUNCTION public.lock_tournament_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow a one-time set when the row had no owner (legacy back-fill);
  -- otherwise the original owner always wins.
  IF OLD.created_by IS NOT NULL THEN
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_created_by_immutable ON public.tournaments;
CREATE TRIGGER tournaments_created_by_immutable
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.lock_tournament_created_by();

-- 3) Atomic player-slot claim ------------------------------------------------
-- Sets data.players[i].user_id to the caller, but ONLY if that slot is still
-- unclaimed. The whole read-test-write happens in one statement so two
-- racing claimers cannot both win. The caller must already be an editor
-- member (established by redeem_invite_code) — that is the authorization.
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
  v_idx     int;
  v_players jsonb;
  v_slot    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT data -> 'players' INTO v_players
    FROM public.tournaments WHERE id = p_tournament_id;
  IF v_players IS NULL THEN
    RAISE EXCEPTION 'Tournament has no players';
  END IF;

  -- Locate the slot index by player id.
  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  -- Already claimed by someone else → race lost.
  IF v_slot ->> 'user_id' IS NOT NULL
     AND v_slot ->> 'user_id' <> v_uid::text THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  UPDATE public.tournaments
     SET data = jsonb_set(
           data,
           ARRAY['players', v_idx::text, 'user_id'],
           to_jsonb(v_uid::text),
           false)
   WHERE id = p_tournament_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

-- 4) Owner-only player-slot release ------------------------------------------
-- Clears data.players[i].user_id and removes that user's editor membership so
-- the slot reopens. Scores already entered stay attached (keyed by player id).
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
  v_uid       uuid := auth.uid();
  v_idx       int;
  v_slot      jsonb;
  v_claimer   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM public.tournaments t,
         jsonb_array_elements(t.data -> 'players') WITH ORDINALITY AS e(elem, ord)
   WHERE t.id = p_tournament_id
     AND elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  v_claimer := v_slot ->> 'user_id';

  UPDATE public.tournaments
     SET data = jsonb_set(
           data,
           ARRAY['players', v_idx::text],
           (v_slot - 'user_id'),
           false)
   WHERE id = p_tournament_id;

  -- Drop the released user's membership (unless they are the owner).
  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer::uuid) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer::uuid;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- tournaments_update now references can_edit_tournament:
   SELECT policyname, qual FROM pg_policies
    WHERE tablename = 'tournaments' AND policyname = 'tournaments_update';

   -- trigger present:
   SELECT tgname FROM pg_trigger WHERE tgname = 'tournaments_created_by_immutable';

   -- RPCs present and granted to authenticated only:
   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
                     has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_ok
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_tournament_player','release_tournament_player');
   =========================================================================== */
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or paste the file into the Supabase SQL editor and Run).
Expected: succeeds. Then run the VERIFY block — `tournaments_update.qual` should mention `can_edit_tournament`, the trigger row should appear, and both RPCs should show `auth_ok = true`, `anon_ok = false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000004_shared_invite_claim.sql
git commit -m "feat: editor write policy + immutable owner + claim/release RPCs"
```

---

## Task 3: Anonymous sign-in helper + store wrappers

Add the auth helper and the three `tournamentStore` functions the UI tasks call. TDD: the wrappers are tested with a mocked Supabase client.

**Files:**
- Modify: `src/lib/oauth.js` (append `signInAnonymously` helper)
- Modify: `src/store/tournamentStore.js` (append `claimTournamentPlayer`, `releaseTournamentPlayer`, `buildJoinLink`)
- Test: `src/store/__tests__/sharedInvite.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/sharedInvite.test.js`:

```javascript
import { buildJoinLink } from '../tournamentStore';

describe('buildJoinLink', () => {
  test('builds a path URL from an origin and code', () => {
    expect(buildJoinLink('https://golf.example.com', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('strips a trailing slash from the origin', () => {
    expect(buildJoinLink('https://golf.example.com/', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('falls back to the production origin when none is given', () => {
    expect(buildJoinLink('', 'XYZ789'))
      .toBe('https://golf.app/join-tournament/XYZ789');
  });

  test('upper-cases the code', () => {
    expect(buildJoinLink('https://golf.app', 'abc123'))
      .toBe('https://golf.app/join-tournament/ABC123');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/sharedInvite.test.js`
Expected: FAIL — `buildJoinLink is not a function`.

- [ ] **Step 3: Add `buildJoinLink` to `tournamentStore.js`**

Append to `src/store/tournamentStore.js` (after `joinTournamentByCode`, around line 1188):

```javascript
// Build the shareable web URL for a casual-tournament invite code. The path
// `/join-tournament/<code>` is handled by the linking config in App.js (and,
// pre-session, by the JoinTournamentLink interception). A no-app recipient
// simply lands on the Vercel web build.
export function buildJoinLink(origin, code) {
  const base = (origin || 'https://golf.app').replace(/\/+$/, '');
  return `${base}/join-tournament/${String(code ?? '').toUpperCase()}`;
}

// Atomic player-slot claim. Wraps the claim_tournament_player RPC (migration
// 20260518000004). Throws Error('SLOT_TAKEN') when another joiner won the
// race; the caller refreshes the picker on that.
export async function claimTournamentPlayer(tournamentId, playerId) {
  const { data, error } = await supabase
    .rpc('claim_tournament_player', {
      p_tournament_id: String(tournamentId),
      p_player_id: String(playerId),
    });
  if (error) {
    if ((error.message || '').includes('SLOT_TAKEN')) {
      throw new Error('SLOT_TAKEN');
    }
    throw error;
  }
  return data; // the claimed player id
}

// Owner-only: clear a player slot's user_id and drop that member, reopening
// the slot. Wraps the release_tournament_player RPC.
export async function releaseTournamentPlayer(tournamentId, playerId) {
  const { error } = await supabase
    .rpc('release_tournament_player', {
      p_tournament_id: String(tournamentId),
      p_player_id: String(playerId),
    });
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/sharedInvite.test.js`
Expected: PASS — all 4 `buildJoinLink` tests green.

- [ ] **Step 5: Add the `signInAnonymously` helper**

Append to `src/lib/oauth.js`:

```javascript
import { supabase } from './supabase';

/**
 * Start an anonymous Supabase session. Used by the "Continue without an
 * account" path on the join screen: the guest gets a real (but anonymous)
 * auth.uid(), so every RLS-gated casual feature works for them unchanged.
 *
 * Requires "Anonymous sign-ins" to be enabled in the Supabase dashboard
 * (Auth → Providers). Throws the Supabase AuthError on failure.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session>} the new session
 */
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}
```

> Note: `oauth.js` previously had no imports. Adding the `import { supabase }` line at the top is intentional and required.

- [ ] **Step 6: Run the full store test suite to confirm nothing regressed**

Run: `npx jest src/store`
Expected: PASS — existing `tournamentStore.test.js` tests plus the new `sharedInvite.test.js` all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/oauth.js src/store/tournamentStore.js src/store/__tests__/sharedInvite.test.js
git commit -m "feat: anonymous sign-in helper + claim/release/join-link store wrappers"
```

---

## Task 4: Pre-session join screen — `JoinTournamentLinkScreen`

When a logged-out user opens `/join-tournament/<code>` on the web build, `AppNavigator` renders `<AuthScreen />` and the Stack is not mounted, so linking cannot route. This task adds a screen that intercepts that case and offers *Log in* / *Continue without an account*. Once a session exists (anonymous or real), `AppNavigator` re-renders, the Stack mounts, and the existing `linking` config (Task 1) routes `/join-tournament/<code>` → the `JoinTournament` screen.

**Files:**
- Create: `src/screens/JoinTournamentLinkScreen.js`
- Modify: `App.js:235-261` (`AppNavigator` — intercept the route pre-session)

- [ ] **Step 1: Create `JoinTournamentLinkScreen.js`**

```javascript
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { signInAnonymously } from '../lib/oauth';
import AuthScreen from './AuthScreen';

// Shown (pre-session, web) when someone opens a /join-tournament/<code> link
// without being signed in. They choose: log in with an existing account, or
// continue anonymously. Either path establishes a Supabase session; once it
// exists, AppNavigator mounts the Stack and the linking config routes the
// same URL to the JoinTournament screen, which redeems the code.
export default function JoinTournamentLinkScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // When true, defer to the normal AuthScreen for email/social login.
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  if (showLogin) return <AuthScreen />;

  async function continueAnon() {
    if (busy) return;
    setBusy(true);
    try {
      await signInAnonymously();
      // On success the AuthContext session updates and App re-renders into
      // the Stack; no navigation call is needed here.
    } catch (err) {
      setBusy(false);
      Alert.alert(
        'Could not continue',
        err?.message
          ? `${err.message}\n\nIf this keeps happening, ask the organiser to share the link again.`
          : 'Could not start a guest session. Please try again.',
      );
    }
  }

  return (
    <View style={s.screen}>
      <View style={s.content}>
        <View style={s.icon}>
          <Feather name="flag" size={32} color={theme.accent.primary} />
        </View>
        <Text style={s.title}>You're invited to a round</Text>
        <Text style={s.subtitle}>
          Join the tournament to enter scores. Log in if you already have a
          Golf Partner account, or jump straight in as a guest.
        </Text>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={continueAnon}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color={theme.text.inverse} />
            : <Text style={s.primaryBtnText}>Continue without an account</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => setShowLogin(true)}
          disabled={busy}
          activeOpacity={0.7}
        >
          <Text style={s.secondaryBtnText}>I have an account — log in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
  content: {
    flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center',
    width: '100%', maxWidth: 460, alignSelf: 'center',
  },
  icon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: theme.text.primary,
    marginBottom: 8, textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.muted,
    textAlign: 'center', marginBottom: 32, maxWidth: 320, lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 14, padding: 16,
    alignItems: 'center', width: '100%', marginBottom: 12,
  },
  primaryBtnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 16,
  },
  secondaryBtn: { padding: 14, alignItems: 'center', width: '100%' },
  secondaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 15,
  },
});
```

- [ ] **Step 2: Intercept the route in `AppNavigator`**

In `App.js`, add the import near the other screen imports (after line 29, `import AuthScreen`):

```javascript
import JoinTournamentLinkScreen from './src/screens/JoinTournamentLinkScreen';
```

Then replace the no-session branch in `AppNavigator` (currently `App.js:261`, `if (!session) return <AuthScreen />;`) with:

```javascript
  if (!session) {
    // A logged-out visitor opening a /join-tournament/<code> web link gets
    // the guest/login choice instead of the bare sign-up wall. After a
    // session is established the Stack mounts and the linking config routes
    // the same URL to the JoinTournament screen.
    const path = typeof window !== 'undefined' && window.location
      ? window.location.pathname
      : '';
    if (/^\/join-tournament\/[^/]+/.test(path)) {
      return <JoinTournamentLinkScreen />;
    }
    return <AuthScreen />;
  }
```

- [ ] **Step 3: Manual verification (web)**

Run: `npx expo start --web`, then in a logged-out browser open `http://localhost:8081/join-tournament/TESTCODE`.
Expected: the "You're invited to a round" screen renders with two buttons (not the bare auth wall). "I have an account — log in" swaps to the normal `AuthScreen`. Opening `http://localhost:8081/` (no path) still shows the normal `AuthScreen`.

- [ ] **Step 4: Commit**

```bash
git add App.js src/screens/JoinTournamentLinkScreen.js
git commit -m "feat: pre-session join screen with guest / log-in choice"
```

---

## Task 5: Auto-redeem + friend auto-match in `JoinTournamentScreen`

`JoinTournamentScreen` currently always shows a manual 6-char code field. When it is reached via the deep link it receives `route.params.code` and should redeem automatically; and when the joiner is already pre-bound to a slot (a friend the creator added from their friends list — that slot's `user_id` equals the joiner's `auth.uid()`), it should skip the picker entirely.

**Files:**
- Modify: `src/screens/JoinTournamentScreen.js`
- Test: `src/store/__tests__/sharedInvite.test.js` (extend)

- [ ] **Step 1: Write the failing test for the auto-match helper**

Append to `src/store/__tests__/sharedInvite.test.js`:

```javascript
import { findClaimedSlot } from '../tournamentStore';

describe('findClaimedSlot', () => {
  const players = [
    { id: 'p1', name: 'Ann', user_id: 'uid-ann' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Cat', user_id: 'uid-cat' },
  ];

  test('returns the slot whose user_id matches the joiner', () => {
    expect(findClaimedSlot(players, 'uid-cat')).toEqual(
      { id: 'p3', name: 'Cat', user_id: 'uid-cat' });
  });

  test('returns null when no slot is pre-bound to the joiner', () => {
    expect(findClaimedSlot(players, 'uid-zoe')).toBeNull();
  });

  test('returns null for an empty roster or missing uid', () => {
    expect(findClaimedSlot([], 'uid-ann')).toBeNull();
    expect(findClaimedSlot(players, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/sharedInvite.test.js`
Expected: FAIL — `findClaimedSlot is not a function`.

- [ ] **Step 3: Add `findClaimedSlot` to `tournamentStore.js`**

Append to `src/store/tournamentStore.js` (next to `buildJoinLink` from Task 3):

```javascript
// Find the player slot already bound to a given user id, if any. Used to
// auto-match a joiner (a friend the creator added from their friends list,
// whose slot carries their user_id) so they skip the "which player?" picker.
export function findClaimedSlot(players, userId) {
  if (!userId || !Array.isArray(players)) return null;
  return players.find((p) => p && p.user_id === userId) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/sharedInvite.test.js`
Expected: PASS — the 3 new `findClaimedSlot` tests green alongside the earlier ones.

- [ ] **Step 5: Auto-redeem + auto-match in `JoinTournamentScreen`**

In `src/screens/JoinTournamentScreen.js`, update the imports (line 1 and line 8):

```javascript
import React, { useEffect, useRef, useState } from 'react';
```

```javascript
import {
  joinTournamentByCode, setActiveTournament, getTournament, findClaimedSlot,
} from '../store/tournamentStore';
import { supabase } from '../lib/supabase';
```

The component needs the joiner's user id to auto-match a pre-bound slot. Get it directly from the Supabase client (`JoinOfficialScreen.js` already imports `supabase` from `../lib/supabase` the same way).

Replace the component body's `handleJoin` and add an auto-run effect. Replace lines 16-38 (`const initialCode` through the end of `handleJoin`) with:

```javascript
  // Deep-link / share URLs deliver the code via route.params.code; manual
  // entry still works when the screen is opened from the Home "Join" tile.
  const initialCode = (route?.params?.code ?? '').toString().toUpperCase().slice(0, 8);
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  // True while the deep-link path is auto-redeeming, so we show a spinner
  // instead of the manual code field.
  const [autoJoining, setAutoJoining] = useState(initialCode.length >= 6);
  const didAutoJoin = useRef(false);

  async function handleJoin() {
    if (code.trim().length < 6) return;
    setLoading(true);
    try {
      const { tournamentId, role } = await joinTournamentByCode(code.trim());
      await setActiveTournament(tournamentId);
      if (role !== 'editor') {
        // Viewers are read-only — straight in.
        navigation.goBack();
        return;
      }
      // Editor: if a slot is already bound to this account (a friend the
      // creator added from their friends list), skip the picker.
      const [t, { data: { user } }] = await Promise.all([
        getTournament(tournamentId), supabase.auth.getUser(),
      ]);
      const mine = findClaimedSlot(t?.players ?? [], user?.id);
      if (mine) {
        navigation.replace('Tournament', { tournamentId });
      } else {
        navigation.replace('ClaimPlayer', { tournamentId });
      }
    } catch (err) {
      setAutoJoining(false);
      Alert.alert('Error', err.message ?? 'Could not join tournament');
    } finally {
      setLoading(false);
    }
  }

  // Auto-redeem when arriving via a deep link (code already present).
  useEffect(() => {
    if (didAutoJoin.current) return;
    if (initialCode.length >= 6) {
      didAutoJoin.current = true;
      handleJoin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Then, in the JSX, replace the `<View style={s.content}>` block (lines 50-86) so it shows a spinner while auto-joining:

```javascript
      {autoJoining ? (
        <View style={s.content}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
          <Text style={[s.subtitle, { marginTop: 16 }]}>Joining tournament…</Text>
        </View>
      ) : (
        <View style={s.content}>
          <View style={s.icon}>
            <Feather name="link" size={32} color={theme.accent.primary} />
          </View>
          <Text style={s.title}>Enter Invite Code</Text>
          <Text style={s.subtitle}>Ask the tournament owner for their invite code.</Text>

          <TextInput
            style={s.codeInput}
            placeholder="ABC123"
            placeholderTextColor={theme.text.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            onSubmitEditing={handleJoin}
          />

          <TouchableOpacity
            style={[s.btn, (loading || code.length < 6) && { opacity: 0.5 }]}
            onPress={handleJoin}
            disabled={loading || code.length < 6}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : (
                <>
                  <Feather name="log-in" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                  <Text style={s.btnText}>Join</Text>
                </>
              )}
          </TouchableOpacity>
        </View>
      )}
```

> Invite codes are 8 chars (`generateInviteCode`, `tournamentStore.js:1096-1099`); `maxLength` is widened from 6 to 8 and the `slice` in `initialCode` from 6 to 8. The `< 6` length guards stay — any code of 6+ chars is sent to the server RPC, and 8-char codes pass that floor.

- [ ] **Step 6: Run the store tests**

Run: `npx jest src/store`
Expected: PASS — all tests green.

- [ ] **Step 7: Manual verification**

Run the web app, sign in, and open `/join-tournament/<a-real-editor-code>`.
Expected: the screen shows "Joining tournament…" then lands on either the tournament (if a slot was pre-bound to you) or the `ClaimPlayer` picker. Opening `JoinTournament` from the Home "Join" tile with no code still shows the manual entry field.

- [ ] **Step 8: Commit**

```bash
git add src/screens/JoinTournamentScreen.js src/store/tournamentStore.js src/store/__tests__/sharedInvite.test.js
git commit -m "feat: auto-redeem deep-link codes and auto-match pre-bound slots"
```

---

## Task 6: Race-safe claim + locked slots in `ClaimPlayerScreen`

`ClaimPlayerScreen` already shows the picker, disables slots taken by others, and lets the joiner add themselves. Switch the claim from the local-only `mutate('tournament.claimPlayer')` to the atomic `claimTournamentPlayer` RPC (Task 3), so two joiners cannot both win a slot and a claim cannot be clobbered by the players-array last-write-wins merge. After the RPC succeeds, refresh the tournament and set the local `meId`.

**Files:**
- Modify: `src/screens/ClaimPlayerScreen.js`

- [ ] **Step 1: Update imports**

In `src/screens/ClaimPlayerScreen.js`, replace the `tournamentStore` import (line 10):

```javascript
import {
  getTournament, addPlayerRoundPatches, claimTournamentPlayer,
} from '../store/tournamentStore';
```

- [ ] **Step 2: Replace `claimExisting` with the RPC-backed version**

Replace the whole `claimExisting` function (lines 58-74) with:

```javascript
  async function claimExisting(player) {
    if (saving || !tournament || !profile) return;
    setSaving(true);
    setClaimingId(player.id);
    try {
      // Atomic, race-safe claim — the RPC sets data.players[].user_id only
      // if the slot is still open (migration 20260518000004).
      await claimTournamentPlayer(tournament.id, player.id);
      // Re-pull so the local copy reflects the server-side claim, then point
      // "me" at the claimed slot for this device.
      const fresh = await getTournament(tournament.id);
      await mutate(fresh, { type: 'tournament.setMe', meId: player.id });
      done();
    } catch (err) {
      if (err?.message === 'SLOT_TAKEN') {
        // Someone else took it first — refresh the roster so the row
        // re-renders as "Taken".
        try {
          const fresh = await getTournament(tournament.id);
          setTournament(fresh);
        } catch (_) { /* keep the stale roster; the alert is enough */ }
        Alert.alert('Already taken',
          'Someone else just claimed that player. Pick another.');
      } else {
        Alert.alert('Error', err.message ?? 'Could not link you to that player');
      }
      setSaving(false);
      setClaimingId(null);
    }
  }
```

> `addNewPlayer` (lines 76-102) keeps using `mutate('tournament.addPlayer')` + `mutate('tournament.setMe')` — adding a brand-new slot has no race to lose, and the new row carries `user_id: profile.userId` so it is born claimed. `mutate` is already imported (line 12).

- [ ] **Step 3: Manual verification — happy path**

Run the web app, join a tournament via an editor code as a second account, and on the `ClaimPlayer` screen tap an open player.
Expected: a spinner on that row, then the screen closes into the tournament. Re-opening `ClaimPlayer` shows that player as "· You".

- [ ] **Step 4: Manual verification — race**

Open the same `ClaimPlayer` screen in two browsers (two different accounts), and claim the *same* player in both within a second.
Expected: one succeeds; the other shows the "Already taken" alert and that row becomes "Taken".

- [ ] **Step 5: Commit**

```bash
git add src/screens/ClaimPlayerScreen.js
git commit -m "feat: race-safe player-slot claim via RPC"
```

---

## Task 7: Release a claimed slot from `MembersScreen`

`MembersScreen` lists tournament members. Add an owner-only "Release" control that reopens a claimed player slot via `releaseTournamentPlayer` (Task 3). Member rows are keyed by `user_id`; map each member to the player slot they claimed via `data.players[].user_id`.

**Files:**
- Modify: `src/screens/MembersScreen.js`

- [ ] **Step 1: Load the tournament roster alongside members**

In `src/screens/MembersScreen.js`, update the `tournamentStore` import (lines 13-15):

```javascript
import {
  loadTournamentMembers, removeTournamentMember, generateInviteCode,
  getTournament, releaseTournamentPlayer,
} from '../store/tournamentStore';
```

Add state next to the others (after line 34, `const [rows, setRows] = useState([]);`):

```javascript
  // Player slots in this tournament, used to map a member → the slot they
  // claimed so the owner can release it.
  const [players, setPlayers] = useState([]);
  const [releasingId, setReleasingId] = useState(null);
```

In the `load` callback (lines 42-53), also fetch the tournament. Replace the `try`/`catch`/`finally` body (lines 46-52) with:

```javascript
    try {
      const [members, t] = await Promise.all([
        loadTournamentMembers(tournamentId),
        getTournament(tournamentId),
      ]);
      setRows(members);
      setPlayers(t?.players ?? []);
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load members');
    } finally {
      setLoading(false);
    }
```

- [ ] **Step 2: Add the release handler**

Add this function inside the component, immediately after `confirmRemove` (after line 82):

```javascript
  async function releaseSlot(row, slot) {
    const name = slot?.name || row.profile?.display_name || 'this player';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Release the "${name}" slot? They will be removed and the slot reopens for someone else to claim.`)
      : await new Promise((resolve) => Alert.alert(
          'Release player slot',
          `Release the "${name}" slot? They will be removed and the slot reopens.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Release', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setReleasingId(row.userId);
    try {
      await releaseTournamentPlayer(tournamentId, slot.id);
      await load();
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not release the slot');
    } finally {
      setReleasingId(null);
    }
  }
```

- [ ] **Step 3: Render the Release control on claimed non-owner rows**

In the member-row render (the `rows.map((row) => { … })` block, lines 193-265), compute the claimed slot just before the `return (`. Find the line `const canRemove = iAmOwner && row.role !== 'owner' && !isSelf;` (line 206) and add directly below it:

```javascript
            const claimedSlot = players.find((p) => p.user_id === row.userId) ?? null;
```

Then, inside `<View style={s.rowActions}>` (after the role-change `TouchableOpacity`, before the remove `TouchableOpacity` — around line 248), insert:

```javascript
                    {canRemove && claimedSlot && (
                      releasingId === row.userId
                        ? <ActivityIndicator color={theme.accent.primary} />
                        : (
                          <TouchableOpacity
                            onPress={() => releaseSlot(row, claimedSlot)}
                            style={s.roleActionBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel={`Release the ${claimedSlot.name} player slot`}
                          >
                            <Feather name="rotate-ccw" size={15} color={theme.accent.primary} />
                          </TouchableOpacity>
                        )
                    )}
```

> Reuses the existing `s.roleActionBtn` style. No new styles needed.

- [ ] **Step 4: Manual verification**

As the tournament owner, open `MembersScreen` for a tournament where a guest has claimed a slot.
Expected: the guest's row shows a circular-arrow Release button. Tapping it confirms, then the member disappears from the list. Re-opening `ClaimPlayer` via the invite link shows that player slot as open again, with any scores still attached.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MembersScreen.js
git commit -m "feat: owner can release a claimed player slot"
```

---

## Task 8: Share the join link + QR (HomeScreen and MembersScreen)

Repoint both invite surfaces from the bare code / `?invite=` URL to the path-based `/join-tournament/<code>` link built by `buildJoinLink` (Task 3).

**Files:**
- Modify: `src/screens/HomeScreen.js` (invite modal QR + share text — around lines 1452-1476)
- Modify: `src/screens/MembersScreen.js` (`handleInvite`, lines 84-102)

- [ ] **Step 1: Repoint the HomeScreen QR + share value**

In `src/screens/HomeScreen.js`, add `buildJoinLink` to the `tournamentStore` import block that already includes `generateInviteCode` (near line 25):

```javascript
  DEFAULT_SETTINGS, generateInviteCode, buildJoinLink,
```

In the invite modal's QR block (lines 1455-1460), replace the `origin` / `qrValue` computation with:

```javascript
                  const origin = Platform.OS === 'web' && typeof window !== 'undefined'
                    ? window.location.origin
                    : '';
                  const qrValue = buildJoinLink(origin, inviteCode);
```

`buildJoinLink` falls back to `https://golf.app` when `origin` is empty, so the QR always encodes a full URL. If a "Share link" / copy button elsewhere in this modal still uses the old `${origin}/?invite=` string, replace that string with `buildJoinLink(origin, inviteCode)` too — grep the file for `?invite=` to find every occurrence.

- [ ] **Step 2: Repoint the MembersScreen invite share**

In `src/screens/MembersScreen.js`, add `buildJoinLink` to the import updated in Task 7:

```javascript
import {
  loadTournamentMembers, removeTournamentMember, generateInviteCode,
  getTournament, releaseTournamentPlayer, buildJoinLink,
} from '../store/tournamentStore';
```

Replace the body of `handleInvite` (lines 84-102) with:

```javascript
  async function handleInvite() {
    if (inviting) return;
    setInviting(true);
    try {
      const { editorCode } = await generateInviteCode(tournamentId);
      const origin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : '';
      const link = buildJoinLink(origin, editorCode);
      const message = `Join "${tournamentName ?? 'my tournament'}" on Golf Partner:\n${link}`;
      if (Platform.OS === 'web') {
        try { await navigator.clipboard?.writeText(link); } catch (_) {}
        window.alert(`Invite link copied:\n${link}`);
      } else {
        await Share.share({ message });
      }
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not create invite link');
    } finally {
      setInviting(false);
    }
  }
```

- [ ] **Step 3: Manual verification**

Open a tournament's invite modal on the web build.
Expected: the QR encodes `https://<origin>/join-tournament/<CODE>`; opening that URL reaches the join flow. `MembersScreen` → Invite copies/shares the same path URL, not a bare code.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js src/screens/MembersScreen.js
git commit -m "feat: invite QR and share use the join-tournament link"
```

---

## Task 9: Anonymous "save your account" prompt

An anonymous guest who claims a slot is tied to that browser. Surface a dismissable banner pointing them at account creation so their slot/scores survive a device change. Supabase lets an anonymous user be upgraded by linking an email — a full link-email UI is out of scope here; this task ships the *prompt* that routes them to the existing Profile flow.

**Files:**
- Modify: `src/screens/ClaimPlayerScreen.js`

- [ ] **Step 1: Detect an anonymous session**

Confirm how the app exposes the session user: run `grep -n "is_anonymous\|isAnonymous\|user" src/context/AuthContext.js`. The Supabase user object carries `is_anonymous: true` for anonymous sessions (`user.is_anonymous`). Use whatever field name `AuthContext` exposes; if it exposes the raw Supabase `user`, `user.is_anonymous` is correct.

- [ ] **Step 2: Add the banner to `ClaimPlayerScreen`**

In `src/screens/ClaimPlayerScreen.js`, add the auth-context import at the top (after the other imports, ~line 12):

```javascript
import { useAuth } from '../context/AuthContext';
```

Inside the component, read the user and compute the flag (just after `const tournamentId = route?.params?.tournamentId;`, ~line 22):

```javascript
  const { user } = useAuth();
  const isAnon = !!user?.is_anonymous;
```

In the JSX, directly above the closing `</ScrollView>` of the content block (after the "Not listed? Add yourself" `<View style={s.section}>`, ~line 237), add:

```javascript
          {isAnon && (
            <TouchableOpacity
              style={s.saveAccountBox}
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.8}
            >
              <Feather name="bookmark" size={16} color={theme.accent.primary} style={{ marginRight: 10 }} />
              <Text style={s.saveAccountText}>
                You're playing as a guest. Add an email in your profile so you
                keep this tournament if you switch devices.
              </Text>
            </TouchableOpacity>
          )}
```

Add the two styles to `makeStyles` (next to `noticeBox` / `noticeText`):

```javascript
  saveAccountBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 12,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    padding: 12, marginTop: 4,
  },
  saveAccountText: {
    flex: 1, fontFamily: 'PlusJakartaSans-Medium',
    color: theme.text.secondary, fontSize: 13, lineHeight: 19,
  },
```

> If `ProfileScreen` has no email-linking UI, the banner still correctly lands the guest on their profile; wiring `supabase.auth.updateUser({ email })` for anonymous upgrade is a documented follow-up, not part of this plan.

- [ ] **Step 3: Manual verification**

Open `/join-tournament/<code>` logged out → "Continue without an account" → claim a slot.
Expected: the "playing as a guest" banner appears on the `ClaimPlayer` screen and taps through to Profile. A logged-in (non-anonymous) joiner does **not** see the banner.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ClaimPlayerScreen.js
git commit -m "feat: prompt anonymous guests to save their account"
```

---

## Task 10: End-to-end verification + PR

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: PASS — all suites green, including `sharedInvite.test.js` and `tournamentStore.test.js`.

- [ ] **Step 2: Confirm the Supabase manual step is done**

In the Supabase dashboard: Auth → Providers → **Anonymous sign-ins** is enabled. (Without it, Task 4's "Continue without an account" throws at runtime.)

- [ ] **Step 3: Full manual walkthrough on the web build**

Run: `npx expo start --web`. With a real editor invite code, verify all four spec scenarios:
1. **Guest:** logged-out → open `/join-tournament/<code>` → "Continue without an account" → pick a slot → enter a score on a round. Score persists after reload.
2. **Friend auto-match:** as a user whose account is pre-bound to a slot (creator added them from the friends list), open the link → lands straight in the tournament, no picker.
3. **Race:** two browsers claim the same slot at once → exactly one wins, the other sees "Already taken".
4. **Release:** owner opens `MembersScreen` → releases a claimed slot → it reappears as open in `ClaimPlayer`, with scores intact.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feature/shared-tournament-invite
```

Then open a PR titled **"Shared tournament invite — guest join + slot claiming"**. In the description, include the **manual steps**: "Enable Anonymous sign-ins in Supabase (Auth → Providers) before/at deploy" and "Apply migration `20260518000004_shared_invite_claim.sql`."

---

## Notes for the implementer

- **Invite codes are 8 characters** (`generateInviteCode`, `tournamentStore.js:1096-1099`), not 6. Task 5 widens the input accordingly; the `>= 6` length guard is a floor, not an exact match.
- **`meId` is stored in the shared blob** and last-write-wins. Setting it on claim matches the pre-existing `tournament.claimPlayer` behaviour; do not try to make it per-device in this plan.
- **Native deep links** are deliberately not configured (no Universal Links / App Links). An installed app opening the link gets the web build — acceptable per the spec's non-goals.
- **`?invite=CODE` legacy handling** in `HomeScreen.js:256-266` can be left as-is for back-compatibility; the new path route is additive.
- **Anonymous accounts** accumulate in `auth.users`; acceptable at this app's scale (spec "Open Risks"). A periodic cleanup job is a possible follow-up, not in scope.
