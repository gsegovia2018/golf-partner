import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { blankTee } from '../store/tees';
import { computeDupeTeeLabels } from '../lib/courseLibrary';

// Controlled tee-list editor. `tees` is an array of
// { id, label, rating, slope } (rating/slope may be '' while editing).
// `onChange` receives the next array.
export default function TeesEditor({ tees, onChange, theme }) {
  const s = makeStyles(theme);

  function update(index, patch) {
    onChange(tees.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }
  function add() {
    onChange([...tees, blankTee()]);
  }
  function remove(index) {
    onChange(tees.filter((_, i) => i !== index));
  }

  // Duplicate-label detection — labels must be unique within a course
  // because tee snapshots are matched by label.
  const dupes = computeDupeTeeLabels(tees);

  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>Tees</Text>

      <View style={s.headerRow}>
        <Text style={[s.headerText, s.labelCol]}>Label</Text>
        <Text style={[s.headerText, s.numCol]}>Rating</Text>
        <Text style={[s.headerText, s.numCol]}>Slope</Text>
        <View style={s.removeCol} />
      </View>

      {tees.map((tee, i) => (
        <React.Fragment key={tee.id}>
          <View style={s.row}>
            <TextInput
              style={[s.input, s.labelCol]}
              placeholder="White / 3 / Champ"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={tee.label ?? ''}
              onChangeText={(v) => update(i, { label: v })}
            />
            <TextInput
              style={[s.input, s.numCol]}
              keyboardType="decimal-pad"
              maxLength={5}
              placeholder="71.5"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={tee.rating != null ? String(tee.rating) : ''}
              onChangeText={(v) => update(i, { rating: v })}
            />
            <TextInput
              style={[s.input, s.numCol]}
              keyboardType="numeric"
              maxLength={3}
              placeholder="128"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={tee.slope != null ? String(tee.slope) : ''}
              onChangeText={(v) => update(i, { slope: v })}
            />
            <TouchableOpacity
              style={s.removeCol}
              onPress={() => remove(i)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${tee.label || 'tee'}`}
            >
              <Feather name="x" size={16} color={theme.destructive} />
            </TouchableOpacity>
          </View>
          <View style={s.womenRow}>
            <Text style={[s.womenLabel, s.labelCol]}>Women&apos;s</Text>
            <TextInput
              style={[s.input, s.numCol]}
              keyboardType="decimal-pad"
              maxLength={5}
              placeholder="79.3"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={tee.ratingWomen != null ? String(tee.ratingWomen) : ''}
              onChangeText={(v) => update(i, { ratingWomen: v })}
            />
            <TextInput
              style={[s.input, s.numCol]}
              keyboardType="numeric"
              maxLength={3}
              placeholder="151"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={tee.slopeWomen != null ? String(tee.slopeWomen) : ''}
              onChangeText={(v) => update(i, { slopeWomen: v })}
            />
            <View style={s.removeCol} />
          </View>
        </React.Fragment>
      ))}

      <TouchableOpacity
        style={s.addBtn}
        onPress={add}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Add tee"
      >
        <Feather name="plus" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
        <Text style={s.addBtnText}>Add tee</Text>
      </TouchableOpacity>

      {dupes.length > 0 && (
        <Text style={s.warnText}>
          Tee labels must be unique — duplicate: {dupes.join(', ')}
        </Text>
      )}
      {tees.length === 0 && (
        <Text style={s.hintText}>
          No tees yet. Without a tee, players use their raw handicap index.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  headerText: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
    fontSize: 11, letterSpacing: 0.5,
  },
  womenLabel: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11, textAlign: 'right', paddingRight: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  womenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8 },
  labelCol: { flex: 1 },
  numCol: { width: 64, textAlign: 'center' },
  removeCol: { width: 28, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default, fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 8,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginTop: 8,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  warnText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive,
    fontSize: 12, marginTop: 8,
  },
  hintText: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
    fontSize: 12, marginTop: 8,
  },
});
