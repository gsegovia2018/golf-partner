# Standalone Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Game" kind alongside "Tournament" so users can record a single-round outing without the multi-round wrapper, sharing all storage/scoring/stats infrastructure.

**Architecture:** A `kind: 'tournament' | 'game'` field is stored inside the existing tournament JSON blob. The `SetupScreen` is parameterised by `route.params.kind`; the `HomeScreen` reads `kind` to (a) split the list into two sections, (b) hide multi-round chrome inside the detail view, and (c) hide the "Next Round" CTA. A Game always has `rounds.length === 1`. Records without `kind` are treated as `'tournament'`.

**Tech Stack:** React Native / Expo, react-navigation stack, AsyncStorage + Supabase JSON blob storage.

**Test strategy:** This repo has no automated test framework (`package.json` has no `test` script and no test files). Verification per task is done by running the web dev server (`npm run web`) and exercising the affected flow manually. Each task lists explicit click-paths to verify and what to look for. Where pure logic is added (e.g. auto-name builder), the verification is a one-shot Node REPL or `node -e` invocation against the extracted helper.

**Spec:** `docs/superpowers/specs/2026-04-19-standalone-game-design.md`

---

## File map

- **Modify** `src/store/tournamentStore.js` — `createTournament(...)` accepts and stores a `kind` arg (default `'tournament'`).
- **Modify** `src/screens/SetupScreen.js` — accept `route.params.kind` and branch UI/state for game mode (header, CTA, single round, auto-name, Best Ball gate).
- **Modify** `src/screens/HomeScreen.js` — add "New Game" CTA row, split list into Games / Tournaments sections, change Game card meta line, hide multi-round panels and "Next Round" CTA in game-detail render.

No new files, no schema migration, no new routes (existing `Setup` route is reused).

---

## Conventions used in this plan

- "Verify" steps use `npm run web` — Expo's web target — because no native build is required to exercise the screens. Mobile parity follows from React Native's shared JSX.
- `git add` lines list only files the task touched. Avoid `git add -A`.
- Commit messages follow this repo's existing style: short imperative summary, no body unless needed (see `git log --oneline -10`).

---

## Task 1: `createTournament` accepts a `kind` arg

**Files:**
- Modify: `src/store/tournamentStore.js` (around lines 342–352, the `createTournament` function)

- [ ] **Step 1: Read the current `createTournament`**

Open `src/store/tournamentStore.js` and locate:

```js
export function createTournament({ name, players, rounds, settings }) {
  return {
    id: Date.now().toString(),
    name,
    createdAt: new Date().toISOString(),
    players,
    rounds,
    currentRound: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}
```

- [ ] **Step 2: Add `kind` to the signature and the returned object**

Replace the function body so the final form is:

```js
export function createTournament({ name, players, rounds, settings, kind = 'tournament' }) {
  return {
    id: Date.now().toString(),
    kind,
    name,
    createdAt: new Date().toISOString(),
    players,
    rounds,
    currentRound: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}
```

The default `'tournament'` keeps existing call sites (only `SetupScreen.handleStart`) working without change.

- [ ] **Step 3: Verify with a one-off node check**

Run from the worktree root:

```bash
node -e "const {createTournament}=require('./src/store/tournamentStore.js');console.log(createTournament({name:'X',players:[],rounds:[]}).kind);console.log(createTournament({name:'Y',players:[],rounds:[],kind:'game'}).kind);"
```

Expected output:
```
tournament
game
```

If the require fails because `tournamentStore.js` imports `@react-native-async-storage/async-storage` and `../lib/supabase` at the top, skip this command and instead verify by inspection of the change. (No further verification needed — the field is a plain pass-through.)

