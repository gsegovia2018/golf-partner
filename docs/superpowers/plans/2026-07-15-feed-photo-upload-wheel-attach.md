# Feed Photo Uploads + Wheel-Based Attach Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add photos to a round straight from its feed card, with a redesigned attach sheet that picks round + hole via side-by-side scroll wheels, rolled out to every upload flow.

**Architecture:** A new generic `WheelPicker` component (ScrollView + snapToInterval, no new dependency) powers a redesigned `AttachMediaSheet` (round wheel + hole wheel) and the header of `BatchAttachSheet`. A new `useMediaAttachFlow` hook extracts the capture-menu → pick → attach orchestration currently duplicated in GalleryScreen and ScorecardScreen; FeedScreen becomes its third consumer via a camera chip on own-round feed cards. All attach-flow copy migrates Spanish → English.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, react-native-web, Jest (jest-expo) + @testing-library/react-native, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-07-15-feed-photo-upload-wheel-attach-design.md`

## Global Constraints

- No new npm dependencies. The wheel is a custom ScrollView component.
- Must work identically on web (`react-native-web`) and Android — never use platform-only pickers.
- All new/changed UI copy in English (exact strings in tasks below).
- Domain logic lives in stores/hooks/lib, not screens (CLAUDE.md).
- Fonts/colors come from `useTheme()` tokens: sans `PlusJakartaSans-*`, serif `PlayfairDisplay-*`, accent `theme.accent.primary`.
- `onConfirm` payload of AttachMediaSheet: `{ roundIndex, roundId, holeIndex, caption, uploaderLabel }` (holeIndex `null` = no hole).
- Feed camera chip only when `item.withMe || item.isMine`.
- `npm test` and `npm run lint` must pass at every commit. Note: jest runs from the main checkout may scan stale `.claude/worktrees`/`.worktrees` copies — failures in those paths are noise, ignore them.

## Placement clarification (spec deviation, intentional)

The spec says "FeedRoundCard gains `onAddPhoto`". The approved placement — "in the action row next to React/Comments" — is the `ReactionBar` row, which is a private component of `FeedScreen.js` passed to `FeedRoundCard` as `children`. So the chip is implemented in `ReactionBar` (Task 8), and `FeedRoundCard` is untouched. Spec intent (placement + own-rounds gating) is preserved.

---

### Task 1: `WheelPicker` component

**Files:**
- Create: `src/components/WheelPicker.js`
- Test: `src/components/__tests__/WheelPicker.test.js`

**Interfaces:**
- Produces: default export `WheelPicker({ items, selectedIndex, onChange, testID })` where `items: [{ key, label, sublabel? }]`; named exports `snapIndex(offsetY, itemCount, rowHeight?)` and `WHEEL_ROW_HEIGHT` (36).

- [ ] **Step 1: Write the failing test**

```js
// src/components/__tests__/WheelPicker.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import WheelPicker, { snapIndex, WHEEL_ROW_HEIGHT } from '../WheelPicker';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ITEMS = [
  { key: 'none', label: 'No hole' },
  { key: '0', label: 'Hole 1', sublabel: 'Par 4' },
  { key: '1', label: 'Hole 2', sublabel: 'Par 3' },
];

describe('snapIndex', () => {
  test('rounds an offset to the nearest row', () => {
    expect(snapIndex(0, 3)).toBe(0);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 1.4, 3)).toBe(1);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 1.6, 3)).toBe(2);
  });

  test('clamps to the item range', () => {
    expect(snapIndex(-50, 3)).toBe(0);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 99, 3)).toBe(2);
    expect(snapIndex(120, 0)).toBe(0);
  });
});

