import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
import { useAppSettings } from '../../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../../lib/units';
import { shotBenchmarkForHandicap } from '../../../store/shotBenchmarks';
import SectionCard from '../SectionCard';
import ShotDashboard from '../ShotDashboard';
import SGTrendCard from '../SGTrendCard';
import SGReconciliationCard from '../SGReconciliationCard';
import BreakdownRow from '../BreakdownRow';
import ScoreMixBar from '../ScoreMixBar';
import TargetMeterRow from '../TargetMeterRow';
import { useT, t, formatNumber as formatLocaleNumber } from '../../../i18n';
import {
  isLowSample,
  toneFromComparison,
  toneFromSigned,
} from '../metricTone';
import { APPROACH_BUCKETS, PUTT_BUCKETS } from '../shotMetrics';

const YD_TO_M = 0.9144;

// Local twins of shotMetrics.signed / sampleText and metricTone.comparisonMeta
// so the words come from the catalogue. They call t() when a row is built (at
// render), never at module load, so a language switch is picked up.
function signed(value) {
  if (value == null) return '-';
  return value > 0 ? `+${formatLocaleNumber(value)}` : formatLocaleNumber(value);
}

function sampleText(value, unit) {
  if (value == null) return undefined;
  return t(`stats.tab.sample.${unit}`, { count: value });
}

function comparisonMeta(basis, parts = [], { sample, minSample = 6 } = {}) {
  return [
    basis,
    ...parts,
    isLowSample(sample, minSample) ? t('stats.tab.lowSample') : null,
  ].filter(Boolean).join(' · ');
}

const targetText = (value) => t('stats.tab.shots.target', { value });

