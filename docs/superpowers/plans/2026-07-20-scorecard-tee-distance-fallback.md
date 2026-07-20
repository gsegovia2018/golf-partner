# Scorecard Tee-Distance Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a usable GPS fix isn't in play (player >1 km from the hole, permission denied, or no fix), the scorecard header shows the hole's distances measured from the tee instead of GPS-based numbers.

**Architecture:** A pure helper `resolveScorecardDistances` in `src/lib/flyoverModel.js` reuses the existing `anchorFor` 1 km rule to pick GPS vs tee as the measuring position and computes distances via `courseTargetDistances`. `useGpsDistances` calls it and returns a new `source: 'gps' | 'tee'` field; `HoleDistanceBlock` renders a **FROM TEE** variant when `source === 'tee'`.

**Tech Stack:** React Native (Expo SDK 54), Jest (jest-expo), @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-20-scorecard-tee-distance-fallback-design.md`

## Global Constraints

- The GPS-vs-tee threshold is `ANCHOR_MAX_GPS_METERS` (1000 m) via `anchorFor` — never a second constant.
- `source: 'tee'` is returned ONLY when tee-based distances were actually produced; every other case is `source: 'gps'` with today's behavior.
- Courses without geometry still render nothing in the header.
- Domain logic stays in `src/lib` / hooks; `HoleDistanceBlock` only branches on props.
- Coordinates are `[lat, lng]` arrays (project-wide convention).
- Run tests with `npx jest <path> --silent`; lint with `npm run lint`.
- Full-suite runs: failures whose paths contain `.claude/worktrees` or `.worktrees` are stale nested-worktree copies, not your changes — ignore those suites.

---

### Task 1: `resolveScorecardDistances` helper in flyoverModel

**Files:**
- Modify: `src/lib/flyoverModel.js`
- Test: `src/lib/__tests__/flyoverModel.test.js`

**Interfaces:**
- Consumes: `anchorFor` (same file); `holeFeatures(courseName, holeNumber)`, `courseTargetDistances(pos, courseName, holeNumber)`, `setCourseGeometry(courses)` from `src/lib/geo.js`.
- Produces: `resolveScorecardDistances({ courseName, holeNumber, fix })` → `{ distances, source }` where `fix` is `[lat, lng] | null`, `source` is `'gps' | 'tee'`, and `distances` is the `courseTargetDistances` shape (`{ front, center, back, pin, kind, hazards }`) or `null`. Tasks 2 and 3 rely on exactly this shape.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/flyoverModel.test.js`, extend the imports:

```js
import { anchorFor, ANCHOR_MAX_GPS_METERS, resolveScorecardDistances } from '../flyoverModel';
import { setCourseGeometry } from '../geo';
```

Append the new describe block at the end of the file. It reuses the file's existing `GREEN`, `at`, and `TEE` constants (`TEE = at(400)`, i.e. 400 m north of the green center):

```js
describe('resolveScorecardDistances', () => {
  // Small square bunker around a point 150 m north of the green — on the
  // tee→green line, so the hazard filter keeps it when measured from the tee.
  const bunkerPoly = [at(145), at(155), [at(150)[0], GREEN[1] + 0.0001], [at(150)[0], GREEN[1] - 0.0001]];
  const COURSE = {
    key: 'testville',
    name: 'Testville Golf',
    matchTokens: [['testville']],
    mode: 'holes',
    holes: [
      { number: 1, start: TEE, greenCenter: GREEN, hazards: [{ kind: 'bunker', poly: bunkerPoly }] },
      { number: 2, greenCenter: GREEN }, // no tee mapped
    ],
  };
  const GREENS_COURSE = {
    key: 'greensville',
    name: 'Greensville Golf',
    matchTokens: [['greensville']],
    mode: 'greens',
    greens: [GREEN],
  };

  beforeEach(() => setCourseGeometry([COURSE, GREENS_COURSE]));
  afterEach(() => setCourseGeometry([]));

  it('uses the GPS fix while within 1 km of the green', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: at(250) });
    expect(r.source).toBe('gps');
    expect(r.distances.center).toBeCloseTo(250, 0);
  });

  it('measures from the tee beyond 1 km', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: at(1500) });
    expect(r.source).toBe('tee');
    expect(r.distances.center).toBeCloseTo(400, 0);
  });

  it('measures from the tee with no fix at all', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: null });
    expect(r.source).toBe('tee');
    expect(r.distances.center).toBeCloseTo(400, 0);
  });

  it('tee distances include hazards ahead of the tee', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: null });
    expect(r.distances.hazards).toHaveLength(1);
    expect(r.distances.hazards[0].kind).toBe('bunker');
    expect(r.distances.hazards[0].reach).toBeGreaterThan(200);
    expect(r.distances.hazards[0].reach).toBeLessThan(300);
  });

  it('keeps GPS behavior when the hole has no tee mapped', () => {
    const far = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 2, fix: at(1500) });
    expect(far.source).toBe('gps');
    expect(far.distances.center).toBeCloseTo(1500, 0);
    const none = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 2, fix: null });
    expect(none).toEqual({ distances: null, source: 'gps' });
  });

  it('keeps GPS behavior on greens-mode courses (no per-hole tees)', () => {
    const r = resolveScorecardDistances({ courseName: 'Greensville Golf', holeNumber: 1, fix: at(1500) });
    expect(r.source).toBe('gps');
    expect(r.distances.kind).toBe('nearest');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/__tests__/flyoverModel.test.js --silent`
