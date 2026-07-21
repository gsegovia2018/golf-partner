import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
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

const reasonLabel = (row) => (
  row.reason === 'partial' ? `partial · ${row.holesPlayed} holes`
    : row.reason === 'nine-holes' ? '9-hole round'
      : 'no slope/rating'
);

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
  // Newest-first merged list: the included last-20 window, every excluded
  // round (so it can be re-added), and every ineligible round (so the
  // eligible/total counts are self-explanatory).
  const rows = useMemo(() => {
    const merged = [
      ...result.differentials.map((d) => ({ ...d, type: 'included' })),
      ...result.excluded.map((d) => ({ ...d, type: 'excluded' })),
      ...result.ineligible.map((d) => ({ ...d, type: 'ineligible' })),
    ];
    return merged.sort((a, b) => (
      String(b.date ?? '').localeCompare(String(a.date ?? ''))
        || String(b.key ?? '').localeCompare(String(a.key ?? ''))
    ));
  }, [result]);
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

  const listCard = rows.length > 0 ? (
    <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
      <Text style={s.caption}>{`Newest first · grey rounds don't count`}</Text>
      {rows.map((d) => (
        <View key={d.key} style={[s.row, d.type === 'included' && d.counting && s.rowCounting]}>
          <View style={s.rowMain}>
            <Text
              style={[s.rowTitle, d.type !== 'included' && s.rowTitleMuted]}
              numberOfLines={1}
            >
              {d.courseName}
            </Text>
            <Text style={s.rowSub}>
              {d.type === 'ineligible'
                ? fmtDate(d.date)
                : `${fmtDate(d.date)} · adjusted gross ${d.ags}`}
            </Text>
          </View>
          {d.type === 'ineligible' ? (
            <Text style={s.tag}>{reasonLabel(d)}</Text>
          ) : (
            <>
              {d.type === 'excluded' && <Text style={s.tag}>Excluded</Text>}
              <Text style={[
                s.rowValue,
                d.type === 'included' && d.counting && s.rowValueCounting,
                d.type === 'excluded' && s.rowValueMuted,
              ]}
              >
                {fmt1(d.differential)}
              </Text>
              {onToggleExcluded && (
                <PressableScale
                  onPress={() => onToggleExcluded(d.key)}
                  accessibilityRole="button"
                  accessibilityLabel={d.type === 'excluded'
                    ? 'Include round in handicap'
                    : 'Exclude round from handicap'}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather
                    name={d.type === 'excluded' ? 'plus-circle' : 'minus-circle'}
                    size={18}
                    color={d.type === 'excluded' ? theme.accent.primary : theme.text.muted}
                  />
                </PressableScale>
              )}
            </>
          )}
        </View>
      ))}
    </SectionCard>
  ) : null;

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
          {result.excludedCount > 0 && (
            <Text style={s.note}>
              {`${result.excludedCount} excluded round${result.excludedCount === 1 ? ' is' : 's are'} not counted — add them back below.`}
            </Text>
          )}
        </SectionCard>
        {listCard}
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
          {`Best ${result.usedCount} of last ${result.windowCount} differentials${result.excludedCount > 0 ? ` · ${result.excludedCount} excluded` : ''}`}
        </Text>
        {isPlus && (
          <Text style={s.note}>A negative index means you play better than scratch.</Text>
        )}
        <PressableScale
          style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
          onPress={onApply}
          disabled={applyState === 'saving'}
          accessibilityRole="button"
        >
          <Text style={s.applyText}>
            {applyState === 'done' ? 'Saved to profile ✓' : `Set as my handicap${isPlus ? ' (0.0)' : ''}`}
          </Text>
        </PressableScale>
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
      {listCard}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    hero: { fontSize: 38, lineHeight: 44, fontFamily: 'PlayfairDisplay-Black', color: theme.accent.primary, textAlign: 'left' },
    heroSub: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'left' },
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
    rowTitleMuted: { color: theme.text.muted },
    rowValueMuted: { color: theme.text.muted, opacity: 0.7 },
    tag: {
      ...theme.typography.tiny, color: theme.text.muted,
      borderWidth: 1, borderColor: theme.border.default,
      paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm,
      overflow: 'hidden',
    },
  });
}
