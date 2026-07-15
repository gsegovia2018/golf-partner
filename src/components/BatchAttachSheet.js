import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Image, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import WheelPicker from './WheelPicker';

const UPLOADER_KEY = '@golf_uploader_label';

export default function BatchAttachSheet({
  visible,
  assets,
  rounds,
  defaultRoundIndex,
  onCancel,
  onConfirm,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [roundIndex, setRoundIndex] = useState(defaultRoundIndex ?? 0);
  // Header hole wheel: index 0 is "No hole"; hole N is wheel index N.
  const [batchHoleWheelIndex, setBatchHoleWheelIndex] = useState(0);
  const [batchCaption, setBatchCaption] = useState('');
  const [perItem, setPerItem] = useState([]);
  const [uploader, setUploader] = useState('');

  useEffect(() => {
    if (!visible) return;
    setRoundIndex(defaultRoundIndex ?? 0);
    setBatchHoleWheelIndex(0);
    setBatchCaption('');
    setPerItem((assets ?? []).map(() => ({ holeOverride: undefined, captionOverride: undefined })));
    AsyncStorage.getItem(UPLOADER_KEY).then((v) => setUploader(v ?? ''));
  }, [visible, assets, defaultRoundIndex]);

  const round = rounds?.[roundIndex];
  const holes = round?.holes ?? [];

  const batchHole = batchHoleWheelIndex === 0 ? null : batchHoleWheelIndex - 1;

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

  const onRoundChange = (i) => {
    setRoundIndex(i);
    const nextHoles = rounds?.[i]?.holes ?? [];
    if (batchHoleWheelIndex - 1 >= nextHoles.length) setBatchHoleWheelIndex(0);
  };

  const effective = useMemo(() => (assets ?? []).map((a, i) => {
    const p = perItem[i] ?? {};
    return {
      asset: a,
      holeIndex: p.holeOverride !== undefined ? p.holeOverride : batchHole,
      caption: p.captionOverride !== undefined ? p.captionOverride : batchCaption,
      holeOverridden: p.holeOverride !== undefined,
      captionOverridden: p.captionOverride !== undefined,
    };
  }), [assets, perItem, batchHole, batchCaption]);

  if (!assets?.length) return null;

  const setItemHole = (i, hole) => {
    setPerItem((prev) => prev.map((p, idx) => idx === i ? { ...p, holeOverride: hole } : p));
  };
  const clearItemHole = (i) => {
    setPerItem((prev) => prev.map((p, idx) => idx === i ? { ...p, holeOverride: undefined } : p));
  };
  const setItemCaption = (i, caption) => {
    setPerItem((prev) => prev.map((p, idx) => idx === i ? { ...p, captionOverride: caption } : p));
  };
  const clearItemCaption = (i) => {
    setPerItem((prev) => prev.map((p, idx) => idx === i ? { ...p, captionOverride: undefined } : p));
  };

  const submit = async () => {
    if (!round) return;
    if (uploader) await AsyncStorage.setItem(UPLOADER_KEY, uploader);
    const payload = effective.map((e) => ({
      asset: e.asset,
      roundId: round.id,
      holeIndex: e.holeIndex,
      caption: (e.caption ?? '').trim() || null,
      uploaderLabel: uploader.trim() || null,
    }));
    onConfirm(payload);
  };

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={s.sheet}>
      <View style={s.header}>
            <Text style={s.title}>Attach {assets.length} {assets.length === 1 ? 'memory' : 'memories'}</Text>
            <TouchableOpacity onPress={onCancel} accessibilityLabel="Cancel">
              <Feather name="x" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={s.sectionLabel}>Apply to all — round &amp; hole</Text>
            <View style={s.wheels}>
              {(rounds?.length ?? 0) > 1 ? (
                <WheelPicker
                  testID="batch-round-wheel"
                  items={roundItems}
                  selectedIndex={roundIndex}
                  onChange={onRoundChange}
                />
              ) : null}
              <WheelPicker
                testID="batch-hole-wheel"
                items={holeItems}
                selectedIndex={batchHoleWheelIndex}
                onChange={setBatchHoleWheelIndex}
              />
            </View>

            <Text style={s.sectionLabel}>Apply to all — caption</Text>
            <TextInput
              style={s.input}
              value={batchCaption}
              onChangeText={setBatchCaption}
              placeholder="e.g. Sunday on 18"
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

            <Text style={[s.sectionLabel, { marginTop: 18 }]}>Per-photo detail</Text>
            {effective.map((e, i) => (
              <View key={i} style={s.itemRow}>
                <Image source={{ uri: e.asset.localUri }} style={s.itemThumb} />
                {e.asset.kind === 'video' && (
                  <View style={s.videoBadge}><Feather name="play" size={10} color="#fff" /></View>
                )}
                <View style={s.itemMain}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                    <Chip
                      label={e.holeIndex == null ? 'No hole' : `Hole ${e.holeIndex + 1}`}
                      active={e.holeOverridden}
                      muted={!e.holeOverridden}
                      onPress={() => {
                        if (e.holeOverridden) clearItemHole(i);
                        else setItemHole(i, (e.holeIndex ?? 0));
                      }}
                      theme={theme}
                    />
                    {e.holeOverridden && (
                      <TouchableOpacity style={s.resetBtn} onPress={() => clearItemHole(i)}>
                        <Feather name="rotate-ccw" size={12} color={theme.text.muted} />
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                  {e.holeOverridden && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                      <Chip label="No hole" active={e.holeIndex == null} onPress={() => setItemHole(i, null)} theme={theme} small />
                      {holes.map((_, h) => (
                        <Chip
                          key={h}
                          label={String(h + 1)}
                          active={e.holeIndex === h}
                          onPress={() => setItemHole(i, h)}
                          theme={theme}
                          small
                        />
                      ))}
                    </ScrollView>
                  )}
                  <View style={s.captionWrap}>
                    <TextInput
                      style={[s.input, s.captionInput, e.captionOverridden && s.inputOverridden]}
                      value={e.caption ?? ''}
                      onChangeText={(v) => setItemCaption(i, v)}
                      placeholder="Caption for this one"
                      placeholderTextColor={theme.text.muted}
                    />
                    {e.captionOverridden && (
                      <TouchableOpacity style={s.resetBtn} onPress={() => clearItemCaption(i)}>
                        <Feather name="rotate-ccw" size={14} color={theme.text.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity style={s.saveBtn} onPress={submit}>
            <Text style={s.saveLabel}>Save {assets.length}</Text>
          </TouchableOpacity>
    </BottomSheet>
  );
}

function Chip({ label, active, onPress, theme, small, muted }) {
  const s = makeChipStyles(theme, active, small, muted);
  return (
    <TouchableOpacity style={s.chip} onPress={onPress}>
      <Text style={s.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeChipStyles = (theme, active, small, muted) => StyleSheet.create({
  chip: {
    paddingHorizontal: small ? 10 : 12,
    paddingVertical: small ? 4 : 6,
    borderRadius: 999,
    backgroundColor: active ? theme.accent.primary : (muted ? 'transparent' : theme.bg.secondary),
    borderWidth: muted ? 1 : 0,
    borderColor: theme.border.subtle,
    marginRight: 6,
  },
  label: {
    color: active ? theme.text.inverse : theme.text.primary,
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: small ? 12 : 13,
  },
});

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary,
    padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12,
    color: theme.text.muted, marginTop: 12, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  chipsRow: { paddingVertical: 4 },
  wheels: { flexDirection: 'row', gap: 10 },
  input: {
    borderWidth: 1, borderColor: theme.border.subtle, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Regular',
  },
  inputOverridden: { borderColor: theme.accent.primary },
  captionInput: { flex: 1 },
  captionWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    gap: 10,
  },
  itemThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: theme.bg.secondary },
  itemMain: { flex: 1 },
  videoBadge: {
    position: 'absolute', left: 42, top: 42,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 3,
  },
  resetBtn: { padding: 6 },
  saveBtn: {
    marginTop: 12, backgroundColor: theme.accent.primary,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  saveLabel: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16 },
});