Expected: FAIL — `resolveScorecardDistances` is not exported (TypeError: not a function).

- [ ] **Step 3: Implement the helper**

In `src/lib/flyoverModel.js`, replace the import line:

```js
import { haversineMeters, holeFeatures, courseTargetDistances } from './geo';
```

Append the function at the end of the file:

```js
// Distances for the scorecard header. Live GPS wins while the player is on
// the hole (anchorFor's 1 km rule); otherwise the tee, when the hole has one
// and it yields distances. `source` is 'tee' only in that case — every other
// path (no tee, greens-mode course, no geometry match) keeps the plain GPS
// behavior, including null distances before the first fix.
export function resolveScorecardDistances({ courseName, holeNumber, fix }) {
  const feat = holeFeatures(courseName, holeNumber);
  const r = anchorFor({
    player: fix,
    tee: feat?.start ?? null,
    greenCenter: feat?.greenCenter ?? null,
  });
  if (r.source === 'tee') {
    const d = courseTargetDistances(r.anchor, courseName, holeNumber);
    if (d) return { distances: d, source: 'tee' };
  }
  return {
    distances: fix ? courseTargetDistances(fix, courseName, holeNumber) : null,
    source: 'gps',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/__tests__/flyoverModel.test.js --silent`
Expected: PASS (all existing `anchorFor` tests plus the 6 new ones).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/lib/flyoverModel.js src/lib/__tests__/flyoverModel.test.js
git commit -m "feat(scorecard): resolveScorecardDistances picks gps vs tee measuring point"
```

---

### Task 2: `useGpsDistances` returns `source` and tee fallback

**Files:**
- Modify: `src/hooks/useGpsDistances.js`

**Interfaces:**
- Consumes: `resolveScorecardDistances({ courseName, holeNumber, fix })` → `{ distances, source }` from Task 1.
- Produces: hook return shape `{ available, distances, accuracy, position, source }`. `available` is now true whenever the course has geometry, EXCEPT when location permission was denied AND no tee fallback exists (`denied && source !== 'tee'`) — so denied users aren't stuck on a "Getting GPS fix" spinner. `position` stays the raw GPS fix or null. Task 3 branches on `source`.

- [ ] **Step 1: Rewire the hook**

In `src/hooks/useGpsDistances.js`:

Add the import:

```js
import { resolveScorecardDistances } from '../lib/flyoverModel';
```

Replace the `distances` memo (currently lines 79-82):

```js
  const resolved = useMemo(() => {
    if (!geometry) return { distances: null, source: 'gps' };
    return resolveScorecardDistances({ courseName, holeNumber, fix: fix?.pos ?? null });
  }, [geometry, fix, courseName, holeNumber]);
```

Replace the return statement:

```js
  return {
    // Denied + no tee fallback would leave the header stuck on the fix
    // spinner — hide it, exactly like the pre-tee-fallback behavior.
    available: !!geometry && (!denied || resolved.source === 'tee'),
    distances: resolved.distances,
    source: resolved.source, // 'gps' | 'tee' — the header renders FROM TEE for 'tee'
    accuracy: fix?.accuracy ?? null,
    position: fix?.pos ?? null, // [lat, lng] — shared with the hole map
  };
