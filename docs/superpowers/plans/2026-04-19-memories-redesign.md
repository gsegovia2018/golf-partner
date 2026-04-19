# Recuerdos Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `GalleryScreen` with a round-stories row (tap → IG-style auto-advance viewer), a persistent hole-activity grid that doubles as a filter, combinable photo/video chips, and a 2-column mosaic with captions. Also fixes the web bug where the filter chips stretch to full height.

**Architecture:** One screen (`GalleryScreen`) composes six leaf components under `src/components/` (prefixed `Memories*` / `MemoryCard`). A single pure-JS helper module (`src/lib/memoriesGalleryData.js`) derives the view-model from `items` + `tournament.rounds`. No schema, hooks, or upload changes — this is a UI rewrite on top of the existing `useTournamentMedia` hook and Supabase rows.

**Tech Stack:** React Native + Expo SDK 54 (React 19, RN 0.81). Uses existing libs: `expo-image`, `expo-av`, `expo-sharing`, `@expo/vector-icons`, safe-area context. No new dependencies. No test framework exists in this project — verify each task manually with `npm run web` and a quick click-through.

**Spec:** `docs/superpowers/specs/2026-04-19-memories-redesign-design.md`

**File plan:**

| File | Purpose |
|---|---|
| Create `src/lib/memoriesGalleryData.js` | Pure helpers: derive round entries, holes-with-media set, kind counts, apply filters |
| Create `src/components/MemoriesRoundRow.js` | Horizontal scroll of round circles; tap opens stories |
| Create `src/components/MemoriesHoleStrip.js` | Always-visible 18-hole grid, activity + filter |
| Create `src/components/MemoriesKindChips.js` | Todo / Foto / Vídeo chip row |
| Create `src/components/MemoryCard.js` | One mosaic card (thumb + tag + caption + meta) |
| Create `src/components/MemoriesStoriesViewer.js` | Fullscreen stories modal with auto-advance |
| Rewrite `src/screens/GalleryScreen.js` | Composes the above into the new layout |

---

## Task 1: Pure helpers — `memoriesGalleryData.js`

**Files:**
- Create: `src/lib/memoriesGalleryData.js`

- [ ] **Step 1: Create the helper module**

Create `src/lib/memoriesGalleryData.js` with the following content:

```js
// Pure view-model helpers for the Recuerdos screen. No React, no hooks —
// everything is a plain function of (items, tournament). Keeps the screen
// logic cheap to reason about and easy to eyeball.

// Index of a round by id, or -1 if the tournament doesn't have it.
export function resolveRoundIndex(roundId, rounds) {
  if (!rounds) return -1;
  return rounds.findIndex((r) => r.id === roundId);
}

// Par value for a given hole inside a round. Returns null if unknown.
export function findParForHole(round, holeIndex) {
  if (!round || holeIndex == null) return null;
  return round.holes?.[holeIndex]?.par ?? null;
}

// Set of hole indices that have at least one media item somewhere in the
// tournament. Items with holeIndex=null are ignored.
export function deriveHolesWithMedia(items) {
  const set = new Set();
  for (const m of items) {
    if (typeof m.holeIndex === 'number') set.add(m.holeIndex);
  }
  return set;
}

// Max hole count across all rounds. Falls back to 18 when a tournament has
// no rounds (shouldn't happen in practice, but keeps the grid from breaking).
export function deriveMaxHoles(rounds) {
  if (!rounds?.length) return 18;
  return Math.max(...rounds.map((r) => r.holes?.length ?? 18));
}

// Counts for the kind chips.
export function deriveKindCounts(items) {
  let photo = 0;
  let video = 0;
  for (const m of items) {
    if (m.kind === 'photo') photo++;
    else if (m.kind === 'video') video++;
  }
  return { all: items.length, photo, video };
}

// Per-round view model entry.
// Items inside come in chronological order (oldest first) so the stories
// viewer reads the round like a timeline. `cover` is the most recent item
// (input `items` from the store is newest-first, so it's the first match).
export function deriveRoundEntries(items, rounds) {
  if (!rounds) return [];
  const byId = new Map();
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    byId.set(r.id, {
      roundId: r.id,
      roundIndex: i,
      courseName: r.courseName ?? '',
      items: [],
      cover: null,
    });
  }
  for (const m of items) {
    const entry = byId.get(m.roundId);
    if (!entry) continue;
    if (!entry.cover) entry.cover = m;
    entry.items.push(m);
  }
  for (const entry of byId.values()) entry.items.reverse();
  return rounds.map((r) => byId.get(r.id));
}

// Apply the combined hole+kind filter to a flat item list.
// hole=null means "any hole"; kind='all' means "any kind".
export function applyFilters(items, { hole, kind }) {
  return items.filter((m) => {
    if (hole != null && m.holeIndex !== hole) return false;
    if (kind === 'photo' && m.kind !== 'photo') return false;
    if (kind === 'video' && m.kind !== 'video') return false;
    return true;
  });
}
```

