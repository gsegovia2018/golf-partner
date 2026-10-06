import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { formatNetDiffSigned, netDiffTone } from '../../store/leagueView';

// "How it's worked out" on a league card: gross, adjusted gross (capped holes
// named), differential with the tee's numbers, league handicap, net. Plain
// text rows so a screen reader reads them in order. `breakdown` is
// leagueView.cardBreakdown's result.
export function capNote(capped) {
  if (capped.length === 0) return 'No hole needed capping';
  if (capped.length === 1) {
    const h = capped[0];
    return `Hole ${h.n}: ${h.strokes} counts as ${h.counted} (net double bogey)`;
  }
  const ns = capped.map((h) => h.n);
  return `Holes ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]} capped at net double bogey`;
}

export function breakdownSteps(b) {
  const rows = [
    { label: 'Gross', note: '18 holes as marked', value: String(b.gross) },
    { label: 'Adjusted gross', note: capNote(b.capped), value: String(b.adjustedGross) },
  ];
  if (!b.rated) {
    rows.push({
      label: 'Not ranked',
      note: "This tee has no slope and course rating, so there's no differential.",
      value: '—',
    });
    return rows;
  }
  const hcp = Number(b.leagueHandicap) || 0;
  rows.push(
    {
      label: 'Differential',
      note: `113 ÷ slope ${b.slope} × (${b.adjustedGross} − rating ${b.rating})`,
      value: Number(b.differential).toFixed(1),
    },
    { label: 'League handicap', note: 'Frozen on the card', value: hcp.toFixed(1) },
    {
      label: 'Net',
      note: `${Number(b.differential).toFixed(1)} − ${hcp.toFixed(1)} · lower is better`,
      value: formatNetDiffSigned(b.netDifferential),
      tone: netDiffTone(b.netDifferential),
    },
  );
  return rows;
}

export default function DifferentialBreakdown({ breakdown }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const steps = breakdownSteps(breakdown);
  const toneColor = (tone) => (tone === 'better' ? theme.scoreColor('excellent')
    : tone === 'worse' ? theme.destructive : theme.text.primary);
  return (
    <View style={s.box}>
      <Text style={s.overline}>HOW IT’S WORKED OUT</Text>
      {steps.map((st, i) => (
        <View key={st.label} style={[s.step, i > 0 && s.stepEdge]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.label}>{st.label}</Text>
            <Text style={s.note}>{st.note}</Text>
          </View>
          <Text style={[s.value, { color: toneColor(st.tone) }]}>{st.value}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  const line = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    box: {
      borderWidth: 1, borderColor: line, borderRadius: 14, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4,
      backgroundColor: theme.bg.secondary, marginBottom: 12,
    },
    overline: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1.5, marginBottom: 6,
    },
    step: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 5 },
    stepEdge: { borderTopWidth: 1, borderTopColor: line },
    label: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 13 },
    note: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 11, lineHeight: 15 },
    value: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  });
}
