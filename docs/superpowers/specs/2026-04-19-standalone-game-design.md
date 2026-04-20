# Standalone Game (single-round outing)

**Date:** 2026-04-19
**Status:** Draft — pending user review

## Problem

The app today only supports tournaments — multi-round weekend events. Players who want to record a casual round with friends (single course, single day, no overarching event) currently have to create a "tournament" of 1 round, give it a tournament name, and navigate UI built around multi-round leaderboards.

We want a first-class single-round outing — called **Game** in the UI — that reuses the existing scoring, stats, photos and sync infrastructure but with a streamlined create flow and a focused detail view.

## Non-goals

- New scoring rules. Stableford and best-ball math is unchanged.
- New backend tables. The Game persists in the existing `tournaments` table.
- Promoting a Game into a Tournament after the fact. Out of scope.
- Removing the "Round" terminology used inside the scorecard / stats. A Game internally has one round; the word "Round" still appears wherever it does today inside the round detail screens.
- Lifting the 4-player ceiling. Same 1–4 cap as today.

## Data model

Add an optional `kind` field to the tournament object:

```js
{
  id, name, createdAt, players, rounds, currentRound, settings,
  kind: 'tournament' | 'game'   // new — defaults to 'tournament' if absent
}
```

- A Game always has `rounds.length === 1` and `currentRound === 0`.
- The field is stored inside the JSON `data` blob — no schema migration. `kind` is set at creation by `createTournament(...)`.
- `loadAllTournaments` returns both kinds; consumers that care (Home) filter by `kind`. Consumers that don't (sync, scorecard, stats, gallery, members) treat them identically.
- Records that predate this feature have no `kind` and are treated as `'tournament'` by all UI filters.

`createTournament` accepts a `kind` arg; default `'tournament'` keeps existing call sites working.

## Setup flow

A single `SetupScreen` parameterised via `route.params.kind` (default `'tournament'`). Differences when `kind === 'game'`:

| Element | Tournament | Game |
|---|---|---|
| Header title | "New Tournament" | "New Game" |
| Name input default | "Weekend Golf" (editable) | Auto-prefilled, editable. While no course is set: `Game · {DD MMM}`. Once a course is selected: `Game at {Course} · {DD MMM}`. Auto-update stops the moment the user edits the field manually (tracked via a `nameTouched` flag) |
| Players | 1–4 | 1–4 (same) |
| Course/round section | "Rounds" header, list of N rounds, "Add Round" button, "Round N" labels, per-round remove | "Course" header, single course block, no add/remove |
| Best Ball tile | Always selectable | Disabled visual + subtitle "Requires 4 players" when `players.length !== 4`; auto-falls back to Stableford if user had selected best-ball and removes a player |
| CTA | "Start Tournament" | "Start Game" |

Implementation detail: Game mode hard-codes `rounds` state to a single-element array; the `addRound` / `removeRound` controls are not rendered. The auto-name lives in a tracked `nameTouched` boolean — once the user edits the name field, course/date changes no longer overwrite it.

## Home screen

The current top-of-list CTA row is `[New Tournament] [Join]`. Replace with two rows:

1. **Row 1, full-width:** `New Game` (primary, most common action) — navigates to `Setup` with `kind: 'game'`.
2. **Row 2, side-by-side:** `New Tournament` (primary styling, flex 1) and `Join` (secondary, unchanged) — `New Tournament` navigates to `Setup` with `kind: 'tournament'`.

The list below splits into two labelled sections:

- `GAMES` (when any exist) — kind === 'game'
- `TOURNAMENTS` (when any exist) — kind === 'tournament' OR no kind

Sort within each section by `id` desc (newest first), as today. Empty-state copy stays as today and shows when both lists are empty.

Tournament card today shows `Round X/N`. The Game card replaces that with just the course name (e.g. "Hartl Resort"), since "Round 1/1" is noise. Active / Finished status badge is unchanged. Viewer / delete affordances are unchanged.

The header subtitle currently reads "{N} tournament(s)". Update to "{N} game(s) · {M} tournament(s)" when at least one Game exists; otherwise keep the existing copy.

## Tournament detail screen (used for both kinds)

Inside `HomeScreen`'s tournament-detail render path, when the active tournament has `kind === 'game'`:

- Hide the rounds list / next-round chevrons (the section that maps `tournament.rounds`).
- Hide the tournament-wide leaderboard panel (the multi-round aggregate).
- Hide the "Next Round" CTA at the bottom.
- Render the single round's scorecard / leaderboard / pair view directly as the main content.

Stats screen and Gallery screen: no changes. They iterate `rounds[]` already and work correctly with one round.

## Scoring rules

No changes. `calcBestWorstBall` already returns `null` when fewer than 2 pairs of 2 are present, so per-hole and total panels render their normal "incomplete" state. The Setup-time Best Ball gate is purely cosmetic to set expectations.

## Migration

None. Records without `kind` are treated as `'tournament'`. New records carry `kind`.

## Sync

No changes. The sync worker round-trips the full JSON blob; the new field travels with it.

## Open questions

None outstanding — answered during brainstorming:

- Term in UI: **Game** (English, matches the rest of the UI).
- Entry point: **two stacked buttons** in Home.
- Name field: **optional, auto-prefilled, editable**.
- Player count: **1–4, odd allowed** (Stableford works for any count).
- Scoring: **both modes**, Best Ball UI-gated to exactly 4 players.
- Home list: **two labelled sections** in the same scroll.
