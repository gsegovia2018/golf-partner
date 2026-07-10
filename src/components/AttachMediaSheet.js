import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';

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

  if (!asset) return null;

  const submit = async () => {
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    onConfirm({
      holeIndex,
      caption: caption.trim() || null,
      uploaderLabel: uploader.trim() || null,
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>Adjuntar a la ronda</Text>
        <TouchableOpacity onPress={onCancel} accessibilityLabel="Cancelar">
          <Feather name="x" size={22} color={theme.text.muted} />
        </TouchableOpacity>
      </View>

      {asset.kind === 'photo' ? (
        <Image source={{ uri: asset.localUri }} style={s.preview} resizeMode="cover" />
      ) : (
        <VideoPreview uri={asset.localUri} style={s.preview} />
      )}

      <Text style={s.sectionLabel}>Hoyo</Text>
      <View style={s.holeGrid}>
        <TouchableOpacity
          style={[s.holeBtn, s.holeBtnWide, holeIndex == null && s.holeBtnActive]}
          onPress={() => setHoleIndex(null)}
          activeOpacity={0.7}
        >
          <Text
            style={[s.holeBtnText, s.holeBtnTextWide, holeIndex == null && s.holeBtnTextActive]}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            Sin hoyo
          </Text>
        </TouchableOpacity>
        {holes.map((_, i) => (
          <TouchableOpacity
            key={i}
            style={[s.holeBtn, holeIndex === i && s.holeBtnActive]}
            onPress={() => setHoleIndex(i)}
            activeOpacity={0.7}
          >
            <Text style={[s.holeBtnText, holeIndex === i && s.holeBtnTextActive]}>{i + 1}</Text>
          </TouchableOpacity>
        ))}
      </View>

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
    </BottomSheet>
  );
}

function VideoPreview({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 36,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: theme.bg.secondary, marginBottom: 16, overflow: 'hidden' },
  sectionLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  holeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  holeBtn: {
    width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.secondary,
    borderWidth: 1, borderColor: theme.border.default,
  },
  holeBtnWide: { width: 76, paddingHorizontal: 4 },
  holeBtnActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  holeBtnText: { color: theme.text.primary, fontSize: 15, fontFamily: 'PlusJakartaSans-Bold' },
  holeBtnTextWide: { fontSize: 12, textAlign: 'center' },
  holeBtnTextActive: { color: theme.text.inverse },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.accent.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
