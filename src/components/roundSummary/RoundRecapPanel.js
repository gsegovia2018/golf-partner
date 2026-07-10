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
  highlights,
  live = false,
  totalHoles = 18,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stats = [
    { label: live ? 'Leader pts' : 'Points', value: statValue(recap?.winnerPoints) },
    { label: live ? 'Lead' : 'Margin', value: marginValue(recap?.margin) },
    { label: 'Strokes', value: statValue(recap?.winnerStrokes) },
    {
      label: 'Holes',
      value: live
        ? `${statValue(recap?.holesPlayed)}/${totalHoles}`
        : statValue(recap?.holesPlayed),
    },
    { label: 'Players', value: statValue(recap?.playerCount) },
  ];
  const winnerLabel = recap?.winnerName
    ? `${live ? 'Leading' : 'Winner'}: ${recap.winnerName}`
    : null;

  const highlightChips = [
    { key: 'eagles', count: highlights?.eagles ?? 0, singular: 'eagle', plural: 'eagles', tone: 'excellent' },
    { key: 'birdies', count: highlights?.birdies ?? 0, singular: 'birdie', plural: 'birdies', tone: 'good' },
    { key: 'pars', count: highlights?.pars ?? 0, singular: 'par', plural: 'pars', tone: null },
    { key: 'bogeys', count: highlights?.bogeys ?? 0, singular: 'bogey', plural: 'bogeys', tone: 'neutral' },
    { key: 'doubles', count: highlights?.doubles ?? 0, singular: 'double+', plural: 'double+', tone: 'poor' },
  ].filter((c) => c.count > 0);

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
      {highlightChips.length > 0 ? (
        <View style={s.highlightRow}>
          {highlightChips.map((c) => {
            const color = c.tone ? theme.scoreColor(c.tone) : theme.text.secondary;
            return (
              <View key={c.key} style={[s.highlightChip, { borderColor: color + '55' }]}>
                <View style={[s.highlightDot, { backgroundColor: color }]} />
                <Text style={[s.highlightText, { color }]}>
                  {c.count} {c.count === 1 ? c.singular : c.plural}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
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
      borderRadius: 10,
      borderWidth: 1,
      gap: 10,
      padding: 14,
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
    summary: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      lineHeight: 19,
    },
    highlightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    highlightChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      borderRadius: 999, borderWidth: 1,
      paddingHorizontal: 8, paddingVertical: 4,
    },
    highlightDot: { width: 6, height: 6, borderRadius: 3 },
    highlightText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    stat: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
      borderRadius: 10,
      flexBasis: '30%',
      flexGrow: 1,
      minWidth: 74,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    statValue: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 15,
    },
    statLabel: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 9,
      letterSpacing: 0.8,
      marginTop: 3,
      textTransform: 'uppercase',
    },
  });
}
