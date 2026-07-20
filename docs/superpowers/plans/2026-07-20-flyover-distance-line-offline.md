# Hole Flyover: Two-Leg Distance Line + Offline Maps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the scorecard's full-screen hole flyover with an anchor→aim→green two-leg measuring line (distances chipped on the map) and make the whole map work offline (vendored Leaflet, per-course tile cache, pre-download, vector fallback).

**Architecture:** The flyover is a self-contained Leaflet HTML page (`src/lib/holeMapHtml.js`) hosted in an iframe (web) / WebView (Android) by `HoleMapView`, talking to the host via postMessage. Phase 1 changes the page's view mode + a pure anchor helper. Phase 2 removes the page's network dependencies: libraries get inlined from a generated vendor module, and tiles are requested from the host over the existing postMessage bridge, backed by a new `tileCache` store with per-course buckets and prefetch.

**Tech Stack:** Expo SDK 54 / RN 0.81 / React 19, plain JS (no TypeScript), Leaflet 1.9.4 + leaflet-rotate 0.2.8, expo-file-system (legacy API) / Cache API, @react-native-community/netinfo, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-07-20-flyover-distance-line-offline-design.md`

## Global Constraints

- Plain JavaScript only — no TypeScript syntax anywhere.
- Domain logic lives in `src/lib/` / `src/store/`, not in screens/components (CLAUDE.md).
- `npm test` (~330 tests) and `npm run lint` (ESLint 9 flat config, CI-blocking) must pass after every task.
- GPS anchor threshold is exactly **700 m** (inclusive); prefetch zooms are **15–19**; tile cache cap is **150 MB**.
- All distances in meters; coordinates are `[lat, lng]` arrays throughout.
- The page↔host message contract is JSON via postMessage; new message types: `tile`, `tile-data`; extended: `player` gains `anchor`.
- Esri World Imagery tile URL pattern (z/y/x order!): `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`.
- Work in an isolated worktree (superpowers:using-git-worktrees) under `~/golf-partner-worktrees/` — the main checkout is shared between sessions.
- Jest picks up nested worktree copies if any exist under the repo — never create worktrees inside the repo directory.

---

### Task 1: Anchor rule helper (`flyoverModel`)

**Files:**
- Create: `src/lib/flyoverModel.js`
- Test: `src/lib/__tests__/flyoverModel.test.js`

**Interfaces:**
- Consumes: `haversineMeters(a, b)` from `src/lib/geo.js` (`[lat,lng], [lat,lng] → meters`).
- Produces: `anchorFor({ player, tee, greenCenter }) → { anchor: [lat,lng]|null, source: 'gps'|'tee'|null, playerDistance: number|null }` and `ANCHOR_MAX_GPS_METERS = 700`. Task 2 (HoleFlyover) calls this.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/flyoverModel.test.js
import { anchorFor, ANCHOR_MAX_GPS_METERS } from '../flyoverModel';

// ~111,320 m per degree of latitude; latitude-only offsets make distances
// predictable without longitude scaling.
const GREEN = [38.56, -0.139];
const at = (metersNorth) => [GREEN[0] + metersNorth / 111320, GREEN[1]];
const TEE = at(400);

describe('anchorFor', () => {
  it('uses the player when within 700 m of the green', () => {
    const r = anchorFor({ player: at(250), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
    expect(r.anchor).toEqual(at(250));
    expect(r.playerDistance).toBeCloseTo(250, 0);
  });

  it('700 m exactly still counts as on-course (inclusive)', () => {
    const r = anchorFor({ player: at(ANCHOR_MAX_GPS_METERS), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
  });

  it('falls back to the tee beyond 700 m', () => {
    const r = anchorFor({ player: at(1200), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('tee');
    expect(r.anchor).toEqual(TEE);
    expect(r.playerDistance).toBeCloseTo(1200, 0);
  });

  it('falls back to the tee with no player at all', () => {
    const r = anchorFor({ player: null, tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('tee');
    expect(r.playerDistance).toBeNull();
  });

  it('returns no anchor when far away and no tee is mapped', () => {
    const r = anchorFor({ player: at(1200), tee: null, greenCenter: GREEN });
    expect(r).toEqual({ anchor: null, source: null, playerDistance: expect.any(Number) });
  });

  it('treats invalid coordinates as missing', () => {
    expect(anchorFor({ player: [NaN, 0], tee: TEE, greenCenter: GREEN }).source).toBe('tee');
    expect(anchorFor({ player: null, tee: ['a', 0], greenCenter: GREEN }).source).toBeNull();
  });

  it('no greenCenter → player distance unknown → tee', () => {
    const r = anchorFor({ player: at(100), tee: TEE, greenCenter: null });
    expect(r.source).toBe('tee');
    expect(r.playerDistance).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/flyoverModel.test.js`
Expected: FAIL — `Cannot find module '../flyoverModel'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/flyoverModel.js
import { haversineMeters } from './geo';

export const ANCHOR_MAX_GPS_METERS = 700;

const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

// Where does the measuring line start? Live GPS wins while the player is
// within ANCHOR_MAX_GPS_METERS of the green; otherwise the tee; otherwise
// nothing (the flyover falls back to free drag-to-measure).
export function anchorFor({ player, tee, greenCenter }) {
  const playerDistance = valid(player) && valid(greenCenter)
    ? haversineMeters(player, greenCenter)
    : null;
  if (playerDistance != null && playerDistance <= ANCHOR_MAX_GPS_METERS) {
    return { anchor: player, source: 'gps', playerDistance };
  }
  if (valid(tee)) return { anchor: tee, source: 'tee', playerDistance };
  return { anchor: null, source: null, playerDistance };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/flyoverModel.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/flyoverModel.js src/lib/__tests__/flyoverModel.test.js
git commit -m "feat(flyover): anchor rule helper (gps<=700m, tee fallback)"
```

---

### Task 2: Two-leg line, chips, tap-anywhere in the map page

**Files:**
- Modify: `src/lib/holeMapHtml.js` (CSS block, `draw()`, `redrawLines()`, `hud()`, message handler)
- Modify: `src/components/scorecard/HoleFlyover.js` (compute + pass `anchor`)
- Modify: `src/components/scorecard/HoleMapView.web.js:23` and `src/components/scorecard/HoleMapView.native.js:18` (include `anchor` in the player message)
- Test: `src/lib/__tests__/holeMapHtml.test.js` (new)

