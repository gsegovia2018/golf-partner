import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { SWING_STRINGS } from '../../swing/strings';

const F = SWING_STRINGS.results.fixes;

/** The open row under a selected red / yellow check: what you did, what it costs, one cue, and the way into the fix sheet. */
export default function SwingFixPeek({ copy, onOpen }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.wrap} testID="results-fix-peek">
      <Text style={s.headline}>{copy.headline}</Text>
      <Text style={s.cost}>{copy.cost}</Text>
      <View style={s.tryBox}>
        <Text style={s.tryTitle}>{F.tryThis}</Text>
        <Text style={s.tryCue}>{copy.cue}</Text>
      </View>
      <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={F.howLink} style={s.linkBtn}>
        <Text style={s.link}>{`${F.howLink} ›`}</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingBottom: 6, gap: 6 },
  headline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 20, color: theme.text.primary },
  cost: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, lineHeight: 18, color: theme.text.secondary },
  tryBox: { backgroundColor: theme.bg.card, borderRadius: 10, padding: 10, gap: 2 },
  tryTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.accent.primary },
  tryCue: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, lineHeight: 18, color: theme.text.primary },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary },
});
