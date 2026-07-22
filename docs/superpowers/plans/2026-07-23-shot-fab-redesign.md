# Shot UI redesign (club FAB + tappable pins) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width shot bar on the hole map with a single small club-icon FAB (bottom-right) and make logged shot pins tappable to open the club wheel for re-club / move / delete.

**Architecture:** `ShotTracker` (overlay on `HoleFlyover`) drops its pill row + Undo + GPS-drop + wide Add button in favour of one circular club FAB: tap = add at the aim ring (GPS fallback), long-press = add at GPS. The Leaflet page (`holeMapHtml.js`) makes numbered shot pins interactive and posts `{type:'shot-tap', index}`; both map hosts forward it as `onShotTap`, and `HoleFlyover` relays the tapped index into `ShotTracker`, which opens the existing `ClubWheel` (kept unchanged — it already has Move + Delete).

**Tech Stack:** React Native 0.81 / React 19 (Expo SDK 54), `react-native-svg` (already a dep) for the club icon, Leaflet page as an inlined HTML string, Jest (jest-expo) + React Native Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-shot-fab-redesign-design.md`.
- Do NOT change `ClubWheel` internals, `shotStore`, `shotStats`, aim-ring / distance math, or edit-mode geometry markers.
- Device-screen colours stay verbatim: FAB green `#57ae5b`, confirm yellow `#f4c04a`, icon ink `#0a0d10`, badge text `#cfe3d5`.
- Fonts are `PlusJakartaSans-*` families already loaded app-wide.
- `npm run lint` (ESLint 9 flat config) is CI-blocking — no unused imports.
- Full `npm test` (~330 tests) must stay green.

---

### Task 1: `ClubIcon` SVG component

**Files:**
- Create: `src/components/scorecard/ClubIcon.js`
- Test: `src/components/scorecard/__tests__/ClubIcon.test.js`

**Interfaces:**
- Consumes: `react-native-svg` (`Svg`, `Path`).
- Produces: `export function ClubIcon({ size = 24, color = '#0a0d10' })` — renders a minimalist iron (diagonal shaft + angled head).

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/scorecard/__tests__/ClubIcon.test.js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ClubIcon } from '../ClubIcon';

