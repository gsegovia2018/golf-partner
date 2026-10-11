import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { SWING_STRINGS } from '../../swing/strings';

const T = SWING_STRINGS.edit;
const STEPS = [-10, -1, 1, 10];

/**
 * The whole-clip scrubber of Edit marks (the lab editor's flow): drag or tap the track to
 * preview any frame, step with the buttons, and see where the nine checkpoints sit. A
 * ghost tick shows where analyze() had put a checkpoint the user moved. Previewing never
 * changes a checkpoint: that is the "Set <checkpoint> to this frame" button's job (or
 * placing a mark, which adopts the frame you are looking at).
 *
 * @param {{frame:number, n:number, selected?:boolean, ghost?:boolean}[]} ticks
 */
export default function FrameScrubber({ value, max, onChange, ticks = [], onSetFrame, setLabel, setDisabled }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [w, setW] = useState(0);
  const widthRef = useRef(0);
  const live = useRef({ value, max, onChange });
  live.current = { value, max, onChange };
  const origin = useRef(0);

  const at = (x) => {
    const { max: m } = live.current;
    const f = Math.round((Math.min(Math.max(x, 0), widthRef.current) / (widthRef.current || 1)) * m);
    live.current.onChange(Math.min(m, Math.max(0, f)));
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { origin.current = e.nativeEvent.locationX; at(origin.current); },
    onPanResponderMove: (_e, g) => at(origin.current + g.dx),
  }), []);

  const pos = (f) => (max ? (f / max) * w : 0);
  const step = (d) => onChange(Math.min(max, Math.max(0, value + d)));

  return (
    <View style={s.wrap}>
      <View
        style={s.track}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; setW(widthRef.current); }}
        accessibilityRole="adjustable"
        accessibilityLabel={T.scrub}
        accessibilityValue={{ min: 0, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        testID="frame-scrubber"
        {...pan.panHandlers}
      >
        <View style={s.rail} pointerEvents="none" />
        {ticks.map((t) => (t.ghost ? (
          <View key={`g${t.n}`} pointerEvents="none" style={[s.ghost, { left: pos(t.frame) - 1 }]} />
        ) : (
          <View key={t.n} pointerEvents="none" style={[s.tick, t.selected && s.tickOn, { left: pos(t.frame) - 9 }]}>
            <Text style={[s.tickText, t.selected && s.tickTextOn]}>{t.n}</Text>
          </View>
        )))}
        <View pointerEvents="none" style={[s.thumb, { left: pos(value) - 2 }]} />
      </View>
      <View style={s.steps}>
        {STEPS.map((d) => (
          <PressableScale key={d} style={s.stepBtn} onPress={() => step(d)} accessibilityRole="button" accessibilityLabel={T.scrubStep(d)}>
            <Text style={s.stepText}>{d > 0 ? `+${d}` : `${d}`}</Text>
          </PressableScale>
        ))}
        <Text style={s.frameNo} accessibilityLiveRegion="polite">{`${value} / ${max}`}</Text>
      </View>
      <PressableScale
        style={[s.setBtn, setDisabled && s.setBtnOff]}
        disabled={setDisabled}
        onPress={onSetFrame}
        accessibilityRole="button"
        accessibilityLabel={setLabel}
        accessibilityState={{ disabled: !!setDisabled }}
      >
        <Text style={[s.setText, setDisabled && s.setTextOff]}>{setLabel}</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { gap: 8 },
  track: { height: 44, justifyContent: 'center' },
  rail: { height: 4, borderRadius: 2, backgroundColor: theme.border.default },
  tick: {
    position: 'absolute', top: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default,
  },
  tickOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  tickText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 9.5, color: theme.text.secondary },
  tickTextOn: { color: theme.text.inverse },
  ghost: { position: 'absolute', top: 14, width: 2, height: 16, backgroundColor: theme.text.muted, opacity: 0.6 },
  thumb: { position: 'absolute', top: 8, width: 4, height: 28, borderRadius: 2, backgroundColor: theme.text.primary },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    minWidth: 52, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default,
  },
  stepText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary, fontVariant: ['tabular-nums'] },
  frameNo: { flex: 1, textAlign: 'right', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary, fontVariant: ['tabular-nums'] },
  setBtn: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: theme.accent.primary },
  setBtnOff: { backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
  setText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.inverse },
  setTextOff: { color: theme.text.secondary },
});
