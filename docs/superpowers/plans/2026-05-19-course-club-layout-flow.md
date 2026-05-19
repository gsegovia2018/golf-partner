# Course → Club → Layout Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the course picker select a club (or a standalone course), and move the layout choice onto the round card in the "Where are you playing?" wizard step via a dropdown.

**Architecture:** The picker emits a list of *picks* (`club` or `course`) through `selectionBridge`. Two pure helpers (`applyCoursePick`, `applyLayoutChoice`) turn a pick / layout choice into a setup-stage round; a shared `RoundLayoutSelect` component renders the layout dropdown. `SetupScreen` and `OfficialCreateScreen` both consume picks and render the dropdown for club picks. This replaces the inline accordion built by the Clubs & Layouts feature.

**Tech Stack:** React Native / Expo, Jest (`jest-expo`), `courseLibrary.js` (already present on this branch).

**Spec:** `docs/superpowers/specs/2026-05-19-course-club-layout-flow-design.md`

---

## File Structure

- **Create** `src/lib/roundCourse.js` — pure helpers `applyCoursePick`, `applyLayoutChoice`. No I/O.
- **Create** `src/lib/__tests__/roundCourse.test.js` — unit tests.
- **Create** `src/components/RoundLayoutSelect.js` — the layout dropdown component.
- **Modify** `src/screens/CoursePickerScreen.js` — clubs become directly selectable; emit `picks`; remove the accordion.
- **Modify** `src/screens/SetupScreen.js` — consume `picks`, render `RoundLayoutSelect` for club rounds.
- **Modify** `src/screens/OfficialCreateScreen.js` — same.

---

## Task 1: Pure helpers — `roundCourse.js`

**Files:**
- Create: `src/lib/roundCourse.js`
- Test: `src/lib/__tests__/roundCourse.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/roundCourse.test.js`:

```js
import { applyCoursePick, applyLayoutChoice } from '../roundCourse';

const course = (over = {}) => ({
  id: 'c1', name: 'Pine Valley', slope: 132, rating: 71.8,
  holes: [{ number: 1, par: 4, strokeIndex: 1 }],
  tees: [{ label: 'White', slope: 132 }],
  ...over,
});

describe('applyCoursePick', () => {
  test('course pick resolves the round and clears club fields', () => {
    const next = applyCoursePick({ id: 'r1', club: { id: 'x' } },
      { kind: 'course', course: course() });
    expect(next.courseId).toBe('c1');
    expect(next.courseName).toBe('Pine Valley');
    expect(next.holes).toHaveLength(1);
    expect(next.tees).toHaveLength(1);
    expect(next.slope).toBe(132);
    expect(next.courseRating).toBe(71.8);
    expect(next.club).toBeNull();
    expect(next.clubLayouts).toBeNull();
    expect(next.layoutId).toBeNull();
  });

  test('course pick deep-copies holes (no shared reference)', () => {
    const c = course();
    const next = applyCoursePick({ id: 'r1' }, { kind: 'course', course: c });
    expect(next.holes).not.toBe(c.holes);
    expect(next.holes[0]).not.toBe(c.holes[0]);
  });

  test('club pick leaves the round unresolved with layouts attached', () => {
    const layouts = [course({ id: 'l1' }), course({ id: 'l2' })];
    const next = applyCoursePick({ id: 'r1' },
      { kind: 'club', club: { id: 'k1', name: 'La Moraleja' }, layouts });
    expect(next.club).toEqual({ id: 'k1', name: 'La Moraleja' });
    expect(next.clubLayouts).toBe(layouts);
    expect(next.layoutId).toBeNull();
    expect(next.courseName).toBe('');
    expect(next.courseId).toBeNull();
    expect(next.holes).toEqual([]);
  });
});

describe('applyLayoutChoice', () => {
  test('resolves the round from the layout, keeping club/clubLayouts', () => {
    const layouts = [course({ id: 'l1', name: 'Campo 1' })];
    const round = { id: 'r1', club: { id: 'k1', name: 'La Moraleja' }, clubLayouts: layouts };
    const next = applyLayoutChoice(round, layouts[0]);
    expect(next.courseId).toBe('l1');
    expect(next.courseName).toBe('Campo 1');
    expect(next.layoutId).toBe('l1');
    expect(next.club).toEqual({ id: 'k1', name: 'La Moraleja' });
    expect(next.clubLayouts).toBe(layouts);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/roundCourse.test.js`
