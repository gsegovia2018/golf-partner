import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import Reveal from '../../ui/Reveal';
import SectionCard from '../SectionCard';
import CourseMasteryCard from '../CourseMasteryCard';
import CareerMilestonesCard from '../CareerMilestonesCard';
import BreakdownRow from '../BreakdownRow';
import ScoreMixBar from '../ScoreMixBar';
import {
  comparisonMeta,
  toneFromComparison,
  toneFromDelta,
  toneFromRate,
} from '../metricTone';
import {
  APPROACH_BUCKETS,
  DRIVE_LABELS,
  DRIVE_ORDER,
  sampleText,
  signed,
} from '../shotMetrics';

const EMPTY_DISTRIBUTION = {
  eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0, total: 0,
};
const EMPTY_PAR_TYPE = {
  par3: { holes: 0, avgPoints: 0 },
  par4: { holes: 0, avgPoints: 0 },
  par5: { holes: 0, avgPoints: 0 },
};
const EMPTY_DIFFICULTY = {
  hard: { holes: 0, avgPoints: 0 },
  mid: { holes: 0, avgPoints: 0 },
  easy: { holes: 0, avgPoints: 0 },
};
const EMPTY_WARMUP = {
  warmup: { holes: 0, avgPoints: 0 },
  closing: { holes: 0, avgPoints: 0 },
};
const OWN_AVG_BASIS = 'vs your avg';
const SAMPLE_BASIS = 'tracked sample';

export default function BreakdownTab({ stats, onInfo, onSelectCourse }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const {
    parType = EMPTY_PAR_TYPE,
    difficulty = EMPTY_DIFFICULTY,
    frontBack,
    warmupClosing = EMPTY_WARMUP,
    distribution: rawDistribution,
    bounceBack,
    scrambling,
    teeShot,
    shots,
    driveImpact,
    approachImpact,
    puttDive,
    sandSaves,
    upAndDown,
    bunkerVisits,
    courseMastery,
    careerMilestones,
  } = stats ?? {};
  const distribution = { ...EMPTY_DISTRIBUTION, ...(rawDistribution ?? {}) };
  const baseline = stablefordBaseline(stats);
  const scoringRows = makeScoringPatternRows({ distribution, stats });
  const courseRows = makeCoursePatternRows({ parType, difficulty, baseline });
  const timingRows = makeTimingPatternRows({ frontBack, warmupClosing, baseline });
  const teePatternRows = makeTeePatternRows(teeShot, baseline);
  const drivePatternRows = makeDrivePatternRows(driveImpact, baseline);
  const approachPatternRows = makeApproachPatternRows(approachImpact, baseline);
  const puttingPatternRows = makePuttingPatternRows({ shots, puttDive });
  const recoveryRows = makeRecoveryRows({
    bounceBack, scrambling, sandSaves, upAndDown, bunkerVisits,
  });

  // Every card that will actually render, in order — so the mount stagger
  // below skips empty sections instead of leaving gaps in the cascade.
  const cards = [];
  if ((distribution.total ?? 0) > 0) {
    cards.push({
      key: 'scoreMix',
      node: (
        <SectionCard title="Score mix" infoKey="scoreDistribution" onInfo={onInfo}>
          <ScoreMixBar distribution={distribution} />
        </SectionCard>
      ),
    });
  }
  if ((courseMastery ?? []).length > 0) {
    cards.push({
      key: 'courseMastery',
      node: (
        <CourseMasteryCard courses={courseMastery} onInfo={onInfo} onSelectCourse={onSelectCourse} />
      ),
    });
  }
  if (careerMilestones) {
    cards.push({
      key: 'careerMilestones',
      node: <CareerMilestonesCard milestones={careerMilestones} onInfo={onInfo} />,
    });
  }
  const patternCards = [
    { key: 'scoring', title: 'Scoring patterns', infoKey: 'scoreDistribution', rows: scoringRows },
    { key: 'course', title: 'Course scoring patterns', infoKey: 'parType', rows: courseRows },
    { key: 'timing', title: 'Round timing patterns', infoKey: 'roundShape', rows: timingRows },
    { key: 'tee', title: 'Tee result patterns', infoKey: 'teeShot', rows: teePatternRows },
    { key: 'drive', title: 'Drive bucket patterns', infoKey: 'driveBuckets', rows: drivePatternRows },
    { key: 'approach', title: 'Approach distance patterns', infoKey: 'approachDistance', rows: approachPatternRows },
    { key: 'putting', title: 'Putting patterns', infoKey: 'puttingDriving', rows: puttingPatternRows },
    { key: 'recovery', title: 'Recovery patterns', infoKey: 'recovery', rows: recoveryRows },
  ];
  patternCards.forEach(({ key, title, infoKey, rows }) => {
    if (!rows.length) return;
    cards.push({
      key,
      node: (
        <SectionCard title={title} infoKey={infoKey} onInfo={onInfo}>
          <PatternRows rows={rows} />
        </SectionCard>
      ),
    });
  });

  return (
    <View style={s.wrap}>
      {cards.map(({ key, node }, index) => (
        // Cascade the cards in; cards beyond index 6 share the last delay so
        // the total added wait stays ≤ 240ms. Reveal respects reduced motion.
        <Reveal key={key} delay={Math.min(index, 6) * 40}>
          {node}
        </Reveal>
      ))}
    </View>
  );
}

