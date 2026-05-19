import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import MetricRow from '../MetricRow';
import DistributionBars from '../DistributionBars';

const holes = (n) => `${n} holes`;

export default function BreakdownTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { parType, difficulty, frontBack, warmupClosing, distribution, bounceBack, scrambling } = stats;
  const fbHoles = frontBack ? frontBack.rounds.length * 9 : 0;

  return (
    <View style={s.wrap}>
      <SectionCard title="Score distribution" infoKey="scoreDistribution" onInfo={onInfo}>
        <DistributionBars
          bars={[
            { label: 'Eagle+', count: distribution.eagles },
            { label: 'Birdie', count: distribution.birdies },
            { label: 'Par', count: distribution.pars },
            { label: 'Bogey', count: distribution.bogeys },
            { label: 'Double', count: distribution.doubles, muted: true },
            { label: 'Triple+', count: distribution.worse, muted: true },
          ]}
        />
      </SectionCard>

      <SectionCard title="Par type" infoKey="parType" onInfo={onInfo}>
        <MetricRow label="Par 3s" value={parType.par3.avgPoints} secondary={holes(parType.par3.holes)} dim={parType.par3.holes === 0} />
        <MetricRow label="Par 4s" value={parType.par4.avgPoints} secondary={holes(parType.par4.holes)} dim={parType.par4.holes === 0} />
        <MetricRow label="Par 5s" value={parType.par5.avgPoints} secondary={holes(parType.par5.holes)} dim={parType.par5.holes === 0} />
      </SectionCard>

      <SectionCard title="Hole difficulty" infoKey="holeDifficulty" onInfo={onInfo}>
        <MetricRow label="Hard (SI 1-6)" value={difficulty.hard.avgPoints} secondary={holes(difficulty.hard.holes)} dim={difficulty.hard.holes === 0} />
        <MetricRow label="Mid (SI 7-12)" value={difficulty.mid.avgPoints} secondary={holes(difficulty.mid.holes)} dim={difficulty.mid.holes === 0} />
        <MetricRow label="Easy (SI 13-18)" value={difficulty.easy.avgPoints} secondary={holes(difficulty.easy.holes)} dim={difficulty.easy.holes === 0} />
      </SectionCard>

      <SectionCard title="Round shape" infoKey="roundShape" onInfo={onInfo}>
        <MetricRow label="Front nine" value={frontBack ? frontBack.frontAvg : 0} secondary={holes(fbHoles)} dim={fbHoles === 0} />
        <MetricRow label="Back nine" value={frontBack ? frontBack.backAvg : 0} secondary={holes(fbHoles)} dim={fbHoles === 0} />
        <MetricRow label="Opening 3" value={warmupClosing.warmup.avgPoints} secondary={holes(warmupClosing.warmup.holes)} dim={warmupClosing.warmup.holes === 0} />
        <MetricRow label="Closing 3" value={warmupClosing.closing.avgPoints} secondary={holes(warmupClosing.closing.holes)} dim={warmupClosing.closing.holes === 0} />
      </SectionCard>

      {(bounceBack || scrambling) ? (
        <SectionCard title="Recovery" infoKey="recovery" onInfo={onInfo}>
          <MetricRow
            label="Bounce-back rate"
            value={bounceBack ? `${bounceBack.rate}%` : '—'}
            secondary={bounceBack ? `${bounceBack.opportunities} chances` : ''}
            dim={!bounceBack}
          />
          <MetricRow
            label="Scrambling"
            value={scrambling ? `${scrambling.pct}%` : '—'}
            secondary={scrambling ? `${scrambling.missedGir} misses` : ''}
            dim={!scrambling}
          />
        </SectionCard>
      ) : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
  });
}
