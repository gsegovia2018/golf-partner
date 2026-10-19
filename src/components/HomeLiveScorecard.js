import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useT } from '../i18n';
import { useCourseGeometry } from '../hooks/useCourseGeometry';
import { useShotPlayConditions } from '../hooks/usePlayConditions';
import { holeFeatures, haversineMeters } from '../lib/geo';
import { liveScorecard, liveCardKind } from '../store/liveScorecard';
import ShotScorecard from './scorecard/ShotScorecard';
import { shortName } from './gamestats/ui';

// Home's Live card, built on the read-only scorecard (ShotScorecard +
// scorecardModel): a group round gets the points card (the nine being played,
// place and running total per row, the gap to the leader), a solo round my
// whole card. Both ring the current hole, show the next hole in one line and
// open the scorecard from the button or a tap anywhere on the card.
export default function LiveScorecard(props) {
  return liveCardKind(props.entry) === 'solo' ? <LiveCardSolo {...props} /> : <LiveCardGroup {...props} />;
}

// Tee-to-green metres for a mapped hole, and the plays-like length.
function useNextHole(courseName, number) {
  useCourseGeometry(courseName);
  const cond = useShotPlayConditions(courseName, number, null);
  const f = number ? holeFeatures(courseName, number) : null;
  const meters = f?.start && f?.greenCenter ? Math.round(haversineMeters(f.start, f.greenCenter)) : null;
  const plays = meters != null && cond.enabled ? Math.round(cond.plays(meters)) : null;
  return { meters, plays: plays != null && plays !== meters ? plays : null };
}

function NextHole({ next, courseName, s, t }) {
  const hole = useNextHole(courseName, next?.number);
  if (!next) return null;
  const bits = [t('map.parSi', { par: next.par ?? '–', si: next.strokeIndex ?? '–' })];
  if (hole.meters != null) bits.push(`${hole.meters} m`);
  if (hole.plays != null) bits.push(t('home.live.plays', { m: hole.plays }));
  return (
    <View style={s.next} testID="live-next-hole">
      <Text style={s.nextHole}>{t('home.live.nextHole', { n: next.number })}</Text>
      <Text style={s.nextMeta} numberOfLines={1}>{bits.join(' · ')}</Text>
    </View>
  );
}

// The card shell every variant shares: live header, the body, the next hole,
// a big button; tapping anywhere on the card opens the scorecard too.
function Shell({ model, data, onOpen, children, testID, s, t, right }) {
  return (
    <Pressable style={s.card} onPress={onOpen} accessibilityHint={t('home.phase.live.open')} testID={testID}>
      <View style={s.head}>
        <View style={s.liveMark}><View style={s.liveDot} /><Text style={s.liveText}>{t('shared.live').toUpperCase()}</Text></View>
        <Text style={s.course} numberOfLines={1}>{model.courseName}</Text>
        {right}
      </View>
      {children}
      <NextHole next={data.next} courseName={model.courseName} s={s} t={t} />
      <TouchableOpacity style={s.cta} onPress={onOpen} accessibilityRole="button" activeOpacity={0.85}>
        <Feather name="clipboard" size={18} color={s.ctaText.color} />
        <Text style={s.ctaText}>{t('home.phase.live.open')}</Text>
      </TouchableOpacity>
    </Pressable>
  );
}

function useData(entry, userId) {
  return useMemo(() => liveScorecard(entry, userId), [entry, userId]);
}

// shortName for everyone else, "You" for my row (it is highlighted anyway).
function useNames(entry, t) {
  return useMemo(() => {
    const players = entry.tournament.players ?? [];
    return (row) => (row.isMe ? t('home.phase.you') : shortName(row.player, players));
  }, [entry, t]);
}

function gapLine(t, gap, nameOf) {
  if (!gap) return null;
  if (gap.kind === 'lead') return t('home.live.youLead', { gap: gap.gap });
  if (gap.kind === 'level') return t('home.live.levelWith', { name: nameOf(gap.playerId) });
  return t('home.live.behind', { gap: gap.gap, name: nameOf(gap.playerId) });
}

// Group round: the nine being played in Stableford points, with place and
// running total in the row header and one line on the gap to the leader.
function LiveCardGroup({ entry, model, userId, onOpen }) {
  const { s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  const nameOf = useNames(entry, t);
  const byId = useMemo(() => Object.fromEntries(data.standings.map((x) => [x.id, x])), [data]);
  const label = (row) => {
    const st = byId[row.id];
    // Place and points first, so a long name is what gets cut.
    return st ? `${st.place} · ${st.points} ${nameOf(row)}` : nameOf(row);
  };
  const rowOf = (id) => data.card.rows.find((r) => r.id === id);
  const line = gapLine(t, data.gap, (id) => (rowOf(id) ? nameOf(rowOf(id)) : '?'));
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-group"
      right={<Text style={s.thru}>{t('home.phase.live.thru', { count: model.thru })}</Text>}
    >
      <ShotScorecard card={data.nineCard} mode="points" currentHole={data.next?.number ?? null} labelOf={label} labelWidth={92} />
      {line ? <Text style={s.gap} testID="live-gap">{line}</Text> : null}
    </Shell>
  );
}

// Solo round: my whole card (both nines, strokes, points, handicap dots, putts).
function LiveCardSolo({ entry, model, userId, onOpen }) {
  const { s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-solo"
      right={<Text style={s.thru}>{t('home.live.ptsThru', { points: model.myPoints ?? 0, count: model.thru })}</Text>}
    >
      {data.myCard ? <ShotScorecard card={data.myCard} mode="strokes" currentHole={data.next?.number ?? null} pointsRow /> : null}
    </Shell>
  );
}

function useLiveStyles() {
  const { theme } = useTheme();
  return { theme, s: useMemo(() => makeStyles(theme), [theme]) };
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
    padding: 14, marginBottom: 16, gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.destructive },
  liveText: { color: theme.destructive, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  course: { flex: 1, minWidth: 0, color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  thru: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.bg.secondary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  nextHole: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  nextMeta: { flex: 1, color: theme.text.secondary, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52,
    backgroundColor: theme.accent.primary, borderRadius: 14,
  },
  ctaText: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15 },
  gap: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
});