function PatternRows({ rows }) {
  return (
    <View>
      {rows.map(({ key, ...row }, index) => (
        <BreakdownRow key={key} {...row} first={index === 0} />
      ))}
    </View>
  );
}

function stablefordBaseline(stats) {
  const history = stats?.history ?? [];
  const totals = history.reduce((acc, round) => ({
    points: acc.points + (round.points ?? 0),
    holes: acc.holes + (round.holesPlayed ?? 0),
  }), { points: 0, holes: 0 });
  if (totals.holes > 0) return totals.points / totals.holes;
  if (isNumber(stats?.metrics?.avgPoints)) return stats.metrics.avgPoints / 18;
  return null;
}

function makeScoringPatternRows({ distribution, stats }) {
  const total = distribution.total ?? 0;
  if (total <= 0) return [];
  const rounds = stats?.roundCount ?? stats?.metrics?.rounds ?? stats?.history?.length ?? Math.max(1, total / 18);
  return [
    countPatternRow({
      key: 'birdies',
      label: 'Birdies+ / round',
      count: (distribution.eagles ?? 0) + (distribution.birdies ?? 0),
      rounds,
      total,
      tone: ((distribution.eagles ?? 0) + (distribution.birdies ?? 0)) > 0 ? 'good' : 'neutral',
    }),
    countPatternRow({
      key: 'pars',
      label: 'Pars / round',
      count: distribution.pars ?? 0,
      rounds,
      total,
      tone: (distribution.pars ?? 0) >= Math.max(1, total * 0.3) ? 'good' : 'neutral',
    }),
    countPatternRow({
      key: 'bogeys',
      label: 'Bogeys / round',
      count: distribution.bogeys ?? 0,
      rounds,
      total,
      tone: (distribution.bogeys ?? 0) > Math.max(1, total * 0.35) ? 'bad' : 'neutral',
    }),
    countPatternRow({
      key: 'doubles',
      label: 'Doubles+ / round',
      count: (distribution.doubles ?? 0) + (distribution.worse ?? 0),
      rounds,
      total,
      tone: ((distribution.doubles ?? 0) + (distribution.worse ?? 0)) > 0 ? 'bad' : 'neutral',
    }),
  ];
}

function countPatternRow({
  key, label, count, rounds, total, tone,
}) {
  const perRound = rounds > 0 ? round1(count / rounds) : count;
  return {
    key,
    label,
    value: formatNumber(perRound),
    secondary: comparisonMeta('your score mix', [
      `${count} total`,
      sampleText(total, 'holes'),
    ], { sample: total, minSample: 18 }),
    tone,
    dim: total === 0,
  };
}

function makeCoursePatternRows({ parType, difficulty, baseline }) {
  return [
    pointPatternRow('par3', 'Par 3s', parType.par3, baseline),
    pointPatternRow('par4', 'Par 4s', parType.par4, baseline),
    pointPatternRow('par5', 'Par 5s', parType.par5, baseline),
    pointPatternRow('hard', 'Hard holes (hardest third)', difficulty.hard, baseline),
    pointPatternRow('mid', 'Mid holes (middle third)', difficulty.mid, baseline),
    pointPatternRow('easy', 'Easy holes (easiest third)', difficulty.easy, baseline),
  ].filter(Boolean);
}

