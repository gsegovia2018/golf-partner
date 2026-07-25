import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { CELEBRATION_TIERS } from './constants';

// Non-blocking celebration for the common tiers (birdie, noelada). Slides in at
// the top, holds, slides out — the scorecard stays visible and usable, so a
// birdie no longer interrupts score entry the way the full-screen takeover did.
//
// Absolutely positioned and pointerEvents="none" on purpose: a toast that
// participated in layout would push the score card and its +/- steppers down
// mid-tap, which is worse than the takeover it replaces.
export function CelebrationToast({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  // Strokes relative to par. Rendered with a true minus sign (U+2212) so the
  // number lines up with the tabular figures used elsewhere on the scorecard.
  const delta = celebration.delta;
  const deltaLabel = typeof delta === 'number' && Number.isFinite(delta)
    ? (delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`)
    : null;

  const translateY = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [-40, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[s.root, { opacity: celebrationAnim, transform: [{ translateY }] }]}
    >
      <View style={[s.toast, { borderColor: tier.accent, borderLeftColor: tier.accent }]}>
        <View style={[s.iconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={13} color={tier.accent} />
        </View>
        <View style={s.textWrap}>
          <Text style={s.label} numberOfLines={1}>{celebration.label}</Text>
          {!!firstName && (
            <Text style={s.subtitle} numberOfLines={1}>{`${firstName} · Hole ${celebration.holeNumber}`}</Text>
          )}
        </View>
        {!!deltaLabel && (
          <Text style={[s.delta, { color: tier.accent }]}>{deltaLabel}</Text>
        )}
      </View>
    </Animated.View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    root: {
      position: 'absolute',
      top: 8,
      left: 12,
      right: 12,
      zIndex: 60,
      elevation: 60,
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      // bg.deep is the theme's surface for play & results (LiveRoundCard,
      // leaderboard, and the takeover card). A hardcoded #003d27 here would
      // have been a pre-light-theme leftover in no palette; both surfaces
      // now use bg.deep instead.
      backgroundColor: theme.bg.deep,
      borderRadius: 12,
      borderWidth: 1,
      borderLeftWidth: 3,
      paddingVertical: 10,
      paddingHorizontal: 13,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    iconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    textWrap: { flex: 1 },
    label: {
      color: '#ffffff',
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 16,
      letterSpacing: 1,
    },
    subtitle: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 10,
      letterSpacing: 0.4,
      marginTop: 3,
    },
    delta: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 17,
      fontVariant: ['tabular-nums'],
    },
  });
}
