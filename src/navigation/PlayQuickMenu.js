import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { interpolate, Extrapolation, useAnimatedStyle } from 'react-native-reanimated';
import { useT } from '../i18n';
import { onDeep } from '../theme/tokens';

const PAD = 16;
const GAP = 8;
const HEADER = 44;
const RESUME = 66;
const NEW_GAME = 58;
const QS_LABEL = 16;
const QS_CHIPS = 40;
const OPEN_PLAY = 44;

// Height of the open menu for what it shows, so the Play disc can grow
// into exactly that card.
export function playMenuHeight({ hasLive, hasQuickStart }) {
  const rows = [HEADER, hasLive ? RESUME : null, NEW_GAME, hasQuickStart ? QS_LABEL : null, hasQuickStart ? QS_CHIPS : null, OPEN_PLAY]
    .filter((h) => h != null);
  return PAD * 2 + rows.reduce((a, h) => a + h, 0) + GAP * (rows.length - 1);
}

// Play's hold menu: the shortcuts Home offers, from any tab. Rows fade up
// one after another as the disc opens (`open` 0 → 1).
// Laid out at its open size and pinned to the card's bottom-left, so the
// growing card reveals it instead of reflowing it.
export default function PlayQuickMenu({ open, width, height, live, quickStart, theme, onClose, onResume, onNewGame, onQuickStart, onOpenPlay }) {
  const t = useT();
  const s = makeStyles(theme);
  let i = 0;
  return (
    <View style={[s.body, { width, height }]} accessibilityViewIsModal>
      <Row open={open} index={i++} style={s.header}>
        <Text style={s.title} accessibilityRole="header">{t('nav.tab.play')}</Text>
        <Pressable style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('nav.menu.close')} hitSlop={4}>
          <Feather name="x" size={18} color={theme.text.secondary} />
        </Pressable>
      </Row>
      {live ? (
        <Row open={open} index={i++}>
          <Pressable style={s.resume} onPress={onResume} accessibilityRole="button" accessibilityLabel={t('nav.live.resume', { course: live.courseName })} testID="play-menu-resume">
            <View style={s.flex}>
              <View style={s.liveLine}>
                <View style={[s.liveDot, { backgroundColor: theme.semantic.destructive.dark }]} />
                <Text style={s.liveKicker} numberOfLines={1}>
                  {[t('shared.live'), live.hole != null ? t('nav.live.hole', { n: live.hole }).toUpperCase() : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={s.resumeCourse} numberOfLines={1}>{live.courseName}</Text>
            </View>
            {live.points != null ? (
              <Text style={s.resumePoints}>{live.points}<Text style={s.resumePts}> {t('home.live.pts')}</Text></Text>
            ) : null}
            <Feather name="chevron-right" size={20} color={onDeep.soft} />
          </Pressable>
        </Row>
      ) : null}
      <Row open={open} index={i++}>
        <Pressable style={s.newGame} onPress={onNewGame} accessibilityRole="button" testID="play-menu-new-game">
          <View style={s.plus}>
            <Feather name="plus" size={18} color={theme.text.inverse} />
          </View>
          <View style={s.flex}>
            <Text style={s.newGameTitle}>{t('home.list.newGame')}</Text>
            <Text style={s.newGameHint} numberOfLines={1}>{t('nav.menu.newGameHint')}</Text>
          </View>
        </Pressable>
      </Row>
      {quickStart.length > 0 ? (
        <>
          <Row open={open} index={i++}>
            <Text style={s.overline}>{t('setup.quickStart.heading')}</Text>
          </Row>
          <Row open={open} index={i++} style={s.chips}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRail}>
              {quickStart.map((c) => (
                <Pressable key={c.id} style={s.chip} onPress={() => onQuickStart(c)} accessibilityRole="button">
                  <Text style={s.chipText} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Row>
        </>
      ) : null}
      <Row open={open} index={i++}>
        <Pressable style={s.openPlay} onPress={onOpenPlay} accessibilityRole="button">
          <Text style={s.openPlayText}>{t('nav.menu.openPlay')}</Text>
          <Feather name="chevron-right" size={16} color={theme.accent.primary} />
        </Pressable>
      </Row>
    </View>
  );
}

function Row({ open, index, style, children }) {
  const a = useAnimatedStyle(() => {
    const from = 0.45 + index * 0.06;
    const v = interpolate(open.value, [from, from + 0.4], [0, 1], Extrapolation.CLAMP);
    return { opacity: v, transform: [{ translateY: (1 - v) * 10 }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

function makeStyles(theme) {
  const label = { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 20 };
  return StyleSheet.create({
    body: { position: 'absolute', left: 0, bottom: 0, padding: PAD, gap: GAP },
    flex: { flex: 1, minWidth: 0 },
    header: { height: HEADER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 4 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    close: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : theme.bg.secondary,
    },
    resume: {
      height: RESUME, borderRadius: 18, backgroundColor: theme.bg.deep,
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 12,
    },
    liveLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 7, height: 7, borderRadius: 4 },
    liveKicker: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, lineHeight: 13, letterSpacing: 0.6, color: onDeep.soft },
    resumeCourse: { ...label, color: onDeep.primary },
    resumePoints: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 16, color: onDeep.primary },
    resumePts: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: onDeep.soft },
    newGame: {
      height: NEW_GAME, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : theme.bg.secondary,
    },
    plus: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.accent.primary, alignItems: 'center', justifyContent: 'center' },
    newGameTitle: { ...label, color: theme.text.primary },
    newGameHint: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 16, color: theme.text.secondary },
    overline: {
      height: QS_LABEL, paddingLeft: 4, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, lineHeight: 14,
      letterSpacing: 1.5, color: theme.text.secondary,
    },
    chips: { height: QS_CHIPS, marginHorizontal: -PAD },
    chipRail: { gap: 8, paddingHorizontal: PAD },
    chip: {
      maxWidth: 220, height: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.accent.primary },
    openPlay: { height: OPEN_PLAY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    openPlayText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.accent.primary },
  });
}
