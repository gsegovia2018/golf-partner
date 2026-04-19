import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, FlatList, Dimensions, StyleSheet, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';
import { loadTournament } from '../store/tournamentStore';
import MediaLightbox from '../components/MediaLightbox';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import AttachMediaSheet from '../components/AttachMediaSheet';
import BatchAttachSheet from '../components/BatchAttachSheet';
import { pickMedia, attachMedia, attachManyMedia } from '../lib/mediaCapture';

const { width } = Dimensions.get('window');
const GAP = 4;
const PAD = 12;
const TILE = (width - PAD * 2 - GAP * 2) / 3;

export default function GalleryScreen({ route, navigation }) {
  const { tournamentId } = route.params ?? {};
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { items } = useTournamentMedia(tournamentId);
  const [tournament, setTournament] = useState(null);
  const [filter, setFilter] = useState({ kind: 'all' });
  const [holePickerVisible, setHolePickerVisible] = useState(false);
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });
  const [captureMenuVisible, setCaptureMenuVisible] = useState(false);
  const [singleAsset, setSingleAsset] = useState(null);
  const [batchAssets, setBatchAssets] = useState(null);

  useEffect(() => { loadTournament().then(setTournament); }, []);

  const defaultRoundIndex = useMemo(() => {
    if (!tournament?.rounds?.length) return 0;
    // If filter is pinned to a specific round, prefer that; else currentRound.
    if (filter.kind === 'round') return filter.roundIndex;
    return Math.min(tournament.currentRound ?? 0, tournament.rounds.length - 1);
  }, [tournament, filter]);

  const openAdd = useCallback(() => setCaptureMenuVisible(true), []);

  const handleCaptureSelect = useCallback(async ({ source, mediaTypes }) => {
    setCaptureMenuVisible(false);
    try {
      const result = await pickMedia({
        source,
        mediaTypes,
        multi: source === 'library',
      });
      if (!result) return;
      if (Array.isArray(result)) {
        if (result.length === 0) return;
        if (result.length === 1) setSingleAsset(result[0]);
        else setBatchAssets(result);
      } else {
        setSingleAsset(result);
      }
    } catch (e) {
      Alert.alert('No se pudo capturar', String(e?.message ?? e));
    }
  }, []);

  const onSingleConfirm = useCallback(async ({ holeIndex, caption, uploaderLabel }) => {
    const asset = singleAsset;
    setSingleAsset(null);
    if (!asset || !tournament) return;
    const round = tournament.rounds?.[defaultRoundIndex];
    if (!round) return;
    try {
      await attachMedia({
        tournamentId: tournament.id,
        roundId: round.id,
        holeIndex,
        kind: asset.kind,
        localUri: asset.localUri,
        durationS: asset.durationS,
        caption,
        uploaderLabel,
      });
    } catch (e) {
      Alert.alert('No se pudo adjuntar', String(e?.message ?? e));
    }
  }, [singleAsset, tournament, defaultRoundIndex]);

  const onBatchConfirm = useCallback(async (payload) => {
    setBatchAssets(null);
    if (!tournament) return;
    try {
      await attachManyMedia({ tournamentId: tournament.id, items: payload });
    } catch (e) {
      Alert.alert('No se pudieron adjuntar', String(e?.message ?? e));
    }
  }, [tournament]);

  const filtered = useMemo(() => {
    if (!tournament) return items;
    return items.filter((m) => {
      if (filter.kind === 'all') return true;
      if (filter.kind === 'round') {
        const round = tournament.rounds?.[filter.roundIndex];
        return round && m.roundId === round.id;
      }
      if (filter.kind === 'hole') return m.holeIndex === filter.hole;
      return true;
    });
  }, [items, filter, tournament]);

  const roundsCount = tournament?.rounds?.length ?? 3;
  const maxHoles = Math.max(...(tournament?.rounds?.map((r) => r.holes?.length ?? 18) ?? [18]));

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Recuerdos</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
        <Chip label="Todo" active={filter.kind === 'all'} onPress={() => setFilter({ kind: 'all' })} theme={theme} />
        {Array.from({ length: roundsCount }).map((_, i) => (
          <Chip
            key={i}
            label={`R${i + 1}`}
            active={filter.kind === 'round' && filter.roundIndex === i}
            onPress={() => setFilter({ kind: 'round', roundIndex: i })}
            theme={theme}
          />
        ))}
        <Chip
          label={filter.kind === 'hole' ? `Hoyo ${filter.hole + 1}` : 'Por hoyo'}
          active={filter.kind === 'hole'}
          onPress={() => setHolePickerVisible(true)}
          theme={theme}
        />
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(m) => m.id}
        numColumns={3}
        contentContainerStyle={s.grid}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={s.tile} onPress={() => setLightbox({ visible: true, index })}>
            <Image source={{ uri: item.thumbUrl }} style={s.thumb} />
            {item.kind === 'video' && (
              <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="image" size={32} color={theme.text.muted} />
            <Text style={s.emptyText}>Sin recuerdos para este filtro.</Text>
          </View>
        }
      />

      <Modal visible={holePickerVisible} transparent animationType="slide" onRequestClose={() => setHolePickerVisible(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Filtrar por hoyo</Text>
            <ScrollView contentContainerStyle={s.holeGrid}>
              {Array.from({ length: maxHoles }).map((_, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.holeBtn}
                  onPress={() => {
                    setFilter({ kind: 'hole', hole: i });
                    setHolePickerVisible(false);
                  }}
                >
                  <Text style={s.holeBtnLabel}>{i + 1}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.modalCancel} onPress={() => setHolePickerVisible(false)}>
              <Text style={s.modalCancelLabel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <MediaLightbox
        visible={lightbox.visible}
        items={filtered}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ visible: false, index: 0 })}
      />

      <TouchableOpacity style={s.fab} onPress={openAdd} accessibilityLabel="Añadir recuerdo" activeOpacity={0.85}>
        <Feather name="plus" size={26} color={theme.text.inverse} />
      </TouchableOpacity>

      <CaptureMenuSheet
        visible={captureMenuVisible}
        onSelect={handleCaptureSelect}
        onClose={() => setCaptureMenuVisible(false)}
      />
      <AttachMediaSheet
        visible={!!singleAsset}
        asset={singleAsset}
        holes={tournament?.rounds?.[defaultRoundIndex]?.holes ?? []}
        defaultHoleIndex={null}
        onCancel={() => setSingleAsset(null)}
        onConfirm={onSingleConfirm}
      />
      <BatchAttachSheet
        visible={!!batchAssets}
        assets={batchAssets ?? []}
        rounds={tournament?.rounds ?? []}
        defaultRoundIndex={defaultRoundIndex}
        onCancel={() => setBatchAssets(null)}
        onConfirm={onBatchConfirm}
      />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress, theme }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
        backgroundColor: active ? theme.accent.primary : theme.bg.secondary,
        marginRight: 6,
      }}
    >
      <Text style={{
        color: active ? theme.text.inverse : theme.text.primary,
        fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { padding: 4 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  chipsRow: { paddingHorizontal: 12, paddingVertical: 8 },
  grid: { padding: PAD },
  tile: { width: TILE, height: TILE, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg.secondary },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { marginTop: 8, color: theme.text.muted, fontFamily: 'PlusJakartaSans-Regular' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: theme.bg.primary, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary, marginBottom: 12 },
  holeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  holeBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary },
  holeBtnLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary },
  modalCancel: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  modalCancelLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary },
  fab: {
    position: 'absolute',
    right: 20, bottom: 28,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
