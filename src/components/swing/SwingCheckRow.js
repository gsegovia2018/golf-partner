import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';
import { valueText } from '../../swing/highlights';

const T = SWING_STRINGS.results;

/**
 * One check: dot + label (+ the sentence), the value in ink, and the status word (D14).
 * A check waiting for a clubhead (D16) shows a "Place clubhead" button where the word goes.
 * `onPress` selects the check
 * (draws it on the still); `onPlace` opens Edit marks on the checkpoint that needs a mark.
 */
export default function SwingCheckRow({
  check, selected = false, expanded, onPress, onPlace, placeAt = null,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const name = check.cp && T.cpSuffix[check.cp] ? `${check.label}, ${T.cpSuffix[check.cp]}` : check.label;
  const { status } = check;
  const word = status === 'unknown'
    ? (check.reason === 'hidden' ? SWING_STRINGS.statusWord.unknown : '—')
    : SWING_STRINGS.statusWord[status];
  const value = valueText(check);
  const cta = placeAt && onPlace;
  const a11y = `${name}, ${value ? `${value}, ` : ''}${cta ? T.placeClubhead : word}`;

  const body = (
    <View style={[s.row, selected && s.rowOn, cta && s.rowPlace]}>
      <View style={[s.dot, cta ? [s.dotWait, { borderColor: tone.unknown }] : { backgroundColor: tone[status] }]} />
      <View style={s.mid}>
        <Text style={s.label}>{name}</Text>
        {check.text ? <Text style={s.text}>{check.text}</Text> : null}
      </View>
      <View style={s.right}>
        {value ? (
          <Text style={s.value}>
            {value}
            {check.approximate && check.unit === 'cm' ? <Text style={s.approx}>{` ${SWING_STRINGS.approximate}`}</Text> : null}
          </Text>
        ) : null}
        {cta ? (
          <PressableScale style={s.cta} onPress={() => onPlace(placeAt)} accessibilityRole="button" accessibilityLabel={`${T.placeClubhead}: ${name}`}>
            <Text style={s.ctaText}>{T.placeClubhead}</Text>
          </PressableScale>
        ) : <Text style={s.word}>{word}</Text>}
      </View>
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={a11y}>{body}</View>;
  return (
    <PressableScale onPress={() => onPress(check)} activeScale={0.99} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={expanded === undefined ? { selected } : { selected, expanded }}>
      {body}
    </PressableScale>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 10, minHeight: 48,
  },
  rowOn: { backgroundColor: theme.accent.light },
  rowPlace: { backgroundColor: theme.bg.secondary }, // a row waiting for its clubhead: a dashed dot and a button
  dotWait: { backgroundColor: 'transparent', borderWidth: 2, borderStyle: 'dashed' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mid: { flex: 1, gap: 2 },
  label: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13.5, color: theme.text.primary },
  text: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
  right: { alignItems: 'flex-end', gap: 2, maxWidth: 128 },
  value: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13.5, color: theme.text.primary, fontVariant: ['tabular-nums'] },
  approx: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10.5, color: theme.text.secondary },
  word: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: theme.text.secondary },
  cta: {
    minHeight: 36, minWidth: 44, borderRadius: 18, paddingHorizontal: 12, justifyContent: 'center',
    backgroundColor: theme.accent.primary,
  },
  ctaText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.inverse },
});
