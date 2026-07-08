# Gender Profiles + Gendered Tee Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `gender` field to profiles and players (backfilled: everyone male except Claudia), collapse the duplicated "(Damas)" tee rows into women's rating columns, and resolve each player's effective tee rating/slope from their gender.

**Architecture:** Gender lives on `profiles` (accounts) and `players` (incl. guests); the existing profile→player trigger syncs it. `course_tees` gains `rating_women`/`slope_women`; one row per physical tee. A pure helper `resolveTeeForPlayer(tee, gender)` in `src/store/tees.js` is applied at every site that creates a per-player tee snapshot `{label, slope, rating}`. Scoring/stats are untouched — they consume stored snapshots.

**Tech Stack:** Expo/React Native, Supabase (Postgres), Jest (jest-expo), plain JS stores.

**Spec:** `docs/superpowers/specs/2026-07-08-gender-profiles-and-tee-ratings-design.md`

## Global Constraints

- Gender values are exactly `'male'` or `'female'` (DB CHECK); DB column stays nullable — UI enforces population.
- Backfill: all profiles `male` except `display_name = 'escribano.clau'` (female); all players `male` except `name = 'Claudia Escribano'` (female).
- Live DB and repo migrations are synced manually: apply new migration SQL via the Supabase Management API (`SUPABASE_ACCESS_TOKEN` in `.env`, endpoint `https://api.supabase.com/v1/projects/<ref>/database/query`, ref = subdomain of `EXPO_PUBLIC_SUPABASE_URL`).
- Tee snapshots stored on rounds keep the shape `{label, slope, rating}` — do NOT add gender or women's fields to snapshots.
- Missing/unknown gender always behaves as male (base rating/slope).
- All work on branch `feature/gender-tees` (create from `master` in Task 1).
- `npm test` (~870 tests) and `npm run lint` must stay green; lint has 49 pre-existing warnings — add zero new ones.

---

### Task 1: DB migration — schema, backfill, trigger, Damas merge

**Files:**
- Create: `supabase/migrations/20260709000000_gender_and_women_tees.sql`

**Interfaces:**
- Produces: DB columns `profiles.gender`, `players.gender`, `course_tees.rating_women`, `course_tees.slope_women`; merged tee rows (no more "(Damas)" duplicates).

- [ ] **Step 1: Create branch**

```bash
git checkout master && git checkout -b feature/gender-tees
```

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260709000000_gender_and_women_tees.sql`:

```sql
-- Gender on profiles/players + women's tee ratings.
-- Under the WHS every physical tee has two rating/slope pairs (men/women).
-- Previously modeled as duplicate "(Damas)" course_tees rows; now one row
-- per tee with rating_women/slope_women, and player gender picks the pair.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.course_tees
  ADD COLUMN IF NOT EXISTS rating_women numeric,
  ADD COLUMN IF NOT EXISTS slope_women  integer;

-- One-time backfill. New signups stay NULL until they pick in ProfileScreen.
UPDATE public.profiles SET gender = 'male'   WHERE gender IS NULL;
UPDATE public.profiles SET gender = 'female' WHERE lower(trim(display_name)) = 'escribano.clau';
UPDATE public.players  SET gender = 'male'   WHERE gender IS NULL;
UPDATE public.players  SET gender = 'female' WHERE lower(trim(name)) = 'claudia escribano';

-- Profile → player sync now carries gender (see 20260419120003_players_user_link.sql).
CREATE OR REPLACE FUNCTION public.sync_player_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.display_name IS NULL OR length(trim(NEW.display_name)) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.players (user_id, name, handicap, gender)
  VALUES (NEW.user_id, NEW.display_name, COALESCE(NEW.handicap, 0), NEW.gender)
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    handicap = EXCLUDED.handicap,
    gender = COALESCE(EXCLUDED.gender, public.players.gender);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;
CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap, gender ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();

-- Merge "(Damas)" tee rows into their base tee on the same course:
-- copy rating/slope into the base row's women's columns, then delete the
-- Damas row. A Damas row with no base sibling is left untouched.
WITH damas AS (
  SELECT id AS damas_id, course_id, rating, slope,
         lower(btrim(regexp_replace(label, '\s*\(\s*damas\s*\)\s*$', '', 'i'))) AS base_key
  FROM public.course_tees
  WHERE label ~* '\(\s*damas\s*\)\s*$'
),
paired AS (
  SELECT DISTINCT ON (d.damas_id) d.damas_id, b.id AS base_id, d.rating, d.slope
  FROM damas d
  JOIN public.course_tees b
    ON b.course_id = d.course_id
   AND lower(btrim(b.label)) = d.base_key
   AND b.id <> d.damas_id
  ORDER BY d.damas_id, b.sort_order
)
UPDATE public.course_tees b
   SET rating_women = p.rating, slope_women = p.slope
  FROM paired p
 WHERE b.id = p.base_id;

