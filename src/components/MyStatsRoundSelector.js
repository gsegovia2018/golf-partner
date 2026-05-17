import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { resolveSelection } from '../store/personalStats';

// Bottom-sheet round selector. Rounds are grouped by tournament, newest-first.
// `overrides` is the { [key]: boolean } map; `onChange` receives the next map.
export default function MyStatsRoundSelector({ visible, myRounds, overrides, onChange, onClose }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const selectedKeys = useMemo(
    () => new Set(resolveSelection(myRounds, overrides).map((r) => r.key)),
    [myRounds, overrides],
  );

  // Group by tournament, newest first (myRounds is chronological oldest-first).
  const groups = useMemo(() => {
    const byId = new Map();
    myRounds.forEach((r) => {
      if (!byId.has(r.tournamentId)) {
        byId.set(r.tournamentId, { id: r.tournamentId, name: r.tournamentName, rounds: [] });
      }
      byId.get(r.tournamentId).rounds.push(r);
    });
    return [...byId.values()].reverse();
  }, [myRounds]);

  // Set an explicit override; drop it when it matches the round's default.
  const setRound = (round, value) => {
    const next = { ...overrides };
    if (value === round.completed) delete next[round.key];
    else next[round.key] = value;
    onChange(next);
  };

  const setAll = (value) => {
    const next = {};
    myRounds.forEach((r) => { if (value !== r.completed) next[r.key] = value; });
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <View style={s.titleRow}>
            <Text style={s.title}>Rounds counted</Text>
            <View style={s.bulkRow}>
              <TouchableOpacity onPress={() => setAll(true)}>
                <Text style={s.bulkBtn}>Select all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAll(false)}>
                <Text style={s.bulkBtn}>Clear all</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={s.list}>
            {groups.map((g) => (
              <View key={g.id} style={s.group}>
                <Text style={s.groupName}>{g.name}</Text>
                {g.rounds.map((r) => {
                  const on = selectedKeys.has(r.key);
                  return (
                    <TouchableOpacity
                      key={r.key}
                      style={s.row}
                      onPress={() => setRound(r, !on)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Round ${r.roundIndex + 1}, ${r.courseName}${r.completed ? '' : ', in progress'}`}
                    >
                      <Feather
                        name={on ? 'check-square' : 'square'}
                        size={18}
                        color={on ? theme.accent.primary : theme.text.muted}
                      />
                      <Text style={s.rowText} numberOfLines={1}>
                        Round {r.roundIndex + 1} · {r.courseName}
                      </Text>
                      {!r.completed && <Text style={s.tag}>In progress</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <Text style={s.footer}>
            {selectedKeys.size} of {myRounds.length} rounds
          </Text>
          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.bg.elevated,
      borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
      paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl,
      paddingTop: theme.spacing.sm, maxHeight: '80%',
    },
    handle: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border.default,
      alignSelf: 'center', marginBottom: theme.spacing.md,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
    title: { ...theme.typography.heading, color: theme.text.primary },
    bulkRow: { flexDirection: 'row', gap: theme.spacing.md },
    bulkBtn: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    list: { marginVertical: theme.spacing.sm },
    group: { marginBottom: theme.spacing.md },
    groupName: { ...theme.typography.overline, color: theme.text.muted, marginBottom: theme.spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
    rowText: { ...theme.typography.body, color: theme.text.primary, flex: 1 },
    tag: { ...theme.typography.tiny, color: theme.text.inverse, backgroundColor: theme.text.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm, overflow: 'hidden' },
    footer: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    doneBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary, alignItems: 'center',
    },
    doneText: { ...theme.typography.subhead, color: theme.text.inverse },
  });
}
