# Weekend Tournament Modes + Duel Randomizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the live "Weekend Golf" tournament's round modes and pairs in Supabase, and add a "Randomize Matchups" action to the Pairs Match Play duel editor.

**Architecture:** Part A is a one-shot data fix that PATCHes the tournament row's `data` JSON exactly as the app's `mutate()` would (values + `_meta` LWW stamps). Part B adds a pure `randomizeDuelOrder` helper to `src/lib/teamEditing.js` (TDD) and a button in `EditTeamsScreen`'s existing DUELS card that calls it.

**Tech Stack:** Expo/React Native (JS, no TS), Jest (jest-expo), Supabase REST (service-role key from `.env`).

**Spec:** `docs/superpowers/specs/2026-07-11-weekend-tournament-modes-and-duel-randomizer-design.md`

## Global Constraints

- Tournament id: `1783584580051` ("Weekend Golf"); round ids `r0`, `r1`, `r2`.
- Target pairs on ALL rounds: `[[Marcos, Noé], [Guille, Alex]]` — reuse the tournament's embedded player objects verbatim.
- Round modes: `r0` no override (inherits `bestball`), `r1` `pairsmatchplay` (already set — do not rewrite), `r2` `scramblepairs` (new).
- `_meta` stamps for every changed path must be current epoch-ms (existing stamps top out at `1783724025246`).
- Do NOT touch any round's `revealed` field.
- Button copy: "Randomize Matchups" (icon `shuffle`); existing swap button becomes icon `repeat`, copy unchanged ("Swap Matchups").
- `npm test` and `npm run lint` must stay green. Ignore Jest failures from `.claude/worktrees/` or `.worktrees/` copies — only failures under the repo's own `src/` count.

---

### Task 1: Live data fix (Supabase)

**Files:**
- Create: `/private/tmp/claude-501/-Users-marcospecker-Documents-golf-partner/77f07870-92de-4a36-aa87-549cd16bc918/scratchpad/fix_weekend_golf.py` (scratchpad — NOT committed to the repo)
- No repo files change in this task.

