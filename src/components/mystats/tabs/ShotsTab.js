import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import MetricRow from '../MetricRow';
import { SGBar } from '../SGBars';

const DRIVE_ORDER = ['super', 'fairway', 'left', 'right', 'short'];
const DRIVE_LABELS = {
  super: 'Super drives',
  fairway: 'Fairway drives',
  left: 'Left misses',
  right: 'Right misses',
  short: 'Short drives',
};
const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
const PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];

export default function ShotsTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const {
    teeShot, shots, sandSaves, upAndDown, bunkerVisits,
    driveImpact, approachImpact, puttDive, puttingTarget, approachTarget,
  } = stats;

  const hasAnyShotData = teeShot.hasData || shots.hasData
    || driveImpact?.hasData || approachImpact?.hasData
    || puttingTarget?.hasData || approachTarget?.hasData;

  if (!hasAnyShotData) {
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

  const sgTitle = (targetHandicap == null || targetHandicap === 0)
    ? 'Strokes Gained vs scratch'
    : `Strokes Gained vs ${targetHandicap}-handicap target`;

  return (
    <View style={s.wrap}>
      {stats?.strokesGained && (
        <SectionCard
          title={sgTitle}
          infoKey="strokesGained"
          onInfo={onInfo}
          right={
            onChangeTarget ? (
              <TouchableOpacity onPress={onChangeTarget} hitSlop={8}>
                <Feather name="edit-2" size={14} color={theme.text.secondary} />
              </TouchableOpacity>
            ) : null
          }
        >
          {stats.strokesGained.total == null ? (
            <Text style={s.note}>
              Log first-putt distance and approach bucket on a few rounds to see this.
            </Text>
          ) : (
            <>
              <Text style={s.sgHeadline}>
                {stats.strokesGained.total >= 0 ? '+' : ''}
                {stats.strokesGained.total.toFixed(2)} per round
              </Text>
              <Text style={s.sgSubtle}>
                From {stats.strokesGained.sampleHoles} holes · estimated from buckets
              </Text>
              <SGBar label="Off the tee"   value={stats.strokesGained.byCategory?.tee} />
              <SGBar label="Approach"       value={stats.strokesGained.byCategory?.approach} />
              <SGBar label="Around green"   value={stats.strokesGained.byCategory?.aroundGreen} />
              <SGBar label="Putting"        value={stats.strokesGained.byCategory?.putting} />
              {stats.strokesGained.sampleHoles >= 18
                && (targetHandicap == null || targetHandicap === 0)
                && <SGTargetNudge onTap={onChangeTarget} />}
            </>
          )}
        </SectionCard>
      )}

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

      {driveImpact?.hasData ? (
        <SectionCard title="Drive score impact">
          <MetricRow
            label="Worst drive for score"
            value={worstDriveLabel(driveImpact)}
            secondary={worstDriveSecondary(driveImpact)}
          />
          {DRIVE_ORDER.map((bucket) => {
            const row = driveImpact.buckets[bucket];
            if (!row || row.holes === 0) return null;
            return (
              <MetricRow
                key={bucket}
                label={DRIVE_LABELS[bucket]}
                value={`${row.avgPoints} pts`}
                secondary={`${signed(row.avgVsPar)} vs par · ${row.penaltyRate}% pen · ${row.holes} holes`}
              />
            );
          })}
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

      {puttDive?.hasData ? (
        <SectionCard title="Putting detail">
          <MetricRow label="2-putt rate" value={`${puttDive.twoPuttPct}%`} secondary={`${puttDive.holes} holes`} />
          <MetricRow label="Putts on GIR" value={puttDive.girPuttsAvg ?? '—'} secondary={`${puttDive.girHoles} holes`} dim={puttDive.girPuttsAvg == null} />
          <MetricRow label="Putts off GIR" value={puttDive.nonGirPuttsAvg ?? '—'} secondary={`${puttDive.nonGirHoles} holes`} dim={puttDive.nonGirPuttsAvg == null} />
          <MetricRow label="1-putt save" value={`${puttDive.onePuttSave.pct}%`} secondary={`${puttDive.onePuttSave.attempts} chances`} dim={puttDive.onePuttSave.attempts === 0} />
        </SectionCard>
      ) : null}

      {puttingTarget?.hasData ? (
        <SectionCard title="Putting vs target">
          {PUTT_BUCKETS.map((bucket) => {
            const row = puttingTarget.buckets[bucket];
            if (!row || row.attempts === 0) return null;
            return (
              <MetricRow
                key={bucket}
                label={`${bucket} m putts`}
                value={signed(row.sgPerPutt)}
                secondary={`${row.avgPutts} avg vs ${row.expectedPutts} target · ${row.threePuttRate}% 3-putt · ${row.attempts} putts`}
              />
            );
          })}
        </SectionCard>
      ) : null}

      {approachImpact?.hasData ? (
        <SectionCard title="Approach score impact">
          {APPROACH_BUCKETS.map((bucket) => {
            const row = approachImpact.buckets[bucket];
            if (!row || row.holes === 0) return null;
            return (
              <MetricRow
                key={bucket}
                label={`${bucket} m`}
                value={`${row.avgPoints} pts`}
                secondary={`${signed(row.avgVsPar)} vs par · ${row.girRate == null ? '—' : `${row.girRate}%`} GIR · ${row.holes} holes`}
              />
            );
          })}
        </SectionCard>
      ) : null}

      {approachTarget?.hasData ? (
        <SectionCard title="Approach vs target">
          {APPROACH_BUCKETS.map((bucket) => {
            const row = approachTarget.buckets[bucket];
            if (!row || row.holes === 0) return null;
            return (
              <MetricRow
                key={bucket}
                label={`${bucket} m approaches`}
                value={signed(row.avgSg)}
                secondary={`${row.girRate}% GIR · ${row.holes} shots`}
              />
            );
          })}
        </SectionCard>
      ) : null}

      {(sandSaves || upAndDown || bunkerVisits) ? (
        <SectionCard title="Around the green">
          {sandSaves ? (
            <MetricRow
              label="Sand-save rate"
              value={sandSaves.rate != null ? `${sandSaves.saves} of ${sandSaves.attempts} · ${Math.round(sandSaves.rate * 100)}%` : '—'}
              secondary="Scratch ~51%"
              dim={sandSaves.rate == null}
            />
          ) : null}
          {upAndDown ? (
            <MetricRow
              label="Up-and-down rate"
              value={upAndDown.rate != null ? `${upAndDown.conversions} of ${upAndDown.attempts} · ${Math.round(upAndDown.rate * 100)}%` : '—'}
              secondary="Scratch ~60%"
              dim={upAndDown.rate == null}
            />
          ) : null}
          {bunkerVisits ? (
            <MetricRow
              label="Bunker visits"
              value={bunkerVisits.avgPerRound > 0 ? `${bunkerVisits.avgPerRound.toFixed(1)} per round` : '—'}
              secondary={bunkerVisits.holesWithSand != null ? `${bunkerVisits.holesWithSand} holes` : undefined}
              dim={bunkerVisits.avgPerRound === 0}
            />
          ) : null}
        </SectionCard>
      ) : null}
    </View>
  );
}

function signed(value) {
  if (value == null) return '—';
  return value > 0 ? `+${value}` : `${value}`;
}

function driveRows(driveImpact) {
  return DRIVE_ORDER
    .map((bucket) => ({ bucket, label: DRIVE_LABELS[bucket], ...(driveImpact?.buckets?.[bucket] ?? {}) }))
    .filter((row) => row.holes > 0);
}

function worstDriveLabel(driveImpact) {
  const worst = driveRows(driveImpact).sort((a, b) => a.avgPoints - b.avgPoints)[0];
  return worst?.label ?? '—';
}

function worstDriveSecondary(driveImpact) {
  const worst = driveRows(driveImpact).sort((a, b) => a.avgPoints - b.avgPoints)[0];
  return worst ? `${worst.avgPoints} pts · ${worst.holes} holes` : undefined;
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    sgHeadline: { ...theme.typography.title, color: theme.text.primary, marginBottom: theme.spacing.xs },
    sgSubtle: { ...theme.typography.caption, color: theme.text.muted, marginBottom: theme.spacing.sm },
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
          ⓘ Tip: set a target handicap to see where you'd improve most.
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
