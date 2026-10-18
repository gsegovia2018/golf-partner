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

### 2.2 Expected approach distance

The golfer enters the hole's data **after** the hole (walking to the next tee), so live GPS can't pick the bucket and "tee tip until the drive is recorded" never helps (owner, 2026-10-18). The approach line uses the **expected** approach distance: the hole's length minus the golfer's average drive (par 4/5), the hole's length on a par 3, mapped to the approach buckets; no hole length → pooled.

### 2.3 Where it shows — the hole briefing (owner-approved 2026-10-18)

A **briefing card under the hole header, shown when you arrive at the hole** (the page you land on after "Hole N ›"), above the player cards, owner only:
- **Off the tee** line (par 4/5) and **Approach** line (with "~130 m" from §2.2), each only when its miss pattern clears the bar; no line qualifies → no card.
- Each line: label, headline ("Aim at the left edge" / "Aim at the left half" / "Take one more club"), evidence ("Your drives miss right (12 of 17)"), hazard clause on mapped courses ("· bunker right at 210 m", "· water right of the green").
- **Collapses to a one-line summary once the owner's score for that hole is entered**, so a finished hole reads as history.
- Same visual family as the focus strip (accent-light, crosshair icon). Hidden when Settings → Stats tracking → **Aim tips** is off, in scramble formats and read-only views.

### 2.4 Hazard side helper

`lib/geo.js` gains `hazardSide(hazard, from, to)` → `'left'|'right'|'centre'` via the sign of the cross product of (to − from) × (hazard centroid − from), with a ±5 m centre band. Built on existing `holeFeatures` / `holeHazardDistances` data; `courseGeometryStore` / `useCourseGeometry` already load the hole's hazards on demand.

### 2.5 Out of scope

A suggested aim ring on the map, lateral spread in metres (needs the aim point stored with GPS shots), fairway / OB / trees, per-club tee tips (no per-club side data), multi-player tips.

## 3. PRs

| PR | Content |
|---|---|
| **C1** | `aimTip.js` + `hazardSide` + `aimTips` setting + copy; tests |
| **C2** | Hole briefing in the hole view (expected approach distance, tee + approach lines, collapse after the score, owner-only, setting) |

UI (C2) follows the approved canvas; nothing merges before the owner approves it.

## 4. Testing

- `aimTip.test.js`: side bias per bucket vs pooled fallback, thresholds (8 / 10 / 2×), length bias club up/down, side vs length tie-break, tee bias, hazard on miss side named, hazard on aim side → middle, both sides water → middle, no bias → null, unmapped → no clause.
- `geo.test.js`: `hazardSide` left/right/centre band.
- Hole view tests: briefing for the owner only, both lines / one line / none, expected approach bucket (hole length − average drive, par 3, no length → pooled), collapsed after the score, setting off, scramble, read-only.
- Web walkthrough: mapped course with water (an OSM course), unmapped course, light/dark, ES.
