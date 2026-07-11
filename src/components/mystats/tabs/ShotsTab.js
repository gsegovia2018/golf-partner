import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import { shotBenchmarkForHandicap } from '../../../store/shotBenchmarks';
import SectionCard from '../SectionCard';
import ShotDashboard from '../ShotDashboard';
import {
  comparisonMeta,
  toneColor,
  toneFill,
  toneFromComparison,
  toneFromSigned,
} from '../metricTone';
import { APPROACH_BUCKETS, PUTT_BUCKETS, sampleText, signed } from '../shotMetrics';

const TARGET_BASIS = 'vs target hcp';

export default function ShotsTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const shotBenchmark = useMemo(
    () => shotBenchmarkForHandicap(targetHandicap),
    [targetHandicap]
  );
  const {
    shots, puttingTarget, approachTarget,
  } = stats;

  const hasAnyShotData = shots.hasData || puttingTarget?.hasData || approachTarget?.hasData
    || stats?.strokesGained?.total != null || stats?.distributionGross?.total > 0;

  if (!hasAnyShotData) {
    return (
      <View style={s.wrap}>
        <SectionCard title="Strokes Gained">
          <Text style={s.note}>
            Log putts and drives during a round to unlock tee-shot, putting and driving stats.
          </Text>
        </SectionCard>
      </View>
    );
  }

  const scoringRows = makeScoringRows(stats, shotBenchmark);
  const drivingTargetRows = makeDrivingTargetRows(shots, shotBenchmark);
  const approachTargetRows = approachTarget?.hasData ? makeApproachTargetRows(approachTarget) : [];
  const puttingVolumeRows = shots.hasData ? makePuttingVolumeRows(shots, shotBenchmark) : [];
  const puttingTargetRows = puttingTarget?.hasData ? makePuttingTargetRows(puttingTarget) : [];

  return (
    <View style={s.wrap}>
      <ShotDashboard
        stats={stats}
        targetHandicap={targetHandicap}
        onChangeTarget={onChangeTarget}
        onInfo={onInfo}
        TargetNudge={SGTargetNudge}
      />

      {scoringRows.length ? (
        <SectionCard title="Scoring" infoKey="sgScoring" onInfo={onInfo}>
          <ShotSummary
            title="Scoring vs target"
            items={makeScoringSummary(scoringRows)}
            s={s}
            theme={theme}
          />
          <ShotDataBlock title="Scoring mix" s={s} first>
            {scoringRows.map(({ key, ...row }) => (
              <ShotDataRow key={key} {...row} s={s} theme={theme} />
            ))}
          </ShotDataBlock>
        </SectionCard>
      ) : null}

      {drivingTargetRows.length ? (
        <SectionCard title="Driving vs target" infoKey="sgDriving" onInfo={onInfo}>
          <ShotDataBlock title="Driver accuracy" s={s} first>
            {drivingTargetRows.map(({ key, ...row }) => (
              <ShotDataRow key={key} {...row} s={s} theme={theme} />
            ))}
          </ShotDataBlock>
        </SectionCard>
      ) : null}

      {(approachTargetRows.length || shots.hasData) ? (
        <SectionCard title="Approach vs target" infoKey="sgApproach" onInfo={onInfo}>
          {approachTargetRows.length ? (
            <ShotDataBlock title="Approach distance SG" s={s} first>
              {approachTargetRows.map(({ key, ...row }) => (
                <ShotDataRow key={key} {...row} s={s} theme={theme} />
              ))}
            </ShotDataBlock>
          ) : null}

          {shots.hasData ? (
            <ShotDataBlock
              title="GIR volume"
              s={s}
              first={!approachTargetRows.length}
            >
              <ShotDataRow
                label="Greens in reg %"
                value={`${shots.gir.pct}%`}
                secondary={targetSecondary([
                  sampleText(shots.gir.eligible, 'holes'),
                  `target ${formatBenchmarkPercent(shotBenchmark.girPct)}`,
                ], shots.gir.eligible, 6)}
                tone={toneFromComparison({
                  value: shots.gir.pct,
                  target: shotBenchmark.girPct,
                  polarity: 'higher',
                  tolerance: 2,
                  sample: shots.gir.eligible,
                  minSample: 6,
                })}
                dim={shots.gir.eligible === 0}
                s={s}
                theme={theme}
              />
            </ShotDataBlock>
          ) : null}
        </SectionCard>
      ) : null}

      {(shots.hasData || puttingTargetRows.length) ? (
        <SectionCard title="Putting vs target" infoKey="sgPutting" onInfo={onInfo}>
          {shots.hasData ? (
            <ShotDataBlock title="Aggregate putting" s={s} first>
              {puttingVolumeRows.map(({ key, ...row }) => (
                <ShotDataRow key={key} {...row} s={s} theme={theme} />
              ))}
            </ShotDataBlock>
          ) : null}

          {puttingTargetRows.length ? (
            <ShotDataBlock title="Distance putting SG" s={s} first={!shots.hasData}>
              {puttingTargetRows.map(({ key, ...row }) => (
                <ShotDataRow key={key} {...row} s={s} theme={theme} />
              ))}
            </ShotDataBlock>
          ) : null}
        </SectionCard>
      ) : null}

    </View>
  );
}

