import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { MAX_VIDEO_UPLOAD_LABEL } from '../lib/mediaLimits';
import BottomSheet from './BottomSheet';
import IconButton from './ui/IconButton';

export default function CaptureMenuSheet({ visible, onSelect, onClose, extraActions = [] }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const options = [
    { key: 'photo',   icon: 'camera', label: 'Take photo',        source: 'camera',  mediaTypes: 'photo' },
    { key: 'video',   icon: 'video',  label: 'Record video',      source: 'camera',  mediaTypes: 'video' },
    {
      key: 'library',
      icon: 'image',
      label: 'Choose from gallery',
      detail: `Videos up to ${MAX_VIDEO_UPLOAD_LABEL}`,
      source: 'library',
      mediaTypes: 'all',
    },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>Add a memory</Text>
        <IconButton icon="x" onPress={onClose} accessibilityLabel="Cancel" />
      </View>

      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          style={s.option}
          onPress={() => onSelect({ source: o.source, mediaTypes: o.mediaTypes })}
        >
          <Feather name={o.icon} size={20} color={theme.accent.primary} />
          <View style={s.optionText}>
            <Text style={s.optionLabel}>{o.label}</Text>
            {o.detail ? <Text style={s.optionDetail}>{o.detail}</Text> : null}
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
      ))}

      {extraActions.map((a) => (
        <TouchableOpacity key={a.key} style={s.option} onPress={a.onPress}>
          <Feather name={a.icon} size={20} color={theme.accent.primary} />
          <View style={s.optionText}>
            <Text style={s.optionLabel}>{a.label}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
        <Text style={s.cancelLabel}>Cancel</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  option: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    gap: 14,
  },
  optionText: { flex: 1 },
  optionLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
  optionDetail: {
    marginTop: 2,
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12,
    color: theme.text.muted,
  },
  cancelBtn: { marginTop: 16, paddingVertical: 14, alignItems: 'center' },
  cancelLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 15 },
});
