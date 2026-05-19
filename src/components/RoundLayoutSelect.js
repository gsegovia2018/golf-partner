import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Round-card control for choosing which layout of a picked club to play.
// `layouts` are course objects; `value` is the chosen layout's course id
// (or null). `onChange` receives the chosen layout course object.
export default function RoundLayoutSelect({ club, layouts, value, onChange, onChangeClub }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const chosen = (layouts || []).find((l) => l.id === value) || null;

  return (
    <View>
      <View style={s.clubRow}>
        <Feather name="map-pin" size={15} color={theme.accent.primary} />
        <Text style={s.clubName} numberOfLines={1}>{club.name}</Text>
        <TouchableOpacity onPress={onChangeClub} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.change}>Change</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.dd} activeOpacity={0.7} onPress={() => setOpen((o) => !o)}>
        <Text style={[s.ddText, !chosen && s.ddPlaceholder]} numberOfLines={1}>
          {chosen ? (chosen.layoutName || chosen.name) : 'Choose a layout…'}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.text.muted} />
      </TouchableOpacity>

      {open && (
        <View style={s.list}>
          {(layouts || []).map((l) => {
            const par = (l.holes || []).reduce((sum, h) => sum + h.par, 0);
            const isSel = l.id === value;
            return (
              <TouchableOpacity
                key={l.id}
                style={[s.row, isSel && s.rowSel]}
                activeOpacity={0.7}
                onPress={() => { onChange(l); setOpen(false); }}
              >
                <Text style={s.rowName}>{l.layoutName || l.name}</Text>
                <Text style={s.rowMeta}>
                  {(l.holes || []).length} holes · Par {par}
                  {l.slope ? ` · Slope ${l.slope}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  clubName: {
    flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary,
  },
  change: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.accent.primary },
  dd: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default, borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: 12,
  },
  ddText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
  ddPlaceholder: { color: theme.text.muted, fontFamily: 'PlusJakartaSans-Medium' },
  list: {
    marginTop: 6, borderWidth: 1, borderColor: theme.border.default,
    borderRadius: 10, overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 13, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    backgroundColor: theme.bg.card,
  },
  rowSel: { backgroundColor: theme.isDark ? theme.accent.primary + '14' : theme.accent.light },
  rowName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
  rowMeta: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12,
    color: theme.text.secondary, marginTop: 2,
  },
});
