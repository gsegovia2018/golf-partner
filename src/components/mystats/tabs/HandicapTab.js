import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';
import { computeHandicapIndex, handicapIndexSeries, MIN_DIFFERENTIALS } from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';

// "12 May" — short date for a differential row.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const fmt1 = (n) => n.toFixed(1);

export default function HandicapTab({
  myRounds, profileHandicap, onInfo, onApplied, excludedKeys, onToggleExcluded,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const result = useMemo(
    () => computeHandicapIndex(myRounds, { excludedKeys }),
    [myRounds, excludedKeys],
  );
  const series = useMemo(
    () => handicapIndexSeries(myRounds, { excludedKeys }),
    [myRounds, excludedKeys],
  );
  const chartSeries = useMemo(
    () => series.map((p) => ({ label: fmtDate(p.date), value: p.value })),
    [series],
  );
  const [applyState, setApplyState] = useState('idle'); // idle | saving | done | error

  // Profile writes clamp at 0 — the profile validator rejects plus (negative)
  // indexes. The hero still displays the true value.
  const applyValue = result.index == null ? null : Math.max(0, result.index);
  const isPlus = result.index != null && result.index < 0;

  const onApply = async () => {
    if (applyValue == null || applyState === 'saving') return;
    setApplyState('saving');
    try {
      await upsertProfile({ handicap: applyValue });
      setApplyState('done');
      onApplied?.(applyValue);
    } catch (_) {
      setApplyState('error');
    }
  };

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    return (
      <View style={s.wrap}>
        <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
          <Text style={s.emptyTitle}>Not enough qualifying rounds yet</Text>
          <Text style={s.note}>
            {`You need ${MIN_DIFFERENTIALS} qualifying rounds to calculate an index — ${missing} more to go. `}
            {'A round qualifies when it is a complete 18-hole round (no scrambles) on a tee with a slope and course rating.'}
          </Text>
        </SectionCard>
      </View>
    );
  }

  const evolutionCard = chartSeries.length >= 2 ? (
    <SectionCard title="Index evolution" infoKey="handicapIndex" onInfo={onInfo}>
      <TrendLineChart
        series={chartSeries}
        color={theme.accent.primary}
        formatValue={fmt1}
        caption="After each qualifying round · oldest → newest"
      />
    </SectionCard>
  ) : null;

  return (
    <View style={s.wrap}>
      <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.hero}>{fmt1(result.index)}</Text>
        <Text style={s.heroSub}>
          {`Best ${result.usedCount} of last ${result.windowCount} differentials`}
        </Text>
        {isPlus && (
          <Text style={s.note}>A negative index means you play better than scratch.</Text>
        )}
        <TouchableOpacity
          style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
          onPress={onApply}
          disabled={applyState === 'saving'}
          accessibilityRole="button"
        >
          <Text style={s.applyText}>
            {applyState === 'done' ? 'Saved to profile ✓' : `Set as my handicap${isPlus ? ' (0.0)' : ''}`}
          </Text>
        </TouchableOpacity>
        {applyState === 'error' && (
          <Text style={s.errorText}>Could not save — try again.</Text>
        )}
        <Text style={s.profileNote}>
          {profileHandicap != null
            ? `Profile handicap today: ${profileHandicap}`
            : 'No handicap on your profile yet.'}
        </Text>
      </SectionCard>

      {evolutionCard}

      <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.caption}>Last {result.windowCount} qualifying rounds · lowest count</Text>
        {[...result.differentials].reverse().map((d) => (
          <View key={d.key} style={[s.row, d.counting && s.rowCounting]}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle} numberOfLines={1}>{d.courseName}</Text>
              <Text style={s.rowSub}>{`${fmtDate(d.date)} · adjusted gross ${d.ags}`}</Text>
            </View>
            <Text style={[s.rowValue, d.counting && s.rowValueCounting]}>
              {fmt1(d.differential)}
            </Text>
          </View>
        ))}
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    hero: { ...theme.typography.display, color: theme.text.primary, textAlign: 'center' },
    heroSub: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center' },
    note: { ...theme.typography.caption, color: theme.text.muted, marginTop: theme.spacing.sm },
    emptyTitle: { ...theme.typography.subhead, color: theme.text.primary },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: theme.spacing.xs },
    applyBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
      alignItems: 'center',
    },
    applyBtnDisabled: { opacity: 0.6 },
    applyText: { ...theme.typography.subhead, color: theme.text.inverse },
    errorText: { ...theme.typography.caption, color: theme.destructive, textAlign: 'center', marginTop: theme.spacing.xs },
    profileNote: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    rowCounting: { backgroundColor: theme.accent.light, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm },
    rowMain: { flex: 1 },
    rowTitle: { ...theme.typography.body, color: theme.text.primary },
    rowSub: { ...theme.typography.tiny, color: theme.text.muted },
    rowValue: { ...theme.typography.subhead, color: theme.text.muted, fontVariant: ['tabular-nums'] },
    rowValueCounting: { color: theme.accent.primary, fontWeight: '700' },
  });
}
