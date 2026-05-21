# Unified "Players" Gear-Menu Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gear menu's Add Player / Remove Player / Members items and the handicap editing buried in Edit Tournament with one **Players** item opening a single unified `PlayersScreen`.

**Architecture:** Build a new roster-major `PlayersScreen` additively (it is reachable but parallel to the old items while under construction), porting reusable logic verbatim from `MembersScreen`, `EditTournamentScreen`, and `HomeScreen`. Once the new screen is complete, strip the relocated code from `HomeScreen` and `EditTournamentScreen`, then delete the now-dead `MembersScreen` and `PlayerRemoveSheet`. This keeps the app building and runnable at every commit.

**Tech Stack:** React Native 0.81 / React 19 / Expo SDK 54, `@react-navigation` stack, plain JS store modules in `src/store/`, theme via `useTheme()`.

**Testing note:** This is a UI relocation refactor. The codebase has **no screen-level Jest tests** — the suite is store/lib-focused and the store mutations being reused (`tournament.addPlayer`, `tournament.removePlayer`, `handicap.set`) are already covered and unchanged. Fabricating an RN screen-test harness would violate YAGNI and the codebase pattern. Therefore each task is verified by: `npm run lint` clean, `npm test` fully green, and a described manual smoke check. No new test files are created.

**Spec:** `docs/superpowers/specs/2026-05-21-unified-players-gear-menu-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/screens/PlayersScreen.js` | Unified roster + handicaps + members screen | **Create** |
| `App.js` | Register `Players` route; drop `Members` route | Modify |
| `src/screens/HomeScreen.js` | Gear menu: 1 Players item; lose add/remove cluster | Modify |
| `src/screens/EditTournamentScreen.js` | Lose handicap UI; keep round/course structure | Modify |
| `src/screens/MembersScreen.js` | — | **Delete** |
| `src/components/PlayerRemoveSheet.js` | — | **Delete** |

### Key facts (verified against the codebase)

- A roster slot (`tournament.players[i]`) has `{ id, name, handicap, user_id }`. `user_id` is the claiming member's id or `null`. Slot → member: `members.find(m => m.userId === p.user_id)`.
- `findClaimedSlot(players, userId)` returns the slot a member claimed (`p.user_id === userId`).
- `playerInitials(name)` is exported from `src/components/RoundTeeAssignments.js`.
- The PlayerPicker → caller bridge: `src/lib/selectionBridge.js` — PlayerPicker `confirm()` calls `setPendingPlayers(selected)` then `navigation.goBack()`; the caller consumes via `consumePendingPlayers()` on a `focus` listener.
- `loadTournament()` (no arg) returns the **active** tournament — the one the gear menu belongs to. `EditTournamentScreen` already relies on this; `PlayersScreen` does the same for the editable roster/rounds, and uses the `tournamentId` route param only for member queries.
- `isViewer` / `isOwner` are derived from the members list: owner = `members.find(m => m.role === 'owner')`, my role = `members.find(m => m.userId === user.id)?.role`.

---

## Task 1: Scaffold PlayersScreen (read-only) + route + gear item

**Files:**
- Create: `src/screens/PlayersScreen.js`
- Modify: `App.js` (import + `Stack.Screen`)
- Modify: `src/screens/HomeScreen.js` (gear menu — add Players item)

- [ ] **Step 1: Create `src/screens/PlayersScreen.js`**

Create the file with this exact content. This is a read-only skeleton: it loads the tournament + members, derives roles, and renders the roster (avatar / name / role badge / handicap as text). Editing, add/remove, tees, invite, and leave are added in later tasks.