function ShotSummary({ title, items, s, theme }) {
  return (
    <View style={s.summaryWrap}>
      <View style={s.summaryHead}>
        <Feather name="sliders" size={14} color={theme.text.secondary} />
        <Text style={s.summaryTitle}>{title}</Text>
      </View>
      <View style={s.summaryCells}>
        {items.map((item) => (
          <SummaryCell key={item.label} {...item} s={s} theme={theme} />
        ))}
      </View>
    </View>
  );
}

function SummaryCell({ label, value, meta, tone = 'neutral', s, theme }) {
  const color = toneColor(theme, tone);
  const icon = tone === 'good' ? 'trending-up' : tone === 'bad' ? 'alert-triangle' : 'activity';
  return (
    <View style={s.summaryCell}>
      <View style={[s.summaryIcon, { backgroundColor: toneFill(theme, tone) }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <View style={s.summaryCoachCopy}>
        <Text style={s.summaryLabel} numberOfLines={1}>{label}</Text>
        <Text style={[s.summaryValue, { color }]} numberOfLines={2}>{value}</Text>
        {meta ? <Text style={s.summaryMeta} numberOfLines={2}>{meta}</Text> : null}
      </View>
    </View>
  );
}

function ShotDataBlock({ title, children, s, first = false }) {
  return (
    <View style={[s.detailBlock, first && s.detailBlockFirst]}>
      <View style={s.detailHead}>
        <View style={s.detailDot} />
        <Text style={s.detailTitle}>{title}</Text>
      </View>
      <View style={s.dataRows}>
        {children}
      </View>
    </View>
  );
}

function ShotDataRow({
  label, value, secondary, tone = 'neutral', dim = false, s, theme,
}) {
  const color = dim ? theme.text.muted : toneColor(theme, tone);
  const icon = dim ? 'minus' : tone === 'good' ? 'check' : tone === 'bad' ? 'alert-circle' : 'circle';
  return (
    <View style={[
      s.dataRow,
      tone === 'good' && s.dataRowGood,
      tone === 'bad' && s.dataRowBad,
      tone === 'neutral' && s.dataRowNeutral,
      dim && s.dataRowDim,
    ]}>
      <View style={s.dataLead}>
        <View style={[s.dataMarker, { backgroundColor: toneFill(theme, tone) }]}>
          <Feather name={icon} size={12} color={color} />
        </View>
        <View style={s.dataCopy}>
          <Text style={[s.dataLabel, dim && s.dimText]} numberOfLines={2}>
            {label}
          </Text>
          {secondary ? (
            <Text style={[s.dataSecondary, dim && s.dimText]} numberOfLines={3}>
              {secondary}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[s.dataValuePill, { backgroundColor: toneFill(theme, tone) }]}>
        <Text style={[s.dataValue, { color }]} numberOfLines={2}>
          {dim ? '-' : value}
        </Text>
      </View>
    </View>
  );
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
    ['par3AvgScore', 'Par 3 avg score', parType.par3, shotBenchmark.par3AvgScore],
    ['par4AvgScore', 'Par 4 avg score', parType.par4, shotBenchmark.par4AvgScore],
    ['par5AvgScore', 'Par 5 avg score', parType.par5, shotBenchmark.par5AvgScore],
  ].forEach(([key, label, row, target]) => {
    if (!row || row.holes === 0 || !isNumber(row.avgStrokes)) return;
    rows.push({
      key,
      label,
      value: formatBenchmarkNumber(row.avgStrokes),
      secondary: targetSecondary([
        sampleText(row.holes, 'holes'),
        `target ${formatBenchmarkNumber(target)}`,
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
        label: 'Birdies / round',
        count: (distribution.eagles ?? 0) + (distribution.birdies ?? 0),
        total,
        target: shotBenchmark.birdiesPerRound,
        polarity: 'higher',
      }),
      scoringCountRow({
        key: 'parsPerRound',
        label: 'Pars / round',
        count: distribution.pars ?? 0,
        total,
        target: shotBenchmark.parsPerRound,
        polarity: 'higher',
      }),
      scoringCountRow({
        key: 'bogeysPerRound',
        label: 'Bogeys / round',
        count: distribution.bogeys ?? 0,
        total,
        target: shotBenchmark.bogeysPerRound,
        polarity: 'lower',
      }),
      scoringCountRow({
        key: 'doublesOrWorsePerRound',
        label: 'Doubles+ / round',
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
    secondary: targetSecondary([
      `${count} total`,
      sampleText(total, 'holes'),
      `target ${formatBenchmarkNumber(target)}`,
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
    ['par3AvgScore', 'Par 3s'],
    ['par4AvgScore', 'Par 4s'],
    ['par5AvgScore', 'Par 5s'],
    ['doublesOrWorsePerRound', 'Damage control'],
  ];
  const summary = priority
    .map(([key, label]) => {
      const row = byKey.get(key);
      if (!row) return null;
      return summaryMetric(label, row.value, row.secondary, row.tone);
    })
    .filter(Boolean);

  if (summary.length >= 3) return summary;

  scoringRows.forEach((row) => {
    if (summary.length >= 3) return;
    if (priority.some(([key]) => key === row.key)) return;
    summary.push(summaryMetric(row.label, row.value, row.secondary, row.tone));
  });

  return summary;
}

function makeDrivingTargetRows(shots, shotBenchmark) {
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
      label: 'Fairways hit',
      value: `${shots?.drives?.fairwayPct ?? 0}%`,
      secondary: targetSecondary([
        sampleText(recorded, 'drives'),
        `target ${formatBenchmarkPercent(shotBenchmark.fairwayPct)}`,
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
      label: 'Left miss %',
      value: `${leftPct}%`,
      secondary: targetSecondary([
        `${distribution.left ?? 0} drives`,
        `target ${formatBenchmarkPercent(shotBenchmark.leftMissPct)}`,
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
      label: 'Right miss %',
      value: `${rightPct}%`,
      secondary: targetSecondary([
        `${distribution.right ?? 0} drives`,
        `target ${formatBenchmarkPercent(shotBenchmark.rightMissPct)}`,
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
      label: 'Tee penalty %',
      value: `${teePenaltyPct}%`,
      secondary: targetSecondary([
        `${shots?.penalties?.teeOnDriveHoles ?? 0} penalties`,
        `target ${formatBenchmarkPercent(shotBenchmark.teePenaltyPct)}`,
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
    {
      key: 'driverDistance',
      label: 'Driver distance',
      value: `${formatBenchmarkNumber(shotBenchmark.driverDistance)} yd`,
      secondary: 'target benchmark only · distance not tracked',
      tone: 'neutral',
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
      label: `${bucket} m approaches`,
      value: signed(row.avgSg),
      raw: row.avgSg,
      secondary: targetSecondary([
        `${formatPercent(row.greenRate ?? row.girRate)} green`,
        sampleText(row.holes, 'shots'),
      ], row.holes, 6),
      sample: row.holes,
      greenRate: row.greenRate ?? row.girRate,
      tone: toneFromSigned(row.avgSg, { sample: row.holes, minSample: 6 }),
    };
  }).filter(Boolean);
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
      label: 'Putts / round',
      value: puttsPer18,
      secondary: targetSecondary([
        sampleText(shots.putts.holes, 'holes'),
        `target ${formatBenchmarkNumber(shotBenchmark.puttsPerRound)} / 18 holes`,
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
      label: '3-putts / round',
      value: threePuttsPer18,
      secondary: targetSecondary([
        `${shots.putts.threePuttPlus} total`,
        // The value is normalized off logged holes to an 18-hole rate, so
        // the sample shown is holes (the actual basis), not raw rounds.
        sampleText(shots.putts.holes, 'holes'),
        `target ${formatBenchmarkNumber(shotBenchmark.threePuttsPerRound)} / 18 holes`,
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
      label: `${bucket} m putts`,
      value: signed(row.sgPerPutt),
      raw: row.sgPerPutt,
      secondary: targetSecondary([
        `${formatNumber(row.avgPutts)} avg vs ${formatNumber(row.expectedPutts)} target`,
        `${formatPercent(row.threePuttRate)} 3-putt`,
        sampleText(row.attempts, 'putts'),
      ], row.attempts, 6),
      sample: row.attempts,
      threePuttRate: row.threePuttRate,
      tone: toneFromSigned(row.sgPerPutt, { sample: row.attempts, minSample: 6 }),
    };
  }).filter(Boolean);
}

function summaryMetric(label, value, meta, tone) {
  return {
    label,
    value: value ?? '-',
    meta: meta ?? 'No sample yet',
    tone,
  };
}

function targetSecondary(parts, sample, minSample) {
  return comparisonMeta(TARGET_BASIS, parts, { sample, minSample });
}

function formatPercent(value) {
  return value == null ? '-' : `${value}%`;
}

function formatBenchmarkPercent(value) {
  if (!isNumber(value)) return '-';
  return `${Math.round(value)}%`;
}

function formatBenchmarkNumber(value) {
  if (!isNumber(value)) return '-';
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatNumber(value) {
  return value == null ? '-' : value;
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
  const goodWash = theme.accent.light;
  const badWash = theme.isDark ? 'rgba(248,113,113,0.14)' : '#fff1f2';
  const goodBorder = theme.isDark ? 'rgba(79,174,138,0.28)' : '#c7ddd3';
  const badBorder = theme.isDark ? 'rgba(248,113,113,0.24)' : '#f3c7cf';
  const markerSize = 26;

  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    summaryWrap: {
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.bg.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      gap: theme.spacing.md,
    },
    summaryHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    summaryTitle: {
      ...theme.typography.subhead,
      color: theme.text.primary,
      fontWeight: '800',
    },
    summaryCells: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    summaryCell: {
      flexGrow: 1,
      flexBasis: 250,
      minWidth: 178,
      padding: theme.spacing.md,
      minHeight: 92,
      borderRadius: theme.radius.md,
      backgroundColor: theme.bg.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 2,
    },
    summaryIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.sm,
      flexShrink: 0,
    },
    summaryCoachCopy: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    summaryLabel: {
      ...theme.typography.caption,
      color: theme.text.secondary,
      fontWeight: '700',
      textAlign: 'left',
    },
    summaryValue: {
      ...theme.typography.heading,
      fontWeight: '900',
      textAlign: 'left',
    },
    summaryMeta: {
      ...theme.typography.tiny,
      color: theme.text.secondary,
      textAlign: 'left',
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
    dataRows: {
      gap: 6,
    },
    dataRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      borderRadius: theme.radius.md,
      backgroundColor: theme.bg.card,
    },
    dataRowGood: {
      backgroundColor: goodWash,
      borderColor: goodBorder,
    },
    dataRowBad: {
      backgroundColor: badWash,
      borderColor: badBorder,
    },
    dataRowNeutral: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
    },
    dataValuePill: {
      flexShrink: 0,
      minWidth: 58,
      maxWidth: 136,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radius.pill,
    },
    dataRowDim: {
      opacity: 0.75,
    },
    dataLead: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    dataMarker: {
      width: markerSize,
      height: markerSize,
      borderRadius: markerSize / 2,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dataCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    dataLabel: {
      ...theme.typography.body,
      color: theme.text.primary,
      fontWeight: '700',
    },
    dataSecondary: {
      ...theme.typography.caption,
      color: theme.text.secondary,
    },
    dataValue: {
      ...theme.typography.body,
      flexShrink: 0,
      maxWidth: 132,
      textAlign: 'right',
      fontWeight: '900',
    },
    dimText: {
      color: theme.text.muted,
    },
  });
}

const NUDGE_KEY = 'sgTargetNudgeDismissed';

function SGTargetNudge({ onTap }) {
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
      <TouchableOpacity onPress={onTap} style={{ flex: 1 }}>
        <Text style={{ color: theme.text.primary, fontSize: 13 }}>
          ⓘ Tip: set a target handicap to see where you would improve most.
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await AsyncStorage.setItem(NUDGE_KEY, '1');
          setDismissed(true);
        }}
        hitSlop={8}
        style={{ paddingHorizontal: 8 }}
      >
        <Text style={{ color: theme.text.secondary, fontSize: 16 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}
