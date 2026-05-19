# Populate Madrid Courses from the Madrid Golf Federation

**Date:** 2026-05-19
**Status:** Approved — ready for implementation plan

## Goal

Populate the app's course library with real Madrid golf course data — per-hole
par and stroke index, per-tee distances, course rating and slope — sourced from
the Real Federación de Golf de Madrid website (`fedgolfmadrid.com`).

This is a **one-time populate**, run from a developer machine. It is not an
in-app feature.

## Background

`GolfCourseAPI` (golfcourseapi.com) was evaluated and rejected: its dataset is
US-centric and contains no Spanish courses (verified against Valderrama, Finca
Cortesín, Sotogrande, etc. — all returned zero results).

`fedgolfmadrid.com` was found to expose clean JSON endpoints behind its
club-detail pages. No HTML scraping, no LLM extraction, and no API key are
required. This is the data source.

Scope for this spec is **Madrid only**. Other regions (Andalucía, rest of
Spain) are out of scope and would be separate efforts.

## Data Source

### Club list

`https://fedgolfmadrid.com/club/lista` lists ~29 golf courses (plus 7
practice-only facilities, which are excluded). Each course links to a detail
page `/club/<CODE>` where `<CODE>` looks like `CM01`, `CM52`, etc. One club
(Mistral Samaranch) uses the route `/cmd/CMD9` instead of `/club/...`.

The club codes are **hardcoded** in the fetch script (the list is small and
static). The current set, from the live page:

```
CM01 CM02 CM03 CM04 CM05 CM06 CM07 CM08 CM09 CM11 CM12 CM14 CM18 CM22
CM33 CM41 CM52 CM60 CM61 CM66 CM74 CM77 CM81 CM87 CMA5 CMA8 CMC8 CME9
```
plus the exception: `CMD9` via `/cmd/CMD9`.

### Trazados (courses within a club)

A club page contains a `<select id="trazados">` whose `<option>` elements give
the trazado id and name, e.g.:

```html
<option value="1068">LA HERRERIA - La Herreria</option>
<option value="1389">LA MORALEJA - Campo 1</option>
```

A club may expose several trazados. Some are distinct physical courses (La
Moraleja Campo 1–4); some are routing/tee combinations (Villa de Madrid
"A Negro + B Amarillo"). The fetch stage captures **all** of them; a human
review stage trims the combos before import.

### JSON endpoints

All are reached with the query parameter in the URL (not the POST body) and
the header `X-Requested-With: XMLHttpRequest`. GET works.

**Tees of a trazado:**
`GET /ajax/barras-trazado?trazado=<id>`
```json
[{"id":"BL","nombre":"Blancas","color":"basic grey"},
 {"id":"AM","nombre":"Amarillas","color":"yellow"}]
```

**Per-hole data for a tee:**
`GET /ajax/datos-trazado?barra=<barra>&trazado=<id>`
```json
{"m":{"metros":[402,415],"par":[4,4],"hcp":[3,1]},
 "f":{"metros":[402,415],"par":[4,4],"hcp":[3,1]}}
```
`par` and `hcp` are identical across tees and across sexes. `metros` is the
hole distance for that tee (same for `m`/`f`). Void holes on a 9-hole course
are marked `"A"` in the `par` array.

**Rating and slope for a tee:**
`GET /ajax/trazadobarra-valores?barra=<barra>&trazado=<id>&hoyos=3`
```json
{"m":{"slope":142,"campo":"71.2"},"f":{"slope":143,"campo":"77.7"}}
```
`campo` is the course rating ("valor de campo"). `slope` and `campo` differ by
sex. A sex with no rating returns `0`/empty.

## Target Schema

No migration is needed. The existing Supabase tables fit:

- `courses` — `name`, `city`, `province`
- `course_holes` — `course_id`, `number`, `par`, `stroke_index`
- `course_tees` — `course_id`, `label`, `rating`, `slope`, `sort_order`,
  `yardages` (jsonb map `{ holeNumber: distance }`)

par and stroke index live on `course_holes`, shared across tees — matching the
federation data, where they are tee-independent.

## Design

Three stages, mirroring `scripts/seedMarbellaCourses.js`.

### Stage 1 — `scripts/fetchMadridCourses.js`

Fetches all data from `fedgolfmadrid.com` and writes
`scripts/data/madrid-courses.json`.

Algorithm:
1. For each hardcoded club code: GET the club detail page, regex-parse the
   `#trazados` `<option>` values and texts.
2. For each trazado:
   - `barras-trazado` → list of tees (`barras`).
   - `datos-trazado` for the first tee → `par[]` and `hcp[]` (tee-independent).
   - For each tee: `datos-trazado` → `metros[]`; `trazadobarra-valores` →
     men's and women's `slope` + `campo`.
