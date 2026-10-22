import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { onDeep } from '../../theme/tokens';
import { initials } from '../../store/leagueView';

// Round initials chip for a person who has no photo (league invitees), or
// their photo when `url` is set. `muted` is the grey variant used for "+"
// style rows; `deep` the variant for the deep-green board; `ring` outlines it
// (the signed-in member on the board). `style` replaces the default spacing.
export default function InitialsAvatar({
  name, url = null, size = 36, muted = false, deep = false, ring = null, style, children,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme, size, muted, deep);
  return (
    <View
      style={[s.avatar, ring && { borderWidth: 2, borderColor: ring }, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {children ?? (url
        ? <Image source={{ uri: url }} style={s.img} />
        : <Text style={s.text}>{initials(name)}</Text>)}
    </View>
  );
}

function makeStyles(theme, size, muted, deep) {
  const bg = deep ? onDeep.chip : muted ? theme.bg.secondary : theme.accent.light;
  const fg = deep ? onDeep.primary : muted ? theme.text.secondary : theme.accent.primary;
  return StyleSheet.create({
    avatar: {
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: bg, marginRight: 12, overflow: 'hidden',
    },
    img: { width: '100%', height: '100%' },
    text: { fontFamily: 'PlusJakartaSans-Bold', fontSize: Math.round(size * 0.36), color: fg },
  });
}
