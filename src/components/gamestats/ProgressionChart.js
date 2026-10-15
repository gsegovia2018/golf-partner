// "How it unfolded": cumulative Stableford points after each round, one line
// per player (standings order, leader bold), with a caption about the lead.
import React from 'react';
import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import LineChart from './LineChart';
import { firstName, joinNames, num, seriesColor, useStatStyles } from './ui';

export function progressionCaption(caption, players, t) {
  if (!caption) return null;
  const leaders = caption.leaderIds.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  if (caption.kind === 'level') return t('stats.game.prog.level', { names: joinNames(leaders) });
  if (caption.kind === 'wire') return t('stats.game.prog.wire', { name: firstName(leaders[0]) });
  return caption.changes > 0
    ? t('stats.game.prog.tookChanges', { name: firstName(leaders[0]), round: caption.round, count: caption.changes })
    : t('stats.game.prog.took', { name: firstName(leaders[0]), round: caption.round });
}

export default function ProgressionChart({ data, players }) {
  const t = useT();
  const { theme, s } = useStatStyles();
  const series = data.series.map((row, i) => ({
    key: row.player.id,
    label: `${firstName(row.player)} ${num(row.total)}`,
    values: row.values,
    color: seriesColor(theme, i),
    bold: i === 0,
  }));
  const xLabels = [t('stats.game.prog.start'), ...data.roundIndices.map((ri) => t('stats.screen.roundShort', { n: ri + 1 }))];
  const a11y = t('stats.game.prog.a11y', {
    list: data.series.map((r) => `${firstName(r.player)} ${num(r.total)}`).join(', '),
  });
  const caption = progressionCaption(data.caption, players, t);
  return (
    <View>
      <LineChart series={series} xLabels={xLabels} accessibilityLabel={a11y} testID="progression-chart" />
      {caption ? <Text style={s.sub}>{caption}</Text> : null}
    </View>
  );
}
