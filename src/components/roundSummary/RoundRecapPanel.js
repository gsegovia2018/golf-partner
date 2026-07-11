import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function statValue(value, fallback = '0') {
  return value == null || value === '' ? fallback : String(value);
}

// Slim round header: title, who won (or is leading), and one meta line.
// Points and standings live in the green leaderboard on the scorecard tab.
export default function RoundRecapPanel({
  tournamentName,
  roundLabel,
  recap,
  live = false,
  totalHoles = 18,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const holesLabel = live
    ? `${statValue(recap?.holesPlayed)}/${totalHoles} holes`
    : `${statValue(recap?.holesPlayed)} holes`;
  const playerCount = Number(recap?.playerCount) || 0;
  const playersLabel = `${playerCount} player${playerCount === 1 ? '' : 's'}`;

  const winnerLabel = recap?.winnerName
    ? `${live ? 'Leading' : 'Winner'}: ${recap.winnerName}`
    : null;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.headerText}>
          {tournamentName ? (
            <Text style={s.tournamentName} numberOfLines={1}>{tournamentName}</Text>
          ) : null}
          {roundLabel ? (
            <Text style={s.roundLabel} numberOfLines={1}>{roundLabel}</Text>
          ) : null}
        </View>
        {winnerLabel ? (
          <View style={s.playerPill}>
            <Text style={s.playerPillText} numberOfLines={1}>{winnerLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.metaRow}>
        <Text style={s.metaText}>{holesLabel}</Text>
        <View style={s.metaDot} />
        <Text style={s.metaText}>{playersLabel}</Text>
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 10,
      borderWidth: 1,
      gap: 4,
      padding: 14,
    },
    tournamentName: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    roundLabel: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 17,
      lineHeight: 22,
    },
    headerRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'space-between',
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    playerPill: {
      backgroundColor: theme.accent.light,
      borderRadius: 999,
      maxWidth: '48%',
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    playerPillText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: theme.text.muted,
    },
    metaText: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
  });
}
