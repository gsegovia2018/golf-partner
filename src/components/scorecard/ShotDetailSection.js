import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { ShotDetailPanel } from './ShotDetailPanel';

// Collapsible "Shot detail" section for the "me" card. `collapsed` and
// `onToggle` are controlled by the parent so the choice persists across holes.
export function ShotDetailSection({ hole, detail, onChange, strokes, collapsed, onToggle }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  return (
    <View style={s.shotSection}>
      <TouchableOpacity
        style={s.shotSectionHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={collapsed ? 'Show shot detail' : 'Hide shot detail'}
      >
        <Text style={s.shotSectionTitle}>Shot detail</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={theme.text.muted} />
      </TouchableOpacity>
      {!collapsed && (
        <ShotDetailPanel hole={hole} detail={detail} onChange={onChange} strokes={strokes} />
      )}
    </View>
  );
}