```jsx
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  loadTournament, loadTournamentMembers, findClaimedSlot,
} from '../store/tournamentStore';
import { playerInitials } from '../components/RoundTeeAssignments';

export default function PlayersScreen({ navigation, route }) {
  const { tournamentId, tournamentName } = route.params ?? {};
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const [tournament, setTournament] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, mem] = await Promise.all([
        loadTournament(),
        tournamentId ? loadTournamentMembers(tournamentId) : Promise.resolve([]),
      ]);
      setTournament(t);
      setMembers(mem);
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load players');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ownerRow = members.find((m) => m.role === 'owner');
  const isOwner = !!ownerRow && ownerRow.userId === user?.id;
  const myRow = members.find((m) => m.userId === user?.id);
  const isViewer = myRow?.role === 'viewer';

  const players = tournament?.players ?? [];

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Players</Text>
          {tournamentName ? <Text style={s.headerSubtitle} numberOfLines={1}>{tournamentName}</Text> : null}
        </View>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : loadError ? (
        <View style={s.errorBox}>
          <Feather name="wifi-off" size={22} color={theme.destructive} />
          <Text style={s.errorTitle}>Couldn't load players</Text>
          <Text style={s.errorMsg}>{loadError}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.7}>
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text style={s.sectionLabel}>{players.length} {players.length === 1 ? 'player' : 'players'}</Text>
          {players.map((p) => {
            const member = members.find((m) => m.userId === p.user_id) || null;
            const color = member?.profile?.avatar_color || theme.accent.primary;
            return (
              <View key={p.id} style={s.row}>
                <View style={[s.avatar, { backgroundColor: color }]}>
                  {member?.profile?.avatar_url
                    ? <Image source={{ uri: member.profile.avatar_url }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{playerInitials(p.name)}</Text>}
                </View>
                <View style={s.info}>
                  <Text style={s.name}>{p.name}</Text>
                  <View style={s.metaRow}>
                    {member ? (
                      <View style={[s.roleBadge, member.role === 'owner' && s.roleBadgeOwner]}>
                        <Text style={[s.roleText, member.role === 'owner' && s.roleTextOwner]}>
                          {member.role.toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={s.metaText}>HCP {p.handicap}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerSubtitle: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 15 },
  info: { flex: 1 },
  name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.bg.secondary },
  roleBadgeOwner: { backgroundColor: 'rgba(212,175,55,0.15)' },
  roleText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted, letterSpacing: 0.8 },
  roleTextOwner: { color: '#d4af37' },
  // --- handicap input (Task 2) ---
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 54, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 7,
  },
  // --- save pill (Task 2) ---
  savePill: {
    flexDirection: 'row', alignItems: 'center', minWidth: 64, justifyContent: 'center',
    backgroundColor: theme.bg.secondary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 8, paddingVertical: 4,
  },
  savePillSaved: { borderColor: theme.accent.primary + '55' },
  savePillError: { borderColor: theme.destructive, backgroundColor: theme.destructive + '15' },
  savePillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted },
  savePillTextError: { color: theme.destructive },
  // --- row actions (Tasks 4 & 5) ---
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleActionBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: theme.accent.light,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: { padding: 8 },
  // --- add / invite / leave buttons (Tasks 4 & 5) ---
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.accent.light, borderRadius: 12,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    padding: 14, marginTop: 6,
  },
  inviteBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, marginTop: 24, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
  },
  leaveBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 14 },
  // --- tees section (Task 3) ---
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  roundCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  roundCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 14, marginBottom: 8,
  },
  // --- error box ---
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, marginTop: 10 },
  errorMsg: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.accent.light,
    borderRadius: 10, borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
```

- [ ] **Step 2: Register the `Players` route in `App.js`**

Add the import near the other screen imports (next to `import MembersScreen from './src/screens/MembersScreen';` at line 62):

```jsx
import PlayersScreen from './src/screens/PlayersScreen';
```

Add the screen registration immediately after the `Members` line (`App.js:350`):

```jsx
        <Stack.Screen name="Players" component={PlayersScreen} />
```

- [ ] **Step 3: Add the "Players" item to the HomeScreen gear menu**

In `src/screens/HomeScreen.js`, in the settings `Modal`, insert this block **immediately after** the `Members` menu item's closing `</TouchableOpacity>` (currently at line 1749) and **before** the `{!isViewer && (` Edit Tournament block (line 1751). The old Add Player / Remove Player / Members items stay in place for now — they are removed in Task 6.

```jsx
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => {
              setShowSettings(false);
              navigation.navigate('Players', {
                tournamentId: tournament.id,
                tournamentName: tournament.name,
              });
            }}
            activeOpacity={0.7}
          >
            <Feather name="users" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Players</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: PASS, no new errors.

Run: `npm test`
Expected: PASS, all ~330 tests green.

Manual: launch the app (`npm run web`), open a tournament, tap the gear icon → tap **Players**. The Players screen opens, shows the roster with names, role badges (if any members), and `HCP n` text. Back button returns to the round view.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayersScreen.js App.js src/screens/HomeScreen.js
git commit -m "feat(players): scaffold read-only PlayersScreen + gear menu entry"
```

---

## Task 2: Base handicap editing + auto-save

**Files:**
- Modify: `src/screens/PlayersScreen.js`

This task ports the debounced auto-save machinery from `EditTournamentScreen.js` (lines 36–165) into `PlayersScreen` and makes each roster row's handicap an editable input for non-viewers.

- [ ] **Step 1: Extend imports**