// Memoised — see the note in CoachTab.
function ShotsTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
  useT(); // re-render on language change; the row builders below call t() directly
  const { theme } = useTheme();
  const { units } = useAppSettings();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const shotBenchmark = useMemo(
    () => shotBenchmarkForHandicap(targetHandicap),
    [targetHandicap]
  );
  const {
    shots, puttingTarget, approachTarget, approachTendency,
    sgVsGroup, approachMissCost, approachMissByDistance,
    scramblingByMiss, teeClubAccuracy, par5, realClubDistances,
  } = stats;

  const hasAnyShotData = shots.hasData || puttingTarget?.hasData || approachTarget?.hasData
    || stats?.strokesGained?.total != null || stats?.distributionGross?.total > 0;

  if (!hasAnyShotData) {
    return (
      <View style={s.wrap}>
        <SectionCard title={t('stats.tab.shots.strokesGained')}>
          <Text style={s.note}>
            {t('stats.tab.shots.noData')}
          </Text>
        </SectionCard>
      </View>
    );
  }

  const scoringRows = makeScoringRows(stats, shotBenchmark);
  const scoringSummary = makeScoringSummary(scoringRows);
  const drivingTargetRows = makeDrivingTargetRows(shots, shotBenchmark, stats.driveDistance, units);
  const approachTargetRows = approachTarget?.hasData ? makeApproachTargetRows(approachTarget) : [];
  const approachTendencyRows = approachTendency?.hasData ? makeApproachTendencyRows(approachTendency) : [];
  const approachCostRows = approachMissCost?.hasData ? makeApproachCostRows(approachMissCost) : [];
  const approachByDistRows = approachMissByDistance?.hasData ? makeApproachByDistanceRows(approachMissByDistance) : [];
  const groupRows = sgVsGroup?.hasData ? makeGroupRows(sgVsGroup) : [];
  const teeClubRows = teeClubAccuracy?.hasData ? makeTeeClubRows(teeClubAccuracy) : [];
  const realDistRows = realClubDistances?.hasData ? makeRealDistanceRows(realClubDistances, units) : [];
  const scramblingRows = scramblingByMiss?.hasData ? makeScramblingRows(scramblingByMiss) : [];
  const par5Rows = par5?.hasData ? makePar5Rows(par5) : [];
  const puttingVolumeRows = shots.hasData ? makePuttingVolumeRows(shots, shotBenchmark) : [];
  const puttingTargetRows = puttingTarget?.hasData ? makePuttingTargetRows(puttingTarget) : [];
  const girRows = shots.hasData ? makeGirRows(shots, shotBenchmark) : [];
  // The gross vs-par mix feeds the ScoreMixBar — same
  // {eagles,birdies,pars,bogeys,doubles,worse} counts shape the bar already
  // accepts, and gross is the honest basis next to gross benchmark rows.
  const grossMix = stats?.distributionGross ?? null;
  const grossMixTotal = grossMix
    ? ['eagles', 'birdies', 'pars', 'bogeys', 'doubles', 'worse']
      .reduce((sum, key) => sum + (grossMix[key] ?? 0), 0)
    : 0;

  return (
    <View style={s.wrap}>
      <ShotDashboard
        stats={stats}
        targetHandicap={targetHandicap}
        onChangeTarget={onChangeTarget}
        onInfo={onInfo}
        TargetNudge={SGTargetNudge}
      />
      <SGTrendCard strokesGained={stats.strokesGained} />
      <SGReconciliationCard
        reconciliation={stats.strokesGained?.reconciliation}
        targetHandicap={targetHandicap}
      />

      {groupRows.length ? (
        <SectionCard title={t('stats.tab.shots.vsGroup')} infoKey="sgVsGroup" onInfo={onInfo}>
          <ShotRowsBlock title={t('stats.tab.shots.sgVsPartners')} rows={groupRows} s={s} first />
        </SectionCard>
      ) : null}

      {scoringRows.length ? (
        <SectionCard title={t('stats.tab.shots.scoring')} infoKey="sgScoring" onInfo={onInfo}>
          {scoringSummary.length ? (
            <View style={s.targetBlock}>
              <Text style={s.targetOverline}>{t('stats.tab.shots.scoringVsTarget')}</Text>
              <View>
                {scoringSummary.map((item, index) => (
                  <TargetMeterRow
                    key={item.key}
                    label={item.label}
                    meta={item.meta}
                    value={item.value}
                    numericValue={item.numericValue}
                    target={item.target}
                    targetDisplay={item.targetDisplay}
                    tone={item.tone}
                    rowIndex={index}
                    first={index === 0}
                    testID={`scoring-meter-${item.key}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {grossMixTotal > 0 ? (
            <View style={s.detailBlock}>
              <Text style={s.mixOverline}>{t('stats.tab.shots.scoreMixGross')}</Text>
              <ScoreMixBar distribution={grossMix} />
            </View>
          ) : null}
          <ShotRowsBlock
            title={t('stats.tab.shots.scoringDetail')}
            rows={scoringRows}
            s={s}
            first={grossMixTotal === 0}
          />
        </SectionCard>
      ) : null}

      {drivingTargetRows.length ? (
        <SectionCard title={t('stats.tab.shots.drivingVsTarget')} infoKey="sgDriving" onInfo={onInfo}>
          <ShotRowsBlock title={t('stats.tab.shots.driverAccuracy')} rows={drivingTargetRows} s={s} first />
        </SectionCard>
      ) : null}

      {(teeClubRows.length || realDistRows.length) ? (
        <SectionCard title={t('stats.tab.shots.offTheTeeByClub')} infoKey="teeClubAccuracy" onInfo={onInfo}>
          {teeClubRows.length ? (
            <ShotRowsBlock title={t('stats.tab.shots.fairwaysByClub')} rows={teeClubRows} s={s} first />
          ) : null}
          {realDistRows.length ? (
            <ShotRowsBlock
              title={t('stats.tab.shots.realCarry')}
              rows={realDistRows}
              s={s}
              first={!teeClubRows.length}
            />
          ) : null}
        </SectionCard>
      ) : null}

      {(approachTargetRows.length || approachTendencyRows.length || shots.hasData) ? (
        <SectionCard title={t('stats.tab.shots.approachVsTarget')} infoKey="sgApproach" onInfo={onInfo}>
          {approachTargetRows.length ? (
            <ShotRowsBlock title={t('stats.tab.shots.approachDistanceSg')} rows={approachTargetRows} s={s} first />
          ) : null}

          {girRows.length ? (
            <ShotRowsBlock
              title={t('stats.tab.shots.girVolume')}
              rows={girRows}
              s={s}
              first={!approachTargetRows.length}
            />
          ) : null}

          {approachTendencyRows.length ? (
            <ShotRowsBlock
              title={t('stats.tab.shots.missTendency')}
              rows={approachTendencyRows}
              s={s}
              first={!approachTargetRows.length && !girRows.length}
            />
          ) : null}

          {approachCostRows.length ? (
            <ShotRowsBlock title={t('stats.tab.shots.finishCosts')} rows={approachCostRows} s={s} />
          ) : null}

          {approachByDistRows.length ? (
            <ShotRowsBlock title={t('stats.tab.shots.missByDistance')} rows={approachByDistRows} s={s} />
          ) : null}
        </SectionCard>
      ) : null}

      {scramblingRows.length ? (
        <SectionCard title={t('stats.tab.shots.shortGame')} infoKey="scramblingByMiss" onInfo={onInfo}>
          <ShotRowsBlock title={t('stats.tab.shots.saveRate')} rows={scramblingRows} s={s} first />
        </SectionCard>
      ) : null}

      {par5Rows.length ? (
        <SectionCard title={t('stats.tab.par5')} infoKey="par5" onInfo={onInfo}>
          <ShotRowsBlock title={t('stats.tab.shots.reachable')} rows={par5Rows} s={s} first />
        </SectionCard>
      ) : null}

      {(shots.hasData || puttingTargetRows.length) ? (
        <SectionCard title={t('stats.tab.shots.puttingVsTarget')} infoKey="sgPutting" onInfo={onInfo}>
          {shots.hasData ? (
            <ShotRowsBlock title={t('stats.tab.shots.aggregatePutting')} rows={puttingVolumeRows} s={s} first />
          ) : null}

          {puttingTargetRows.length ? (
            <ShotRowsBlock
              title={t('stats.tab.shots.distancePuttingSg')}
              rows={puttingTargetRows}
              s={s}
              first={!shots.hasData}
            />
          ) : null}
        </SectionCard>
      ) : null}

    </View>
  );
}

// Cap for a row whose relative bar group has no comparable sibling: a
// deliberate two-thirds bar, never a misleading full one (mirrors
// BreakdownTab's SOLO_COUNT_RATIO).
const SOLO_BAR_RATIO = 2 / 3;

// One detail block rendered as magnitude rows (BreakdownRow). Bars scale per
// each row's `barGroup` tag, computed within THIS block only:
// - 'pct' — absolute: width = value / 100, comparable across the whole tab.
// - anything else ('avg' / 'count' / 'sg' / 'dist') — relative to the
//   block's max |magnitude| among same-tagged rows; a genuinely solo row
//   caps at SOLO_BAR_RATIO.
// Dim (no-data) rows keep the em-dash + an empty track — no data isn't
// zero — and don't count toward a group's max or solo-ness. Rows without a
// numeric magnitude render without a track entirely. `rowIndex` staggers
// the fill sweep within the block (BreakdownRow's Emil-rule motion).
function ShotRowsBlock({ title, rows, s, first = false }) {
  const groups = {};
  rows.forEach((row) => {
    if (row.dim || !isNumber(row.magnitude)) return;
    const tag = row.barGroup;
    if (!tag || tag === 'pct') return; // absolute scale
    const entry = groups[tag] ?? { scale: 0, size: 0 };
    entry.scale = Math.max(
      entry.scale,
      Math.abs(row.magnitude),
      isNumber(row.target) ? Math.abs(row.target) : 0
    );
    entry.size += 1;
    groups[tag] = entry;
  });
  return (
    <View style={[s.detailBlock, first && s.detailBlockFirst]}>
      <View style={s.detailHead}>
        <View style={s.detailDot} />
        <Text style={s.detailTitle}>{title}</Text>
      </View>
      <View>
        {rows.map(({
          key, magnitude, barGroup, target, raw, sample, bucket, greenRate, threePuttRate, ...row
        }, index) => (
          <BreakdownRow
            key={key}
            {...row}
            first={index === 0}
            rowIndex={index}
            testID={`shots-bar-${key}`}
            barRatio={shotBarRatio({ magnitude, barGroup, target, dim: row.dim }, groups)}
            targetRatio={shotTargetRatio({ magnitude, barGroup, target, dim: row.dim }, groups)}
          />
        ))}
      </View>
    </View>
  );
}

function shotBarRatio({
  magnitude, barGroup, target, dim,
}, groups) {
  if (!isNumber(magnitude)) return undefined;
  const size = Math.abs(magnitude);
  if (barGroup === 'pct') return clamp01(size / 100);
  const entry = groups[barGroup];
  if (!entry || entry.scale <= 0) return 0;
  if (entry.size === 1 && !dim && !isNumber(target)) return SOLO_BAR_RATIO;
  return clamp01(size / entry.scale);
}

// Tick position on the SAME scale as shotBarRatio. Only benchmark rows with a
// finite, non-zero target get a tick; 'sg' bucket bars diverge from a zero
// origin (no useful tick), and dim rows never show one.
function shotTargetRatio({
  magnitude, barGroup, target, dim,
}, groups) {
  if (dim || barGroup === 'sg') return undefined;
  if (!isNumber(magnitude) || !isNumber(target) || target === 0) return undefined;
  const size = Math.abs(target);
  if (barGroup === 'pct') return clamp01(size / 100);
  const entry = groups[barGroup];
  if (!entry || entry.scale <= 0) return undefined;
  return clamp01(size / entry.scale);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function makeScoringRows(stats, shotBenchmark) {
  const rows = [];
  // GROSS vs-par mix — the benchmark tables are gross scoring data, so the
  // net `distribution` (whose birdie counts inflate with handicap) must not
  // feed these rows. BreakdownTab/roundReportCard keep using the net field.
  const distribution = stats?.distributionGross ?? {};
  const total = distribution.total ?? Object
    .values(distribution)
    .filter(isNumber)
    .reduce((sum, value) => sum + value, 0);
  const parType = stats?.parType ?? {};

  [
    ['par3AvgScore', t('stats.tab.shots.par3Avg'), parType.par3, shotBenchmark.par3AvgScore],
    ['par4AvgScore', t('stats.tab.shots.par4Avg'), parType.par4, shotBenchmark.par4AvgScore],
    ['par5AvgScore', t('stats.tab.shots.par5Avg'), parType.par5, shotBenchmark.par5AvgScore],
  ].forEach(([key, label, row, target]) => {
    if (!row || row.holes === 0 || !isNumber(row.avgStrokes)) return;
    rows.push({
      key,
      label,
      value: formatBenchmarkNumber(row.avgStrokes),
      magnitude: row.avgStrokes,
      target,
      barGroup: 'avg',
      secondary: targetSecondary([
        sampleText(row.holes, 'holes'),
        targetText(formatBenchmarkNumber(target)),
      ], row.holes, 6),
      tone: toneFromComparison({
        value: row.avgStrokes,
        target,
        polarity: 'lower',
        tolerance: 0.15,
        sample: row.holes,
        minSample: 6,
      }),
    });
  });

  if (total > 0) {
    rows.push(
      scoringCountRow({
        key: 'birdiesPerRound',
        label: t('stats.tab.shots.birdiesPerRound'),
        count: (distribution.eagles ?? 0) + (distribution.birdies ?? 0),
        total,
        target: shotBenchmark.birdiesPerRound,
        polarity: 'higher',
      }),
      scoringCountRow({
        key: 'parsPerRound',
        label: t('stats.tab.shots.parsPerRound'),
        count: distribution.pars ?? 0,
        total,
        target: shotBenchmark.parsPerRound,
        polarity: 'higher',
      }),
      scoringCountRow({
        key: 'bogeysPerRound',
        label: t('stats.tab.shots.bogeysPerRound'),
        count: distribution.bogeys ?? 0,
        total,
        target: shotBenchmark.bogeysPerRound,
        polarity: 'lower',
      }),
      scoringCountRow({
        key: 'doublesOrWorsePerRound',
        label: t('stats.tab.shots.doublesPerRound'),
        count: (distribution.doubles ?? 0) + (distribution.worse ?? 0),
        total,
        target: shotBenchmark.doublesOrWorsePerRound,
        polarity: 'lower',
      })
    );
  }

  return rows.filter(Boolean);
}

function scoringCountRow({
  key, label, count, total, target, polarity,
}) {
  const value = per18(count, total);
  return {
    key,
    label,
    value: formatBenchmarkNumber(value),
    magnitude: isNumber(value) ? value : null,
    target,
    barGroup: 'count',
    secondary: targetSecondary([
      t('stats.tab.total', { count }),
      sampleText(total, 'holes'),
      targetText(formatBenchmarkNumber(target)),
    ], total, 18),
    tone: toneFromComparison({
      value,
      target,
      polarity,
      tolerance: 0.2,
      sample: total,
      minSample: 18,
    }),
  };
}

function makeScoringSummary(scoringRows) {
  const byKey = new Map(scoringRows.map((row) => [row.key, row]));
  const priority = [
    ['par3AvgScore', t('stats.tab.par3')],
    ['par4AvgScore', t('stats.tab.par4')],
    ['par5AvgScore', t('stats.tab.par5')],
    ['doublesOrWorsePerRound', t('stats.tab.shots.damageControl')],
  ];
  const summary = priority
    .map(([key, label]) => {
      const row = byKey.get(key);
      if (!row) return null;
      return summaryMetric(label, row);
    })
    .filter(Boolean);

  if (summary.length >= 3) return summary;

  scoringRows.forEach((row) => {
    if (summary.length >= 3) return;
    if (priority.some(([key]) => key === row.key)) return;
    summary.push(summaryMetric(row.label, row));
  });

  return summary;
}

function makeDrivingTargetRows(shots, shotBenchmark, driveDistance, units) {
  const recorded = shots?.drives?.recorded ?? 0;
  const distribution = shots?.drives?.distribution ?? {};
  const leftPct = percentage(distribution.left ?? 0, recorded);
  const rightPct = percentage(distribution.right ?? 0, recorded);
  // Numerator and denominator share the same drive-logged, non-par-3 hole
  // population — shots.penalties.tee includes penalties from holes outside
  // that population (e.g. par 3s), which would otherwise inflate the %.
  const teePenaltyPct = percentage(shots?.penalties?.teeOnDriveHoles ?? 0, recorded);

  return [
    {
      key: 'fairways',
      label: t('stats.tab.shots.fairwaysHit'),
      value: `${shots?.drives?.fairwayPct ?? 0}%`,
      magnitude: shots?.drives?.fairwayPct ?? 0,
      target: shotBenchmark.fairwayPct,
      barGroup: 'pct',
      secondary: targetSecondary([
        sampleText(recorded, 'drives'),
        targetText(formatBenchmarkPercent(shotBenchmark.fairwayPct)),
      ], recorded, 6),
      tone: toneFromComparison({
        value: shots?.drives?.fairwayPct,
        target: shotBenchmark.fairwayPct,
        polarity: 'higher',
        tolerance: 2,
        sample: recorded,
        minSample: 6,
      }),
      dim: recorded === 0,
    },
    {
      key: 'leftMissPct',
      label: t('stats.tab.shots.leftMissPct'),
      value: `${leftPct}%`,
      magnitude: leftPct,
      target: shotBenchmark.leftMissPct,
      barGroup: 'pct',
      secondary: targetSecondary([
        sampleText(distribution.left ?? 0, 'drives'),
        targetText(formatBenchmarkPercent(shotBenchmark.leftMissPct)),
      ], recorded, 6),
      tone: toneFromComparison({
        value: leftPct,
        target: shotBenchmark.leftMissPct,
        polarity: 'lower',
        tolerance: 2,
        sample: recorded,
        minSample: 6,
      }),
      dim: recorded === 0 || !shots?.drives?.distribution,
    },
    {
      key: 'rightMissPct',
      label: t('stats.tab.shots.rightMissPct'),
      value: `${rightPct}%`,
      magnitude: rightPct,
      target: shotBenchmark.rightMissPct,
      barGroup: 'pct',
      secondary: targetSecondary([
        sampleText(distribution.right ?? 0, 'drives'),
        targetText(formatBenchmarkPercent(shotBenchmark.rightMissPct)),
      ], recorded, 6),
      tone: toneFromComparison({
        value: rightPct,
        target: shotBenchmark.rightMissPct,
        polarity: 'lower',
        tolerance: 2,
        sample: recorded,
        minSample: 6,
      }),
      dim: recorded === 0 || !shots?.drives?.distribution,
    },
    {
      key: 'teePenaltyPct',
      label: t('stats.tab.shots.teePenaltyPct'),
      value: `${teePenaltyPct}%`,
      magnitude: teePenaltyPct,
      target: shotBenchmark.teePenaltyPct,
      barGroup: 'pct',
      secondary: targetSecondary([
        sampleText(shots?.penalties?.teeOnDriveHoles ?? 0, 'penalties'),
        targetText(formatBenchmarkPercent(shotBenchmark.teePenaltyPct)),
      ], recorded, 6),
      tone: toneFromComparison({
        value: teePenaltyPct,
        target: shotBenchmark.teePenaltyPct,
        polarity: 'lower',
        tolerance: 1,
        sample: recorded,
        minSample: 6,
      }),
      dim: recorded === 0,
    },
    driveDistance?.drives > 0 ? {
      key: 'driveDistance',
      label: t('stats.tab.shots.driverDistance'),
      value: `~${formatDistance(driveDistance.avgDistance, units)} ${unitSuffix(units)}`,
      magnitude: driveDistance.avgDistance,
      target: Math.round(shotBenchmark.driverDistance * YD_TO_M),
      barGroup: 'dist',
      secondary: targetSecondary([
        sampleText(driveDistance.drives, 'drives'),
        t('stats.tab.shots.targetApprox', {
          value: `${formatDistance(Math.round(shotBenchmark.driverDistance * YD_TO_M), units)} ${unitSuffix(units)}`,
        }),
      ], driveDistance.drives, 6),
      tone: toneFromComparison({
        value: driveDistance.avgDistance,
        target: Math.round(shotBenchmark.driverDistance * YD_TO_M),
        polarity: 'higher',
        tolerance: 10,
        sample: driveDistance.drives,
        minSample: 6,
      }),
      dim: false,
    } : {
      key: 'driveDistance',
      label: t('stats.tab.shots.driverDistance'),
      value: '—',
      magnitude: 0,
      target: Math.round(shotBenchmark.driverDistance * YD_TO_M),
      barGroup: 'dist',
      secondary: targetSecondary([
        t('stats.tab.shots.targetApprox', {
          value: `${formatDistance(Math.round(shotBenchmark.driverDistance * YD_TO_M), units)} ${unitSuffix(units)}`,
        }),
        t('stats.tab.shots.logDriveDistance'),
      ], 0, 6),
      tone: 'neutral',
      dim: true,
    },
  ];
}

function makeApproachTargetRows(approachTarget) {
  return APPROACH_BUCKETS.map((bucket) => {
    const row = approachTarget.buckets[bucket];
    if (!row || row.holes === 0) return null;
    return {
      key: bucket,
      bucket,
      label: t('stats.tab.approachesAt', { bucket }),
      value: row.yourStrokes != null
        ? t('stats.tab.shots.youApprox', { value: formatLocaleNumber(row.yourStrokes) })
        : signed(row.avgSg),
      raw: row.avgSg,
      // Bars normalize within the bucket group by |SG| max; the tone
      // (positive good/green, negative bad/red) colors the fill.
      magnitude: isNumber(row.avgSg) ? row.avgSg : null,
      barGroup: 'sg',
      secondary: targetSecondary([
        row.targetStrokes != null
          ? t('stats.tab.shots.targetStrokes', { value: formatLocaleNumber(row.targetStrokes) })
          : null,
        t('stats.tab.shots.greenRate', { value: formatPercent(row.greenRate ?? row.girRate) }),
        sampleText(row.holes, 'shots'),
      ].filter(Boolean), row.holes, 6),
      sample: row.holes,
      greenRate: row.greenRate ?? row.girRate,
      tone: toneFromSigned(row.avgSg, { sample: row.holes, minSample: 6 }),
    };
  }).filter(Boolean);
}

// Miss-tendency rows: green-hit rate, the short/long/left/right split among
// directional misses, and the greenside-bunker rate. Descriptive (no
// benchmark target) — bars use the absolute 'pct' scale and stay neutral in
// tone, since a miss direction is a pattern to learn from, not good/bad.
function makeApproachTendencyRows(tend) {
  const rows = [];
  const pctRow = (key, label, value, secondary) => ({
    key,
    label,
    value: value == null ? '—' : `${value}%`,
    magnitude: isNumber(value) ? value : null,
    barGroup: 'pct',
    secondary,
    tone: 'neutral',
    dim: value == null,
  });

  rows.push(pctRow(
    'greensHit', t('stats.tab.shots.greensHit'), tend.greenRate,
    t('stats.tab.shots.greensOfAttempts', { greens: tend.greens, attempts: tend.attempts }),
  ));

  if (tend.directionKnown > 0) {
    const dir = tend.byDirection;
    [
      ['missShort', t('stats.tab.shots.missedShort'), tend.shortRate, dir.short],
      ['missLong', t('stats.tab.shots.missedLong'), tend.longRate, dir.long],
      ['missLeft', t('stats.tab.shots.missedLeft'), tend.leftRate, dir.left],
      ['missRight', t('stats.tab.shots.missedRight'), tend.rightRate, dir.right],
    ].forEach(([key, label, value, count]) => {
      rows.push(pctRow(key, label, value, t('stats.tab.shots.directionalMisses', { count, total: tend.directionKnown })));
    });
  }

  if (tend.misses > 0) {
    rows.push(pctRow(
      'missBunker', t('stats.tab.shots.intoBunker'), tend.bunkerRate,
      t('stats.tab.shots.bunkerOfMisses', { count: tend.bunker, total: tend.misses }),
    ));
  }

  return rows;
}

// Strokes gained vs the average of the other scorers in the same rounds.
// Descriptive delta (signed SG); tone greens a positive gap, reds a negative.
function makeGroupRows(sg) {
  const CATS = [
    ['total', t('stats.tab.shots.group.total')],
    ['offTheTee', t('stats.tab.shots.group.offTheTee')],
    ['approach', t('stats.tab.shots.group.approach')],
    ['aroundGreen', t('stats.tab.shots.group.aroundGreen')],
    ['putting', t('stats.tab.shots.group.putting')],
  ];
  return CATS.map(([key, label]) => {
    const c = sg.categories?.[key];
    if (!c || c.rounds === 0 || !isNumber(c.delta)) return null;
    return {
      key: `grp-${key}`,
      label,
      value: signed(c.delta),
      raw: c.delta,
      magnitude: c.delta,
      barGroup: 'sg',
      secondary: t('stats.tab.shots.youVsGroup', {
        you: signed(c.you), group: signed(c.group), sample: sampleText(c.rounds, 'rounds'),
      }),
      sample: c.rounds,
      tone: toneFromSigned(c.delta, { sample: c.rounds, minSample: 3 }),
    };
  }).filter(Boolean);
}

// What each approach finish actually costs — avg Stableford points, with the
// strokes-vs-par in the subtext. Neutral tone (it's a diagnostic, not a grade).
function makeApproachCostRows(cost) {
  const FIN = [
    ['green', t('stats.tab.shots.finish.green')], ['short', t('stats.tab.shots.finish.short')],
    ['long', t('stats.tab.shots.finish.long')], ['left', t('stats.tab.shots.finish.left')],
    ['right', t('stats.tab.shots.finish.right')], ['bunker', t('stats.tab.shots.finish.bunker')],
  ];
  return FIN.map(([key, label]) => {
    const e = cost.byFinish?.[key];
    if (!e || e.holes === 0) return null;
    return {
      key: `cost-${key}`,
      label,
      value: e.avgPoints == null ? '—' : t('stats.tab.pts', { value: formatLocaleNumber(e.avgPoints) }),
      magnitude: isNumber(e.avgPoints) ? e.avgPoints : null,
      barGroup: 'avg',
      secondary: `${t('stats.tab.vsPar', { value: signed(e.avgVsPar) })} · ${sampleText(e.holes, 'holes')}`,
      tone: 'neutral',
      dim: e.avgPoints == null,
    };
  }).filter(Boolean);
}

// Miss pattern split by approach distance — surfaces the classic "long
// approaches leak short" under-club tell.
function makeApproachByDistanceRows(abd) {
  return APPROACH_BUCKETS.map((bucket) => {
    const e = abd.buckets?.[bucket];
    if (!e || e.attempts === 0) return null;
    const parts = [];
    if (isNumber(e.shortRate)) parts.push(t('stats.tab.shots.shortPct', { value: e.shortRate }));
    if (isNumber(e.longRate)) parts.push(t('stats.tab.shots.longPct', { value: e.longRate }));
    if (isNumber(e.bunkerRate)) parts.push(t('stats.tab.shots.bunkerPct', { value: e.bunkerRate }));
    return {
      key: `abd-${bucket}`,
      label: t('stats.tab.shots.bucketMetres', { bucket }),
      value: e.missRate == null ? '—' : t('stats.tab.shots.missRate', { value: e.missRate }),
      magnitude: isNumber(e.missRate) ? e.missRate : null,
      barGroup: 'pct',
      secondary: [sampleText(e.attempts, 'approaches'), ...parts].filter(Boolean).join(' · '),
      tone: 'neutral',
      dim: e.missRate == null,
    };
  }).filter(Boolean);
}

// Fairway rate per club hit off the tee — the "less driver?" diagnostic.
const TEE_CLUB_KEY = {
  driver: 'stats.tab.shots.club.driver',
  wood: 'stats.tab.shots.club.wood',
  hybrid: 'stats.tab.shots.club.hybrid',
  iron: 'stats.tab.shots.club.iron',
};
function makeTeeClubRows(acc) {
  return (acc.order || []).map((club) => {
    const e = acc.byClub?.[club];
    if (!e || e.holes === 0) return null;
    return {
      key: `tc-${club}`,
      label: TEE_CLUB_KEY[club] ? t(TEE_CLUB_KEY[club]) : club,
      value: e.fairwayPct == null ? '—' : `${e.fairwayPct}%`,
      magnitude: isNumber(e.fairwayPct) ? e.fairwayPct : null,
      barGroup: 'pct',
      secondary: [
        t('stats.tab.shots.penaltyPct', { value: e.penaltyPct ?? 0 }),
        t('stats.tab.vsPar', { value: signed(e.avgVsPar) }),
        sampleText(e.holes, 'drives'),
      ].join(' · '),
      tone: 'neutral',
      dim: e.fairwayPct == null,
    };
  }).filter(Boolean);
}

// GPS-measured carry per club (longest first) — real distance, no bucket guess.
function makeRealDistanceRows(rcd, units) {
  return (rcd.rows || []).map((r) => ({
    key: `rcd-${r.club}`,
    label: r.label,
    value: `~${formatDistance(r.avg, units)} ${unitSuffix(units)}`,
    magnitude: r.avg,
    barGroup: 'dist',
    secondary: sampleText(r.count, 'shots'),
    tone: 'neutral',
  }));
}

// Save rate on missed greens, split by where the approach finished.
function makeScramblingRows(scr) {
  const TYPES = [
    ['short', t('stats.tab.shots.finish.short')], ['long', t('stats.tab.shots.finish.long')],
    ['left', t('stats.tab.shots.finish.left')], ['right', t('stats.tab.shots.finish.right')],
    ['bunker', t('stats.tab.shots.finish.bunker')],
  ];
  return TYPES.map(([key, label]) => {
    const e = scr.byType?.[key];
    if (!e || e.attempts === 0) return null;
    return {
      key: `scr-${key}`,
      label,
      value: e.rate == null ? '—' : `${e.rate}%`,
      magnitude: isNumber(e.rate) ? e.rate : null,
      barGroup: 'pct',
      secondary: t('stats.tab.shots.saved', { saves: e.saves, attempts: e.attempts }),
      tone: 'neutral',
      dim: e.rate == null,
    };
  }).filter(Boolean);
}

// Reachable-hole scoring: birdie-or-better rate, avg vs par, on-in-reg (in 3).
function makePar5Rows(p5) {
  return [
    {
      key: 'p5-birdie',
      label: t('stats.tab.shots.birdieOrBetter'),
      value: p5.birdieRate == null ? '—' : `${p5.birdieRate}%`,
      magnitude: isNumber(p5.birdieRate) ? p5.birdieRate : null,
      barGroup: 'pct',
      secondary: t('stats.tab.shots.countOfSample', {
        count: p5.eaglesPlus + p5.birdies, sample: sampleText(p5.holes, 'par5s'),
      }),
      tone: 'neutral',
      dim: p5.birdieRate == null,
    },
    {
      key: 'p5-vspar',
      label: t('stats.tab.shots.avgVsPar'),
      value: signed(p5.avgVsPar),
      magnitude: isNumber(p5.avgVsPar) ? p5.avgVsPar : null,
      barGroup: 'avg',
      secondary: sampleText(p5.holes, 'par5s'),
      tone: 'neutral',
      dim: p5.avgVsPar == null,
    },
    {
      key: 'p5-gir',
      label: t('stats.tab.shots.onInReg'),
      value: p5.girRate == null ? '—' : `${p5.girRate}%`,
      magnitude: isNumber(p5.girRate) ? p5.girRate : null,
      barGroup: 'pct',
      secondary: t('stats.tab.shots.reachedInThree'),
      tone: 'neutral',
      dim: p5.girRate == null,
    },
  ];
}

function makeGirRows(shots, shotBenchmark) {
  return [
    {
      key: 'gir',
      label: t('stats.tab.shots.girPct'),
      value: `${shots.gir.pct}%`,
      magnitude: shots.gir.pct,
      target: shotBenchmark.girPct,
      barGroup: 'pct',
      secondary: targetSecondary([
        sampleText(shots.gir.eligible, 'holes'),
        targetText(formatBenchmarkPercent(shotBenchmark.girPct)),
      ], shots.gir.eligible, 6),
      tone: toneFromComparison({
        value: shots.gir.pct,
        target: shotBenchmark.girPct,
        polarity: 'higher',
        tolerance: 2,
        sample: shots.gir.eligible,
        minSample: 6,
      }),
      dim: shots.gir.eligible === 0,
    },
  ];
}

function makePuttingVolumeRows(shots, shotBenchmark) {
  // Both rows normalize off holes that actually logged putts, to an
  // 18-hole rate — dividing a partial round's raw total by "rounds" instead
  // understates it against a full-round benchmark.
  const puttsPer18 = shots.putts.per18 ?? 0;
  const threePuttsPer18 = per18(shots.putts.threePuttPlus, shots.putts.holes) ?? 0;
  return [
    {
      key: 'puttsPerRound',
      label: t('stats.tab.puttsPerRound'),
      value: formatLocaleNumber(puttsPer18),
      magnitude: puttsPer18,
      target: shotBenchmark.puttsPerRound,
      barGroup: 'count',
      secondary: targetSecondary([
        sampleText(shots.putts.holes, 'holes'),
        t('stats.tab.shots.targetPer18', { value: formatBenchmarkNumber(shotBenchmark.puttsPerRound) }),
      ], shots.putts.holes, 9),
      tone: toneFromComparison({
        value: puttsPer18,
        target: shotBenchmark.puttsPerRound,
        polarity: 'lower',
        tolerance: 0.5,
        sample: shots.putts.holes,
        minSample: 9,
      }),
      dim: shots.putts.holes === 0,
    },
    {
      key: 'threePutts',
      label: t('stats.tab.threePuttsPerRound'),
      value: formatLocaleNumber(threePuttsPer18),
      magnitude: threePuttsPer18,
      target: shotBenchmark.threePuttsPerRound,
      barGroup: 'count',
      secondary: targetSecondary([
        t('stats.tab.total', { count: shots.putts.threePuttPlus }),
        // The value is normalized off logged holes to an 18-hole rate, so
        // the sample shown is holes (the actual basis), not raw rounds.
        sampleText(shots.putts.holes, 'holes'),
        t('stats.tab.shots.targetPer18', { value: formatBenchmarkNumber(shotBenchmark.threePuttsPerRound) }),
      ], shots.putts.holes, 9),
      tone: toneFromComparison({
        value: threePuttsPer18,
        target: shotBenchmark.threePuttsPerRound,
        polarity: 'lower',
        tolerance: 0.3,
        sample: shots.putts.holes,
        minSample: 9,
      }),
      dim: shots.putts.holes === 0,
    },
  ];
}

function makePuttingTargetRows(puttingTarget) {
  return PUTT_BUCKETS.map((bucket) => {
    const row = puttingTarget.buckets[bucket];
    if (!row || row.attempts === 0) return null;
    return {
      key: bucket,
      bucket,
      label: t('stats.tab.shots.puttsAt', { bucket }),
      value: signed(row.sgPerPutt),
      raw: row.sgPerPutt,
      // Same bucket-group |SG| normalization as the approach buckets.
      magnitude: isNumber(row.sgPerPutt) ? row.sgPerPutt : null,
      barGroup: 'sg',
      secondary: targetSecondary([
        t('stats.tab.shots.avgVsExpected', {
          avg: formatNumber(row.avgPutts), expected: formatNumber(row.expectedPutts),
        }),
        t('stats.tab.shots.threePuttRate', { value: formatPercent(row.threePuttRate) }),
        sampleText(row.attempts, 'putts'),
      ], row.attempts, 6),
      sample: row.attempts,
      threePuttRate: row.threePuttRate,
      tone: toneFromSigned(row.sgPerPutt, { sample: row.attempts, minSample: 6 }),
    };
  }).filter(Boolean);
}

// Meter item for the Scoring-vs-target block: the row's display strings
// plus the numeric value/target pair TargetMeterRow scales its track from.
// The meta keeps only the sample portion of the row's secondary (e.g.
// "24 holes") — the meter and its "target n" line already say the rest.
function summaryMetric(label, row) {
  return {
    key: row.key,
    label,
    value: row.value ?? '-',
    meta: meterMeta(row.secondary),
    tone: row.tone,
    numericValue: isNumber(row.magnitude) ? row.magnitude : null,
    target: isNumber(row.target) ? row.target : null,
    targetDisplay: isNumber(row.target) ? formatBenchmarkNumber(row.target) : null,
  };
}

function meterMeta(secondary) {
  if (!secondary) return t('stats.tab.noSample');
  const targetWord = t('stats.tab.shots.targetWord');
  const parts = secondary
    .split(' · ')
    .filter((part) => part !== t('stats.tab.shots.targetBasis') && !part.startsWith(`${targetWord} `));
  return parts.join(' · ') || null;
}

function targetSecondary(parts, sample, minSample) {
  return comparisonMeta(t('stats.tab.shots.targetBasis'), parts, { sample, minSample });
}

function formatPercent(value) {
  return value == null ? '-' : `${formatLocaleNumber(value)}%`;
}

function formatBenchmarkPercent(value) {
  if (!isNumber(value)) return '-';
  return `${formatLocaleNumber(Math.round(value))}%`;
}

function formatBenchmarkNumber(value) {
  if (!isNumber(value)) return '-';
  return formatLocaleNumber(value, { decimals: Number.isInteger(value) ? 0 : 1 });
}

function formatNumber(value) {
  return value == null ? '-' : formatLocaleNumber(value);
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function per18(count, total) {
  if (!isNumber(count) || !isNumber(total) || total <= 0) return null;
  return round1((count / total) * 18);
}

function percentage(count, total) {
  if (!isNumber(count) || !isNumber(total) || total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    targetBlock: {
      paddingTop: theme.spacing.xs,
    },
    // Overline heading for the target-meter block (Clubhouse token, accent
    // ink — sibling of mixOverline below).
    targetOverline: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.accent.primary,
      marginBottom: 2,
    },
    detailBlock: {
      paddingTop: theme.spacing.md,
      marginTop: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
      gap: theme.spacing.sm,
    },
    detailBlockFirst: {
      paddingTop: theme.spacing.md,
      marginTop: 0,
      borderTopWidth: 0,
    },
    detailHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
    },
    detailDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.accent.primary,
    },
    detailTitle: {
      ...theme.typography.subhead,
      color: theme.text.primary,
      fontWeight: '800',
    },
    // Small overline heading for the score-mix block (Clubhouse token:
    // 9.5-10px, letterSpacing 1.2+, uppercase, muted).
    mixOverline: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.text.muted,
      marginBottom: 2,
    },
  });
}

const NUDGE_KEY = 'sgTargetNudgeDismissed';

function SGTargetNudge({ onTap }) {
  const tl = useT();
  const { theme } = useTheme();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NUDGE_KEY).then((v) => {
      if (!cancelled) setDismissed(v === '1');
    });
    return () => { cancelled = true; };
  }, []);
  if (dismissed) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 10,
      backgroundColor: theme.bg.subtle ?? theme.bg.card, borderRadius: 8,
    }}>
      <PressableScale onPress={onTap} style={{ flex: 1 }}>
        <Text style={{ color: theme.text.primary, fontSize: 13 }}>
          {tl('stats.tab.shots.nudge')}
        </Text>
      </PressableScale>
      <PressableScale
        onPress={async () => {
          await AsyncStorage.setItem(NUDGE_KEY, '1');
          setDismissed(true);
        }}
        hitSlop={8}
        style={{ paddingHorizontal: 8 }}
      >
        <Text style={{ color: theme.text.secondary, fontSize: 16 }}>×</Text>
      </PressableScale>
    </View>
  );
}

export default React.memo(ShotsTab);
