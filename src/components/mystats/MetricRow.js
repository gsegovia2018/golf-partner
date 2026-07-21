import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// A label + primary value, with an optional secondary value (e.g. "36 holes")
// and an optional (i) button. `dim` greys a zero-sample row.
export default function MetricRow({ label, value, secondary, infoKey, onInfo, dim = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.row}>
      <View style={s.labelWrap}>
        <Text style={[s.label, dim && s.dim]}>{label}</Text>
        {infoKey && onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo(infoKey)}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`What is ${label}`}
          >
            <Feather name="info" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[s.value, dim && s.dim]}>{dim ? '—' : value}</Text>
      {secondary != null ? <Text style={s.secondary}>{dim ? '' : secondary}</Text> : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
    labelWrap: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
    label: { ...theme.typography.body, color: theme.text.primary },
    value: { ...theme.typography.body, color: theme.text.primary, flex: 1, textAlign: 'right', fontWeight: '700' },
    secondary: { ...theme.typography.caption, color: theme.text.muted, flex: 1, textAlign: 'right' },
    dim: { color: theme.text.muted },
  });
}
