import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { light, semantic, typography, spacing, radius } from '../theme/tokens';

const DEFAULT_THEME = {
  ...light,
  typography,
  spacing,
  radius,
  destructive: semantic.destructive.light,
  isDark: false,
};

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

export default function QuickStartCourses({
  courses = [],
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
  const signedInUserId = currentUserId || userId;

  const selectedPlayers = useMemo(
    () => (players || []).filter((player) => selectedPlayerIds.includes(player.id)),
    [players, selectedPlayerIds],
  );

  if (!courses.length) return null;

  const openCourse = (course) => {
    setSelectedCourse(course);
    setSelectedPlayerIds(initialQuickStartPlayerIds(players, signedInUserId));
  };

  const closeSheet = () => setSelectedCourse(null);

  const togglePlayer = (playerId) => {
    setSelectedPlayerIds((prev) => (
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    ));
  };

  const startDisabled = selectedPlayers.length === 0 || starting;

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.heading}>QUICK START</Text>
        <TouchableOpacity
          onPress={onManage}
          style={s.manageButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
        >
          <Text style={s.manageText}>Manage</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.rail}
      >
        {courses.map((course) => {
          const meta = quickStartCourseMeta(course);
          return (
            <TouchableOpacity
              key={course.id || courseTitle(course)}
              style={s.courseCard}
              activeOpacity={0.78}
              onPress={() => openCourse(course)}
              accessibilityRole="button"
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

      <Modal
        visible={!!selectedCourse}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <TouchableWithoutFeedback onPress={closeSheet}>
          <View style={s.backdrop} />
        </TouchableWithoutFeedback>
        <View style={s.sheet}>
          <View style={s.handle} />
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

          <Text style={s.playersLabel}>Players</Text>
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
              <TouchableOpacity style={s.retryButton} onPress={onRetryPlayers}>
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={s.playersList} contentContainerStyle={s.playersContent}>
              {(players || []).map((player) => {
                const selected = selectedPlayerIds.includes(player.id);
                return (
                  <TouchableOpacity
                    key={player.id}
                    style={[s.playerCard, selected && s.playerCardSelected]}
                    activeOpacity={0.75}
                    onPress={() => togglePlayer(player.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={[s.checkCircle, selected && s.checkCircleSelected]}>
                      {selected ? <Feather name="check" size={14} color={theme.text.inverse} /> : null}
                    </View>
                    <View style={s.playerTextWrap}>
                      <Text style={s.playerName}>{playerName(player)}</Text>
                      {player?.handicap != null || player?.handicapIndex != null ? (
                        <Text style={s.playerMeta}>
                          HCP {player.handicap ?? player.handicapIndex}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={s.actions}>
            <TouchableOpacity
              style={s.secondaryButton}
              onPress={() => onEditDetails?.({ course: selectedCourse, players: selectedPlayers })}
              disabled={!selectedCourse}
            >
              <Text style={s.secondaryText}>Edit details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.primaryButton, startDisabled && s.primaryButtonDisabled]}
              onPress={() => !startDisabled && onStart?.({ course: selectedCourse, players: selectedPlayers })}
              disabled={startDisabled}
            >
              <Text style={s.primaryText}>{starting ? 'Starting...' : 'Start'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  section: { marginTop: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  heading: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 11,
    letterSpacing: 1.4,
    color: t.text.muted,
  },
  manageButton: { paddingVertical: 4, paddingLeft: 12 },
  manageText: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.accent.primary,
  },
  rail: { paddingHorizontal: 20, gap: 12, paddingBottom: 2 },
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
  playersLabel: {
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 8,
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 13,
    color: t.text.primary,
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
  playersList: { maxHeight: 260, marginHorizontal: 20 },
  playersContent: { gap: 8, paddingBottom: 4 },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.default,
    backgroundColor: t.bg.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  playerCardSelected: {
    borderColor: t.accent.primary,
    backgroundColor: t.accent.light,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: t.bg.primary,
  },
  checkCircleSelected: {
    borderColor: t.accent.primary,
    backgroundColor: t.accent.primary,
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