In `PlayersScreen.js`, update the imports to add the hooks and store functions used by auto-save:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Alert, Platform,
} from 'react-native';
```

```jsx
import {
  loadTournament, saveTournament, subscribeTournamentChanges,
  normalizeRoundHandicaps, readLocal,
  loadTournamentMembers, findClaimedSlot,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
```

- [ ] **Step 2: Add editable state + auto-save effect**

`editPlayers` becomes editable local state (handicaps held as strings, like `EditTournamentScreen`), `rounds` is loaded for the save block (its editing UI arrives in Task 3), and `tournament` keeps the immutable rest.

Add this state alongside the existing `tournament`/`members`/`loading`/`loadError` state:

```jsx
  const [editPlayers, setEditPlayers] = useState([]);   // [{ id, name, handicap: string, user_id }]
  const [rounds, setRounds] = useState([]);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const isFirstRender = useRef(true);
  const skipNextSaveRef = useRef(false);
```

Replace the Task 1 `load` with this version — it also populates `editPlayers` and `rounds` (round-normalisation shape ported from `EditTournamentScreen.js:64–75`):

```jsx
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, mem] = await Promise.all([
        loadTournament(),
        tournamentId ? loadTournamentMembers(tournamentId) : Promise.resolve([]),
      ]);
      setTournament(t);
      setMembers(mem);
      setEditPlayers(t.players.map((p) => ({ ...p, handicap: String(p.handicap) })));
      setRounds(t.rounds.map((r) => {
        const normalized = normalizeRoundHandicaps(r, t.players);
        return {
          ...normalized,
          holes: [...normalized.holes],
          playerHandicaps: Object.fromEntries(
            t.players.map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
          ),
          manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
        };
      }));
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load players');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);
```

Add a ref-sync effect and the merge-aware subscription (ported from `EditTournamentScreen.js:53` and `83–104`, scoped to player-name refresh):

```jsx
  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    const unsub = subscribeTournamentChanges(async () => {
      const t = await loadTournament();
      if (!t) return;
      setTournament(t);
      setMembers(tournamentId ? await loadTournamentMembers(tournamentId) : []);
      setEditPlayers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const fresh = t.players.find((x) => x.id === p.id);
          if (fresh && fresh.name !== p.name) { changed = true; return { ...p, name: fresh.name }; }
          return p;
        });
        if (!changed) return prev;
        skipNextSaveRef.current = true;
        return next;
      });
    });
    return unsub;
  }, [tournamentId]);
```

Add the debounced auto-save effect — ported from `EditTournamentScreen.js:108–165`, with two changes: it does not edit `settings` (so no `settings` in the payload or deps), and it keys on `[editPlayers, rounds]`:

```jsx
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveState('saving');
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const builtPlayers = editPlayers.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }));
        const builtRounds = rounds.map((r) => ({
          ...r,
          playerHandicaps: Object.fromEntries(
            Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
          ),
          manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        }));
        const baseId = tournamentRef.current?.id;
        let t = (baseId && (await readLocal(baseId))) || tournamentRef.current;
        for (const r of builtRounds) {
          const prevRound = t.rounds.find((pr) => pr.id === r.id);
          if (!prevRound) continue;
          for (const [pid, v] of Object.entries(r.playerHandicaps)) {
            const before = prevRound.playerHandicaps?.[pid];
            if (before === v) continue;
            t = await mutate(t, { type: 'handicap.set', roundId: r.id, playerId: pid, handicap: v });
          }
        }
        await saveTournament({ ...t, players: builtPlayers, rounds: builtRounds });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        const msg = err?.message ?? 'Could not save changes';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Save failed', msg);
      }
    }, 400);
  }, [editPlayers, rounds]);
```

- [ ] **Step 3: Add the base-handicap update handler**

```jsx
  function updateBaseHandicap(playerId, value) {
    setEditPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, handicap: value } : p)));
  }
```

- [ ] **Step 4: Add the save pill to the header**

Replace the header's right-side spacer (`<View style={{ width: 22 }} />`) with the save pill (ported from `EditTournamentScreen.js:294–312`):

```jsx
        {saveState === 'idle' ? (
          <View style={{ width: 64 }} />
        ) : (
          <View style={[
            s.savePill,
            saveState === 'error' && s.savePillError,
            saveState === 'saved' && s.savePillSaved,
          ]}>
            <Feather
              name={saveState === 'error' ? 'alert-circle' : saveState === 'saved' ? 'check' : 'loader'}
              size={11}
              color={saveState === 'error' ? theme.destructive : theme.text.muted}
              style={{ marginRight: 4 }}
            />
            <Text style={[s.savePillText, saveState === 'error' && s.savePillTextError]}>
              {saveState === 'error' ? 'Save failed' : saveState === 'saved' ? 'Saved' : 'Saving…'}
            </Text>
          </View>
        )}
