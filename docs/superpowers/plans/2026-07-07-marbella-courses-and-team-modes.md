# Marbella Course Data + Scramble & Pairs Match Play Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill official tee/rating data for the user's Marbella-area courses in the live Supabase DB, and add four new scoring modes (three scramble variants + pairs match play) to the app.

**Architecture:** Part 1 (Tasks 1–5) is live-data work via the Supabase REST API using the service-role key from `.env` — no app code. Part 2 (Tasks 6–15) extends the existing scoring-mode catalog pattern: catalog entries in `src/components/scoringModes.js`, pure engines in `src/store/scoring.js`, scorecard integration via `src/components/scorecard/scoreModel.js`, leaderboard branches in `HomeScreen.js`, and a stats exclusion in `personalStats.js`.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, plain JS stores, Jest (jest-expo), Supabase (PostgREST).

**Spec:** `docs/superpowers/specs/2026-07-07-marbella-courses-and-team-modes-design.md`

## Global Constraints

- Tests: `npm test` (Jest, ~330 tests). Lint: `npm run lint` (CI-blocking). Both must pass at every commit.
- Domain logic lives in `src/store/` / pure modules — never in screens (CLAUDE.md).
- New mode keys are lowercase, matching `individual|stableford|matchplay|sindicato|bestball`: **`scramblepairs`, `scramble3v1`, `scramble4`, `pairsmatchplay`**.
- All four new modes: `teams: true`, `isAllowed: (count) => count === 4`, `requirement: 'Requires exactly 4 players'`.
- USGA Appendix C scramble allowances (low→high course handicap): 2-man **35/15%**, 3-man **20/15/10%**, 4-man **25/20/15/10%**; individual in 3v1 plays off 100%.
- Pairs match play: 2 points per hole (1 per duel; ½/½ on a halved duel), net via `calcExtraShots`, duels derived from within-pair order (no new round fields).
- Scramble team scores are stored under the **team captain** (= `pair[0]`) in the existing `round.scores[playerId][holeNumber]` shape. No sync/merge/mutate changes.
- Official tournaments use a separate format list (`OfficialCreateScreen.js:19`) — the new modes must NOT be added there.
- Live-DB commands read credentials from `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Never print the key.

---

## PART 1 — LIVE COURSE DATA (no app code)

**Live row IDs (verified 2026-07-07):**
- Golf Torrequebrada: course `e6b357db-c8ef-4a5f-b51d-699b1b2dcfd4`, Default tee `c726d60f-41a0-40f8-936b-ef4a95a0cfe4`
- Santa Clara Golf Marbella (canonical): course `942f2c50-a854-4ffd-b42b-6933a2890790`, Default tee `a3bcb7ed-c5e2-4703-9a2e-47c974fb4732`
- Santa Clara (duplicate, to delete): course `49802bf8-3e1f-4c07-b717-8699a576510e`
- Verified: no `favorite_courses` rows and no tournament `data` JSON reference either Santa Clara id (older rounds snapshot only `courseName`/`slope`); both rows have 18 `course_holes`.

**Schema facts:** `course_tees(course_id, label, rating numeric, slope integer, sort_order, yardages jsonb {holeNumber: meters})`; `course_holes(course_id, number, par, stroke_index)` — no distance column, distances go in tee `yardages`. `courses` has legacy top-level `rating`/`slope` (used by `roundCourse.courseFields` as the round-level fallback) plus `club_id`, `layout_name`, `city`, `province`. `clubs(name UNIQUE, city, province)`.

**Convention:** ladies' tees are separate rows labeled `<Color> (Damas)` (matches the existing "Golf Santander S.A." course). Legacy `courses.rating/slope` are set to the **Amarillas men** values.

**Helper pattern used by every task below** (run from repo root; each task writes its own `payload` inline):

```bash
set -a && source .env && set +a
python3 - <<'PY'
import json, os, urllib.request
BASE = os.environ['EXPO_PUBLIC_SUPABASE_URL'] + '/rest/v1'
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
def req(method, path, body=None, prefer='return=representation'):
    r = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
                 'Content-Type': 'application/json', 'Prefer': prefer})
    with urllib.request.urlopen(r) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None
# ... task-specific calls ...
PY
```

### Task 1: Golf Torrequebrada tee sets

**Files:** none (live DB only).
**Interfaces:** Produces: 8 `course_tees` rows for course `e6b357db-…`; `courses.rating=70.9, slope=139`.

Official data (club scorecard 2023 + RFEG table AM60-1, par 72):

| Tee | CR | Slope |
|---|---|---|
| Blancas | 71.2 | 139 |
| Blancas (Damas) | 77.5 | 141 |
| Amarillas | 70.9 | 139 |
| Amarillas (Damas) | 77.1 | 140 |
| Azules | 67.3 | 130 |
| Azules (Damas) | 72.3 | 131 |
| Rojas | 66.5 | 127 |
| Rojas (Damas) | 71.3 | 129 |

- [ ] **Step 1: Replace the Default tee with the 8 official tees and set legacy course fields**

Using the helper pattern, the task-specific body:

```python
CID = 'e6b357db-c8ef-4a5f-b51d-699b1b2dcfd4'
TEES = [
    ('Blancas', 71.2, 139), ('Blancas (Damas)', 77.5, 141),
    ('Amarillas', 70.9, 139), ('Amarillas (Damas)', 77.1, 140),
    ('Azules', 67.3, 130), ('Azules (Damas)', 72.3, 131),
    ('Rojas', 66.5, 127), ('Rojas (Damas)', 71.3, 129),
]
req('DELETE', f'/course_tees?course_id=eq.{CID}', prefer='return=minimal')
req('POST', '/course_tees', [
    {'course_id': CID, 'label': l, 'rating': r, 'slope': s, 'sort_order': i}
    for i, (l, r, s) in enumerate(TEES)
])
req('PATCH', f'/courses?id=eq.{CID}', {'rating': 70.9, 'slope': 139, 'city': 'Benalmádena', 'province': 'Málaga'})
print('ok')
```

- [ ] **Step 2: Verify**

```bash
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/courses?select=name,rating,slope,course_tees(label,rating,slope,sort_order)&id=eq.e6b357db-c8ef-4a5f-b51d-699b1b2dcfd4" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
Expected: 8 tees ordered Blancas→Rojas (Damas), course rating 70.9 / slope 139.

### Task 2: Santa Clara Golf Marbella tee sets + duplicate merge

**Files:** none (live DB only).
**Interfaces:** Produces: 8 tees on course `942f2c50-…`; duplicate course `49802bf8-…` deleted.

Data note: Santa Clara ratings are aggregator-sourced (GolfPass, cross-checked with Golfify; club gates its RFEG sheet). Par 71.

| Tee | CR | Slope |
|---|---|---|
| Blancas | 71.0 | 135 |
| Blancas (Damas) | 77.7 | 132 |
| Amarillas | 69.3 | 132 |
| Amarillas (Damas) | 75.7 | 128 |
| Azules | 67.7 | 128 |
| Azules (Damas) | 73.3 | 126 |
| Rojas | 65.6 | 123 |
| Rojas (Damas) | 70.5 | 122 |

- [ ] **Step 1: Re-verify the duplicate is unreferenced** (favorites + tournaments); if any reference has appeared since planning, STOP and report instead of deleting.

