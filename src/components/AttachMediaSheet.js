import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, ScrollView, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const UPLOADER_KEY = '@golf_uploader_label';

export default function AttachMediaSheet({ visible, asset, holes, defaultHoleIndex, onCancel, onConfirm }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [holeIndex, setHoleIndex] = useState(defaultHoleIndex ?? null);
  const [caption, setCaption] = useState('');
  const [uploader, setUploader] = useState('');

  useEffect(() => {
    if (!visible) return;
    setHoleIndex(defaultHoleIndex ?? null);
    setCaption('');
    AsyncStorage.getItem(UPLOADER_KEY).then((v) => setUploader(v ?? ''));
  }, [visible, defaultHoleIndex]);

  if (!visible || !asset) return null;

  const submit = async () => {
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    onConfirm({
      holeIndex,
      caption: caption.trim() || null,
      uploaderLabel: uploader.trim() || null,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Adjuntar a la ronda</Text>
            <TouchableOpacity onPress={onCancel} accessibilityLabel="Cancelar">
              <Feather name="x" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          {asset.kind === 'photo' ? (
            <Image source={{ uri: asset.localUri }} style={s.preview} resizeMode="cover" />
          ) : (
            <View style={[s.preview, s.videoPreview]}>
              <Feather name="video" size={32} color={theme.text.muted} />
              <Text style={s.videoLabel}>Video {asset.durationS ? `· ${Math.round(asset.durationS)}s` : ''}</Text>
            </View>
          )}

          <Text style={s.sectionLabel}>Hoyo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
            <Chip label="Sin hoyo" active={holeIndex == null} onPress={() => setHoleIndex(null)} theme={theme} />
            {holes.map((_, i) => (
              <Chip
                key={i}
                label={String(i + 1)}
                active={holeIndex === i}
                onPress={() => setHoleIndex(i)}
                theme={theme}
              />
            ))}
          </ScrollView>

          <Text style={s.sectionLabel}>Comentario (opcional)</Text>
          <TextInput
            style={s.input}
            value={caption}
            onChangeText={setCaption}
            placeholder="Ej. Bunker dramático del 7"
            placeholderTextColor={theme.text.muted}
          />

          <Text style={s.sectionLabel}>Tu nombre (opcional)</Text>
          <TextInput
            style={s.input}
            value={uploader}
            onChangeText={setUploader}
            placeholder="Ej. Noé"
            placeholderTextColor={theme.text.muted}
          />

          <TouchableOpacity style={s.saveBtn} onPress={submit}>
            <Text style={s.saveLabel}>Guardar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, active, onPress, theme }) {
  const s = makeChipStyles(theme, active);
  return (
    <TouchableOpacity style={s.chip} onPress={onPress}>
      <Text style={s.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeChipStyles = (theme, active) => StyleSheet.create({
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: active ? theme.accent.primary : theme.bg.secondary,
    marginRight: 6,
  },
  label: {
    color: active ? theme.text.inverse : theme.text.primary,
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
  },
});

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 36,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: theme.bg.secondary, marginBottom: 16 },
  videoPreview: { alignItems: 'center', justifyContent: 'center' },
  videoLabel: { marginTop: 6, color: theme.text.muted, fontFamily: 'PlusJakartaSans-Medium' },
  sectionLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsRow: { paddingVertical: 4 },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.accent.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
