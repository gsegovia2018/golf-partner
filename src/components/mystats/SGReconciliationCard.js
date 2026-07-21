import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import Reveal from '../ui/Reveal';
import SectionCard from './SectionCard';
import CountUpText from './CountUpText';
import { SG_CATEGORIES, formatSignedFixed } from './shotMetrics';

// Ties the SG categories back to real scores as a caddie's receipt: the
// expected score (par + target handicap) up top, one line item per category
// (plus an honest residual) priced in strokes, and your actual score ruled
// off as the total. Line items are COSTS — a positive number is strokes
// spent above expectation, a negative one is strokes given back — so
// expected + line items = your round. That invariant is the card's whole
// point (spec §1.6).
const LINE_STAGGER_MS = 60;
const LINE_MS = 240;
const TOTAL_MS = 400;
// Below this many strokes a line item reads as noise, not signal.
const NEAR_ZERO = 0.05;

export default function SGReconciliationCard({ reconciliation, targetHandicap }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();
  if (!reconciliation || reconciliation.rounds === 0) return null;

  const targetOverline = targetHandicap == null || targetHandicap === 0
    ? 'EXPECTED · SCRATCH'
    : `EXPECTED · ${targetHandicap} HCP`;
  const rows = [
    ...SG_CATEGORIES.map((c) => ({
      key: c.key, label: c.label, cost: -(reconciliation.byCategoryAvg[c.key] ?? 0),
    })),
    { key: 'residual', label: 'In-between & untracked', cost: -reconciliation.residualAvg, muted: true },
  ];
  // The actual total counts up LAST — after the line-item cascade lands.
  const totalDelay = rows.length * LINE_STAGGER_MS + LINE_MS;
  const gapCost = -reconciliation.gapAvg;

  return (
    <SectionCard title="Where your strokes go">
      <View style={s.receipt}>
        <View style={s.receiptHead}>
          <View>
            <Text style={s.expectedOverline}>{targetOverline}</Text>
            <Text style={s.expectedValue}>{reconciliation.expectedAvg.toFixed(1)}</Text>
          </View>
          <Text style={s.metaOverline}>
            {`AVG OF ${reconciliation.rounds} ${reconciliation.rounds === 1 ? 'ROUND' : 'ROUNDS'}`}
          </Text>
        </View>
        {rows.map((row, index) => (
          <Reveal key={row.key} delay={index * LINE_STAGGER_MS} dy={4} duration={LINE_MS}>
            <View style={s.line}>
              <Text style={[s.lineLabel, row.muted && s.mutedText]}>{row.label}</Text>
              <View style={s.leader} />
              <Text style={[s.lineValue, { color: costColor(theme, row.cost) }]}>
                {formatSignedFixed(row.cost)}
              </Text>
            </View>
          </Reveal>
        ))}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Your round</Text>
          <Text style={s.totalValue}>
            <CountUpText
              value={reconciliation.actualAvg}
              decimals={1}
              duration={TOTAL_MS}
              delay={totalDelay}
              disabled={reduced}
            />
          </Text>
        </View>
      </View>
      <Text style={s.footnote}>
        {`Average per round across ${reconciliation.rounds} rounds. The line items sum to the ${formatSignedFixed(gapCost)}-stroke gap between expected and your round.`}
      </Text>
    </SectionCard>
  );
}

// Receipt semantics: a positive cost (strokes spent) is Masters red, strokes
// given back are Clubhouse green, and near-zero lines fade to muted so the
// eye lands on the items that actually price the gap.
function costColor(theme, cost) {
  if (!Number.isFinite(cost) || Math.abs(cost) < NEAR_ZERO) return theme.text.muted;
  return cost > 0 ? theme.destructive : theme.accent.primary;
}

function makeStyles(theme) {
  return StyleSheet.create({
    receipt: {
      backgroundColor: theme.bg.primary,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 15,
    },
    receiptHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.sm,
    },
    expectedOverline: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
    expectedValue: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 24,
      lineHeight: 30,
      color: theme.accent.primary,
      marginTop: 2,
    },
    metaOverline: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.text.muted,
      textAlign: 'right',
    },
    line: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingVertical: 4.5,
    },
    lineLabel: {
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: '600',
      color: theme.text.primary,
    },
    // Dotted leader between name and price, receipt-style. Android renders a
    // single-edge dotted border as solid — acceptable degradation (it still
    // reads as a leader line).
    leader: {
      flex: 1,
      height: 5,
      marginHorizontal: 6,
      marginBottom: 3,
      borderBottomWidth: 1.5,
      borderStyle: 'dotted',
      borderColor: theme.border.default,
    },
    lineValue: {
      fontSize: 12.5,
      lineHeight: 16,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    mutedText: {
      color: theme.text.muted,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: 1.5,
      borderTopColor: theme.text.primary,
    },
    totalLabel: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 18,
      color: theme.text.primary,
    },
    totalValue: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 18,
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    footnote: {
      fontSize: 10,
      lineHeight: 14,
      color: theme.text.muted,
    },
  });
}
