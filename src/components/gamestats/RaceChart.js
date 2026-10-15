// Round race: running Stableford points hole by hole for everyone in the round.
import React from 'react';
import { useT } from '../../i18n';
import LineChart from './LineChart';
import { firstName, num, seriesColor, useStatStyles } from './ui';

export default function RaceChart({ data, colorIndexOf }) {
  const t = useT();
  const { theme } = useStatStyles();
  const series = data.series.map((row, i) => ({
    key: row.player.id,
    label: `${firstName(row.player)} ${num(row.total)}`,
    values: row.values,
    color: seriesColor(theme, colorIndexOf ? colorIndexOf(row.player.id) : i),
    bold: i === 0,
  }));
  // Label the start, every third hole and the last one.
  const n = data.holes.length;
  const xLabels = ['', ...data.holes.map((h, i) => ((i + 1) % 3 === 0 || i === n - 1 ? String(h) : ''))];
  const a11y = t('stats.game.race.a11y', {
    list: data.series.map((r) => `${firstName(r.player)} ${num(r.total)}`).join(', '),
  });
  return <LineChart series={series} xLabels={xLabels} accessibilityLabel={a11y} testID="race-chart" />;
}
