# Aim tips — where to aim on this hole, from your own misses (sub-project C)

**Date:** 2026-10-18
**Status:** Design agreed in conversation ("text tip on every course"); UI canvas https://claude.ai/artifact/DxFsNFhB23U4QFrK3EGyzg pending review before merge
**Scope:** a new pure store module (`src/store/aimTip.js`), stats already computed in `src/store/statsEngine.js` / `personalStats.js`, course geometry helpers (`src/lib/geo.js`), the live scorecard hole view (`src/components/scorecard/HolePage.js` / `HoleView.js`), Settings → Stats tracking. JS only, OTA. No migration, no network.
**Builds on:** coach strategy `missSideRule` (`src/store/coachStrategy.js`), miss reasons (A) and round focus (B).

---

## 1. Problem

The coach can say "you miss right from 100–150 m" on the Coach tab, but on the course nothing turns that into a decision on *this* hole. The biggest quick gain for amateurs is aiming to their own miss pattern and away from trouble — no swing change needed.

## 2. Design

### 2.1 `aimTip(input)` — pure

```
aimTip({
  shot: 'tee' | 'approach',
  par, bucket,                 // approach distance bucket or null (pooled)
  stats,                       // personal stats (approachMissByDistance, approachMissTendency, driveImpact / drive side counts)
  hazards,                     // [{ kind: 'water'|'bunker', side: 'left'|'right'|'centre', reach }] or [] (unmapped)
  handedness,                  // display only
}) → null | {
  shot, kind: 'side' | 'club',
  miss: 'left'|'right'|'short'|'long',
  aim: 'left-half'|'right-half'|'middle'|'left-edge'|'right-edge'|'club-up'|'club-down',
  evidence: { count, total, scope: 'bucket'|'all' },
  hazard: { kind, side } | null,
  msg, detail                  // descriptors
}
```

Rules:
- **Approach side bias:** in the bucket's row (`approachMissByDistance`) when its direction-known misses ≥ `AIM_MIN.bucketMisses` (8), else the pooled `approachMissTendency` when ≥ `AIM_MIN.pooledMisses` (10). A side wins when its count ≥ 2× the other side (same bar as `missSideRule`) → `aim` = the opposite half (`left-half` for a right miss).
- **Approach length bias:** if short ≥ 2× long and short is the largest direction → `club-up`; long ≥ 2× short and largest → `club-down`. When both a side and a length bias exist, the larger share wins (one tip, never two).
- **Tee side bias (par ≥ 4):** drive left vs right misses (holes, from `stats.driveImpact.buckets`) with ≥ `AIM_MIN.driveMisses` (10) and one side ≥ 2× → `left-edge` / `right-edge` of the fairway.
- **Hazards (mapped courses):**
  - Approach: hazards within 30 m of the green (`golf_hazard` water/bunker), side from the line *player position → green centre* when a GPS fix exists, else *tee start → green centre* (bearing cross-product).
  - Tee: hazards ahead whose reach is within the player's typical drive distance ± 30 m, side from tee → green line.
  - **On the miss side** → the tip names it: "· water right of this green".
  - **On the aim side** (the miss is right, water is left) → `aim: 'middle'` ("aim at the middle — water left").
  - Water outranks bunker; if both sides have water, `middle`.
- **No bias → `null`** (no tip). Unmapped course → same tip without the hazard clause.

### 2.2 Distance bucket

Approach bucket from, in order: the live GPS distance to the green centre (`gps.distances.center`, same feed the hole header shows), the hole's own `approachBucket` if the golfer already set it (par 3 "Hole distance"), else `null` → pooled.

### 2.3 Where it shows

An **aim tip card under the hole header**, above the player cards, only when the signed-in owner plays this round and is on the live (editable) scorecard:
- Par 4/5: the **tee tip until the owner's drive is recorded**, then the **approach tip**. Par 3: the approach tip.
- Copy: headline ("Aim at the left half of the green" / "Take one more club" / "Aim at the left edge of the fairway") + detail ("Your 100–150 m misses go right (7 of 10) · water right of this green").
- Same visual family as the focus strip (accent-light card, icon), so the two read as one coaching system; the aim tip uses a crosshair icon.
- Hidden when Settings → Stats tracking → **Aim tips** is off (new boolean setting, default on), in scramble formats (one ball per team), and in read-only views.

### 2.4 Hazard side helper

`lib/geo.js` gains `hazardSide(hazard, from, to)` → `'left'|'right'|'centre'` via the sign of the cross product of (to − from) × (hazard centroid − from), with a ±5 m centre band. Built on existing `holeFeatures` / `holeHazardDistances` data; `courseGeometryStore` / `useCourseGeometry` already load the hole's hazards on demand.

### 2.5 Out of scope

A suggested aim ring on the map, lateral spread in metres (needs the aim point stored with GPS shots), fairway / OB / trees, per-club tee tips (no per-club side data), multi-player tips.

## 3. PRs

| PR | Content |
|---|---|
| **C1** | `aimTip.js` + `hazardSide` + `aimTips` setting + copy; tests |
| **C2** | Aim tip card in the hole view (bucket from GPS / hole entry, tee→approach switch, owner-only, setting) |

UI (C2) follows the approved canvas; nothing merges before the owner approves it.

## 4. Testing

- `aimTip.test.js`: side bias per bucket vs pooled fallback, thresholds (8 / 10 / 2×), length bias club up/down, side vs length tie-break, tee bias, hazard on miss side named, hazard on aim side → middle, both sides water → middle, no bias → null, unmapped → no clause.
- `geo.test.js`: `hazardSide` left/right/centre band.
- Hole view tests: card for the owner only, tee→approach switch after the drive, par 3, setting off, scramble, read-only.
- Web walkthrough: mapped course with water (an OSM course), unmapped course, light/dark, ES.