3. Build a trazado record (see Data Model below).
4. Write the whole set as pretty-printed JSON.

Behaviour:
- A small delay between HTTP requests (politeness).
- Re-runnable: overwrites the JSON file.
- Network failure on one club/trazado logs a warning and continues; it does not
  abort the whole run.

### Stage 2 — manual review

The developer opens `scripts/data/madrid-courses.json` and deletes the trazado
records that are routing combinations rather than real courses. Nothing reaches
the database without this review.

### Stage 3 — `scripts/importMadridCourses.js`

Reads `scripts/data/madrid-courses.json` and upserts into Supabase. Supports
`--dry-run` (prints planned changes, writes nothing).

Per course record:
- **Course name:** if the club has a single trazado, use the club name; if
  multiple, use `<Club> — <trazado short name>` (e.g. `La Moraleja — Campo 1`).
  HTML entities are decoded (`P&amp;P` → `P&P`).
- **`province`** = `'Madrid'`. `city` left null unless available.
- Match an existing `courses` row by `name`: if found, **enrich** it (keep the
  id, overwrite holes and tees); otherwise insert a new row.
- `course_holes`: delete-then-insert (`number`, `par`, `stroke_index`).
- `course_tees`: delete-then-insert. For each tee colour, create **up to two
  rows**:
  - men's: `label` = tee name (e.g. `Amarillas`), `rating` = men's `campo`,
    `slope` = men's `slope`.
  - women's: `label` = `<tee name> (Damas)`, `rating`/`slope` = women's values.
  - A sex's row is **skipped** when its `rating` and `slope` are both empty/0.
  - Both rows for a colour carry the same `yardages` map.
  - `sort_order` sequences tees longest-first by distance, men's before
    women's within a colour.

Validation:
- Stroke indices for an N-hole course must be exactly `1..N` with no
  duplicates. On failure: still import the course, log a loud warning, and list
  the flagged course in the run summary for manual fixing.
- Par total is sanity-checked (logged, not enforced).

The script prints a summary: courses inserted, courses enriched, tees written,
and any validation-flagged courses.

## Data Model — `madrid-courses.json`

```json
[
  {
    "clubCode": "CM05",
    "clubName": "Real Club de Golf La Herreria",
    "trazadoId": "1068",
    "trazadoName": "La Herreria",
    "holeCount": 18,
    "holes": [
      { "number": 1, "par": 4, "strokeIndex": 3 }
    ],
    "tees": [
      {
        "barra": "AM",
        "name": "Amarillas",
        "color": "yellow",
        "distances": { "1": 402, "2": 415 },
        "men":   { "rating": 71.2, "slope": 142 },
        "women": { "rating": 77.7, "slope": 143 }
      }
    ]
  }
]
```

## Edge Cases

- **9-hole courses:** keep only holes whose `par` is numeric (drop `"A"`).
  `holeCount` reflects the real count; validation uses `1..holeCount`.
- **Tee with one sex only:** create only the row(s) for the sex that has a
  rating/slope.
- **Trazado with no tees:** skip the trazado, log a warning.
- **Missing rating/slope entirely:** `course_tees` rows still created from
  distances, with `rating`/`slope` null (the app tolerates null).
- **Distance unit:** values are **metres**. Stored as-is in
  `course_tees.yardages` — the column name says "yardages" but is treated as a
  unit-agnostic distance map; Spanish courses are metric.

## Testing

Pure helper functions are extracted into a testable module and unit-tested with
Jest (matching the repo pattern; `seedMarbellaCourses.js` has a `validate`
helper):

- `parseTrazadoOptions(html)` — extracts `[{ id, text }]` from a club page.
- `buildHoles(par[], hcp[])` — builds the hole list, dropping `"A"` void holes.
- `deriveCourseName(clubName, trazadoName, trazadoCount)` — name derivation,
  including HTML-entity decoding.
- `buildTeeRows(barra, distances, men, women)` — produces the one or two
  `course_tees` rows, with the skip-empty-sex rule.
- `validateStrokeIndex(holes)` — the `1..N` exact-set check.

Network calls and Supabase writes are **not** unit-tested (one-shot scripts),
consistent with `seedMarbellaCourses.js`.

## Out of Scope

- Andalucía and the rest of Spain.
- An in-app course-import feature.
- Backfilling course rating/slope for courses where the federation has none.
- Any change to how the app reads or displays courses.

## Prerequisites

- `.env` already provides `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` (used by `seedMarbellaCourses.js`). No new
  credentials are needed.