**Interfaces:**
- Consumes: `.env` at repo root (`EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Produces: corrected tournament row in Supabase (later tasks don't depend on it, but the user's devices do).

- [ ] **Step 1: Write the fix script**

```python
# fix_weekend_golf.py — corrects pairs + round-3 mode on Weekend Golf
# (tournament 1783584580051) and stamps _meta so device LWW merges keep it.
import json, os, time, urllib.request

URL = os.environ['EXPO_PUBLIC_SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
TID = '1783584580051'

def req(method, path, body=None):
    r = urllib.request.Request(
        f'{URL}/rest/v1/{path}', method=method,
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                 'Content-Type': 'application/json',
                 'Prefer': 'return=representation'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as resp:
        return json.load(resp)

data = req('GET', f'tournaments?id=eq.{TID}&select=data')[0]['data']

byname = {p['name']: p for p in data['players']}
new_pairs = [[byname['Marcos'], byname['Noé']], [byname['Guille'], byname['Alex']]]
now = int(time.time() * 1000)
meta = data.get('_meta') or {}

for r in data['rounds']:
    r['pairs'] = json.loads(json.dumps(new_pairs))  # fresh copies per round
    meta[f"rounds.{r['id']}.pairs"] = now

r2 = next(r for r in data['rounds'] if r['id'] == 'r2')
r2['scoringMode'] = 'scramblepairs'
meta['rounds.r2.scoringMode'] = now
data['_meta'] = meta

req('PATCH', f'tournaments?id=eq.{TID}', {'data': data})

# Verify from a fresh read.
check = req('GET', f'tournaments?id=eq.{TID}&select=data')[0]['data']
modes = {r['id']: r.get('scoringMode') for r in check['rounds']}
assert modes == {'r0': None, 'r1': 'pairsmatchplay', 'r2': 'scramblepairs'}, modes
for r in check['rounds']:
    names = [[p['name'] for p in pr] for pr in r['pairs']]
    assert names == [['Marcos', 'Noé'], ['Guille', 'Alex']], (r['id'], names)
    assert check['_meta'][f"rounds.{r['id']}.pairs"] == now
assert check['_meta']['rounds.r2.scoringMode'] == now
print('OK — modes:', modes)
```

- [ ] **Step 2: Run it**

```bash
cd /Users/marcospecker/Documents/golf-partner && set -a && source .env && set +a && \
python3 "/private/tmp/claude-501/-Users-marcospecker-Documents-golf-partner/77f07870-92de-4a36-aa87-549cd16bc918/scratchpad/fix_weekend_golf.py"
```

Expected output: `OK — modes: {'r0': None, 'r1': 'pairsmatchplay', 'r2': 'scramblepairs'}`

If an assertion fails (e.g. a device pushed between read and PATCH), re-run the script once — it re-reads fresh data each run.

- [ ] **Step 3: Nothing to commit** — this task changes no repo files.

---

### Task 2: `randomizeDuelOrder` helper (TDD)

**Files:**
- Modify: `src/lib/teamEditing.js` (currently 22 lines; append after `swapDuelOrder`)
- Test: `src/lib/__tests__/teamEditing.test.js` (append a new `describe` block)

**Interfaces:**
- Consumes: `swapDuelOrder(pairs)` already exported from the same file — returns `[pairs[0], reversed pairs[1]]`, passes through non-2-pair input unchanged.
- Produces: `export function randomizeDuelOrder(pairs, rand = Math.random)` → same pairs shape (`[[playerA1, playerA2], [playerB1, playerB2]]`); `rand() < 0.5` keeps the current duel assignment, otherwise returns the swapped one. Non-2-pair input returned unchanged. Task 3 imports this exact name from `'../lib/teamEditing'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/teamEditing.test.js` (it already imports from `'../teamEditing'` — extend that import to include `randomizeDuelOrder`, and reuse the existing top-level `players` fixture):

```js
describe('randomizeDuelOrder', () => {
  const pairs = [
    [players[0], players[1]],
    [players[2], players[3]],
  ];

  test('rand below 0.5 keeps the current duel assignment', () => {
    expect(randomizeDuelOrder(pairs, () => 0)).toEqual(pairs);
  });

  test('rand at/above 0.5 returns the swapped assignment', () => {
    expect(randomizeDuelOrder(pairs, () => 0.9)).toEqual(swapDuelOrder(pairs));
  });

  test('never changes pair membership, only within-pair order', () => {
    for (const roll of [0, 0.9]) {
      const out = randomizeDuelOrder(pairs, () => roll);
      expect(out[0]).toEqual(pairs[0]);
      expect(out[1].map((p) => p.id).sort()).toEqual(
        pairs[1].map((p) => p.id).sort(),
      );
    }
  });

  test('default randomness produces both outcomes across runs', () => {
    const seen = new Set();
    for (let i = 0; i < 64 && seen.size < 2; i++) {
      seen.add(JSON.stringify(randomizeDuelOrder(pairs).map((pr) => pr.map((p) => p.id))));
    }
    expect(seen.size).toBe(2);
  });

  test('non-2-pair input is returned unchanged', () => {
    const solo = [[players[0]], [players[1]], [players[2]]];
    expect(randomizeDuelOrder(solo, () => 0)).toBe(solo);
    expect(randomizeDuelOrder(null, () => 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/teamEditing.test.js`
Expected: FAIL — `randomizeDuelOrder is not a function` (5 new tests fail, existing 8 pass).

- [ ] **Step 3: Implement**

Append to `src/lib/teamEditing.js`:

```js
// pairsmatchplay: randomly draws one of the two possible duel assignments —
// with fixed 2x2 pairs, "keep" and "swap" (swapDuelOrder) are the whole
// space. `rand` is injectable so tests can pin the coin flip.
export function randomizeDuelOrder(pairs, rand = Math.random) {
  if (!Array.isArray(pairs) || pairs.length !== 2) return pairs;
  return rand() < 0.5 ? [pairs[0], [...(pairs[1] ?? [])]] : swapDuelOrder(pairs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/teamEditing.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/teamEditing.js src/lib/__tests__/teamEditing.test.js
git commit -m "feat(team-editing): randomizeDuelOrder draws a random duel assignment"
```

---

### Task 3: "Randomize Matchups" button in EditTeamsScreen

**Files:**
- Modify: `src/screens/EditTeamsScreen.js` (import at line 10; handler near `onSwapDuels` ~line 71; DUELS card JSX ~lines 196–209)

**Interfaces:**
- Consumes: `randomizeDuelOrder(pairs)` from Task 2 (`import ... from '../lib/teamEditing'`).
- Produces: UI only — nothing downstream consumes it.

- [ ] **Step 1: Extend the import**

Change line 10 of `src/screens/EditTeamsScreen.js`:

```js
import { buildThreeVsOne, swapDuelOrder, randomizeDuelOrder } from '../lib/teamEditing';
```

- [ ] **Step 2: Add the handler**

Directly below the existing `onSwapDuels` function:

```js
  function onRandomizeDuels() {
    hasLocalEdits.current = true;
    setPairs(randomizeDuelOrder(pairs));
  }
```

- [ ] **Step 3: Add the button to the DUELS card**

In the `{isPairsMatch && duels && (...)}` block, replace the single swap button with a Randomize button followed by the swap button (swap icon changes `shuffle` → `repeat`; `shuffle` now belongs to Randomize):

```jsx
            <TouchableOpacity style={s.swapDuelsBtn} onPress={onRandomizeDuels} activeOpacity={0.7}>
              <Feather name="shuffle" size={16} color={theme.accent.primary} />
              <Text style={s.swapDuelsBtnText}>Randomize Matchups</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.swapDuelsBtn} onPress={onSwapDuels} activeOpacity={0.7}>
              <Feather name="repeat" size={16} color={theme.accent.primary} />
              <Text style={s.swapDuelsBtnText}>Swap Matchups</Text>
            </TouchableOpacity>
```

Both buttons reuse the existing `swapDuelsBtn` / `swapDuelsBtnText` styles — no style changes.

- [ ] **Step 4: Run the full suite and lint**

Run: `npx jest src/ 2>&1 | tail -5` then `npm run lint`
Expected: all suites under `src/` pass; lint reports no errors in modified files. (Failures under `.claude/worktrees/` or `.worktrees/` don't count.)

- [ ] **Step 5: Commit**

```bash
git add src/screens/EditTeamsScreen.js
git commit -m "feat(edit-teams): Randomize Matchups button for pairs match play duels"
```

---

### Task 4: Runtime verification (main session, verify skill)

**Files:** none (verification only).

**Interfaces:** Consumes the shipped UI from Task 3 and the app's QA login flow from `.claude/skills/verify`.

- [ ] **Step 1:** Launch the web app per the project `verify` skill and sign in as a QA user.
- [ ] **Step 2:** Create a replica tournament: 4 players, 3 rounds, scoring mode Best Ball / Worst Ball, fixed teams ON, manual teams ON (the QA account can't see the real tournament).
- [ ] **Step 3:** On round 2: ••• → Scoring Mode → pick "Pairs Match Play". Re-open the sheet and confirm the subtitle now reads "Pairs Match Play" while round 1's sheet still reads "Best Ball / Worst Ball".
- [ ] **Step 4:** Set round 3 to "Scramble — Pairs" the same way and confirm its sheet subtitle.
- [ ] **Step 5:** Reveal round 2's teams, open ••• → Edit Teams: confirm the DUELS card shows two duels plus "Randomize Matchups" and "Swap Matchups"; tap Randomize a few times (duels flip between the two draws), tap Swap (deterministic flip), Save, re-open and confirm persistence.
- [ ] **Step 6:** Report findings with screenshots; no commit.