function makeTimingPatternRows({ frontBack, warmupClosing, baseline }) {
  const rows = [];
  const fbHoles = frontBack ? (frontBack.rounds?.length ?? 0) * 9 : 0;
  if (frontBack) {
    rows.push(
      timingNineRow('front', 'Front nine', frontBack.frontAvg, fbHoles, baseline),
      timingNineRow('back', 'Back nine', frontBack.backAvg, fbHoles, baseline)
    );
  }
  rows.push(
    pointPatternRow('opening3', 'Opening 3', warmupClosing.warmup, baseline),
    pointPatternRow('closing3', 'Closing 3', warmupClosing.closing, baseline)
  );
  return rows.filter(Boolean);
}

function timingNineRow(key, label, value, holesCount, baseline) {
  const delta = isNumber(value) && isNumber(baseline) ? value - baseline : null;
  return {
    key,
    label,
    value: `${formatNumber(value)} pts/hole`,
    secondary: holesCount > 0
      ? comparisonSecondary(holesCount, baseline, delta)
      : 'No sample yet',
    tone: toneFromDelta(delta, { sample: holesCount, minSample: 6 }),
    dim: holesCount === 0,
  };
}

function makeTeePatternRows(teeShot, baseline) {
  if (!teeShot?.hasData) return [];
  const rows = [
    pointPatternRow('fairway', 'Fairway found', teeShot.fairway, baseline),
    pointPatternRow('missed', 'Fairway missed', teeShot.missed, baseline),
    pointPatternRow('left', 'Miss left', teeShot.byDirection?.left, baseline),
    pointPatternRow('right', 'Miss right', teeShot.byDirection?.right, baseline),
    pointPatternRow('short', 'Miss short', teeShot.byDirection?.short, baseline),
    pointPatternRow('teePenalty', 'After tee penalty', teeShot.teePenalty, baseline),
  ];

  if ((teeShot.teePenalty?.holes ?? 0) > 0) {
    rows.push({
      key: 'penaltyDrag',
      label: 'Penalty drag',
      value: formatNumber(teeShot.penaltyDrag),
      secondary: `${sampleText(teeShot.teePenalty.holes, 'holes')} · points lost after tee penalties`,
      tone: toneFromComparison({
        value: teeShot.penaltyDrag,
        target: 0,
        polarity: 'lower',
        sample: teeShot.teePenalty.holes,
        minSample: 6,
      }),
    });
  }

  return rows.filter(Boolean);
}

function makeDrivePatternRows(driveImpact, baseline) {
  if (!driveImpact?.hasData) return [];
  return DRIVE_ORDER.map((bucket) => {
    const row = driveImpact.buckets?.[bucket];
    if (!row || row.holes === 0) return null;
    const delta = isNumber(baseline) ? row.avgPoints - baseline : null;
    return {
      key: bucket,
      label: DRIVE_LABELS[bucket],
      value: `${formatNumber(row.avgPoints)} pts`,
      secondary: `${signed(row.avgVsPar)} vs par · ${formatPercent(row.penaltyRate)} pen · ${comparisonSecondary(row.holes, baseline, delta)}`,
      tone: toneFromDelta(delta, { sample: row.holes, minSample: 6 }),
    };
  }).filter(Boolean);
}

function makeApproachPatternRows(approachImpact, baseline) {
  if (!approachImpact?.hasData) return [];
  return APPROACH_BUCKETS.map((bucket) => {
    const row = approachImpact.buckets?.[bucket];
    if (!row || row.holes === 0) return null;
    const delta = isNumber(baseline) ? row.avgPoints - baseline : null;
    return {
      key: bucket,
      label: `${bucket} m approaches`,
      value: `${formatNumber(row.avgPoints)} pts`,
      secondary: `${signed(row.avgVsPar)} vs par · ${formatPercent(row.girRate)} GIR · ${comparisonSecondary(row.holes, baseline, delta)}`,
      tone: toneFromDelta(delta, { sample: row.holes, minSample: 6 }),
    };
  }).filter(Boolean);
}

