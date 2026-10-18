import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';
import { STEPS, EXTRAS } from '../../swing/resultsSteps';
import { cueFor } from '../../swing/checkpoints';
import { stepName } from './SwingSummary';

const R = SWING_STRINGS.results;

/**
 * The header of the position on screen (checks v2, design D): ‹ P6 · serif name · tag · status word ›.
 * ‹ and › step to the neighbour (44 px each; the swipe on the still is the alternative, never the only
 * way). The centre is a live region: "Downswing, position 5 of 8".
 */
export default function PositionBar({
  step, status, tag, waiting = false, onPrev, onNext,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const i = STEPS.indexOf(step);
  const first = i <= 0;
  const last = i >= STEPS.length - 1;
  const p = step === EXTRAS ? null : cueFor(step)?.p;
  const word = step === EXTRAS ? `${i + 1}/${STEPS.length}` : waiting ? R.needsHead : status === 'unknown' ? '' : SWING_STRINGS.statusWord[status];
  return (
    <View style={s.bar}>
      <PressableScale style={[s.nav, first && s.navOff]} disabled={first} onPress={onPrev} accessibilityRole="button" accessibilityLabel={R.prevPos} testID="position-prev">
        <Feather name="chevron-left" size={20} color={theme.text.primary} />
      </PressableScale>
      <View style={s.mid} accessible accessibilityLiveRegion="polite" accessibilityLabel={R.posOf(stepName(step), i + 1, STEPS.length)} testID="position-bar">
        {p ? <Text style={s.p}>{p}</Text> : null}
        <Text style={s.name} numberOfLines={1}>{stepName(step)}</Text>
        {tag ? (
          <View style={[s.tag, tag === 'first' ? { backgroundColor: tone.red } : { borderColor: tone.red, borderWidth: 1.5 }]}>
            <Text style={[s.tagText, tag === 'starts' && { color: tone.red }]}>{tag === 'first' ? R.tagFirst : R.tagStarts}</Text>
          </View>
        ) : null}
        {word ? <Text style={s.word}>{word}</Text> : null}
      </View>
      <PressableScale style={[s.nav, last && s.navOff]} disabled={last} onPress={onNext} accessibilityRole="button" accessibilityLabel={R.nextPos} testID="position-next">
        <Feather name="chevron-right" size={20} color={theme.text.primary} />
      </PressableScale>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -2 },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navOff: { opacity: 0.3 },
  mid: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  p: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10.5, letterSpacing: 0.6, color: theme.text.secondary },
  name: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary, flexShrink: 1 },
  tag: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, borderColor: 'transparent' },
  tagText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#ffffff' },
  word: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.secondary },
});
