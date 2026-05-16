import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

// Single source of truth for the four scoring modes so SetupScreen and
// EditTournamentScreen present identical labels, icons and player-count
// gating. Order is fixed: solo modes first, then partner-based modes.
export const SCORING_MODES = [
  {
    key: 'individual',
    label: 'Stableford',
    subtitle: 'Highest points wins',
    icon: 'user',
    // Solo ranking — needs at least 2 players to be a contest.
    isAllowed: (count) => count >= 2,
    requirement: 'Requires 2+ players',
  },
  {
    key: 'stableford',
    label: 'Stableford with Partners',
    subtitle: 'Random partners each round',
    icon: 'users',
    isAllowed: (count) => count >= 2,
    requirement: 'Requires 2+ players',
  },
  {
    key: 'matchplay',
    label: 'Match Play',
    subtitle: 'Head-to-head, hole by hole',
    icon: 'flag',
    // Match play is strictly 1-vs-1.
    isAllowed: (count) => count === 2,
    requirement: 'Requires exactly 2 players',
  },
  {
    key: 'bestball',
    label: 'Best Ball / Worst Ball',
    subtitle: 'Two pairs, best & worst score',
    icon: 'award',
    // Two pairs of two.
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
];

// Returns true when `mode` is valid for the given player count.
export function isScoringModeAllowed(mode, playerCount) {
  const def = SCORING_MODES.find((m) => m.key === mode);
  return def ? def.isAllowed(playerCount) : false;
}

// Picks a safe fallback mode when the current one becomes invalid.
export function fallbackScoringMode(playerCount) {
  return isScoringModeAllowed('stableford', playerCount) ? 'stableford' : 'individual';
}

export default function ScoringModePicker({ value, onChange, playerCount, settings, onSettingsChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <View>
      <View style={s.modeRow}>
        {SCORING_MODES.map((mode) => {
          const allowed = mode.isAllowed(playerCount);
          const active = value === mode.key;
          return (
            <TouchableOpacity
              key={mode.key}
              style={[s.modeBtn, active && s.modeBtnActive, !allowed && { opacity: 0.5 }]}
              onPress={() => { if (allowed) onChange(mode.key); }}
              activeOpacity={allowed ? 0.7 : 1}
            >
              <View style={s.modeHeader}>
                <Feather
                  name={mode.icon}
                  size={16}
                  color={active
                    ? (theme.isDark ? theme.accent.primary : theme.text.inverse)
                    : theme.text.muted}
                  style={{ marginRight: 8 }}
                />
                <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>
                  {mode.label}
                </Text>
              </View>
              {allowed && mode.subtitle && (
                <Text style={[s.modeSubtitle, active && s.modeSubtitleActive]}>
                  {mode.subtitle}
                </Text>
              )}
              {!allowed && (
                <Text style={s.modeRequirement}>{mode.requirement}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {value === 'bestball' && settings && onSettingsChange && (
        <View style={s.valueRow}>
          <View style={s.valueBlock}>
            <Text style={s.valueLabel}>Best Ball</Text>
            <TextInput
              style={s.valueInput}
              keyboardType="numeric"
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              maxLength={2}
              value={String(settings.bestBallValue)}
              onChangeText={(v) => onSettingsChange({ ...settings, bestBallValue: v })}
            />
            <Text style={s.valueSuffix}>pts / hole</Text>
          </View>
          <View style={s.valueBlock}>
            <Text style={s.valueLabel}>Worst Ball</Text>
            <TextInput
              style={s.valueInput}
              keyboardType="numeric"
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              maxLength={2}
              value={String(settings.worstBallValue)}
              onChangeText={(v) => onSettingsChange({ ...settings, worstBallValue: v })}
            />
            <Text style={s.valueSuffix}>pts / hole</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  modeRow: { gap: 8 },
  modeBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14,
    alignItems: 'center',
    marginBottom: 6,
  },
  modeBtnActive: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : theme.accent.primary,
  },
  modeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  modeBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14 },
  modeBtnTextActive: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
  },
  modeSubtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, marginTop: 4,
    color: theme.text.muted,
  },
  modeSubtitleActive: { color: theme.isDark ? theme.accent.primary : theme.text.inverse },
  modeRequirement: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, marginTop: 4,
    color: theme.text.muted,
  },
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, alignItems: 'center', gap: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  valueLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  valueInput: {
    backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.secondary,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 56, textAlign: 'center', fontSize: 22,
    fontFamily: 'PlusJakartaSans-ExtraBold', padding: 8,
  },
  valueSuffix: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
});
