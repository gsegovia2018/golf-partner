// The league task-screen header: chevron back button, 17px Bold title, and an
// optional cluster of right-hand actions. The row every league screen used to
// re-declare (DESIGN.md: "17px Bold Plus Jakarta Sans, simple icon buttons").
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import IconButton from './IconButton';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';

export default function ScreenHeader({
  title, onBack, backIcon = 'chevron-left', backLabel, right, numberOfLines, style,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  return (
    <View style={[s.header, style]}>
      <View style={s.left}>
        {onBack ? (
          <IconButton
            icon={backIcon}
            size={24}
            color={theme.accent.primary}
            onPress={onBack}
            accessibilityLabel={backLabel ?? t('common.back')}
          />
        ) : null}
        {title != null ? (
          <Text style={s.title} numberOfLines={numberOfLines}>{title}</Text>
        ) : null}
      </View>
      {right ? <View style={s.right}>{right}</View> : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
    },
    left: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 4 },
    right: { flexDirection: 'row', gap: 4 },
    title: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3, flexShrink: 1,
    },
  });
}