```

- [ ] **Step 5: Render the editable handicap in each roster row**

Iterate `editPlayers` instead of `players`, and replace the `HCP {p.handicap}` text with a conditional input. The full updated roster block inside the `ScrollView`:

```jsx
          <Text style={s.sectionLabel}>{editPlayers.length} {editPlayers.length === 1 ? 'player' : 'players'}</Text>
          {editPlayers.map((p) => {
            const member = members.find((m) => m.userId === p.user_id) || null;
            const color = member?.profile?.avatar_color || theme.accent.primary;
            return (
              <View key={p.id} style={s.row}>
                <View style={[s.avatar, { backgroundColor: color }]}>
                  {member?.profile?.avatar_url
                    ? <Image source={{ uri: member.profile.avatar_url }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{playerInitials(p.name)}</Text>}
                </View>
                <View style={s.info}>
                  <Text style={s.name}>{p.name}</Text>
                  <View style={s.metaRow}>
                    {member ? (
                      <View style={[s.roleBadge, member.role === 'owner' && s.roleBadgeOwner]}>
                        <Text style={[s.roleText, member.role === 'owner' && s.roleTextOwner]}>
                          {member.role.toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {isViewer ? (
                  <Text style={s.metaText}>HCP {p.handicap}</Text>
                ) : (
                  <TextInput
                    style={s.hcpInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    value={p.handicap}
                    onChangeText={(v) => updateBaseHandicap(p.id, v)}
                    placeholder="0"
                    placeholderTextColor={theme.text.muted}
                    accessibilityLabel={`Handicap for ${p.name}`}
                  />
                )}
              </View>
            );
          })}
```

`useFocusEffect` reloads on every focus; the `isFirstRender` guard prevents the load-triggered state set from firing a redundant save.

- [ ] **Step 6: Verify**

Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS.

Manual: open Players, edit a handicap. The save pill shows "Saving…" then "Saved". Navigate to Scorecard and back; the new handicap persists. As a viewer (a member with viewer role), the handicap shows as read-only `HCP n` text.

- [ ] **Step 7: Commit**

```bash
git add src/screens/PlayersScreen.js
git commit -m "feat(players): inline base-handicap editing with debounced auto-save"
```

---

## Task 3: Tees & playing handicaps section

**Files:**
- Modify: `src/screens/PlayersScreen.js`

Renders the existing `RoundTeeAssignments` component per round, feeding the `rounds` state the Task 2 save block already consumes. Hidden for viewers.

- [ ] **Step 1: Import RoundTeeAssignments**

Update the import line in `PlayersScreen.js`:

```jsx
import RoundTeeAssignments, { playerInitials } from '../components/RoundTeeAssignments';
```

- [ ] **Step 2: Add the per-round tees change handler**

Ported from `EditTournamentScreen.js:185–196`:

```jsx
  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);
```

- [ ] **Step 3: Render the tees section**

Inside the `ScrollView`, after the roster `.map` block, add the tees section (gated on `!isViewer`). The `key` folds in the base-handicap signature so `RoundTeeAssignments` remounts when a base index changes — same pattern as `EditTournamentScreen.js:367`:

```jsx
          {!isViewer && rounds.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Tees & playing handicaps</Text>
              {rounds.map((r, ri) => (
                <View key={r.id} style={s.roundCard}>
                  <Text style={s.roundCardTitle}>
                    Round {ri + 1}{r.courseName ? ` — ${r.courseName}` : ''}
                  </Text>
                  <RoundTeeAssignments
                    key={`${r.id}:${editPlayers.map((p) => p.handicap).join(',')}`}
                    round={r}
                    players={editPlayers.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }))}
                    theme={theme}
                    onChange={(patch) => handleRoundTeesChange(ri, patch)}
                  />
                </View>
              ))}
            </>
          )}
```

- [ ] **Step 4: Verify**

Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS.

Manual: open Players. Below the roster, the "Tees & playing handicaps" section lists each round with the tee picker + playing-handicap editor. Change a tee or playing handicap; the save pill cycles to "Saved". Reopen the screen — the change persists. As a viewer, the section is absent.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayersScreen.js
git commit -m "feat(players): per-round tee & playing-handicap editing"
```

---

## Task 4: Invite, leave, and member actions

**Files:**
- Modify: `src/screens/PlayersScreen.js`

Ports member access control from `MembersScreen.js`: invite link, leave tournament, promote/demote role, release slot, remove member.

- [ ] **Step 1: Extend imports**

Add `Share` to the `react-native` import. Add the supabase client and member store functions to the existing import blocks:

```jsx
import {
  loadTournament, saveTournament, subscribeTournamentChanges,
  normalizeRoundHandicaps, readLocal,
  loadTournamentMembers, findClaimedSlot,
  removeTournamentMember, generateInviteCode, releaseTournamentPlayer, buildJoinLink,
} from '../store/tournamentStore';
import { supabase } from '../lib/supabase';
```

- [ ] **Step 2: Add the `updateMemberRole` helper**

At module scope (above the component), ported verbatim from `MembersScreen.js:20–27`:

