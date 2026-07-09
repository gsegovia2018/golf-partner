import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { resolveSelection } from '../store/personalStats';

// "12 May" — short day+month from the tournament's createdAt ISO string.
function formatRoundDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Bottom-sheet round selector. Rounds are grouped by tournament, newest-first.
// Each group is collapsible and has a header checkbox that batch-toggles all
// its rounds. `overrides` is the { [key]: boolean } map; `onChange` receives
// the next map.
export default function MyStatsRoundSelector({ visible, myRounds, overrides, onChange, onClose }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const selectedKeys = useMemo(
    () => new Set(resolveSelection(myRounds, overrides).map((r) => r.key)),
    [myRounds, overrides],
  );

  // Group by tournament, newest first (myRounds is chronological oldest-first).
  const groups = useMemo(() => {
    const byId = new Map();
    myRounds.forEach((r) => {
      if (!byId.has(r.tournamentId)) {
        byId.set(r.tournamentId, {
          id: r.tournamentId, name: r.tournamentName,
          date: r.tournamentDate, rounds: [],
        });
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

  // Batch-toggle every round in one tournament group.
  const setGroup = (group, value) => {
    const next = { ...overrides };
    group.rounds.forEach((r) => {
      if (value === r.completed) delete next[r.key];
      else next[r.key] = value;
    });
    onChange(next);
  };

  const toggleCollapsed = (groupId) => {
    setCollapsed((prev) => {
      const nx = new Set(prev);
      if (nx.has(groupId)) nx.delete(groupId);
      else nx.add(groupId);
      return nx;
    });
  };

  return (
    <Modal statusBarTranslucent hardwareAccelerated visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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
            {groups.map((g) => {
              const selCount = g.rounds.filter((r) => selectedKeys.has(r.key)).length;
              const allOn = selCount === g.rounds.length;
              const groupIcon = selCount === 0 ? 'square'
                : allOn ? 'check-square' : 'minus-square';
              const isCollapsed = collapsed.has(g.id);
              const dateLabel = formatRoundDate(g.date);
              return (
                <View key={g.id} style={s.group}>
                  <View style={s.groupHeader}>
                    <TouchableOpacity
                      onPress={() => setGroup(g, !allOn)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selCount === 0 ? false : allOn ? true : 'mixed' }}
                      accessibilityLabel={`${g.name}, toggle all rounds`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather
                        name={groupIcon}
                        size={18}
                        color={selCount > 0 ? theme.accent.primary : theme.text.muted}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.groupHeaderText}
                      onPress={() => toggleCollapsed(g.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.groupName} numberOfLines={1}>
                        {g.name}{dateLabel ? ` · ${dateLabel}` : ''}
                      </Text>
                      <Feather
                        name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                        size={16}
                        color={theme.text.muted}
                      />
                    </TouchableOpacity>
                  </View>
                  {!isCollapsed && g.rounds.map((r) => {
                    const on = selectedKeys.has(r.key);
                    return (
                      <TouchableOpacity
                        key={r.key}
                        style={s.row}
                        onPress={() => setRound(r, !on)}
                        activeOpacity={0.7}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`Round ${r.roundIndex + 1}, ${r.courseName}${r.completed ? `, ${r.points} points` : ', in progress'}`}
                      >
                        <Feather
                          name={on ? 'check-square' : 'square'}
                          size={18}
                          color={on ? theme.accent.primary : theme.text.muted}
                        />
                        <Text style={s.rowText} numberOfLines={1}>
                          Round {r.roundIndex + 1} · {r.courseName}
                        </Text>
                        {r.completed
                          ? <Text style={s.pts}>{r.points} pts</Text>
                          : <Text style={s.tag}>In progress</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
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
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
    groupHeaderText: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, flex: 1 },
    groupName: { ...theme.typography.overline, color: theme.text.muted, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm, paddingLeft: theme.spacing.lg },
    rowText: { ...theme.typography.body, color: theme.text.primary, flex: 1 },
    pts: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tag: { ...theme.typography.tiny, color: theme.text.inverse, backgroundColor: theme.text.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm, overflow: 'hidden' },
    footer: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    doneBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary, alignItems: 'center',
    },
    doneText: { ...theme.typography.subhead, color: theme.text.inverse },
  });
}