Expected: FAIL — `Cannot find module '../roundCourse'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/roundCourse.js`:

```js
// Pure helpers for applying a course-picker result to a setup-stage round.
// Shared by SetupScreen and OfficialCreateScreen so the two wizards behave
// identically. No I/O — unit-tested in isolation.

function deepHoles(holes) { return (holes || []).map((h) => ({ ...h })); }
function deepTees(tees) { return (tees || []).map((t) => ({ ...t })); }

// Course-derived fields, set whenever a round resolves to a concrete course.
// Deep-copies holes/tees so later edits never mutate the library's objects.
function courseFields(course) {
  return {
    courseId: course.id,
    courseName: course.name,
    holes: deepHoles(course.holes),
    tees: deepTees(course.tees),
    slope: course.slope ?? null,
    courseRating: course.rating ?? null,
    playerHandicaps: null,
    playerTees: null,
  };
}

// Apply a course-picker pick to a round. A 'course' pick resolves the round
// immediately; a 'club' pick leaves it unresolved (empty courseName) with the
// club's layouts attached for the layout dropdown.
export function applyCoursePick(round, pick) {
  if (pick.kind === 'course') {
    return {
      ...round,
      ...courseFields(pick.course),
      club: null, clubLayouts: null, layoutId: null,
    };
  }
  // pick.kind === 'club'
  return {
    ...round,
    club: { id: pick.club.id, name: pick.club.name },
    clubLayouts: pick.layouts,
    layoutId: null,
    courseId: null,
    courseName: '',
    holes: [],
    tees: [],
    playerHandicaps: null,
    playerTees: null,
  };
}

// Apply a layout choice (a course object) to a club-pending round, resolving
// it. `club` and `clubLayouts` are kept so the layout can be changed later.
export function applyLayoutChoice(round, layoutCourse) {
  return { ...round, ...courseFields(layoutCourse), layoutId: layoutCourse.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/roundCourse.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roundCourse.js src/lib/__tests__/roundCourse.test.js
git commit -m "feat: roundCourse helpers for applying course picks and layouts"
```

---

## Task 2: `RoundLayoutSelect` component

**Files:**
- Create: `src/components/RoundLayoutSelect.js`

A UI component — not unit-tested (consistent with the repo). Verified by the suite staying green and manual checks later.

- [ ] **Step 1: Write the component**

Create `src/components/RoundLayoutSelect.js`:

