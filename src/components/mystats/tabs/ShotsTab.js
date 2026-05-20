import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import MetricRow from '../MetricRow';

export default function ShotsTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { teeShot, shots, lagPutting } = stats;

  if (!teeShot.hasData && !shots.hasData) {
    return (
      <View style={s.wrap}>
        <SectionCard title="Shots">
          <Text style={s.note}>
            Log putts and drives during a round to unlock tee-shot, putting and driving stats.
          </Text>
        </SectionCard>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {teeShot.hasData ? (
        <SectionCard title="Tee shot impact" infoKey="teeShotImpact" onInfo={onInfo}>
          <MetricRow label="Fairway found" value={teeShot.fairway.avgPoints} secondary={`${teeShot.fairway.holes} holes`} dim={teeShot.fairway.holes === 0} />
          <MetricRow label="Fairway missed" value={teeShot.missed.avgPoints} secondary={`${teeShot.missed.holes} holes`} dim={teeShot.missed.holes === 0} />
          <MetricRow label="Miss left" value={teeShot.byDirection.left.avgPoints} secondary={`${teeShot.byDirection.left.holes} holes`} dim={teeShot.byDirection.left.holes === 0} />
          <MetricRow label="Miss right" value={teeShot.byDirection.right.avgPoints} secondary={`${teeShot.byDirection.right.holes} holes`} dim={teeShot.byDirection.right.holes === 0} />
          <MetricRow label="Miss short" value={teeShot.byDirection.short.avgPoints} secondary={`${teeShot.byDirection.short.holes} holes`} dim={teeShot.byDirection.short.holes === 0} />
          <MetricRow label="After tee penalty" value={teeShot.teePenalty.avgPoints} secondary={`${teeShot.teePenalty.holes} holes`} dim={teeShot.teePenalty.holes === 0} />
          <MetricRow label="Penalty drag (pts lost)" value={teeShot.penaltyDrag} secondary={`${teeShot.teePenalty.holes} holes`} dim={teeShot.teePenalty.holes === 0} />
        </SectionCard>
      ) : null}

      {shots.hasData ? (
        <SectionCard title="Putting & driving" infoKey="puttingDriving" onInfo={onInfo}>
          <MetricRow label="Putts / round" value={shots.putts.perRound} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="1-putts" value={shots.putts.onePutts} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="3-putts+" value={shots.putts.threePuttPlus} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="Fairways hit %" value={`${shots.drives.fairwayPct}%`} secondary={`${shots.drives.recorded} drives`} dim={shots.drives.recorded === 0} />
          <MetricRow label="Greens in reg %" value={`${shots.gir.pct}%`} secondary={`${shots.gir.eligible} holes`} dim={shots.gir.eligible === 0} />
          <MetricRow label="Penalties / round" value={shots.penalties.total} secondary={`${shots.roundsWithData} rounds`} dim={shots.roundsWithData === 0} />
        </SectionCard>
      ) : null}

      {lagPutting ? (
        <SectionCard title="Putts by first-putt distance">
          {['0-3', '3-6', '6-10', '10-20', '20+'].map((bucket) => {
            const avg = lagPutting.avgPuttsByBucket[bucket];
            const n = lagPutting.sample.perBucket[bucket];
            return (
              <MetricRow
                key={bucket}
                label={`${bucket} ft`}
                value={avg == null ? '—' : avg.toFixed(2)}
                secondary={`${n} putts`}
                dim={n === 0}
              />
            );
          })}
        </SectionCard>
      ) : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
  });
}
