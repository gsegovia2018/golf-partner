import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useSwingTone } from './swingTone';
import { SWING_STRINGS } from '../../swing/strings';
import { homeOf } from '../../swing/checkpointChecks';

const F = SWING_STRINGS.results.fixes;

/**
 * "Your fixes, in order": the checks that need work as numbered rows, each opening the fix sheet.
 * With no fixes it says so. `fixes` is fixesFor(analysis).
 */
export default function SwingFixesCard({ fixes, onOpen }) {
  const { theme } = useTheme();
  const tone = useSwingTone();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const empty = fixes.length === 0;
  return (
    <View style={s.card} testID="results-fixes">
      <Text style={s.overline}>{empty ? F.emptyTitle : fixes[0].check.status === 'red' ? F.titleFix : F.titleWatch}</Text>
      {empty ? <Text style={s.body}>{F.emptyBody}</Text> : fixes.map(({ check, copy }, i) => {
        const cp = SWING_STRINGS.checkpoint[homeOf(check)];
        const word = SWING_STRINGS.statusWord[check.status];
        return (
          <PressableScale
            key={`${check.id}@${check.cp ?? ''}`}
            style={s.row}
            onPress={() => onOpen(i)}
            activeScale={0.99}
            accessibilityRole="button"
            accessibilityLabel={F.rowLabel(i + 1, copy.headline, cp, word)}
          >
            <Text style={s.num}>{i + 1}</Text>
            <View style={[s.dot, { backgroundColor: tone[check.status] }]} />
            <View style={s.mid}>
              <Text style={s.headline}>{copy.headline}</Text>
              <Text style={s.sub}>{F.subline(cp, word)}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.text.secondary} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg, padding: 12, gap: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
  },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.secondary, paddingHorizontal: 4, paddingBottom: 4 },
  body: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, lineHeight: 19, color: theme.text.secondary, paddingHorizontal: 4, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 4 },
  num: { width: 18, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.secondary, textAlign: 'center', fontVariant: ['tabular-nums'] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mid: { flex: 1, gap: 2 },
  headline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, lineHeight: 19, color: theme.text.primary },
  sub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary },
});
