# CourseStats Shot Detail Accuracy — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming session)
**Follow-up to:** 2026-07-15-course-breakdown-design.md

## Problem

Three accuracy/readability issues in the CourseStats "Shot detail here" section,
surfaced by real data (Marcos @ Lomas-Bosque, verified on prod):

1. Drive distribution bars show raw counts; the user wants the percentage
   share of each drive result type.
2. The putts tile shows `shotStats.putts.perRound` = total putts ÷ rounds
   with any putt data. Partially-logged rounds (10 of 17 holes, a 4-hole
   game) deflate it: raw 24.6 vs the honest per-18 figure 30.3. The engine
   already computes the normalized figure (`putts.per18`).
3. The GIR tile's meaning is unclear — it is the percentage of *eligible
   logged holes pooled across all rounds at the course* (holes with both a
   score and putts logged), not a per-round average.

## Changes (all display-layer; no store math changes)

### 1. Drive distribution → pooled percentages
- `src/components/mystats/DistributionBars.js`: each bar accepts an optional
  `displayValue` (string) rendered in place of `count`; `count` still drives
  bar height and remains the fallback display. Fully backwards compatible.
- `src/screens/CourseStatsScreen.js`: drive bars pass
  `displayValue: `${Math.round((count / shots.drives.recorded) * 100)}%``
  per bucket; a caption line under the bars reads
  `"{shots.drives.recorded} drives logged"`.

### 2. Putts tile → per-18 normalization
- Tile value: `shots.putts.per18` (already `null` when no putt holes → '—'),
  caption `"putts / 18 holes"`. Replaces the raw `perRound` display.

### 3. GIR tile caption → explicit sample
- Caption becomes `"GIR · {shots.gir.eligible} holes"` (value unchanged).

## Testing
- New/extended component test for `DistributionBars`: `displayValue` renders
  when provided; `count` renders when not (fallback, existing callers safe).
- Existing course screen conventions otherwise (screens not unit-tested).

## Out of scope
- MyStats Breakdown tab's global "Putts / round" row (raw perRound with
  sample context) — unchanged unless requested.
- Penalties tile (raw pooled total) — unchanged.
