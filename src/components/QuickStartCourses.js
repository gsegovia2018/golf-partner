import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import { light, semantic, typography, spacing, radius } from '../theme/tokens';

const DEFAULT_THEME = {
  ...light,
  typography,
  spacing,
  radius,
  destructive: semantic.destructive.light,
  isDark: false,
};

const MAX_QUICK_START_PLAYERS = 4;

export function coursePar(course) {
  const holes = Array.isArray(course?.holes) ? course.holes : [];
  if (holes.length === 0) return null;
  return holes.reduce((sum, hole) => sum + (Number(hole?.par) || 0), 0);
}

export function courseTeeCount(course) {
  const tees = Array.isArray(course?.tees) ? course.tees : [];
  return tees.filter((tee) => String(tee?.label || tee?.name || '').trim().length > 0).length;
}

export function quickStartCourseMeta(course) {
  const par = coursePar(course);
  const teeCount = courseTeeCount(course);
  if (par == null || teeCount === 0) return '';
  return `Par ${par} · ${teeCount} ${teeCount === 1 ? 'tee' : 'tees'}`;
}

export function initialQuickStartPlayerIds(players, userId) {
  if (!userId) return [];
  const player = (players || []).find((p) => p?.user_id === userId || p?.userId === userId);
  return player?.id ? [player.id] : [];
}

function courseTitle(course) {
  return course?.layoutName || course?.name || 'Course';
}

function playerName(player) {
  return player?.name || player?.displayName || 'Player';
}

function playerInitials(player) {
  return playerName(player)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P';
}

function isLinkedAppUser(player) {
  return !!(player?.user_id || player?.userId);
}