- [ ] **Step 4: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "tournamentStore: createTournament accepts kind"
```

---

## Task 2: SetupScreen reads `kind` and switches header + CTA

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Read `route.params.kind` and use it**

Change the component signature at the top of the file from:

```js
export default function SetupScreen({ navigation }) {
```

to:

```js
export default function SetupScreen({ navigation, route }) {
  const kind = route?.params?.kind === 'game' ? 'game' : 'tournament';
  const isGame = kind === 'game';
```

- [ ] **Step 2: Replace the header title**

Locate the header (around line 177):

```jsx
<Text style={s.headerTitle}>New Tournament</Text>
```

Replace with:

```jsx
<Text style={s.headerTitle}>{isGame ? 'New Game' : 'New Tournament'}</Text>
```

- [ ] **Step 3: Replace the CTA button label**

Locate the start button (around lines 348–351):

```jsx
<TouchableOpacity style={s.primaryBtn} onPress={handleStart}>
  <Feather name="play" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
  <Text style={s.primaryBtnText}>Start Tournament</Text>
</TouchableOpacity>
```

Replace the inner Text with:

```jsx
<Text style={s.primaryBtnText}>{isGame ? 'Start Game' : 'Start Tournament'}</Text>
```

- [ ] **Step 4: Pass `kind` through `createTournament` in `handleStart`**

In the existing call (around lines 149–158):

```js
const tournament = createTournament({
  name: tournamentName.trim() || 'Weekend Golf',
  players,
  rounds: builtRounds,
  settings: {
    ...settings,
    bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
    worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
  },
});
```

Replace with:

```js
const tournament = createTournament({
  kind,
  name: tournamentName.trim() || (isGame ? 'Game' : 'Weekend Golf'),
  players,
  rounds: builtRounds,
  settings: {
    ...settings,
    bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
    worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
  },
});
```

- [ ] **Step 5: Verify**

Run `npm run web`. From Home, tap **New Tournament** — header should still read "New Tournament" and CTA "Start Tournament". (No way yet to land on the game variant — that's wired up in Task 6. We'll re-verify game mode once the Home button is in place.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "SetupScreen: parameterise header/CTA on kind"
```

---

## Task 3: SetupScreen — single-round mode for games

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Lock rounds state to a single element when game**

Locate the initial state (around line 21):

```js
const [rounds, setRounds] = useState([{ courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
```

The single-element initial state is already correct for both modes. No change here.

- [ ] **Step 2: Hide "Add Round" button and per-round "Remove" in game mode**

Locate the rounds map block (around lines 224–296). Two changes inside that block:

a) The "Remove" round button (lines 232–237) is gated on `rounds.length > 1`. In game mode `rounds.length` is always 1, so this naturally hides — no change needed.

b) The "Add Round" button (lines 292–295):

```jsx
<TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
  <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
  <Text style={s.addRoundBtnText}>Add Round</Text>
</TouchableOpacity>
```

Wrap in `{!isGame && (...)}`:

```jsx
{!isGame && (
  <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
    <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
    <Text style={s.addRoundBtnText}>Add Round</Text>
  </TouchableOpacity>
)}
```

- [ ] **Step 3: Relabel the section header and hide "Round N" label**

Locate the section title (around line 225):

```jsx
<Text style={s.sectionTitle}>Rounds</Text>
```

Replace with:

```jsx
<Text style={s.sectionTitle}>{isGame ? 'Course' : 'Rounds'}</Text>
```

Locate the round label inside the rounds map (around line 231):

```jsx
<Text style={s.roundLabel}>Round {i + 1}</Text>
```

Replace with:

```jsx
{!isGame && <Text style={s.roundLabel}>Round {i + 1}</Text>}
```

Note: this leaves the `roundHeader` View with only the (also-hidden) Remove button in game mode, so the View renders empty. That's fine — it has no padding of its own beyond `marginBottom: 8`. Leave the wrapping View in place to avoid touching `s.roundHeader` styles.

- [ ] **Step 4: Verify (deferred — needs Task 6 to land on game mode)**

Tournament path should still look identical: "Rounds" header, "Round 1" label, "Add Round" visible. Run `npm run web` and tap **New Tournament** to confirm nothing regressed.

