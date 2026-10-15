import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT, formatOrdinal } from '../../i18n';
import { useTheme } from '../../theme/ThemeContext';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import { buttonStyles } from '../ui/Buttons';
import { checkPointsDrafts, POINTS_TABLE_MAX_PLACES } from '../../store/leagueDraft';

// Edits the season points table place by place. Works on a local copy of the
// numbers (as text) and hands a number[] to onSave, so closing discards.
//   table     current number[]
//   onSave    (number[]) => void
export default function PointsTableSheet({ visible, table, onSave, onClose }) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { height } = useWindowDimensions();
  const [drafts, setDrafts] = useState(() => (table ?? []).map(String));

  useEffect(() => {
    if (visible) setDrafts((table ?? []).map(String));
    // Re-seed only when the sheet opens, not while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const check = useMemo(() => checkPointsDrafts(drafts), [drafts]);
  const lastIndex = drafts.length - 1;
  const update = (i, text) => setDrafts((prev) => prev.map((d, j) => (j === i ? text.replace(/[^\d]/g, '') : d)));

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>{t('league.points.title')}</Text>
        <IconButton icon="x" onPress={onClose} accessibilityLabel={t('league.points.close')} />
      </View>
      <Text style={s.body}>{t('league.points.body')}</Text>

      <ScrollView
        style={{ maxHeight: Math.round(height * 0.5) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {drafts.map((d, i) => (
          <View key={i} style={s.row}>
            <Text style={s.place}>{formatOrdinal(i + 1)}</Text>
            <TextInput
              style={s.input}
              value={d}
              onChangeText={(text) => update(i, text)}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="0"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              accessibilityLabel={t('league.points.placeA11y', { place: formatOrdinal(i + 1) })}
            />
            <View style={s.removeSlot}>
              {i === lastIndex && drafts.length > 1 && (
                <TouchableOpacity
                  style={s.removeBtn}
                  onPress={() => setDrafts((prev) => prev.slice(0, -1))}
                  accessibilityRole="button"
                  accessibilityLabel={t('league.points.removeA11y', { place: formatOrdinal(i + 1) })}
                >
                  <Feather name="x" size={18} color={theme.text.muted} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        {drafts.length < POINTS_TABLE_MAX_PLACES && (
          <TouchableOpacity
            style={s.addRow}
            onPress={() => setDrafts((prev) => [...prev, ''])}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Feather name="plus" size={16} color={theme.accent.primary} />
            <Text style={s.addText}>{t('league.points.add', { place: formatOrdinal(drafts.length + 1) })}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {check.badIndex >= 0 && (
        <Text style={s.error}>{t('league.points.error', { place: formatOrdinal(check.badIndex + 1) })}</Text>
      )}
      <TouchableOpacity
        style={[s.save, !check.table && s.saveOff]}
        onPress={() => { if (check.table) onSave(check.table); }}
        disabled={!check.table}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ disabled: !check.table }}
      >
        <Text style={s.saveText}>{t('league.points.save')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary, padding: 20,
      borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
    body: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 18,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    },
    place: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
    input: {
      width: 64, textAlign: 'center', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.secondary, paddingVertical: 8,
      fontSize: 14, fontFamily: 'PlusJakartaSans-Bold',
    },
    removeSlot: { width: 40, alignItems: 'center' },
    removeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
    addText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
    error: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginTop: 10,
    },
    save: { ...btn.primaryBtn, marginTop: 12 },
    saveOff: { opacity: 0.5 },
    saveText: btn.primaryText,
  });
}