describe('WheelPicker', () => {
  test('renders labels and sublabels', () => {
    const { getByText } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={jest.fn()} />
    ));
    expect(getByText('No hole')).toBeTruthy();
    expect(getByText('Hole 2')).toBeTruthy();
    expect(getByText('Par 3')).toBeTruthy();
  });

  test('tapping a row selects it', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={onChange} />
    ));
    fireEvent.press(getByLabelText('Hole 2, Par 3'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('momentum scroll end snaps to the nearest index', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={onChange} testID="wheel" />
    ));
    fireEvent(getByTestId('wheel-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { y: WHEEL_ROW_HEIGHT * 2 } },
    });
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/WheelPicker.test.js`
Expected: FAIL — "Cannot find module '../WheelPicker'"

- [ ] **Step 3: Write the implementation**

```js
// src/components/WheelPicker.js
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export const WHEEL_ROW_HEIGHT = 36;
// Odd count → exactly one row sits in the center selection band.
const VISIBLE_ROWS = 3;

// Pure: converts a scroll offset into the snapped, clamped item index.
export function snapIndex(offsetY, itemCount, rowHeight = WHEEL_ROW_HEIGHT) {
  if (itemCount <= 0) return 0;
  const raw = Math.round(offsetY / rowHeight);
  return Math.max(0, Math.min(itemCount - 1, raw));
}

// Snap-scroll wheel (native date-picker feel) built on ScrollView so it
// behaves the same on web and Android. Rows are also tappable — on web,
// wheel-scrolling small areas is fiddly and momentum events don't fire.
export default function WheelPicker({ items, selectedIndex, onChange, testID }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const scrollRef = useRef(null);
  const pad = WHEEL_ROW_HEIGHT * ((VISIBLE_ROWS - 1) / 2);

  // Keep the wheel aligned with the controlled selection — initial mount and
  // external changes (e.g. the hole reset after a round switch).
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: selectedIndex * WHEEL_ROW_HEIGHT, animated: false });
  }, [selectedIndex, items.length]);

  const settle = (e) => {
    const idx = snapIndex(e.nativeEvent?.contentOffset?.y ?? 0, items.length);
    if (idx !== selectedIndex) onChange(idx);
  };

  return (
    <View style={s.wrap} testID={testID}>
      <View pointerEvents="none" style={s.selectionBand} />
      <ScrollView
        ref={scrollRef}
        testID={testID ? `${testID}-scroll` : undefined}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        contentContainerStyle={{ paddingVertical: pad }}
        nestedScrollEnabled
      >
        {items.map((item, i) => (
          <Pressable
            key={item.key}
            style={s.row}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityLabel={item.sublabel ? `${item.label}, ${item.sublabel}` : item.label}
          >
            <Text
              style={[s.label, i === selectedIndex && s.labelSelected]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.sublabel ? (
              <Text
                style={[s.sublabel, i === selectedIndex && s.sublabelSelected]}
                numberOfLines={1}
              >
                {item.sublabel}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={[s.fade, s.fadeTop]} />
      <View pointerEvents="none" style={[s.fade, s.fadeBottom]} />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    flex: 1,
    height: WHEEL_ROW_HEIGHT * VISIBLE_ROWS,
    maxHeight: WHEEL_ROW_HEIGHT * VISIBLE_ROWS,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border.default,
    backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
    overflow: 'hidden',
  },
  selectionBand: {
    position: 'absolute',
    top: WHEEL_ROW_HEIGHT,
    height: WHEEL_ROW_HEIGHT,
    left: 6,
    right: 6,
    borderRadius: 8,
    backgroundColor: theme.accent.light,
    borderWidth: 1,
    borderColor: theme.accent.primary,
  },
  row: {
    height: WHEEL_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: theme.text.muted,
  },
  labelSelected: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 14,
    color: theme.accent.primary,
  },
  sublabel: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 9.5,
    color: theme.text.muted,
  },
  sublabelSelected: {
    color: theme.accent.primary,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WHEEL_ROW_HEIGHT * 0.7,
    backgroundColor: theme.bg.primary,
    opacity: 0.45,
  },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/__tests__/WheelPicker.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/WheelPicker.js src/components/__tests__/WheelPicker.test.js
git commit -m "feat(media): WheelPicker snap-scroll wheel component"
```

---

### Task 2: Redesign `AttachMediaSheet` with round + hole wheels

**Files:**
- Modify: `src/components/AttachMediaSheet.js` (full rewrite of the body; keep `VideoPreview` and the AsyncStorage uploader persistence)
- Test: `src/components/__tests__/AttachMediaSheet.test.js` (new)

**Interfaces:**
- Consumes: `WheelPicker` from Task 1.
- Produces: default export `AttachMediaSheet({ visible, asset, rounds, defaultRoundIndex, defaultHoleIndex, onCancel, onConfirm })`. `onConfirm` receives `{ roundIndex, roundId, holeIndex, caption, uploaderLabel }` (`holeIndex` null = no hole; `roundId` = `rounds[roundIndex]?.id ?? null`). The old `holes` prop is gone.

- [ ] **Step 1: Write the failing test**

```js
// src/components/__tests__/AttachMediaSheet.test.js
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import AttachMediaSheet from '../AttachMediaSheet';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: jest.fn(() => ({})),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const holes18 = Array.from({ length: 18 }, (_, i) => ({ par: i === 2 ? 5 : 4 }));
const holes9 = Array.from({ length: 9 }, () => ({ par: 3 }));
const ROUNDS = [
  { id: 'r1', courseName: 'Poniente', holes: holes18 },
  { id: 'r2', courseName: 'Levante', holes: holes9 },
];
const ASSET = { kind: 'photo', localUri: 'file://a.jpg' };

const setup = (props = {}) => {
  const onConfirm = jest.fn();
  const utils = render(wrap(
    <AttachMediaSheet
      visible
      asset={ASSET}
      rounds={ROUNDS}
      defaultRoundIndex={0}
      defaultHoleIndex={null}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
      {...props}
    />
  ));
  return { onConfirm, ...utils };
};

describe('AttachMediaSheet', () => {
  test('shows round and hole wheels for a multi-round tournament', () => {
    const { getByTestId } = setup();
    expect(getByTestId('attach-round-wheel')).toBeTruthy();
    expect(getByTestId('attach-hole-wheel')).toBeTruthy();
  });

  test('hides the round wheel when there is a single round', () => {
    const { queryByTestId, getByTestId } = setup({ rounds: [ROUNDS[0]] });
    expect(queryByTestId('attach-round-wheel')).toBeNull();
    expect(getByTestId('attach-hole-wheel')).toBeTruthy();
  });

  test('confirm payload carries the picked round and hole', async () => {
    const { onConfirm, getByLabelText, getByText } = setup();
    fireEvent.press(getByLabelText('Hole 3, Par 5'));
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      roundIndex: 0,
      roundId: 'r1',
      holeIndex: 2,
      caption: null,
      uploaderLabel: null,
    }));
  });

  test('switching to a shorter round resets an out-of-range hole to No hole', async () => {
    const { onConfirm, getByLabelText, getByText } = setup();
    fireEvent.press(getByLabelText('Hole 12, Par 4'));
    fireEvent.press(getByLabelText('R2, Levante'));
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      roundIndex: 1,
      roundId: 'r2',
      holeIndex: null,
      caption: null,
      uploaderLabel: null,
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/AttachMediaSheet.test.js`
Expected: FAIL — no `attach-round-wheel` testID, English labels missing (component still renders "Guardar" and the old hole grid).

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/components/AttachMediaSheet.js` with:

```js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import WheelPicker from './WheelPicker';

const UPLOADER_KEY = '@golf_uploader_label';

export default function AttachMediaSheet({
  visible, asset, rounds, defaultRoundIndex, defaultHoleIndex, onCancel, onConfirm,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [roundIndex, setRoundIndex] = useState(defaultRoundIndex ?? 0);
  // Hole wheel index 0 is "No hole"; hole N is wheel index N.
  const [holeWheelIndex, setHoleWheelIndex] = useState((defaultHoleIndex ?? -1) + 1);
  const [caption, setCaption] = useState('');
  const [uploader, setUploader] = useState('');

  useEffect(() => {
    if (!visible) return;
    setRoundIndex(defaultRoundIndex ?? 0);
    setHoleWheelIndex((defaultHoleIndex ?? -1) + 1);
    setCaption('');
    AsyncStorage.getItem(UPLOADER_KEY).then((v) => setUploader(v ?? ''));
  }, [visible, defaultRoundIndex, defaultHoleIndex]);

  const round = rounds?.[roundIndex];
  const holes = round?.holes ?? [];

  const roundItems = useMemo(() => (rounds ?? []).map((r, i) => ({
    key: r.id ?? String(i),
    label: `R${i + 1}`,
    sublabel: r.courseName || undefined,
  })), [rounds]);

  const holeItems = useMemo(() => [
    { key: 'none', label: 'No hole' },
    ...holes.map((h, i) => ({
      key: String(i),
      label: `Hole ${i + 1}`,
      sublabel: h?.par ? `Par ${h.par}` : undefined,
    })),
  ], [holes]);

  if (!asset) return null;

  const onRoundChange = (i) => {
    setRoundIndex(i);
    const nextHoles = rounds?.[i]?.holes ?? [];
    // The previously picked hole may not exist on the new round.
    if (holeWheelIndex - 1 >= nextHoles.length) setHoleWheelIndex(0);
  };

  const submit = async () => {
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    onConfirm({
      roundIndex,
      roundId: round?.id ?? null,
      holeIndex: holeWheelIndex === 0 ? null : holeWheelIndex - 1,
      caption: caption.trim() || null,
      uploaderLabel: uploader.trim() || null,
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>Add photo</Text>
        <TouchableOpacity onPress={onCancel} accessibilityLabel="Cancel">
          <Feather name="x" size={22} color={theme.text.muted} />
        </TouchableOpacity>
      </View>

      {asset.kind === 'photo' ? (
        <Image source={{ uri: asset.localUri }} style={s.preview} resizeMode="cover" />
      ) : (
        <VideoPreview uri={asset.localUri} style={s.preview} />
      )}

      <Text style={s.sectionLabel}>Round &amp; hole</Text>
      <View style={s.wheels}>
        {(rounds?.length ?? 0) > 1 ? (
          <WheelPicker
            testID="attach-round-wheel"
            items={roundItems}
            selectedIndex={roundIndex}
            onChange={onRoundChange}
          />
        ) : null}
        <WheelPicker
          testID="attach-hole-wheel"
          items={holeItems}
          selectedIndex={holeWheelIndex}
          onChange={setHoleWheelIndex}
        />
      </View>

      <Text style={s.sectionLabel}>Caption (optional)</Text>
      <TextInput
        style={s.input}
        value={caption}
        onChangeText={setCaption}
        placeholder="e.g. Bunker drama on 7"
        placeholderTextColor={theme.text.muted}
      />

      <Text style={s.sectionLabel}>Your name (optional)</Text>
      <TextInput
        style={s.input}
        value={uploader}
        onChangeText={setUploader}
        placeholder="e.g. Noé"
        placeholderTextColor={theme.text.muted}
      />

      <TouchableOpacity style={s.saveBtn} onPress={submit}>
        <Text style={s.saveLabel}>Save</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function VideoPreview({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 36,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: theme.bg.secondary, marginBottom: 16, overflow: 'hidden' },
  sectionLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  wheels: { flexDirection: 'row', gap: 10 },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.accent.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/__tests__/AttachMediaSheet.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the wider suite — callers still pass old props**

Run: `npx jest src/screens src/components`
Expected: PASS. ScorecardScreen tests mock AttachMediaSheet to null; GalleryScreen has no test. The real callers are migrated in Tasks 6–7. If anything else fails, fix before committing.

- [ ] **Step 6: Commit**

```bash
git add src/components/AttachMediaSheet.js src/components/__tests__/AttachMediaSheet.test.js
git commit -m "feat(media): AttachMediaSheet round+hole wheels, English copy"
```

---

### Task 3: `BatchAttachSheet` header wheels + English copy

**Files:**
- Modify: `src/components/BatchAttachSheet.js`
- Test: `src/components/__tests__/BatchAttachSheet.test.js` (new)

**Interfaces:**
- Consumes: `WheelPicker` from Task 1.
- Produces: same props as before (`{ visible, assets, rounds, defaultRoundIndex, onCancel, onConfirm }`), same `onConfirm` payload (`[{ asset, roundId, holeIndex, caption, uploaderLabel }]`). Only the header controls and copy change.

- [ ] **Step 1: Write the failing test**

```js
// src/components/__tests__/BatchAttachSheet.test.js
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import BatchAttachSheet from '../BatchAttachSheet';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ROUNDS = [
  { id: 'r1', courseName: 'Poniente', holes: Array.from({ length: 18 }, () => ({ par: 4 })) },
  { id: 'r2', courseName: 'Levante', holes: Array.from({ length: 9 }, () => ({ par: 3 })) },
];
const ASSETS = [
  { kind: 'photo', localUri: 'file://a.jpg' },
  { kind: 'photo', localUri: 'file://b.jpg' },
];

describe('BatchAttachSheet', () => {
  test('renders wheels and English copy', () => {
    const { getByTestId, getByText } = render(wrap(
      <BatchAttachSheet
        visible
        assets={ASSETS}
        rounds={ROUNDS}
        defaultRoundIndex={0}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />
    ));
    expect(getByText('Attach 2 memories')).toBeTruthy();
    expect(getByTestId('batch-round-wheel')).toBeTruthy();
    expect(getByTestId('batch-hole-wheel')).toBeTruthy();
    expect(getByText('Save 2')).toBeTruthy();
  });

  test('applies the wheel-picked round and hole to every asset', async () => {
    const onConfirm = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <BatchAttachSheet
        visible
        assets={ASSETS}
        rounds={ROUNDS}
        defaultRoundIndex={0}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    ));
    fireEvent.press(getByLabelText('R2, Levante'));
    fireEvent.press(getByLabelText('Hole 3, Par 3'));
    fireEvent.press(getByText('Save 2'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ roundId: 'r2', holeIndex: 2 });
    expect(payload[1]).toMatchObject({ roundId: 'r2', holeIndex: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/BatchAttachSheet.test.js`
Expected: FAIL — "Attach 2 memories" not found (still "Adjuntar 2 recuerdos"), no wheel testIDs.

- [ ] **Step 3: Modify the component**

In `src/components/BatchAttachSheet.js`:

a) Add the import:

```js
import WheelPicker from './WheelPicker';
```

b) Replace the `batchHole` state with a wheel index (0 = "No hole"). Change:

```js
  const [roundIndex, setRoundIndex] = useState(defaultRoundIndex ?? 0);
  const [batchHole, setBatchHole] = useState(null);
```

to:

```js
  const [roundIndex, setRoundIndex] = useState(defaultRoundIndex ?? 0);
  // Header hole wheel: index 0 is "No hole"; hole N is wheel index N.
  const [batchHoleWheelIndex, setBatchHoleWheelIndex] = useState(0);
```

and in the `useEffect` reset block change `setBatchHole(null);` to `setBatchHoleWheelIndex(0);`.

c) Below `const holes = round?.holes ?? [];` add derived values and a round-change handler:

```js
  const batchHole = batchHoleWheelIndex === 0 ? null : batchHoleWheelIndex - 1;

  const roundItems = useMemo(() => (rounds ?? []).map((r, i) => ({
    key: r.id ?? String(i),
    label: `R${i + 1}`,
    sublabel: r.courseName || undefined,
  })), [rounds]);

  const holeItems = useMemo(() => [
    { key: 'none', label: 'No hole' },
    ...holes.map((h, i) => ({
      key: String(i),
      label: `Hole ${i + 1}`,
      sublabel: h?.par ? `Par ${h.par}` : undefined,
    })),
  ], [holes]);

  const onRoundChange = (i) => {
    setRoundIndex(i);
    const nextHoles = rounds?.[i]?.holes ?? [];
    if (batchHoleWheelIndex - 1 >= nextHoles.length) setBatchHoleWheelIndex(0);
  };
```

(`effective` keeps using `batchHole`, which is recomputed each render, so its `useMemo` dependency array stays `[assets, perItem, batchHole, batchCaption]`.)

d) Replace the two header chip rows (the "Ronda" label + round chips `ScrollView`, and the "Aplicar a todas — hoyo" label + hole chips `ScrollView`) with:

```jsx
            <Text style={s.sectionLabel}>Apply to all — round &amp; hole</Text>
            <View style={s.wheels}>
              {(rounds?.length ?? 0) > 1 ? (
                <WheelPicker
                  testID="batch-round-wheel"
                  items={roundItems}
                  selectedIndex={roundIndex}
                  onChange={onRoundChange}
                />
              ) : null}
              <WheelPicker
                testID="batch-hole-wheel"
                items={holeItems}
                selectedIndex={batchHoleWheelIndex}
                onChange={setBatchHoleWheelIndex}
              />
            </View>
```

Add to `makeStyles`: `wheels: { flexDirection: 'row', gap: 10 },`.

e) English copy swaps (exact strings):
- Title: `Adjuntar {assets.length} {…'recuerdo':'recuerdos'}` → `Attach {assets.length} {assets.length === 1 ? 'memory' : 'memories'}`
- `accessibilityLabel="Cancelar"` → `"Cancel"`
- `Aplicar a todas — comentario` → `Apply to all — caption`
- placeholder `"Ej. Domingo en el 18"` → `"e.g. Sunday on 18"`
- `Tu nombre (opcional)` → `Your name (optional)`
- placeholder `"Ej. Noé"` → `"e.g. Noé"`
- `Detalle por foto` → `Per-photo detail`
- Per-item chip labels: `'Sin hoyo'` → `'No hole'`, `` `Hoyo ${e.holeIndex + 1}` `` → `` `Hole ${e.holeIndex + 1}` ``, placeholder `"Comentario específico"` → `"Caption for this one"`
- Save button: `Guardar {assets.length}` → `Save {assets.length}`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/__tests__/BatchAttachSheet.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/BatchAttachSheet.js src/components/__tests__/BatchAttachSheet.test.js
git commit -m "feat(media): BatchAttachSheet header wheels, English copy"
```

---

### Task 4: English copy for `CaptureMenuSheet` and `mediaCapture` errors

**Files:**
- Modify: `src/components/CaptureMenuSheet.js`
- Modify: `src/lib/mediaCapture.js`
- Modify: `src/components/__tests__/CaptureMenuSheet.test.js:25`

**Interfaces:** No API changes — strings only.

- [ ] **Step 1: Update the existing test to expect English**

In `src/components/__tests__/CaptureMenuSheet.test.js` change:

```js
    expect(getByText('Vídeos hasta 100 MB')).toBeTruthy();
```

to:

```js
    expect(getByText('Videos up to 100 MB')).toBeTruthy();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/CaptureMenuSheet.test.js`
Expected: FAIL — "Videos up to 100 MB" not found.

- [ ] **Step 3: Translate the strings**

`src/components/CaptureMenuSheet.js`:
- `label: 'Tomar foto'` → `'Take photo'`
- `label: 'Grabar video'` → `'Record video'`
- `label: 'Elegir de galería'` → `'Choose from gallery'`
- `` detail: `Vídeos hasta ${MAX_VIDEO_UPLOAD_LABEL}` `` → `` `Videos up to ${MAX_VIDEO_UPLOAD_LABEL}` ``
- Title `Adjuntar recuerdo` → `Add a memory`
- `accessibilityLabel="Cancelar"` → `"Cancel"`
- Cancel button text `Cancelar` → `Cancel`

`src/lib/mediaCapture.js`:
- `'Permiso de cámara denegado.'` → `'Camera permission denied.'`
- `'Permiso de galería denegado.'` → `'Photo library permission denied.'`
- In `sizeErrorMessage`:
  - library: `` `Gallery videos must be ${MAX_VIDEO_UPLOAD_LABEL} or smaller.` ``
  - camera: `` `Videos recorded with the camera must be ${MAX_VIDEO_UPLOAD_LABEL} or smaller.` ``
  - default: `` `Videos must be ${MAX_VIDEO_UPLOAD_LABEL} or smaller.` ``

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/__tests__/CaptureMenuSheet.test.js && grep -rn "Vídeos\|Permiso de\|Adjuntar\|Cancelar" src/components/CaptureMenuSheet.js src/lib/mediaCapture.js`
Expected: test PASS; grep finds nothing (exit code 1 from grep is the pass signal here).

- [ ] **Step 5: Commit**

```bash
git add src/components/CaptureMenuSheet.js src/lib/mediaCapture.js src/components/__tests__/CaptureMenuSheet.test.js
git commit -m "chore(media): capture menu and picker errors in English"
```

---

### Task 5: `useMediaAttachFlow` hook

**Files:**
- Create: `src/hooks/useMediaAttachFlow.js`
- Test: `src/hooks/__tests__/useMediaAttachFlow.test.js`

**Interfaces:**
- Consumes: `pickMedia`, `attachMedia`, `attachManyMedia` from `src/lib/mediaCapture.js`; the three sheets.
- Produces: default export `useMediaAttachFlow({ tournament, defaultRoundIndex = 0, defaultHoleIndex = null, extraActions = [], allowBatch = true, onAttached })` returning `{ openCaptureMenu: () => void, sheets: <JSX fragment> }`. Callers render `{sheets}` once and call `openCaptureMenu()` from their trigger.

- [ ] **Step 1: Write the failing test**

The test drives the hook through a tiny harness and mocks the three sheets so their callbacks can be fired via buttons.

```js
// src/hooks/__tests__/useMediaAttachFlow.test.js
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import useMediaAttachFlow from '../useMediaAttachFlow';
import { pickMedia, attachMedia, attachManyMedia } from '../../lib/mediaCapture';

jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(),
  attachMedia: jest.fn(() => Promise.resolve({ id: 'm1' })),
  attachManyMedia: jest.fn(() => Promise.resolve(['m1', 'm2'])),
}));

jest.mock('../../components/CaptureMenuSheet', () => function MockCaptureMenu({ visible, onSelect }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onSelect({ source: 'library', mediaTypes: 'all' })}>
      <Text>mock-capture-menu</Text>
    </TouchableOpacity>
  ) : null;
});

jest.mock('../../components/AttachMediaSheet', () => function MockAttach({ visible, onConfirm }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onConfirm({
      roundIndex: 1, roundId: 'r2', holeIndex: 4, caption: 'c', uploaderLabel: null,
    })}>
      <Text>mock-attach-sheet</Text>
    </TouchableOpacity>
  ) : null;
});

jest.mock('../../components/BatchAttachSheet', () => function MockBatch({ visible, onConfirm }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onConfirm([
      { asset: { kind: 'photo', localUri: 'file://a.jpg' }, roundId: 'r1', holeIndex: null, caption: null, uploaderLabel: null },
    ])}>
      <Text>mock-batch-sheet</Text>
    </TouchableOpacity>
  ) : null;
});