- [ ] **Step 5: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "SetupScreen: hide multi-round controls in game mode"
```

---

## Task 4: SetupScreen — auto-name with `nameTouched`

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Add `nameTouched` ref and a name builder**

Right after the `kind` / `isGame` lines from Task 2, add (alongside the other `useState` declarations):

```js
const [nameTouched, setNameTouched] = useState(false);
```

And, just above the `useFocusEffect` block (around line 23), add a pure helper:

```js
function buildGameName(courseName) {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const stamp = `${d.getDate()} ${months[d.getMonth()]}`;
  const trimmed = (courseName || '').trim();
  return trimmed ? `Game at ${trimmed} · ${stamp}` : `Game · ${stamp}`;
}
```

- [ ] **Step 2: Initialise `tournamentName` based on kind**

Change the initial state (line 19):

```js
const [tournamentName, setTournamentName] = useState('Weekend Golf');
```

to:

```js
const [tournamentName, setTournamentName] = useState(() =>
  route?.params?.kind === 'game' ? buildGameName('') : 'Weekend Golf',
);
```

- [ ] **Step 3: Re-derive the name when the course changes (game mode only)**

Locate `updateCourseName` (around line 106):

```js
function updateCourseName(index, value) {
  setRounds((prev) => {
    const next = [...prev];
    next[index] = { ...next[index], courseName: value };
    return next;
  });
}
```

Replace with:

```js
function updateCourseName(index, value) {
  setRounds((prev) => {
    const next = [...prev];
    next[index] = { ...next[index], courseName: value };
    return next;
  });
  if (isGame && !nameTouched && index === 0) {
    setTournamentName(buildGameName(value));
  }
}
```

Also, in the `useFocusEffect` where a course is selected from the picker (around lines 53–85), after the `setRounds` call inside game mode the auto-name needs to refresh. Locate the inner setter:

```js
setRounds((prev) => {
  const next = [...prev];
  freshCourses.forEach((course, i) => {
    ...
  });
  return next;
});
```

Right after that `setRounds(...)` call, add:

```js
if (isGame && !nameTouched && pc.startRoundIndex === 0 && freshCourses[0]?.name) {
  setTournamentName(buildGameName(freshCourses[0].name));
}
```

- [ ] **Step 4: Mark `nameTouched` when the user edits the name input**

Locate the name `TextInput` (around lines 184–193). Replace its `onChangeText` so the input reads:

```jsx
<TextInput
  style={s.input}
  value={tournamentName}
  onChangeText={(v) => { setTournamentName(v); setNameTouched(true); }}
  placeholderTextColor={theme.text.muted}
  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
  selectionColor={theme.accent.primary}
/>
```

Also rename the label so it matches the kind. The label above the input (line 185) reads:

```jsx
<Text style={s.label}>Tournament Name</Text>
```

Replace with:

```jsx
<Text style={s.label}>{isGame ? 'Game Name' : 'Tournament Name'}</Text>
```

- [ ] **Step 5: Verify (deferred — needs Task 6 to enter game mode)**

Tournament mode unchanged: "Weekend Golf" still the default name. Game mode (after Task 6 lands the entry button) should show `Game · {DD MMM}`, then update to `Game at {CourseName} · {DD MMM}` when a course is picked, and stop auto-updating once the user types into the name field.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "SetupScreen: auto-name games from course + date"
```

---

## Task 5: SetupScreen — Best Ball gate when not exactly 4 players (game mode)

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Compute the gate**

Just under the `isGame` declaration from Task 2, add:

```js
const bestBallAllowed = !isGame || players.length === 4;
```

- [ ] **Step 2: Force scoring back to stableford when the gate flips closed**

Add a `useEffect` near the other hooks (e.g. just below the existing `useFocusEffect`):

```js
React.useEffect(() => {
  if (!bestBallAllowed && settings.scoringMode === 'bestball') {
    setSettings((prev) => ({ ...prev, scoringMode: 'stableford' }));
  }
}, [bestBallAllowed, settings.scoringMode]);
```

(Use the already-imported `React` namespace if present, otherwise add `useEffect` to the top-level `import` from `'react'`.)

- [ ] **Step 3: Disable the Best Ball mode tile when gated**

Locate the mode buttons (around lines 302–313):

```jsx
{['stableford', 'bestball'].map((mode) => (
  <TouchableOpacity
    key={mode}
    style={[s.modeBtn, settings.scoringMode === mode && s.modeBtnActive]}
    onPress={() => setSettings((prev) => ({ ...prev, scoringMode: mode }))}
  >
    <Text style={[s.modeBtnText, settings.scoringMode === mode && s.modeBtnTextActive]}>
      {mode === 'stableford' ? 'Individual Stableford' : 'Best Ball / Worst Ball'}
    </Text>
  </TouchableOpacity>
))}
```

Replace with:

