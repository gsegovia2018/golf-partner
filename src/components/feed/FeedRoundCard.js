import React from 'react';
import {
  Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

function Avatar({ item, theme }) {
  const initial = (item.actorName || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[
      styles.avatar,
      { backgroundColor: item.actorAvatarColor || theme.accent.primary },
    ]}>
      {item.actorAvatarUrl
        ? <Image source={{ uri: item.actorAvatarUrl }} style={styles.avatarImage} />
        : <Text style={styles.avatarText}>{initial}</Text>}
    </View>
  );
}

function resultKey(result, index) {
  return result.playerId || result.userId || `${result.name || 'player'}-${index}`;
}

function statValue(value) {
  return value == null ? '-' : String(value);
}

function roundTitle(item, roundLabel) {
  const actorName = item.actorName || item.results?.[0]?.name || 'Someone';
  const playerCount = item.playerCount ?? item.results?.length ?? 1;
  const others = Math.max(0, playerCount - 1);
  const subject = others > 0
    ? `${actorName} and ${others} other${others === 1 ? '' : 's'}`
    : actorName;
  const label = roundLabel || item.courseName || 'a round';
  return `${subject} played ${label}`;
}

export default function FeedRoundCard({
  item,
  roundLabel,
  timestamp,
  onPress,
  children,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const results = (item.results ?? []).slice(0, 3);

  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={s.header}>
        <Avatar item={item} theme={theme} />
        <View style={s.headerText}>
          <Text style={s.title} numberOfLines={2}>{roundTitle(item, roundLabel)}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {item.tournamentName ? `${item.tournamentName} · ` : ''}{timestamp}
          </Text>
        </View>
      </View>

      {results.length > 0 ? (
        <View style={s.resultsList}>
          {results.map((result, index) => (
            <View key={resultKey(result, index)} style={s.resultRow}>
              <View style={s.rankWrap}>
                <Text style={s.rank}>{index + 1}</Text>
              </View>
              <Text style={s.resultName} numberOfLines={1}>{result.name || 'Player'}</Text>
              <View style={s.statBlock}>
                <Text style={s.statValue}>{statValue(result.points)}</Text>
                <Text style={s.statLabel}>PTS</Text>
              </View>
              <View style={s.secondaryStat}>
                <Text style={s.secondaryValue}>{statValue(result.strokes)}</Text>
                <Text style={s.secondaryLabel}>STR</Text>
              </View>
              <View style={s.secondaryStat}>
                <Text style={s.secondaryValue}>{statValue(result.holes)}</Text>
                <Text style={s.secondaryLabel}>H</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!item.isMine && !item.withMe ? (
        <View style={s.contextRow}>
          <Feather name="users" size={11} color={theme.text.muted} />
          <Text style={s.contextText}>A round without you</Text>
        </View>
      ) : null}

      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: '#ffd700',
    fontSize: 14,
  },
});

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 14,
      marginBottom: 12,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerText: { flex: 1, minWidth: 0 },
    title: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 14,
      lineHeight: 19,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
      marginTop: 2,
    },
    resultsList: {
      marginTop: 12,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.border.default,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: theme.bg.secondary,
      borderBottomWidth: 1,
      borderBottomColor: theme.border.default,
    },
    rankWrap: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg.card,
    },
    rank: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 11,
    },
    resultName: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13,
      color: theme.text.primary,
    },
    statBlock: { alignItems: 'flex-end', minWidth: 44 },
    statValue: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    statLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 8,
      color: theme.text.muted,
      marginTop: 1,
    },
    secondaryStat: { alignItems: 'flex-end', minWidth: 32 },
    secondaryValue: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 12,
      color: theme.text.secondary,
    },
    secondaryLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 8,
      color: theme.text.muted,
      marginTop: 1,
    },
    contextRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 10,
    },
    contextText: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
    },
  });
}
