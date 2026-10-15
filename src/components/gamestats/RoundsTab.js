// Rounds: one round at a time — the result, the race, the scorecard and the
// holes that told the story.
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT } from '../../i18n';
import { pointsText } from '../../lib/pointsText';
import {
  scoredRoundIndices, raceSeries, roundResult, scorecardGrid, holeStories,
} from '../../store/gameStatsView';
import { pairDifferenceByHole } from '../../store/statsEngine';
import RaceChart from './RaceChart';
import ScorecardHeatmap, { HeatLegend } from './ScorecardHeatmap';
import PairDifferenceChart from './PairDifferenceChart';
import { holeSheet } from './sheets';
import { Chip, SectionTitle, firstName, joinNames, num, useStatStyles } from './ui';

function resultText(result, t) {
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

export default function RoundsTab({ tournament, pairsTournament, roundIndex, onSelectRound, onOpenSheet }) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const scored = useMemo(() => scoredRoundIndices(tournament), [tournament]);
  const ri = scored.includes(roundIndex) ? roundIndex : scored[0];
  const round = tournament.rounds[ri];

  const race = useMemo(() => (ri == null ? null : raceSeries(tournament, ri)), [tournament, ri]);
  const result = useMemo(() => (ri == null ? null : roundResult(tournament, ri)), [tournament, ri]);
  const stories = useMemo(() => (ri == null ? null : holeStories(tournament, ri)), [tournament, ri]);
  const pairDiff = useMemo(
    () => (ri == null || !pairsTournament ? null : pairDifferenceByHole(pairsTournament, ri, { metric: 'points' })),
    [pairsTournament, ri],
  );
  const grid = useMemo(
    () => (race ? scorecardGrid(tournament, ri, race.series.map((x) => x.player.id)) : null),
    [tournament, ri, race],
  );

  if (ri == null) return <Text style={s.empty}>{t('stats.game.empty.body')}</Text>;

  const storyRows = [
    stories.easiest && { key: 'easy', label: t('stats.game.story.easiest'), color: theme.scoreColor('excellent'), hole: stories.easiest, value: t('stats.game.story.avg', { n: num(stories.easiest.avgPoints, { decimals: 2 }) }) },
    stories.hardest && stories.hardest !== stories.easiest && { key: 'hard', label: t('stats.game.story.hardest'), color: theme.destructive, hole: stories.hardest, value: t('stats.game.story.avg', { n: num(stories.hardest.avgPoints, { decimals: 2 }) }) },
    stories.chaos && { key: 'chaos', label: t('stats.game.story.chaos'), color: theme.info, hole: stories.chaos, value: t('stats.game.story.range', { min: stories.chaos.minStrokes, max: stories.chaos.maxStrokes }) },
    ...stories.cruised.map((h) => ({ key: `c${h.holeNumber}`, label: t('stats.game.story.cruised'), color: theme.scoreColor('excellent'), hole: h, value: t('stats.game.story.cruisedValue') })),
    ...stories.wrecked.map((h) => ({ key: `w${h.holeNumber}`, label: t('stats.game.story.wrecked'), color: theme.destructive, hole: h, value: t('stats.game.story.wreckedValue') })),
  ].filter(Boolean);

  return (
    <View>
      {scored.length > 1 && (
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

      <View style={s.card}>
        <SectionTitle>{t('stats.game.round.header', { n: ri + 1, course: round.courseName ?? '' })}</SectionTitle>
        {result && <Text style={[s.strong, { fontSize: 15, marginBottom: 8 }]}>{resultText(result, t)}</Text>}
        {race.series.length > 0 && <RaceChart data={race} />}
        <Text style={s.sub}>{t('stats.game.race.caption')}</Text>
      </View>

      {pairDiff && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.pairDiff.title')}</SectionTitle>
          <PairDifferenceChart data={pairDiff} />
        </View>
      )}

      {grid && race.series.length > 0 && (
        <View style={s.card}>
          <SectionTitle right={t('stats.game.card.hint')}>{t('stats.game.card.title')}</SectionTitle>
          <ScorecardHeatmap grid={grid} players={race.series.map((x) => x.player)} />
          <HeatLegend />
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
              onPress={() => onOpenSheet(holeSheet(row.hole, row.label, null))}
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
