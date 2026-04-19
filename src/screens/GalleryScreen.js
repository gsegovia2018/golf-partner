import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';
import { loadTournament } from '../store/tournamentStore';
import MediaLightbox from '../components/MediaLightbox';
import MemoriesRoundRow from '../components/MemoriesRoundRow';
import MemoriesHoleStrip from '../components/MemoriesHoleStrip';
import MemoriesKindChips from '../components/MemoriesKindChips';
import MemoryCard from '../components/MemoryCard';
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';
import {
  deriveRoundEntries,
  deriveHolesWithMedia,
  deriveMaxHoles,
  deriveKindCounts,
  applyFilters,
  resolveRoundIndex,
} from '../lib/memoriesGalleryData';

export default function GalleryScreen({ route, navigation }) {
  const { tournamentId } = route.params ?? {};
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { items } = useTournamentMedia(tournamentId);
  const [tournament, setTournament] = useState(null);
  const [activeHole, setActiveHole] = useState(null);
  const [activeKind, setActiveKind] = useState('all');
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });
  const [stories, setStories] = useState({ visible: false, entry: null });

  useEffect(() => { loadTournament().then(setTournament); }, []);

  const rounds = tournament?.rounds;
  const maxHoles = useMemo(() => deriveMaxHoles(rounds), [rounds]);
  const roundEntries = useMemo(() => deriveRoundEntries(items, rounds), [items, rounds]);
  const holesWithMedia = useMemo(() => deriveHolesWithMedia(items), [items]);
  const counts = useMemo(() => deriveKindCounts(items), [items]);
  const filtered = useMemo(
    () => applyFilters(items, { hole: activeHole, kind: activeKind }),
    [items, activeHole, activeKind],
  );

  const [leftCol, rightCol] = useMemo(() => {
    const L = []; const R = [];
    filtered.forEach((it, i) => { (i % 2 === 0 ? L : R).push({ it, i }); });
    return [L, R];
  }, [filtered]);

  const openCard = (filteredIndex) => setLightbox({ visible: true, index: filteredIndex });

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Recuerdos</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.subtitle}>
          {items.length} · {tournament?.name ?? ''}
        </Text>

        {rounds?.length ? (
          <MemoriesRoundRow
            entries={roundEntries}
            onOpenRound={(entry) => setStories({ visible: true, entry })}
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

        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="image" size={32} color={theme.text.muted} />
            <Text style={s.emptyText}>Sin recuerdos para este filtro.</Text>
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

      <MediaLightbox
        visible={lightbox.visible}
        items={filtered}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ visible: false, index: 0 })}
      />

      <MemoriesStoriesViewer
        visible={stories.visible}
        entry={stories.entry}
        round={rounds?.[stories.entry?.roundIndex ?? -1] ?? null}
        onClose={() => setStories({ visible: false, entry: null })}
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
  scroll: { paddingBottom: 32, gap: 10 },
  subtitle: {
    paddingHorizontal: 16, marginTop: -4, marginBottom: 4,
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted,
  },
  mosaic: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  col: { flex: 1, gap: 6 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: {
    marginTop: 8, color: theme.text.muted,
    fontFamily: 'PlusJakartaSans-Regular',
  },
});
