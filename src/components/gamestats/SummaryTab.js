// Summary: final standings (deep-green card), how it unfolded, awards, and
// everyone's score mix.
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import LeaderboardCard from '../LeaderboardCard';
import ScoreMixBar, { ScoreMixLegend } from '../mystats/ScoreMixBar';
import { standingsRows, progression, awardsList } from '../../store/gameStatsView';
import { playerScoreDistribution } from '../../store/statsEngine';
import ProgressionChart from './ProgressionChart';
import AwardsStrip from './AwardsStrip';
import { awardSheet } from './sheets';
import { Segmented, SectionTitle, firstName, num, signed, useStatStyles } from './ui';

export default function SummaryTab({ tournament, teams, onOpenSheet, onPlayerPress }) {
  const t = useT();
  const { s } = useStatStyles();
  const [metric, setMetric] = useState('points');
  const standings = useMemo(() => standingsRows(tournament, { metric }), [tournament, metric]);
  const prog = useMemo(() => progression(tournament), [tournament]);
  const awards = useMemo(() => awardsList(tournament, { teams }), [tournament, teams]);
  const pointsOrder = useMemo(() => standingsRows(tournament).rows.filter((r) => r.holes > 0), [tournament]);
  const mixes = useMemo(
    () => pointsOrder.map((r) => ({ player: r.player, dist: playerScoreDistribution(tournament, r.player.id) })),
    [tournament, pointsOrder],
  );

  const isPoints = metric === 'points';
  const multiRound = standings.roundIndices.length > 1;
  const vsText = (v) => {
    if (v == null) return null;
    if (!isPoints && v === 0) return t('stats.game.standings.even');
    return signed(v);
  };
  const rows = standings.rows.map((r) => ({
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

  return (
    <View>
      <LeaderboardCard
        title={t('stats.game.standings.title')}
        headerRight={(
          <Segmented
            deep
            value={metric}
            onChange={setMetric}
            options={[
              { key: 'points', label: t('stats.game.standings.points') },
              { key: 'gross', label: t('stats.game.standings.gross') },
              { key: 'net', label: t('stats.game.standings.net') },
            ]}
          />
        )}
        rows={rows}
        footer={t(`stats.game.standings.footer.${metric}`)}
      />

      {multiRound && prog.series.length > 0 && (
        <View style={s.card}>
          <SectionTitle>{t('stats.game.prog.title')}</SectionTitle>
          <ProgressionChart data={prog} players={tournament.players} />
        </View>
      )}

      {awards.length > 0 && (
        <View>
          <SectionTitle right={awards.length > 2 ? t('stats.game.award.swipe') : null}>{t('stats.game.award.section')}</SectionTitle>
          <AwardsStrip awards={awards} onOpen={(a) => onOpenSheet(awardSheet(a))} />
        </View>
      )}

      {mixes.length > 0 && (
        <View style={s.card}>
          <SectionTitle right={t('stats.game.mix.net')}>{t('stats.game.mix.title')}</SectionTitle>
          {mixes.map(({ player, dist }, i) => (
            <View key={player.id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }, i > 0 && s.divider]}>
              <Text style={[s.strong, { width: 64, fontSize: 13 }]} numberOfLines={1}>{firstName(player)}</Text>
              <View style={s.grow}><ScoreMixBar distribution={dist} legend={false} /></View>
              <Text style={[s.sub, { width: 64, textAlign: 'right' }]} numberOfLines={1}>
                {t('stats.game.mix.birdies', { count: dist.eagles + dist.birdies })}
              </Text>
            </View>
          ))}
          <ScoreMixLegend />
        </View>
      )}
    </View>
  );
}