DELETE FROM public.course_tees d
 WHERE d.label ~* '\(\s*damas\s*\)\s*$'
   AND EXISTS (
     SELECT 1 FROM public.course_tees b
      WHERE b.course_id = d.course_id
        AND b.id <> d.id
        AND lower(btrim(b.label)) =
            lower(btrim(regexp_replace(d.label, '\s*\(\s*damas\s*\)\s*$', '', 'i')))
   );

/* VERIFY
   SELECT count(*) FROM public.course_tees WHERE label ~* '\(\s*damas\s*\)';
   SELECT count(*) FROM public.course_tees WHERE rating_women IS NOT NULL;
   SELECT gender, count(*) FROM public.players GROUP BY gender;
*/
```

- [ ] **Step 3: Dry-run the merge pairing against the live DB (read-only)**

Run via Management API (helper pattern — reuse for all DB calls):

```bash
source .env; REF=$(echo "$EXPO_PUBLIC_SUPABASE_URL" | sed -E 's#https://([^.]+).*#\1#')
Q() { curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")}"; }
Q "SELECT count(*) AS damas_total,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM course_tees b
             WHERE b.course_id = d.course_id AND b.id <> d.id
               AND lower(btrim(b.label)) = lower(btrim(regexp_replace(d.label, '\s*\(\s*damas\s*\)\s*$', '', 'i')))
          )) AS damas_paired
   FROM course_tees d WHERE d.label ~* '\(\s*damas\s*\)\s*$'"
```

Expected: `damas_total` ≈ `damas_paired` (imported courses pair 1:1). If `damas_paired` < `damas_total`, list the orphans (`SELECT label, course_id …`) and confirm they are women-only tees before proceeding — do NOT change the SQL to force-delete them.

- [ ] **Step 4: Apply the migration to the live DB**

Send the whole migration file body wrapped in `BEGIN; … COMMIT;` through the same `Q` helper (read it with `python3 -c 'import json;print(json.dumps({"query":"BEGIN;\n"+open("supabase/migrations/20260709000000_gender_and_women_tees.sql").read()+"\nCOMMIT;"}))'` as the curl `-d` body). Expected response: `[]`.

- [ ] **Step 5: Verify live state**

Run the three VERIFY queries from the migration footer via `Q`. Expected: 0 remaining "(Damas)" labels (unless confirmed women-only orphans), >0 rows with `rating_women`, players split showing exactly 1 female. Also:

```
Q "SELECT gender, count(*) FROM profiles GROUP BY gender"   -- 1 female, rest male
Q "SELECT name FROM players WHERE gender='female'"          -- Claudia Escribano (+ any trigger-synced row for escribano.clau)
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260709000000_gender_and_women_tees.sql
git commit -m "feat(db): gender on profiles/players, women's tee rating columns, Damas merge"
```

---

### Task 2: `resolveTeeForPlayer` helper in tees store

**Files:**
- Modify: `src/store/tees.js` (31 lines — add helper, extend `blankTee`)
- Test: `src/store/__tests__/tees.test.js`

**Interfaces:**
- Produces: `resolveTeeForPlayer(tee, gender) → {label, rating, slope} | null` — female players get `ratingWomen`/`slopeWomen` when present (per-field fallback to base values); anything else gets base values. `blankTee()` now includes `ratingWomen: null, slopeWomen: null`.

- [ ] **Step 1: Write failing tests** (append to `src/store/__tests__/tees.test.js`)

```js
import { resolveTeeForPlayer, blankTee } from '../tees';

