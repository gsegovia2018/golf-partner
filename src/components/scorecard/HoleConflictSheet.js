import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';

const CONFLICT = semantic.conflict.base;

// Mid-round conflict prompt. Fires on leaving a hole whose entries disagree
// with another scorer's, and auto-surfaces synced conflicts from other
// phones once every author has moved past the hole. Rows are derived live by
// the parent, so a resolution from either phone drops its row on the next
// render — same shape and behavior as FinishConflictSheet, but title/subtitle
// and the action buttons are caller-driven since this sheet covers two
// distinct prompts ('leave' and 'peer').
//
// Props:
//   visible, onClose
//   title, subtitle       — copy, computed by the parent
//   rows                  — [{ playerId, hole, playerName, currentValue, candidates, blankAuthors }]
//   localAuthorId         — candidate.authorId matching this shows 'You' instead of authorName
//   onPick                — (playerId, hole, value) resolve one row
//   primaryLabel, onPrimary     — always-enabled primary action
//   secondaryLabel, onSecondary — optional ghost action, rendered after the primary
export default function HoleConflictSheet({
  visible, onClose, title, subtitle, rows, localAuthorId, onPick,
  primaryLabel, onPrimary, secondaryLabel, onSecondary,
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
        <Text style={s.title}>{title}</Text>
      </View>
      <Text style={s.subtitle}>{subtitle}</Text>

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
                const hint = c.authorId === localAuthorId ? 'You' : (c.authorName ?? 'Other phone');
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
                    <Text style={s.chipHint}>{hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {Array.isArray(row.blankAuthors) && row.blankAuthors.length > 0 && (
              <Text style={s.rowBlank}>{`No score from ${row.blankAuthors.join(', ')}`}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={s.primary}
        onPress={() => onPrimary?.()}
        activeOpacity={0.8}
        accessibilityLabel={primaryLabel}
      >
        <Text style={s.primaryText}>{primaryLabel}</Text>
      </TouchableOpacity>
      {secondaryLabel != null && (
        <TouchableOpacity
          style={s.secondary}
          onPress={() => onSecondary?.()}
          activeOpacity={0.8}
          accessibilityLabel={secondaryLabel}
        >
          <Text style={s.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      )}
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
  rowBlank: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme?.text?.muted,
    marginTop: 8,
  },
  primary: {
    marginTop: 16, backgroundColor: theme?.accent?.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme?.text?.inverse },
  secondary: {
    marginTop: 10, backgroundColor: theme?.bg?.card,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: theme?.border?.default,
  },
  secondaryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme?.text?.primary },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted,
    textAlign: 'center', marginTop: 10,
  },
});
