import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { CELEBRATION_TIERS } from './constants';
import { useT, formatNumber } from '../../i18n';

// Full-screen takeover for the rare tiers (eagle, albatross, hole-in-one):
// scrim + expanding ring + centred card. Common results use CelebrationToast
// instead — a takeover on every birdie interrupts score entry.
export function CelebrationOverlay({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const tl = useT();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  const scrimOpacity = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0, 0.55],
  });
  const cardOpacity = celebrationAnim;
  const cardScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.75, 1],
  });
  const cardTranslate = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [16, 0],
  });
  const ringScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.6, 1.35],
  });
  const ringOpacity = celebrationAnim.interpolate({
    inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 0],
  });

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={s.celebrationRoot}
    >
      <Animated.View style={[s.celebrationScrim, { opacity: scrimOpacity }]} />
      <Animated.View
        style={[
          s.celebrationRing,
          {
            borderColor: tier.glow,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          s.celebrationCard,
          {
            opacity: cardOpacity,
            borderColor: tier.accent,
            shadowColor: tier.accent,
            transform: [{ scale: cardScale }, { translateY: cardTranslate }],
          },
        ]}
      >
        <View style={[s.celebrationIconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={22} color={tier.accent} />
        </View>
        <Text style={[s.celebrationEyebrow, { color: tier.accent }]}>{tl(`scorecard.celebration.${tier.key}.eyebrow`)}</Text>
        <Text style={s.celebrationLabelBig}>{tl(`scorecard.celebration.${tier.key}.name`)}</Text>
        {!!firstName && (
          <Text style={s.celebrationSubtitle}>
            {tl('scorecard.celebration.subtitle', { name: firstName, hole: formatNumber(celebration.holeNumber) })}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}