```jsx
{['stableford', 'bestball'].map((mode) => {
  const disabled = mode === 'bestball' && !bestBallAllowed;
  return (
    <TouchableOpacity
      key={mode}
      style={[s.modeBtn, settings.scoringMode === mode && s.modeBtnActive, disabled && { opacity: 0.5 }]}
      onPress={() => { if (!disabled) setSettings((prev) => ({ ...prev, scoringMode: mode })); }}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <Text style={[s.modeBtnText, settings.scoringMode === mode && s.modeBtnTextActive]}>
        {mode === 'stableford' ? 'Individual Stableford' : 'Best Ball / Worst Ball'}
      </Text>
      {disabled && (
        <Text style={[s.modeBtnText, { fontSize: 11, marginTop: 4, color: theme.text.muted }]}>
          Requires 4 players
        </Text>
      )}
    </TouchableOpacity>
  );
})}
```

- [ ] **Step 4: Verify (deferred to Task 6)**

In game mode with <4 players the Best Ball tile must be 50% opacity, show the "Requires 4 players" sublabel, and not respond to taps. Adding a 4th player must enable it. In tournament mode the tile must always be active and never show the sublabel.

- [ ] **Step 5: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "SetupScreen: gate best-ball on 4 players in game mode"
```

---

## Task 6: HomeScreen — add "New Game" CTA and pass `kind` to Setup

**Files:**
- Modify: `src/screens/HomeScreen.js` (the list-render block around lines 427–436)

- [ ] **Step 1: Replace the single CTA row with two stacked rows**

Locate (around lines 427–436):

```jsx
<View style={{ flexDirection: 'row', gap: 8 }}>
  <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }]} onPress={() => navigation.navigate('Setup')} activeOpacity={0.8}>
    <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
    <Text style={s.primaryBtnText}>New Tournament</Text>
  </TouchableOpacity>
  <TouchableOpacity style={[s.secondaryBtn, { marginTop: 0, paddingHorizontal: 16 }]} onPress={() => navigation.navigate('JoinTournament')} activeOpacity={0.7}>
    <Feather name="link" size={18} color={theme.accent.primary} />
    <Text style={s.secondaryBtnText}>Join</Text>
  </TouchableOpacity>
</View>
```

Replace with:

```jsx
<TouchableOpacity
  style={[s.primaryBtn, { marginTop: 0 }]}
  onPress={() => navigation.navigate('Setup', { kind: 'game' })}
  activeOpacity={0.8}
>
  <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
  <Text style={s.primaryBtnText}>New Game</Text>
</TouchableOpacity>
<View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
  <TouchableOpacity
    style={[s.primaryBtn, { flex: 1, marginTop: 0 }]}
    onPress={() => navigation.navigate('Setup', { kind: 'tournament' })}
    activeOpacity={0.8}
  >
    <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
    <Text style={s.primaryBtnText}>New Tournament</Text>
  </TouchableOpacity>
  <TouchableOpacity style={[s.secondaryBtn, { marginTop: 0, paddingHorizontal: 16 }]} onPress={() => navigation.navigate('JoinTournament')} activeOpacity={0.7}>
    <Feather name="link" size={18} color={theme.accent.primary} />
    <Text style={s.secondaryBtnText}>Join</Text>
  </TouchableOpacity>
</View>
```

- [ ] **Step 2: Verify**

Run `npm run web`. On Home you should see:

- Top: full-width **New Game** button.
- Below: row with **New Tournament** (flex 1) + **Join** (compact).

Tap **New Game** → header reads "New Game", section header "Course" (no "Rounds"), no "Add Round" button, name field prefilled `Game · DD MMM`, "Start Game" CTA at the bottom. Add a course → name updates to `Game at <Course> · DD MMM`. Type something into the name field → next time you change the course, the name no longer updates. Add 3 players → Best Ball tile is greyed out with "Requires 4 players". Add a 4th → tile becomes active.

Tap **New Tournament** → header "New Tournament", "Rounds" section, "Add Round" button visible, name "Weekend Golf", "Start Tournament" CTA. (Tournament mode regression check.)

- [ ] **Step 3: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "HomeScreen: add New Game CTA, route kind to Setup"
```

---

## Task 7: HomeScreen — split list into Games and Tournaments sections

**Files:**
- Modify: `src/screens/HomeScreen.js` (the list block around lines 446–488)

