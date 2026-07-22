import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, Modal } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { measureTourTarget } from './tourTargets';

const SCRIM = 'rgba(10, 20, 15, 0.62)';
const RING_PAD = 6;

// A step's target can legitimately measure zero-size for a few frames after
// mount — e.g. the scorecard hole pager sizes its pages from onLayout, so
// the active hole's card isn't measurable yet when the overlay first shows.
// Retry a null measurement a few times before giving up on the step.
export const MEASURE_RETRIES = 5;
export const MEASURE_RETRY_DELAY_MS = 100;

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Presentational spotlight overlay. Measures each step's registered target
// at show time (retrying a null measurement a few times before giving up);
// a step whose target still can't be measured is skipped silently, and a
// run where nothing measures calls onDone() without rendering — the tour
// must never point at the wrong place or trap the user.
export default function CoachMarks({ steps, onDone, onSkip }) {
  const { theme } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [current, setCurrent] = useState(null); // { index, rect } | null
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Latest props live in refs so the advancing logic never closes over a
  // stale (or a parent's freshly re-created inline) steps/onDone/onSkip —
  // a new prop identity must not restart or re-run the tour.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  // Bumped on every showFrom() call so a stale in-flight async loop (from a
  // superseded run) can detect it's no longer current and bail out before
  // touching state or calling onDone.
  const runId = useRef(0);

  const showFrom = useCallback(async (startIndex) => {
    const myRun = (runId.current += 1);
    const isStale = () => !alive.current || runId.current !== myRun;
    const currentSteps = stepsRef.current;
    for (let i = startIndex; i < currentSteps.length; i += 1) {
      let rect = null;
      for (let attempt = 1; attempt <= MEASURE_RETRIES; attempt += 1) {
        rect = await measureTourTarget(currentSteps[i].key);
        if (isStale()) return;
        if (rect) break;
        if (attempt < MEASURE_RETRIES) {
          await delay(MEASURE_RETRY_DELAY_MS);
          if (isStale()) return;
        }
      }
      if (rect) { setCurrent({ index: i, rect }); return; }
    }
    if (isStale()) return;
    setCurrent(null);
    onDoneRef.current();
  }, []);

  // Mount-only: start the tour once. Re-renders that pass new inline
  // steps/onDone identities must not restart it from step 1.
  useEffect(() => { showFrom(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const { index, rect } = current;
  const isLast = index >= steps.length - 1;
  const step = steps[index];
  const next = () => { if (isLast) onDoneRef.current(); else showFrom(index + 1); };

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
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => onSkipRef.current()}
      hardwareAccelerated
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="coachmarks-overlay">
        {/* Scrim as four panels around the target — RN can't punch holes.
            Each panel swallows taps (no-op) so the dimmed area can't be used
            to reach real UI underneath; only the spotlighted target advances. */}
        <Pressable testID="coachmarks-scrim-top" onPress={() => {}} accessible={false} style={[s.scrim, { left: 0, top: 0, right: 0, height: Math.max(ring.top, 0) }]} />
        <Pressable testID="coachmarks-scrim-bottom" onPress={() => {}} accessible={false} style={[s.scrim, { left: 0, top: ring.top + ring.height, right: 0, bottom: 0 }]} />
        <Pressable testID="coachmarks-scrim-left" onPress={() => {}} accessible={false} style={[s.scrim, { left: 0, top: ring.top, width: Math.max(ring.left, 0), height: ring.height }]} />
        <Pressable testID="coachmarks-scrim-right" onPress={() => {}} accessible={false} style={[s.scrim, { left: ring.left + ring.width, top: ring.top, width: Math.max(winW - ring.left - ring.width, 0), height: ring.height }]} />
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
            <Pressable accessibilityRole="button" onPress={() => onSkipRef.current()} hitSlop={10} style={s.skipBtn}>
              <Text style={s.skip}>Skip tour</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={next} style={s.nextBtn}>
              <Text style={s.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