function makePuttingPatternRows({ shots, puttDive }) {
  const rows = [];
  if (shots?.hasData) {
    const threePuttsPerRound = shots.roundsWithPuttData > 0
      ? round1(shots.putts.threePuttPlus / shots.roundsWithPuttData)
      : 0;
    const puttsTotal = shots.putts.total ?? (
      shots.roundsWithPuttData > 0 ? Math.round(shots.putts.perRound * shots.roundsWithPuttData) : null
    );
    rows.push(
      {
        key: 'puttsPerRound',
        label: 'Putts / round',
        value: formatNumber(shots.putts.perRound),
        secondary: sampleSecondary([
          sampleText(shots.putts.holes, 'holes'),
          puttsTotal != null ? `${puttsTotal} total` : null,
        ], shots.putts.holes, 9),
        tone: 'neutral',
        dim: shots.putts.holes === 0,
      },
      {
        key: 'onePutts',
        label: '1-putts',
        value: formatNumber(shots.putts.onePutts),
        secondary: sampleSecondary([sampleText(shots.putts.holes, 'holes')], shots.putts.holes, 9),
        tone: toneFromComparison({
          value: shots.putts.onePutts,
          target: 0,
          polarity: 'higher',
          sample: shots.putts.holes,
          minSample: 9,
        }),
        dim: shots.putts.holes === 0,
      },
      {
        key: 'threePutts',
        label: '3-putts / round',
        value: formatNumber(threePuttsPerRound),
        secondary: sampleSecondary([
          `${shots.putts.threePuttPlus} total`,
          sampleText(shots.roundsWithPuttData, 'rounds'),
        ], shots.putts.holes, 9),
        tone: toneFromComparison({
          value: threePuttsPerRound,
          target: 2,
          polarity: 'lower',
          tolerance: 0.2,
          sample: shots.putts.holes,
          minSample: 9,
        }),
        dim: shots.putts.holes === 0,
      }
    );
  }

  if (puttDive?.hasData) {
    rows.push(
      {
        key: 'twoPuttRate',
        label: '2-putt rate',
        value: `${puttDive.twoPuttPct}%`,
        secondary: sampleSecondary([sampleText(puttDive.holes, 'holes')], puttDive.holes, 9),
        tone: toneFromComparison({
          value: puttDive.twoPuttPct,
          target: 60,
          polarity: 'higher',
          sample: puttDive.holes,
          minSample: 9,
        }),
        dim: !isNumber(puttDive.twoPuttPct),
      },
      {
        key: 'girPutts',
        label: 'Putts on GIR',
        value: formatNumber(puttDive.girPuttsAvg),
        secondary: sampleSecondary([sampleText(puttDive.girHoles, 'holes')], puttDive.girHoles, 6),
        tone: toneFromComparison({
          value: puttDive.girPuttsAvg,
          target: 2,
          polarity: 'lower',
          sample: puttDive.girHoles,
          minSample: 6,
        }),
        dim: puttDive.girPuttsAvg == null,
      },
      {
        key: 'nonGirPutts',
        label: 'Putts off GIR',
        value: formatNumber(puttDive.nonGirPuttsAvg),
        secondary: sampleSecondary([sampleText(puttDive.nonGirHoles, 'holes')], puttDive.nonGirHoles, 6),
        tone: toneFromComparison({
          value: puttDive.nonGirPuttsAvg,
          target: 2,
          polarity: 'lower',
          sample: puttDive.nonGirHoles,
          minSample: 6,
        }),
        dim: puttDive.nonGirPuttsAvg == null,
      },
      {
        key: 'onePuttSave',
        label: '1-putt save',
        value: `${puttDive.onePuttSave?.pct ?? 0}%`,
        secondary: sampleSecondary([
          sampleText(puttDive.onePuttSave?.attempts ?? 0, 'chances'),
        ], puttDive.onePuttSave?.attempts ?? 0, 6),
        tone: toneFromComparison({
          value: puttDive.onePuttSave?.pct ?? 0,
          target: 30,
          polarity: 'higher',
          sample: puttDive.onePuttSave?.attempts ?? 0,
          minSample: 6,
        }),
        dim: (puttDive.onePuttSave?.attempts ?? 0) === 0,
      }
    );
  }

  return rows;
}