```bash
set -a && source .env && set +a
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/favorite_courses?select=id&course_id=eq.49802bf8-3e1f-4c07-b717-8699a576510e" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
Expected: `[]`. Then fetch `tournaments?select=id,data` and confirm the string `49802bf8` appears in none (scan `json.dumps(row['data'])` per row in Python).

- [ ] **Step 2: Replace canonical tees, set legacy fields, delete the duplicate**

```python
CID = '942f2c50-a854-4ffd-b42b-6933a2890790'
DUP = '49802bf8-3e1f-4c07-b717-8699a576510e'
TEES = [
    ('Blancas', 71.0, 135), ('Blancas (Damas)', 77.7, 132),
    ('Amarillas', 69.3, 132), ('Amarillas (Damas)', 75.7, 128),
    ('Azules', 67.7, 128), ('Azules (Damas)', 73.3, 126),
    ('Rojas', 65.6, 123), ('Rojas (Damas)', 70.5, 122),
]
req('DELETE', f'/course_tees?course_id=eq.{CID}', prefer='return=minimal')
req('POST', '/course_tees', [
    {'course_id': CID, 'label': l, 'rating': r, 'slope': s, 'sort_order': i}
    for i, (l, r, s) in enumerate(TEES)
])
req('PATCH', f'/courses?id=eq.{CID}', {'rating': 69.3, 'slope': 132, 'city': 'Marbella', 'province': 'Málaga'})
# course_holes / course_tees have ON DELETE CASCADE on course_id
req('DELETE', f'/courses?id=eq.{DUP}', prefer='return=minimal')
print('ok')
```

- [ ] **Step 3: Verify** — fetch the canonical course (expect 8 tees, rating 69.3/slope 132) and confirm `GET /courses?id=eq.49802bf8-…` returns `[]`.

### Task 3: Mijas Golf club + Los Lagos course

**Files:** none (live DB only).
**Interfaces:** Produces: `clubs` row "Mijas Golf"; course "Mijas Golf Los Lagos" (18 holes, 8 tees) — its club id is consumed by Task 4.

Official data (club scorecard + RFEG AM61-1, par 72). Tees:

| Tee | CR | Slope |
|---|---|---|
| Blancas | 73.7 | 126 |
| Blancas (Damas) | 82.2 | 142 |
| Amarillas | 72.6 | 124 |
| Amarillas (Damas) | 81.0 | 141 |
| Azules | 68.3 | 121 |
| Azules (Damas) | 74.5 | 128 |
| Rojas | 65.8 | 114 |
| Rojas (Damas) | 71.6 | 120 |

- [ ] **Step 1: Create club, course, holes, tees**

```python
club = req('POST', '/clubs', {'name': 'Mijas Golf', 'city': 'Mijas', 'province': 'Málaga'})[0]
course = req('POST', '/courses', {
    'name': 'Mijas Golf Los Lagos', 'club_id': club['id'], 'layout_name': 'Los Lagos',
    'city': 'Mijas', 'province': 'Málaga', 'rating': 72.6, 'slope': 124,
})[0]
CID = course['id']
# (number, par, stroke_index, amarillas_m, blancas_m)
HOLES = [
    (1, 5, 9, 499, 508), (2, 3, 17, 148, 162), (3, 4, 15, 323, 344),
    (4, 4, 7, 374, 390), (5, 5, 3, 536, 580), (6, 4, 1, 415, 423),
    (7, 4, 13, 379, 387), (8, 3, 5, 210, 220), (9, 4, 11, 341, 348),
    (10, 4, 2, 408, 418), (11, 3, 8, 160, 176), (12, 4, 10, 359, 370),
    (13, 5, 4, 520, 535), (14, 4, 6, 353, 361), (15, 5, 16, 466, 475),
    (16, 3, 18, 142, 150), (17, 4, 14, 342, 351), (18, 4, 12, 332, 338),
]
req('POST', '/course_holes', [
    {'course_id': CID, 'number': n, 'par': p, 'stroke_index': si}
    for (n, p, si, _, _b) in HOLES
])
am = {str(n): m for (n, _, _, m, _b) in HOLES}
bl = {str(n): m for (n, _, _, _a, m) in HOLES}
TEES = [
    ('Blancas', 73.7, 126, bl), ('Blancas (Damas)', 82.2, 142, bl),
    ('Amarillas', 72.6, 124, am), ('Amarillas (Damas)', 81.0, 141, am),
    ('Azules', 68.3, 121, None), ('Azules (Damas)', 74.5, 128, None),
    ('Rojas', 65.8, 114, None), ('Rojas (Damas)', 71.6, 120, None),
]
req('POST', '/course_tees', [
    {'course_id': CID, 'label': l, 'rating': r, 'slope': s, 'sort_order': i, 'yardages': y}
    for i, (l, r, s, y) in enumerate(TEES)
])
print('course', CID)
```

- [ ] **Step 2: Verify** — fetch the course with holes+tees: 18 holes (par sum **72**, SI 1–18 each used once), 8 tees, Amarillas yardages sum **6307**, Blancas **6536**.

### Task 4: Mijas Golf Los Olivos course

**Files:** none (live DB only).
**Interfaces:** Consumes: "Mijas Golf" club id (query by name). Produces: course "Mijas Golf Los Olivos" (18 holes, 3 tees).

Official data (2025 club scorecard + RFEG AM61-2). **Par 71** (hole 15 re-rated to par 5). No Azules tee exists. Only three rated tees are current: Blancas men 71.0/124, Amarillas men 69.4/123, Rojas ladies 71.1/120 (other gender ratings are not published — do NOT invent them).

- [ ] **Step 1: Create course, holes, tees**

```python
club = req('GET', '/clubs?select=id&name=eq.Mijas%20Golf')[0]
course = req('POST', '/courses', {
    'name': 'Mijas Golf Los Olivos', 'club_id': club['id'], 'layout_name': 'Los Olivos',
    'city': 'Mijas', 'province': 'Málaga', 'rating': 69.4, 'slope': 123,
})[0]
CID = course['id']
# (number, par, stroke_index, amarillas_m, blancas_m, rojas_m)
HOLES = [
    (1, 4, 17, 301, 308, 275), (2, 4, 1, 392, 397, 338), (3, 3, 15, 156, 161, 130),
    (4, 4, 11, 310, 323, 279), (5, 4, 9, 375, 392, 338), (6, 3, 13, 162, 167, 134),
    (7, 4, 5, 309, 350, 280), (8, 3, 3, 174, 214, 128), (9, 5, 7, 494, 503, 443),
    (10, 5, 6, 507, 511, 454), (11, 4, 14, 314, 339, 291), (12, 4, 4, 368, 373, 326),
    (13, 4, 12, 296, 300, 264), (14, 3, 10, 162, 163, 137), (15, 5, 2, 401, 433, 331),
    (16, 3, 18, 130, 135, 101), (17, 4, 16, 316, 371, 293), (18, 5, 8, 421, 435, 384),
]
req('POST', '/course_holes', [
    {'course_id': CID, 'number': n, 'par': p, 'stroke_index': si}
    for (n, p, si, *_rest) in HOLES
])
am = {str(n): a for (n, _, _, a, _b, _r) in HOLES}
bl = {str(n): b for (n, _, _, _a, b, _r) in HOLES}
ro = {str(n): r for (n, _, _, _a, _b, r) in HOLES}
TEES = [
    ('Blancas', 71.0, 124, bl),
    ('Amarillas', 69.4, 123, am),
    ('Rojas (Damas)', 71.1, 120, ro),
]
req('POST', '/course_tees', [
    {'course_id': CID, 'label': l, 'rating': r, 'slope': s, 'sort_order': i, 'yardages': y}
    for i, (l, r, s, y) in enumerate(TEES)
])
print('course', CID)
```

- [ ] **Step 2: Verify** — 18 holes, par sum **71**, SI 1–18 each once, Amarillas yardages sum **5588**, Blancas **5875**, Rojas **4926**, 3 tees.

### Task 5: Part 1 verification pass

- [ ] **Step 1:** Fetch all four courses with tees+holes in one query and check against the tables above.
- [ ] **Step 2: WHS sanity check** — for handicap index 10.0 on Mijas Los Lagos Amarillas: `10 × (124/113) + (72.6 − 72) = 11.57 → course handicap 12`. Confirm the same result from the app's own function:

```bash
node -e "const {calcPlayingHandicap}=require('./src/store/scoring.js'); console.log(calcPlayingHandicap(10, 124, 72.6, 72))"
```
Expected: `12`. (If `require` fails due to ESM, run the equivalent check through a quick Jest scratch test instead.)
- [ ] **Step 3:** Report the four course IDs + tee counts in the task summary.

---

## PART 2 — GAME MODES (app code)

**Engine map (verified):** `scoring.js` holds the pure engines (`calcStablefordPoints:112`, `calcExtraShots:105`, `matchPlayHolePts:123`, `matchPlayRoundTally:138`, `sindicatoHolePoints:177`, `randomPairs:236`); `tournamentStore.js` re-exports them and holds `DEFAULT_SETTINGS:848`, `roundTotals:874`, `roundPairLeaderboard:891`, `calcBestWorstBall:907`, `roundMaxRemainingStableford:1113`, `roundPairClinched:1139`, and the three pair-patch builders (`buildPairsForAddedPlayer:702`, `buildPairsForRemovedPlayer:753`, `buildPairsForModeChange:808`). `scoreModel.js` is the scorecard's per-mode facade (`holePoints:17`, `roundTotals:36`, `summaryState:96`). Pair-building call sites that use `scoringModeUsesTeams(...) ? randomPairs(players) : players.map(p => [p])`: `SetupScreen.js:356-361`, `EditTournamentScreen.js:205-208`, `NextRoundScreen.js:57-62`, `quickStartGame.js:~185`, and the three tournamentStore patch builders. `round.pairs` is an array of arrays of **full player objects**. Round handicaps are frozen at round build in `round.playerHandicaps` (`quickStartGame.buildQuickStartRound`). Scores flow through `mutate({type:'score.set', roundId, playerId, hole, value})` — unchanged by this plan.

### Task 6: Mode catalog entries

**Files:**
- Modify: `src/components/scoringModes.js`
- Test: `src/components/__tests__/scoringModes.test.js`

**Interfaces:**
- Produces: four new `SCORING_MODES` entries (keys above); `SCRAMBLE_MODES` (Set) and `isScrambleMode(key)` exports; `leaderboardToggleLabels` handling for the new keys. Consumed by every later task.

- [ ] **Step 1: Write failing tests** — append to `scoringModes.test.js`:

```js
describe('new team modes', () => {
  const NEW_KEYS = ['scramblepairs', 'scramble3v1', 'scramble4', 'pairsmatchplay'];

  it('registers all four modes, teams-based, gated to exactly 4 players', () => {
    for (const key of NEW_KEYS) {
      const def = SCORING_MODES.find((m) => m.key === key);
      expect(def).toBeTruthy();
      expect(def.teams).toBe(true);
      expect(isScoringModeAllowed(key, 4)).toBe(true);
      expect(isScoringModeAllowed(key, 3)).toBe(false);
      expect(isScoringModeAllowed(key, 5)).toBe(false);
    }
  });

  it('identifies scramble modes', () => {
    expect(isScrambleMode('scramblepairs')).toBe(true);
    expect(isScrambleMode('scramble3v1')).toBe(true);
    expect(isScrambleMode('scramble4')).toBe(true);
    expect(isScrambleMode('pairsmatchplay')).toBe(false);
    expect(isScrambleMode('stableford')).toBe(false);
  });

  it('scoringModeUsesTeams is true for the new modes at 4 players', () => {
    for (const key of NEW_KEYS) {
      expect(scoringModeUsesTeams(key, 4)).toBe(true);
      expect(scoringModeUsesTeams(key, 3)).toBe(false);
    }
  });

  it('leaderboard toggles', () => {
    expect(leaderboardToggleLabels('pairsmatchplay')).toEqual({ left: 'Match Play', right: 'Stableford' });
    expect(leaderboardToggleLabels('scramblepairs')).toEqual({ left: 'Scramble', right: 'Stroke Play' });
    expect(leaderboardToggleLabels('scramble4')).toEqual({ left: 'Scramble', right: 'Stroke Play' });
  });
});
```
(Import `isScrambleMode` in the test file's existing import list.)

- [ ] **Step 2:** `npm test -- scoringModes` → new tests FAIL (`isScrambleMode` undefined, modes missing).
- [ ] **Step 3: Implement** — in `scoringModes.js`, append to `SCORING_MODES` (after the `bestball` entry, keeping the Teams category together):

```js
  {
    key: 'scramblepairs',
    label: 'Scramble — Pairs',
    subtitle: 'Two teams, one ball each',
    icon: 'users',
    category: 'Teams',
    // Two teams of 2 — teams are assigned and revealed each round.
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'scramble3v1',
    label: 'Scramble — 3 vs 1',
    subtitle: 'Three-man scramble vs a solo player',
    icon: 'users',
    category: 'Teams',
    // A team of 3 against one individual — sides assigned and revealed.
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'scramble4',
    label: 'Scramble — 4-man',
    subtitle: 'One team, one ball, vs the course',
    icon: 'users',
    category: 'Teams',
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
  {
    key: 'pairsmatchplay',
    label: 'Pairs Match Play',
    subtitle: 'Two 1v1 duels, 2 points per hole',
    icon: 'flag',
    category: 'Teams',
    // Two pairs; each player duels one opponent from the other pair.
    teams: true,
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
```

Add next to `getScoringMode`:

```js
// Scramble modes share one engine: the team plays a single ball, scored
// under the team captain. Used to route scoring, hide personal stats, and
// build non-2x2 team shapes.
export const SCRAMBLE_MODES = new Set(['scramblepairs', 'scramble3v1', 'scramble4']);

export function isScrambleMode(key) {
  return SCRAMBLE_MODES.has(key);
}
```

Extend `leaderboardToggleLabels` (before the final `return`):

```js
  if (scoringMode === 'pairsmatchplay') return { left: 'Match Play', right: 'Stableford' };
  if (isScrambleMode(scoringMode)) return { left: 'Scramble', right: 'Stroke Play' };
```

- [ ] **Step 4:** `npm test -- scoringModes` → PASS. Also run the neighbour suites that assert on mode lists: `npm test -- ScoringModeChangeSheet SetupScreen` (fix only genuine breaks, e.g. tests that assert the total mode count).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(modes): register scramble and pairs match play modes"`

### Task 7: Team building for the new modes

**Files:**
- Modify: `src/store/scoring.js` (near `randomPairs`, `:236`)
- Test: `src/store/__tests__/scoring.test.js`

**Interfaces:**
- Produces: `buildTeamsForMode(mode, players)` → `Array<Array<player>>`; refactored `shufflePlayers(players)`. Consumed by Task 8's call sites.

- [ ] **Step 1: Write failing tests** (append to `scoring.test.js`):

```js
describe('buildTeamsForMode', () => {
  const four = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('scramblepairs / pairsmatchplay → two teams of two', () => {
    for (const mode of ['scramblepairs', 'pairsmatchplay']) {
      const teams = buildTeamsForMode(mode, four);
      expect(teams).toHaveLength(2);
      expect(teams[0]).toHaveLength(2);
      expect(teams[1]).toHaveLength(2);
      expect(teams.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('scramble3v1 → a team of three and a solo side', () => {
    const teams = buildTeamsForMode('scramble3v1', four);
    expect(teams.map((t) => t.length)).toEqual([3, 1]);
    expect(teams.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('scramble4 → one team of four', () => {
    const teams = buildTeamsForMode('scramble4', four);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toHaveLength(4);
  });

  it('non-team or invalid roster → singleton pairs', () => {
    expect(buildTeamsForMode('individual', four)).toEqual(four.map((p) => [p]));
    expect(buildTeamsForMode('scramble4', four.slice(0, 3))).toEqual(
      four.slice(0, 3).map((p) => [p]),
    );
  });

  it('existing team mode still routes through randomPairs shape', () => {
    const teams = buildTeamsForMode('stableford', four);
    expect(teams).toHaveLength(2);
    expect(teams.every((t) => t.length === 2)).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test -- scoring.test` → FAIL (`buildTeamsForMode` not exported).
- [ ] **Step 3: Implement** in `scoring.js`. Extract the Fisher-Yates from `randomPairs` and add the builder:

```js
// Fisher-Yates copy-shuffle shared by randomPairs and buildTeamsForMode.
export function shufflePlayers(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function randomPairs(players) {
  const shuffled = shufflePlayers(players);
  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const pair = [shuffled[i], shuffled[i + 1]].filter(Boolean);
    if (pair.length > 0) pairs.push(pair);
  }
  return pairs;
}

// Team shapes per mode. 2x2 modes ride randomPairs; scramble3v1 splits a
// shuffled roster 3+1 (the solo player is random); scramble4 is one team.
// Invalid mode/roster combos degrade to singleton pairs, matching the
// existing non-team fallback everywhere pairs are built.
export function buildTeamsForMode(mode, players) {
  if (!scoringModeUsesTeams(mode, players.length)) {
    return players.map((p) => [p]);
  }
  if (mode === 'scramble4') return [shufflePlayers(players)];
  if (mode === 'scramble3v1') {
    const shuffled = shufflePlayers(players);
    return [shuffled.slice(0, 3), shuffled.slice(3)];
  }
  return randomPairs(players);
}
```

Import at the top of `scoring.js`: `import { scoringModeUsesTeams } from '../components/scoringModes';` (no cycle: `scoringModes.js` imports nothing from stores). Check whether `scoring.js` already imports from that module; merge imports if so.

- [ ] **Step 4:** `npm test -- scoring.test` → PASS.
- [ ] **Step 5: Commit** — `feat(modes): buildTeamsForMode team-shape builder`

### Task 8: Wire buildTeamsForMode into every pair-build call site

**Files:**
- Modify: `src/store/tournamentStore.js` (`buildPairsForAddedPlayer:702`, `buildPairsForRemovedPlayer:753`, `buildPairsForModeChange:808`)
- Modify: `src/screens/SetupScreen.js:356-361`, `src/screens/EditTournamentScreen.js:205-208`, `src/screens/NextRoundScreen.js:57-62`, `src/lib/quickStartGame.js` (pairs decision ~`:185`)
- Test: `src/store/__tests__/setScoringModeRoundPatches.test.js`, `src/store/__tests__/addPlayerRoundPatches.test.js`

**Interfaces:**
- Consumes: `buildTeamsForMode(mode, players)` (Task 7).
- Produces: every place that builds `round.pairs` produces correct shapes for the new modes (2×2, 3+1, 1×4).

- [ ] **Step 1: Write failing tests** — append to `setScoringModeRoundPatches.test.js` (reuse its `makeTournament`/`makeRound` helpers and its player factory — match the file's exact helper names/shapes):

```js
describe('new team mode shapes', () => {
  it('switching to scramble3v1 rebuilds future rounds as 3+1', () => {
    const t = makeTournament({
      players: [p('a'), p('b'), p('c'), p('d')],
      mode: 'stableford',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'scramble3v1');
    expect(patches[0].pairs.map((x) => x.length).sort()).toEqual([1, 3]);
  });

  it('switching to scramble4 rebuilds future rounds as one team of 4', () => {
    const t = makeTournament({
      players: [p('a'), p('b'), p('c'), p('d')],
      mode: 'stableford',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'scramble4');
    expect(patches[0].pairs).toHaveLength(1);
    expect(patches[0].pairs[0]).toHaveLength(4);
  });

  it('switching to pairsmatchplay rebuilds as two pairs of 2', () => {
    const t = makeTournament({
      players: [p('a'), p('b'), p('c'), p('d')],
      mode: 'individual',
      rounds: [makeRound({ id: 'r0' })],
      currentRound: 0,
    });
    const { patches } = setScoringModeRoundPatches(t, 'pairsmatchplay');
    expect(patches[0].pairs.map((x) => x.length)).toEqual([2, 2]);
  });
});
```

- [ ] **Step 2:** Run → FAIL (pairs come back 2×2 from `randomPairs` for the scramble shapes).
- [ ] **Step 3: Implement.** In `tournamentStore.js`, inside each of the three builders, replace the `randomPairs(roster)`-when-teams expression with `buildTeamsForMode(<modeVar>, roster)` (the mode variable is `newMode`/`nextScoringMode` per builder — read each builder and use its own mode variable; the non-team fallback `roster.map((p) => [p])` is already inside `buildTeamsForMode`, so the whole ternary collapses to one call). Import `buildTeamsForMode` from `./scoring` (it is already the home of `randomPairs`, which stays exported for existing callers).

In the four UI/lib call sites, replace:

```js
scoringModeUsesTeams(mode, players.length)
  ? randomPairs(players)
  : players.map((p) => [p])
```
with:
```js
buildTeamsForMode(mode, players)
```
using each site's local variable names (`SetupScreen` uses `settings.scoringMode`; `NextRoundScreen.buildPairsForRound` uses `t?.settings?.scoringMode`; `EditTournamentScreen` uses `settings?.scoringMode`; `quickStartGame` uses `normalizedSettings.scoringMode`). Update each file's imports (follow how each file currently imports `randomPairs` — direct from `../store/scoring` or via the `tournamentStore` re-export — and swap in place; add a `buildTeamsForMode` re-export to `tournamentStore.js` if that's where they import from).

- [ ] **Step 4:** `npm test` (full suite) → PASS. The reveal flow (`NextRoundScreen`) and quick start need no further changes — they render whatever `round.pairs` holds.
- [ ] **Step 5: Commit** — `feat(modes): route all pair building through buildTeamsForMode`

### Task 9: Scramble engine

**Files:**
- Modify: `src/store/scoring.js`
- Modify: `src/store/tournamentStore.js` (re-export the new functions alongside the existing scoring re-exports)
- Test: `src/store/__tests__/scramble.test.js` (create)

**Interfaces:**
- Consumes: `calcStablefordPoints`, `round.pairs` (teams), `round.playerHandicaps` (frozen at round build), captain = `pair[0]`, scores under captain id.
- Produces:
  - `SCRAMBLE_ALLOWANCES: {1:[1], 2:[.35,.15], 3:[.20,.15,.10], 4:[.25,.20,.15,.10]}`
  - `scrambleTeamHandicap(handicaps: number[]): number`
  - `scrambleTeamHandicaps(round, players): { [captainId]: number }`
  - `scrambleUnits(round, players): Array<{ id, name, handicap, members }>` — synthetic "team players" (id = captain id, name = `'Ann & Bob'` first names joined, handicap = team handicap)
  - `scrambleRoundTally(round, players): { totals: [{unit, points, strokes}...] sorted desc, played, holesLeft, leaderIdx, lead, clinched } | null`

- [ ] **Step 1: Write failing tests** — create `src/store/__tests__/scramble.test.js`:

```js
import {
  scrambleTeamHandicap,
  scrambleTeamHandicaps,
  scrambleUnits,
  scrambleRoundTally,
} from '../scoring';

const P = (id, name, handicap = 0) => ({ id, name, handicap });

describe('scrambleTeamHandicap (USGA Appendix C)', () => {
  it('2-man: 35% low + 15% high, rounded', () => {
    // 35% of 8 + 15% of 20 = 2.8 + 3.0 = 5.8 → 6
    expect(scrambleTeamHandicap([20, 8])).toBe(6);
  });
  it('3-man: 20/15/10 low→high', () => {
    // 20% of 5 + 15% of 10 + 10% of 20 = 1 + 1.5 + 2 = 4.5 → 5 (Math.round)
    expect(scrambleTeamHandicap([10, 20, 5])).toBe(5);
  });
  it('4-man: 25/20/15/10 low→high', () => {
    // 25% of 4 + 20% of 8 + 15% of 12 + 10% of 20 = 1+1.6+1.8+2 = 6.4 → 6
    expect(scrambleTeamHandicap([12, 8, 20, 4])).toBe(6);
  });
  it('solo side plays full handicap', () => {
    expect(scrambleTeamHandicap([13])).toBe(13);
  });
  it('unknown team size → 0', () => {
    expect(scrambleTeamHandicap([])).toBe(0);
    expect(scrambleTeamHandicap([1, 2, 3, 4, 5])).toBe(0);
  });
});

describe('scramble round', () => {
  const players = [P('a', 'Ann Lee', 10), P('b', 'Bob Ray', 20), P('c', 'Cam Fox', 5), P('d', 'Dan Oak', 8)];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  it('scrambleUnits builds synthetic team players keyed by captain', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1]], [players[2], players[3]]],
      playerHandicaps: { a: 10, b: 20, c: 5, d: 8 },
      scores: {},
    };
    const units = scrambleUnits(round, players);
    expect(units.map((u) => u.id)).toEqual(['a', 'c']);
    expect(units[0].name).toBe('Ann & Bob');
    // 35% of 10 + 15% of 20 = 6.5 → 7 ; 35% of 5 + 15% of 8 = 2.95 → 3
    expect(units[0].handicap).toBe(7);
    expect(units[1].handicap).toBe(3);
    expect(units[0].members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('tally: points, lead, clinch when lead exceeds max remaining', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1]], [players[2], players[3]]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      // team a: birdie+birdie (3 pts each) = 6; team c: no scores yet
      scores: { a: { 1: 3, 2: 3 } },
    };
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals[0].unit.id).toBe('a');
    expect(tally.totals[0].points).toBe(6);
    expect(tally.totals[1].points).toBe(0);
    // c can still out-score on both holes → not clinched
    expect(tally.clinched).toBe(false);
  });

  it('single-team round (scramble4 shape) tallies without clinch semantics', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1], players[2], players[3]]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      scores: { a: { 1: 4 } },
    };
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals).toHaveLength(1);
    expect(tally.totals[0].points).toBe(2);
    expect(tally.clinched).toBe(false);
    expect(tally.holesLeft).toBe(1);
  });

  it('3v1: solo side scores under own id with full handicap', () => {
    const round = {
      holes: [holes[0]],
      pairs: [[players[0], players[1], players[2]], [players[3]]],
      playerHandicaps: { a: 10, b: 20, c: 5, d: 8 },
      scores: { a: { 1: 4 }, d: { 1: 4 } },
    };
    const units = scrambleUnits(round, players);
    // 20% of 5 + 15% of 10 + 10% of 20 = 1 + 1.5 + 2 = 4.5 → 5
    expect(units[0].handicap).toBe(5);
    expect(units[1].handicap).toBe(8);
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals.map((t) => t.points).every((p) => p >= 2)).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test -- scramble` → FAIL (nothing exported).
- [ ] **Step 3: Implement** in `scoring.js` (below the sindicato block):

```js
// ── Scramble ────────────────────────────────────────────────────────────────
// One ball per team, scored Stableford off a team handicap. The team score
// lives under the CAPTAIN (first member) in round.scores, so the sync layer
// is untouched. USGA Rules of Handicapping Appendix C allowances, low→high
// course handicap. A solo "team" (3v1's individual) plays 100%.

export const SCRAMBLE_ALLOWANCES = {
  1: [1],
  2: [0.35, 0.15],
  3: [0.20, 0.15, 0.10],
  4: [0.25, 0.20, 0.15, 0.10],
};

export function scrambleTeamHandicap(handicaps) {
  const weights = SCRAMBLE_ALLOWANCES[handicaps?.length];
  if (!weights) return 0;
  const sorted = [...handicaps].sort((a, b) => a - b);
  return Math.round(sorted.reduce((acc, h, i) => acc + h * weights[i], 0));
}

// { [captainId]: teamHandicap } from the round's frozen playerHandicaps.
export function scrambleTeamHandicaps(round, players) {
  const byId = Object.fromEntries((players ?? []).map((p) => [p.id, p]));
  const result = {};
  for (const team of round?.pairs ?? []) {
    const captain = team?.[0];
    if (!captain) continue;
    const handicaps = team.map((m) => (
      round?.playerHandicaps?.[m.id] ?? byId[m.id]?.handicap ?? m.handicap ?? 0
    ));
    result[captain.id] = scrambleTeamHandicap(handicaps);
  }
  return result;
}

// Synthetic "team players" for the scorecard: one entry per team, carrying
// the captain's id (where the team ball's scores live), a joined first-name
// label, and the team handicap. Members kept for chips/labels.
export function scrambleUnits(round, players) {
  const teamHcps = scrambleTeamHandicaps(round, players);
  const byId = Object.fromEntries((players ?? []).map((p) => [p.id, p]));
  return (round?.pairs ?? [])
    .filter((team) => team?.length > 0)
    .map((team) => {
      const members = team.map((m) => byId[m.id] ?? m);
      const captain = members[0];
      return {
        id: captain.id,
        name: members.map((m) => m?.name?.split(' ')[0] ?? '—').join(' & '),
        handicap: teamHcps[captain.id] ?? 0,
        members,
      };
    });
}

// Round tally across teams. Clinch only applies to two-sided games
// (scramblepairs, scramble3v1): leader clinches when the trailing side
// cannot catch up even scoring 1 stroke on every remaining hole.
export function scrambleRoundTally(round, players) {
  const units = scrambleUnits(round, players);
  if (units.length === 0) return null;
  const holes = round?.holes ?? [];
  const scores = round?.scores ?? {};

  const rows = units.map((unit) => {
    let points = 0;
    let strokes = 0;
    let scored = 0;
    for (const hole of holes) {
      const str = scores?.[unit.id]?.[hole.number];
      if (str == null) continue;
      scored++;
      strokes += str;
      points += calcStablefordPoints(hole.par, str, unit.handicap, hole.strokeIndex);
    }
    let maxRemaining = 0;
    for (const hole of holes) {
      if (scores?.[unit.id]?.[hole.number] != null) continue;
      maxRemaining += calcStablefordPoints(hole.par, 1, unit.handicap, hole.strokeIndex);
    }
    return { unit, points, strokes, scored, maxRemaining };
  });

  const totals = [...rows].sort((a, b) => b.points - a.points);
  const played = Math.min(...rows.map((r) => r.scored));
  const holesLeft = holes.length - played;
  let leaderIdx = null;
  let lead = 0;
  let clinched = false;
  if (totals.length >= 2) {
    lead = totals[0].points - totals[1].points;
    leaderIdx = lead > 0 ? 0 : null;
    clinched = leaderIdx === 0 && totals[0].points > totals[1].points + totals[1].maxRemaining;
  }
  return { totals, played, holesLeft, leaderIdx, lead, clinched };
}
```

- [ ] **Step 4:** `npm test -- scramble` → PASS. Re-export the five new symbols from `tournamentStore.js` next to the existing scoring re-exports (find the re-export block at the top where `calcStablefordPoints`/`randomPairs` are re-exported and extend it).
- [ ] **Step 5: Commit** — `feat(modes): scramble scoring engine`

### Task 10: Pairs match play engine

**Files:**
- Modify: `src/store/scoring.js`
- Modify: `src/store/tournamentStore.js` (re-exports)
- Test: `src/store/__tests__/pairsMatchplay.test.js` (create)

**Interfaces:**
- Consumes: `calcExtraShots`, `round.pairs` (two pairs of 2, full player objects), `round.playerHandicaps`.
- Produces:
  - `pairsMatchDuels(pairs): [[p, q], [r, s]] | null` — duel i = `pairs[0][i]` vs `pairs[1][i]`
  - `pairsMatchHolePts(hole, pairs, scores, playerHandicaps): { team1, team2, decidedDuels } | null`
  - `pairsMatchDuelPts(hole, playerId, pairs, scores, playerHandicaps): 1 | 0.5 | 0 | null` — the player's own duel result on a hole (for player-card display)
  - `pairsMatchRoundTally(round, players): { team1, team2, played, holesLeft, lead, leaderIdx, clinched, duels } | null` (`duels`: per-duel `{ aId, bId, aPts, bPts }`)

- [ ] **Step 1: Write failing tests** — create `src/store/__tests__/pairsMatchplay.test.js`:

```js
import {
  pairsMatchDuels,
  pairsMatchHolePts,
  pairsMatchDuelPts,
  pairsMatchRoundTally,
} from '../scoring';

const P = (id, handicap = 0) => ({ id, name: id, handicap });
const pairs = [[P('a'), P('b')], [P('c'), P('d')]]; // duels: a-c, b-d
const hole1 = { number: 1, par: 4, strokeIndex: 1 };

describe('pairsMatchDuels', () => {
  it('index-matches across the two pairs', () => {
    const duels = pairsMatchDuels(pairs);
    expect(duels.map((d) => d.map((p) => p.id))).toEqual([['a', 'c'], ['b', 'd']]);
  });
  it('rejects malformed shapes', () => {
    expect(pairsMatchDuels(null)).toBeNull();
    expect(pairsMatchDuels([[P('a')], [P('c'), P('d')]])).toBeNull();
    expect(pairsMatchDuels([[P('a'), P('b')]])).toBeNull();
  });
});

describe('pairsMatchHolePts', () => {
  it('awards 1 per duel win and ½ each on a halve — 2 points always distributed', () => {
    // a beats c, b halves with d → team1 = 1.5, team2 = 0.5
    const scores = { a: { 1: 4 }, c: { 1: 5 }, b: { 1: 4 }, d: { 1: 4 } };
    const pts = pairsMatchHolePts(hole1, pairs, scores, {});
    expect(pts).toEqual({ team1: 1.5, team2: 0.5, decidedDuels: 2 });
    expect(pts.team1 + pts.team2).toBe(2);
  });

  it('unscored duel contributes nothing yet', () => {
    const scores = { a: { 1: 4 }, c: { 1: 5 } }; // b/d haven't scored
    const pts = pairsMatchHolePts(hole1, pairs, scores, {});
    expect(pts).toEqual({ team1: 1, team2: 0, decidedDuels: 1 });
  });

  it('net scoring via stroke index', () => {
    // gross: a 5, c 4 — but a gets a shot on SI 1 with handicap 18 → net 4 = halve
    const scores = { a: { 1: 5 }, c: { 1: 4 }, b: { 1: 4 }, d: { 1: 5 } };
    const pts = pairsMatchHolePts(hole1, pairs, scores, { a: 18, b: 0, c: 0, d: 0 });
    expect(pts.team1).toBe(1.5); // a halves (0.5) + b wins (1)
    expect(pts.team2).toBe(0.5);
  });
});

describe('pairsMatchDuelPts', () => {
  it('returns the individual duel result for a player', () => {
    const scores = { a: { 1: 4 }, c: { 1: 5 }, b: { 1: 4 }, d: { 1: 4 } };
    expect(pairsMatchDuelPts(hole1, 'a', pairs, scores, {})).toBe(1);
    expect(pairsMatchDuelPts(hole1, 'c', pairs, scores, {})).toBe(0);
    expect(pairsMatchDuelPts(hole1, 'b', pairs, scores, {})).toBe(0.5);
    expect(pairsMatchDuelPts(hole1, 'd', pairs, scores, {})).toBe(0.5);
  });
  it('null while the duel is not fully scored', () => {
    expect(pairsMatchDuelPts(hole1, 'a', pairs, { a: { 1: 4 } }, {})).toBeNull();
  });
});

describe('pairsMatchRoundTally', () => {
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
    { number: 3, par: 4, strokeIndex: 3 },
  ];

  it('accumulates team points and per-duel tallies', () => {
    const round = {
      holes,
      pairs,
      playerHandicaps: {},
      scores: {
        a: { 1: 4, 2: 4 }, c: { 1: 5, 2: 4 }, // a wins h1, halves h2
        b: { 1: 4, 2: 5 }, d: { 1: 4, 2: 4 }, // halve h1, d wins h2
      },
    };
    const t = pairsMatchRoundTally(round, [...pairs[0], ...pairs[1]]);
    expect(t.team1).toBe(2); // 1 + 0.5 + 0.5
    expect(t.team2).toBe(2); // 0.5 + 0.5 + 1
    expect(t.leaderIdx).toBeNull();
    expect(t.clinched).toBe(false);
    expect(t.holesLeft).toBe(1);
    expect(t.duels[0]).toMatchObject({ aId: 'a', bId: 'c', aPts: 1.5, bPts: 0.5 });
  });

  it('clinches when lead exceeds the trailing side’s max remaining points', () => {
    const round = {
      holes,
      pairs,
      playerHandicaps: {},
      scores: {
        a: { 1: 3, 2: 3 }, c: { 1: 5, 2: 5 },
        b: { 1: 3, 2: 3 }, d: { 1: 5, 2: 5 },
      },
    };
    // team1 = 4, team2 = 0, one hole (2 pts) left → 4 > 0 + 2 → clinched
    const t = pairsMatchRoundTally(round, [...pairs[0], ...pairs[1]]);
    expect(t.team1).toBe(4);
    expect(t.clinched).toBe(true);
    expect(t.leaderIdx).toBe(0);
  });

  it('null for malformed pairs', () => {
    expect(pairsMatchRoundTally({ holes, pairs: [[P('a')], [P('c')]] }, [])).toBeNull();
  });
});
```

- [ ] **Step 2:** `npm test -- pairsMatchplay` → FAIL.
- [ ] **Step 3: Implement** in `scoring.js` (below the scramble block):

```js
// ── Pairs Match Play ────────────────────────────────────────────────────────
// Two pairs; each player duels the same-index member of the other pair
// (within-pair order is random via randomPairs, so duel draw is random).
// Every fully-scored hole distributes exactly 2 points: 1 per duel to the
// net winner, ½ each on a halve. Nets use calcExtraShots by stroke index.

export function pairsMatchDuels(pairs) {
  if (!pairs || pairs.length !== 2) return null;
  const [t1, t2] = pairs;
  if (!Array.isArray(t1) || !Array.isArray(t2) || t1.length !== 2 || t2.length !== 2) return null;
  return [[t1[0], t2[0]], [t1[1], t2[1]]];
}

// 1 = first player wins, 2 = second, 0 = halved, null = not fully scored.
function duelNetWinner(hole, a, b, scores, playerHandicaps) {
  const strA = scores?.[a.id]?.[hole.number];
  const strB = scores?.[b.id]?.[hole.number];
  if (strA == null || strB == null) return null;
  const hA = playerHandicaps?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicaps?.[b.id] ?? b.handicap ?? 0;
  const netA = strA - calcExtraShots(hA, hole.strokeIndex);
  const netB = strB - calcExtraShots(hB, hole.strokeIndex);
  if (netA === netB) return 0;
  return netA < netB ? 1 : 2;
}

export function pairsMatchHolePts(hole, pairs, scores, playerHandicaps) {
  const duels = pairsMatchDuels(pairs);
  if (!duels) return null;
  let team1 = 0;
  let team2 = 0;
  let decidedDuels = 0;
  for (const [a, b] of duels) {
    const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
    if (w == null) continue;
    decidedDuels++;
    if (w === 1) team1 += 1;
    else if (w === 2) team2 += 1;
    else { team1 += 0.5; team2 += 0.5; }
  }
  return { team1, team2, decidedDuels };
}

// The player's own duel result on one hole: 1 / 0.5 / 0, or null while the
// duel is not fully scored (mirrors matchPlayHolePts semantics).
export function pairsMatchDuelPts(hole, playerId, pairs, scores, playerHandicaps) {
  const duels = pairsMatchDuels(pairs);
  if (!duels) return null;
  const duel = duels.find(([a, b]) => a.id === playerId || b.id === playerId);
  if (!duel) return null;
  const [a, b] = duel;
  const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
  if (w == null) return null;
  if (w === 0) return 0.5;
  const winnerId = w === 1 ? a.id : b.id;
  return playerId === winnerId ? 1 : 0;
}

export function pairsMatchRoundTally(round, players) {
  const duels = pairsMatchDuels(round?.pairs);
  if (!duels) return null;
  const holes = round?.holes ?? [];
  const scores = round?.scores ?? {};
  const playerHandicaps = round?.playerHandicaps ?? {};

  let team1 = 0;
  let team2 = 0;
  const duelRows = duels.map(([a, b]) => ({ aId: a.id, bId: b.id, aPts: 0, bPts: 0 }));
  let team1Remaining = 0;
  let team2Remaining = 0;
  let fullyPlayed = 0;

  for (const hole of holes) {
    let decided = 0;
    duels.forEach(([a, b], i) => {
      const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
      if (w == null) {
        team1Remaining += 1;
        team2Remaining += 1;
        return;
      }
      decided++;
      if (w === 1) { team1 += 1; duelRows[i].aPts += 1; }
      else if (w === 2) { team2 += 1; duelRows[i].bPts += 1; }
      else {
        team1 += 0.5; team2 += 0.5;
        duelRows[i].aPts += 0.5; duelRows[i].bPts += 0.5;
      }
    });
    if (decided === duels.length) fullyPlayed++;
  }

  const holesLeft = holes.length - fullyPlayed;
  const lead = Math.abs(team1 - team2);
  const leaderIdx = team1 > team2 ? 0 : team2 > team1 ? 1 : null;
  const clinched = leaderIdx !== null && (
    leaderIdx === 0 ? team1 > team2 + team2Remaining : team2 > team1 + team1Remaining
  );
  return { team1, team2, played: fullyPlayed, holesLeft, lead, leaderIdx, clinched, duels: duelRows };
}
```
Note: `players` is unused in `pairsMatchRoundTally` (pairs carry the player objects) — KEEP the parameter anyway for signature symmetry with the other tallies; Tasks 11 and 13 call it with `(round, players)`. Prefix it `_players` only if the linter complains.

- [ ] **Step 4:** `npm test -- pairsMatchplay` → PASS. Re-export the four functions from `tournamentStore.js`.
- [ ] **Step 5: Commit** — `feat(modes): pairs match play engine`

### Task 11: scoreModel integration (scorecard facade)

**Files:**
- Modify: `src/components/scorecard/scoreModel.js`
- Test: `src/components/scorecard/__tests__/scoreModel.test.js`

**Interfaces:**
- Consumes: Task 9 (`scrambleUnits`, `scrambleRoundTally`) and Task 10 (`pairsMatchHolePts`, `pairsMatchDuelPts`, `pairsMatchRoundTally`) via the `tournamentStore` re-exports (scoreModel already imports from `'../../store/tournamentStore'`).
- Produces:
  - `holePoints({ mode, hole, players, scores, handicaps, round })` — NEW optional `round` param; `pairsmatchplay` branch returns each player's duel pts. Scramble modes need no branch (callers pass units as `players` + team handicaps as `handicaps`, hitting the default Stableford branch).
  - `summaryState(...)` branches for the four new modes:
    - `scramblepairs` / `scramble3v1` → `variant: 'pairs'`, eyebrow `'SCRAMBLE'`
    - `scramble4` → `variant: 'solo'`, eyebrow `'TEAM SCRAMBLE'`
    - `pairsmatchplay` → `variant: 'pairs'`, eyebrow `'PAIRS MATCH PLAY'`

- [ ] **Step 1: Write failing tests** — append to `scoreModel.test.js` (mirror its existing fixture style):

```js
describe('pairsmatchplay', () => {
  const pairs = [
    [{ id: 'p1', name: 'Ann Lee', handicap: 0 }, { id: 'p2', name: 'Bob Ray', handicap: 0 }],
    [{ id: 'p3', name: 'Cam Fox', handicap: 0 }, { id: 'p4', name: 'Dan Oak', handicap: 0 }],
  ];
  const round = {
    holes: [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }],
    pairs,
    playerHandicaps: {},
  };
  const scores = { p1: { 1: 4 }, p3: { 1: 5 }, p2: { 1: 4 }, p4: { 1: 4 } };

  it('holePoints returns duel points per player when round is provided', () => {
    const hp = holePoints({
      mode: 'pairsmatchplay', hole: round.holes[0],
      players: pairs.flat(), scores, handicaps: {}, round,
    });
    expect(hp.p1).toBe(1);
    expect(hp.p3).toBe(0);
    expect(hp.p2).toBe(0.5);
    expect(hp.p4).toBe(0.5);
  });

  it('summaryState → pairs variant with 2 pts distributed per hole', () => {
    const s = summaryState({
      mode: 'pairsmatchplay', round, players: pairs.flat(), scores,
      settings: { scoringMode: 'pairsmatchplay' }, currentHole: 1, meId: 'p1',
    });
    expect(s.variant).toBe('pairs');
    expect(s.eyebrow).toBe('PAIRS MATCH PLAY');
    expect(s.pairs[0].roundPts).toBe(1.5);
    expect(s.pairs[1].roundPts).toBe(0.5);
    expect(s.pairs[0].name).toBe('Ann & Bob');
    expect(s.decided).toBe(false);
    expect(s.status).toMatch(/lead/i);
  });
});

describe('scramble', () => {
  const players = [
    { id: 'p1', name: 'Ann Lee', handicap: 0 }, { id: 'p2', name: 'Bob Ray', handicap: 0 },
    { id: 'p3', name: 'Cam Fox', handicap: 0 }, { id: 'p4', name: 'Dan Oak', handicap: 0 },
  ];
  const holes = [{ number: 1, par: 4, strokeIndex: 1 }];

  it('scramblepairs summaryState → pairs variant off captain scores', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1]], [players[2], players[3]]],
      playerHandicaps: {},
    };
    const s = summaryState({
      mode: 'scramblepairs', round, players,
      scores: { p1: { 1: 3 }, p3: { 1: 4 } },
      settings: { scoringMode: 'scramblepairs' }, currentHole: 1, meId: 'p1',
    });
    expect(s.variant).toBe('pairs');
    expect(s.eyebrow).toBe('SCRAMBLE');
    expect(s.pairs[0].roundPts).toBe(3); // birdie
    expect(s.pairs[1].roundPts).toBe(2); // par
  });

  it('scramble4 summaryState → solo variant (team vs course)', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1], players[2], players[3]]],
      playerHandicaps: {},
    };
    const s = summaryState({
      mode: 'scramble4', round, players,
      scores: { p1: { 1: 3 } },
      settings: { scoringMode: 'scramble4' }, currentHole: 1, meId: 'p1',
    });
    expect(s.variant).toBe('solo');
    expect(s.eyebrow).toBe('TEAM SCRAMBLE');
    expect(s.solo.pts).toBe(3);
    expect(s.solo.str).toBe(3);
    expect(s.solo.vsParLabel).toBe('-1');
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

(a) `holePoints` — add `round` to the destructured params and a branch before the matchplay one:

```js
export function holePoints({ mode, hole, players, scores, handicaps, round }) {
  const result = {};
  for (const p of players) {
    const str = scores?.[p.id]?.[hole.number];
    if (mode === 'pairsmatchplay') {
      // Duel result is defined by the duel being fully scored, not by p
      // having scored — mirror matchPlayHolePts null semantics.
      result[p.id] = pairsMatchDuelPts(hole, p.id, round?.pairs, scores, handicaps);
      continue;
    }
    if (str == null) { result[p.id] = null; continue; }
    ...
```
(keep the existing matchplay/sindicato/default branches unchanged; import `pairsMatchDuelPts`, `scrambleUnits`, `scrambleRoundTally`, `pairsMatchHolePts`, `pairsMatchRoundTally` from `'../../store/tournamentStore'`.)

(b) `roundTotals` — pass `round` through to `holePoints` in its inner call (`holePoints({ mode, hole, players, scores, handicaps: hcaps, round })`).

(c) `summaryState` — the solo early-return stays first. Insert the scramble blocks right after it (before the matchplay block), since scramble rounds have 4 players but ≤2 scoring units:

```js
  // --- scramble (team ball under the captain) -----------------------------
  if (mode === 'scramblepairs' || mode === 'scramble3v1' || mode === 'scramble4') {
    const tally = scrambleRoundTally({ ...round, scores }, playerList);
    if (tally) {
      const units = scrambleUnits({ ...round, scores }, playerList);
      if (mode === 'scramble4' || units.length === 1) {
        const row = tally.totals[0];
        const parPlayed = (round?.holes ?? []).reduce((acc, h) => (
          scores?.[row.unit.id]?.[h.number] != null ? acc + h.par : acc
        ), 0);
        const decided = tally.holesLeft === 0;
        return {
          variant: 'solo',
          eyebrow: 'TEAM SCRAMBLE',
          solo: { str: row.strokes, pts: row.points, vsParLabel: vsParLabel(row.strokes, parPlayed) },
          status: decided ? `${row.unit.name} finished on ${row.points} pts` : null,
          decided,
        };
      }
      // Two-sided scramble (pairs, 3v1) — reuse the pairs summary shape.
      const curScrambleHole = (round?.holes ?? []).find((h) => h.number === currentHole);
      const holeData = curScrambleHole
        ? holePoints({
          mode: 'stableford',
          hole: curScrambleHole,
          players: units,
          scores,
          handicaps: Object.fromEntries(units.map((u) => [u.id, u.handicap])),
        })
        : {};
      const rowsByCaptain = Object.fromEntries(tally.totals.map((r) => [r.unit.id, r]));
      const decided = tally.clinched
        || (tally.holesLeft === 0 && tally.totals[0].points !== tally.totals[1].points);
      const leaderRow = tally.leaderIdx != null ? tally.totals[tally.leaderIdx] : null;
      let status;
      if (tally.clinched && leaderRow) {
        status = `${leaderRow.unit.name} have won the round`;
      } else if (leaderRow) {
        status = `${leaderRow.unit.name} lead by ${tally.lead} · ${tally.holesLeft} to play`;
      } else {
        status = `All square · ${tally.holesLeft} to play`;
      }
      return {
        variant: 'pairs',
        eyebrow: 'SCRAMBLE',
        pairs: units.map((u, index) => ({
          index,
          name: u.name,
          holePts: holeData[u.id] ?? null,
          roundPts: rowsByCaptain[u.id]?.points ?? 0,
          isWinner: decided && leaderRow?.unit.id === u.id,
        })),
        status,
        decided,
      };
    }
  }

  // --- pairs match play (two 1v1 duels, 2 pts per hole) --------------------
  if (mode === 'pairsmatchplay') {
    const liveR = { ...round, scores };
    const tally = pairsMatchRoundTally(liveR, playerList);
    if (tally) {
      const curHole = (round?.holes ?? []).find((h) => h.number === currentHole);
      const holePts = curHole
        ? pairsMatchHolePts(curHole, round?.pairs, scores, round?.playerHandicaps ?? {})
        : null;
      const names = (round?.pairs ?? []).map((pair) => pairLabel(pair));
      const decided = tally.clinched
        || (tally.holesLeft === 0 && tally.team1 !== tally.team2);
      const winnerIdx = tally.team1 > tally.team2 ? 0 : tally.team2 > tally.team1 ? 1 : null;
      let status;
      if (decided && winnerIdx != null) {
        status = `${names[winnerIdx]} have won the match`;
      } else if (tally.leaderIdx != null) {
        status = `${names[tally.leaderIdx]} lead by ${tally.lead} · ${tally.holesLeft} to play`;
      } else {
        status = `All square · ${tally.holesLeft} to play`;
      }
      return {
        variant: 'pairs',
        eyebrow: 'PAIRS MATCH PLAY',
        pairs: [tally.team1, tally.team2].map((pts, index) => ({
          index,
          name: names[index],
          holePts: holePts ? (index === 0 ? holePts.team1 : holePts.team2) : null,
          roundPts: pts,
          isWinner: decided && winnerIdx === index,
        })),
        status,
        decided,
      };
    }
  }
```
(`pairLabel`/`vsParLabel` already exist in this file at `:65`/`:85`.)

- [ ] **Step 4:** `npm test -- scoreModel` → PASS; then `npm test` full → PASS (existing modes untouched).
- [ ] **Step 5: Commit** — `feat(modes): scorecard score model for scramble and pairs match play`

### Task 12: Scorecard UI — team rows for scramble

**Files:**
- Modify: `src/components/scorecard/HolePage.js` (players list `:93-99`, cards loop `:134-195`)
- Modify: `src/components/scorecard/HoleView.js` (`:128`, `:237-239` mode normalization)
- Modify: `src/components/scorecard/GridView.js` (`:365-368` mode normalization, `:331-335` header label, row source)
- Test: existing `scoreModel` tests cover the math; add component tests only if the changes extract new pure helpers.

**Interfaces:**
- Consumes: `scrambleUnits(round, players)` (Task 9), `isScrambleMode` (Task 6).
- Produces: scramble rounds render **one score row per team** (captain id) across grid and hole views; other modes render exactly as before.

**The pattern:** everywhere the scorecard derives its player list, swap in scramble units when the mode is a scramble. Units are player-shaped (`{id, name, handicap}`), so `PlayerCard`, score entry (`score.set` with `playerId = captain.id`), `holePoints`, and `roundTotals` all work unchanged.

- [ ] **Step 1: HolePage.js** — where `orderedPlayers` is built (`:93`):

```js
  const scoringPlayers = isScrambleMode(scoringMode)
    ? scrambleUnits(round, players)
    : players;
  const effectiveMeId = isScrambleMode(scoringMode)
    ? (scoringPlayers.find((u) => u.members?.some((m) => m.id === meId))?.id ?? meId)
    : meId;
  const orderedPlayers = playersMeFirst(scoringPlayers, effectiveMeId);
```
`scoringMode` here must be the raw `settings?.scoringMode` — check what HolePage actually receives (it currently gets the normalized `mode` from HoleView; if the raw key isn't passed, extend the props in Step 2 to pass it, or make the HoleView normalization pass scramble keys through unchanged). Pass `round` to the `holePoints` call (`:98`) as enabled in Task 11, and for scramble pass team handicaps: `handicaps: isScramble ? Object.fromEntries(scoringPlayers.map((u) => [u.id, u.handicap])) : handicaps`.

- [ ] **Step 2: HoleView.js** — extend the normalization ternary (`:237-239`) so the new keys pass through raw (scramble keys and `pairsmatchplay` must reach HolePage/summaryState unnormalized); same for the `roundTotals` call at `:128` — for scramble, compute totals over units with team handicaps (same substitution as Step 1). `RoundSummary` (`:257-266`) already receives the raw `settings?.scoringMode` — no change.

- [ ] **Step 3: GridView.js** — extend the mode ternary (`:365-368`):

```js
  const rawMode = settings?.scoringMode;
  const mode = rawMode === 'matchplay' ? 'matchplay'
    : rawMode === 'sindicato' ? 'sindicato'
    : rawMode === 'pairsmatchplay' ? 'pairsmatchplay'
    : isScrambleMode(rawMode) ? rawMode
    : isBestBall ? 'bestball'
    : 'stableford';
```
Swap the row-source player list to scramble units (same substitution as Step 1 — find where GridView maps players to rows) and add header labels (`:331-335`): `pairsmatchplay → 'PAIRS MATCH PLAY'`, scramble keys → `'SCRAMBLE'`. The bestball-only `LiveMatchStrip` (`:398`) stays bestball-only.

- [ ] **Step 4: Verification** — `npm test` full suite → PASS. Then `npm run web`: quick-start a 4-player game in each new mode and check: scramble shows 2 / 2 / 1 score rows (pairs / 3v1 / 4-man), entering a score on a team row persists, pairs match play shows 4 player rows with duel points and the 2-pt summary panel.
- [ ] **Step 5: Commit** — `feat(modes): scorecard renders scramble team rows`

### Task 13: Leaderboards (HomeScreen)

**Files:**
- Modify: `src/store/scoring.js` (two tournament-level leaderboard helpers)
- Modify: `src/store/tournamentStore.js` (re-exports)
- Modify: `src/screens/HomeScreen.js` (`leaderboard` useMemo `:830-839`, `getSelectedRoundValue` `:1399-1413`, row unit labels `:1485-1524`)
- Test: `src/store/__tests__/scramble.test.js`, `src/store/__tests__/pairsMatchplay.test.js` (extend)

**Interfaces:**
- Consumes: `scrambleRoundTally`, `pairsMatchRoundTally` (Tasks 9–10).
- Produces:
  - `tournamentScrambleLeaderboard(tournament): [{ player: {id, name}, totalPoints, totalStrokes }]` — one row per team (synthetic player = unit), summed across rounds, sorted by points desc.
  - `tournamentPairsMatchStandings(tournament): { board: [...] }` — team match points across rounds. **Read `tournamentMatchPlayStandings` (`scoring.js:397-437`) and HomeScreen's row renderer (`:1485-1524`) FIRST and mirror the exact board-row field names they use** so the renderer works unchanged.

- [ ] **Step 1: Write failing tests** — extend the two engine test files with a 2-round tournament fixture each, asserting summed team points and row shape:

```js
// scramble.test.js
it('tournamentScrambleLeaderboard sums team points across rounds', () => {
  const mk = (scores) => ({
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[P('a', 'Ann Lee'), P('b', 'Bob Ray')], [P('c', 'Cam Fox'), P('d', 'Dan Oak')]],
    playerHandicaps: {}, scores,
  });
  const t = {
    players: [P('a', 'Ann Lee'), P('b', 'Bob Ray'), P('c', 'Cam Fox'), P('d', 'Dan Oak')],
    settings: { scoringMode: 'scramblepairs' },
    rounds: [mk({ a: { 1: 3 }, c: { 1: 4 } }), mk({ a: { 1: 4 }, c: { 1: 3 } })],
  };
  const board = tournamentScrambleLeaderboard(t);
  expect(board).toHaveLength(2);
  expect(board[0].totalPoints).toBe(5);
  expect(board[0].player.name).toBe('Ann & Bob');
});
```
Mirror an equivalent test for `tournamentPairsMatchStandings` (e.g. team1 sweeps round 1 → `board[0].totalPoints` reflects 2 points per swept hole).

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** in `scoring.js`:

```js
// One leaderboard row per scramble team, summed across all rounds. The
// synthetic `player` carries the captain id + team label so the existing
// leaderboard row renderer works untouched.
export function tournamentScrambleLeaderboard(tournament) {
  const players = tournament?.players ?? [];
  const acc = new Map(); // captainId -> { player, totalPoints, totalStrokes }
  for (const round of tournament?.rounds ?? []) {
    const tally = scrambleRoundTally(round, players);
    if (!tally) continue;
    for (const row of tally.totals) {
      const cur = acc.get(row.unit.id) ?? {
        player: { id: row.unit.id, name: row.unit.name },
        totalPoints: 0,
        totalStrokes: 0,
      };
      cur.totalPoints += row.points;
      cur.totalStrokes += row.strokes;
      acc.set(row.unit.id, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.totalPoints - a.totalPoints);
}

// Team standings for pairs match play, one row per team. Mirrors the board
// row shape of tournamentMatchPlayStandings (verify field names before use).
export function tournamentPairsMatchStandings(tournament) {
  const players = tournament?.players ?? [];
  const acc = new Map();
  for (const round of tournament?.rounds ?? []) {
    const tally = pairsMatchRoundTally(round, players);
    if (!tally) continue;
    (round.pairs ?? []).forEach((pair, idx) => {
      const captain = pair?.[0];
      if (!captain) return;
      const name = pair.map((m) => m?.name?.split(' ')[0] ?? '—').join(' & ');
      const cur = acc.get(captain.id)
        ?? { player: { id: captain.id, name }, totalPoints: 0 };
      cur.totalPoints += idx === 0 ? tally.team1 : tally.team2;
      acc.set(captain.id, cur);
    });
  }
  const board = [...acc.values()].sort((a, b) => b.totalPoints - a.totalPoints);
  return { board };
}
```
Adjust field names to match the HomeScreen renderer as discovered in Step 3's required reading. Re-export both from `tournamentStore.js`.

- [ ] **Step 4: Wire HomeScreen.** In the `leaderboard` useMemo (`:830-839`) add before the default:

```js
      if (settings.scoringMode === 'pairsmatchplay') return tournamentPairsMatchStandings(tournament)?.board ?? [];
      if (isScrambleMode(settings.scoringMode)) return tournamentScrambleLeaderboard(tournament);
```
In `getSelectedRoundValue` (`:1399-1413`) add matching branches: `pairsmatchplay` → the team's points for that round from `pairsMatchRoundTally`; scramble → the team's round points from `scrambleRoundTally`. In the row unit labels (`:1490-1492`, `:1516-1518`) render 'pts' for `pairsmatchplay` (points, not holes). Import `isScrambleMode` + the two helpers.

- [ ] **Step 5:** `npm test` → PASS. `npm run lint` → clean.
- [ ] **Step 6: Commit** — `feat(modes): team leaderboards for scramble and pairs match play`

### Task 14: Personal stats exclusion + StatsScreen gating

**Files:**
- Modify: `src/store/personalStats.js` (`collectMyRounds:169-207`)
- Modify: `src/screens/StatsScreen.js` (`usesTeams` gating `:134-136`)
- Test: find the existing personalStats test file; if none exists, create `src/store/__tests__/personalStats.collectMyRounds.test.js`

**Interfaces:**
- Consumes: `isScrambleMode` (Task 6).
- Produces: scramble tournaments contribute zero rounds to personal stats; StatsScreen's pair-stat tabs don't render for scramble modes.

- [ ] **Step 1: Write failing test** (adapt the fixture to `resolveMyPlayer`'s matching logic — read `personalStats.js:148-160` first):

```js
import { collectMyRounds } from '../personalStats';

it('excludes scramble tournaments from personal stats', () => {
  const me = { id: 'p1', name: 'Ann Lee', user_id: 'u1' };
  const mkT = (scoringMode) => ({
    id: `t-${scoringMode}`,
    kind: 'game',
    players: [me],
    settings: { scoringMode },
    rounds: [{
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { p1: { 1: 4 } },
      playerHandicaps: {},
    }],
  });
  const rounds = collectMyRounds(
    [mkT('scramblepairs'), mkT('scramble4'), mkT('individual')], 'u1', 'Ann Lee',
  );
  expect(rounds).toHaveLength(1);
  expect(rounds[0].tournamentId).toBe('t-individual');
});
```

- [ ] **Step 2:** Run → FAIL (3 rounds returned).
- [ ] **Step 3: Implement** — in `collectMyRounds`, at the top of the per-tournament callback (before or right after `resolveMyPlayer`):

```js
    // Scramble rounds carry a team ball under the captain, not an individual
    // score — they must not feed personal stats.
    if (isScrambleMode(t.settings?.scoringMode)) return;
```
Import `isScrambleMode` from `'../components/scoringModes'`.

- [ ] **Step 4: StatsScreen gating** — at `:134`:

```js
  const usesTeams = !isSolo && scoringModeUsesTeams(scoringMode, players.length)
    && !isScrambleMode(scoringMode);
```
(Pair/H2H stat tabs assume per-player scores; scramble rounds only have captain scores. Pairs Match Play keeps them.) Import `isScrambleMode`.

- [ ] **Step 5:** `npm test` → PASS. Commit — `feat(modes): exclude scramble from personal and pair stats`

### Task 15: Full verification + wrap-up

- [ ] **Step 1:** `npm test` (full, expect all suites passing) and `npm run lint` → both clean.
- [ ] **Step 2:** Invoke the `verify` skill: drive the app end-to-end (`npm run web`) — quick-start a 4-player game in each of the four new modes; check mode picker gating (modes disabled at 3 players), team reveal, score entry per team/duel, summary panel status lines, leaderboard rendering, and that a scramble game does not appear in My Stats.
- [ ] **Step 3:** Update `CLAUDE.md` Domain Concepts with one line each: scramble modes (team ball under captain, USGA allowances) and pairs match play (two duels, 2 pts/hole).
- [ ] **Step 4:** Final commit + concise work summary (per user's standing preference).

---

## ADDENDUM (added during execution, user-approved)

### Design change to Task 13 (user decision 2026-07-08)

Teams re-shuffle each round, so the plan's captain-keyed cross-round leaderboard
aggregation was wrong for multi-round tournaments. Both boards now aggregate
PER REAL PLAYER (each player accrues their team's points per round), following
the `tournamentBestWorstLeaderboard` precedent. Scramble rows carry team
strokes per player for the "str" sub-label; pairsmatchplay keeps individual
strokes (own ball).

### Task 16: Fixed teams option ("same teams every round")

**Goal:** optional setting so team modes keep the SAME teams for the whole
tournament instead of re-randomizing each round.

**Files:**
- Modify: `src/components/scoringModes.js` (`mergeScoringSettings` — persist `fixedTeams`)
- Modify: `src/lib/quickStartGame.js` (`normalizeQuickStartSettings` — coerce `fixedTeams` boolean)
- Modify: `src/components/ScoringModePicker.js` ("Same teams every round" switch, visible when the selected mode is a team mode for the current player count)
- Modify: `src/screens/SetupScreen.js` (`handleStart`: when `settings.fixedTeams`, build teams ONCE and reuse for every round)
- Modify: `src/screens/EditTournamentScreen.js` (`addRound`: when fixed, copy pairs from the latest round whose pairs are valid for the current roster; else build fresh)
- Modify: `src/screens/NextRoundScreen.js` (`buildPairsForRound`: when fixed and a prior round has pairs valid for the roster, reuse them; `canReshuffle = usesTeams && !fixedTeams`)
- Modify: `src/store/tournamentStore.js` (`addPlayerRoundPatches`, `removePlayerRoundPatches`, `setScoringModeRoundPatches`: when fixed, compute the new team shape once per mutation and apply the same pairs to every future round)
- Test: `src/store/__tests__/setScoringModeRoundPatches.test.js` (+ siblings): with `fixedTeams: true`, all future-round patches carry IDENTICAL pairs; without it, behavior unchanged. `src/components/__tests__/scoringModes.test.js`: `mergeScoringSettings` persists `fixedTeams`.

**Rules:**
- `fixedTeams` defaults to false (existing behavior). DEFAULT_SETTINGS in
  tournamentStore gains `fixedTeams: false`.
- Reshuffle is disabled in the reveal screen when fixed (teams were locked at
  creation). Roster changes (add/remove player) still rebuild teams — once —
  and apply the same shape to all future rounds.
- Solo modes ignore the flag entirely.

### Task 17 + 18: Manual team selection (user-approved 2026-07-08)

`settings.manualTeams` (default false, persisted like `fixedTeams`): scoring
step offers "Teams: Random draw / Choose myself" for team modes except
`scramble4`. When manual, creation still builds a random valid shape, then
routes into the team editor before the scorecard; tournament round-1 reveal
offers "Set teams" instead of reshuffle; later rounds follow `fixedTeams`.

Editor (EditTeamsScreen) extensions:
- `scramble3v1`: "who plays solo" picker (tap a player; rest form the team)
- `pairsmatchplay`: pairs slot-swap + a duels row ("A vs C · B vs D") with a
  swap toggle that reorders the second pair (duels stay index-derived —
  no data-model change)
- other 2×2 team modes: existing slot-swap UI unchanged

Task 17 = editor extensions (+ pure helper tests).
Task 18 = setting, picker UI, merge/normalize/DEFAULT_SETTINGS plumbing,
post-start routing (Setup, quick start, NextRoundScreen), tests.
