import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';
import { CHECKPOINT_KEYS } from '../../swing/phases';

const T = SWING_STRINGS.results;
const NAMED = ['Address', 'Top', 'Impact', 'Finish']; // the anchors, under steps 1, 4, 7 and 9

/**
 * The nine checkpoints as a stepper (D10): a dot per step in the worst status measured there,
 * the checkpoint's name and frame underneath, and the +-1 frame nudge. `worst` maps
 * checkpoint -> 'green' | 'yellow' | 'red' | 'none'. Steps are 44 px tall tap targets.
 * With `skeleton` the dots are neutral (the result is still being calculated).
 */
export default function SwingTimeline({
  current, worst = {}, onSelect, frameLine, onPrev, onNext, canPrev = true, canNext = true, skeleton = false,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.wrap}>
      <View style={s.steps}>
        <View style={s.track} />
        {CHECKPOINT_KEYS.map((k) => {
          const on = k === current;
          const name = SWING_STRINGS.checkpoint[k];
          return (
            <PressableScale
              key={k}
              style={s.step}
              disabled={skeleton}
              onPress={() => onSelect?.(k)}
              activeScale={0.9}
              accessibilityRole="button"
              accessibilityLabel={T.stepLabel(name, worst[k])}
              accessibilityState={{ selected: on }}
            >
              <View style={[s.dotRing, on && s.dotRingOn]}>
                <View style={[s.dot, { backgroundColor: skeleton ? tone.none : tone[worst[k] ?? 'none'] }]} />
              </View>
            </PressableScale>
          );
        })}
      </View>
      <View style={s.names}>
        {NAMED.map((n) => <Text key={n} style={s.name}>{n}</Text>)}
      </View>
      <View style={s.cur}>
        <PressableScale
          style={[s.nudge, !canPrev && s.nudgeOff]}
          disabled={skeleton || !canPrev}
          onPress={onPrev}
          accessibilityRole="button"
          accessibilityLabel={T.prevFrame}
        >
          <Feather name="chevron-left" size={18} color={theme.text.primary} />
        </PressableScale>
        <Text style={s.curText} numberOfLines={1}>
          {skeleton ? ' ' : <Text>{SWING_STRINGS.checkpoint[current]} <Text style={s.curSub}>· {frameLine}</Text></Text>}
        </Text>
        <PressableScale
          style={[s.nudge, !canNext && s.nudgeOff]}
          disabled={skeleton || !canNext}
          onPress={onNext}
          accessibilityRole="button"
          accessibilityLabel={T.nextFrame}
        >
          <Feather name="chevron-right" size={18} color={theme.text.primary} />
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, paddingVertical: 6, paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  steps: { flexDirection: 'row', alignItems: 'center' },
  track: { position: 'absolute', left: 20, right: 20, top: 21, height: 2, backgroundColor: theme.border.default },
  step: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  dotRing: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.bg.card, borderWidth: 2, borderColor: 'transparent',
  },
  dotRingOn: { borderColor: theme.text.primary },
  dot: { width: 12, height: 12, borderRadius: 6 },
  names: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4, paddingHorizontal: 6 },
  name: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.secondary },
  cur: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  nudge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  nudgeOff: { opacity: 0.3 },
  curText: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  curSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary },
});