**Interfaces:**
- Consumes: `anchorFor` from Task 1.
- Produces: `data.anchor = { pos, source, playerDistance }` embedded in the page; `HoleMapView` accepts an `anchor` prop and sends `{ type:'player', pos, anchor }`. The page renders the two-leg line from `anchor.pos`. Tasks 3–4 modify the same page functions.

- [ ] **Step 1: Write the failing test** (string-level checks on the generated page)

```js
// src/lib/__tests__/holeMapHtml.test.js
import { buildHoleMapHtml } from '../holeMapHtml';

const base = {
  mode: 'view', holeKey: 'C#1#view', holeLabel: 'Hole 1',
  green: [[38.56, -0.139]], greenCenter: [38.56, -0.139],
  tee: [38.5634, -0.1439], hazards: [], player: null,
  anchor: { pos: [38.5634, -0.1439], source: 'tee', playerDistance: 1234 },
};

describe('buildHoleMapHtml', () => {
  it('embeds the anchor in the page data', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('"source": "tee"');
  });
  it('has the on-line distance chip machinery and no legacy layup chip', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('dchip');
    expect(html).not.toContain('🎯');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js`
Expected: FAIL — `dchip` missing and `🎯` present (the anchor-embedding assertion may already pass since `JSON.stringify(data)` is embedded verbatim; that's fine).

- [ ] **Step 3: Pass the anchor from the hosts**

In `HoleFlyover.js`, import and compute the anchor and add it to `data` (inside the existing `useMemo`), and pass it to `HoleMapView`:

```js
import { anchorFor } from '../../lib/flyoverModel';
// inside the component body:
const anchorInfo = useMemo(() => {
  if (!feat) return null;
  const r = anchorFor({ player: position, tee: feat.start, greenCenter: feat.greenCenter });
  return { pos: r.anchor, source: r.source, playerDistance: r.playerDistance };
}, [feat, position]);
// data useMemo gains:  anchor: anchorInfo,   (add anchorInfo to its dep array)
// and the render:      <HoleMapView data={data} player={position} anchor={anchorInfo} style={s.map} />
```

In **both** `HoleMapView.web.js` and `HoleMapView.native.js`, accept the prop and extend the player effect (the geometry editor passes no `anchor`; `?? null` keeps its behavior unchanged):

```js
export function HoleMapView({ data, player, anchor, activeField, onPoint, style }) {
  // ...
  useEffect(() => { send({ type: 'player', pos: player || null, anchor: anchor ?? null }); }, [player, anchor]);
```

- [ ] **Step 4: Rewrite the page's view mode**

In `src/lib/holeMapHtml.js`:

**4a — CSS:** delete the `.chip` rule (yellow layup chip) and add:

```css
.dchip{background:rgba(14,22,28,.88);color:#fff;font-weight:800;font-size:13px;padding:4px 11px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid rgba(255,255,255,.25);transform:translate(-50%,-50%);display:inline-block}
```

**4b — page state:** after `let player = DATA.player || null;` add:

```js
let anchor = DATA.anchor || { pos: null, source: null, playerDistance: null };
```

and replace the `onCourse` helper with:

```js
const onCourse = () => anchor && anchor.source === 'gps';
```

**4c — `fcb()`:** replace the `player`-based polygon fallback with the anchor/target source so front/back follow the line's origin:

```js
function fcb() {
  const c = hole.greenCenter || (hole.green ? centroid(hole.green) : null);
  let f = hole.greenFront || null, b = hole.greenBack || null;
  const src = (anchor && valid(anchor.pos)) ? anchor.pos : (valid(target) ? target : null);
  if ((!f || !b) && hole.green && src) {
    let nf = null, nb = null, best = 1e18, worst = -1;
    for (const v of hole.green) { const d = dist(src, v); if (d < best){best=d; nf=v;} if (d > worst){worst=d; nb=v;} }
    f = f || nf; b = b || nb;
  }
  return { f, c, b };
}
```

**4d — `draw()` view branch:** replace everything from `const from = onCourse() ? player : null;` to the end of `draw()` with:

```js
  const from = valid(anchor.pos) ? anchor.pos : null;
  const cc = valid(g.c) ? g.c : [map.getCenter().lat, map.getCenter().lng];
  if (!valid(target)) target = from ? [(from[0]+cc[0])/2,(from[1]+cc[1])/2] : cc;
  if (onCourse()) add(L.circleMarker(from, { radius:8, color:'#fff', weight:3, fillColor:'#2f6bff', fillOpacity:1 }));
  const aim = add(L.marker(target, { draggable:true, icon: ringIcon(), zIndexOffset:1000 }));
  aim.on('drag', e => { target = [e.latlng.lat, e.latlng.lng]; redrawLines(from, g, cc); });
  map.off('click');
  map.on('click', (e) => { target = [e.latlng.lat, e.latlng.lng]; aim.setLatLng(e.latlng); redrawLines(from, g, cc); });
  redrawLines(from, g, cc);
  hud(from, g);
```

**4e — `redrawLines()` + chips:** replace the existing `redrawLines` block with:

```js
let lineLayers = [];
function chipMk(a, b, d){
  const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
  return L.marker(mid, { interactive:false, icon: L.divIcon({ className:'', html:'<div class="dchip">'+round(d)+' m</div>', iconSize:[0,0] }) });
}
function redrawLines(from, g, cc){
  lineLayers.forEach(l=>map.removeLayer(l)); lineLayers=[];
  const mk=(l)=>{lineLayers.push(l.addTo(map));};
  if (from){
    mk(L.polyline([from,target],{color:'#fff',weight:4}));
    mk(chipMk(from, target, dist(from, target)));
    if(valid(cc)){ mk(L.polyline([target,cc],{color:'#fff',weight:3,dashArray:'3 8'})); mk(chipMk(target, cc, dist(target, cc))); }
  } else if (valid(cc)){
    mk(L.polyline([target,cc],{color:'#fff',weight:3,dashArray:'3 8'}));
    mk(chipMk(target, cc, dist(target, cc)));
  }
}
```

(The old `aim.on('dragend', () => hud(from, g))` line is no longer needed — the HUD is anchor-static; delete it.)

**4f — message handler:** extend the `player` case:

```js
if (m.type === 'player') { player = m.pos; if (m.anchor) anchor = m.anchor; draw(); }
```

**4g — `hud()` for THIS task** (fully rewritten in Task 4): remove the `🎯` chip line so the tail reads:

```js
    (from
      ? '<div class="hint">Drag the ring or tap anywhere</div>'
      : '<div class="hint">Drag the ring to measure</div>');
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js && npm test`
Expected: new test PASS; full suite green.

- [ ] **Step 6: Manual smoke check (web)**

Run `npm run web`, open a round on a course with geometry (Villaitana Levante), tap the GPS strip. Verify: two-leg line with a chip on each leg, tap anywhere moves the ring, drag works, no yellow chip. (Full flow re-verified in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/holeMapHtml.js src/lib/__tests__/holeMapHtml.test.js src/components/scorecard/HoleFlyover.js src/components/scorecard/HoleMapView.web.js src/components/scorecard/HoleMapView.native.js
git commit -m "feat(flyover): two-leg anchor line with on-map distance chips + tap-anywhere"
```

---

### Task 3: Deterministic tee-up framing

**Files:**
- Modify: `src/lib/holeMapHtml.js` (`initView()`, map options)

**Interfaces:**
- Consumes: page state from Task 2 (`anchor`, `onCourse()`).
- Produces: nothing new for later tasks (self-contained view logic).

- [ ] **Step 1: Add fractional zoom support**

In the `L.map('map', { … })` options add `zoomSnap: 0.25,` after `zoomControl: true,`.

- [ ] **Step 2: Replace `initView()`**

```js
// Initial view: tee at the bottom, green at the top, hole filling the
// viewport. fitBounds misframes under leaflet-rotate, so compute the view
// directly: rotate to the tee->green bearing, center the midpoint, zoom from
// hole length vs viewport height (~45% padding).
function initView(){
  const g = fcb();
  const c = valid(g.c) ? g.c : null;
  if (map.setBearing) map.setBearing(0);
  if (valid(hole.tee) && c) {
    const mid = [(hole.tee[0]+c[0])/2, (hole.tee[1]+c[1])/2];
    const len = Math.max(dist(hole.tee, c), 60);
    const hPx = Math.max(document.getElementById('map').clientHeight, 320);
    const mpp = (len * 1.45) / hPx;
    const zoom = Math.min(Math.log2(156543.03392 * Math.cos(mid[0]*Math.PI/180) / mpp), 19.5);
    if (map.setBearing) map.setBearing(bearing(hole.tee, c));
    map.setView(mid, zoom);
  } else if (onCourse() && c && valid(player)) {
    map.fitBounds(L.latLngBounds([player, c]).pad(0.3));
  } else if (c) {
    map.setView(c, 16);
  } else {
    map.setView([40.45, -3.75], 15);
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm test` (suite stays green). Manually on web: every hole with a tee opens tee-bottom/green-top, whole hole visible; a greens-only course still centers on the green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/holeMapHtml.js
git commit -m "feat(flyover): deterministic tee-up framing"
```

---

### Task 4: Unified HUD distance cluster

**Files:**
- Modify: `src/lib/holeMapHtml.js` (CSS + `hud()`)
- Test: `src/lib/__tests__/holeMapHtml.test.js` (extend)

**Interfaces:**
- Consumes: `anchor` page state (Task 2).
- Produces: final HUD markup (`.tri` cluster). No downstream consumers.

- [ ] **Step 1: Extend the test**

```js
  it('renders the unified tri cluster instead of the old cards', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('class="tri"');
    expect(html).not.toContain('class="card front"');
  });
```

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js` — expected FAIL.

- [ ] **Step 2: Replace HUD CSS**

Delete the `.big`, `.card`, `.front`, `.back` rules; add:

```css
.tri{position:absolute;top:12px;right:12px;text-align:right;color:#fff;background:rgba(14,22,28,.72);border-radius:14px;padding:8px 13px 7px}
.tri .row{display:flex;align-items:baseline;justify-content:flex-end;gap:6px}
.tri .sm{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;color:#e8eef2}
.tri .bign{font-size:40px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums}
.tri .u{font-size:13px;font-weight:600;color:#9fb0a4}
.tri .lbl{font-size:9px;font-weight:700;letter-spacing:.08em;color:#9fb0a4;text-transform:uppercase;width:34px;text-align:left}
.tri .foot{font-size:9px;font-weight:700;letter-spacing:.1em;color:#cfe;text-transform:uppercase;margin-top:2px}
```

- [ ] **Step 3: Replace `hud()`**

```js
function hud(from, g){
  const h = document.getElementById('hud');
  const src = from || target;
  const d = (p) => valid(p) && valid(src) ? dist(src, p) : null;
  const fromTee = anchor && anchor.source === 'tee';
  const km = anchor && anchor.playerDistance != null ? (anchor.playerDistance/1000).toFixed(1) : null;
  h.innerHTML =
    '<div class="tri">'+
      '<div class="row"><span class="lbl">Back</span><span class="sm">'+round(d(g.b))+'</span></div>'+
      '<div class="row"><span class="lbl"></span><span class="bign">'+round(d(g.c))+'</span><span class="u">m</span></div>'+
      '<div class="row"><span class="lbl">Front</span><span class="sm">'+round(d(g.f))+'</span></div>'+
      '<div class="foot">to green'+(fromTee ? ' · from tee' : '')+'</div>'+
    '</div>'+
    (from
      ? (fromTee
        ? '<div class="hint">📍 '+(km ? km+' km away' : 'No GPS')+' — measuring from the tee</div>'
        : '<div class="hint">Drag the ring or tap anywhere</div>')
      : '<div class="hint">Drag the ring to measure</div>');
}
```

(Task 2's test asserts `not.toContain('🎯')` specifically — the `📍` pill here does not conflict.)

- [ ] **Step 4: Run tests, verify manually, commit**

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js && npm test` — PASS.
Web check: cluster top-right (Back small / Center 40px / Front small), footer says "TO GREEN · FROM TEE" in fallback.

```bash
git add src/lib/holeMapHtml.js src/lib/__tests__/holeMapHtml.test.js
git commit -m "feat(flyover): unified back/center/front distance cluster"
```

---

### Task 5: Delete dead `HoleMap.js`

**Files:**
- Delete: `src/components/scorecard/HoleMap.js`

- [ ] **Step 1: Prove it's orphaned**

Run: `grep -rn "from './HoleMap'\|scorecard/HoleMap'" src/ --include='*.js' | grep -v HoleMapView`
Expected: no output (only `HoleMapView` imports exist).

- [ ] **Step 2: Delete and verify**

```bash
git rm src/components/scorecard/HoleMap.js
npm test && npm run lint
```

Expected: suite + lint green.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(scorecard): remove orphaned HoleMap SVG component"
```

---

### Task 6: Vendor Leaflet into the page (offline boot)

**Files:**
- Create: `scripts/build-leaflet-vendor.js`
- Create (generated, committed): `src/lib/vendor/leafletBundle.js`
- Modify: `package.json` (devDependencies + `build:vendor` script), `eslint.config.mjs` (ignore the generated file), `src/lib/holeMapHtml.js` (inline instead of unpkg)
- Test: `src/lib/__tests__/holeMapHtml.test.js` (extend)

**Interfaces:**
- Produces: `LEAFLET_CSS`, `LEAFLET_JS`, `LEAFLET_ROTATE_JS` string exports from `src/lib/vendor/leafletBundle.js`, consumed only by `holeMapHtml.js`.

- [ ] **Step 1: Extend the test**

```js
  it('inlines Leaflet — no CDN dependency', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('unpkg.com');
  });
```

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js` — expected FAIL.

- [ ] **Step 2: Install pinned dev dependencies**

```bash
npm install --save-dev leaflet@1.9.4 leaflet-rotate@0.2.8
```

(Dev deps: they're only read at vendor-generation time, never bundled from node_modules.)

- [ ] **Step 3: Write the generator**

```js
// scripts/build-leaflet-vendor.js
// Regenerate src/lib/vendor/leafletBundle.js from node_modules.
// Run with: npm run build:vendor   (output is committed)
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'node_modules', p), 'utf8');
// Guard against '</script>' sequences terminating the inline block early.
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');

const out = `// GENERATED by scripts/build-leaflet-vendor.js — do not edit by hand.
/* eslint-disable */
export const LEAFLET_CSS = ${JSON.stringify(read('leaflet/dist/leaflet.css'))};
export const LEAFLET_JS = ${JSON.stringify(esc(read('leaflet/dist/leaflet.js')))};
export const LEAFLET_ROTATE_JS = ${JSON.stringify(esc(read('leaflet-rotate/dist/leaflet-rotate-src.js')))};
`;
const dest = path.join(__dirname, '..', 'src', 'lib', 'vendor', 'leafletBundle.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('wrote', dest, `${(out.length / 1024).toFixed(0)} KB`);
```

Add to `package.json` scripts: `"build:vendor": "node scripts/build-leaflet-vendor.js"`. Add `'src/lib/vendor/**'` to the `ignores` array in `eslint.config.mjs`.

Run: `npm run build:vendor` — expected: `wrote … leafletBundle.js` (roughly 250–500 KB).

- [ ] **Step 4: Inline in `holeMapHtml.js`**

```js
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_ROTATE_JS } from './vendor/leafletBundle';
```

Replace the three unpkg tags in the template:

- `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>` → `<style>${LEAFLET_CSS}</style>`
- `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>` → `<script>${LEAFLET_JS}</script>`
- `<script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js"></script>` → `<script>${LEAFLET_ROTATE_JS}</script>`

- [ ] **Step 5: Run tests + manual offline boot check**

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js && npm test && npm run lint` — PASS.
Web: open flyover with DevTools → Network → Offline. The map page must boot (dark background, vectors, HUD); only tiles are missing.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-leaflet-vendor.js src/lib/vendor/leafletBundle.js src/lib/holeMapHtml.js src/lib/__tests__/holeMapHtml.test.js package.json package-lock.json eslint.config.mjs
git commit -m "feat(flyover): vendor Leaflet into the map page — boots offline"
```

---

### Task 7: Tile math helpers

**Files:**
- Create: `src/lib/tileMath.js`
- Test: `src/lib/__tests__/tileMath.test.js`

**Interfaces:**
- Produces (consumed by Tasks 8–11):
  - `lonToTileX(lon, z) → int`, `latToTileY(lat, z) → int` (Web-Mercator/OSM scheme)
  - `tilesForBbox({minLat, maxLat, minLng, maxLng}, zooms) → [{z,x,y}, …]` (deduped)
  - `holeBbox(features, padMeters = 80) → {minLat, maxLat, minLng, maxLng} | null` where `features = { tee, greenCenter, green, hazards }`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/tileMath.test.js
import { lonToTileX, latToTileY, tilesForBbox, holeBbox } from '../tileMath';

describe('tile coordinates', () => {
  it('is consistent with the slippy-map formulas for a known point', () => {
    // lat 38.56 lng -0.139 @ z15 (computed from the OSM wiki formulas)
    expect(lonToTileX(-0.139, 15)).toBe(Math.floor(((-0.139 + 180) / 360) * 2 ** 15));
    const r = (38.56 * Math.PI) / 180;
    expect(latToTileY(38.56, 15)).toBe(Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 15));
  });
});

describe('tilesForBbox', () => {
  const bbox = { minLat: 38.5595, maxLat: 38.5605, minLng: -0.1440, maxLng: -0.1390 };
  it('enumerates tiles covering the bbox at the requested zoom', () => {
    const tiles = tilesForBbox(bbox, [15]);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    tiles.forEach((t) => expect(t.z).toBe(15));
    tiles.forEach((t) => {
      expect(t.x).toBeGreaterThanOrEqual(lonToTileX(bbox.minLng, 15));
      expect(t.x).toBeLessThanOrEqual(lonToTileX(bbox.maxLng, 15));
    });
  });
  it('higher zooms produce more tiles', () => {
    expect(tilesForBbox(bbox, [19]).length).toBeGreaterThan(tilesForBbox(bbox, [16]).length);
  });
  it('dedupes repeated zooms', () => {
    expect(tilesForBbox(bbox, [15, 15]).length).toBe(tilesForBbox(bbox, [15]).length);
  });
});

describe('holeBbox', () => {
  it('covers tee, green and hazards with padding', () => {
    const b = holeBbox({ tee: [38.5634, -0.1439], greenCenter: [38.56, -0.139], green: null, hazards: [{ kind: 'bunker', poly: [[38.5606, -0.1414]] }] });
    expect(b.minLat).toBeLessThan(38.56);
    expect(b.maxLat).toBeGreaterThan(38.5634);
    expect(b.minLng).toBeLessThan(-0.1439);
    expect(b.maxLng).toBeGreaterThan(-0.139);
  });
  it('returns null with no usable points', () => {
    expect(holeBbox({ tee: null, greenCenter: null, green: null, hazards: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/tileMath.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/tileMath.js
// Web-Mercator (OSM/Esri slippy-map) tile arithmetic — pure functions.

export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}

// Every {z,x,y} covering the bbox at each requested zoom, deduped.
export function tilesForBbox({ minLat, maxLat, minLng, maxLng }, zooms) {
  const seen = new Set();
  const out = [];
  for (const z of zooms) {
    const x0 = lonToTileX(minLng, z), x1 = lonToTileX(maxLng, z);
    const y0 = latToTileY(maxLat, z), y1 = latToTileY(minLat, z); // y grows southward
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        const k = `${z}/${x}/${y}`;
        if (!seen.has(k)) { seen.add(k); out.push({ z, x, y }); }
      }
    }
  }
  return out;
}

// Padded bbox around one hole's mapped features. padMeters converts via
// ~111320 m/deg latitude (longitude scaled by cos(lat)).
export function holeBbox({ tee, greenCenter, green, hazards }, padMeters = 80) {
  const pts = [];
  const push = (p) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(p); };
  push(tee); push(greenCenter);
  (green || []).forEach(push);
  (hazards || []).forEach((h) => (h.poly || []).forEach(push));
  if (!pts.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of pts) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln);
  }
  const dLat = padMeters / 111320;
  const dLng = padMeters / (111320 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)));
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/tileMath.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tileMath.js src/lib/__tests__/tileMath.test.js
git commit -m "feat(tiles): slippy-map tile math helpers"
```

---

### Task 8: `tileCache` store (per-course buckets, cap, negative cache)

**Files:**
- Create: `src/store/tileCache.js`
- Test: `src/store/__tests__/tileCache.test.js`

**Interfaces:**
- Consumes: AsyncStorage; platform storage (injectable adapter).
- Produces (consumed by Tasks 9–11):
  - `getTileDataUrl({ z, x, y, bucket }) → Promise<string|null>` — data URL or null (offline/missing).
  - `ensureTile({ z, x, y, bucket }) → Promise<boolean>` — cached or newly fetched (prefetch path).
  - `deleteBucket(bucket) → Promise<void>`
  - `courseKeyFor(courseName) → string` (lowercased, non-alphanumerics → `-`)
  - Constants: `TILE_URL(z,x,y)`, `MAX_CACHE_BYTES = 150 * 1024 * 1024`
  - Test seams: `_setAdapterForTests(adapter)`, `_resetForTests()`

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/tileCache.test.js
import {
  getTileDataUrl, deleteBucket, courseKeyFor,
  _setAdapterForTests, _resetForTests,
} from '../tileCache';

export function fakeAdapter() {
  const store = new Map(); // 'bucket|z/x/y' -> dataUrl
  return {
    store,
    async get(bucket, key) { return store.get(`${bucket}|${key}`) ?? null; },
    async put(bucket, key, dataUrl) { store.set(`${bucket}|${key}`, dataUrl); return dataUrl.length; },
    async deleteBucket(bucket) { [...store.keys()].filter((k) => k.startsWith(`${bucket}|`)).forEach((k) => store.delete(k)); },
  };
}

describe('tileCache', () => {
  let adapter;
  beforeEach(() => {
    adapter = fakeAdapter();
    _resetForTests();
    _setAdapterForTests(adapter);
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([120]).buffer }));
  });

  it('courseKeyFor normalizes names', () => {
    expect(courseKeyFor('Villaitana Levante')).toBe('villaitana-levante');
  });

  it('serves a local hit without fetching', async () => {
    adapter.store.set('_browse|15/16371/12683', 'data:image/jpeg;base64,AAA');
    const d = await getTileDataUrl({ z: 15, x: 16371, y: 12683, bucket: '_browse' });
    expect(d).toBe('data:image/jpeg;base64,AAA');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches, stores, and returns on miss', async () => {
    const d = await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/tile/15/2/1'); // z/y/x order!
    expect(d).toMatch(/^data:image\/jpeg;base64,/);
    expect(await adapter.get('c1', '15/1/2')).toBe(d);
  });

  it('negative-caches failures for the session', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' })).toBeNull();
    expect(await getTileDataUrl({ z: 15, x: 1, y: 2, bucket: 'c1' })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deleteBucket clears only that bucket', async () => {
    adapter.store.set('c1|15/1/2', 'data:a');
    adapter.store.set('c2|15/1/2', 'data:b');
    await deleteBucket('c1');
    expect(await adapter.get('c1', '15/1/2')).toBeNull();
    expect(await adapter.get('c2', '15/1/2')).toBe('data:b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/tileCache.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/store/tileCache.js
// Per-course satellite tile cache. Buckets keep deletion/eviction simple:
// one bucket per course (courseKeyFor), plus '_browse' for tiles fetched
// outside any prefetch. Best-effort by design — every failure path returns
// null and the flyover's vector layer covers for missing imagery.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const TILE_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const MAX_CACHE_BYTES = 150 * 1024 * 1024;
const INDEX_KEY = 'tileCacheIndex.v1'; // { buckets: { [bucket]: { bytes, lastUsed } } }

export function courseKeyFor(courseName) {
  return String(courseName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '_unknown';
}

// ---------- storage adapters ----------
function makeWebAdapter() {
  const cacheName = (bucket) => `tiles:${bucket}`;
  const req = (key) => `https://tiles.local/${key}`; // synthetic Request key
  return {
    async get(bucket, key) {
      try {
        const c = await caches.open(cacheName(bucket));
        const r = await c.match(req(key));
        return r ? await r.text() : null; // stored as data-URL text
      } catch { return null; }
    },
    async put(bucket, key, dataUrl) {
      try {
        const c = await caches.open(cacheName(bucket));
        await c.put(req(key), new Response(dataUrl));
        return dataUrl.length;
      } catch { return 0; }
    },
    async deleteBucket(bucket) {
      try { await caches.delete(cacheName(bucket)); } catch { /* best effort */ }
    },
  };
}

function makeNativeAdapter() {
  // Lazy require keeps web bundles clean; legacy API for a stable surface.
  const FileSystem = require('expo-file-system/legacy');
  const dir = (bucket) => `${FileSystem.documentDirectory}tiles/${bucket}/`;
  const path = (bucket, key) => `${dir(bucket)}${key.replace(/\//g, '_')}.txt`;
  return {
    async get(bucket, key) {
      try { return await FileSystem.readAsStringAsync(path(bucket, key)); } catch { return null; }
    },
    async put(bucket, key, dataUrl) {
      try {
        await FileSystem.makeDirectoryAsync(dir(bucket), { intermediates: true }).catch(() => {});
        await FileSystem.writeAsStringAsync(path(bucket, key), dataUrl);
        return dataUrl.length;
      } catch { return 0; }
    },
    async deleteBucket(bucket) {
      try { await FileSystem.deleteAsync(dir(bucket), { idempotent: true }); } catch { /* best effort */ }
    },
  };
}

let adapter = null;
function getAdapter() {
  if (!adapter) adapter = Platform.OS === 'web' ? makeWebAdapter() : makeNativeAdapter();
  return adapter;
}

// ---------- index (sizes + recency for eviction) ----------
let indexCache = null;
async function loadIndex() {
  if (indexCache) return indexCache;
  try { indexCache = JSON.parse(await AsyncStorage.getItem(INDEX_KEY)) || { buckets: {} }; }
  catch { indexCache = { buckets: {} }; }
  if (!indexCache.buckets) indexCache.buckets = {};
  return indexCache;
}
async function saveIndex() {
  try { await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(indexCache)); } catch { /* best effort */ }
}
async function touchBucket(bucket, addBytes) {
  const idx = await loadIndex();
  const b = idx.buckets[bucket] || (idx.buckets[bucket] = { bytes: 0, lastUsed: 0 });
  b.bytes += addBytes;
  b.lastUsed = Date.now();
  await saveIndex();
  if (addBytes > 0) await maybeEvict(bucket);
}
async function maybeEvict(keepBucket) {
  const idx = await loadIndex();
  let total = Object.values(idx.buckets).reduce((s, b) => s + b.bytes, 0);
  if (total <= MAX_CACHE_BYTES) return;
  // '_browse' goes first, then least-recently-used courses; never evict the
  // bucket currently being written.
  const order = Object.keys(idx.buckets).filter((k) => k !== keepBucket).sort((a, b) => {
    if (a === '_browse') return -1;
    if (b === '_browse') return 1;
    return idx.buckets[a].lastUsed - idx.buckets[b].lastUsed;
  });
  for (const bucket of order) {
    if (total <= MAX_CACHE_BYTES) break;
    total -= idx.buckets[bucket].bytes;
    await getAdapter().deleteBucket(bucket);
    delete idx.buckets[bucket];
  }
  await saveIndex();
}

// ---------- fetch + encode ----------
const failedThisSession = new Set(); // 'z/x/y' — no retry storms while offline
async function fetchTileDataUrl(z, x, y) {
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`tile ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = typeof btoa === 'function' ? btoa(bin) : global.Buffer.from(bin, 'binary').toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}

// ---------- public API ----------
export async function getTileDataUrl({ z, x, y, bucket = '_browse' }) {
  const key = `${z}/${x}/${y}`;
  const hit = await getAdapter().get(bucket, key);
  if (hit) { touchBucket(bucket, 0); return hit; }
  if (failedThisSession.has(key)) return null;
  try {
    const dataUrl = await fetchTileDataUrl(z, x, y);
    const bytes = await getAdapter().put(bucket, key, dataUrl);
    await touchBucket(bucket, bytes);
    return dataUrl;
  } catch {
    failedThisSession.add(key);
    return null;
  }
}

export async function ensureTile({ z, x, y, bucket }) {
  return (await getTileDataUrl({ z, x, y, bucket })) != null;
}

export async function deleteBucket(bucket) {
  await getAdapter().deleteBucket(bucket);
  const idx = await loadIndex();
  delete idx.buckets[bucket];
  await saveIndex();
}

// ---------- test seams ----------
export function _setAdapterForTests(a) { adapter = a; }
export function _resetForTests() {
  adapter = null;
  indexCache = null;
  failedThisSession.clear();
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/store/__tests__/tileCache.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tileCache.js src/store/__tests__/tileCache.test.js
git commit -m "feat(tiles): per-course tile cache with cap, eviction and negative cache"
```

---

### Task 9: Prefetch (`prefetchCourseTiles`) + progress state

**Files:**
- Modify: `src/store/tileCache.js`
- Test: `src/store/__tests__/tileCache.test.js` (extend)

**Interfaces:**
- Consumes: `findCourseGeometry` (`src/lib/geo.js`), `holeBbox` / `tilesForBbox` (Task 7), `ensureTile` (Task 8).
- Produces (consumed by Tasks 10–11): `prefetchCourseTiles(courseName, { force } = {}) → Promise<{total,done}|null>`, `getPrefetchState() → {courseKey,total,done,running}|null`, `subscribePrefetch(cb) → unsub`, `PREFETCH_ZOOMS = [15,16,17,18,19]`, `estimateTileBytes(count)` (~20 KB/tile).

- [ ] **Step 1: Extend the test**

```js
import {
  prefetchCourseTiles, getPrefetchState, subscribePrefetch,
} from '../tileCache';
import * as geo from '../../lib/geo';

describe('prefetchCourseTiles', () => {
  beforeEach(() => {
    _resetForTests();
    _setAdapterForTests(fakeAdapter());
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns null for a course without geometry', async () => {
    jest.spyOn(geo, 'findCourseGeometry').mockReturnValue(null);
    expect(await prefetchCourseTiles('Nowhere')).toBeNull();
  });

  it('downloads deduped tiles for every mapped hole and reports progress', async () => {
    jest.spyOn(geo, 'findCourseGeometry').mockReturnValue({
      name: 'Tiny', mode: 'holes',
      holes: [
        { number: 1, greenCenter: [38.56, -0.139], start: [38.5634, -0.1439], green: null, hazards: [] },
        { number: 2, greenCenter: [38.56, -0.139], start: [38.5634, -0.1439], green: null, hazards: [] }, // same bbox → dedupe
      ],
    });
    const seen = [];
    const unsub = subscribePrefetch(() => seen.push({ ...getPrefetchState() }));
    const r = await prefetchCourseTiles('Tiny');
    unsub();
    expect(r.total).toBeGreaterThan(0);
    expect(r.done).toBe(r.total);
    expect(global.fetch).toHaveBeenCalledTimes(r.total); // dedupe: identical holes add nothing
    expect(seen[seen.length - 1].running).toBe(false);
  });

  it('skips already-cached tiles instantly (resumable)', async () => {
    jest.spyOn(geo, 'findCourseGeometry').mockReturnValue({
      name: 'Tiny', mode: 'holes',
      holes: [{ number: 1, greenCenter: [38.56, -0.139], start: [38.5634, -0.1439], green: null, hazards: [] }],
    });
    const first = await prefetchCourseTiles('Tiny');
    global.fetch.mockClear();
    const second = await prefetchCourseTiles('Tiny', { force: true });
    expect(second.total).toBe(first.total);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

(`fakeAdapter` is exported from the first describe's module scope — keep it a top-level function in the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/tileCache.test.js`
Expected: FAIL — `prefetchCourseTiles is not a function`.

- [ ] **Step 3: Implement in `tileCache.js`**

```js
import { findCourseGeometry } from '../lib/geo';
import { holeBbox, tilesForBbox } from '../lib/tileMath';

export const PREFETCH_ZOOMS = [15, 16, 17, 18, 19];
export function estimateTileBytes(count) { return count * 20 * 1024; }

let prefetchState = null; // { courseKey, total, done, running }
const prefetchListeners = new Set();
export function getPrefetchState() { return prefetchState; }
export function subscribePrefetch(cb) { prefetchListeners.add(cb); return () => prefetchListeners.delete(cb); }
function emitPrefetch(next) {
  prefetchState = next;
  prefetchListeners.forEach((cb) => { try { cb(); } catch { /* listener error */ } });
}

const prefetchedThisSession = new Set(); // courseKey — auto trigger fires once

// Download every tile covering the course's mapped holes (zooms 15–19,
// deduped, 4 at a time). Resumable: cached tiles resolve instantly.
export async function prefetchCourseTiles(courseName, { force = false } = {}) {
  const geometry = findCourseGeometry(courseName);
  if (!geometry?.holes?.length) return null;
  const courseKey = courseKeyFor(courseName);
  if (!force && prefetchedThisSession.has(courseKey)) return null;
  if (prefetchState?.running) return null; // one prefetch at a time
  prefetchedThisSession.add(courseKey);

  const tiles = [];
  const seen = new Set();
  for (const hole of geometry.holes) {
    const bbox = holeBbox({ tee: hole.start, greenCenter: hole.greenCenter, green: hole.green, hazards: hole.hazards });
    if (!bbox) continue;
    for (const t of tilesForBbox(bbox, PREFETCH_ZOOMS)) {
      const k = `${t.z}/${t.x}/${t.y}`;
      if (!seen.has(k)) { seen.add(k); tiles.push(t); }
    }
  }
  if (!tiles.length) return null;

  let done = 0;
  emitPrefetch({ courseKey, total: tiles.length, done, running: true });
  const queue = tiles.slice();
  const worker = async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      await ensureTile({ z: t.z, x: t.x, y: t.y, bucket: courseKey });
      done += 1;
      emitPrefetch({ courseKey, total: tiles.length, done, running: true });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  emitPrefetch({ courseKey, total: tiles.length, done, running: false });
  return { total: tiles.length, done };
}
```

Also add `prefetchedThisSession.clear(); prefetchState = null;` to `_resetForTests()`.

- [ ] **Step 4: Run tests**

Run: `npx jest src/store/__tests__/tileCache.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tileCache.js src/store/__tests__/tileCache.test.js
git commit -m "feat(tiles): course prefetch with progress + session dedupe"
```

---

### Task 10: Tile bridge — page GridLayer + host responder

**Files:**
- Modify: `src/lib/holeMapHtml.js` (replace `L.tileLayer` with a bridged GridLayer + handle `tile-data`)
- Modify: `src/components/scorecard/HoleMapView.web.js`, `src/components/scorecard/HoleMapView.native.js` (answer `tile` messages)
- Modify: `src/components/scorecard/HoleFlyover.js`, `src/components/scorecard/HoleGeoEditor.js` (add `courseKey` to `data`)
- Test: `src/lib/__tests__/holeMapHtml.test.js` (extend)

**Interfaces:**
- Consumes: `getTileDataUrl`, `courseKeyFor` (Task 8).
- Produces: message contract `page → host: { type:'tile', z, x, y, id }`, `host → page: { type:'tile-data', id, dataUrl|null }`; `data.courseKey` field.

- [ ] **Step 1: Extend the test**

```js
  it('uses the bridged tile layer, not a direct Esri tileLayer', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('server.arcgisonline.com');
    expect(html).toContain("type:'tile'");
  });
```

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js` — expected FAIL.

- [ ] **Step 2: Page side — replace the tile layer**

In `holeMapHtml.js`, replace `L.tileLayer('https://server.arcgisonline.com/…').addTo(map);` with:

```js
// Tiles come from the host (cache-first, offline-aware) over postMessage.
// A tile with no answer stays transparent — the vector layer shows through.
let tileSeq = 0;
const pendingTiles = {};
const BridgedTiles = L.GridLayer.extend({
  createTile: function (coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    const id = 't' + (tileSeq++);
    pendingTiles[id] = (dataUrl) => {
      if (dataUrl) { img.onload = () => done(null, img); img.onerror = () => done(null, img); img.src = dataUrl; }
      else done(null, img);
    };
    post({ type:'tile', z: coords.z, x: coords.x, y: coords.y, id });
    return img;
  },
});
new BridgedTiles({ maxZoom: 20, maxNativeZoom: 19 }).addTo(map);
```

And in the page's message handler add:

```js
  if (m.type === 'tile-data') {
    const cb = pendingTiles[m.id];
    delete pendingTiles[m.id];
    if (cb) cb(m.dataUrl || null);
  }
```

- [ ] **Step 3: Host side — answer tile requests in both HoleMapViews**

`HoleMapView.web.js` — extend the message-listener effect:

```js
import { getTileDataUrl } from '../../store/tileCache';
// inside the component:
  const bucket = data.courseKey || '_browse';
  useEffect(() => {
    const h = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'point') onPoint?.(m.field, m.pos, m.drag);
      if (m.type === 'tile') {
        getTileDataUrl({ z: m.z, x: m.x, y: m.y, bucket })
          .then((dataUrl) => send({ type: 'tile-data', id: m.id, dataUrl }));
      }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onPoint, bucket]);
```

`HoleMapView.native.js` — same logic inside `onMessage`:

```js
import { getTileDataUrl } from '../../store/tileCache';
// in onMessage after the 'point' branch:
        if (m.type === 'tile') {
          getTileDataUrl({ z: m.z, x: m.x, y: m.y, bucket: data.courseKey || '_browse' })
            .then((dataUrl) => send({ type: 'tile-data', id: m.id, dataUrl }));
        }
```

- [ ] **Step 4: Tag the bucket at both call sites**

`HoleFlyover.js` `data` useMemo gains `courseKey: courseKeyFor(courseName),` (import from `../../store/tileCache`). Do the same in `HoleGeoEditor.js` where it builds its `data` object (add `courseKey` alongside its `holeKey`).

- [ ] **Step 5: Run tests + manual checks**

Run: `npx jest src/lib/__tests__/holeMapHtml.test.js && npm test && npm run lint` — PASS.
Web manual: flyover shows satellite imagery (requests now come from the app origin, none from the iframe to arcgisonline — check DevTools Network). Offline + cached course: imagery renders. Offline + uncached: dark vector-only page, distances all work.

- [ ] **Step 6: Commit**

```bash
git add src/lib/holeMapHtml.js src/lib/__tests__/holeMapHtml.test.js src/components/scorecard/HoleMapView.web.js src/components/scorecard/HoleMapView.native.js src/components/scorecard/HoleFlyover.js src/components/scorecard/HoleGeoEditor.js
git commit -m "feat(tiles): postMessage tile bridge — cache-first imagery with vector fallback"
```

---

### Task 11: Prefetch triggers — auto on round + manual course download row

**Files:**
- Modify: `src/components/scorecard/HoleView.js` (auto trigger)
- Modify: `src/screens/CourseLibraryDetailScreen.js` (manual row)
- Test: none new (store logic covered in Tasks 8–9; screen wiring verified manually, matching this repo's screen-testing practice)

**Interfaces:**
- Consumes: `prefetchCourseTiles`, `getPrefetchState`, `subscribePrefetch`, `deleteBucket`, `courseKeyFor`, `estimateTileBytes`, `PREFETCH_ZOOMS` (Tasks 8–9); `holeBbox`, `tilesForBbox` (Task 7); `@react-native-community/netinfo` (already a dependency).

- [ ] **Step 1: Auto trigger in `HoleView.js`**

Below the existing `const gps = useGpsDistances(...)` line add:

```js
  // Best-effort offline prep: when this round's course has geometry, prefetch
  // its satellite tiles once per course per session — Wi-Fi only. Failures are
  // silent; the flyover falls back to vectors.
  useEffect(() => {
    if (!gps.available) return undefined;
    let cancelled = false;
    NetInfo.fetch().then((state) => {
      if (cancelled || state.type !== 'wifi') return;
      prefetchCourseTiles(round.courseName).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [gps.available, round.courseName]);
```

Imports: `import NetInfo from '@react-native-community/netinfo';` and `import { prefetchCourseTiles } from '../../store/tileCache';`. (`prefetchCourseTiles` dedupes per session and serializes runs, so this effect can fire repeatedly without harm.)

- [ ] **Step 2: Manual row in `CourseLibraryDetailScreen.js`**

Read the screen first and follow its exact section/row styling. Add an "Offline map" section, visible only when `findCourseGeometry(course.name)` returns a course with `holes`. Behavior code (adapt the JSX wrappers to the screen's patterns):

```js
import { useSyncExternalStore, useMemo, useCallback } from 'react';
import {
  prefetchCourseTiles, getPrefetchState, subscribePrefetch,
  deleteBucket, courseKeyFor, estimateTileBytes, PREFETCH_ZOOMS,
} from '../store/tileCache';
import { findCourseGeometry } from '../lib/geo';
import { holeBbox, tilesForBbox } from '../lib/tileMath';

// inside the component:
const prefetch = useSyncExternalStore(subscribePrefetch, getPrefetchState);
const geometry = findCourseGeometry(course.name);
const tileCount = useMemo(() => {
  if (!geometry?.holes?.length) return 0;
  const seen = new Set();
  for (const h of geometry.holes) {
    const b = holeBbox({ tee: h.start, greenCenter: h.greenCenter, green: h.green, hazards: h.hazards });
    if (b) tilesForBbox(b, PREFETCH_ZOOMS).forEach((t) => seen.add(`${t.z}/${t.x}/${t.y}`));
  }
  return seen.size;
}, [geometry]);
const sizeMb = (estimateTileBytes(tileCount) / (1024 * 1024)).toFixed(0);
const mine = prefetch?.courseKey === courseKeyFor(course.name);
const busy = mine && prefetch.running;
const onDownload = useCallback(() => { prefetchCourseTiles(course.name, { force: true }).catch(() => {}); }, [course.name]);
const onDelete = useCallback(() => { deleteBucket(courseKeyFor(course.name)).catch(() => {}); }, [course.name]);
```

Row content: title "Offline map"; subtitle `~${sizeMb} MB satellite imagery`; a Download button labeled `busy ? \`Downloading ${prefetch.done}/${prefetch.total}\` : 'Download'`, disabled while busy; a small "Delete" text button calling `onDelete`. Use the screen's existing row/button styles — no new design language.

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint` — green.
Web manual: course detail shows the row with a plausible size (~30–60 MB for an 18-hole course); Download runs with live progress; flyover then works with DevTools offline.

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/HoleView.js src/screens/CourseLibraryDetailScreen.js
git commit -m "feat(tiles): auto prefetch on round (wifi) + manual course download row"
```

---

### Task 12: Final verification sweep

- [ ] **Step 1: Full quality gates**

```bash
npm test && npm run lint
```

Expected: everything green.

- [ ] **Step 2: End-to-end web verification** (use the project's `verify` skill / Playwright)

Checklist:
1. Open a geometry course round → GPS strip → flyover: tee-up framing, two-leg line, chips, drag + tap, unified cluster.
2. Simulated far position (or no GPS permission): tee-anchored line + "measuring from the tee" pill.
3. DevTools offline, previously viewed course: map boots, imagery from cache.
4. DevTools offline, fresh course: vector-only page, distances all functional.
5. Course detail: download row progress + delete.
6. Geometry editor still works (tap-to-place, markers, tiles).

- [ ] **Step 3: Hand off**

Follow superpowers:finishing-a-development-branch (standing choice: merge + push).

---

## Self-Review Notes (already applied)

- Spec coverage: anchor rule → T1/T2; chips/tap → T2; framing → T3; HUD → T4; dead code → T5; vendored libs → T6; tile math → T7; cache/eviction → T8; prefetch/progress → T9; bridge + vector fallback → T10; triggers/UI → T11; testing strategy → per-task + T12.
- The old `.chip` CSS and the `🎯` HUD line are removed in T2; T4's `📍` pill does not conflict with T2's `🎯`-specific assertion.
- Type consistency: `{pos, source, playerDistance}` is identical in HoleFlyover, the player message, and the page; bucket key format `z/x/y` matches between adapter tests and implementation; `data.courseKey` is read with a `'_browse'` fallback everywhere; `redrawLines(from, g, cc)` signature is consistent across T2's call sites.
