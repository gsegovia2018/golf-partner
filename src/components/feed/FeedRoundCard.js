import React from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { getScoringMode } from '../scoringModes';

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

// Strokes-vs-par label + colour, matching the live scoreboard's vs-Par cell.
function vsParText(v) {
  if (v == null) return null;
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}
function vsParColor(v, theme) {
  if (v == null) return theme.text.muted;
  if (v < 0) return theme.scoreColor('excellent');
  if (v === 0) return theme.scoreColor('good');
  return theme.scoreColor('poor');
}

// The current hole a player is on, only mid-round: after ≥1 hole and before
// the round is complete. Mirrors HomeScreen's RoundScoreboard `onHole`.
function onHoleFor(result, live, totalHoles) {
  const played = result?.holes ?? 0;
  return live && played > 0 && played < totalHoles ? played + 1 : null;
}

// Modes where the plain per-player "points / strokes" tiles don't tell the
// whole story — surface the mode so a viewer knows what they're looking at.
// Solo & partner Stableford (individual/stableford) read correctly as-is.
function modeBadgeLabel(scoringMode) {
  if (!scoringMode || scoringMode === 'individual' || scoringMode === 'stableford') return null;
  return getScoringMode(scoringMode).label;
}

function roundTitle(item, roundLabel) {
  return roundLabel || item.courseName || 'Round';
}

function leaderSummary(leader, second) {
  if (!leader) return 'No scores recorded yet';
  const points = statValue(leader.points);
  if (!second) {
    return `${leader.name || 'Player'} scored ${points} pts`;
  }
  const margin = Number.isFinite(leader.points) && Number.isFinite(second?.points)
    ? leader.points - second.points
    : null;
  if (margin != null && margin > 0) {
    return `${leader.name || 'Leader'} led by ${margin} with ${points} pts`;
  }
  return `${leader.name || 'Leader'} led with ${points} pts`;
}

function playerCountLabel(count) {
  if (count === 1) return '1 player';
  return `${count} players`;
}

function mediaResizeMode(media) {
  return media?.kind === 'video' ? 'contain' : 'cover';
}