```jsx
async function updateMemberRole(tournamentId, userId, role) {
  const { error } = await supabase
    .from('tournament_members')
    .update({ role })
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 3: Add member-action state and handlers**

Add state:

```jsx
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState(null);
  const [releasingId, setReleasingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
```

Port these five functions from `MembersScreen.js` into the component body. They are copied **verbatim** except that each one's final `await load();` calls `PlayersScreen`'s own `load` (which reloads members too — same effect as `MembersScreen.load`):
- `handleInvite` — from `MembersScreen.js:116–137` (uses `tournamentName` from route params, already destructured).
- `leaveTournament` — from `MembersScreen.js:161–180` (ends with `navigation.goBack()` on success).
- `changeRole` — from `MembersScreen.js:139–159`.
- `releaseSlot` — from `MembersScreen.js:94–114`.
- `confirmRemove` — from `MembersScreen.js:73–92`.

Each takes a `row` (a member object). In `PlayersScreen` the member for a roster row is `members.find((m) => m.userId === p.user_id)`.

- [ ] **Step 4: Add the [+ Add] / Invite / Leave / member-action UI**

Wrap the count label in a top row (the Add button arrives in Task 5 — for now the row holds only the label):

```jsx
          <View style={s.topRow}>
            <Text style={s.sectionLabel}>{editPlayers.length} {editPlayers.length === 1 ? 'player' : 'players'}</Text>
          </View>
```

In each roster row, after the handicap input/text, add the owner-only member-action cluster. Resolve `member` per row, compute `canManage = isOwner && !!member && member.role !== 'owner' && member.userId !== user?.id`, and render the actions ported from `MembersScreen.js:267–312` inside a `<View style={s.rowActions}>`:

```jsx
                {canManage && (
                  <View style={s.rowActions}>
                    {roleBusyId === member.userId ? (
                      <ActivityIndicator color={theme.accent.primary} />
                    ) : (
                      <TouchableOpacity
                        onPress={() => changeRole(member)}
                        style={s.roleActionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={member.role === 'editor' ? `Demote ${p.name} to viewer` : `Promote ${p.name} to editor`}
                      >
                        <Feather name={member.role === 'editor' ? 'arrow-down' : 'arrow-up'} size={16} color={theme.accent.primary} />
                      </TouchableOpacity>
                    )}
                    {findClaimedSlot(players, member.userId) && (
                      releasingId === member.userId
                        ? <ActivityIndicator color={theme.accent.primary} />
                        : (
                          <TouchableOpacity
                            onPress={() => releaseSlot(member, findClaimedSlot(players, member.userId))}
                            style={s.roleActionBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel={`Release the ${p.name} player slot`}
                          >
                            <Feather name="rotate-ccw" size={15} color={theme.accent.primary} />
                          </TouchableOpacity>
                        )
                    )}
                    {removingId === member.userId
                      ? <ActivityIndicator color={theme.destructive} />
                      : (
                        <TouchableOpacity
                          onPress={() => confirmRemove(member)}
                          style={s.removeBtn}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityLabel={`Remove ${p.name} member access`}
                        >
                          <Feather name="user-minus" size={18} color={theme.destructive} />
                        </TouchableOpacity>
                      )}
                  </View>
                )}
```

Here `players` is `tournament?.players ?? []` (the persisted roster carrying `user_id`). Add `const players = tournament?.players ?? [];` near the role derivations if not already present.

After the roster `.map`, before the tees section, add the Invite button (owner only):

```jsx
          {isOwner && (
            <TouchableOpacity style={s.inviteBtn} onPress={handleInvite} disabled={inviting} activeOpacity={0.7}>
              {inviting
                ? <ActivityIndicator size="small" color={theme.accent.primary} />
                : <Feather name="user-plus" size={16} color={theme.accent.primary} />}
              <Text style={s.inviteBtnText}>Invite people</Text>
            </TouchableOpacity>
          )}
```

At the end of the `ScrollView`, after the tees section, add the Leave button (non-owner members only):

```jsx
          {myRow && !isOwner && (
            <TouchableOpacity style={s.leaveBtn} onPress={leaveTournament} disabled={leaving} activeOpacity={0.7}>
              {leaving
                ? <ActivityIndicator size="small" color={theme.destructive} />
                : <Feather name="log-out" size={16} color={theme.destructive} />}
              <Text style={s.leaveBtnText}>Leave tournament</Text>
            </TouchableOpacity>
          )}
```

- [ ] **Step 5: Verify**

Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS.

Manual: as owner of a shared tournament, open Players — the Invite button works (copies/shares a link); on a claimed-member row the promote/demote, release, and remove icons appear and work. As a non-owner member, "Leave tournament" appears and works. In a casual single-user game, no member-action icons appear (clean rows).

- [ ] **Step 6: Commit**

```bash
git add src/screens/PlayersScreen.js
git commit -m "feat(players): invite, leave, and member role/release/remove actions"
```

---

## Task 5: Add player and remove player

**Files:**
- Modify: `src/screens/PlayersScreen.js`

Ports the add/remove roster flow + scoring-mode revalidation from `HomeScreen.js` (lines 212–303).

- [ ] **Step 1: Extend imports**

Add `addPlayerRoundPatches` and `removePlayerRoundPatches` to the existing `tournamentStore` import block. Add three new import lines:

```jsx
import { isScoringModeAllowed, fallbackScoringMode, getScoringMode } from '../components/scoringModes';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { consumePendingPlayers } from '../lib/selectionBridge';
```

- [ ] **Step 2: Add the `confirmDialog` helper**

At module scope (above the component), ported verbatim from `EditTournamentScreen.js:19–26`:

```jsx
async function confirmDialog(title, message, confirmLabel = 'Remove') {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}
```

- [ ] **Step 3: Add add/remove state**

```jsx
  const [modePrompt, setModePrompt] = useState(null);
  const [removeModePrompt, setRemoveModePrompt] = useState(null);
```

- [ ] **Step 4: Port the add/remove handlers**

Port these four functions from `HomeScreen.js` into the component body, copied **verbatim** except that the final `setTournament(t)` in `commitAdds` and `commitRemove` is replaced with `await load();` (so `PlayersScreen` refreshes `editPlayers`/`rounds`/`members` from the mutated tournament):
- `commitAdds` — from `HomeScreen.js:216–235`.
- `applyAddPlayers` — from `HomeScreen.js:237–259`.
- `commitRemove` — from `HomeScreen.js:261–274`.
- `applyRemovePlayer` — from `HomeScreen.js:276–295`.

Add the focus listener that consumes players returned from `PlayerPicker` (ported from `HomeScreen.js:297–303`):

```jsx
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      const picked = consumePendingPlayers();
      if (picked && picked.length > 0) applyAddPlayers(picked);
    });
    return unsub;
  }, [navigation, applyAddPlayers]);
