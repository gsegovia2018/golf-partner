import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// Round leaderboard for the summary page — same quiet card language as the
// recap panel (radius-10 card, hairline border), ranked by Stableford
// points. The leader reads through the accent: tinted rank circle, accent
// left bar, accent points. While live, each player carries the app's
// standard glowing HOLE badge.
export default function RoundLeaderboard({ entries, round, live = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length < 2) return null;

  const holes = round?.holes ?? [];
  const totalHoles = holes.length || 18;
  const playedFor = (playerId) => {
    const ps = round?.scores?.[playerId] ?? {};
    return holes.filter((hole) => hole?.number != null && ps[hole.number] != null).length;
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>LEADERBOARD</Text>
      {rows.map((entry, i) => {
        const isLeader = i === 0 && entry.totalPoints > 0;
        const played = playedFor(entry.player.id);
        // Glowing "on hole N" badge, only meaningful mid-round — same rule
        // and recipe as the Home scoreboard.
        const onHole = live && played > 0 && played < totalHoles ? played + 1 : null;
        const hcp = entry.handicap;
        return (
          <View
            key={entry.player.id}
            style={[
              s.row,
              isLeader && s.rowLeader,
              i === rows.length - 1 && { borderBottomWidth: 0 },
            ]}
          >
            <View style={[s.rankBadge, isLeader && s.rankBadgeLeader]}>
              <Text style={[s.rankText, isLeader && s.rankTextLeader]}>{i + 1}</Text>
            </View>
            <View style={s.nameCol}>
              <View style={s.nameRow}>
                <Text style={[s.name, isLeader && s.nameLead]} numberOfLines={1}>
                  {entry.player.name}
                </Text>
                {onHole != null ? (
                  <View style={s.holeBadge} accessibilityLabel={`On hole ${onHole}`}>
                    <Text style={s.holeBadgeText}>HOLE {onHole}</Text>
                  </View>
                ) : null}
              </View>
              {Number.isFinite(hcp) ? <Text style={s.rowSub}>HCP {hcp}</Text> : null}
            </View>
            <Text style={[s.points, isLeader && s.pointsLead]}>
              {entry.totalPoints} pts
            </Text>
            <Text style={s.strokes}>{entry.totalStrokes || '-'} str</Text>
          </View>
        );
      })}
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
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    title: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 10,
      letterSpacing: 2,
      marginBottom: 2,
      textTransform: 'uppercase',
    },
    row: {
      alignItems: 'center',
      borderBottomColor: theme.border.default,
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingVertical: 10,
    },
    rowLeader: {
      borderLeftColor: theme.accent.primary,
      borderLeftWidth: 3,
      marginLeft: -8,
      paddingLeft: 8,
    },
    rankBadge: {
      alignItems: 'center',
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      borderRadius: 14,
      height: 28,
      justifyContent: 'center',
      marginRight: 10,
      width: 28,
    },
    rankBadgeLeader: {
      backgroundColor: theme.accent.light,
    },
    rankText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 12,
    },
    rankTextLeader: {
      color: theme.accent.primary,
    },
    nameCol: {
      flex: 1,
      marginRight: 8,
      minWidth: 0,
    },
    nameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      minWidth: 0,
    },
    name: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 14,
    },
    nameLead: {
      fontFamily: 'PlusJakartaSans-Bold',
    },
    rowSub: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 10,
      letterSpacing: 0.5,
      marginTop: 2,
    },
    // Standard app glow badge — accent halo on the card ground.
    holeBadge: {
      backgroundColor: theme.accent.light,
      borderColor: theme.accent.primary,
      borderRadius: 8,
      borderWidth: 1.5,
      elevation: 4,
      paddingHorizontal: 7,
      paddingVertical: 2,
      shadowColor: theme.accent.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 7,
    },
    holeBadgeText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      letterSpacing: 0.4,
    },
    points: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 15,
      marginRight: 8,
    },
    pointsLead: {
      color: theme.accent.primary,
      fontSize: 17,
    },
    strokes: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 11,
      textAlign: 'right',
      width: 44,
    },
  });
}