describe('ClubIcon', () => {
  it('renders an svg at the given size', () => {
    const { toJSON } = render(<ClubIcon size={26} color="#0a0d10" />);
    expect(toJSON()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest ClubIcon.test -i`
Expected: FAIL — `Cannot find module '../ClubIcon'`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// src/components/scorecard/ClubIcon.js
import React from 'react';
import Svg, { Path } from 'react-native-svg';

// A minimalist golf iron: a diagonal shaft with an angled club head. No
// bundled icon set (Feather/MCI/Ionicons) ships a golf-club glyph, so this is
// hand-drawn. `size` is the square box; `color` paints both shaft and head.
export function ClubIcon({ size = 24, color = '#0a0d10' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M17.5 3.2 8.2 15.6" stroke={color} strokeWidth={2.1} strokeLinecap="round" />
      <Path
        d="M8.6 15.1 6.2 20.4c-.3.7.4 1.4 1.1 1.1l5.1-2.3c.5-.2.6-.9.2-1.3l-2.7-2.9c-.4-.4-1-.3-1.3 0Z"
        fill={color}
      />
    </Svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest ClubIcon.test -i`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/ClubIcon.js src/components/scorecard/__tests__/ClubIcon.test.js
git commit -m "feat: add ClubIcon svg for the shot FAB"
```

---

### Task 2: Tappable shot pins in the Leaflet page

**Files:**
- Modify: `src/lib/holeMapHtml.js` (the `drawShots()` function, ~lines 174-186)
- Test: `src/lib/__tests__/holeMapHtml.test.js`

**Interfaces:**
- Produces (page → host postMessage): `{ type: 'shot-tap', index }` where `index` is the 0-based position in the `shots` array. The tee/origin pin (index 0 with no club) stays non-interactive and emits nothing.

- [ ] **Step 1: Write the failing test**

Add these cases inside the existing `describe('buildHoleMapHtml', ...)` block in `src/lib/__tests__/holeMapHtml.test.js`:

```js
it('makes non-origin shot pins interactive and posts a shot-tap with the index', () => {
  const html = buildHoleMapHtml(base);
  expect(html).toContain("type:'shot-tap'");
  expect(html).toContain('interactive: !origin');
});

it('keeps the tee/origin pin (index 0, no club) non-interactive', () => {
  const html = buildHoleMapHtml(base);
  expect(html).toContain('const origin = i === 0 && !list[i].club');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest holeMapHtml.test -i -t "shot-tap"`
Expected: FAIL — string not found (pins are currently `interactive:false`).

- [ ] **Step 3: Replace `drawShots()`**

In `src/lib/holeMapHtml.js`, replace the whole `function drawShots(){ ... }` body (currently lines ~174-186) with:

```js
function drawShots(){
  const list = shots || [];
  const pts = list.map(sh => [sh.lat, sh.lng]);
  const validPts = pts.filter(valid);
  if (!validPts.length) return;
  if (validPts.length > 1) add(L.polyline(validPts, { color:'#f4c04a', weight:2, opacity:.9, dashArray:'2 7' }));
  for (let i=0;i<list.length;i++){
    if (!valid(pts[i])) continue;
    const origin = i === 0 && !list[i].club; // the seeded tee carries no club
    const mk = L.marker(pts[i], { icon: shotIcon(i+1), interactive: !origin, zIndexOffset:500 });
    if (!origin) mk.on('click', (e) => {
      if (placing) return;                // placing mode owns taps (repositioning)
      L.DomEvent.stopPropagation(e);      // don't let the tap move the aim ring
      post({ type:'shot-tap', index:i });
    });
    add(mk);
  }
  for (let i=1;i<list.length;i++){
    if (!valid(pts[i-1]) || !valid(pts[i])) continue;
    const d = dist(pts[i-1], pts[i]);
    const mid = [(pts[i-1][0]+pts[i][0])/2, (pts[i-1][1]+pts[i][1])/2];
    add(L.marker(mid, { interactive:false, icon: L.divIcon({ className:'', html:'<div class="dchip">'+disp(d)+' '+U+'</div>', iconSize:[0,0] }) }));
  }
}
```

Also update the comment above `shotIcon` (line ~171-172) from "Non-interactive" to reflect that landing pins are now tappable:

```js
// Logged shots: numbered gold pins linked by a dashed trail, with the carry
// (straight-line distance) chipped at each segment's midpoint. Drawn inside
// draw() so they survive player/hole redraws. Landing pins are tappable and
// post a shot-tap to the host; the tee/origin pin is not.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest holeMapHtml.test -i`
Expected: PASS — including the existing `inline map script parses as valid JavaScript` case (the new code is valid JS).

- [ ] **Step 5: Commit**

```bash
git add src/lib/holeMapHtml.js src/lib/__tests__/holeMapHtml.test.js
git commit -m "feat: make logged shot pins tappable on the hole map"
```

---

### Task 3: Forward `shot-tap` through the map hosts into `HoleFlyover`

**Files:**
- Modify: `src/components/scorecard/HoleMapView.web.js`
- Modify: `src/components/scorecard/HoleMapView.native.js`
- Modify: `src/components/scorecard/HoleFlyover.js`
- Test: `src/components/scorecard/__tests__/HoleFlyover.sheet.test.js`

**Interfaces:**
- Consumes: the `{type:'shot-tap', index}` message from Task 2.
- Produces: `HoleMapView` gains an `onShotTap(index: number)` prop (both `.web` and `.native`). `HoleFlyover` holds `tappedShot` state and passes `tappedShotIndex` + `onConsumeShotTap` down to `ShotTracker` (consumed in Task 4).

- [ ] **Step 1: Write the failing test**

Add to `src/components/scorecard/__tests__/HoleFlyover.sheet.test.js` inside the top-level `describe('HoleFlyover sheet chrome', ...)`:

```js
it('gives the map an onShotTap handler when a round is active', () => {
  mockHoleMapView.mockClear();
  render(<HoleFlyover {...props} roundId="r1" roundIndex={0} />);
  const last = mockHoleMapView.mock.calls[mockHoleMapView.mock.calls.length - 1][0];
  expect(typeof last.onShotTap).toBe('function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest HoleFlyover.sheet -i -t "onShotTap"`
Expected: FAIL — `last.onShotTap` is `undefined`.

- [ ] **Step 3a: Forward the message in the web host**

In `src/components/scorecard/HoleMapView.web.js`: add `onShotTap` to the destructured props, handle the message, and add it to the effect deps.

```js
export function HoleMapView({ data, player, anchor, activeField, shots, placing, onShotPoint, onAim, onShotTap, onPoint, style }) {
```

Inside the `message` listener (next to the other `m.type` branches):

```js
      if (m.type === 'shot-tap') onShotTap?.(m.index);
```

Update the effect dependency array to include `onShotTap`:

```js
  }, [onPoint, onShotPoint, onAim, onShotTap, bucket]);
```

- [ ] **Step 3b: Forward the message in the native host**

In `src/components/scorecard/HoleMapView.native.js`: add `onShotTap` to the destructured props and handle it in `onMessage`.

```js
export function HoleMapView({ data, player, anchor, activeField, shots, placing, onShotPoint, onAim, onShotTap, onPoint, style }) {
```

```js
        if (m.type === 'shot-tap') onShotTap?.(m.index);
```

- [ ] **Step 3c: Relay in `HoleFlyover`**

In `src/components/scorecard/HoleFlyover.js`, add a state next to `placing`/`pendingPoint`/`aimPos` (~line 64-68):

```js
  // Index of a shot pin tapped on the map, relayed to ShotTracker to open its
  // club wheel for that shot.
  const [tappedShot, setTappedShot] = useState(null);
```

Pass `onShotTap` to `HoleMapView` (add to its prop list, ~line 120-129):

```js
                onAim={setAimPos}
                onShotTap={setTappedShot}
```

Pass the relay to `ShotTracker` (add to its prop list, ~line 131-145):

```js
                  pendingPoint={pendingPoint}
                  onConsumePoint={() => setPendingPoint(null)}
                  tappedShotIndex={tappedShot}
                  onConsumeShotTap={() => setTappedShot(null)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest HoleFlyover.sheet -i`
Expected: PASS (all cases, including the new `onShotTap` one).

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/HoleMapView.web.js src/components/scorecard/HoleMapView.native.js src/components/scorecard/HoleFlyover.js src/components/scorecard/__tests__/HoleFlyover.sheet.test.js
git commit -m "feat: relay shot-pin taps from the map into ShotTracker"
```

---

### Task 4: Refactor `ShotTracker` to the club FAB + pin-tap wheel

**Files:**
- Modify: `src/components/scorecard/ShotTracker.js` (full rewrite of the render + styles; logic helpers mostly kept)
- Test: `src/components/scorecard/__tests__/ShotTracker.test.js` (new)

**Interfaces:**
- Consumes: `tappedShotIndex` + `onConsumeShotTap` from Task 3; `ClubIcon` from Task 1; unchanged `ClubWheel`.
- Produces: no new outward interface — same props plus the two new ones. FAB carries `accessibilityLabel="Add a shot at the aim ring"`; confirm affordance carries `accessibilityLabel="Confirm the shot's new spot"`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/scorecard/__tests__/ShotTracker.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ShotTracker } from '../ShotTracker';

// Controllable shot list for shotsForHole / getShots.
let mockShots = [];
jest.mock('../../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => mockShots,
  shotsForHole: () => mockShots,
  logShot: jest.fn(async () => ({ id: 'new' })),
  setShotClub: jest.fn(),
  setShotPos: jest.fn(),
  deleteShot: jest.fn(),
}));

// Keep the wheel trivial: surface whether it's open + its label, and let a
// press stand in for "Delete".
jest.mock('../ClubWheel', () => ({
  ClubWheel: ({ visible, seqLabel, onDelete }) => (
    visible ? <Text onPress={onDelete}>{`wheel:${seqLabel}`}</Text> : null
  ),
}));

jest.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters', bag: undefined, clubDistances: {} }),
}));

const { logShot, deleteShot } = require('../../../store/shotStore');

const base = {
  roundId: 'r1', roundIndex: 0, holeNumber: 7,
  pos: null, teePos: [38.55, -0.14], aimPos: null,
  targetPos: [38.556, -0.147], targetMeters: 150,
  placing: false, onTogglePlacing: jest.fn(),
  pendingPoint: null, onConsumePoint: jest.fn(),
  tappedShotIndex: null, onConsumeShotTap: jest.fn(),
};

beforeEach(() => { mockShots = []; logShot.mockClear(); deleteShot.mockClear(); });

describe('ShotTracker FAB', () => {
  it('renders the club FAB', () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} />);
    getByLabelText('Add a shot at the aim ring');
  });

  it('adds a shot at the aim ring on press', () => {
    const { getByLabelText } = render(<ShotTracker {...base} aimPos={[38.554, -0.142]} />);
    fireEvent.press(getByLabelText('Add a shot at the aim ring'));
    expect(logShot).toHaveBeenCalled();
  });

  it('adds a shot at GPS on long-press', () => {
    const { getByLabelText } = render(<ShotTracker {...base} pos={[38.553, -0.141]} />);
    fireEvent(getByLabelText('Add a shot at the aim ring'), 'longPress');
    expect(logShot).toHaveBeenCalled();
  });

  it('does nothing when there is no aim ring and no GPS', () => {
    const { getByLabelText } = render(<ShotTracker {...base} />);
    fireEvent.press(getByLabelText('Add a shot at the aim ring'));
    expect(logShot).not.toHaveBeenCalled();
  });

  it('opens the club wheel for a tapped pin index', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    getByText('wheel:Shot 1');
  });

  it('deletes the tapped shot from the wheel', () => {
    mockShots = [
      { id: 't', lat: 38.55, lng: -0.14, club: null },
      { id: 's2', lat: 38.554, lng: -0.142, club: '7i' },
    ];
    const { getByText } = render(<ShotTracker {...base} tappedShotIndex={1} />);
    fireEvent.press(getByText('wheel:Shot 1'));
    expect(deleteShot).toHaveBeenCalledWith('s2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest ShotTracker.test -i`
Expected: FAIL — the FAB label/relay don't exist yet (current component renders a pill bar + "Add shot" button).

- [ ] **Step 3: Rewrite `ShotTracker.js`**

Replace the entire file with:

```jsx
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, setShotClub, setShotPos, deleteShot,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub, clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { haptic } from '../../lib/haptics';
import { ClubWheel } from './ClubWheel';
import { ClubIcon } from './ClubIcon';

// Shot log overlaid on the hole map (HoleFlyover), reduced to a single club
// FAB in the bottom-right corner. Ball spots live on the map as numbered pins:
//   - Tap the FAB to drop a spot at the white aim ring (GPS fallback); the
//     club wheel opens on it to pick the club that got the ball there.
//   - Long-press the FAB to drop the spot at your exact live GPS instead.
//   - Tap a pin on the map (relayed here as `tappedShotIndex`) to re-open the
//     wheel and change the club, move the spot, or delete it.
// The first spot on a hole is the tee, seeded from the hole geometry.
export function ShotTracker({
  roundId, roundIndex, holeNumber,
  pos, teePos, aimPos, targetPos, targetMeters,
  placing, onTogglePlacing, pendingPoint, onConsumePoint,
  tappedShotIndex, onConsumeShotTap,
}) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [wheelId, setWheelId] = useState(null); // shot id whose club wheel is open
  const [moveId, setMoveId] = useState(null); // shot id being repositioned by the next tap

  const overrides = appSettings.clubDistances;
  // "Club to hit" hint for the next shot, from distance to the green.
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots(), overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, overrides, shotsVersion],
  );

  // Add a ball spot at `spot` ([lat,lng]). Seeds the tee as the origin on an
  // empty hole, appends the landing, and opens the club wheel on it —
  // pre-focused on the club whose carry matches the just-measured distance.
  const addSpot = async (spot) => {
    const hole = shotsForHole(roundId, roundIndex, holeNumber);
    let prev = hole[hole.length - 1] ?? null;
    if (hole.length === 0 && teePos) {
      await logShot({ roundId, roundIndex, holeNumber, pos: teePos, club: null });
      prev = { lat: teePos[0], lng: teePos[1] };
    }
    const carry = prev ? haversineMeters([prev.lat, prev.lng], spot) : null;
    const guess = carry ? recommendClub(carry, appSettings.bag, getShots(), overrides)?.club ?? null : null;
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos: spot, club: guess });
    setWheelId(shot.id);
  };

  // A map tap handed down from the parent, only while moving a spot: each tap
  // repositions the shot; the move stays live until the player hits Confirm.
  useEffect(() => {
    if (!pendingPoint) return;
    haptic('light');
    (async () => {
      if (moveId) await setShotPos(moveId, pendingPoint);
    })().finally(() => onConsumePoint?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPoint]);

  // A pin tapped on the map opens the wheel for that shot.
  useEffect(() => {
    if (tappedShotIndex == null) return;
    const sh = shots[tappedShotIndex];
    if (sh) setWheelId(sh.id);
    onConsumeShotTap?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappedShotIndex]);

  // Add a shot at the white aim ring (GPS as a fallback), or at exact GPS.
  const addAtAim = () => { const p = aimPos || pos; if (p) addSpot(p); };
  const dropAtMe = () => { if (pos) addSpot(pos); };

  if (!roundId) return null;

  // Incoming carry for spot i (distance from the previous spot). Origin = null.
  const carryOf = (i) => (i > 0
    ? haversineMeters([shots[i - 1].lat, shots[i - 1].lng], [shots[i].lat, shots[i].lng])
    : null);

  // ── Wheel state derived from the shot being edited ───────────────────────
  const averages = clubAverages(getShots());
  const effDist = (k) => {
    const o = overrides?.[k];
    return (Number.isFinite(o) && o > 0) ? o : (averages.get(k) ?? clubNominal(k));
  };
  const wheelClubs = bag.map((k) => ({ key: k, label: clubLabel(k), distance: effDist(k) }));
  const editIndex = wheelId ? shots.findIndex((sh) => sh.id === wheelId) : -1;
  const editShot = editIndex >= 0 ? shots[editIndex] : null;
  const editCarry = editIndex > 0 ? carryOf(editIndex) : null;
  const editToPin = editShot && targetPos
    ? haversineMeters([editShot.lat, editShot.lng], targetPos) : null;
  const editValue = editShot
    ? (editShot.club ?? recommendClub(editCarry, appSettings.bag, getShots(), overrides)?.club ?? null)
    : null;

  const closeWheel = () => setWheelId(null);
  const chooseClub = (club) => { if (wheelId && club) setShotClub(wheelId, club); closeWheel(); };
  const moveShot = () => {
    setMoveId(wheelId);
    closeWheel();
    if (!placing) onTogglePlacing?.();
    haptic('selection');
  };
  const confirmMove = () => {
    setMoveId(null);
    if (placing) onTogglePlacing?.();
    haptic('selection');
  };
  const removeShot = () => { if (wheelId) deleteShot(wheelId); closeWheel(); };

  const canAdd = !!(aimPos || pos);

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {moveId ? (
        <View style={s.moveCol}>
          <Text style={s.moveHint}>Tap the map to move the shot</Text>
          <PressableScale
            onPress={confirmMove}
            style={[s.fab, s.fabConfirm]}
            accessibilityLabel="Confirm the shot's new spot"
          >
            <Feather name="check" size={24} color="#0a0d10" />
          </PressableScale>
        </View>
      ) : (
        <View style={s.fabCol}>
          {suggestion && <Text style={s.badge}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
          <PressableScale
            onPress={addAtAim}
            onLongPress={dropAtMe}
            disabled={!canAdd}
            style={[s.fab, !canAdd && s.fabDisabled]}
            accessibilityLabel="Add a shot at the aim ring"
          >
            <ClubIcon size={26} color="#0a0d10" />
          </PressableScale>
        </View>
      )}

      <ClubWheel
        visible={!!editShot}
        clubs={wheelClubs}
        value={editValue}
        units={units}
        seqLabel={editIndex >= 0 ? `Shot ${editIndex}` : 'Club'}
        carryMeters={editCarry}
        toPinMeters={editToPin}
        onSelect={chooseClub}
        onMove={moveShot}
        onDelete={removeShot}
        onClose={closeWheel}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', right: 16, bottom: 20, alignItems: 'flex-end', gap: 8,
  },
  fabCol: { alignItems: 'center', gap: 6 },
  moveCol: { alignItems: 'center', gap: 8 },
  badge: {
    backgroundColor: 'rgba(10,13,16,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
    color: '#cfe3d5', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999,
    fontVariant: ['tabular-nums'],
  },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#57ae5b',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  fabConfirm: { backgroundColor: '#f4c04a' },
  fabDisabled: { opacity: 0.5 },
  moveHint: {
    color: '#0a0d10', backgroundColor: '#f4c04a',
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: 'hidden',
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest ShotTracker.test -i`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/ShotTracker.js src/components/scorecard/__tests__/ShotTracker.test.js
git commit -m "feat: shrink ShotTracker to a club FAB + pin-tap club wheel"
```

---

### Task 5: Full verification (lint, suite, runtime)

**Files:** none (verification only).

- [ ] **Step 1: Lint the whole project**

Run: `npm run lint`
Expected: PASS — no unused-import errors (confirms `ScrollView`, `undoLastShot`, `formatDistance`, `unitSuffix` were fully dropped from `ShotTracker.js`).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — ~330+ tests green, including the pre-existing `HoleFlyover.sheet` and `holeMapHtml` suites.

- [ ] **Step 3: Runtime-verify with the `verify` skill**

Invoke the project `verify` skill (Expo web + Playwright): open a live round → hole map sheet, then confirm:
- a small green club FAB sits in the bottom-right with a `≈ <club>` badge above it;
- tapping it drops a numbered pin and opens the club wheel;
- long-pressing it drops a pin at the GPS marker;
- tapping an existing pin re-opens the wheel with Move + Delete, and Delete removes the pin;
- the old full-width bar (pills / Undo / GPS-drop / wide Add button) is gone.

- [ ] **Step 4: Commit any verify-driven fixes**

If runtime verification surfaces adjustments, fix, re-run `npm test`, and commit:

```bash
git add -A
git commit -m "fix: shot FAB runtime adjustments from verify"
```

---

## Self-Review

**Spec coverage:**
- FAB replaces bar, bottom-right, club icon, tap=ring / long-press=GPS, suggestion badge → Task 4. ✓
- Custom `ClubIcon` (no bundled glyph) → Task 1. ✓
- Tappable pins post `shot-tap`, tee/origin excluded → Task 2. ✓
- Host relay `onShotTap` (web + native) + `HoleFlyover` wiring → Task 3. ✓
- Pin tap opens `ClubWheel` (kept as-is) with Move + Delete → Tasks 3+4. ✓
- Undo & GPS-drop buttons retired; move mode → confirm affordance → Task 4. ✓
- Tests for FAB add/long-press/disabled, relay, delete; existing suites unaffected → Tasks 1-5. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type consistency:** `onShotTap(index)` posted in Task 2, forwarded in Task 3, consumed as `tappedShotIndex` + `onConsumeShotTap` in Task 4. `ClubIcon({size,color})` defined in Task 1, used in Task 4. `shotsForHole`/`logShot`/`deleteShot`/`setShotPos`/`setShotClub` signatures unchanged. ✓
