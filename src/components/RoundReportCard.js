import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Signed delta in the "good" direction for a cell, regardless of polarity.
function goodDelta(cell) {
  if (cell.deltaVsAvg == null) return null;
  return cell.polarity === 'lower' ? -cell.deltaVsAvg : cell.deltaVsAvg;
}

// "+1.2" / "-0.4" / "0".
function fmtDelta(v) {
  if (v == null) return '—';
  if (v > 0) return `+${v}`;
  return `${v}`;
}

function Callout({ cell, kind, s }) {
  const good = kind === 'bright';
  const delta = cell.deltaVsAvg != null ? cell.deltaVsAvg : cell.deltaVs2;
  return (
    <View style={[s.callout, good ? s.calloutGood : s.calloutBad]}>
      <View style={[s.calloutDot, good ? s.dotGood : s.dotBad]}>
        <Feather name={good ? 'arrow-up' : 'arrow-down'} size={10} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.calloutLabel}>{cell.label}</Text>
        <Text style={s.calloutSub}>
          {cell.value} / hole · {fmtDelta(delta)} vs {cell.deltaVsAvg != null ? 'your avg' : 'the 2.0 mark'}
        </Text>
      </View>
    </View>
  );
}

function BreakdownRow({ cell, s, theme }) {
  const gd = goodDelta(cell);
  const color = gd == null ? theme.text.muted
    : gd > 0 ? theme.accent.primary
    : gd < 0 ? theme.destructive : theme.text.muted;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel} numberOfLines={1}>{cell.label}</Text>
      <Text style={s.rowValue}>{cell.value}</Text>
      <Text style={[s.rowDelta, { color }]}>
        {cell.deltaVsAvg != null ? fmtDelta(cell.deltaVsAvg) : '—'}
      </Text>
    </View>
  );
}

export default function RoundReportCard({ card, rounds, selectedKey, onSelect }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!card) {
    return (
      <View style={s.empty}>
        <Feather name="clipboard" size={28} color={theme.text.muted} />
        <Text style={s.emptyText}>No round selected.</Text>
      </View>
    );
  }

  const { round, headline, callouts, groups, hasHistory } = card;

  return (
    <View style={s.wrap}>
      {/* Round dropdown */}
      <TouchableOpacity style={s.drop} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
        <View style={{ flex: 1 }}>
          <Text style={s.dropTitle} numberOfLines={1}>{round.courseName}</Text>
          <Text style={s.dropSub} numberOfLines={1}>{round.tournamentName}</Text>
        </View>
        <Feather name="chevron-down" size={18} color={theme.text.muted} />
      </TouchableOpacity>

      {/* Verdict */}
      <View style={s.verdict}>
        <Text style={s.verdictPhrase}>{headline.verdict}</Text>
        <Text style={s.verdictNums}>
          {headline.points} pts · {headline.perHole} / hole
          {headline.vsAvg != null
            ? ` · ${fmtDelta(headline.vsAvg)} vs your average`
            : ''}
        </Text>
        <Text style={s.verdictBench}>
          {headline.clearedBenchmark
            ? 'Above the 2.0 playing-to-handicap mark'
            : 'Below the 2.0 playing-to-handicap mark'}
          {round.complete ? '' : ` · through ${round.holesPlayed} holes`}
        </Text>
        {!hasHistory && (
          <Text style={s.verdictNote}>
            The "vs your average" comparison appears once you have more rounds.
          </Text>
        )}
      </View>

      {/* Callouts */}
      {callouts.bright.length > 0 && (
        <>
          <Text style={s.sectionLabel}>BRIGHT SPOTS</Text>
          {callouts.bright.map((c) => (
            <Callout key={c.label} cell={c} kind="bright" s={s} />
          ))}
        </>
      )}
      {callouts.cost.length > 0 && (
        <>
          <Text style={s.sectionLabel}>COST YOU POINTS</Text>
          {callouts.cost.map((c) => (
            <Callout key={c.label} cell={c} kind="cost" s={s} />
          ))}
        </>
      )}

      {/* Expandable breakdown */}
      <TouchableOpacity style={s.expandBtn} onPress={() => setExpanded((v) => !v)} activeOpacity={0.8}>
        <Text style={s.expandText}>
          {expanded ? 'Hide full breakdown' : 'Show full breakdown'}
        </Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.accent.primary} />
      </TouchableOpacity>
      {expanded && groups.map((g) => (
        <View key={g.key} style={s.group}>
          <Text style={s.groupLabel}>{g.label}</Text>
          {g.cells.map((c) => (
            <BreakdownRow key={c.label} cell={c} s={s} theme={theme} />
          ))}
        </View>
      ))}

      {/* Round picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Choose a round</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {[...(rounds || [])].slice().reverse().map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[s.pickRow, r.key === selectedKey && s.pickRowOn]}
                  onPress={() => { onSelect(r.key); setPickerOpen(false); }}
                >
                  <Text style={s.pickName} numberOfLines={1}>{r.courseName}</Text>
                  <Text style={s.pickSub} numberOfLines={1}>{r.tournamentName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { padding: 4 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },

    drop: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: theme.border.default, borderRadius: 12,
      padding: 12, marginBottom: 14, backgroundColor: theme.bg.card,
    },
    dropTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
    dropSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },

    verdict: {
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, padding: 14, marginBottom: 16,
    },
    verdictPhrase: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: theme.accent.primary },
    verdictNums: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary, marginTop: 4 },
    verdictBench: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 2 },
    verdictNote: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.muted, marginTop: 6 },

    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 14, marginBottom: 8, textTransform: 'uppercase',
    },
    callout: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      borderRadius: 12, padding: 11, marginBottom: 7,
    },
    calloutGood: { backgroundColor: theme.accent.light },
    calloutBad: { backgroundColor: theme.bg.secondary },
    calloutDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    dotGood: { backgroundColor: theme.accent.primary },
    dotBad: { backgroundColor: theme.destructive },
    calloutLabel: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
    calloutSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary, marginTop: 1 },

    expandBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12, marginTop: 12,
    },
    expandText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.accent.primary },

    group: { marginTop: 14 },
    groupLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border.default,
    },
    rowLabel: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.primary },
    rowValue: { width: 48, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.primary },
    rowDelta: { width: 52, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },

    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: theme.bg.card, borderRadius: 16, padding: 16, width: '100%' },
    modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary, marginBottom: 10 },
    pickRow: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10 },
    pickRowOn: { backgroundColor: theme.accent.light },
    pickName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    pickSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  });
}