- [ ] **Step 1: Add a card-renderer factored from the existing inline JSX**

The existing card markup (lines 450–486 inside the `.map`) is identical for both kinds aside from the meta line. Pull the per-card render into a local function inside the same component scope. Add it just before the `return` of the list view (above the `<SafeAreaView>` if you prefer; either is fine — pick where the surrounding `useState`s end):

```js
const renderTournamentCard = (t) => {
  const isGameKind = t.kind === 'game';
  const played = t.rounds.filter((r) => r.scores && Object.keys(r.scores).length > 0).length;
  const isActive = played < t.rounds.length;
  const courseName = isGameKind ? (t.rounds[0]?.courseName ?? '') : null;
  return (
    <View key={t.id} style={s.tournamentCardWrapper}>
      <TouchableOpacity style={s.tournamentCard} onPress={() => selectTournament(t.id)} activeOpacity={0.7}>
        <View style={s.tournamentCardLeft}>
          <View style={s.tournamentCardHeader}>
            <Text style={s.tournamentCardName}>{t.name}</Text>
            <View style={[s.statusBadge, !isActive && s.statusBadgeFinished]}>
              <Text style={[s.statusBadgeText, !isActive && s.statusBadgeTextFinished]}>
                {isActive ? 'Active' : 'Finished'}
              </Text>
            </View>
            {t._role === 'viewer' && (
              <View style={s.viewerBadge}>
                <Feather name="eye" size={9} color={theme.text.muted} />
                <Text style={s.viewerBadgeText}>Viewer</Text>
              </View>
            )}
          </View>
          <Text style={s.tournamentCardMeta}>
            {t.players.map((p) => p.name.split(' ')[0]).join(' · ')}
          </Text>
          <Text style={s.tournamentCardRound}>
            {isGameKind ? (courseName || 'Single round') : `Round ${played}/${t.rounds.length}`}
          </Text>
        </View>
        <View style={s.tournamentCardRight}>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </View>
      </TouchableOpacity>
      {t._role !== 'viewer' && (
        <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="trash-2" size={14} color={theme.destructive} />
        </TouchableOpacity>
      )}
    </View>
  );
};
```

- [ ] **Step 2: Replace the empty-state condition and the single-section render**

Locate (around lines 438–489):

```jsx
{allTournaments.length === 0 ? (
  <View style={s.emptyState}>
    <Feather name="flag" size={48} color={theme.text.muted} />
    <Text style={s.emptyTitle}>No tournaments yet</Text>
    <Text style={s.emptySubtitle}>Create your first tournament to start playing</Text>
  </View>
) : (
  <>
    <Text style={s.sectionLabel}>TOURNAMENTS</Text>
    {allTournaments
      .slice()
      .sort((a, b) => b.id - a.id)
      .map((t, index) => {
        // ... entire inline card render (replaced in Step 1)
      })}
  </>
)}
```

Replace with:

```jsx
{(() => {
  const sorted = allTournaments.slice().sort((a, b) => b.id - a.id);
  const games = sorted.filter((t) => t.kind === 'game');
  const tournaments = sorted.filter((t) => t.kind !== 'game');
  if (sorted.length === 0) {
    return (
      <View style={s.emptyState}>
        <Feather name="flag" size={48} color={theme.text.muted} />
        <Text style={s.emptyTitle}>Nothing here yet</Text>
        <Text style={s.emptySubtitle}>Create your first game or tournament to start playing</Text>
      </View>
    );
  }
  return (
    <>
      {games.length > 0 && (
        <>
          <Text style={s.sectionLabel}>GAMES</Text>
          {games.map(renderTournamentCard)}
        </>
      )}
      {tournaments.length > 0 && (
        <>
          <Text style={s.sectionLabel}>TOURNAMENTS</Text>
          {tournaments.map(renderTournamentCard)}
        </>
      )}
    </>
  );
})()}
```

- [ ] **Step 3: Update the header subtitle to reflect both counts**

Locate (around line 403):

```jsx
<Text style={s.subtitle}>{allTournaments.length} {allTournaments.length === 1 ? 'tournament' : 'tournaments'}</Text>
```

Replace with:

