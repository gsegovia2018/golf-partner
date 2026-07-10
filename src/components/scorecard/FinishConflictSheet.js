import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import { useTheme } from '../../theme/ThemeContext';

const CONFLICT = '#c77a0a';

// Finish-time conflict summary. Lists every hole/player whose score has two
// competing values and lets the finisher settle each one with a tap. Rows are
// derived live from the tournament blob by the parent, so a resolved row
// disappears on the next render; when none remain the Finish button unlocks.
//
// Props:
//   visible  — bool
//   onClose  — dismiss without finishing (conflicts stay for later)
//   rows     — [{ playerId, hole, playerName, currentValue, candidates }]
//   onPick   — (playerId, hole, value) resolve one row
//   onFinish — proceed with the round finish; only tappable when rows is empty
export default function FinishConflictSheet({
  visible, onClose, rows, onPick, onFinish,
}) {
  const { theme } = useTheme() || {};
  const s = makeStyles(theme);
  const list = Array.isArray(rows) ? rows : [];
  const done = list.length === 0;

  const valueLabel = (v) => (v == null ? 'No score' : String(v));

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
      <View style={s.titleRow}>
        <Feather
          name={done ? 'check-circle' : 'alert-circle'}
          size={16}
          color={done ? theme?.accent?.primary : CONFLICT}
        />
        <Text style={s.title}>{done ? 'All scores agreed' : 'Settle the scores'}</Text>
      </View>
      <Text style={s.subtitle}>
        {done
          ? 'Every hole has one agreed score. You can finish the round.'
          : 'These holes were recorded differently on two phones. Pick the correct score for each.'}
      </Text>

      <ScrollView style={s.list} bounces={false}>
        {list.map((row) => (
          <View key={`${row.playerId}:${row.hole}`} style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowHole}>{`Hole ${row.hole}`}</Text>
              <Text style={s.rowPlayer}>{row.playerName}</Text>
            </View>
            <View style={s.chips}>
              {(row.candidates ?? []).map((c, i) => {
                const isCurrent = c.value === row.currentValue;
                return (
                  <TouchableOpacity
                    key={`${String(c.value)}-${c.ts}-${i}`}
                    style={[s.chip, isCurrent && s.chipCurrent]}
                    onPress={() => onPick?.(row.playerId, row.hole, c.value)}
                    activeOpacity={0.8}
                    accessibilityLabel={
                      c.value == null
                        ? `Use no score for ${row.playerName} on hole ${row.hole}`
                        : `Use ${c.value} ${c.value === 1 ? 'stroke' : 'strokes'} for ${row.playerName} on hole ${row.hole}`
                    }
                  >
                    <Text style={s.chipValue}>{valueLabel(c.value)}</Text>
                    <Text style={s.chipHint}>{isCurrent ? 'On this phone' : 'Other phone'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[s.finish, !done && s.finishDisabled]}
        disabled={!done}
        onPress={() => { if (done) onFinish?.(); }}
        activeOpacity={0.8}
        accessibilityLabel="Finish round"
      >
        <Text style={[s.finishText, !done && s.finishTextDisabled]}>
          {done ? 'Finish round' : `${list.length} left to settle`}
        </Text>
      </TouchableOpacity>
      <Text style={s.foot}>Your picks sync to every phone in the group</Text>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme?.bg?.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
    width: '100%', maxWidth: 560, alignSelf: 'center',
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme?.border?.default, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme?.text?.primary },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme?.text?.muted,
    marginTop: 4, marginBottom: 12,
  },
  list: { flexGrow: 0 },
  row: {
    paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: theme?.border?.default,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  rowHole: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme?.text?.primary },
  rowPlayer: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme?.text?.secondary },
  chips: { flexDirection: 'row', gap: 10 },
  chip: {
    flexGrow: 1, flexBasis: 0,
    backgroundColor: theme?.bg?.card,
    borderRadius: 12, borderWidth: 1.5, borderColor: theme?.border?.default,
    paddingVertical: 10, alignItems: 'center', gap: 2,
  },
  chipCurrent: { borderColor: CONFLICT },
  chipValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22, color: theme?.text?.primary },
  chipHint: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted },
  finish: {
    marginTop: 16, backgroundColor: theme?.accent?.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  finishDisabled: { backgroundColor: theme?.bg?.secondary },
  finishText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme?.text?.inverse },
  finishTextDisabled: { color: theme?.text?.muted },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted,
    textAlign: 'center', marginTop: 10,
  },
});
