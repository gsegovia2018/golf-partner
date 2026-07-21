import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
import Reveal from '../../ui/Reveal';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';
import { computeHandicapIndex, handicapIndexSeries, MIN_DIFFERENTIALS } from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';

// Clubhouse hero surface — same constants as the SG hero in ShotDashboard.js.
const GREEN = '#00553c';
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';
const ERROR_ON_GREEN = '#fca5a5';

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
  const gold = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;

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

  const toggleLabel = (d) => {
    const roundName = `${d.courseName ?? 'round'} ${fmtDate(d.date)}`.trim();
    return d.type === 'excluded'
      ? `Include ${roundName} in handicap`
      : `Exclude ${roundName} from handicap`;
  };

  const listCard = rows.length > 0 ? (
    <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
      <Text style={s.caption}>{`Newest first · dimmed rounds don't count`}</Text>
      {rows.map((d) => (
        <View key={d.key} style={[s.row, d.type === 'excluded' && s.rowExcluded]}>
          <View style={s.rowMain}>
            <Text
              style={[s.rowTitle, d.type === 'ineligible' && s.rowTitleMuted]}
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
            <Text style={s.reason}>{reasonLabel(d)}</Text>
          ) : (
            <>
              {d.type === 'excluded' && <Text style={s.excludedChip}>Excluded</Text>}
              {d.type === 'included' && d.counting && (
                <View style={[s.countDot, { backgroundColor: gold }]} />
              )}
              <Text style={[
                s.rowValue,
                d.type === 'included' && d.counting && s.rowValueCounting,
              ]}
              >
                {fmt1(d.differential)}
              </Text>
              {onToggleExcluded && (
                <PressableScale
                  onPress={() => onToggleExcluded(d.key)}
                  activeScale={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={toggleLabel(d)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather
                    name={d.type === 'excluded' ? 'circle' : 'check-circle'}
                    size={18}
                    color={d.type === 'excluded' ? theme.text.muted : theme.accent.primary}
                  />
                </PressableScale>
              )}
            </>
          )}
        </View>
      ))}
    </SectionCard>
  ) : null;

  const heroHead = (
    <View style={s.heroHead}>
      <Text style={s.heroKicker}>Handicap index</Text>
      {onInfo ? (
        <TouchableOpacity
          onPress={() => onInfo('handicapIndex')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="What is Handicap Index"
        >
          <Feather name="info" size={14} color={CREAM_70} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    const emptyHero = (
      <View style={s.hero}>
        {heroHead}
        <Text style={s.heroEmptyTitle}>Not enough qualifying rounds yet</Text>
        <Text style={s.heroNote}>
          {`You need ${MIN_DIFFERENTIALS} qualifying rounds to calculate an index — ${missing} more to go. `}
          {'A round qualifies when it is a complete 18-hole round (no scrambles) on a tee with a slope and course rating.'}
        </Text>
        {result.excludedCount > 0 && (
          <Text style={s.heroNote}>
            {`${result.excludedCount} excluded round${result.excludedCount === 1 ? ' is' : 's are'} not counted — add them back below.`}
          </Text>
        )}
      </View>
    );
    const emptyCards = [
      { key: 'hero', node: emptyHero },
      listCard && { key: 'list', node: listCard },
    ].filter(Boolean);
    return (
      <View style={s.wrap}>
        {emptyCards.map((card, i) => (
          <Reveal key={card.key} delay={i * 40}>{card.node}</Reveal>
        ))}
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

  const heroCard = (
    <View style={s.hero}>
      {heroHead}
      <Text style={s.heroValue}>{fmt1(result.index)}</Text>
      <Text style={s.heroMeta}>
        {`Best ${result.usedCount} of last ${result.windowCount} differentials${result.excludedCount > 0 ? ` · ${result.excludedCount} excluded` : ''}`}
      </Text>
      {isPlus && (
        <Text style={s.heroNote}>A negative index means you play better than scratch.</Text>
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
    </View>
  );

  const cards = [
    { key: 'hero', node: heroCard },
    evolutionCard && { key: 'evolution', node: evolutionCard },
    listCard && { key: 'list', node: listCard },
  ].filter(Boolean);

  return (
    <View style={s.wrap}>
      {cards.map((card, i) => (
        <Reveal key={card.key} delay={i * 40}>{card.node}</Reveal>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    hero: {
      backgroundColor: GREEN,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.xs,
    },
    heroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    heroKicker: {
      color: CREAM_70,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    heroValue: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 44,
      lineHeight: 50,
      color: CREAM,
    },
    heroMeta: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_85 },
    heroNote: { fontSize: 12, lineHeight: 17, fontFamily: 'PlusJakartaSans-Medium', color: CREAM_70, marginTop: theme.spacing.xs },
    heroEmptyTitle: { fontSize: 15, fontFamily: 'PlusJakartaSans-Bold', color: CREAM, marginTop: theme.spacing.xs },
    applyBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm + 2,
      borderRadius: theme.radius.pill, backgroundColor: CREAM,
      alignItems: 'center',
    },
    applyBtnDisabled: { opacity: 0.6 },
    applyText: { fontSize: 14, fontFamily: 'PlusJakartaSans-Bold', color: GREEN },
    errorText: { fontSize: 12, fontFamily: 'PlusJakartaSans-SemiBold', color: ERROR_ON_GREEN, textAlign: 'center', marginTop: theme.spacing.xs },
    profileNote: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_70, textAlign: 'center', marginTop: theme.spacing.sm },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: theme.spacing.xs },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    rowExcluded: { opacity: 0.45 },
    rowMain: { flex: 1 },
    rowTitle: { ...theme.typography.body, color: theme.text.primary },
    rowSub: { ...theme.typography.tiny, color: theme.text.muted },
    rowValue: {
      fontSize: 14, fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted, fontVariant: ['tabular-nums'],
    },
    rowValueCounting: { color: theme.text.primary },
    rowTitleMuted: { color: theme.text.muted },
    countDot: { width: 6, height: 6, borderRadius: 3 },
    excludedChip: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    reason: { ...theme.typography.tiny, color: theme.text.muted },
  });
}