export default function FeedRoundCard({
  item,
  roundLabel,
  timestamp,
  onPress,
  onPressMedia,
  children,
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const s = makeStyles(theme);
  const allResults = item.results ?? [];
  const results = allResults.slice(0, 3);
  const resultCount = item.playerCount ?? allResults.length;
  const hiddenCount = Math.max(0, resultCount - results.length);
  const leader = results[0] ?? null;
  const second = results[1] ?? null;
  const contextLabel = item.withMe || item.isMine ? 'Your round' : 'Friends round';
  const mediaLabel = item.mediaCountLabel || (item.mediaCount ? `${item.mediaCount} photos` : null);
  const mediaList = Array.isArray(item.mediaList) && item.mediaList.length > 0
    ? item.mediaList
    : (item.mediaCoverUrl ? [{
      id: item.mediaId,
      thumbUrl: item.mediaCoverUrl,
      url: item.mediaUrl,
      kind: item.mediaHasVideo ? 'video' : 'photo',
    }] : []);
  const mediaFrameWidth = Math.max(220, Math.min(520, (Number(width) || 390) - 60));
  const showScorePreview = results.length > 0;
  const live = !!item.live;
  const totalHoles = item.totalHoles ?? 18;
  const modeLabel = modeBadgeLabel(item.scoringMode);

  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={s.kickerRow}>
        <View style={s.kickerLeft}>
          {live ? (
            <View style={s.livePill} accessibilityLabel="Live round in progress">
              <View style={s.liveDot} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
          ) : (
            <View style={s.statusPill}>
              <Feather
                name={item.withMe || item.isMine ? 'check-circle' : 'users'}
                size={11}
                color={theme.accent.primary}
              />
              <Text style={s.statusText}>{contextLabel}</Text>
            </View>
          )}
          {modeLabel ? (
            <View style={s.modePill}>
              <Feather name="flag" size={10} color={theme.text.secondary} />
              <Text style={s.modeText} numberOfLines={1}>{modeLabel}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.timeText}>{timestamp}</Text>
      </View>

      <View style={s.heroRow}>
        <View style={s.heroText}>
          <Text style={s.title} numberOfLines={2}>{roundTitle(item, roundLabel)}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {item.tournamentName || 'Golf activity'}
          </Text>
        </View>
      </View>

      {mediaList.length > 0 ? (
        mediaList.length === 1 ? (
          <TouchableOpacity
            style={s.roundPhotoWrap}
            activeOpacity={0.85}
            onPress={(event) => {
              event?.stopPropagation?.();
              onPressMedia?.(mediaList[0]);
            }}
            accessibilityRole="imagebutton"
            accessibilityLabel="Open round photo"
          >
            <Image
              source={{ uri: mediaList[0].thumbUrl || mediaList[0].url }}
              style={s.roundPhoto}
              resizeMode={mediaResizeMode(mediaList[0])}
            />
            {mediaLabel ? (
              <View style={s.photoBadge}>
                <Feather
                  name={item.mediaHasVideo ? 'film' : 'camera'}
                  size={11}
                  color="#fff"
                />
                <Text style={s.photoBadgeText}>{mediaLabel}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.mediaScrollerContent}
            snapToInterval={mediaFrameWidth + 8}
            decelerationRate="fast"
            style={s.mediaScroller}
          >
            {mediaList.map((media, index) => (
              <TouchableOpacity
                key={media.id || `${media.url}-${index}`}
                style={[s.roundPhotoWrap, s.roundPhotoStripItem, { width: mediaFrameWidth }]}
                activeOpacity={0.85}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onPressMedia?.(media);
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Open round photo ${index + 1} of ${mediaList.length}`}
              >
                <Image
                  source={{ uri: media.thumbUrl || media.url }}
                  style={s.roundPhoto}
                  resizeMode={mediaResizeMode(media)}
                />
                <View style={s.photoBadge}>
                  <Feather
                    name={media.kind === 'video' ? 'film' : 'camera'}
                    size={11}
                    color="#fff"
                  />
                  <Text style={s.photoBadgeText}>{index + 1} / {mediaList.length}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )
      ) : null}

      <View style={s.recapRow}>
        <Avatar item={{ ...item, actorName: leader?.name || item.actorName }} theme={theme} />
        <View style={s.recapTextWrap}>
          <Text style={s.recapText} numberOfLines={2}>{leaderSummary(leader, second)}</Text>
          <View style={s.chipRow}>
            <View style={s.infoChip}>
              <Feather name="users" size={11} color={theme.text.muted} />
              <Text style={s.infoChipText}>{playerCountLabel(resultCount)}</Text>
            </View>
            {mediaLabel && !item.mediaCoverUrl ? (
              <View style={s.infoChip}>
                <Feather name={item.mediaHasVideo ? 'film' : 'camera'} size={11} color={theme.text.muted} />
                <Text style={s.infoChipText}>{mediaLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {showScorePreview ? (
        <View style={s.scorePreview}>
          <View style={s.scoreStrip}>
            {results.map((result, index) => {
              const onHole = onHoleFor(result, live, totalHoles);
              const vp = vsParText(result.vsPar);
              return (
              <View
                key={resultKey(result, index)}
                style={[s.scoreTile, index === 0 && s.scoreTileLead]}
              >
                <View style={s.tileTopRow}>
                  <View style={[s.rankWrap, index === 0 && s.rankWrapLead]}>
                    <Text style={s.rank}>{index + 1}</Text>
                  </View>
                  {onHole != null ? (
                    <View style={s.holeBadge} accessibilityLabel={`On hole ${onHole}`}>
                      <Text style={s.holeBadgeText}>H{onHole}</Text>
                    </View>
                  ) : result.handicap != null ? (
                    <Text style={s.hcpText}>HCP {result.handicap}</Text>
                  ) : null}
                </View>
                <Text style={s.resultName} numberOfLines={1}>{result.name || 'Player'}</Text>
                <View style={s.pointsLine}>
                  <Text style={s.statValue}>{statValue(result.points)}</Text>
                  <Text style={s.statLabel}>pts</Text>
                  {result.strokes != null ? (
                    <Text style={s.strokesText}>{statValue(result.strokes)} str</Text>
                  ) : null}
                </View>
                {vp != null ? (
                  <Text style={[s.vsParText, { color: vsParColor(result.vsPar, theme) }]}>
                    {vp} vs par
                  </Text>
                ) : null}
              </View>
              );
            })}
          </View>
          {hiddenCount > 0 ? (
            <View style={s.overflowRow}>
              <Text style={s.overflowText}>
                +{hiddenCount} more player{hiddenCount === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
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
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
      marginBottom: 12,
    },
    kickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 10,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: theme.accent.light,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    statusText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 11,
    },
    kickerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      minWidth: 0,
    },
    // Glowing "LIVE" pill — red halo so an in-progress round pops in the feed.
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: theme.scoreColor('poor') + '22',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: theme.scoreColor('poor'),
      shadowColor: theme.scoreColor('poor'),
      shadowOpacity: 0.5,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.scoreColor('poor'),
    },
    liveText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.scoreColor('poor'),
      fontSize: 10,
      letterSpacing: 0.5,
    },
    modePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.bg.secondary,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      flexShrink: 1,
      minWidth: 0,
    },
    modeText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 10,
      flexShrink: 1,
    },
    timeText: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
    },
    heroRow: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
    },
    heroText: { flex: 1, minWidth: 0 },
    title: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 16,
      lineHeight: 21,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
      marginTop: 3,
    },
    roundPhotoWrap: {
      height: 210,
      borderRadius: 8,
      marginTop: 12,
      overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    mediaScroller: {
      marginTop: 12,
    },
    mediaScrollerContent: {
      gap: 8,
      paddingRight: 2,
    },
    roundPhotoStripItem: {
      marginTop: 0,
    },
    roundPhoto: {
      width: '100%',
      height: '100%',
    },
    photoBadge: {
      position: 'absolute',
      right: 9,
      bottom: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.58)',
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    photoBadgeText: {
      color: '#fff',
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 11,
    },
    recapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border.subtle || theme.border.default,
    },
    recapTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    recapText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
      fontSize: 13,
      lineHeight: 18,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 7,
    },
    infoChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 999,
      backgroundColor: theme.bg.secondary,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    infoChipText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 10,
    },
    scorePreview: {
      marginTop: 12,
      gap: 8,
    },
    scoreStrip: {
      flexDirection: 'row',
      gap: 8,
    },
    scoreTile: {
      flex: 1,
      minWidth: 0,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.card,
      padding: 8,
    },
    scoreTileLead: {
      backgroundColor: theme.accent.light,
      borderColor: theme.accent.primary,
    },
    overflowRow: {
      backgroundColor: theme.bg.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 7,
      paddingHorizontal: 10,
      alignItems: 'center',
    },
    overflowText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 12,
    },
    tileTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 4,
    },
    // Glowing "on hole N" badge — same halo recipe as the live scoreboard's
    // per-player HOLE badge on HomeScreen.
    holeBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 7,
      backgroundColor: theme.accent.light,
      borderWidth: 1.5,
      borderColor: theme.accent.primary,
      shadowColor: theme.accent.primary,
      shadowOpacity: 0.5,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    holeBadgeText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
      fontSize: 10,
      letterSpacing: 0.3,
    },
    hcpText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 10,
    },
    vsParText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 10,
      marginTop: 3,
    },
    rankWrap: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    rankWrapLead: {
      backgroundColor: theme.bg.card,
    },
    rank: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 11,
    },
    resultName: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
      color: theme.text.primary,
      marginTop: 7,
    },
    pointsLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 3,
      marginTop: 2,
      flexWrap: 'wrap',
    },
    statValue: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    statLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 10,
      color: theme.text.muted,
      marginTop: 1,
      textTransform: 'uppercase',
    },
    strokesText: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
      marginLeft: 3,
    },
  });
}
