import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import { SWING_STRINGS } from '../swing/strings';

// Stand-in for the swing routes that later PRs replace (SwingCapture,
// SwingResults, SwingCompare), so navigating from Swing home never hits an
// unregistered route. Deleted route by route as the real screens land.
const COPY = {
  SwingCapture: SWING_STRINGS.placeholder.capture,
  SwingResults: SWING_STRINGS.placeholder.results,
  SwingCompare: SWING_STRINGS.placeholder.compare,
};

export default function SwingPlaceholderScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = StyleSheet.create({
    screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, flexDirection: 'row' },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    text: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: theme.text.secondary, textAlign: 'center', lineHeight: 20 },
  });
  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => navigation.goBack()} />
      </View>
      <View style={s.body}>
        <Text style={s.text}>{COPY[route?.name] ?? ''}</Text>
      </View>
    </ScreenContainer>
  );
}
