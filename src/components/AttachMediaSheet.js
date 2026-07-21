import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import WheelPicker from './WheelPicker';
import IconButton from './ui/IconButton';

const UPLOADER_KEY = '@golf_uploader_label';

// A stale feed item's roundIndex can exceed the loaded tournament's rounds
// (e.g. a round was removed). Clamp so `rounds[roundIndex]` is always
// defined instead of silently producing an undefined round downstream.
const clampRoundIndex = (index, rounds) =>
  Math.min(Math.max(0, index ?? 0), Math.max(0, (rounds?.length ?? 1) - 1));

export default function AttachMediaSheet({
  visible, asset, rounds, defaultRoundIndex, defaultHoleIndex, onCancel, onConfirm,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [roundIndex, setRoundIndex] = useState(clampRoundIndex(defaultRoundIndex, rounds));
  // Hole wheel index 0 is "No hole"; hole N is wheel index N.
  const [holeWheelIndex, setHoleWheelIndex] = useState((defaultHoleIndex ?? -1) + 1);
  const [caption, setCaption] = useState('');
  const [uploader, setUploader] = useState('');

  useEffect(() => {
    if (!visible) return;
    // Set the raw index here (not clamped against `rounds`) so this effect
    // doesn't depend on `rounds` — ScorecardScreen replaces the tournament
    // object (and `rounds` identity) on background realtime syncs, and we
    // don't want that to reset the sheet mid-edit. `rounds` is instead
    // clamped at use-site via `safeRoundIndex` below.
    setRoundIndex(defaultRoundIndex ?? 0);
    setHoleWheelIndex((defaultHoleIndex ?? -1) + 1);
    setCaption('');
    AsyncStorage.getItem(UPLOADER_KEY).then((v) => setUploader(v ?? ''));
  }, [visible, defaultRoundIndex, defaultHoleIndex]);

  const safeRoundIndex = clampRoundIndex(roundIndex, rounds);
  const round = rounds?.[safeRoundIndex];
  const holes = round?.holes ?? [];

  const roundItems = useMemo(() => (rounds ?? []).map((r, i) => ({
    key: r.id ?? String(i),
    label: `R${i + 1}`,
    sublabel: r.courseName || undefined,
  })), [rounds]);

  const holeItems = useMemo(() => [
    { key: 'none', label: 'No hole' },
    ...holes.map((h, i) => ({
      key: String(i),
      label: `Hole ${i + 1}`,
      sublabel: h?.par ? `Par ${h.par}` : undefined,
    })),
  ], [holes]);

  if (!asset) return null;

  const onRoundChange = (i) => {
    setRoundIndex(i);
    const nextHoles = rounds?.[i]?.holes ?? [];
    // The previously picked hole may not exist on the new round.
    if (holeWheelIndex - 1 >= nextHoles.length) setHoleWheelIndex(0);
  };

  const submit = async () => {
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    onConfirm({
      roundIndex: safeRoundIndex,
      roundId: round?.id ?? null,
      holeIndex: holeWheelIndex === 0 ? null : holeWheelIndex - 1,
      caption: caption.trim() || null,
      uploaderLabel: uploader.trim() || null,
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>Add photo</Text>
        <IconButton icon="x" onPress={onCancel} accessibilityLabel="Cancel" />
      </View>

      {asset.kind === 'photo' ? (
        <Image source={{ uri: asset.localUri }} style={s.preview} resizeMode="cover" />
      ) : (
        <VideoPreview uri={asset.localUri} style={s.preview} />
      )}

      <Text style={s.sectionLabel}>Round &amp; hole</Text>
      <View style={s.wheels}>
        {(rounds?.length ?? 0) > 1 ? (
          <WheelPicker
            testID="attach-round-wheel"
            items={roundItems}
            selectedIndex={safeRoundIndex}
            onChange={onRoundChange}
          />
        ) : null}
        <WheelPicker
          testID="attach-hole-wheel"
          items={holeItems}
          selectedIndex={holeWheelIndex}
          onChange={setHoleWheelIndex}
        />
      </View>

      <Text style={s.sectionLabel}>Caption (optional)</Text>
      <TextInput
        style={s.input}
        value={caption}
        onChangeText={setCaption}
        placeholder="e.g. Bunker drama on 7"
        placeholderTextColor={theme.text.muted}
      />

      <Text style={s.sectionLabel}>Your name (optional)</Text>
      <TextInput
        style={s.input}
        value={uploader}
        onChangeText={setUploader}
        placeholder="e.g. Noé"
        placeholderTextColor={theme.text.muted}
      />

      <TouchableOpacity style={s.saveBtn} onPress={submit}>
        <Text style={s.saveLabel}>Save</Text>
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
  wheels: { flexDirection: 'row', gap: 10 },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  saveBtn: { marginTop: 20, backgroundColor: theme.accent.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