```jsx
<Text style={s.subtitle}>{(() => {
  const games = allTournaments.filter((t) => t.kind === 'game').length;
  const tourn = allTournaments.length - games;
  if (games === 0) return `${tourn} ${tourn === 1 ? 'tournament' : 'tournaments'}`;
  if (tourn === 0) return `${games} ${games === 1 ? 'game' : 'games'}`;
  return `${games} ${games === 1 ? 'game' : 'games'} · ${tourn} ${tourn === 1 ? 'tournament' : 'tournaments'}`;
})()}</Text>
```

- [ ] **Step 4: Verify**

Run `npm run web`.

- Empty state (delete all tournaments first if any): the empty card now reads "Nothing here yet".
- Create a Tournament. The list shows a single "TOURNAMENTS" section with one card. Subtitle: "1 tournament".
- Create a Game. The list now shows "GAMES" section above "TOURNAMENTS", each with one card. Subtitle: "1 game · 1 tournament". The Game card's third line shows the course name (or "Single round" if no course was set), not "Round 1/1".
- Reload the page (browser refresh) — sections persist (data round-tripped through Supabase JSON blob includes `kind`).
- Legacy check: in browser devtools, run `localStorage.getItem('@golf_tournament_<some-existing-id>')` for an old record without `kind`. The card must appear under TOURNAMENTS (no `kind` ⇒ default).

- [ ] **Step 5: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "HomeScreen: split list into Games and Tournaments sections"
```

---

## Task 8: HomeScreen — hide multi-round panels and Next-Round CTA in game detail

**Files:**
- Modify: `src/screens/HomeScreen.js` (the tournament-detail render around lines 525–783)

- [ ] **Step 1: Compute `isGame` once at the top of the detail render**

Just before the `return` of the detail view (right after the `getSelectedRoundValue` declaration around line 524), add:

```js
const isGame = tournament.kind === 'game';
```

- [ ] **Step 2: Hide the multi-round LEADERBOARD panel for games**

Locate the leaderboard card (the `<View style={s.mastersCard}>` block around lines 564–608). Wrap it in `{!isGame && (...)}`:

```jsx
{!isGame && (
  <View style={s.mastersCard}>
    {/* ... existing leaderboard content unchanged ... */}
  </View>
)}
```

- [ ] **Step 3: Hide the round-tabs strip and pager when there is only one round**

Locate the ROUND SCORES card (around lines 610–727). The card itself is already gated on `tournament.rounds.length > 0`; we want to additionally drop the horizontal tabs row and the pager wrapper when a Game (single round). Inside the card, locate:

```jsx
<FlatList
  horizontal
  showsHorizontalScrollIndicator={false}
  data={tournament.rounds}
  keyExtractor={(r) => r.id}
  style={s.tabBar}
  renderItem={...}