- [ ] **Step 2: Sanity-check with a tiny REPL**

Run a quick node eval to confirm nothing throws on import:

```bash
node -e "const m = require('./src/lib/memoriesGalleryData.js'); console.log(Object.keys(m));"
```

Expected output: `[ 'resolveRoundIndex', 'findParForHole', 'deriveHolesWithMedia', 'deriveMaxHoles', 'deriveKindCounts', 'deriveRoundEntries', 'applyFilters' ]` (order may vary).

If `require` complains about ESM, skip this step — Metro handles ESM at runtime. The real verification is in Task 6 when the screen imports these.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memoriesGalleryData.js
git commit -m "Add pure helpers for Recuerdos view-model"
```

---

## Task 2: Round stories row — `MemoriesRoundRow.js`

**Files:**
- Create: `src/components/MemoriesRoundRow.js`

- [ ] **Step 1: Create the component**

Create `src/components/MemoriesRoundRow.js`:

```jsx
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const CIRCLE = 56;
const CELL = 66;

export default function MemoriesRoundRow({ entries, onOpenRound }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      {entries.map((entry) => {
        const empty = !entry || entry.items.length === 0;
        return (
          <TouchableOpacity
            key={entry.roundId}
            style={[s.cell, empty && s.cellDim]}
            activeOpacity={empty ? 1 : 0.7}
            onPress={() => { if (!empty) onOpenRound(entry); }}
            disabled={empty}
            accessibilityLabel={`Ronda ${entry.roundIndex + 1}${empty ? ', sin recuerdos' : ''}`}
          >
            <View style={s.avatar}>
              {!empty && entry.cover?.thumbUrl ? (
                <>
                  <Image source={{ uri: entry.cover.thumbUrl }} style={StyleSheet.absoluteFillObject} />
                  <View style={[StyleSheet.absoluteFillObject, s.scrim]} pointerEvents="none" />
                </>
              ) : null}
              <Text style={[s.label, empty && s.labelEmpty]}>R{entry.roundIndex + 1}</Text>
            </View>
            <Text style={[s.course, empty && s.courseEmpty]} numberOfLines={1}>
              {entry.courseName || (empty ? 'Sin fotos' : '')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center' },
  cell: { alignItems: 'center', width: CELL, marginRight: 10 },
  cellDim: { opacity: 0.55 },
  avatar: {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2,
    overflow: 'hidden', backgroundColor: theme.bg.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.22)' },
  label: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 },
  },
  labelEmpty: { color: theme.text.muted, textShadowRadius: 0 },
  course: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 10,
    color: theme.text.primary, marginTop: 4, textAlign: 'center',
    maxWidth: CELL,
  },
  courseEmpty: { color: theme.text.muted },
});
```

- [ ] **Step 2: Smoke-check via import**

Temporarily add an import at the top of `App.js` just to make Metro compile it without wiring anything:

```bash
node -e "require.resolve('./src/components/MemoriesRoundRow.js')" 2>/dev/null || echo "path OK via direct filesystem check only — Metro will bundle."
```

The real render check happens in Task 6. Move on.

- [ ] **Step 3: Commit**

```bash
git add src/components/MemoriesRoundRow.js
git commit -m "Add MemoriesRoundRow: horizontal round circles with cover + course"
```

---

## Task 3: Hole activity grid — `MemoriesHoleStrip.js`

**Files:**
- Create: `src/components/MemoriesHoleStrip.js`

- [ ] **Step 1: Create the component**

Create `src/components/MemoriesHoleStrip.js`:

```jsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function MemoriesHoleStrip({
  maxHoles,
  holesWithMedia,
  activeHole,
  onSelect,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const holes = Array.from({ length: maxHoles }, (_, i) => i);
  const rows = [];
  for (let i = 0; i < holes.length; i += 9) rows.push(holes.slice(i, i + 9));

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>POR HOYO</Text>
        <Text style={s.count}>{holesWithMedia.size} / {maxHoles}</Text>
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.rowGrid}>
          {row.map((i) => {
            const has = holesWithMedia.has(i);
            const on = activeHole === i;
            return (
              <TouchableOpacity
                key={i}
                style={[s.cell, has && s.cellHas, on && s.cellOn]}
                activeOpacity={has ? 0.7 : 1}
                onPress={() => { if (has) onSelect(on ? null : i); }}
                disabled={!has}
                accessibilityLabel={`Hoyo ${i + 1}${has ? '' : ' sin recuerdos'}`}
              >
                <Text style={[
                  s.cellLabel,
                  has && s.cellLabelHas,
                  on && s.cellLabelOn,
                ]}>
                  {i + 1}
                </Text>
              </TouchableOpacity>
            );
          })}
          {Array.from({ length: 9 - row.length }).map((_, k) => (
            <View key={'pad' + k} style={s.cellPad} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: theme.text.muted,
  },
  count: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    color: theme.text.muted,
  },
  rowGrid: { flexDirection: 'row', marginBottom: 4, gap: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 6,
    backgroundColor: theme.bg.primary,
    borderWidth: 1,
    borderColor: theme.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPad: { flex: 1, aspectRatio: 1 },
  cellHas: {
    backgroundColor: theme.bg.primary,
    borderColor: theme.accent.primary,
  },
  cellOn: {
    backgroundColor: theme.accent.primary,
    borderColor: theme.accent.primary,
  },
  cellLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    color: theme.text.muted,
  },
  cellLabelHas: { color: theme.text.primary },
  cellLabelOn: { color: theme.text.inverse },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MemoriesHoleStrip.js
git commit -m "Add MemoriesHoleStrip: 18-cell hole grid with activity + filter"
```

---

## Task 4: Kind chips — `MemoriesKindChips.js`

**Files:**
- Create: `src/components/MemoriesKindChips.js`

- [ ] **Step 1: Create the component**

Create `src/components/MemoriesKindChips.js`:

```jsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function MemoriesKindChips({ counts, active, onChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const kinds = [
    { key: 'all', label: `Todo · ${counts.all}`, icon: null },
    { key: 'photo', label: `Foto · ${counts.photo}`, icon: 'camera' },
    { key: 'video', label: `Vídeo · ${counts.video}`, icon: 'video' },
  ];

  return (
    <View style={s.row}>
      {kinds.map((k) => {
        const on = active === k.key;
        return (
          <TouchableOpacity
            key={k.key}
            style={[s.chip, on && s.chipOn]}
            onPress={() => onChange(k.key)}
            accessibilityLabel={k.label}
          >
            {k.icon ? (
              <Feather
                name={k.icon}
                size={12}
                color={on ? theme.text.inverse : theme.text.primary}
                style={{ marginRight: 4 }}
              />
            ) : null}
            <Text style={[s.label, on && s.labelOn]}>{k.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.bg.secondary,
  },
  chipOn: { backgroundColor: theme.accent.primary },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: theme.text.primary,
  },
  labelOn: { color: theme.text.inverse },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MemoriesKindChips.js
git commit -m "Add MemoriesKindChips: combinable Todo/Foto/Vídeo filter"
```

---

## Task 5: Memory card — `MemoryCard.js`

**Files:**
- Create: `src/components/MemoryCard.js`

- [ ] **Step 1: Create the component**

Create `src/components/MemoryCard.js`:

```jsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Asks the image for its intrinsic aspect ratio so the card keeps the
// native shape instead of forcing everything square. Defaults to 1 while
// loading and on error; harmless if we can't measure.
function useImageAspect(uri) {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => { if (!cancelled && w > 0 && h > 0) setRatio(w / h); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [uri]);
  return ratio;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function formatDuration(s) {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function MemoryCard({ item, roundIndex, onPress }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const ratio = useImageAspect(item.thumbUrl);

  const holePart = typeof item.holeIndex === 'number' ? `·H${item.holeIndex + 1}` : '';
  const tag = `R${roundIndex + 1}${holePart}`;
  const time = formatTime(item.createdAt);
  const who = item.uploaderLabel ? `${item.uploaderLabel} · ${time}` : time;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.imgWrap, { aspectRatio: ratio }]}>
        <Image source={{ uri: item.thumbUrl }} style={StyleSheet.absoluteFillObject} />
        <View style={s.hTag}>
          <Text style={s.hTagText}>{tag}</Text>
        </View>
        {item.kind === 'video' ? (
          <View style={s.vTag}>
            <Feather name="play" size={10} color="#fff" />
            {item.durationS ? (
              <Text style={s.vTagText}>{formatDuration(item.durationS)}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={s.body}>
        {item.caption ? (
          <Text style={s.caption} numberOfLines={2}>{item.caption}</Text>
        ) : null}
        <Text style={s.meta}>{who}</Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 10,
    overflow: 'hidden',
  },
  imgWrap: {
    width: '100%',
    backgroundColor: theme.bg.primary,
  },
  hTag: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 999,
  },
  hTagText: {
    color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10,
  },
  vTag: {
    position: 'absolute', top: 6, right: 6,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, gap: 3,
  },
  vTagText: {
    color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9,
  },
  body: { padding: 8, paddingBottom: 10 },
  caption: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12, color: theme.text.primary, lineHeight: 16,
  },
  meta: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 10, color: theme.text.muted, marginTop: 3,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MemoryCard.js
git commit -m "Add MemoryCard: native-aspect thumb + hole tag + caption + meta"
```

---

## Task 6: Rewrite `GalleryScreen.js` to use the new components

**Files:**
- Modify: `src/screens/GalleryScreen.js` (full rewrite)

- [ ] **Step 1: Replace the screen**

Overwrite `src/screens/GalleryScreen.js` with:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';
import { loadTournament } from '../store/tournamentStore';
import MediaLightbox from '../components/MediaLightbox';
import MemoriesRoundRow from '../components/MemoriesRoundRow';
import MemoriesHoleStrip from '../components/MemoriesHoleStrip';
import MemoriesKindChips from '../components/MemoriesKindChips';
import MemoryCard from '../components/MemoryCard';
import {
  deriveRoundEntries,
  deriveHolesWithMedia,
  deriveMaxHoles,
  deriveKindCounts,
  applyFilters,
  resolveRoundIndex,
} from '../lib/memoriesGalleryData';

export default function GalleryScreen({ route, navigation }) {
  const { tournamentId } = route.params ?? {};
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { items } = useTournamentMedia(tournamentId);
  const [tournament, setTournament] = useState(null);
  const [activeHole, setActiveHole] = useState(null);
  const [activeKind, setActiveKind] = useState('all');
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });

  useEffect(() => { loadTournament().then(setTournament); }, []);

  const rounds = tournament?.rounds;
  const maxHoles = useMemo(() => deriveMaxHoles(rounds), [rounds]);
  const roundEntries = useMemo(() => deriveRoundEntries(items, rounds), [items, rounds]);
  const holesWithMedia = useMemo(() => deriveHolesWithMedia(items), [items]);
  const counts = useMemo(() => deriveKindCounts(items), [items]);
  const filtered = useMemo(
    () => applyFilters(items, { hole: activeHole, kind: activeKind }),
    [items, activeHole, activeKind],
  );

  // 2-column mosaic: alternate items into two columns by index.
  const [leftCol, rightCol] = useMemo(() => {
    const L = []; const R = [];
    filtered.forEach((it, i) => { (i % 2 === 0 ? L : R).push({ it, i }); });
    return [L, R];
  }, [filtered]);

  const openCard = (filteredIndex) => setLightbox({ visible: true, index: filteredIndex });

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Recuerdos</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.subtitle}>
          {items.length} · {tournament?.name ?? ''}
        </Text>

        {rounds?.length ? (
          <MemoriesRoundRow
            entries={roundEntries}
            onOpenRound={() => {
              // Task 7 wires this to the stories viewer.
            }}
          />
        ) : null}

        <MemoriesHoleStrip
          maxHoles={maxHoles}
          holesWithMedia={holesWithMedia}
          activeHole={activeHole}
          onSelect={setActiveHole}
        />

        <MemoriesKindChips
          counts={counts}
          active={activeKind}
          onChange={setActiveKind}
        />

        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="image" size={32} color={theme.text.muted} />
            <Text style={s.emptyText}>Sin recuerdos para este filtro.</Text>
          </View>
        ) : (
          <View style={s.mosaic}>
            <View style={s.col}>
              {leftCol.map(({ it, i }) => (
                <MemoryCard
                  key={it.id}
                  item={it}
                  roundIndex={resolveRoundIndex(it.roundId, rounds)}
                  onPress={() => openCard(i)}
                />
              ))}
            </View>
            <View style={s.col}>
              {rightCol.map(({ it, i }) => (
                <MemoryCard
                  key={it.id}
                  item={it}
                  roundIndex={resolveRoundIndex(it.roundId, rounds)}
                  onPress={() => openCard(i)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <MediaLightbox
        visible={lightbox.visible}
        items={filtered}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ visible: false, index: 0 })}
      />
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { padding: 4 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  scroll: { paddingBottom: 32, gap: 10 },
  subtitle: {
    paddingHorizontal: 16, marginTop: -4, marginBottom: 4,
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted,
  },
  mosaic: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  col: { flex: 1, gap: 6 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: {
    marginTop: 8, color: theme.text.muted,
    fontFamily: 'PlusJakartaSans-Regular',
  },
});
```

- [ ] **Step 2: Start the web dev server**

```bash
npm run web
```

- [ ] **Step 3: Manual smoke check**

Open the app, navigate into a tournament, tap the "Ver todos los N" link in `TournamentMemoriesSection` (or `Recuerdos` entry point on home). Verify:
- Header "Recuerdos" with subtitle `{count} · {tournament name}`.
- Round circles scroll horizontally; each has the round number inside, course name below, empty rounds look dimmed.
- Hole grid renders with correct `N / 18` counter; tapping a lit hole filters the mosaic; tapping the same hole again clears the filter.
- Kind chips `Todo · N / Foto · N / Vídeo · N` switch the filter.
- Mosaic cards show native aspect, caption when present, author + time.
- Tapping a card opens the existing `MediaLightbox`.
- The old "chips row stretched huge on web" bug is gone.

Fix any wiring issues inline before committing.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GalleryScreen.js
git commit -m "Rewrite GalleryScreen: round row + hole strip + kind chips + mosaic"
```

---

## Task 7: Stories viewer — `MemoriesStoriesViewer.js` + wire it up

**Files:**
- Create: `src/components/MemoriesStoriesViewer.js`
- Modify: `src/screens/GalleryScreen.js` (wire `onOpenRound`)

- [ ] **Step 1: Create the stories viewer**

Create `src/components/MemoriesStoriesViewer.js`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { findParForHole } from '../lib/memoriesGalleryData';

const { width, height } = Dimensions.get('window');
const PHOTO_MS = 4000;
const TICK_MS = 50;

export default function MemoriesStoriesViewer({ visible, entry, round, onClose }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 of current item
  const [paused, setPaused] = useState(false);
  const longPressedRef = useRef(false);
  const videoRef = useRef(null);

  const items = entry?.items ?? [];
  const current = items[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    setProgress(0);
    setPaused(false);
  }, [visible, entry?.roundId]);

  useEffect(() => { setProgress(0); }, [index]);

  // Photo auto-advance. Videos drive advance via onPlaybackStatusUpdate.
  useEffect(() => {
    if (!visible || paused || !current || current.kind !== 'photo') return;
    const start = Date.now() - progress * PHOTO_MS;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / PHOTO_MS);
      setProgress(p);
      if (p >= 1) advance();
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused, index, current?.id]);

  if (!visible || !current) return null;

  const advance = () => {
    if (index + 1 >= items.length) {
      onClose();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const back = () => {
    if (index > 0) setIndex((i) => i - 1);
  };

  const onLongPress = () => { longPressedRef.current = true; setPaused(true); };
  const onPressOut = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      setPaused(false);
    }
  };

  const par = findParForHole(round, current.holeIndex);
  const holeLabel =
    current.holeIndex == null
      ? null
      : par != null
        ? `Hoyo ${current.holeIndex + 1} · Par ${par}`
        : `Hoyo ${current.holeIndex + 1}`;
  const time = (() => {
    try { return new Date(current.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  })();

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={s.container}>
        {/* Media */}
        {current.kind === 'photo' ? (
          <ExpoImage
            source={{ uri: current.url }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
          />
        ) : (
          <Video
            ref={videoRef}
            source={{ uri: current.url }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={!paused}
            isLooping={false}
            onPlaybackStatusUpdate={(st) => {
              if (!st.isLoaded) return;
              const total = st.durationMillis ?? 0;
              const pos = st.positionMillis ?? 0;
              if (total > 0) setProgress(Math.min(1, pos / total));
              if (st.didJustFinish) advance();
            }}
          />
        )}

        {/* Progress bars */}
        <View style={s.bars}>
          {items.map((_, i) => {
            const fill = i < index ? 1 : i === index ? progress : 0;
            return (
              <View key={i} style={s.bar}>
                <View style={[s.barFill, { width: `${fill * 100}%` }]} />
              </View>
            );
          })}
        </View>

        {/* Top bar */}
        <View style={s.top}>
          <View style={s.topLeft}>
            <Text style={s.topLabel}>
              R{(entry?.roundIndex ?? 0) + 1}
              {entry?.courseName ? ` · ${entry.courseName}` : ''}
              {` · ${index + 1}/${items.length}`}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityLabel="Cerrar">
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Tap zones */}
        <View style={s.tapRow}>
          <Pressable
            style={s.tapLeft}
            onPress={back}
            onLongPress={onLongPress}
            onPressOut={onPressOut}
            delayLongPress={180}
          />
          <Pressable
            style={s.tapRight}
            onPress={advance}
            onLongPress={onLongPress}
            onPressOut={onPressOut}
            delayLongPress={180}
          />
        </View>

        {/* Footer */}
        <View style={s.footer}>
          {holeLabel ? (
            <View style={s.holeChip}><Text style={s.holeChipText}>{holeLabel}</Text></View>
          ) : null}
          {current.caption ? (
            <Text style={s.caption} numberOfLines={3}>{current.caption}</Text>
          ) : null}
          <Text style={s.meta}>
            {current.uploaderLabel ? `${current.uploaderLabel} · ${time}` : time}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', width, height },
  bars: {
    position: 'absolute', top: 10, left: 8, right: 8,
    flexDirection: 'row', gap: 3, zIndex: 3,
  },
  bar: { flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#fff' },
  top: {
    position: 'absolute', top: 24, left: 12, right: 12, zIndex: 3,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  topLeft: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99,
  },
  topLabel: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12 },
  closeBtn: { padding: 6, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 99 },
  tapRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 2 },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  footer: {
    position: 'absolute', bottom: 32, left: 16, right: 16, zIndex: 3,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, padding: 12,
  },
  holeChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99,
    marginBottom: 6,
  },
  holeChipText: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  caption: { color: '#fff', fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, marginBottom: 4 },
  meta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'PlusJakartaSans-Regular', fontSize: 11 },
});
```

- [ ] **Step 2: Wire the viewer into `GalleryScreen.js`**

Edit `src/screens/GalleryScreen.js`. Add the import near the other component imports:

```jsx
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';
```

Add stories state near the other `useState` calls:

```jsx
const [stories, setStories] = useState({ visible: false, entry: null });
```

Replace the existing `onOpenRound` placeholder on `MemoriesRoundRow`:

```jsx
<MemoriesRoundRow
  entries={roundEntries}
  onOpenRound={(entry) => setStories({ visible: true, entry })}
/>
```

Add the viewer near the bottom, next to `MediaLightbox`:

```jsx
<MemoriesStoriesViewer
  visible={stories.visible}
  entry={stories.entry}
  round={rounds?.[stories.entry?.roundIndex ?? -1] ?? null}
  onClose={() => setStories({ visible: false, entry: null })}
/>
```

- [ ] **Step 3: Manual smoke check**

With `npm run web` running:
- Tap a round circle with photos → viewer opens on item 1, progress bar starts filling, and at 4 s it advances.
- Tap the right 2/3 of the screen → next item immediately.
- Tap the left 1/3 → previous item (stays at 0 when already on first).
- Press-and-hold anywhere → progress pauses; release → it resumes.
- Reach the last item and tap right → viewer closes.
- Round circle with no media → nothing happens (and the circle looks dimmed).
- If a video is in the round → it plays, progress tracks playback, advances on end.
- Top label shows `R{n} · {course} · {i+1}/{total}`.
- Footer shows `Hoyo N · Par P`, caption (if any), uploader + time.

- [ ] **Step 4: Commit**

```bash
git add src/components/MemoriesStoriesViewer.js src/screens/GalleryScreen.js
git commit -m "Add MemoriesStoriesViewer: auto-advance stories per round, wire into Gallery"
```

---

## Self-review notes

- Spec section "Header" → Task 6.
- Spec section "Round stories row" → Task 2 + Task 7 wiring.
- Spec section "Hole activity strip" → Task 3 + Task 6 wiring.
- Spec section "Kind chips" → Task 4 + Task 6 wiring.
- Spec section "Masonry grid" → Task 5 (card) + Task 6 (two-column layout).
- Spec section "Stories viewer" → Task 7.
- Spec "Web chip stretching fix" → resolved implicitly by the Task 6 rewrite (no horizontal ScrollView of chips anymore).
- Spec "No schema changes / hook changes" → confirmed; plan touches only `src/lib/`, `src/components/`, and `src/screens/GalleryScreen.js`.
- Spec "Items with holeIndex=null" → handled by `deriveHolesWithMedia` (ignored) and `MemoryCard` (tag reads just `R{n}`), and `MemoriesStoriesViewer` (no hole chip rendered).