```js
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Round-card control for choosing which layout of a picked club to play.
// `layouts` are course objects; `value` is the chosen layout's course id
// (or null). `onChange` receives the chosen layout course object.
export default function RoundLayoutSelect({ club, layouts, value, onChange, onChangeClub }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const chosen = (layouts || []).find((l) => l.id === value) || null;

  return (
    <View>
      <View style={s.clubRow}>
        <Feather name="map-pin" size={15} color={theme.accent.primary} />
        <Text style={s.clubName} numberOfLines={1}>{club.name}</Text>
        <TouchableOpacity onPress={onChangeClub} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.change}>Change</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.dd} activeOpacity={0.7} onPress={() => setOpen((o) => !o)}>
        <Text style={[s.ddText, !chosen && s.ddPlaceholder]} numberOfLines={1}>
          {chosen ? (chosen.layoutName || chosen.name) : 'Choose a layout…'}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.text.muted} />
      </TouchableOpacity>

      {open && (
        <View style={s.list}>
          {(layouts || []).map((l) => {
            const par = (l.holes || []).reduce((sum, h) => sum + h.par, 0);
            const isSel = l.id === value;
            return (
              <TouchableOpacity
                key={l.id}
                style={[s.row, isSel && s.rowSel]}
                activeOpacity={0.7}
                onPress={() => { onChange(l); setOpen(false); }}
              >
                <Text style={s.rowName}>{l.layoutName || l.name}</Text>
                <Text style={s.rowMeta}>
                  {(l.holes || []).length} holes · Par {par}
                  {l.slope ? ` · Slope ${l.slope}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  clubName: {
    flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary,
  },
  change: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.accent.primary },
  dd: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default, borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: 12,
  },
  ddText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
  ddPlaceholder: { color: theme.text.muted, fontFamily: 'PlusJakartaSans-Medium' },
  list: {
    marginTop: 6, borderWidth: 1, borderColor: theme.border.default,
    borderRadius: 10, overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 13, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    backgroundColor: theme.bg.card,
  },
  rowSel: { backgroundColor: theme.isDark ? theme.accent.primary + '14' : theme.accent.light },
  rowName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  rowMeta: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12,
    color: theme.text.secondary, marginTop: 2,
  },
});
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npx jest`
Expected: PASS — unchanged (the component has no test; this confirms nothing broke).

- [ ] **Step 3: Commit**

```bash
git add src/components/RoundLayoutSelect.js
git commit -m "feat: RoundLayoutSelect — layout dropdown for the round card"
```

---

## Task 3: `CoursePickerScreen.js` — club/course selector emitting picks

**Files:**
- Modify: `src/screens/CoursePickerScreen.js`

Removes the accordion; a club row becomes directly selectable. Apply the seven edits below. Read the file first.

- [ ] **Step 1: Replace the `items` memo, accordion helpers, and row renderers**

Find the block that starts at `const items = useMemo(() => {` and ends at the closing `}` of `renderClubRow` (the `function renderClubRow(club, layouts) { ... }` block — it ends just before `function toggleCourse(course) {`). Replace that entire block with:

```js
  const items = useMemo(() => {
    const all = buildCourseLibraryItems(courses, clubs, favorites, lastUsed);
    return filterCourseLibraryItems(all, query);
  }, [courses, clubs, query, favorites, lastUsed]);

  // A selection is { kind:'course'|'club', id }. Order = round assignment.
  function isPicked(kind, id) {
    return selected.findIndex((p) => p.kind === kind && p.id === id);
  }

  function togglePick(kind, id) {
    setSelected((prev) => {
      const i = prev.findIndex((p) => p.kind === kind && p.id === id);
      if (i !== -1) return prev.filter((_, idx) => idx !== i);
      if (maxSelectable != null && prev.length >= maxSelectable) {
        const msg = `You can pick at most ${maxSelectable} course${maxSelectable !== 1 ? 's' : ''}.`;
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Selection limit', msg);
        return prev;
      }
      return [...prev, { kind, id }];
    });
  }

  // A selectable row for a standalone course (or a single-layout club's course).
  function renderCourseRow(c) {
    const selIdx = isPicked('course', c.id);
    const picked = selIdx !== -1;
    const isFavorite = favorites.has(c.id);
    return (
      <View key={`course-${c.id}`} style={[s.row, picked && s.rowPicked]}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => togglePick('course', c.id)}
          onLongPress={() => handleCourseLongPress(c)}
          delayLongPress={350}
          activeOpacity={0.7}
        >
          <Text style={s.courseName}>{c.name}</Text>
          <Text style={s.courseMeta}>
            {[c.city, c.province].filter(Boolean).join(', ')}
            {(c.city || c.province) ? '  ·  ' : ''}
            Par {c.holes.reduce((sum, h) => sum + h.par, 0)}
            {c.slope ? `  ·  Slope ${c.slope}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.favBtn}
          onPress={() => handleToggleFavorite(c.id)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isFavorite ? (
            <FontAwesome name="star" size={18} color={theme.accent.primary} />
          ) : (
            <Feather name="star" size={18} color={theme.text.muted} />
          )}
        </TouchableOpacity>
        {picked
          ? <View style={s.orderBadge}><Text style={s.orderBadgeText}>{selIdx + 1}</Text></View>
          : <View style={s.emptyCircle} />}
      </View>
    );
  }

  // A selectable row for a club — picking it selects the club; the layout is
  // chosen later, on the wizard's round card.
  function renderClubRow(club, layouts) {
    const selIdx = isPicked('club', club.id);
    const picked = selIdx !== -1;
    return (
      <View key={`club-${club.id}`} style={[s.row, picked && s.rowPicked]}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => togglePick('club', club.id)}
          activeOpacity={0.7}
        >
          <Text style={s.courseName}>{club.name}</Text>
          <Text style={s.courseMeta}>
            {[club.city, club.province].filter(Boolean).join(', ')}
            {(club.city || club.province) ? '  ·  ' : ''}
            {layouts.length} layouts
          </Text>
        </TouchableOpacity>
        {picked
          ? <View style={s.orderBadge}><Text style={s.orderBadgeText}>{selIdx + 1}</Text></View>
          : <View style={s.emptyCircle} />}
      </View>
    );
  }
```

- [ ] **Step 2: Replace the `selectedCourses` state and remove accordion state**

Find:

```js
  const [courses, setCourses] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [expandedClubs, setExpandedClubs] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
```

Replace with:

```js
  const [courses, setCourses] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);
```

Then find the old selection state declaration:

```js
  const [selectedCourses, setSelectedCourses] = useState([]);
```

Replace with:

```js
  const [selected, setSelected] = useState([]);
```

- [ ] **Step 3: Remove the old `toggleCourse` and fix `addAndSelect`**

Find and DELETE the entire `function toggleCourse(course) { ... }` (it was kept right after `renderClubRow`; the new `togglePick` from Step 1 replaces it).

Then find, inside `addAndSelect`, the block that auto-selects the new course:

```js
      // Respect the selection cap — add to library but skip auto-selecting
      // when the picker is already full.
      setSelectedCourses((prev) => {
        if (maxSelectable != null && prev.length >= maxSelectable) return prev;
        return [...prev, full];
      });
```

Replace with:

```js
      // Respect the selection cap — add to library but skip auto-selecting
      // when the picker is already full.
      setSelected((prev) => {
        if (maxSelectable != null && prev.length >= maxSelectable) return prev;
        return [...prev, { kind: 'course', id: course.id }];
      });
```

Also, inside the long-press rename/delete handlers, find the two references to `setSelectedCourses`:

The rename-success line:

```js
        setSelectedCourses((prev) => prev.map((c) => (c.id === course.id ? { ...c, name: trimmed } : c)));
```

Delete that line entirely (selections are now `{kind,id}` — they hold no name to update).

The delete-success line:

```js
        setSelectedCourses((prev) => prev.filter((c) => c.id !== course.id));
```

Replace with:

```js
        setSelected((prev) => prev.filter((p) => !(p.kind === 'course' && p.id === course.id)));
```

- [ ] **Step 4: Rewrite `confirm()` to emit picks**

Find:

```js
  function confirm() {
    setPendingCourses({ startRoundIndex: roundIndex, courses: selectedCourses });
    navigation.goBack();
  }
```

Replace with:

```js
  function confirm() {
    const picks = selected.map((sel) => {
      if (sel.kind === 'club') {
        const item = items.find((it) => it.kind === 'club' && it.club.id === sel.id);
        return {
          kind: 'club',
          club: { id: item.club.id, name: item.club.name },
          layouts: item.layouts,
        };
      }
      const course = courses.find((c) => c.id === sel.id);
      return {
        kind: 'course',
        course: {
          id: course.id, name: course.name, slope: course.slope, rating: course.rating,
          holes: course.holes.length === 18 ? course.holes : defaultHoles(),
          tees: course.tees ?? [],
        },
      };
    });
    setPendingCourses({ startRoundIndex: roundIndex, picks });
    navigation.goBack();
  }
```

- [ ] **Step 5: Update the render block**

In the library render block, find:

```js
        ) : (
          items.map((item) =>
            item.kind === 'club'
              ? renderClubRow(item.club, item.layouts)
              : renderCourseRow(item.course, false))
        )}
```

Replace with:

```js
        ) : (
          items.map((item) =>
            item.kind === 'club'
              ? renderClubRow(item.club, item.layouts)
              : renderCourseRow(item.course))
        )}
```

- [ ] **Step 6: Update the footer**

Find the footer condition and button:

```js
      {selectedCourses.length > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              Add {selectedCourses.length} Round{selectedCourses.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
```

Replace with:

```js
      {selected.length > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              Add {selected.length} Round{selected.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
```

Then in the `makeStyles` `StyleSheet.create({ ... })`, delete the now-unused `clubRow` and `layoutRow` style entries (added by the Clubs feature; nothing references them after this task).

- [ ] **Step 7: Verify**

Run: `npx jest`
Expected: PASS — the suite stays green.
Then run: `grep -n "selectedCourses\|expandedClubs\|toggleCourse\|isClubExpanded\|toggleClub\|layoutRow\|clubRow" src/screens/CoursePickerScreen.js`
Expected: no output — every accordion / old-selection reference is gone.

- [ ] **Step 8: Commit**

```bash
git add src/screens/CoursePickerScreen.js
git commit -m "feat: course picker selects clubs/courses and emits picks"
```

---

## Task 4: `SetupScreen.js` — consume picks, render the layout dropdown

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Add imports**

Find the line that imports from `'../lib/selectionBridge'` (it imports `consumePendingCourses`). Immediately after that import line, add:

```js
import { applyCoursePick, applyLayoutChoice } from '../lib/roundCourse';
import RoundLayoutSelect from '../components/RoundLayoutSelect';
```

- [ ] **Step 2: Replace the `pendingCourses` consume effect body**

Find this block inside the focus effect:

```js
    if (pc && pc.courses.length > 0) {
      const { startRoundIndex, courses } = pc;
      (async () => {
        let freshCourses = courses;
        try {
          const all = await fetchCourses();
          freshCourses = courses.map((c) => all.find((x) => x.id === c.id) ?? c);
        } catch (_) { /* keep snapshot */ }
        if (cancelled) return;
        setRounds((prev) => {
          const next = [...prev];
          freshCourses.forEach((course, i) => {
            const idx = startRoundIndex + i;
            const roundData = {
              courseId: course.id,
              courseName: course.name,
              // Deep-copy so later edits in CourseEditor don't mutate the
              // library's in-memory objects.
              holes: course.holes.map((h) => ({ ...h })),
              tees: (course.tees ?? []).map((t) => ({ ...t })),
              playerHandicaps: null,
              playerTees: null,
            };
            if (idx < next.length) {
              next[idx] = { ...next[idx], ...roundData };
            } else {
              // Stable id so React keys / removal survive reordering.
              next.push({ id: newRoundId(), ...roundData });
            }
          });
          return next;
        });
        if (isGame && !nameTouched && startRoundIndex === 0 && freshCourses[0]?.name) {
          setTournamentName(buildGameName(freshCourses[0].name));
        }
      })();
    }
```

Replace it with:

```js
    if (pc && pc.picks && pc.picks.length > 0) {
      const { startRoundIndex, picks } = pc;
      setRounds((prev) => {
        const next = [...prev];
        picks.forEach((pick, i) => {
          const idx = startRoundIndex + i;
          const base = idx < next.length
            ? next[idx]
            : { id: newRoundId(), manualHandicaps: {} };
          const applied = applyCoursePick(base, pick);
          if (idx < next.length) next[idx] = applied;
          else next.push(applied);
        });
        return next;
      });
      // Name a single game after its course — only a resolved 'course' pick
      // has a name now; a 'club' pick names the game when its layout is set.
      const first = picks[0];
      if (isGame && !nameTouched && startRoundIndex === 0 && first?.kind === 'course') {
        setTournamentName(buildGameName(first.course.name));
      }
    }
```

(The surrounding `useFocusEffect(useCallback(() => { ... }, []))`, the `consumePendingCourses()` call above this block, and `return () => { cancelled = true; }` all stay. `fetchCourses` may now be unused in this file — if the build flags it as unused, remove it from its import; if other code still uses it, leave it.)

- [ ] **Step 3: Add the `chooseLayout` handler**

Find the `updateCourseName` function (it calls `setRounds`). Immediately after that function, add:

```js
  // Resolve a club-picked round to one of the club's layouts.
  const chooseLayout = useCallback((roundIndex, layoutCourse) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = applyLayoutChoice(next[roundIndex], layoutCourse);
      return next;
    });
    if (isGame && !nameTouched && roundIndex === 0) {
      setTournamentName(buildGameName(layoutCourse.name));
    }
  }, [isGame, nameTouched]);
```

(`useCallback` is already imported in this file — it is used by the focus effect. If the build reports it missing, add it to the `react` import.)

- [ ] **Step 4: Render `RoundLayoutSelect` for club-picked rounds**

In the round step, find the empty-course branch:

```js
            ) : (
              <TouchableOpacity
                style={s.courseEmpty}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
              >
                <View style={s.courseEmptyPin}>
                  <Feather name="map-pin" size={20} color={theme.accent.primary} />
                </View>
                <Text style={s.courseEmptyTitle}>Pick a course from library</Text>
                <Text style={s.courseEmptyHint}>Tap to choose where you're playing</Text>
              </TouchableOpacity>
            )}
```

Replace with:

```js
            ) : r.club ? (
              <View style={s.courseCard}>
                <RoundLayoutSelect
                  club={r.club}
                  layouts={r.clubLayouts || []}
                  value={r.layoutId ?? null}
                  onChange={(layoutCourse) => chooseLayout(i, layoutCourse)}
                  onChangeClub={() => navigation.navigate('CoursePicker', { roundIndex: i })}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={s.courseEmpty}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
              >
                <View style={s.courseEmptyPin}>
                  <Feather name="map-pin" size={20} color={theme.accent.primary} />
                </View>
                <Text style={s.courseEmptyTitle}>Pick a club or course</Text>
                <Text style={s.courseEmptyHint}>Tap to choose where you're playing</Text>
              </TouchableOpacity>
            )}
```

- [ ] **Step 5: Verify**

Run: `npx jest`
Expected: PASS — the suite stays green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "feat: SetupScreen consumes picks and shows the layout dropdown"
```

---

## Task 5: `OfficialCreateScreen.js` — consume picks, render the layout dropdown

**Files:**
- Modify: `src/screens/OfficialCreateScreen.js`

- [ ] **Step 1: Add imports**

After the line that imports from `'../lib/selectionBridge'`, add:

```js
import { applyCoursePick, applyLayoutChoice } from '../lib/roundCourse';
import RoundLayoutSelect from '../components/RoundLayoutSelect';
```

- [ ] **Step 2: Replace the `pendingCourses` consume effect body**

Find this block:

```js
    if (pc && pc.courses.length > 0) {
      const { startRoundIndex, courses } = pc;
      (async () => {
        let freshCourses = courses;
        try {
          const all = await fetchCourses();
          freshCourses = courses.map((c) => all.find((x) => x.id === c.id) ?? c);
        } catch (_) { /* keep snapshot */ }
        if (cancelled || !mountedRef.current) return;
        setRounds((prev) => {
          const next = [...prev];
          freshCourses.forEach((course, i) => {
            const idx = startRoundIndex + i;
            const roundData = {
              courseId: course.id,
              courseName: course.name,
              // Deep-copy so later edits don't mutate the library's holes.
              holes: course.holes.map((h) => ({ ...h })),
              slope: course.slope,
              courseRating: course.rating ?? null,
            };
            if (idx < next.length) {
              next[idx] = { ...next[idx], ...roundData };
            } else {
              next.push({ id: newRoundId(), ...roundData });
            }
          });
          return next;
        });
      })();
    }
```

Replace it with:

```js
    if (pc && pc.picks && pc.picks.length > 0) {
      const { startRoundIndex, picks } = pc;
      setRounds((prev) => {
        const next = [...prev];
        picks.forEach((pick, i) => {
          const idx = startRoundIndex + i;
          const base = idx < next.length ? next[idx] : { id: newRoundId() };
          const applied = applyCoursePick(base, pick);
          if (idx < next.length) next[idx] = applied;
          else next.push(applied);
        });
        return next;
      });
    }
```

(The surrounding `useFocusEffect` / `consumePendingCourses()` / `cancelled` / `mountedRef` handling stays. `fetchCourses` may become unused — remove it from its import only if the build flags it and nothing else uses it.)

- [ ] **Step 3: Add the `chooseLayout` handler**

Find the `removeRound` function. Immediately after it, add:

```js
  // Resolve a club-picked round to one of the club's layouts.
  const chooseLayout = useCallback((roundIndex, layoutCourse) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = applyLayoutChoice(next[roundIndex], layoutCourse);
      return next;
    });
  }, []);
```

(If `useCallback` is not already imported from `react` in this file, add it to the `react` import.)

- [ ] **Step 4: Render `RoundLayoutSelect` for club-picked rounds**

In `renderRoundsStep`, find the pick button and error text:

```js
            <TouchableOpacity
              style={s.pickBtn}
              onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
            >
              <Feather
                name={r.courseName ? 'map-pin' : 'plus'}
                size={16}
                color={theme.accent.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={s.pickBtnText}>
                {r.courseName ? `Course: ${r.courseName}` : 'Pick Course from Library'}
              </Text>
            </TouchableOpacity>
            {missingName && (
              <Text style={s.errorText}>{`Round ${i + 1} needs a course.`}</Text>
            )}
```

Replace with:

```js
            {r.club && !(r.courseName || '').trim() ? (
              <RoundLayoutSelect
                club={r.club}
                layouts={r.clubLayouts || []}
                value={r.layoutId ?? null}
                onChange={(layoutCourse) => chooseLayout(i, layoutCourse)}
                onChangeClub={() => navigation.navigate('CoursePicker', { roundIndex: i })}
              />
            ) : (
              <TouchableOpacity
                style={s.pickBtn}
                onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
              >
                <Feather
                  name={r.courseName ? 'map-pin' : 'plus'}
                  size={16}
                  color={theme.accent.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={s.pickBtnText}>
                  {r.courseName ? `Course: ${r.courseName}` : 'Pick a Club or Course'}
                </Text>
              </TouchableOpacity>
            )}
            {missingName && !r.club && (
              <Text style={s.errorText}>{`Round ${i + 1} needs a course.`}</Text>
            )}
```

- [ ] **Step 5: Verify**

Run: `npx jest`
Expected: PASS — the suite stays green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/OfficialCreateScreen.js
git commit -m "feat: OfficialCreateScreen consumes picks and shows the layout dropdown"
```

---

## Self-Review

**Spec coverage:**
- Picker selects club or standalone course, emits `picks` → Task 3.
- `selectionBridge` payload `{ startRoundIndex, picks }` → Task 3 (emit), Tasks 4 & 5 (consume).
- `RoundLayoutSelect` shared component → Task 2; used in Tasks 4 & 5.
- `applyCoursePick` / `applyLayoutChoice` pure helpers → Task 1; used in Tasks 4 & 5.
- Round model gains `club` / `clubLayouts` / `layoutId` → set by the Task 1 helpers.
- "Where are you playing?" three states (filled / club-pending / empty) → Tasks 4 & 5.
- `isStepValid` unchanged (a club-pending round has empty `courseName`) → confirmed; no task needed.
- Accordion removed → Task 3.
- Testing: `roundCourse.js` unit-tested (Task 1); components/screens verified by the green suite — matches the spec.

**Placeholder scan:** none — every step has concrete code or an exact command.

**Type consistency:** A pick is `{ kind:'course', course }` or `{ kind:'club', club, layouts }` — emitted by `confirm()` in Task 3, consumed by `applyCoursePick` in Task 1, called from Tasks 4 & 5. `applyLayoutChoice(round, layoutCourse)` receives a course object — `RoundLayoutSelect`'s `onChange` passes the layout course object (Task 2), wired to `chooseLayout(i, layoutCourse)` in Tasks 4 & 5. Round fields `club` / `clubLayouts` / `layoutId` are written by Task 1's helpers and read by `RoundLayoutSelect` props and the render branches in Tasks 4 & 5 (`r.club`, `r.clubLayouts`, `r.layoutId`). The picker's internal selection is `{ kind, id }` (Task 3 only); the cross-screen `pick` is the richer object — distinct shapes, never interchanged.