export default function QuickStartCourses({
  courses = [],
  coursesLoading = false,
  players = [],
  currentUserId,
  userId,
  playersLoading = false,
  playersError = null,
  starting = false,
  onManage,
  onRetryPlayers,
  onStart,
  onEditDetails,
}) {
  const themeContext = useTheme() || {};
  const theme = themeContext.theme || DEFAULT_THEME;
  const s = makeStyles(theme);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const signedInUserId = currentUserId || userId;
  const normalizedCourses = Array.isArray(courses) ? courses : [];
  const normalizedPlayers = useMemo(
    () => (Array.isArray(players) ? players : []),
    [players],
  );

  const playerById = useMemo(
    () => new Map(normalizedPlayers.map((player) => [player.id, player])),
    [normalizedPlayers],
  );

  const selectedPlayers = useMemo(
    () => selectedPlayerIds.map((id) => playerById.get(id)).filter(Boolean),
    [playerById, selectedPlayerIds],
  );

  const availablePlayers = useMemo(
    () => normalizedPlayers.filter((player) => !selectedPlayerIds.includes(player.id)),
    [normalizedPlayers, selectedPlayerIds],
  );

  useEffect(() => {
    if (!selectedCourse || selectionTouched) return;
    const nextIds = initialQuickStartPlayerIds(normalizedPlayers, signedInUserId)
      .slice(0, MAX_QUICK_START_PLAYERS);
    setSelectedPlayerIds((prev) => {
      if (prev.length === nextIds.length && prev.every((id, index) => id === nextIds[index])) {
        return prev;
      }
      return nextIds;
    });
  }, [selectedCourse, normalizedPlayers, signedInUserId, selectionTouched]);

  const openCourse = (course) => {
    setSelectedCourse(course);
    setSelectionTouched(false);
    setAddingPlayer(false);
    setSelectedPlayerIds(
      initialQuickStartPlayerIds(normalizedPlayers, signedInUserId)
        .slice(0, MAX_QUICK_START_PLAYERS),
    );
  };

  const closeSheet = () => {
    setSelectedCourse(null);
    setAddingPlayer(false);
  };

  const addPlayer = (playerId) => {
    setSelectionTouched(true);
    setSelectedPlayerIds((prev) => {
      if (prev.includes(playerId) || prev.length >= MAX_QUICK_START_PLAYERS) return prev;
      return [...prev, playerId];
    });
    setAddingPlayer(false);
  };

  const removePlayer = (playerId) => {
    setSelectionTouched(true);
    setSelectedPlayerIds((prev) => prev.filter((id) => id !== playerId));
  };

  const startDisabled = selectedPlayers.length === 0 || starting;
  const emptySlots = Math.max(0, MAX_QUICK_START_PLAYERS - selectedPlayers.length);
  const editDetails = () => {
    if (!selectedCourse) return;
    const payload = { course: selectedCourse, players: selectedPlayers };
    closeSheet();
    onEditDetails?.(payload);
  };
  const startRound = () => {
    if (startDisabled) return;
    const payload = { course: selectedCourse, players: selectedPlayers };
    closeSheet();
    onStart?.(payload);
  };

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.heading}>QUICK START</Text>
        <TouchableOpacity
          onPress={onManage}
          style={[s.manageButton, !onManage && s.manageButtonDisabled]}
          disabled={!onManage}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Manage quick start courses"
          accessibilityState={{ disabled: !onManage }}
        >
          <Text style={[s.manageText, !onManage && s.manageTextDisabled]}>Manage</Text>
        </TouchableOpacity>
      </View>

      {coursesLoading && normalizedCourses.length === 0 ? (
        <View style={s.emptyState}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={s.emptyTitle}>Loading favorite courses...</Text>
        </View>
      ) : normalizedCourses.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.rail}
        >
          {normalizedCourses.map((course) => {
            const meta = quickStartCourseMeta(course);
            return (
              <TouchableOpacity
                key={course.id || courseTitle(course)}
                style={s.courseCard}
                activeOpacity={0.78}
                onPress={() => openCourse(course)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${courseTitle(course)} quick start`}
              >
                <View style={s.courseIcon}>
                  <Feather name="flag" size={18} color={theme.accent.primary} />
                </View>
                <Text style={s.courseName} numberOfLines={2}>{courseTitle(course)}</Text>
                {meta ? <Text style={s.courseMeta}>{meta}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <View style={s.emptyState}>
          <Feather name="star" size={32} color={theme.text.muted} />
          <Text style={s.emptyTitle}>No favorite courses yet</Text>
          <Text style={s.emptySubtitle}>
            Open Courses and tap the star on a course to quick start from here.
          </Text>
        </View>
      )}

      <BottomSheet visible={!!selectedCourse} onClose={closeSheet} sheetStyle={s.sheet}>
        <View style={s.handle} />
        <View style={s.sheetInner}>
            <View style={s.sheetHeader}>
              <View style={s.sheetTitleWrap}>
                <Text style={s.sheetEyebrow}>Quick start</Text>
                <Text style={s.sheetTitle}>{courseTitle(selectedCourse)}</Text>
                {quickStartCourseMeta(selectedCourse) ? (
                  <Text style={s.sheetMeta}>{quickStartCourseMeta(selectedCourse)}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={closeSheet}
                style={s.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close quick start"
              >
                <Feather name="x" size={20} color={theme.text.muted} />
              </TouchableOpacity>
            </View>

            <Text style={s.notice}>
              Tees are auto-assigned. Use Edit details to change them.
            </Text>

            <View style={s.playersHeader}>
              <Text style={s.playersLabel}>Players</Text>
              {addingPlayer ? (
                <TouchableOpacity
                  onPress={() => setAddingPlayer(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to selected players"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.playersHeaderAction}>Slots</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {playersLoading ? (
              <View style={s.stateBox}>
                <ActivityIndicator color={theme.accent.primary} />
                <Text style={s.stateText}>Loading players...</Text>
              </View>
            ) : playersError ? (
              <View style={s.stateBox}>
                <Text style={s.errorText}>
                  {typeof playersError === 'string' ? playersError : 'Could not load players.'}
                </Text>
                <TouchableOpacity
                  style={s.retryButton}
                  onPress={onRetryPlayers}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading players"
                >
                  <Text style={s.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : addingPlayer ? (
              <ScrollView style={s.playersList} contentContainerStyle={s.playersContent}>
                {availablePlayers.length ? availablePlayers.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={s.addPlayerRow}
                    activeOpacity={0.75}
                    onPress={() => addPlayer(player.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${playerName(player)}`}
                  >
                    <View style={s.addPlayerAvatar}>
                      <Text style={s.addPlayerInitials}>{playerInitials(player)}</Text>
                    </View>
                    <View style={s.playerTextWrap}>
                      <View style={s.addPlayerNameRow}>
                        <Text style={s.playerName}>{playerName(player)}</Text>
                        {isLinkedAppUser(player) ? (
                          <View style={s.linkedBadge}>
                            <Feather name="user-check" size={10} color={theme.accent.primary} />
                            <Text style={s.linkedBadgeText}>App user</Text>
                          </View>
                        ) : null}
                      </View>
                      {player?.handicap != null || player?.handicapIndex != null ? (
                        <Text style={s.playerMeta}>
                          HCP {player.handicap ?? player.handicapIndex}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="plus" size={18} color={theme.accent.primary} />
                  </TouchableOpacity>
                )) : (
                  <View style={s.stateBox}>
                    <Text style={s.stateText}>All available players are already selected.</Text>
                  </View>
                )}
              </ScrollView>
            ) : (
              <ScrollView style={s.playersList} contentContainerStyle={s.playersContent}>
                <View style={s.slotGrid}>
                  {selectedPlayers.map((player) => (
                    <View key={player.id} style={s.slotFilled}>
                      <TouchableOpacity
                        style={s.slotRemove}
                        onPress={() => removePlayer(player.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${playerName(player)}`}
                      >
                        <Feather name="x" size={14} color={theme.text.muted} />
                      </TouchableOpacity>
                      <View style={s.slotAvatar}>
                        <Text style={s.slotAvatarText}>{playerInitials(player)}</Text>
                      </View>
                      <Text style={s.slotName} numberOfLines={1}>{playerName(player)}</Text>
                      {player?.handicap != null || player?.handicapIndex != null ? (
                        <Text style={s.slotHcp}>
                          HCP {player.handicap ?? player.handicapIndex}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  {Array.from({ length: emptySlots }).map((_, index) => (
                    <TouchableOpacity
                      key={`empty-${index}`}
                      style={s.slotEmpty}
                      activeOpacity={0.78}
                      onPress={() => setAddingPlayer(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Add player to quick start"
                    >
                      <View style={s.slotPlus}>
                        <Feather name="plus" size={18} color={theme.accent.primary} />
                      </View>
                      <Text style={s.slotEmptyLabel}>ADD PLAYER</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            <View style={s.actions}>
              <TouchableOpacity
                style={s.secondaryButton}
                onPress={editDetails}
                disabled={!selectedCourse}
                accessibilityRole="button"
                accessibilityLabel="Edit quick start details"
                accessibilityState={{ disabled: !selectedCourse }}
              >
                <Text style={s.secondaryText}>Edit details</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.primaryButton, startDisabled && s.primaryButtonDisabled]}
                onPress={startRound}
                disabled={startDisabled}
                accessibilityRole="button"
                accessibilityLabel="Start quick start round"
                accessibilityState={{ disabled: startDisabled }}
              >
                <Text style={s.primaryText}>{starting ? 'Starting...' : 'Start'}</Text>
              </TouchableOpacity>
            </View>
          </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  section: { marginTop: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  heading: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 1.4,
    color: t.text.muted,
  },
  manageButton: { paddingVertical: 4, paddingLeft: 12 },
  manageButtonDisabled: { opacity: 0.55 },
  manageText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.accent.primary,
  },
  manageTextDisabled: { color: t.text.muted },
  rail: { paddingRight: 20, gap: 12, paddingBottom: 2 },
  courseCard: {
    width: 168,
    minHeight: 118,
    borderRadius: 14,
    padding: 14,
    backgroundColor: t.bg.card,
    borderWidth: 1,
    borderColor: t.border.default,
    ...t.shadow.card,
  },
  courseIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent.light,
    marginBottom: 12,
  },
  courseName: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: t.text.primary,
  },
  courseMeta: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12,
    color: t.text.secondary,
    marginTop: 5,
  },
  emptyState: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.card,
    paddingHorizontal: 18,
    paddingVertical: 22,
    gap: 8,
    ...t.shadow.card,
  },
  emptyTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 15,
    color: t.text.primary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: t.text.secondary,
    textAlign: 'center',
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: t.bg.primary,
    borderTopWidth: 1,
    borderColor: t.border.default,
    paddingBottom: 28,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    backgroundColor: t.border.default,
  },
  sheetInner: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  sheetTitleWrap: { flex: 1, paddingRight: 12 },
  sheetEyebrow: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    color: t.text.muted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sheetTitle: {
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 24,
    color: t.text.primary,
  },
  sheetMeta: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    color: t.text.secondary,
    marginTop: 3,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.bg.secondary,
  },
  notice: {
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: t.accent.light,
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: t.text.secondary,
  },
  playersHeader: {
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playersLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.text.primary,
  },
  playersHeaderAction: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.accent.primary,
  },
  stateBox: {
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.card,
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  stateText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    color: t.text.secondary,
  },
  errorText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    color: t.destructive,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.accent.primary,
  },
  retryText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.text.inverse,
  },
  playersList: {
    height: 260,
    maxHeight: 260,
    marginHorizontal: 20,
    overflow: 'hidden',
  },
  playersContent: { paddingBottom: 4 },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  slotFilled: {
    position: 'relative',
    width: '48%',
    minHeight: 116,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.card,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.shadow.card,
  },
  slotRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  slotAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  slotAvatarText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: '#ffd700',
    fontSize: 15,
  },
  slotName: {
    maxWidth: '100%',
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.primary,
    fontSize: 14,
  },
  slotHcp: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: t.text.secondary,
    fontSize: 12,
    marginTop: 3,
  },
  slotEmpty: {
    width: '48%',
    minHeight: 116,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: `${t.accent.primary}40`,
    backgroundColor: t.accent.light,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  slotPlus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  slotEmptyLabel: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.accent.primary,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  addPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  addPlayerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  addPlayerInitials: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 12,
    color: t.accent.primary,
  },
  addPlayerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 6,
    backgroundColor: t.accent.light,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  linkedBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 9,
    color: t.accent.primary,
    letterSpacing: 0.3,
  },
  playerTextWrap: { flex: 1 },
  playerName: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: t.text.primary,
  },
  playerMeta: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12,
    color: t.text.secondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: t.bg.secondary,
  },
  secondaryText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: t.text.primary,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: t.accent.primary,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: t.text.inverse,
  },
});
