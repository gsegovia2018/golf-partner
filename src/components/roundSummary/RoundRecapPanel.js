import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function statValue(value, fallback = '0') {
  return value == null || value === '' ? fallback : String(value);
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
    { label: 'Winner', value: recap?.winnerName || 'No winner' },
    { label: 'Points', value: statValue(recap?.winnerPoints) },
    { label: 'Margin', value: statValue(recap?.margin) },
    { label: 'Strokes', value: statValue(recap?.winnerStrokes) },
    { label: 'Holes', value: statValue(recap?.holesPlayed) },
    { label: 'Players', value: statValue(recap?.playerCount) },
  ];

  return (
    <View style={s.card}>
      {tournamentName ? (
        <Text style={s.tournamentName} numberOfLines={1}>{tournamentName}</Text>
      ) : null}
      {roundLabel ? (
        <Text style={s.roundLabel} numberOfLines={1}>{roundLabel}</Text>
      ) : null}
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
      gap: 10,
      padding: 14,
    },
    tournamentName: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
      textTransform: 'uppercase',
    },
    roundLabel: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 18,
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
      gap: 8,
    },
    stat: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 6,
      flexBasis: '31%',
      flexGrow: 1,
      minWidth: 0,
      paddingHorizontal: 8,
      paddingVertical: 8,
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
