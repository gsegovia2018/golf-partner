import React, {
  memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore,
} from 'react';
import {
  View, Text, Pressable, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { hud, semantic } from '../../theme/tokens';
import { SWING_STRINGS } from '../../swing/strings';
import {
  trackFrame, trackX, snapFrame, zoomFrames,
} from '../../swing/scrub';

// Step 1 of the marking canvas (D28, "Find the frame"): the zoomed row (the cursor ±4, every frame,
// tap a thumb or ‹ › for ±1) over the whole-clip track (any frame of the clip, the six position
// ticks, a flag on the proposal, the playhead), and the frame line.
//
// The track is dragged on the UI thread: a gesture-handler Pan writes the playhead's shared value
// in worklets and hands the frame to JS only when it changes (to `scrub`, the tiny store the
// picture and this row read), and commits it with `onPick` on release. The canvas itself never
// re-renders while the finger is down.

const T = SWING_STRINGS.mark;
const HUD_WARN = semantic.warning.dark;
const TAP_PX = 6; // a touch that moved less than this is a tap (it snaps to a tick or the flag)

function clampX(x, w) {
  'worklet';
  return Math.min(w, Math.max(0, x));
}

/**
 * `ticks`: [{ key, p, frame, done, cur }] the six positions; `thumbFor(f)` the still or proxy of a
 * frame; `onPick(f)` commits a frame (release, a thumb, ‹ ›); `scrub` the drag store (scrub.js).
 * The parent also passes `loaded` (which zoomed stills are on disk): `thumbFor` is stable, so that
 * prop is what re-renders the row when a still arrives.
 */
function FrameScrubberImpl({
  view, proposed, maxFrame, fps, ticks, thumbFor, onPick, scrub,
}) {
  const drag = useSyncExternalStore(scrub.subscribe, scrub.get);
  const cursor = drag ?? view;
  const [w, setW] = useState(0);
  const tw = useSharedValue(0);
  const max = useSharedValue(maxFrame);
  const targets = useSharedValue([]);
  const ph = useSharedValue(0);
  const down = useSharedValue(0);
  const x0 = useSharedValue(0);
  const last = useSharedValue(-1);
  const committed = useSharedValue(view);
  const started = useSharedValue(0); // the Pan activated; a tap on the track never does

  const targetKey = [...ticks.map((t) => t.frame), proposed].join(',');
  useEffect(() => { max.value = maxFrame; }, [maxFrame, max]);
  useEffect(() => { targets.value = targetKey.split(',').map(Number); }, [targetKey, targets]);
  useEffect(() => { tw.value = w; }, [w, tw]);
  // the committed frame moves the playhead (a tap on a thumb, ‹ ›, a new position); a drag moves it itself
  useEffect(() => {
    committed.value = view;
    if (!down.value) ph.value = trackX(view, w, maxFrame);
  }, [view, w, maxFrame, down, ph, committed]);

  const setScrub = scrub.set;
  const release = useCallback((f) => { scrub.set(null); onPick(f); }, [scrub, onPick]);
  const abandon = useCallback(() => { scrub.set(null); }, [scrub]);
  const pan = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => {
      'worklet';
      down.value = 1;
      started.value = 0;
      x0.value = e.x;
      const x = clampX(e.x, tw.value);
      ph.value = x;
      const f = trackFrame(x, tw.value, max.value);
      last.value = f;
      runOnJS(setScrub)(f);
    })
    .onUpdate((e) => {
      'worklet';
      const x = clampX(e.x, tw.value);
      ph.value = x;
      const f = trackFrame(x, tw.value, max.value);
      if (f !== last.value) {
        last.value = f;
        runOnJS(setScrub)(f);
      }
    })
    .onStart(() => {
      'worklet';
      started.value = 1;
    })
    .onFinalize((e, success) => {
      'worklet';
      if (!down.value) return;
      down.value = 0;
      if (!success && started.value) {
        // cancelled by the system: back to the committed frame, nothing picked
        ph.value = trackX(committed.value, tw.value, max.value);
        runOnJS(abandon)();
        return;
      }
      const x = clampX(e.x, tw.value);
      const f = Math.abs(e.x - x0.value) < TAP_PX
        ? snapFrame(x, tw.value, max.value, targets.value)
        : trackFrame(x, tw.value, max.value);
      ph.value = trackX(f, tw.value, max.value);
      runOnJS(release)(f);
    })
    .withTestId('scrub-track'), [setScrub, release, abandon, down, x0, tw, ph, max, last, targets, committed, started]);
  const head = useAnimatedStyle(() => ({ transform: [{ translateX: ph.value - 1.5 }] }));

  const off = cursor - proposed;
  const at = (f) => trackX(f, w, maxFrame);
  const cur = ticks.find((t) => t.cur);
  const step = (d) => onPick(Math.min(maxFrame, Math.max(0, view + d)));
  return (
    <View style={styles.wrap} testID="mark-scrubber">
      <View style={styles.zoom}>
        <Pressable style={styles.arr} onPress={() => step(-1)} disabled={view <= 0} accessibilityRole="button" accessibilityLabel={T.prevFrame} testID="mark-prev">
          <Feather name="chevron-left" size={18} color={hud.text} />
        </Pressable>
        {zoomFrames(cursor, maxFrame).map((f, k) => {
          if (f == null) return <View key={`e${k}`} style={styles.zSlot}><View style={styles.z} /></View>;
          const uri = thumbFor(f);
          return (
            <View key={f} style={[styles.zSlot, f === proposed && styles.zSlotTop]}>
              <Pressable
                style={[styles.z, f === proposed && styles.zProp, f === cursor && styles.zOn]}
                onPress={() => onPick(f)}
                accessibilityRole="button"
                accessibilityState={{ selected: f === cursor }}
                accessibilityLabel={T.thumbLabel(f, f - proposed)}
                testID={`zoom-${f}`}
              >
                {/* expo-image: decoded thumbs stay in memory, so a drag tick does not reload all nine */}
                {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={null} /> : null}
              </Pressable>
              {f === proposed ? (
                <View style={styles.sg} pointerEvents="none" testID="mark-suggested">
                  <Text style={styles.sgText} numberOfLines={1}>{T.onProposal}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        <Pressable style={styles.arr} onPress={() => step(1)} disabled={view >= maxFrame} accessibilityRole="button" accessibilityLabel={T.nextFrame} testID="mark-next">
          <Feather name="chevron-right" size={18} color={hud.text} />
        </Pressable>
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.track}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={T.track}
          accessibilityValue={{ text: T.frameLine(cursor, (cursor / fps).toFixed(3)) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          testID="mark-track"
        >
          <View style={styles.bar} />
          {w ? ticks.map((t) => (
            <View key={t.key} style={[styles.tk, t.done && styles.tkDone, t.cur && styles.tkCur, { left: at(t.frame) - (t.cur ? 1.5 : 1) }]} />
          )) : null}
          {w && cur ? <Text style={[styles.tl, { left: Math.min(Math.max(0, at(cur.frame) - 10), w - 20) }]}>{cur.p}</Text> : null}
          {w ? <View style={[styles.flag, { left: at(proposed) - 5 }]} testID="mark-flag" /> : null}
          <Animated.View pointerEvents="none" style={[styles.ph, head]} testID="mark-playhead" />
        </View>
      </GestureDetector>

      <View style={styles.frl}>
        <Text style={styles.frlText} testID="mark-frame-line">{T.frameLine(cursor, (cursor / fps).toFixed(3))}</Text>
        <Text style={[styles.frlText, off ? styles.warn : styles.ok]} testID="mark-frame-offset">{off ? T.offProposal(off) : T.onProposal}</Text>
      </View>
    </View>
  );
}

/** Memoised: it re-renders for its own props and the scrub store, never for the canvas around it. */
export default memo(FrameScrubberImpl);

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  zoom: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4,
  },
  arr: {
    width: 36, height: 44, borderRadius: 10, backgroundColor: hud.fill, borderWidth: 1, borderColor: hud.line,
    alignItems: 'center', justifyContent: 'center',
  },
  zSlot: { flex: 1, alignItems: 'center' },
  zSlotTop: { zIndex: 1 },
  z: {
    alignSelf: 'stretch', height: 44, borderRadius: 4, overflow: 'hidden', backgroundColor: hud.inset, borderWidth: 1.5, borderColor: 'transparent', opacity: 0.7,
  },
  zProp: { borderColor: hud.accent, opacity: 1 },
  zOn: { borderColor: hud.text, opacity: 1 },
  // "Suggested" over the proposed thumb, half above it (it may be wider than the thumb)
  sg: {
    position: 'absolute', top: -8, minWidth: 64, alignItems: 'center',
  },
  sgText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, lineHeight: 13, color: hud.onAccent, backgroundColor: hud.accent,
    paddingHorizontal: 5, borderRadius: 99, overflow: 'hidden',
  },
  track: { height: 32, marginHorizontal: 2, justifyContent: 'flex-start' },
  bar: { position: 'absolute', left: 0, right: 0, top: 13, height: 3, borderRadius: 2, backgroundColor: hud.line },
  tk: { position: 'absolute', top: 9, width: 2, height: 11, borderRadius: 1, backgroundColor: hud.textDim },
  tkDone: { backgroundColor: hud.accent },
  tkCur: { width: 3, backgroundColor: hud.accent },
  tl: { position: 'absolute', top: 21, width: 20, textAlign: 'center', fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, color: hud.accent },
  flag: {
    position: 'absolute', top: 2, width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: hud.accent,
  },
  ph: {
    position: 'absolute', left: 0, top: 4, width: 3, height: 20, borderRadius: 2, backgroundColor: hud.text,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.5)',
  },
  frl: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  frlText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: hud.textSoft, fontVariant: ['tabular-nums'] },
  warn: { color: HUD_WARN },
  ok: { color: hud.accent },
});