const TOURNAMENT = {
  id: 't1',
  rounds: [
    { id: 'r1', holes: [{ par: 4 }] },
    { id: 'r2', holes: [{ par: 4 }] },
  ],
};

function Harness({ onAttached, allowBatch }) {
  const { openCaptureMenu, sheets } = useMediaAttachFlow({
    tournament: TOURNAMENT,
    defaultRoundIndex: 1,
    onAttached,
    allowBatch,
  });
  return (
    <>
      <TouchableOpacity onPress={openCaptureMenu}><Text>open</Text></TouchableOpacity>
      {sheets}
    </>
  );
}

describe('useMediaAttachFlow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('single asset routes to AttachMediaSheet and attaches with the picked round', async () => {
    pickMedia.mockResolvedValue({
      kind: 'photo', localUri: 'file://a.jpg', durationS: null,
      mimeType: 'image/jpeg', fileName: 'a.jpg', fileSize: 123,
    });
    const onAttached = jest.fn();
    const { getByText, findByText } = render(<Harness onAttached={onAttached} />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    fireEvent.press(await findByText('mock-attach-sheet'));
    await waitFor(() => expect(attachMedia).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: 't1', roundId: 'r2', holeIndex: 4, caption: 'c', fileSize: 123,
    })));
    expect(onAttached).toHaveBeenCalled();
  });

  test('multiple assets route to BatchAttachSheet and attachManyMedia', async () => {
    pickMedia.mockResolvedValue([
      { kind: 'photo', localUri: 'file://a.jpg' },
      { kind: 'photo', localUri: 'file://b.jpg' },
    ]);
    const { getByText, findByText } = render(<Harness />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    fireEvent.press(await findByText('mock-batch-sheet'));
    await waitFor(() => expect(attachManyMedia).toHaveBeenCalledWith({
      tournamentId: 't1',
      items: [expect.objectContaining({ roundId: 'r1' })],
    }));
  });

  test('allowBatch: false picks a single asset even from the library', async () => {
    pickMedia.mockResolvedValue({ kind: 'photo', localUri: 'file://a.jpg' });
    const { getByText } = render(<Harness allowBatch={false} />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    await waitFor(() => expect(pickMedia).toHaveBeenCalledWith(
      expect.objectContaining({ multi: false }),
    ));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/hooks/__tests__/useMediaAttachFlow.test.js`
Expected: FAIL — "Cannot find module '../useMediaAttachFlow'"

- [ ] **Step 3: Write the hook**

```js
// src/hooks/useMediaAttachFlow.js
import React, { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import AttachMediaSheet from '../components/AttachMediaSheet';
import BatchAttachSheet from '../components/BatchAttachSheet';
import { pickMedia, attachMedia, attachManyMedia } from '../lib/mediaCapture';

// One hook per screen that offers media uploads. Owns the capture-menu →
// pick → attach orchestration that FeedScreen, GalleryScreen and
// ScorecardScreen would otherwise each duplicate. Callers render `sheets`
// once and call `openCaptureMenu()` from their trigger (FAB, chip, button).
export default function useMediaAttachFlow({
  tournament,
  defaultRoundIndex = 0,
  defaultHoleIndex = null,
  extraActions = [],
  allowBatch = true,
  onAttached,
}) {
  const [captureMenuVisible, setCaptureMenuVisible] = useState(false);
  const [singleAsset, setSingleAsset] = useState(null);
  const [batchAssets, setBatchAssets] = useState(null);

  const rounds = tournament?.rounds ?? [];

  const openCaptureMenu = useCallback(() => setCaptureMenuVisible(true), []);

  const handleCaptureSelect = useCallback(async ({ source, mediaTypes }) => {
    setCaptureMenuVisible(false);
    try {
      const result = await pickMedia({
        source,
        mediaTypes,
        multi: allowBatch && source === 'library',
      });
      if (!result) return;
      if (Array.isArray(result)) {
        if (result.length === 0) return;
        if (result.length === 1) setSingleAsset(result[0]);
        else setBatchAssets(result);
      } else {
        setSingleAsset(result);
      }
    } catch (e) {
      Alert.alert("Couldn't capture", String(e?.message ?? e));
    }
  }, [allowBatch]);

  const onSingleConfirm = useCallback(async ({
    roundIndex, roundId, holeIndex, caption, uploaderLabel,
  }) => {
    const asset = singleAsset;
    setSingleAsset(null);
    if (!asset || !tournament) return;
    const resolvedRoundId = roundId ?? tournament.rounds?.[roundIndex]?.id;
    if (!resolvedRoundId) return;
    try {
      await attachMedia({
        tournamentId: tournament.id,
        roundId: resolvedRoundId,
        holeIndex,
        kind: asset.kind,
        localUri: asset.localUri,
        durationS: asset.durationS,
        caption,
        uploaderLabel,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
      });
      onAttached?.();
    } catch (e) {
      Alert.alert("Couldn't attach", String(e?.message ?? e));
    }
  }, [singleAsset, tournament, onAttached]);

  const onBatchConfirm = useCallback(async (payload) => {
    setBatchAssets(null);
    if (!tournament) return;
    try {
      await attachManyMedia({ tournamentId: tournament.id, items: payload });
      onAttached?.();
    } catch (e) {
      Alert.alert("Couldn't attach", String(e?.message ?? e));
    }
  }, [tournament, onAttached]);

  // Extra menu entries (e.g. scorecard's "view memories") need the menu
  // closed before they act; wrap them so callers don't have to.
  const wrappedExtraActions = useMemo(() => extraActions.map((a) => ({
    ...a,
    onPress: () => {
      setCaptureMenuVisible(false);
      a.onPress();
    },
  })), [extraActions]);

  const sheets = (
    <>
      <CaptureMenuSheet
        visible={captureMenuVisible}
        onSelect={handleCaptureSelect}
        onClose={() => setCaptureMenuVisible(false)}
        extraActions={wrappedExtraActions}
      />
      <AttachMediaSheet
        visible={!!singleAsset}
        asset={singleAsset}
        rounds={rounds}
        defaultRoundIndex={defaultRoundIndex}
        defaultHoleIndex={defaultHoleIndex}
        onCancel={() => setSingleAsset(null)}
        onConfirm={onSingleConfirm}
      />
      <BatchAttachSheet
        visible={!!batchAssets}
        assets={batchAssets ?? []}
        rounds={rounds}
        defaultRoundIndex={defaultRoundIndex}
        onCancel={() => setBatchAssets(null)}
        onConfirm={onBatchConfirm}
      />
    </>
  );

  return { openCaptureMenu, sheets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/hooks/__tests__/useMediaAttachFlow.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMediaAttachFlow.js src/hooks/__tests__/useMediaAttachFlow.test.js
git commit -m "feat(media): useMediaAttachFlow hook extracts capture orchestration"
```

---

### Task 6: Migrate `GalleryScreen` to the hook

**Files:**
- Modify: `src/screens/GalleryScreen.js`

**Interfaces:**
- Consumes: `useMediaAttachFlow` from Task 5.
- Produces: no API change; behavior parity (FAB → capture menu, library multi-select, single/batch attach).

- [ ] **Step 1: Replace the inline wiring**

In `src/screens/GalleryScreen.js`:

a) Remove imports `CaptureMenuSheet`, `AttachMediaSheet`, `BatchAttachSheet`, and `{ pickMedia, attachMedia, attachManyMedia }` from `../lib/mediaCapture`; remove `Alert` from the `react-native` import (nothing else in the file uses it after this change). Add:

```js
import useMediaAttachFlow from '../hooks/useMediaAttachFlow';
```

b) Delete the state and handlers: `captureMenuVisible`, `singleAsset`, `batchAssets` states; `openAdd`, `handleCaptureSelect`, `onSingleConfirm`, `onBatchConfirm` callbacks.

c) After the `defaultRoundIndex` memo add:

```js
  const { openCaptureMenu, sheets } = useMediaAttachFlow({
    tournament,
    defaultRoundIndex,
  });
```

d) Change the FAB to `onPress={openCaptureMenu}` and replace the three sheet elements (`<CaptureMenuSheet …/>`, `<AttachMediaSheet …/>`, `<BatchAttachSheet …/>`) at the bottom with:

```jsx
      {sheets}
```

- [ ] **Step 2: Verify**

Run: `npx jest src/screens && npm run lint`
Expected: PASS / no new lint errors (unused-import errors here mean step a was incomplete).

- [ ] **Step 3: Commit**

```bash
git add src/screens/GalleryScreen.js
git commit -m "refactor(gallery): use useMediaAttachFlow for uploads"
```

---

### Task 7: Migrate `ScorecardScreen` to the hook

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

**Interfaces:**
- Consumes: `useMediaAttachFlow` from Task 5.
- Produces: behavior parity — capture button opens the menu, current hole pre-selected, "view memories" extra action kept, single-photo only (`allowBatch: false` preserves today's behavior).

- [ ] **Step 1: Replace the inline wiring**

In `src/screens/ScorecardScreen.js`:

a) Imports: remove the `AttachMediaSheet` and `CaptureMenuSheet` imports (lines 34-35) and drop `pickMedia, attachMedia` from the `mediaCapture` import (line 38) — delete that import line entirely if nothing else in the file uses it. Add:

```js
import useMediaAttachFlow from '../hooks/useMediaAttachFlow';
```

b) Remove the `pickerAsset` state (line ~322) and `captureMenuVisible` state (line ~326). Keep `roundMediaItems` / `roundMediaCount` (used by the extra action and lightbox).

c) Remove `handleCaptureMenuSelect` and `onAttachConfirm` (lines ~1426-1456). Replace the `openCapturePicker` callback with the hook (place it where `tournament`, `roundIndex`, `currentHole`, `roundMediaCount`, and the lightbox setters are all in scope — i.e. at the same spot the old callbacks lived):

```js
  const { openCaptureMenu: openCapturePicker, sheets: mediaSheets } = useMediaAttachFlow({
    tournament,
    defaultRoundIndex: roundIndex,
    defaultHoleIndex: typeof currentHole === 'number' ? currentHole - 1 : null,
    allowBatch: false,
    extraActions: roundMediaCount > 0 ? [{
      key: 'view',
      icon: 'image',
      label: `View this round's memories (${roundMediaCount})`,
      onPress: () => {
        setLightboxItems(roundMediaItems);
        setLightboxIndex(0);
        setLightboxVisible(true);
      },
    }] : [],
  });
```

Note: the old extra action called `setCaptureMenuVisible(false)` itself — the hook wraps extra actions to close the menu, so that line is dropped here.

d) In the JSX, replace the `<CaptureMenuSheet …/>` and `<AttachMediaSheet …/>` blocks (lines ~1758-1781) with:

```jsx
      {mediaSheets}
```

All existing `openCapturePicker()` call sites keep working (same name via destructuring alias).

- [ ] **Step 2: Verify**

Run: `npx jest src/screens/__tests__/ScorecardScreen.test.js src/screens/__tests__/ScorecardScreen.flush.test.js src/screens/__tests__/ScorecardScreen.livePull.test.js src/screens/__tests__/ScorecardScreen.roundDecision.test.js && npm run lint`
Expected: PASS — these tests mock `AttachMediaSheet`/`CaptureMenuSheet` at the component path, which the hook still imports, so the mocks keep applying.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): use useMediaAttachFlow for uploads"
```

---

### Task 8: Feed camera chip + FeedScreen integration

**Files:**
- Modify: `src/screens/FeedScreen.js` (ReactionBar chip + flow wiring)
- Modify: `src/screens/__tests__/FeedScreen.test.js` (tournamentStore mock gains `getTournament`)
- Test: `src/screens/__tests__/FeedScreen.addPhoto.test.js` (new)

**Interfaces:**
- Consumes: `useMediaAttachFlow` (Task 5), `getTournament` from `src/store/tournamentStore.js` (`async (id) => tournament | null`), `invalidateFeedCache` from feedStore.
- Produces: `ReactionBar` gains optional `onAddPhoto` prop — when set, an "Add photo" chip (Feather `camera`) renders in the reaction row. FeedScreen passes it only for `item.withMe || item.isMine`.

- [ ] **Step 1: Write the failing test**

```js
// src/screens/__tests__/FeedScreen.addPhoto.test.js
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import FeedScreen from '../FeedScreen';
import { buildFeed } from '../../store/feedStore';
import { getTournament } from '../../store/tournamentStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/CommentsSheet', () => () => null);
jest.mock('../../components/MemoriesStoriesViewer', () => () => null);

jest.mock('../../store/tournamentStore', () => ({
  subscribeTournamentChanges: jest.fn(() => () => {}),
  formatRoundLabel: jest.fn(({ courseName, roundIndex }) => courseName || `Round ${roundIndex + 1}`),
  getTournament: jest.fn(),
}));

jest.mock('../../store/feedStore', () => ({
  buildFeed: jest.fn(),
  loadReactions: jest.fn(() => Promise.resolve({})),
  loadCommentCounts: jest.fn(() => Promise.resolve({})),
  toggleReaction: jest.fn(() => Promise.resolve(true)),
  invalidateFeedCache: jest.fn(),
  isValidReactionEmoji: jest.fn(() => false),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'u1' } })),
}));
jest.mock('../../store/notificationStore', () => ({
  notifyFeedActivity: jest.fn(() => Promise.resolve(true)),
}));

const mockOpenCaptureMenu = jest.fn();
jest.mock('../../hooks/useMediaAttachFlow', () => ({
  __esModule: true,
  default: jest.fn(() => ({ openCaptureMenu: mockOpenCaptureMenu, sheets: null })),
}));

const feedItem = (overrides) => ({
  key: `round:t1:${overrides.roundId ?? 'r1'}`,
  tournamentId: 't1',
  roundId: 'r1',
  roundIndex: 0,
  tournamentKind: 'tournament',
  courseName: 'Poniente',
  results: [],
  ts: Date.now(),
  ...overrides,
});

const renderFeed = async (items) => {
  buildFeed.mockResolvedValue({ items, roundStories: [], hasMore: false });
  const utils = render(
    <ThemeProvider>
      <FeedScreen navigation={{ navigate: jest.fn() }} />
    </ThemeProvider>
  );
  await waitFor(() => expect(buildFeed).toHaveBeenCalled());
  await act(async () => {});
  return utils;
};

describe('FeedScreen add photo', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows the Add photo chip only on own rounds', async () => {
    const { queryAllByLabelText } = await renderFeed([
      feedItem({ roundId: 'r1', withMe: true }),
      feedItem({ roundId: 'r2', key: 'round:t1:r2', withMe: false, isMine: false }),
    ]);
    expect(queryAllByLabelText('Add photo')).toHaveLength(1);
  });

  test('tapping the chip loads the tournament and opens the capture menu', async () => {
    getTournament.mockResolvedValue({ id: 't1', rounds: [{ id: 'r1', holes: [] }] });
    const { getByLabelText } = await renderFeed([feedItem({ withMe: true })]);
    await act(async () => {
      fireEvent.press(getByLabelText('Add photo'));
    });
    expect(getTournament).toHaveBeenCalledWith('t1');
    expect(mockOpenCaptureMenu).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/FeedScreen.addPhoto.test.js`
Expected: FAIL — no element with accessibilityLabel "Add photo".

- [ ] **Step 3: Implement in `src/screens/FeedScreen.js`**

a) Imports — add `Alert` to the `react-native` import, and:

```js
import { subscribeTournamentChanges, formatRoundLabel, getTournament } from '../store/tournamentStore';
import useMediaAttachFlow from '../hooks/useMediaAttachFlow';
```

(the first line replaces the existing tournamentStore import).

b) In `ReactionBar`, add `onAddPhoto` to the props list, and render this chip right after the comments chip (before the `{pickerOpen ? …}` block):

```jsx
      {onAddPhoto ? (
        <TouchableOpacity
          style={s.reactionChip}
          onPress={onAddPhoto}
          activeOpacity={0.7}
          accessibilityLabel="Add photo"
        >
          <Feather name="camera" size={13} color={theme.text.muted} />
          <Text style={s.reactionActionText}>Add photo</Text>
        </TouchableOpacity>
      ) : null}
```

c) In `FeedScreen`, AFTER the `loadMore` callback definition (so `load` is in scope), add attach-target state, the flow hook, and the tap handler:

```js
  // The round the user is adding a photo to, loaded on demand when they tap
  // a card's "Add photo" chip. The hook renders the capture/attach sheets.
  const [attachTarget, setAttachTarget] = useState(null);
  const { openCaptureMenu, sheets: attachSheets } = useMediaAttachFlow({
    tournament: attachTarget?.tournament ?? null,
    defaultRoundIndex: attachTarget?.roundIndex ?? 0,
    onAttached: () => {
      invalidateFeedCache();
      load(false);
    },
  });

  const handleAddPhoto = useCallback(async (item) => {
    try {
      const t = await getTournament(item.tournamentId);
      if (!t) throw new Error('not found');
      setAttachTarget({ tournament: t, roundIndex: item.roundIndex ?? 0 });
      openCaptureMenu();
    } catch {
      Alert.alert("Couldn't load this round", 'Try again in a moment.');
    }
  }, [openCaptureMenu]);
```

d) In `renderRound`, pass the handler to ReactionBar only for own rounds:

```jsx
        <ReactionBar
          itemKey={item.key}
          reactions={reactions[item.key]}
          onChange={applyReaction}
          commentCount={commentCounts[item.key] ?? 0}
          onOpenComments={() => setOpenCommentsItem(item)}
          onReactionAdded={(emoji) => notifyForFeedItem(item, 'feed_reaction', { emoji })}
          onAddPhoto={(item.withMe || item.isMine) ? () => handleAddPhoto(item) : undefined}
          s={s}
          theme={theme}
        />
```

e) Render the sheets after `<MemoriesStoriesViewer …/>`:

```jsx
      {attachSheets}
```

f) In `src/screens/__tests__/FeedScreen.test.js`, add `getTournament: jest.fn(),` to the tournamentStore mock factory (after the `formatRoundLabel` line) so the changed import doesn't break the existing suite.

- [ ] **Step 4: Run tests**

Run: `npx jest src/screens/__tests__/FeedScreen.addPhoto.test.js src/screens/__tests__/FeedScreen.test.js`
Expected: PASS (both files)

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS (ignore failures from stale `.claude/worktrees`/`.worktrees` copies if any appear).

- [ ] **Step 6: Commit**

```bash
git add src/screens/FeedScreen.js src/screens/__tests__/FeedScreen.addPhoto.test.js src/screens/__tests__/FeedScreen.test.js
git commit -m "feat(feed): add photos to your rounds straight from the feed"
```

---

## Final verification

- [ ] `npm test` — full suite green
- [ ] `npm run lint` — clean
- [ ] Manual smoke (optional, via the `verify` skill / Expo web): feed card of an own round shows "Add photo" → capture menu → library pick → wheels show round+hole → Save → photo appears in Memories under the picked round/hole.
