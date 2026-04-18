import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function CaptureMenuSheet({ visible, onSelect, onClose, extraActions = [] }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const options = [
    { key: 'photo',   icon: 'camera', label: 'Tomar foto',        source: 'camera',  mediaTypes: 'photo' },
    { key: 'video',   icon: 'video',  label: 'Grabar video',      source: 'camera',  mediaTypes: 'video' },
    { key: 'library', icon: 'image',  label: 'Elegir de galería', source: 'library', mediaTypes: 'all' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Adjuntar recuerdo</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Cancelar">
              <Feather name="x" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          {options.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={s.option}
              onPress={() => onSelect({ source: o.source, mediaTypes: o.mediaTypes })}
            >
              <Feather name={o.icon} size={20} color={theme.accent.primary} />
              <Text style={s.optionLabel}>{o.label}</Text>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </TouchableOpacity>
          ))}

          {extraActions.map((a) => (
            <TouchableOpacity key={a.key} style={s.option} onPress={a.onPress}>
              <Feather name={a.icon} size={20} color={theme.accent.primary} />
              <Text style={s.optionLabel}>{a.label}</Text>
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelLabel}>Cancelar</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
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
  optionLabel: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
  cancelBtn: { marginTop: 16, paddingVertical: 14, alignItems: 'center' },
  cancelLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 15 },
});
