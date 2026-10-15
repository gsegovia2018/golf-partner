// Summary: final standings (deep-green card), how it unfolded, awards, and
// everyone's score mix. When the game's own result (the Play leaderboard) is
// not the individual Stableford total — best ball, sindicato, match play… —
// the standings open on that Result and the Stableford view is named as such.
// A one-round game (`singleIndex`) swaps the progression chart for that
// round's race with its lead / comeback lines, and says nothing "per round".
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import { pointsText } from '../../lib/pointsText';
import { getScoringMode } from '../scoringModes';
import LeaderboardCard from '../LeaderboardCard';
import ScoreMixBar, { ScoreMixLegend } from '../mystats/ScoreMixBar';
import {
  standingsRows, progression, awardsList, resultStandings, scoreMix, raceSeries, leadStory, roundComeback,
} from '../../store/gameStatsView';
import ProgressionChart from './ProgressionChart';
import RaceChart from './RaceChart';
import AwardsStrip from './AwardsStrip';
import { LeadLines } from './RoundsTab';
import { awardSheet } from './sheets';
import { ModeToggle, Segmented, SectionTitle, firstName, num, signed, useStatStyles } from './ui';

// `resultTournament` is the raw game (scramble rounds intact) the Play board
// is computed from; `tournament` is the scramble-sanitised one every
// personal stat uses.
export default function SummaryTab({
  tournament, resultTournament, teams, onOpenSheet, onPlayerPress, singleIndex = null, mode, onModeChange,
}) {
  const t = useT();
  const { s } = useStatStyles();
  const result = useMemo(() => {
    const r = resultStandings(resultTournament ?? tournament);
    return r.sameAsStableford || r.rows.length === 0 ? null : r;
  }, [resultTournament, tournament]);
  const [picked, setPicked] = useState(null);
  const metric = (picked === 'result' && !result ? null : picked) ?? (result ? 'result' : 'points');
  const standings = useMemo(
    () => (metric === 'result' ? null : standingsRows(tournament, { metric })),
    [tournament, metric],
  );
  const prog = useMemo(() => progression(tournament), [tournament]);
  const awards = useMemo(() => awardsList(tournament, { teams }), [tournament, teams]);
  const pointsOrder = useMemo(() => standingsRows(tournament).rows.filter((r) => r.holes > 0), [tournament]);
  const mixes = useMemo(
    () => pointsOrder.map((r) => ({ player: r.player, dist: scoreMix(tournament, r.player.id, mode) })),
    [tournament, pointsOrder, mode],
  );
  const single = singleIndex != null;
  const story = useMemo(() => (single ? {
    race: raceSeries(tournament, singleIndex),
    lead: leadStory(tournament, singleIndex),
    comeback: roundComeback(tournament, singleIndex),
  } : null), [tournament, single, singleIndex]);

  const isPoints = metric === 'points';
  const multiRound = prog.roundIndices.length > 1;
  const vsText = (v) => {
    if (v == null) return null;
    if (!isPoints && v === 0) return t('stats.game.standings.even');
    return signed(v);
  };
  const resultRows = result && metric === 'result' ? result.rows.map((r) => ({
    key: r.player.id,
    place: r.place,
    isTie: r.isTie,
    name: r.player.name,
    points: num(r.points),
    sub: '',
    pointsLabel: pointsText(r.points, result.unit),
    onPress: onPlayerPress ? () => onPlayerPress(r.player.id) : undefined,
  })) : null;
  const rows = resultRows ?? standings.rows.map((r) => ({
    key: r.player.id,
    place: r.place,
    isTie: r.isTie,
    name: r.player.name,
    detail: multiRound
      ? r.perRound.map((pr) => {
        if (pr.value == null) return '–';
        return pr.partial && isPoints
          ? t('stats.game.standings.partial', { value: num(pr.value), holes: pr.holes })
          : num(pr.value);
      }).join(' · ')
      : (r.perRound[0]?.partial ? t('stats.game.standings.holesPlayed', { count: r.perRound[0].holes }) : null),
    points: r.total == null ? '–' : num(r.total),
    sub: vsText(r.vs) ?? '',
    pointsLabel: r.total == null ? undefined : t(`stats.game.standings.a11y.${metric}`, { count: num(r.total) }),
    onPress: onPlayerPress ? () => onPlayerPress(r.player.id) : undefined,
  }));

  const segmented = (
    <Segmented
      deep
      value={metric}
      onChange={setPicked}
      options={[
        result && { key: 'result', label: t('stats.game.standings.result') },
        { key: 'points', label: t(result ? 'stats.game.standings.stableford' : 'stats.game.standings.points') },
        { key: 'gross', label: t('stats.game.standings.gross') },
        { key: 'net', label: t('stats.game.standings.net') },
      ].filter(Boolean)}
    />
  );
  const footer = metric === 'result'
    ? t(result.unit === 'holes' ? 'stats.game.standings.footer.resultHoles' : 'stats.game.standings.footer.result', {
      mode: t(getScoringMode(result.mode).labelKey),
    })
    : t(`stats.game.standings.footer.${metric}${single ? 'Single' : ''}`);

  return (
    <View>
      <LeaderboardCard
        title={t('stats.game.standings.title')}
        // Four options don't fit beside the title at phone width: they get
        // their own row under it.
        headerRight={result ? null : segmented}
        subheader={result ? <View style={{ alignSelf: 'flex-start', marginBottom: 8 }}>{segmented}</View> : null}
        rows={rows}
        footer={footer}
      />

      {multiRound && prog.series.length > 0 && (
        <View style={s.card}>
          <SectionTitle>{t(result ? 'stats.game.prog.titleStableford' : 'stats.game.prog.title')}</SectionTitle>
          {/* With a Result view the lead story would name a Stableford leader
              as if they had won the game: keep the chart, drop the caption. */}
          <ProgressionChart data={result ? { ...prog, caption: null } : prog} players={tournament.players} />
        </View>
      )}

      {story && story.race.series.length > 0 && (
        <View style={s.card} testID="summary-race">
          <SectionTitle>{t(result ? 'stats.game.prog.titleStableford' : 'stats.game.prog.title')}</SectionTitle>
          <LeadLines lead={story.lead} comeback={story.comeback} />
          <RaceChart data={story.race} />
          <Text style={s.sub}>{t('stats.game.race.caption')}</Text>
        </View>
      )}

      {awards.length > 0 && (
        <View>
          <SectionTitle right={awards.length > 2 ? t('stats.game.award.swipe') : null}>{t('stats.game.award.section')}</SectionTitle>
          <AwardsStrip awards={awards} onOpen={(a) => onOpenSheet(awardSheet(a, { single }))} />
        </View>
      )}

      {mixes.length > 0 && (
        <View style={s.card}>
          <SectionTitle right={<ModeToggle value={mode} onChange={onModeChange} testID="mix-mode" />}>{t('stats.game.mix.title')}</SectionTitle>
          {mixes.map(({ player, dist }, i) => (
            <View key={player.id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }, i > 0 && s.divider]}>
              {/* The count sits under the name so it never competes with
                  the bar for width (Spanish "6 birdies+" was ellipsized). */}
              <View style={{ width: 72 }}>
                <Text style={[s.strong, { fontSize: 13 }]} numberOfLines={1}>{firstName(player)}</Text>
                <Text style={[s.sub, { fontSize: 11, lineHeight: 15 }]} testID={`mix-count-${player.id}`}>
                  {t('stats.game.mix.birdies', { count: dist.eagles + dist.birdies })}
                </Text>
              </View>
              <View style={s.grow}><ScoreMixBar distribution={dist} legend={false} /></View>
            </View>
          ))}
          <ScoreMixLegend />
        </View>
      )}
    </View>
  );
}
