import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { onDeep } from '../theme/tokens';
import { useT, formatNumber } from '../i18n';
import { useCourseGeometry } from '../hooks/useCourseGeometry';
import { useShotPlayConditions } from '../hooks/usePlayConditions';
import { holeFeatures, haversineMeters } from '../lib/geo';
import { liveScorecard, liveCardKind } from '../store/liveScorecard';
import ShotScorecard from './scorecard/ShotScorecard';
import { shortName } from './gamestats/ui';

// Home's Live card on the deep-green hero, built on the read-only scorecard
// (ShotScorecard tone="deep"): a two-pair game shows each pair's points per
// hole (the scorecard's match-panel numbers) over its players' Stableford
// points, any other group game a row per player by place, a solo round my
// whole card with putts, tee shots and greens. All ring the current hole,
// show the next hole in one line and open the scorecard from the button or
// a tap anywhere on the card.
const CREAM = '#f3efe6';
export const PAIR_COLORS = ['#4fae8a', onDeep.bronze];

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
function Shell({ model, data, onOpen, children, testID, s, t }) {
  return (
    <Pressable style={s.card} onPress={onOpen} accessibilityHint={t('home.phase.live.open')} testID={testID}>
      <View style={s.head}>
        <View style={s.liveDot} />
        <Text style={s.liveText}>{t('shared.live').toUpperCase()}</Text>
        <Text style={s.course} numberOfLines={1}>{model.courseName}</Text>
        <Text style={s.thru}>{t('home.phase.live.thru', { count: model.thru })}</Text>
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

// shortName for everyone else, "You" for me.
function useNames(entry, t) {
  return useMemo(() => {
    const players = entry.tournament.players ?? [];
    const byId = new Map(players.map((p) => [p.id, p]));
    const one = (id, meId) => (id === meId ? t('home.phase.you') : shortName(byId.get(id) ?? { name: '?' }, players));
    return {
      row: (row) => (row.isMe ? t('home.phase.you') : shortName(row.player, players)),
      pair: (ids, meId) => {
        const names = ids.map((id) => one(id, meId));
        // "You & Javier": me first.
        const mine = ids.indexOf(meId);
        if (mine > 0) names.unshift(names.splice(mine, 1)[0]);
        return names.join(' & ');
      },
    };
  }, [entry, t]);
}

function gapLine(t, gap, nameOf) {
  if (!gap) return null;
  if (gap.kind === 'lead') return t('home.live.youLead', { gap: formatNumber(gap.gap) });
  if (gap.kind === 'level') return t('home.live.levelWith', { name: nameOf(gap.playerId) });
  return t('home.live.behind', { gap: formatNumber(gap.gap), name: nameOf(gap.playerId) });
}

// The pair line: who leads and by how much, or level, and the holes to play.
export function pairLine(t, pairs, pairName) {
  const toPlay = t('home.live.toPlay', { count: pairs.holesLeft });
  if (pairs.leader == null) return `${t('home.live.pairLevel')} · ${toPlay}`;
  const leader = pairs.sides.find((sd) => sd.side === pairs.leader);
  return `${t('home.live.pairLead', { name: pairName(leader), lead: formatNumber(pairs.lead) })} · ${toPlay}`;
}

// Group round: the nine being played in Stableford points. Two pairs: a
// header row per pair over its players, my pair first. Otherwise a row per
// player by place.
function LiveCardGroup({ entry, model, userId, onOpen }) {
  const { s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  const names = useNames(entry, t);
  const meId = data.card.rows.find((r) => r.isMe)?.id ?? null;
  const pairName = (sd) => names.pair(sd.ids, meId);
  const groups = useMemo(() => {
    if (!data.pairs) return null;
    const nine = data.nineCard.nines[0];
    return data.pairs.sides.map((sd) => ({
      key: `pair-${sd.side}`,
      label: names.pair(sd.ids, meId),
      color: PAIR_COLORS[sd.side],
      holes: sd.holes,
      ids: sd.ids,
      nineTotals: { [nine.key]: nine.holes.reduce((sum, h) => sum + (sd.holes[h.number] ?? 0), 0) },
    }));
  }, [data, names, meId]);
  const byId = useMemo(() => Object.fromEntries(data.standings.map((x) => [x.id, x])), [data]);
  const label = groups
    ? names.row
    : (row) => (byId[row.id] ? `${byId[row.id].place}  ${names.row(row)}` : names.row(row));
  const rowOf = (id) => data.card.rows.find((r) => r.id === id);
  const line = data.pairs
    ? pairLine(t, data.pairs, pairName)
    : gapLine(t, data.gap, (id) => (rowOf(id) ? names.row(rowOf(id)) : '?'));
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-group">
      <ShotScorecard
        card={data.nineCard}
        mode="points"
        tone="deep"
        currentHole={data.next?.number ?? null}
        labelOf={label}
        labelWidth={92}
        groups={groups}
      />
      {line ? <Text style={s.gap} testID="live-gap">{line}</Text> : null}
    </Shell>
  );
}

// Solo round: my points big, then my whole card (strokes, points, putts, tee
// shots, greens) with the handicap dots.
function LiveCardSolo({ entry, model, userId, onOpen }) {
  const { s } = useLiveStyles();
  const t = useT();
  const data = useData(entry, userId);
  const total = data.myCard?.rows[0]?.total ?? null;
  return (
    <Shell model={model} data={data} onOpen={onOpen} s={s} t={t} testID="home-live-solo">
      {total ? <SoloTotals total={total} s={s} t={t} /> : null}
      {data.myCard ? <ShotScorecard card={data.myCard} mode="strokes" tone="deep" summary={false} currentHole={data.next?.number ?? null} pointsRow /> : null}
    </Shell>
  );
}

// "15 pts" big, with "Level par" and "28 strokes · 12 putts" beside it
// (`putts={false}` leaves putts to the After card's tiles).
export function SoloTotals({ total, putts = true, s, t }) {
  const toPar = total.toPar == null ? null
    : total.toPar === 0 ? t('home.live.levelPar')
      : t(total.toPar > 0 ? 'home.live.overPar' : 'home.live.underPar', { count: Math.abs(total.toPar) });
  const counts = [
    total.strokes != null ? t('stats.game.ledger.strokesN', { count: total.strokes }) : null,
    putts && total.putts != null ? t('stats.game.ledger.puttsN', { count: total.putts }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={s.soloTop} testID="live-solo-totals">
      <Text style={s.bigNum}>
        {formatNumber(total.points ?? 0)}
        <Text style={s.unit}> {t('home.live.pts')}</Text>
      </Text>
      <View style={s.soloSide}>
        {toPar ? <Text style={s.soloSideText}>{toPar}</Text> : null}
        {counts ? <Text style={s.soloSideText}>{counts}</Text> : null}
      </View>
    </View>
  );
}

export function useLiveStyles() {
  const { theme } = useTheme();
  return { theme, s: useMemo(() => makeStyles(theme), [theme]) };
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.deep, borderRadius: 14, paddingTop: 15, paddingBottom: 14, paddingHorizontal: 14,
    marginBottom: 16, gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff9b9b' },
  liveText: { color: '#ff9b9b', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, letterSpacing: 1.4 },
  course: { flex: 1, minWidth: 0, color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  thru: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: onDeep.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  nextHole: { color: CREAM, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  nextMeta: { flex: 1, color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50,
    backgroundColor: CREAM, borderRadius: 12,
  },
  ctaText: { color: theme.bg.deep, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, textAlign: 'center' },
  gap: { color: CREAM, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15 },
  soloTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  bigNum: { color: CREAM, fontFamily: 'PlayfairDisplay-Black', fontSize: 44, lineHeight: 50 },
  unit: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  soloSide: { paddingBottom: 8, gap: 1 },
  soloSideText: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
});
