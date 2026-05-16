import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';
import { getTournament } from '../store/tournamentStore';
import MediaLightbox from '../components/MediaLightbox';
import MemoriesRoundRow from '../components/MemoriesRoundRow';
import MemoriesHoleStrip from '../components/MemoriesHoleStrip';
import MemoriesKindChips from '../components/MemoriesKindChips';
import MemoryCard from '../components/MemoryCard';
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import AttachMediaSheet from '../components/AttachMediaSheet';
import BatchAttachSheet from '../components/BatchAttachSheet';
import {
  deriveRoundEntries,
  deriveHolesWithMedia,
  deriveMaxHoles,
  deriveKindCounts,
  applyFilters,
  resolveRoundIndex,
} from '../lib/memoriesGalleryData';
import { pickMedia, attachMedia, attachManyMedia } from '../lib/mediaCapture';

export default function GalleryScreen({ route, navigation }) {
  const { tournamentId } = route.params ?? {};
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { items } = useTournamentMedia(tournamentId);
  const [tournament, setTournament] = useState(null);
  // Tournament load lifecycle: 'loading' until getTournament settles, then
  // 'ready' or 'error'. The media hook has no loading state of its own, so
  // this drives the gallery's loading/error UI.
  const [loadState, setLoadState] = useState('loading');
  const [activeHole, setActiveHole] = useState(null);
  const [activeKind, setActiveKind] = useState('all');
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });
  const [stories, setStories] = useState({ visible: false, items: [], startIndex: 0 });
  const [captureMenuVisible, setCaptureMenuVisible] = useState(false);
  const [singleAsset, setSingleAsset] = useState(null);
  const [batchAssets, setBatchAssets] = useState(null);

  // Load the tournament the gallery was opened for — not whatever is the
  // active tournament. Opening a gallery from the feed targets a different
  // tournament than the one last opened.
  const loadTournament = useCallback(() => {
    let cancelled = false;
    setLoadState('loading');
    getTournament(tournamentId)
      .then((t) => {
        if (cancelled) return;
        setTournament(t);
        setLoadState(t ? 'ready' : 'error');
      })
      .catch(() => { if (!cancelled) setLoadState('error'); });
    return () => { cancelled = true; };
  }, [tournamentId]);

  useEffect(() => loadTournament(), [loadTournament]);

  const rounds = tournament?.rounds;
  const maxHoles = useMemo(() => deriveMaxHoles(rounds), [rounds]);
  const roundEntries = useMemo(() => deriveRoundEntries(items, rounds), [items, rounds]);
  const holesWithMedia = useMemo(() => deriveHolesWithMedia(items), [items]);
  const counts = useMemo(() => deriveKindCounts(items), [items]);
  const filtered = useMemo(
    () => applyFilters(items, { hole: activeHole, kind: activeKind }),
    [items, activeHole, activeKind],
  );

  // Height-aware masonry: instead of a fixed even/odd split (which leaves one
  // column lopsided when images vary in aspect), each card is placed in
  // whichever column is currently shorter. Card height is estimated from the
  // image aspect ratio so the running column heights stay close.
  const [leftCol, rightCol] = useMemo(() => {
    const L = []; const R = [];
    let hL = 0; let hR = 0;
    filtered.forEach((it, i) => {
      // Estimate relative card height: image area (1/aspect) plus a constant
      // for the caption/meta footer. Absolute units don't matter — only the
      // L vs R comparison does.
      const aspect = (it.width > 0 && it.height > 0) ? it.width / it.height : 1;
      const estHeight = (1 / Math.max(0.2, aspect)) + 0.35;
      if (hL <= hR) { L.push({ it, i }); hL += estHeight; }
      else { R.push({ it, i }); hR += estHeight; }
    });
    return [L, R];
  }, [filtered]);

  const defaultRoundIndex = useMemo(() => {
    if (!tournament?.rounds?.length) return 0;
    return Math.min(tournament.currentRound ?? 0, tournament.rounds.length - 1);
  }, [tournament]);

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
      Alert.alert('Could not capture', String(e?.message ?? e));
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
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
    } catch (e) {
      Alert.alert('Could not attach', String(e?.message ?? e));
    }
  }, [singleAsset, tournament, defaultRoundIndex]);

  const onBatchConfirm = useCallback(async (payload) => {
    setBatchAssets(null);
    if (!tournament) return;
    try {
      await attachManyMedia({ tournamentId: tournament.id, items: payload });
    } catch (e) {
      Alert.alert('Could not attach', String(e?.message ?? e));
    }
  }, [tournament]);

  const openCard = (filteredIndex) => setLightbox({ visible: true, index: filteredIndex });

  // Stories play through every round's media, not just the tapped round —
  // flatten all rounds in order and start at the tapped round's first photo.
  const openStories = (entry) => {
    const allItems = roundEntries.flatMap((e) => e?.items ?? []);
    const startIndex = Math.max(0, allItems.findIndex((m) => m.roundId === entry.roundId));
    setStories({ visible: true, items: allItems, startIndex });
  };

  // No filter active and no media at all → this is a brand-new gallery.
  const isFirstMemory =
    items.length === 0 && activeHole == null && activeKind === 'all';

  const renderBody = () => {
    if (loadState === 'loading') {
      return (
        <View style={s.stateBox}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={s.stateText}>Loading memories…</Text>
        </View>
      );
    }
    if (loadState === 'error') {
      return (
        <View style={s.stateBox}>
          <Feather name="alert-triangle" size={32} color={theme.text.muted} />
          <Text style={s.stateText}>Couldn't load this gallery.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={loadTournament} activeOpacity={0.85}>
            <Feather name="refresh-cw" size={14} color={theme.text.inverse} />
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        {/* A game is a single round — only multi-round tournaments need a
            round selector here. */}
        {rounds?.length > 1 ? (
          <MemoriesRoundRow
            entries={roundEntries}
            onOpenRound={openStories}
          />
        ) : null}

        <MemoriesHoleStrip
          maxHoles={maxHoles}
          holesWithMedia={holesWithMedia}
          activeHole={activeHole}
          onSelect={setActiveHole}
        />

        <MemoriesKindChips
          counts={counts}
          active={activeKind}
          onChange={setActiveKind}
        />

        {isFirstMemory ? (
          <View style={s.empty}>
            <Feather name="camera" size={34} color={theme.text.muted} />
            <Text style={s.emptyTitle}>No memories yet</Text>
            <Text style={s.emptyText}>
              Tap the + button below to add your first photo or video.
            </Text>
            <Feather
              name="arrow-down"
              size={20}
              color={theme.accent.primary}
              style={{ marginTop: 4 }}
            />
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="image" size={32} color={theme.text.muted} />
            <Text style={s.emptyText}>No memories for this filter.</Text>
          </View>
        ) : (
          <View style={s.mosaic}>
            <View style={s.col}>
              {leftCol.map(({ it, i }) => (
                <MemoryCard
                  key={it.id}
                  item={it}
                  roundIndex={resolveRoundIndex(it.roundId, rounds)}
                  onPress={() => openCard(i)}
                />
              ))}
            </View>
            <View style={s.col}>
              {rightCol.map(({ it, i }) => (
                <MemoryCard
                  key={it.id}
                  item={it}
                  roundIndex={resolveRoundIndex(it.roundId, rounds)}
                  onPress={() => openCard(i)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Memories</Text>
        <View style={{ width: 22 }} />
      </View>

      {renderBody()}

      <MediaLightbox
        visible={lightbox.visible}
        items={filtered}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ visible: false, index: 0 })}
      />

      <MemoriesStoriesViewer
        visible={stories.visible}
        items={stories.items}
        startIndex={stories.startIndex}
        rounds={rounds}
        onClose={() => setStories({ visible: false, items: [], startIndex: 0 })}
      />

      <TouchableOpacity style={s.fab} onPress={openAdd} accessibilityLabel="Add memory" activeOpacity={0.85}>
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

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { padding: 4 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  scroll: { paddingTop: 8, paddingBottom: 32, gap: 10 },
  mosaic: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  col: { flex: 1, gap: 6 },
  stateBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40,
  },
  stateText: {
    color: theme.text.muted, fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13, textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4,
    backgroundColor: theme.accent.primary, borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  retryText: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 13,
  },
  empty: { paddingVertical: 60, alignItems: 'center', gap: 8, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary },
  emptyText: {
    color: theme.text.muted,
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, textAlign: 'center',
  },
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