```

- [ ] **Step 5: Wire the [+ Add] button**

Replace the Task 4 top row with the gated Add button:

```jsx
          <View style={s.topRow}>
            <Text style={s.sectionLabel}>{editPlayers.length} {editPlayers.length === 1 ? 'player' : 'players'}</Text>
            {!isViewer && editPlayers.length < 4 && (
              <TouchableOpacity
                style={s.addBtn}
                onPress={() => navigation.navigate('PlayerPicker', {
                  alreadySelectedIds: editPlayers.map((p) => p.id),
                })}
                activeOpacity={0.7}
              >
                <Feather name="user-plus" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
```

- [ ] **Step 6: Add the per-row delete button**

In the roster row, after the handicap input/text and **before** the `canManage` member-action cluster, add a roster-delete button (gated `!isViewer && editPlayers.length > 2`):

```jsx
                {!isViewer && editPlayers.length > 2 && (
                  removingId === `roster:${p.id}`
                    ? <ActivityIndicator color={theme.destructive} />
                    : (
                      <TouchableOpacity
                        onPress={async () => {
                          const ok = await confirmDialog(
                            'Remove player',
                            `Remove ${p.name} from the game? Their scores for this game will be deleted.`,
                          );
                          if (ok) applyRemovePlayer(p.id);
                        }}
                        style={s.removeBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove ${p.name} from the game`}
                      >
                        <Feather name="user-x" size={18} color={theme.destructive} />
                      </TouchableOpacity>
                    )
                )}
```

This roster delete (icon `user-x`) removes the *player slot* and is distinct from the member `confirmRemove` (icon `user-minus`) which revokes *access*, per the spec. The `removingId` value here is namespaced `roster:${p.id}` so it never collides with the member-removal `removingId` (a bare `userId`) from Task 4.

- [ ] **Step 7: Render the ScoringModeChangeSheet prompts**

Inside `ScreenContainer`, after the `ScrollView`/loading/error block, add both sheets — ported verbatim from `HomeScreen.js:1812–1828` (add) and `1839–1855` (remove):

```jsx
      <ScoringModeChangeSheet
        visible={!!modePrompt}
        playerCount={modePrompt?.newCount ?? 0}
        defaultMode={modePrompt?.defaultMode}
        title="Pick a new scoring mode"
        subtitle={modePrompt
          ? `Adding this player makes ${getScoringMode(modePrompt.prevMode).label} invalid (${getScoringMode(modePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${modePrompt.newCount} players.`
          : undefined}
        onConfirm={async (chosenMode) => {
          const picked = modePrompt.picked;
          setModePrompt(null);
          await commitAdds(picked, chosenMode);
        }}
        onCancel={() => setModePrompt(null)}
      />
      <ScoringModeChangeSheet
        visible={!!removeModePrompt}
        playerCount={removeModePrompt?.newCount ?? 0}
        defaultMode={removeModePrompt?.defaultMode}
        title="Pick a new scoring mode"
        subtitle={removeModePrompt
          ? `Removing this player makes ${getScoringMode(removeModePrompt.prevMode).label} invalid (${getScoringMode(removeModePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${removeModePrompt.newCount} players.`
          : undefined}
        onConfirm={async (chosenMode) => {
          const playerId = removeModePrompt.playerId;
          setRemoveModePrompt(null);
          await commitRemove(playerId, chosenMode);
        }}
        onCancel={() => setRemoveModePrompt(null)}
      />
```

- [ ] **Step 8: Verify**

Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS.

Manual: open Players. **[+ Add]** → PlayerPicker → select a player → confirm; the player appears on the roster. When the new count invalidates the scoring mode (e.g. adding a 3rd player to a Best Ball game), the scoring-mode sheet appears; picking a mode completes the add. Per-row delete (visible only when > 2 players) removes a player after confirm, with the same revalidation sheet when needed. The round view's leaderboard reflects the change on return.

- [ ] **Step 9: Commit**

```bash
git add src/screens/PlayersScreen.js
git commit -m "feat(players): add and remove players with scoring-mode revalidation"
```

---

## Task 6: Strip the relocated code from HomeScreen

**Files:**
- Modify: `src/screens/HomeScreen.js`

`PlayersScreen` now fully owns add/remove and members. Remove the duplicated machinery from `HomeScreen`.

- [ ] **Step 1: Remove the old gear-menu items**

In the settings `Modal`, delete these three blocks:
- **Add Player** item — `HomeScreen.js:1693–1708` (the `{!isViewer && tournament.players.length < 4 && (...)}` block).
- **Remove Player** item — `HomeScreen.js:1710–1723` (the `{!isViewer && tournament.players.length > 2 && (...)}` block).
- **Members** item — `HomeScreen.js:1735–1749` (the `TouchableOpacity` navigating to `Members`).

The **Players** item added in Task 1 stays.

- [ ] **Step 2: Remove the add/remove logic**

Delete these from the `HomeScreen` component body:
- `commitAdds` — `HomeScreen.js:216–235`.
- `applyAddPlayers` — `HomeScreen.js:237–259`.
- `commitRemove` — `HomeScreen.js:261–274`.
- `applyRemovePlayer` — `HomeScreen.js:276–295`.
- The `focus` listener effect consuming `consumePendingPlayers()` — `HomeScreen.js:297–303`.
- The `modePrompt` and `removeModePrompt` state declarations.
- The `removeSheetOpen` state declaration.

- [ ] **Step 3: Remove the relocated modals**

Delete from the JSX:
- The add `ScoringModeChangeSheet` — `HomeScreen.js:1812–1828`.
- The `PlayerRemoveSheet` — `HomeScreen.js:1830–1838`.
- The remove `ScoringModeChangeSheet` — `HomeScreen.js:1839–1855`.

- [ ] **Step 4: Remove now-unused imports**

Delete from `HomeScreen.js` imports:
- `import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';` (line 11).
- `import PlayerRemoveSheet from '../components/PlayerRemoveSheet';` (line 13).
- `import { consumePendingPlayers } from '../lib/selectionBridge';` (line 32).
- From the `tournamentStore` import block: `addPlayerRoundPatches`, `removePlayerRoundPatches`.
- From the `scoringModes` import (line 10): `isScoringModeAllowed`, `fallbackScoringMode`, `getScoringMode` — **only if** they are not referenced elsewhere in `HomeScreen.js`. Run `grep -n 'isScoringModeAllowed\|fallbackScoringMode\|getScoringMode' src/screens/HomeScreen.js` first; leave any still-referenced symbol (the scoring-mode-sheet feature may use some).

`npm run lint` (`no-unused-vars` is CI-blocking) is the backstop for anything missed.

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: PASS — zero `no-unused-vars` errors. If lint flags an unused import, remove it; if it flags a *used* symbol as undefined, a deletion went too far — restore it.

Run: `npm test`
Expected: PASS.

Manual: open a tournament → gear icon. The menu shows **Players** (no Add Player / Remove Player / Members). Add and remove players via the Players screen still work, and the round view updates on return.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "refactor(home): drop add/remove/members gear items, now in PlayersScreen"
```

---

## Task 7: Slim down EditTournamentScreen

**Files:**
- Modify: `src/screens/EditTournamentScreen.js`

Remove the handicap UI now owned by `PlayersScreen`; keep round/course structure editing.

- [ ] **Step 1: Remove the Handicap Index section**

Delete the entire base-handicap block — `EditTournamentScreen.js:316–336` (the `<View>` containing `<Text style={s.sectionTitle}>Handicap Index</Text>` and the `players.map`).

- [ ] **Step 2: Remove RoundTeeAssignments from each round card**

Delete the `<RoundTeeAssignments ... />` block — `EditTournamentScreen.js:366–372`. The round card keeps the course-name input, the `courseNameHint`, the notes input, and the Edit Holes & Tees button.

- [ ] **Step 3: Remove the now-dead handlers and import**

- Delete `handleRoundTeesChange` — `EditTournamentScreen.js:185–196` (no longer referenced).
- Delete `updateBaseHandicap` — `EditTournamentScreen.js:198–204` (no longer referenced).
- Delete `import RoundTeeAssignments from '../components/RoundTeeAssignments';` — line 17.

- [ ] **Step 4: Simplify the save effect**

In the debounced save effect (`EditTournamentScreen.js:114–164`), remove the per-cell `handicap.set` mutation loop (`EditTournamentScreen.js:135–145` — the `const baseId = ...`, `let t = ...readLocal...`, and the `for (const r of builtRounds)` block). `EditTournamentScreen` no longer edits handicaps, so it emits no `handicap.set` mutations and does not write `players`. Replace the `saveTournament` call so it spreads `tournamentRef.current`:

```jsx
        await saveTournament({
          ...tournamentRef.current,
          rounds: builtRounds,
          settings: {
            ...settings,
            bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
            worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
          },
        });
```

`builtRounds` still maps each round's `playerHandicaps` strings → ints, so values loaded via `normalizeRoundHandicaps` are preserved untouched. Delete the now-unused `builtPlayers` line. After this, `readLocal` and `mutate` may be unused imports in this file — remove them only if `npm run lint` flags them (`removeRound` still uses `mutate` for `round.remove`, so `mutate` stays; `readLocal` becomes unused — remove it). `players` state stays — still read by `addRound` (seeds `playerHandicaps`) and `removeRound` (`roundEnteredCount`) — but is no longer written.

- [ ] **Step 5: Verify**

Run: `npm run lint` — Expected: PASS, no `no-unused-vars`.
Run: `npm test` — Expected: PASS.

Manual: gear → Edit Tournament. The screen shows round cards (course name, notes, Edit Holes & Tees) and the Scoring Mode section — **no** Handicap Index list, **no** tee assignments. Edit a course name; it still saves (pill cycles). Add a round; it seeds correctly. Then open Players and confirm handicaps/tees still edit and save there.

- [ ] **Step 6: Commit**

```bash
git add src/screens/EditTournamentScreen.js
git commit -m "refactor(edit-tournament): drop handicap UI, now in PlayersScreen"
```

---

## Task 8: Delete dead code

**Files:**
- Delete: `src/screens/MembersScreen.js`
- Delete: `src/components/PlayerRemoveSheet.js`
- Modify: `App.js`

- [ ] **Step 1: Confirm both files are unreferenced**

Run: `grep -rn "MembersScreen\|PlayerRemoveSheet" src/ App.js`
Expected: the only remaining hits are `App.js`'s `import MembersScreen` and `Stack.Screen name="Members"`. If anything else references them, stop — a prior task missed a removal.

- [ ] **Step 2: Delete the files**

```bash
git rm src/screens/MembersScreen.js src/components/PlayerRemoveSheet.js
```

- [ ] **Step 3: Remove the `Members` route from `App.js`**

Delete the import `import MembersScreen from './src/screens/MembersScreen';` (line 62) and the registration `<Stack.Screen name="Members" component={MembersScreen} />` (line 350).

- [ ] **Step 4: Verify**

Run: `grep -rn "name=\"Members\"\|MembersScreen" src/ App.js`
Expected: no matches. (Data-layer names like `loadTournamentMembers` / `removeTournamentMember` are untouched and are fine — they are not `MembersScreen`.)

Run: `npm run lint` — Expected: PASS.
Run: `npm test` — Expected: PASS.

Manual: full smoke test — gear → Players: edit handicaps, edit tees, add a player, remove a player, and (in a shared tournament) invite / change a role / leave. gear → Edit Tournament: edit a round. No dead navigation, no console errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead MembersScreen and PlayerRemoveSheet"
```

---

## Self-Review

**Spec coverage:**
- Gear menu: single Players item, old three removed → Tasks 1, 6. ✓
- Players screen: roster, base handicap, per-round tees, members inline, invite, leave → Tasks 1–5. ✓
- Roster vs members distinction; both removal concepts kept distinct (`applyRemovePlayer` roster delete vs `confirmRemove`/`releaseSlot` member actions, distinct icons and `removingId` namespacing) → Tasks 4, 5. ✓
- Viewer behavior (read-only handicaps, hidden tees, leave still shown) → Tasks 2, 3, 4. ✓
- `EditTournamentScreen` slimmed → Task 7. ✓
- Cleanup: `MembersScreen` + `PlayerRemoveSheet` deleted, `Members` route removed, `Players` route added → Tasks 1, 8. ✓
- Add/remove scoring-mode revalidation → Task 5. ✓
- Coexistence with the scoring-mode-gear-menu spec: this plan never touches the Scoring Mode section/item; Task 1 inserts the Players item at a fixed anchor (after Members, before Edit Tournament) — independent. ✓

**Placeholder scan:** No "TBD"/"TODO". The Task 4 top row without an Add button is an explicit two-step build (label-only in Task 4 → Add button wired in Task 5) and is called out as such. Verbatim-lift instructions cite exact `file:line` ranges in the existing codebase — precise, not hand-waving.

**Type consistency:** `editPlayers` (string handicaps) vs `tournament.players` (numeric `user_id`-bearing roster) are used consistently — `editPlayers` for handicap editing, `players` (= `tournament.players`) for `findClaimedSlot`. `saveTournament({ ...t, players: builtPlayers, rounds: builtRounds })` matches the `EditTournamentScreen` contract. `modePrompt`/`removeModePrompt` shapes (`picked`/`playerId`/`newCount`/`defaultMode`/`prevMode`) match the `ScoringModeChangeSheet` props ported from `HomeScreen`. `removingId` is namespaced (`roster:${id}` for roster delete vs bare `userId` for member removal) so the two never collide. `load` is the single refresh entry point used by every handler.
