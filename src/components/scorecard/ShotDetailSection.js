import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { makeScorecardStyles } from './styles';
import { ShotDetailPanel } from './ShotDetailPanel';

const ALL_ON = { putting: true, teeShot: true, approach: true, shortGame: true, penalties: true };

// Collapsible "Shot detail" section for the "me" card. `collapsed` and
// `onToggle` are controlled by the parent so the choice persists across holes.
// Renders nothing when every stat-tracking group is switched off in Settings.
export function ShotDetailSection({ hole, detail, onChange, strokes, collapsed, onToggle }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  const { statGroups } = useAppSettings();
  const anyOn = Object.values({ ...ALL_ON, ...statGroups }).some(Boolean);
  if (!anyOn) return null;
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
        <ShotDetailPanel hole={hole} detail={detail} onChange={onChange} strokes={strokes} statGroups={statGroups} />
      )}
    </View>
  );
}