/>
```

Wrap that `<FlatList>` in `{!isGame && (...)}`:

```jsx
{!isGame && (
  <FlatList
    horizontal
    /* ... unchanged ... */
  />
)}
```

The pager `<ScrollView>` underneath stays — but for a Game it must render a single non-swipeable page. Right after the existing `<ScrollView ...>` opening element, locate the existing pager. Convert the pager render so the game case bypasses scrolling:

Replace:

```jsx
{roundPagerWidth > 0 && (
  <ScrollView
    ref={roundPagerRef}
    horizontal
    pagingEnabled={Platform.OS !== 'web'}
    /* ... lots of props ... */
  >
    {tournament.rounds.map((round, i) => (
      <RoundPage key={round.id} round={round} index={i} ... />
    ))}
  </ScrollView>
)}
```

with:

```jsx
{roundPagerWidth > 0 && (
  isGame ? (
    <RoundPage
      round={tournament.rounds[0]}
      index={0}
      width={roundPagerWidth}
      hasPrev={false}
      hasNext={false}
      revealed
      roundBestBall={roundBestBall}
      players={tournament.players}
      settings={settings}
      theme={theme}
      s={s}
      onGoToRound={goToRound}
      onOpenEdit={isViewer ? null : openRoundEdit}
    />
  ) : (
    <ScrollView
      ref={roundPagerRef}
      horizontal
      pagingEnabled={Platform.OS !== 'web'}
      /* ... keep all the existing pager props unchanged ... */
    >
      {tournament.rounds.map((round, i) => (
        <RoundPage
          key={round.id}
          round={round}
          index={i}
          width={roundPagerWidth}
          hasPrev={i > 0}
          hasNext={i < tournament.rounds.length - 1}
          revealed={!!round.revealed || i <= tournament.currentRound}
          roundBestBall={roundBestBall}
          players={tournament.players}
          settings={settings}
          theme={theme}
          s={s}
          onGoToRound={goToRound}
          onOpenEdit={isViewer ? null : openRoundEdit}
        />
      ))}
    </ScrollView>
  )
)}
```

(Don't paste literally — keep the existing tournament-mode `<ScrollView>` props as they are; only the surrounding `isGame ?` ternary is new.)

- [ ] **Step 4: Hide the Next Round CTA**

Locate the bottom-bar block (around lines 744–783):

```jsx
{tournament.rounds.length > 0 && (() => {
  const isCurrentRound = selectedRound === tournament.currentRound;
  const canShowNext = isCurrentRound && tournament.currentRound < tournament.rounds.length - 1;
  ...
```

For a Game, `tournament.rounds.length` is 1 so `canShowNext` is already `false` — the "Start Next Round" button never renders. The "Scorecard / Edit Scores" primary button should still show. No change needed here, but verify in Step 5 that it behaves.

- [ ] **Step 5: Verify**

Run `npm run web`.

Game flow:
- Open a Game card from Home.
- Detail screen: no LEADERBOARD card at top (the multi-round one). The ROUND SCORES card shows but with no R1 tab strip above the round content. Tap **Scorecard** in the bottom bar → opens the scorecard for the single round. No "Start Next Round" / "Next Round" button visible.

Tournament flow (regression):
- Open a Tournament card from Home.
- Detail screen: LEADERBOARD card appears at top (unchanged). ROUND SCORES card shows the R1 / R2 / R3 tabs and the swipe pager. Bottom bar shows Scorecard (+ Next Round when on the current round and a next round exists).

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "HomeScreen: hide multi-round chrome in game detail"
```

---

## Task 9: Final manual sweep

**Files:** none (verification only)

- [ ] **Step 1: Cross-screen smoke test**

Run `npm run web` and walk this script end to end:

1. From an empty Home, tap **New Game**. Add 2 players, pick a course, leave name auto-prefilled. Tap **Start Game**. The Home screen should reappear with a "GAMES" section containing the new card.
2. Open the Game. Confirm: no LEADERBOARD multi-round panel, no R1 tab strip, no Next Round button. Tap **Scorecard**, enter a couple of strokes, return to Home — Game still shows as Active.
3. Tap the avatar / Stats nav (if reachable) → Stats and Gallery should function for the game (one round of data). No multi-round selector.
4. Back on Home, tap **New Tournament**. Add 2 rounds. Confirm header reads "New Tournament", "Add Round" visible, "Round 1" / "Round 2" labels visible. Start it. Detail view shows multi-round leaderboard, R1/R2 tabs, Next Round CTA.
5. Reload the browser. Both records persist with their kind. Subtitle reads "1 game · 1 tournament".

- [ ] **Step 2: Legacy record check**

If you have access to a Supabase table editor (or a pre-existing record without `kind`), confirm a tournament whose JSON blob has no `kind` field still appears in the TOURNAMENTS section, opens normally, and shows the multi-round chrome.

- [ ] **Step 3: No-op commit if everything checks out**

If any small fix is needed (typo, copy tweak), commit it. Otherwise no commit — just close the loop with the user.

---

## Self-review notes (already applied)

- Spec coverage: data model (Task 1), setup header/CTA (Task 2), single-round mode (Task 3), auto-name (Task 4), Best Ball gate (Task 5), Home CTA + routing (Task 6), Home list split + subtitle (Task 7), detail-view chrome + Next Round (Task 8). All spec sections covered.
- Placeholder scan: no TBDs / TODOs / "add error handling" / "similar to above". Code shown for every code step.
- Type / name consistency: `kind` field consistent everywhere; `isGame` derived inline in both `SetupScreen` and `HomeScreen`; `buildGameName` is the single source of the auto-name format.
- Scope: kept to the three files in the spec (`tournamentStore.js`, `SetupScreen.js`, `HomeScreen.js`). No refactors beyond the small `renderTournamentCard` extraction in Task 7, which is justified — the JSX would otherwise be duplicated across two sections.
