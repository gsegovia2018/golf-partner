import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useT, formatOrdinal } from '../i18n';
import { useCourseGeometry } from '../hooks/useCourseGeometry';
import { useShotPlayConditions } from '../hooks/usePlayConditions';
import { holeFeatures, haversineMeters } from '../lib/geo';
import { liveScorecard } from '../store/liveScorecard';
import ShotScorecard from './scorecard/ShotScorecard';
import { ModeToggle, shortName } from './gamestats/ui';

// Design-step variants of the Live hero, all built on the read-only
// scorecard (ShotScorecard + scorecardModel), picked with a dev-only switch
// on Home: A the group card on the current nine, B the same grid in points
// with places, C my full card plus the group's totals. Production keeps
// HomePhase's LiveHero until one is chosen.

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

// A — the group card on the nine being played, strokes or points.
export function LiveCardA({ entry, model, userId, onOpen }) {
  const { s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  const nameOf = useNames(entry, t);
  const [mode, setMode] = useState('strokes');
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-a"
      right={<ModeToggle value={mode} onChange={setMode} testID="live-a-mode" />}
    >
      <ShotScorecard card={data.nineCard} mode={mode} currentHole={data.next?.number ?? null} grandTotal labelOf={nameOf} labelWidth={62} />
    </Shell>
  );
}

// B — the same grid in Stableford points, with place and running total in
// the row header and one line on the gap to the leader.
export function LiveCardB({ entry, model, userId, onOpen }) {
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
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-b"
      right={<Text style={s.thru}>{t('home.phase.live.thru', { count: model.thru })}</Text>}
    >
      <ShotScorecard card={data.nineCard} mode="points" currentHole={data.next?.number ?? null} labelOf={label} labelWidth={92} />
      {line ? <Text style={s.gap} testID="live-gap">{line}</Text> : null}
    </Shell>
  );
}

// C — my whole card (both nines, strokes, points, handicap dots, putts) and
// the group as a totals strip.
export function LiveCardC({ entry, model, userId, onOpen }) {
  const { theme, s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  const nameOf = useNames(entry, t);
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-c"
      right={<Text style={s.thru}>{t('home.live.ptsThru', { points: model.myPoints ?? 0, count: model.thru })}</Text>}
    >
      {data.myCard ? <ShotScorecard card={data.myCard} mode="strokes" currentHole={data.next?.number ?? null} pointsRow /> : null}
      {data.standings.length > 1 ? (
        <View style={s.strip} accessibilityRole="list">
          {data.standings.map((x) => {
            const row = data.card.rows.find((r) => r.id === x.id);
            return (
              <View key={x.id} style={[s.chip, x.me && { backgroundColor: theme.accent.primary }]}>
                <Text style={[s.chipPlace, x.me && s.chipOn]}>{formatOrdinal(x.place)}</Text>
                <Text style={[s.chipName, x.me && s.chipOn]} numberOfLines={1}>{x.me ? t('home.phase.you') : (row ? nameOf(row) : x.label)}</Text>
                <Text style={[s.chipPts, x.me && s.chipOn]}>{x.points}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Shell>
  );
}

// Dev-only: which Live hero Home shows while the design is being picked.
export const LIVE_VARIANTS = ['current', 'A', 'B', 'C'];
export function LiveVariantSwitch({ value, onChange }) {
  const { theme, s } = useLiveStyles();
  return (
    <View style={s.switch}>
      {LIVE_VARIANTS.map((k) => (
        <TouchableOpacity key={k} onPress={() => onChange(k)} style={[s.switchBtn, value === k && { backgroundColor: theme.accent.primary }]} accessibilityRole="button" testID={`live-variant-${k}`}>
          <Text style={[s.switchText, value === k && { color: theme.text.inverse }]}>{k}</Text>
        </TouchableOpacity>
      ))}
    </View>
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
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.bg.secondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  chipPlace: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
  chipName: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, flexShrink: 1 },
  chipPts: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, fontVariant: ['tabular-nums'] },
  chipOn: { color: theme.text.inverse },
  switch: { flexDirection: 'row', gap: 6, marginBottom: 8, alignSelf: 'flex-start', flexWrap: 'wrap' },
  switchBtn: { minWidth: 44, minHeight: 32, borderRadius: 999, borderWidth: 1, borderColor: theme.border.default, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  switchText: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
});
