import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT, formatOrdinal } from '../../i18n';
import { useTheme } from '../../theme/ThemeContext';
import { checkPointsDrafts, POINTS_TABLE_MAX_PLACES } from '../../store/leagueDraft';

const COMPACT_PLACES = 6;

// Season points per finishing place, drawn as bars and edited in place.
//   table     initial number[] (read once, on mount)
//   onChange  (number[] | null) => void; null while any place has no number
// `style` overrides the wrapper (the wizard draws it as a card row; Settings
// inside a form card drops the row padding and divider).
export default function PointsTableChart({ table, onChange, style }) {
  const t = useT();
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [drafts, setDrafts] = useState(() => (table ?? []).map(String));
  const [editing, setEditing] = useState(-1);
  const [expanded, setExpanded] = useState(false);

  const check = useMemo(() => checkPointsDrafts(drafts), [drafts]);
  const nums = drafts.map((d) => (/^\d+$/.test(d) ? Number(d) : 0));
  const max = Math.max(1, ...nums);
  const visible = expanded ? drafts.length : Math.min(drafts.length, COMPACT_PLACES);
  const lastIndex = drafts.length - 1;

  const commit = (next) => {
    setDrafts(next);
    onChange(checkPointsDrafts(next).table);
  };
  const update = (i, text) => commit(drafts.map((d, j) => (j === i ? text.replace(/[^\d]/g, '') : d)));
  const addPlace = () => {
    setExpanded(true);
    setEditing(drafts.length);
    commit([...drafts, '']);
  };
  const removeLast = () => {
    setEditing(-1);
    commit(drafts.slice(0, -1));
  };
  const endEdit = (i) => {
    if (drafts[i] !== '') setEditing((cur) => (cur === i ? -1 : cur));
  };

  return (
    <View style={[s.wrap, style]}>
      <Text style={s.title}>{t('league.points.title')}</Text>
      <Text style={s.hint}>{t('league.points.hint')}</Text>

      <View style={s.rows}>
        {drafts.slice(0, visible).map((d, i) => {
          const isEditing = editing === i;
          const empty = d === '';
          const place = formatOrdinal(i + 1);
          const fill = isEditing || i === 0 ? theme.accent.primary : `${theme.accent.primary}73`;
          return (
            <TouchableOpacity
              key={i}
              style={s.row}
              onPress={() => setEditing(i)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('league.points.rowA11y', { place, points: nums[i], count: nums[i] })}
              accessibilityHint={t('league.points.rowHint')}
            >
              <Text style={s.place}>{place}</Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${(nums[i] / max) * 100}%`, backgroundColor: fill }]} />
              </View>
              {isEditing ? (
                <View style={s.editSlot}>
                  <TextInput
                    style={[s.input, empty && s.inputBad]}
                    value={d}
                    onChangeText={(text) => update(i, text)}
                    onBlur={() => endEdit(i)}
                    onSubmitEditing={() => endEdit(i)}
                    autoFocus
                    selectTextOnFocus
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="–"
                    placeholderTextColor={theme.text.muted}
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    accessibilityLabel={t('league.points.placeA11y', { place })}
                  />
                  {i === lastIndex && drafts.length > 1 && (
                    <TouchableOpacity
                      style={s.removeBtn}
                      onPress={removeLast}
                      accessibilityRole="button"
                      accessibilityLabel={t('league.points.removeA11y', { place })}
                    >
                      <Feather name="x" size={18} color={theme.destructive} />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={[s.value, empty && s.valueBad]}>{empty ? '–' : d}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.footer}>
        {drafts.length > COMPACT_PLACES ? (
          <TouchableOpacity
            style={s.footerBtn}
            onPress={() => setExpanded((e) => !e)}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
          >
            <Text style={s.footerText}>
              {expanded ? t('league.points.showFewer') : t('league.points.showAll', { count: drafts.length })}
            </Text>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.accent.primary} />
          </TouchableOpacity>
        ) : <View />}
        {drafts.length < POINTS_TABLE_MAX_PLACES && (
          <TouchableOpacity
            style={s.footerBtn}
            onPress={addPlace}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
          >
            <Feather name="plus" size={14} color={theme.accent.primary} />
            <Text style={s.footerText}>{t('league.points.add', { place: formatOrdinal(drafts.length + 1) })}</Text>
          </TouchableOpacity>
        )}
      </View>

      {check.badIndex >= 0 && (
        <Text style={s.error}>{t('league.points.error', { place: formatOrdinal(check.badIndex + 1) })}</Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    rows: { marginTop: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, minHeight: 28 },
    place: { width: 32, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 11 },
    track: { flex: 1, height: 12, borderRadius: 4, backgroundColor: theme.bg.secondary, overflow: 'hidden' },
    fill: { height: 12, borderRadius: 4 },
    value: {
      minWidth: 40, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
      fontSize: 12, fontVariant: ['tabular-nums'],
    },
    valueBad: { color: theme.destructive },
    editSlot: { flexDirection: 'row', alignItems: 'center' },
    input: {
      width: 56, textAlign: 'center', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.accent.primary, backgroundColor: theme.bg.card, paddingVertical: 6,
      fontSize: 14, fontFamily: 'PlusJakartaSans-Bold',
    },
    inputBad: { borderColor: theme.destructive },
    removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
    footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    footerText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 12 },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginTop: 8 },
  });
}
