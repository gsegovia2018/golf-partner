// Rounds: one round at a time — the result, the race, the scorecard (with
// shots, on the shared Strokes | Points switch) and the holes that told the story. In a one-round game (`single`) this is the
// Scorecard tab: no round chips and no result card (Summary carries the
// race and its lead / comeback lines).
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import { pointsText } from '../../lib/pointsText';
import {
  scoredRoundIndices, raceSeries, roundResult, roundCard, holeStories, leadStory, roundComeback,
} from '../../store/gameStatsView';
import { pairDifferenceByHole } from '../../store/statsEngine';
import RaceChart from './RaceChart';
import ShotScorecard from '../scorecard/ShotScorecard';
import Reveal from '../ui/Reveal';
import { duration } from '../../theme/motion';
import PairDifferenceChart from './PairDifferenceChart';
import { holeSheet } from './sheets';
import { Chip, ModeToggle, SectionTitle, firstName, joinNames, num, useStatStyles } from './ui';

// The one-line result of a round; Rivals reuses it for match play rounds.
export function resultText(result, t) {
  if (!result) return null;
  if (result.kind === 'teams') {
    const [a, b] = result.sides;
    const an = joinNames(a.members);
    const bn = joinNames(b.members);
    return a.points === b.points
      ? t('stats.game.round.teamsLevel', { a: an, b: bn, value: pointsText(a.points, result.unit) })
      : t('stats.game.round.teamsWin', { a: an, b: bn, x: num(a.points), y: num(b.points) });
  }
  const [w, r] = result.entries;
  if (!w) return null;
  if (!r) return t('stats.game.round.solo', { name: firstName(w.player), value: pointsText(w.points, result.unit) });
  const tied = result.entries.filter((e) => e.points === w.points);
  if (tied.length > 1) {
    return t('stats.game.round.tie', { names: joinNames(tied.map((e) => e.player)), value: pointsText(w.points, result.unit) });
  }
  return t('stats.game.round.win', {
    name: firstName(w.player), value: pointsText(w.points, result.unit),
    next: firstName(r.player), nextValue: pointsText(r.points, result.unit),
  });
}

// The comeback and lead-change lines under a round's result.
export function LeadLines({ lead, comeback }) {
  const t = useT();
  const { s } = useStatStyles();
  const leaders = lead?.leaders?.length
    ? lead.leaders.filter((l) => l.led === lead.leaders[0].led).flatMap((l) => l.players)
    : [];
  return (
    <>
      {comeback && (
        <Text style={[s.sub, { marginBottom: 4 }]} testID="round-comeback">
          {t(comeback.team || comeback.players.length > 1 ? 'stats.game.round.comebackTeam' : 'stats.game.round.comeback', { name: joinNames(comeback.players), count: comeback.deficit, hole: comeback.afterHole })}
        </Text>
      )}
      {leaders.length > 0 && (
        <Text style={[s.sub, { marginBottom: 8 }]} testID="round-lead">
          {[
            // A pair, or players tied on holes led, take the plural verb.
            t(leaders.length > 1 ? 'stats.game.round.leadLedMany' : 'stats.game.round.leadLed', { names: joinNames(leaders), led: lead.leaders[0].led, count: lead.total }),
            lead.changes > 0 ? t('stats.game.round.leadChanges', { count: lead.changes }) : t('stats.game.round.leadNone'),
          ].join(' · ')}
        </Text>
      )}
    </>
  );
}

