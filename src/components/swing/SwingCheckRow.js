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
 * A check waiting for a clubhead (D16) shows a "Place clubhead" button where the word goes;
 * while pass 2 is still running it says "calculating…" instead. `onPress` selects the check
 * (draws it on the still); `onPlace` opens Edit marks on the checkpoint that needs a mark.
 */
export default function SwingCheckRow({
  check, selected = false, onPress, onPlace, placeAt = null, pending = false, showText = true,
}) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const name = check.cp && T.cpSuffix[check.cp] ? `${check.label}, ${T.cpSuffix[check.cp]}` : check.label;
  const waiting = pending && check.status === 'unknown' && (check.reason === 'unplaced' || check.reason === 'hidden');
  const status = waiting ? 'unknown' : check.status;
  const word = waiting ? '…' : status === 'unknown'
    ? (check.reason === 'hidden' ? SWING_STRINGS.statusWord.unknown : '—')
    : SWING_STRINGS.statusWord[status];
  const value = waiting ? T.calculating : valueText(check);
  const cta = !waiting && placeAt && onPlace;
  const a11y = `${name}, ${waiting ? T.calculating : value ? `${value}, ` : ''}${cta ? T.placeClubhead : word}`;

  const body = (
    <View style={[s.row, selected && s.rowOn]}>
      <View style={[s.dot, { backgroundColor: tone[status] }]} />
      <View style={s.mid}>
        <Text style={s.label}>{name}</Text>
        {showText && check.text ? <Text style={s.text}>{check.text}</Text> : null}
      </View>
      <View style={s.right}>
        {value ? (
          <Text style={s.value}>
            {value}
            {check.approximate && check.unit === 'cm' && !waiting ? <Text style={s.approx}>{` ${SWING_STRINGS.approximate}`}</Text> : null}
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
    <PressableScale onPress={() => onPress(check)} activeScale={0.99} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected }}>
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
