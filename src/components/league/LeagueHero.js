// The deep-green league hero card: overline, Playfair name, optional meta line
// and chips. Used by the join screens, the create flow's "done" step and the
// public board. Text and fills come from the `onDeep` tokens.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { onDeep } from '../../theme/tokens';

export default function LeagueHero({
  overline, name, meta, chips, style, nameSize = 26, metaSize = 12, nameLines, nameRole, children, ...rest
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme, nameSize, metaSize, !!overline);
  return (
    <View style={[s.hero, style]} {...rest}>
      {overline ? <Text style={s.overline}>{overline}</Text> : null}
      <Text style={s.name} numberOfLines={nameLines} accessibilityRole={nameRole}>{name}</Text>
      {meta ? <Text style={s.meta}>{meta}</Text> : null}
      {chips && chips.length > 0 ? (
        <View style={s.chipRow}>
          {chips.map((label) => (
            <View key={label} style={s.chip}><Text style={s.chipText}>{label}</Text></View>
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function makeStyles(theme, nameSize, metaSize, hasOverline) {
  const d = onDeep;
  return StyleSheet.create({
    hero: { backgroundColor: theme.bg.deep, borderRadius: 20, padding: 20, marginBottom: 20 },
    overline: { fontFamily: 'PlusJakartaSans-Bold', color: d.faint, fontSize: 10, letterSpacing: 1.6 },
    name: {
      fontFamily: 'PlayfairDisplay-Bold', color: d.primary, fontSize: nameSize, letterSpacing: -0.3, marginTop: hasOverline ? 6 : 0,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: d.soft, fontSize: metaSize, lineHeight: metaSize > 12 ? metaSize + 6 : undefined, marginTop: hasOverline ? 10 : 4,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { backgroundColor: d.chip, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: d.primary, fontSize: 11 },
  });
}