describe('resolveTeeForPlayer', () => {
  const tee = { id: 't1', label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 };

  it('returns women\'s rating/slope for female players', () => {
    expect(resolveTeeForPlayer(tee, 'female')).toEqual({ label: 'Amarillas', rating: 79.3, slope: 151 });
  });

  it('returns base rating/slope for male players', () => {
    expect(resolveTeeForPlayer(tee, 'male')).toEqual({ label: 'Amarillas', rating: 72.7, slope: 141 });
  });

  it('falls back to base values when women\'s columns are missing', () => {
    const plain = { label: 'Rojas', rating: 67.6, slope: 131 };
    expect(resolveTeeForPlayer(plain, 'female')).toEqual({ label: 'Rojas', rating: 67.6, slope: 131 });
  });

  it('treats null/undefined gender as male', () => {
    expect(resolveTeeForPlayer(tee, null)).toEqual({ label: 'Amarillas', rating: 72.7, slope: 141 });
    expect(resolveTeeForPlayer(tee, undefined).slope).toBe(141);
  });

  it('returns null for a missing tee', () => {
    expect(resolveTeeForPlayer(null, 'female')).toBeNull();
  });

  it('blankTee carries empty women\'s fields', () => {
    const t = blankTee();
    expect(t.ratingWomen).toBeNull();
    expect(t.slopeWomen).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/store/__tests__/tees.test.js`
Expected: FAIL — `resolveTeeForPlayer` is not exported.

- [ ] **Step 3: Implement** (append to `src/store/tees.js`; extend `blankTee`)

```js
// Effective {label, rating, slope} snapshot for one player on a tee. Every
// physical tee carries two WHS rating pairs — base (men) and optional
// women's (ratingWomen/slopeWomen — same markers, different conversion).
// Female players get the women's pair, falling back per-field when a course
// only has one rating set. Missing or unknown gender behaves as male.
export function resolveTeeForPlayer(tee, gender) {
  if (!tee) return null;
  const female = gender === 'female';
  return {
    label: tee.label,
    rating: female ? (tee.ratingWomen ?? tee.rating) : tee.rating,
    slope: female ? (tee.slopeWomen ?? tee.slope) : tee.slope,
  };
}
```

And change `blankTee`'s return to:

```js
  return { id, label: '', rating: null, slope: null, ratingWomen: null, slopeWomen: null };
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/store/__tests__/tees.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tees.js src/store/__tests__/tees.test.js
git commit -m "feat(tees): resolveTeeForPlayer picks gendered rating pair"
```

---

### Task 3: libraryStore — women's tee columns + player gender in reads/writes

**Files:**
- Modify: `src/store/libraryStore.js` (`normalizeCourse` ~line 329, `saveCourseTees` ~line 197, `fetchPlayers` line 13, `PLAYER_COLUMNS` line 20, `upsertPlayer` line 70)
- Test: `src/store/__tests__/libraryStore.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: normalized course tees carry `ratingWomen`/`slopeWomen`; player rows from `fetchPlayers`/`fetchMyPlayers`/`fetchMyGuestPlayers` include `gender`; `upsertPlayer({ id, name, handicap, gender })` persists gender when provided.

- [ ] **Step 1: Write failing tests** (append to `src/store/__tests__/libraryStore.test.js`, testing the pure `normalizeCourse` directly per its existing pattern)

```js
describe('normalizeCourse women tee columns', () => {
  it('maps rating_women/slope_women to camelCase', () => {
    const course = normalizeCourse({
      id: 'c1', name: 'X', course_holes: [],
      course_tees: [{ id: 't1', label: 'Amarillas', rating: 72.7, slope: 141,
                      rating_women: 79.3, slope_women: 151, sort_order: 0 }],
    });
    expect(course.tees[0].ratingWomen).toBe(79.3);
    expect(course.tees[0].slopeWomen).toBe(151);
  });

  it('defaults missing women columns to null', () => {
    const course = normalizeCourse({
      id: 'c1', name: 'X', course_holes: [],
      course_tees: [{ id: 't1', label: 'Rojas', rating: 67.6, slope: 131, sort_order: 0 }],
    });
    expect(course.tees[0].ratingWomen).toBeNull();
    expect(course.tees[0].slopeWomen).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/store/__tests__/libraryStore.test.js` → FAIL (ratingWomen undefined).

- [ ] **Step 3: Implement**

In `normalizeCourse`, extend the tee mapping (line ~333):

```js
    .map((t) => ({
      id: t.id,
      label: t.label,
      rating: t.rating,
      slope: t.slope,
      ratingWomen: t.rating_women ?? null,
      slopeWomen: t.slope_women ?? null,
      sortOrder: t.sort_order ?? 0,
      yardages: t.yardages ?? undefined,
    }));
```

In `saveCourseTees`, extend the row mapping (after the `slope` line):

```js
    rating_women: t.ratingWomen != null && t.ratingWomen !== '' ? parseFloat(t.ratingWomen) : null,
    slope_women: t.slopeWomen != null && t.slopeWomen !== '' ? parseInt(t.slopeWomen, 10) : null,
```

Player reads/writes:
- `fetchPlayers` select (line 13): `'id, name, handicap, user_id, avatar_url, created_at, gender'`
- `PLAYER_COLUMNS` (line 20): append `, gender`
- `upsertPlayer` (line 70):

```js
export async function upsertPlayer({ id, name, handicap, gender }) {
  const parsed = parseHandicapIndex(handicap);
  const row = { name, handicap: parsed.ok ? parsed.value : 0 };
  if (gender !== undefined) row.gender = gender === 'female' ? 'female' : 'male';
  if (id) row.id = id;
  const { data, error } = await supabase.from('players').upsert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/store/__tests__/libraryStore.test.js` → PASS. Also `npm test -- src/store/__tests__/syncWorker.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "feat(library): women's tee columns and player gender in store reads/writes"
```

---

### Task 4: profileStore — gender load/save

**Files:**
- Modify: `src/store/profileStore.js` (`loadProfile` line ~18, `upsertProfile` line ~43)
- Test: `src/store/__tests__/profileStore.test.js`

**Interfaces:**
- Produces: `loadProfile()` result includes `gender: 'male'|'female'|null`; `upsertProfile({ gender })` persists it (invalid values → null).

- [ ] **Step 1: Write failing tests** (append to `src/store/__tests__/profileStore.test.js`, using its established supabase mock helpers — the file already captures `update`/`insert` payloads)

Two tests:
1. `loadProfile returns gender` — extend the mocked profile row with `gender: 'female'`, assert `(await loadProfile()).gender === 'female'`.
2. `upsertProfile writes valid gender and nulls invalid` — call `upsertProfile({ gender: 'female' })`, assert the captured row has `gender: 'female'`; call `upsertProfile({ gender: 'other' })`, assert captured `gender: null`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/store/__tests__/profileStore.test.js` → FAIL.

- [ ] **Step 3: Implement**

`loadProfile`: add `gender` to the select column string and `gender: data?.gender ?? null,` to the returned object.

`upsertProfile`: after the `avatarUrl` block add:

```js
  if (fields.gender !== undefined) {
    row.gender = fields.gender === 'male' || fields.gender === 'female' ? fields.gender : null;
  }
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/store/__tests__/profileStore.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/profileStore.js src/store/__tests__/profileStore.test.js
git commit -m "feat(profile): gender field in loadProfile/upsertProfile"
```

---

### Task 5: Guest player creation carries gender (mutation → syncWorker → UI)

**Files:**
- Modify: `src/store/syncWorker.js:38` (drainLibrary)
- Modify: `src/screens/PlayersLibraryScreen.js` (state + save ~lines 48–75, form UI)
- Modify: `src/screens/PlayerPickerScreen.js` (~lines 100–118, create form)
- Test: `src/store/__tests__/syncWorker.test.js`

**Interfaces:**
- Consumes: `upsertPlayer({ id, name, handicap, gender })` from Task 3.
- Produces: `player.upsertLibrary` mutations carry `gender: 'male'|'female'`; guest create/edit UIs always set it (default `'male'`).

- [ ] **Step 1: Write failing test** (in `src/store/__tests__/syncWorker.test.js`, following its existing `player.upsertLibrary` drain test): enqueue `{ type: 'player.upsertLibrary', playerId: 'p1', name: 'Ana', handicap: 20, gender: 'female' }`, drain, expect the `upsertPlayer` mock called with `expect.objectContaining({ id: 'p1', gender: 'female' })`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/store/__tests__/syncWorker.test.js` → FAIL (called without gender).

- [ ] **Step 3: Implement syncWorker** — `src/store/syncWorker.js:38`:

```js
      await upsertPlayer({ id: m.playerId, name: m.name, handicap: m.handicap, gender: m.gender });
```

- [ ] **Step 4: Run test → PASS, checkpoint commit**

```bash
git add src/store/syncWorker.js src/store/__tests__/syncWorker.test.js
git commit -m "feat(sync): player.upsertLibrary mutation carries gender"
```

- [ ] **Step 5: PlayersLibraryScreen UI**

Add state `const [gender, setGender] = useState('male');`. In `startEdit`: `setGender(p.gender === 'female' ? 'female' : 'male');`. In `cancelEdit`: `setGender('male');`. In `save()`:
- edit path: `upsertPlayer({ id: editingId, name: name.trim(), handicap, gender })`
- create path: add `gender` to the `mutate` payload and to the optimistic `setPlayers` entry.

Form UI — add a two-pill selector below the handicap input:

```jsx
<View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
  {[['male', 'Male'], ['female', 'Female']].map(([value, label]) => (
    <TouchableOpacity
      key={value}
      onPress={() => setGender(value)}
      style={[s.genderPill, gender === value && s.genderPillActive]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: gender === value }}
      activeOpacity={0.7}
    >
      <Text style={[s.genderPillText, gender === value && s.genderPillTextActive]}>{label}</Text>
    </TouchableOpacity>
  ))}
</View>
```

with styles mirroring the tee pills in `RoundTeeAssignments.js` lines 424–432 (`teePill`/`teePillActive`/`teePillText`/`teePillTextActive`), adapted to this screen's theme usage:

```js
  genderPill: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  genderPillActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  genderPillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  genderPillTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
```

- [ ] **Step 6: PlayerPickerScreen create form**

Same pill pattern: `const [newGender, setNewGender] = useState('male');`, selector next to the name/handicap inputs, and:

```js
      const player = { id: playerId, name: trimmed, handicap: hcp, gender: newGender };
      await mutate(null, {
        type: 'player.upsertLibrary',
        playerId,
        name: player.name,
        handicap: hcp,
        gender: newGender,
      });
```

Reset with the other fields: `setNewGender('male');`.

- [ ] **Step 7: Run suite + lint**

Run: `npm test` → all pass. `npm run lint` → no new warnings.

- [ ] **Step 8: Commit**

```bash
git add src/screens/PlayersLibraryScreen.js src/screens/PlayerPickerScreen.js
git commit -m "feat(players): gender selector on guest create/edit, default male"
```

---

### Task 6: RoundTeeAssignments resolves tees by gender

**Files:**
- Modify: `src/components/RoundTeeAssignments.js` (`resolvePlayerTee` line 40, mount effect line 113, `setPlayerTee` line 168)
- Test: Create `src/components/__tests__/roundTeeAssignments.test.js`

**Interfaces:**
- Consumes: `resolveTeeForPlayer` (Task 2); `players[]` props carry `gender` (wired by Task 9; missing gender = male).
- Produces: `resolvePlayerTee(existing, lastUsed, tees, gender)` — 4th param new, optional.

- [ ] **Step 1: Write failing tests** — create `src/components/__tests__/roundTeeAssignments.test.js`:

```js
import { resolvePlayerTee } from '../RoundTeeAssignments';

const tees = [
  { label: 'Blancas', rating: 74.7, slope: 143, ratingWomen: 81.6, slopeWomen: 155 },
  { label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 },
  { label: 'Rojas', rating: 67.6, slope: 131, ratingWomen: 73.1, slopeWomen: 137 },
];

describe('resolvePlayerTee with gender', () => {
  it('keeps a valid existing snapshot untouched', () => {
    const existing = { label: 'Rojas', slope: 131, rating: 67.6 };
    expect(resolvePlayerTee(existing, null, tees, 'female')).toBe(existing);
  });

  it('resolves the middle tee with women\'s values for female players', () => {
    expect(resolvePlayerTee(null, null, tees, 'female'))
      .toEqual({ label: 'Amarillas', rating: 79.3, slope: 151 });
  });

  it('resolves last-used label with gendered values', () => {
    const lastUsed = { label: 'Rojas', slope: 999, rating: 999 };
    expect(resolvePlayerTee(null, lastUsed, tees, 'female'))
      .toEqual({ label: 'Rojas', rating: 73.1, slope: 137 });
  });

  it('defaults to men\'s values without gender', () => {
    expect(resolvePlayerTee(null, null, tees))
      .toEqual({ label: 'Amarillas', rating: 72.7, slope: 141 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/__tests__/roundTeeAssignments.test.js` → FAIL.

- [ ] **Step 3: Implement**

Import: `import { middleTee, resolveTeeForPlayer } from '../store/tees';`

```js
export function resolvePlayerTee(existing, lastUsed, tees, gender) {
  const list = Array.isArray(tees) ? tees : [];
  const find = (tee) => (tee
    ? list.find((t) => String(t?.label ?? '') === String(tee.label ?? '')) ?? null
    : null);
  if (find(existing)) return existing;
  const pick = find(lastUsed) || middleTee(list);
  return resolveTeeForPlayer(pick, gender);
}
```

Mount effect (line 113): `const tee = resolvePlayerTee(existing, lastUsed, tees, p.gender);`

`setPlayerTee` (line 168):

```js
  function setPlayerTee(playerId, tee) {
    const gender = players.find((pl) => pl.id === playerId)?.gender;
    const snapshot = resolveTeeForPlayer(tee, gender);
    const next = { ...playerTees, [playerId]: snapshot };
    setPlayerTees(next);
    recomputeAuto(next, manualHandicaps);
  }
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/components/__tests__/roundTeeAssignments.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RoundTeeAssignments.js src/components/__tests__/roundTeeAssignments.test.js
git commit -m "feat(tees): round tee assignments resolve rating pair by player gender"
```

---

### Task 7: quickStartGame resolves per-player gendered tees

**Files:**
- Modify: `src/lib/quickStartGame.js` (`resolveQuickStartPlayerTees` lines 98–138)
- Test: `src/lib/__tests__/quickStartGame.test.js`

**Interfaces:**
- Consumes: `resolveTeeForPlayer` (Task 2); `players[]` may carry `gender`.
- Produces: `resolveQuickStartPlayerTees` output snapshots use each player's gender.

- [ ] **Step 1: Write failing test** (append to `src/lib/__tests__/quickStartGame.test.js`, reusing its fixture style)

```js
it('gives female players the women\'s rating pair for the group tee', () => {
  const course = {
    id: 'c1', name: 'Course', holes: [],
    tees: [
      { label: 'Blancas', rating: 74.7, slope: 143, ratingWomen: 81.6, slopeWomen: 155 },
      { label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 },
      { label: 'Rojas', rating: 67.6, slope: 131, ratingWomen: 73.1, slopeWomen: 137 },
    ],
  };
  const players = [
    { id: 'p1', name: 'Marcos', handicap: 10, gender: 'male' },
    { id: 'p2', name: 'Claudia', handicap: 20, gender: 'female' },
  ];
  const result = resolveQuickStartPlayerTees({ course, players });
  expect(result.p1).toEqual({ label: 'Amarillas', slope: 141, rating: 72.7 });
  expect(result.p2).toEqual({ label: 'Amarillas', slope: 151, rating: 79.3 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/__tests__/quickStartGame.test.js` → FAIL (p2 gets men's values).

- [ ] **Step 3: Implement**

Import `resolveTeeForPlayer` alongside `middleTee, teeByLabel` from `../store/tees`. Replace the final mapping of `resolveQuickStartPlayerTees` (lines 134–137):

```js
  if (!groupTee) return {};
  return Object.fromEntries(
    playerHistory.map(({ player, tee }) => {
      const label = tee?.label ?? groupTee.label;
      const courseTee = teeByLabel(courseTees, label);
      return [player.id, resolveTeeForPlayer(courseTee, player.gender) ?? (tee ?? groupTee)];
    }),
  );
```

(The `?? (tee ?? groupTee)` keeps the old snapshot if a label unexpectedly no longer matches — same defensive behavior as before.)

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/__tests__/quickStartGame.test.js` → PASS (existing tests stay green — male/ungendered snapshots are unchanged by construction).

- [ ] **Step 5: Commit**

```bash
git add src/lib/quickStartGame.js src/lib/__tests__/quickStartGame.test.js
git commit -m "feat(quickstart): per-player gendered tee resolution"
```

---

### Task 8: tournamentStore — reTeeRound honors gender

**Files:**
- Modify: `src/store/tournamentStore.js` (`reTeeRound` line 639, `propagateCourseToTournaments` line 655)
- Test: `src/store/__tests__/tournamentStore.test.js`

**Interfaces:**
- Consumes: `resolveTeeForPlayer` (Task 2).
- Produces: `reTeeRound(round, tees, genderById = {})` — third param new; `propagateCourseToTournaments` passes each tournament's `{playerId: gender}` map.

- [ ] **Step 1: Write failing test** (append to `src/store/__tests__/tournamentStore.test.js` near existing `reTeeRound` tests)

```js
it('reTeeRound refreshes snapshots with the player\'s gender pair', () => {
  const round = { playerTees: { p1: { label: 'Amarillas', slope: 1, rating: 1 },
                                p2: { label: 'Amarillas', slope: 1, rating: 1 } } };
  const tees = [{ label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 }];
  const next = reTeeRound(round, tees, { p1: 'male', p2: 'female' });
  expect(next.playerTees.p1).toEqual({ label: 'Amarillas', slope: 141, rating: 72.7 });
  expect(next.playerTees.p2).toEqual({ label: 'Amarillas', slope: 151, rating: 79.3 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/store/__tests__/tournamentStore.test.js` → FAIL.

- [ ] **Step 3: Implement**

Import `resolveTeeForPlayer` next to `teeByLabel` (line 6). Then:

```js
export function reTeeRound(round, tees, genderById = {}) {
  if (!round?.playerTees) return round;
  const next = {};
  for (const [playerId, snapshot] of Object.entries(round.playerTees)) {
    const match = teeByLabel(tees, snapshot?.label);
    next[playerId] = match ? resolveTeeForPlayer(match, genderById[playerId]) : snapshot;
  }
  return { ...round, playerTees: next };
}
```

In `propagateCourseToTournaments` (line ~664), build the map per tournament `t` and pass it:

```js
      const genderById = Object.fromEntries((t.players ?? []).map((p) => [p.id, p.gender]));
      const reTeed = reTeeRound(round, tees, genderById);
```

(Adjust to the actual loop variable names at that site.)

- [ ] **Step 4: Run tests**

Run: `npm test -- src/store/__tests__/tournamentStore.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/tournamentStore.test.js
git commit -m "feat(tournaments): reTeeRound resolves gendered rating pairs"
```

---

### Task 9: Embedded tournament players carry gender

**Files:**
- Modify: `src/screens/SetupScreen.js:174-180` (player push)
- Modify: `src/screens/PlayersScreen.js:122` (player construction)

**Interfaces:**
- Consumes: player rows with `gender` from Task 3 fetches.
- Produces: `tournament.players[]` entries include `gender` for all new tournaments.

- [ ] **Step 1: SetupScreen** — extend the pushed object (line ~174):

```js
            next.push({
              id: p.id,
              name: p.name,
              handicap: p.handicap,
              user_id: p.user_id ?? null,
              avatar_url: p.avatar_url ?? null,
              gender: p.gender ?? null,
            });
```

- [ ] **Step 2: PlayersScreen** — line 122:

```js
      const player = { id: p.id, name: p.name, handicap: parsed.ok ? parsed.value : 0, gender: p.gender ?? null };
```

(Line 236's `{ ...p, handicap: … }` spread already preserves gender — no change.)

- [ ] **Step 3: Run suite**

Run: `npm test` → all green (this is field plumbing; behavior covered by Tasks 6–8 tests).

- [ ] **Step 4: Commit**

```bash
git add src/screens/SetupScreen.js src/screens/PlayersScreen.js
git commit -m "feat(setup): embedded tournament players carry gender"
```

---

### Task 10: ProfileScreen gender selector + Home banner

**Files:**
- Modify: `src/screens/ProfileScreen.js` (state ~line 32, load ~line 47, save ~line 126, form JSX ~line 288–320)
- Modify: `src/screens/HomeScreen.js` (banner near top of scroll content)
- Test: `src/screens/__tests__/ProfileScreen.test.js`

**Interfaces:**
- Consumes: `loadProfile`/`upsertProfile` gender (Task 4).
- Produces: gender must be chosen before a profile save succeeds; Home shows a "Complete your profile" banner while `profile.gender` is null.

- [ ] **Step 1: Write failing test** (append to `src/screens/__tests__/ProfileScreen.test.js`, using its existing render helpers and profileStore mocks): mock `loadProfile` → profile with `gender: null`; press Save → expect `upsertProfile` NOT called and an alert shown; press the pill with accessibilityLabel `"Female"`, press Save → expect `upsertProfile` called with `expect.objectContaining({ gender: 'female' })`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/screens/__tests__/ProfileScreen.test.js` → FAIL.

- [ ] **Step 3: Implement ProfileScreen**

- State: `const [gender, setGender] = useState(null);`
- Load (line ~47 block): `setGender(p?.gender ?? null);`
- Dirty check: include `gender !== (profile?.gender ?? null)`.
- `save()` — after handicap validation, before the upsert:

```js
    if (gender !== 'male' && gender !== 'female') {
      Alert.alert('Select gender', 'Choose Male or Female — it sets which tee rating (men\'s or women\'s) your handicap uses.');
      return;
    }
```

and add `gender,` to the `upsertProfile({ ... })` call (line ~126).
- Form JSX — after the Handicap field (line ~308), add a `Gender` field label and the same two-pill selector as Task 5 Step 5 (values `male`/`female`, labels `Male`/`Female`, `accessibilityLabel={label}`), with the `genderPill*` styles added to this screen's stylesheet.

- [ ] **Step 4: HomeScreen banner**

Add `import { loadProfile } from '../store/profileStore';`. Inside the component:

```js
  const [needsGender, setNeedsGender] = useState(false);
  useEffect(() => {
    let alive = true;
    loadProfile()
      .then((p) => { if (alive) setNeedsGender(!!p && !p.gender); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
```

Banner JSX at the top of the main scroll content (above the quick-start section):

```jsx
{needsGender && (
  <TouchableOpacity
    onPress={() => navigation.navigate('Profile')}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityLabel="Complete your profile"
    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12,
             borderWidth: 1, borderColor: theme.accent.primary + '55',
             backgroundColor: theme.accent.light, padding: 12, marginBottom: 12 }}
  >
    <Feather name="user" size={16} color={theme.accent.primary} />
    <Text style={{ fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 13, flex: 1 }}>
      Complete your profile — set your gender so handicaps use the right tee rating.
    </Text>
    <Feather name="chevron-right" size={16} color={theme.accent.primary} />
  </TouchableOpacity>
)}
```

(Confirm the actual profile route name — grep `navigate('Profile'` or the navigator registration — and use that.)

- [ ] **Step 5: Run tests**

Run: `npm test -- src/screens/__tests__/ProfileScreen.test.js src/screens/__tests__/HomeScreen.quickStart.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ProfileScreen.js src/screens/HomeScreen.js src/screens/__tests__/ProfileScreen.test.js
git commit -m "feat(profile): required gender selector and home completion banner"
```

---

### Task 11: TeesEditor women's rating/slope inputs

**Files:**
- Modify: `src/components/TeesEditor.js`

**Interfaces:**
- Consumes: tee objects with `ratingWomen`/`slopeWomen` (Tasks 2–3).
- Produces: editor rows read/write those fields; `saveCourseTees` (Task 3) persists them.

- [ ] **Step 1: Implement second input line per tee**

Wrap each existing tee row plus a new secondary row in a `<React.Fragment key={tee.id}>` (move the key up from the row `View`). Secondary row:

```jsx
<View style={s.womenRow}>
  <Text style={[s.womenLabel, s.labelCol]}>Women's</Text>
  <TextInput
    style={[s.input, s.numCol]}
    keyboardType="decimal-pad"
    maxLength={5}
    placeholder="79.3"
    placeholderTextColor={theme.text.muted}
    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
    selectionColor={theme.accent.primary}
    value={tee.ratingWomen != null ? String(tee.ratingWomen) : ''}
    onChangeText={(v) => update(i, { ratingWomen: v })}
  />
  <TextInput
    style={[s.input, s.numCol]}
    keyboardType="numeric"
    maxLength={3}
    placeholder="151"
    placeholderTextColor={theme.text.muted}
    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
    selectionColor={theme.accent.primary}
    value={tee.slopeWomen != null ? String(tee.slopeWomen) : ''}
    onChangeText={(v) => update(i, { slopeWomen: v })}
  />
  <View style={s.removeCol} />
</View>
```

Styles (mirror the existing `row` style's spacing — read it first and match):

```js
  womenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 },
  womenLabel: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11, textAlign: 'right', paddingRight: 4 },
```

- [ ] **Step 2: Run suite + lint**

Run: `npm test` and `npm run lint` → green, no new warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/TeesEditor.js
git commit -m "feat(course-editor): women's rating/slope inputs per tee"
```

---

### Task 12: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite + lint**

Run: `npm test` → all suites pass. `npm run lint` → 49 pre-existing warnings, zero new.

- [ ] **Step 2: Live DB sanity**

Via the `Q` helper: confirm `profiles`/`players` gender distributions match Task 1's result, and spot-check Villa de Madrid Negro (course id `298a8eb3-289d-4edb-ab41-647816a603d2`): 6 tee rows, each with `rating_women` populated, no "(Damas)" labels.

- [ ] **Step 3: Runtime spot-check (recommended)**

Use the project `verify` skill (Expo web + Playwright): create a quick-start game adding a female guest player on a course with women's ratings; confirm her playing handicap differs from a male player's on the same tee.

- [ ] **Step 4: Merge decision**

Use superpowers:finishing-a-development-branch (merge to master / PR per user's call).
