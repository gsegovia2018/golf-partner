import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import { SG_CATEGORIES, formatSignedFixed } from './shotMetrics';

// Ties the SG categories back to real scores: expected (par + target
// handicap) vs actual strokes, split into the five categories plus an
// honest residual. The rows always sum to the gap — that invariant is the
// card's whole point (spec §1.6).
export default function SGReconciliationCard({ reconciliation, targetHandicap }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!reconciliation || reconciliation.rounds === 0) return null;

  const targetLabel = targetHandicap == null || targetHandicap === 0
    ? 'Expected for scratch'
    : `Expected for an ${targetHandicap}-handicap`;
  const rows = [
    ...SG_CATEGORIES.map((c) => ({
      key: c.key, label: c.label, value: reconciliation.byCategoryAvg[c.key],
    })),
    { key: 'residual', label: 'In-between & untracked', value: reconciliation.residualAvg, muted: true },
  ];

  return (
    <SectionCard title="Where your strokes go">
      <Text style={s.headline}>
        {`${targetLabel}: ${reconciliation.expectedAvg.toFixed(1)} · You: ${reconciliation.actualAvg.toFixed(1)}`}
      </Text>
      <Text style={s.meta}>
        {`Average per round across ${reconciliation.rounds} rounds. The rows below sum to the ${formatSignedFixed(reconciliation.gapAvg)} gap.`}
      </Text>
      {rows.map((row) => (
        <View key={row.key} style={s.row}>
          <Text style={[s.rowLabel, row.muted && { color: theme.text.muted }]}>{row.label}</Text>
          <Text
            style={[
              s.rowValue,
              { color: row.value >= 0 ? theme.scoreColor('good') : theme.destructive },
              row.muted && { color: theme.text.muted },
            ]}
          >
            {formatSignedFixed(row.value)}
          </Text>
        </View>
      ))}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    headline: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    meta: { ...theme.typography.caption, color: theme.text.secondary, marginBottom: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    rowLabel: { ...theme.typography.body, color: theme.text.primary },
    rowValue: { ...theme.typography.body, fontWeight: '800' },
  });
}