```

Update the hook's header comment (currently lines 8-13) to:

```js
// Live GPS distances to the current hole's green, falling back to distances
// measured from the tee whenever a usable fix isn't in play (player >1 km
// from the hole, permission denied, or no fix yet) — same anchorFor rule as
// the flyover map. Returns { available, distances, accuracy, position,
// source } where `distances` is { front, center, back, pin, kind, hazards }
// in meters or null, and `source` is 'gps' | 'tee'. `available` is false
// when there is no geometry, or when location was denied and the hole has no
// tee to fall back to — callers render nothing in that case.
```

- [ ] **Step 2: Run the surrounding suites**

Run: `npx jest src/lib/__tests__/flyoverModel.test.js src/components/scorecard/__tests__/HoleDistanceBlock.test.js src/components/scorecard/__tests__/HolePage.test.js --silent`
Expected: PASS — the hook's consumers pass the `gps` object through as props, and the added `source` field is additive.

- [ ] **Step 3: Lint and commit**

```bash
npm run lint
git add src/hooks/useGpsDistances.js
git commit -m "feat(scorecard): useGpsDistances falls back to tee distances via anchorFor"
```

---

### Task 3: FROM TEE render state in `HoleDistanceBlock`

**Files:**
- Modify: `src/components/scorecard/HoleDistanceBlock.js`
- Test: `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`

**Interfaces:**
- Consumes: `gps` prop shape from Task 2 — `{ available, distances, accuracy, position, source }`.
- Produces: UI only. `source === 'tee'` renders overline `FROM TEE`, hero center distance, F/B line, hazard line; no navigation icon, no ±accuracy caption, no off-course text, no "Getting GPS fix" spinner. All other sources render exactly today's states.

- [ ] **Step 1: Write the failing tests**

In `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`, update the `gpsBase` helper to include the new field so the GPS-state tests exercise the real shape — add `source: 'gps',` after `accuracy: 8,`:

```js
const gpsBase = (over = {}, dist = {}) => ({
  available: true,
  accuracy: 8,
  source: 'gps',
  position: [38.5577, -0.1491],
  distances: {
    front: 312.4, center: 326.2, back: 339.1, pin: null, kind: 'hole',
    hazards: [],
    ...dist,
  },
  ...over,
});
```

Append inside the `describe('HoleDistanceBlock', ...)` block (note `gpsBase` spreads `over` last, so `source: 'tee'` goes in the first argument):

```js
  it('renders a FROM TEE block when the source is the tee', () => {
    const gps = gpsBase({ source: 'tee', accuracy: null, position: null });
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('FROM TEE');
    getByText('326');
    getByText(/F 312\s+B 339/);
    expect(queryByText(/±/)).toBeNull();
    expect(queryByText('Getting GPS fix')).toBeNull();
  });

  it('FROM TEE shows hazards but never the off-course line', () => {
    const gps = gpsBase(
      { source: 'tee', accuracy: null, position: null },
      { center: 4620, hazards: [{ kind: 'water', reach: 180.2, carry: 210.6 }] },
    );
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Water 180–211');
    getByText('4620');
    expect(queryByText(/Off course/)).toBeNull();
  });

  it('FROM TEE block is still the map entry point', () => {
    const onPress = jest.fn();
    const gps = gpsBase({ source: 'tee', accuracy: null, position: null });
    const { getByLabelText } = render(<HoleDistanceBlock gps={gps} onPress={onPress} />);
    fireEvent.press(getByLabelText('Open hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/scorecard/__tests__/HoleDistanceBlock.test.js --silent`
Expected: FAIL — `FROM TEE` text not found (3 new tests fail; the second also finds "Off course · 4.6 km").

- [ ] **Step 3: Implement the FROM TEE branch**

In `src/components/scorecard/HoleDistanceBlock.js`, the component becomes (styles unchanged — `overline`, `hero`, `unit`, `fb`, `hzd` all exist):

```jsx
// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to.
export function HoleDistanceBlock({ gps, onPress }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!gps?.available) return null;

  const { distances, accuracy, source } = gps;
  // Same thresholds as the old strip: >3km = not on the course; >25m = the
  // fix is too loose to trust to the meter.
  const offCourse = source !== 'tee' && distances && distances.center > 3000;
  const poorFix = accuracy != null && accuracy > 25;
  // One entry per hazard kind — the nearest ahead is the one in play.
  const bunker = distances?.hazards?.find((h) => h.kind === 'bunker');
  const water = distances?.hazards?.find((h) => h.kind === 'water');
  const hazardLine = [
    bunker && `Bunker ${fmt(bunker.reach)}–${fmt(bunker.carry)}`,
    water && `Water ${fmt(water.reach)}–${fmt(water.carry)}`,
  ].filter(Boolean).join(' · ');

  if (source === 'tee' && distances) {
    return (
      <Pressable onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
        <Text style={s.overline}>FROM TEE</Text>
        <View style={s.heroRow}>
          <Text style={s.hero}>{fmt(distances.center)}</Text>
          <Text style={s.unit}>m</Text>
          <Feather name="chevron-right" size={14} color={theme.text.muted} />
        </View>
        <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
        {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
      {distances?.kind === 'nearest' && <Text style={s.overline}>NEAREST GREEN</Text>}
      {offCourse ? (
        <Text style={s.off}>{`Off course · ${(distances.center / 1000).toFixed(1)} km`}</Text>
      ) : distances ? (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>{fmt(distances.center)}</Text>
            <Text style={s.unit}>m</Text>
            <Feather name="chevron-right" size={14} color={theme.text.muted} />
          </View>
          <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
          {poorFix && <Text style={s.caption}>{`±${Math.round(accuracy)}m`}</Text>}
          {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
        </>
      ) : (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>…</Text>
          </View>
          <Text style={s.caption}>Getting GPS fix</Text>
        </>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/scorecard/__tests__/HoleDistanceBlock.test.js --silent`
Expected: PASS (9 existing + 3 new).

- [ ] **Step 5: Full suite, lint, commit**

```bash
npx jest --silent
npm run lint
git add src/components/scorecard/HoleDistanceBlock.js src/components/scorecard/__tests__/HoleDistanceBlock.test.js
git commit -m "feat(scorecard): FROM TEE header distances when off the hole"
```