export default function RoundsTab({
  tournament, pairsTournament, roundIndex, onSelectRound, onOpenSheet, single = false, meId = null, mode = 'strokes', onModeChange,
}) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const scored = useMemo(() => scoredRoundIndices(tournament), [tournament]);
  const ri = scored.includes(roundIndex) ? roundIndex : scored[0];
  const round = tournament.rounds[ri];

  const race = useMemo(() => (ri == null ? null : raceSeries(tournament, ri)), [tournament, ri]);
  const result = useMemo(() => (ri == null ? null : roundResult(tournament, ri)), [tournament, ri]);
  const lead = useMemo(() => (ri == null ? null : leadStory(tournament, ri)), [tournament, ri]);
  const comeback = useMemo(() => (ri == null ? null : roundComeback(tournament, ri)), [tournament, ri]);
  const stories = useMemo(() => (ri == null ? null : holeStories(tournament, ri)), [tournament, ri]);
  const pairDiff = useMemo(
    () => (ri == null || !pairsTournament ? null : pairDifferenceByHole(pairsTournament, ri, { metric: 'points' })),
    [pairsTournament, ri],
  );
  const card = useMemo(
    () => (race ? roundCard(tournament, ri, race.series.map((x) => x.player.id), meId) : null),
    [tournament, ri, race, meId],
  );

  if (ri == null) return <Text style={s.empty}>{t('stats.game.empty.body')}</Text>;

  // One round: the average is over the players, so say so.
  const avgKey = single ? 'stats.game.story.perPlayer' : 'stats.game.story.avg';
  const storyRows = [
    stories.easiest && { key: 'easy', label: t('stats.game.story.easiest'), color: theme.scoreColor('excellent'), hole: stories.easiest, value: t(avgKey, { n: num(stories.easiest.avgPoints, { decimals: 2 }) }) },
    stories.hardest && stories.hardest !== stories.easiest && { key: 'hard', label: t('stats.game.story.hardest'), color: theme.destructive, hole: stories.hardest, value: t(avgKey, { n: num(stories.hardest.avgPoints, { decimals: 2 }) }) },
    stories.chaos && { key: 'chaos', label: t('stats.game.story.chaos'), color: theme.info, hole: stories.chaos, value: t('stats.game.story.range', { min: stories.chaos.minStrokes, max: stories.chaos.maxStrokes }) },
    ...stories.cruised.map((h) => ({ key: `c${h.holeNumber}`, label: t('stats.game.story.cruised'), color: theme.scoreColor('excellent'), hole: h, value: t('stats.game.story.cruisedValue') })),
    ...stories.wrecked.map((h) => ({ key: `w${h.holeNumber}`, label: t('stats.game.story.wrecked'), color: theme.destructive, hole: h, value: t('stats.game.story.wreckedValue') })),
  ].filter(Boolean);

  return (
    <View>
      {!single && scored.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {scored.map((i) => (
            <Chip
              key={i}
              testID={`round-chip-${i}`}
              active={i === ri}
              label={i === ri
                ? t('stats.game.round.chipActive', { n: i + 1, course: tournament.rounds[i].courseName ?? '' })
                : t('stats.screen.roundShort', { n: i + 1 })}
              onPress={() => onSelectRound(i)}
            />
          ))}
        </ScrollView>
      )}

      {!single && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.round.header', { n: ri + 1, course: round.courseName ?? '' })}</SectionTitle>
          {result && <Text style={[s.strong, { fontSize: 15, marginBottom: 8 }]}>{resultText(result, t)}</Text>}
          <LeadLines lead={lead} comeback={comeback} />
          {race.series.length > 0 && <RaceChart data={race} />}
          <Text style={s.sub}>{t('stats.game.race.caption')}</Text>
        </View>
      )}

      {pairDiff && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.pairDiff.title')}</SectionTitle>
          <PairDifferenceChart data={pairDiff} />
        </View>
      )}

      {card && (
        <View style={[s.card, { paddingHorizontal: 10 }]}>
          <View style={{ paddingHorizontal: 4 }}>
            <SectionTitle right={<ModeToggle value={mode} onChange={onModeChange} testID="card-mode" />}>{t('stats.game.card.title')}</SectionTitle>
          </View>
          {/* Keyed by round: each round opens with my shots expanded again. */}
          <Reveal replay={mode} dy={4} duration={duration.state}>
            <ShotScorecard key={ri} card={card} mode={mode} />
          </Reveal>
        </View>
      )}

      {storyRows.length > 0 && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.story.title')}</SectionTitle>
          {storyRows.map((row, i) => (
            <TouchableOpacity
              key={row.key}
              style={[s.row, i === 0 && s.rowFirst]}
              activeOpacity={0.7}
              accessibilityRole="button"
              onPress={() => onOpenSheet(holeSheet(row.hole, row.label, null, { single }))}
            >
              <View style={s.grow}>
                <Text style={[s.sectionTitle, { color: row.color }]}>{row.label}</Text>
                <Text style={s.strong}>
                  {t('stats.game.story.hole', { n: row.hole.holeNumber, par: row.hole.par, si: row.hole.si })}
                </Text>
              </View>
              <Text style={s.sub}>{row.value}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