function makeRecoveryRows({
  bounceBack, scrambling, sandSaves, upAndDown, bunkerVisits,
}) {
  return [
    bounceBack ? {
      key: 'bounceBack',
      label: 'Bounce-back rate',
      value: `${bounceBack.rate}%`,
      secondary: sampleSecondary([`${bounceBack.opportunities} chances`], bounceBack.opportunities, 6),
      tone: toneFromComparison({
        value: bounceBack.rate,
        target: 30,
        polarity: 'higher',
        sample: bounceBack.opportunities,
        minSample: 6,
      }),
      dim: bounceBack.opportunities === 0,
    } : null,
    scrambling ? {
      key: 'scrambling',
      label: 'Scrambling',
      value: `${scrambling.pct}%`,
      secondary: sampleSecondary([`${scrambling.missedGir} missed GIR`], scrambling.missedGir, 6),
      tone: toneFromComparison({
        value: scrambling.pct,
        target: 35,
        polarity: 'higher',
        sample: scrambling.missedGir,
        minSample: 6,
      }),
      dim: scrambling.missedGir === 0,
    } : null,
    sandSaves ? {
      key: 'sandSaves',
      label: 'Sand-save rate',
      value: rateValue(sandSaves.saves, sandSaves.attempts, sandSaves.rate),
      secondary: sampleSecondary([sampleText(sandSaves.attempts, 'tries')], sandSaves.attempts, 6),
      tone: toneFromRate(sandSaves.rate, 0.4, { sample: sandSaves.attempts, minSample: 6 }),
      dim: sandSaves.rate == null,
    } : null,
    upAndDown ? {
      key: 'upAndDown',
      // Honest-labeling note: this counts every missed-GIR hole with logged
      // putts as an "attempt" — including a two-putt from the fringe or a
      // long 3-putt with no chip/recovery shot near the green. There's no
      // reliable signal in shot detail (approachResult is optional and
      // often unset) to gate that denominator to real around-the-green
      // shots, so this is presented as a scrambling-family metric rather
      // than the classic "up and down" (see statsEngine.js upAndDownRate).
      label: 'Scrambling (1-putt saves)',
      value: rateValue(upAndDown.conversions, upAndDown.attempts, upAndDown.rate),
      secondary: sampleSecondary([sampleText(upAndDown.attempts, 'tries')], upAndDown.attempts, 6),
      tone: toneFromRate(upAndDown.rate, 0.45, { sample: upAndDown.attempts, minSample: 6 }),
      dim: upAndDown.rate == null,
    } : null,
    bunkerVisits ? {
      key: 'bunkerVisits',
      label: 'Bunker visits',
      value: bunkerVisits.avgPerRound > 0 ? `${bunkerVisits.avgPerRound.toFixed(1)} / round` : '-',
      secondary: bunkerVisits.holesWithSand != null
        ? sampleSecondary([`${bunkerVisits.holesWithSand} holes`], bunkerVisits.holesWithSand, 6)
        : undefined,
      tone: toneFromComparison({
        value: bunkerVisits.avgPerRound,
        target: 1.5,
        polarity: 'lower',
        tolerance: 0.1,
        sample: bunkerVisits.holesWithSand,
        minSample: 6,
      }),
      dim: bunkerVisits.avgPerRound === 0,
    } : null,
  ].filter(Boolean);
}

function pointPatternRow(key, label, row, baseline) {
  const holesCount = row?.holes ?? 0;
  const avgPoints = row?.avgPoints;
  const delta = isNumber(avgPoints) && isNumber(baseline) ? avgPoints - baseline : null;
  return {
    key,
    label,
    value: `${formatNumber(avgPoints ?? 0)} pts`,
    secondary: holesCount > 0
      ? comparisonSecondary(holesCount, baseline, delta)
      : 'No sample yet',
    tone: toneFromDelta(delta, { sample: holesCount, minSample: 6 }),
    dim: holesCount === 0,
  };
}

function comparisonSecondary(holesCount, baseline, delta) {
  const sample = sampleText(holesCount, 'holes');
  const average = averageLabel(baseline);
  return comparisonMeta(OWN_AVG_BASIS, [
    sample,
    average,
    isNumber(delta) ? formatDelta(delta) : null,
  ], { sample: holesCount, minSample: 6 });
}

function sampleSecondary(parts, sample, minSample) {
  return comparisonMeta(SAMPLE_BASIS, parts, { sample, minSample });
}

function averageLabel(baseline) {
  return isNumber(baseline) ? `avg ${formatNumber(baseline)} pts/hole` : 'avg unavailable';
}

function rateValue(made, attempts, rate) {
  if (rate == null) return '-';
  return `${made} of ${attempts} · ${Math.round(rate * 100)}%`;
}

function formatDelta(value) {
  if (!isNumber(value)) return '0';
  return `${value >= 0 ? '+' : ''}${round1(value)}`;
}

function formatPercent(value) {
  return value == null ? '-' : `${value}%`;
}

function formatNumber(value) {
  if (value == null) return '-';
  if (!isNumber(value)) return value;
  return round2(value);
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
  });
}
