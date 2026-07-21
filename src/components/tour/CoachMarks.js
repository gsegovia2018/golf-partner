import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { measureTourTarget } from './tourTargets';

const SCRIM = 'rgba(10, 20, 15, 0.62)';
const RING_PAD = 6;

// Presentational spotlight overlay. Measures each step's registered target
// at show time; a step whose target can't be measured is skipped silently,
// and a run where nothing measures calls onDone() without rendering — the
// tour must never point at the wrong place or trap the user.
export default function CoachMarks({ steps, onDone, onSkip }) {
  const { theme } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [current, setCurrent] = useState(null); // { index, rect } | null
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const showFrom = useCallback(async (startIndex) => {
    for (let i = startIndex; i < steps.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rect = await measureTourTarget(steps[i].key);
      if (!alive.current) return;
      if (rect) { setCurrent({ index: i, rect }); return; }
    }
    setCurrent(null);
    onDone();
  }, [steps, onDone]);

  useEffect(() => { showFrom(0); }, [showFrom]);

  if (!current) return null;
  const { index, rect } = current;
  const isLast = index >= steps.length - 1;
  const step = steps[index];
  const next = () => { if (isLast) onDone(); else showFrom(index + 1); };

  const ring = {
    left: rect.x - RING_PAD,
    top: rect.y - RING_PAD,
    width: rect.width + RING_PAD * 2,
    height: rect.height + RING_PAD * 2,
  };
  // Card above the target when the target sits in the lower half.
  const cardBelow = rect.y + rect.height / 2 < winH / 2;
  const cardPos = cardBelow
    ? { top: Math.min(ring.top + ring.height + 12, winH - 180) }
    : { bottom: Math.max(winH - ring.top + 12, 24) };
  const s = styles(theme);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="coachmarks-overlay">
      {/* Scrim as four panels around the target — RN can't punch holes. */}
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: 0, right: 0, height: Math.max(ring.top, 0) }]} />
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: ring.top + ring.height, right: 0, bottom: 0 }]} />
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: ring.top, width: Math.max(ring.left, 0), height: ring.height }]} />
      <View pointerEvents="none" style={[s.scrim, { left: ring.left + ring.width, top: ring.top, width: Math.max(winW - ring.left - ring.width, 0), height: ring.height }]} />
      <View pointerEvents="none" style={[s.ring, ring]} />
      <Pressable
        testID="coachmarks-target-press"
        accessibilityRole="button"
        accessibilityLabel={`${step.title} — next tour stop`}
        onPress={next}
        style={[s.targetPress, ring]}
      />
      <View style={[s.card, cardPos]}>
        <Text style={s.overline}>{`TOUR · ${index + 1} OF ${steps.length}`}</Text>
        <Text style={s.title}>{step.title}</Text>
        <Text style={s.body}>{step.body}</Text>
        <View style={s.row}>
          <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={10} style={s.skipBtn}>
            <Text style={s.skip}>Skip tour</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={next} style={s.nextBtn}>
            <Text style={s.nextText}>{isLast ? 'Done' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = (theme) => StyleSheet.create({
  scrim: { position: 'absolute', backgroundColor: SCRIM },
  ring: {
    position: 'absolute', borderWidth: 2.5, borderColor: semantic.winner.dark,
    borderRadius: 26,
  },
  targetPress: { position: 'absolute' },
  card: {
    position: 'absolute', left: 20, right: 20, maxWidth: 420, alignSelf: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.border.default,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  overline: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.6,
    color: theme.accent.primary,
  },
  title: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15,
    color: theme.text.primary, marginTop: 5, marginBottom: 3,
  },
  body: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18,
    color: theme.text.secondary, marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skipBtn: { minHeight: 44, justifyContent: 'center' },
  skip: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, color: theme.text.muted },
  nextBtn: {
    minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.accent.primary, borderRadius: 12, paddingHorizontal: 20,
  },
  nextText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: theme.text.inverse },
});
