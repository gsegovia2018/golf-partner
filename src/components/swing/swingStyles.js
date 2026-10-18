// Shared type and chrome for the swing analyzer screens.
//
// Rules:
// - Font sizes come only from `swingType`: display 26, title 20, heading 15, body 13,
//   label 11, overline 10. Nothing under 10 px.
// - Playfair (display/title) is only for the one thing to read first on a screen or sheet;
//   everything else is Plus Jakarta Sans.
// - `glass` is only for chrome drawn over video or stills (theme-independent, built on the
//   `hud` palette). On themed surfaces use the theme's own cards and borders.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { hud, semantic } from '../../theme/tokens';
import { withAlpha } from '../../theme/alpha';

/** The six-step type scale, colours from the theme. `bodyInk` is body in primary ink. */
export function swingType(theme) {
  return {
    display: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, lineHeight: 32, color: theme.text.primary },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, lineHeight: 26, color: theme.text.primary },
    heading: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 21, color: theme.text.primary },
    body: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, lineHeight: 19, color: theme.text.secondary },
    bodyInk: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, lineHeight: 19, color: theme.text.primary },
    label: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, lineHeight: 15, color: theme.text.primary },
    overline: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase',
      color: theme.text.secondary,
    },
  };
}

const GLASS_FILL = 'rgba(10,13,16,0.62)'; // hud.bg at 62%
const GLASS_EDGE = 'rgba(255,255,255,0.14)';
const GLASS_HIGHLIGHT = 'rgba(255,255,255,0.22)';

/** Chrome over video/stills: a pill (chips, badges) and a panel (cards). No blur — a tinted fill. */
export const glass = StyleSheet.create({
  pill: {
    backgroundColor: GLASS_FILL, borderWidth: 1, borderColor: GLASS_EDGE, borderTopColor: GLASS_HIGHLIGHT,
    borderRadius: 999,
  },
  panel: {
    backgroundColor: GLASS_FILL, borderWidth: 1, borderColor: GLASS_EDGE, borderTopColor: GLASS_HIGHLIGHT,
    borderRadius: 14,
  },
  text: { color: hud.text },
  textMuted: { color: hud.textMuted },
});

/** A section overline: small caps, secondary ink. */
export function Overline({ style, children, ...rest }) {
  const { theme } = useTheme();
  const t = useMemo(() => swingType(theme), [theme]);
  return <Text style={[t.overline, style]} {...rest}>{children}</Text>;
}

/** One-line amber notice: ⚠ text (›). Pressable when `onPress` is given. */
export function Notice({
  text, onPress, style, testID, accessibilityLabel,
}) {
  const { theme } = useTheme();
  const amber = theme.isDark ? semantic.warning.dark : semantic.warning.light;
  const s = useMemo(() => makeNoticeStyles(theme, amber), [theme, amber]);
  const body = (
    <>
      <Feather name="alert-triangle" size={14} color={amber} />
      <Text style={s.text} numberOfLines={1}>{text}</Text>
      {onPress ? <Feather name="chevron-right" size={16} color={amber} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={[s.row, style]} testID={testID} accessible accessibilityLabel={accessibilityLabel ?? text}>{body}</View>;
  }
  return (
    <PressableScale style={[s.row, style]} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? text}>
      {body}
    </PressableScale>
  );
}

const makeNoticeStyles = (theme, amber) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: withAlpha(amber, theme.isDark ? 0.16 : 0.12),
  },
  text: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, lineHeight: 19, color: theme.text.primary },
});
