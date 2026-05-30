import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function statValue(value, fallback = '0') {
  return value == null || value === '' ? fallback : String(value);
}

function marginValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n > 0 ? `+${n}` : String(n);
}

export default function RoundRecapPanel({
  tournamentName,
  roundLabel,
  summary,
  recap,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stats = [
    { label: 'Points', value: statValue(recap?.winnerPoints) },
    { label: 'Margin', value: marginValue(recap?.margin) },
    { label: 'Strokes', value: statValue(recap?.winnerStrokes) },
    { label: 'Holes', value: statValue(recap?.holesPlayed) },
    { label: 'Players', value: statValue(recap?.playerCount) },
  ];
  const winnerLabel = recap?.winnerName
    ? `Winner: ${recap.winnerName}`
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
      {summary ? <Text style={s.summary}>{summary}</Text> : null}
      <View style={s.statsRow}>
        {stats.map((stat) => (
          <View key={stat.label} style={s.stat}>
            <Text style={s.statValue} numberOfLines={1}>{stat.value}</Text>
            <Text style={s.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 8,
      borderWidth: 1,
      gap: 9,
      padding: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      justifyContent: 'space-between',
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    tournamentName: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    roundLabel: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 16,
      lineHeight: 21,
      marginTop: 2,
    },
    playerPill: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 999,
      maxWidth: '48%',
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    playerPillText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
    },
    summary: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      lineHeight: 19,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    stat: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 6,
      flexBasis: '30%',
      flexGrow: 1,
      minWidth: 74,
      paddingHorizontal: 6,
      paddingVertical: 7,
    },
    statValue: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 14,
    },
    statLabel: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 10,
      marginTop: 2,
      textTransform: 'uppercase',
    },
  });
}
