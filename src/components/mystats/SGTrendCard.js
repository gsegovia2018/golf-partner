import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import TrendLineChart from './TrendLineChart';
import { SG_CATEGORIES } from './shotMetrics';

const CHIPS = [{ key: 'total', label: 'Total' }, ...SG_CATEGORIES.map(({ key, label }) => ({ key, label }))];

// Per-round strokes-gained trend. Answers "am I actually getting better?"
// per category — the season averages on the dashboard can't show direction.
export default function SGTrendCard({ strokesGained }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [active, setActive] = useState('total');
  const perRound = strokesGained?.perRound ?? [];
  if (perRound.length < 2) return null;

  const series = perRound.map((entry) => ({
    label: `R${entry.index + 1}`,
    value: active === 'total'
      ? entry.total
      : (entry.byCategory?.[active] ?? null),
  }));

  return (
    <SectionCard title="SG Trend">
      <View style={s.chipRow}>
        {CHIPS.map((chip) => {
          const selected = chip.key === active;
          return (
            <PressableScale
              key={chip.key}
              style={[s.chip, selected && s.chipActive]}
              onPress={() => setActive(chip.key)}
              accessibilityRole="button"
              accessibilityLabel={`SG trend ${chip.label}`}
              accessibilityState={{ selected }}
            >
              <Text style={[s.chipText, selected && s.chipTextActive]}>{chip.label}</Text>
            </PressableScale>
          );
        })}
      </View>
      <TrendLineChart
        series={series}
        color={theme.accent.primary}
        labelColor={theme.text.secondary}
        caption="Strokes gained per round vs target"
        formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`}
      />
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    // Tab-pill pattern (mirrors the MyStatsScreen tab bar): bordered card
    // pill at rest, filled accent pill when selected.
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.spacing.sm },
    chip: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.card,
    },
    chipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    chipTextActive: { color: theme.text.inverse },
  });
}
