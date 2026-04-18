import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useTournamentMedia } from '../hooks/useTournamentMedia';

const { width } = Dimensions.get('window');
const GAP = 4;
const HORIZONTAL_PAD = 16;
const TILE = (width - HORIZONTAL_PAD * 2 - GAP * 2) / 3;

export default function TournamentMemoriesSection({ tournamentId, onOpenGallery, onOpenLightbox }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { items } = useTournamentMedia(tournamentId);
  const visible = items.slice(0, 9);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Recuerdos</Text>
      {visible.length === 0 ? (
        <View style={s.empty}>
          <Feather name="image" size={28} color={theme.text.muted} />
          <Text style={s.emptyText}>Aún no hay recuerdos. Adjunta fotos o videos desde la ronda.</Text>
        </View>
      ) : (
        <>
          <View style={s.grid}>
            {visible.map((m, i) => (
              <TouchableOpacity
                key={m.id}
                style={[s.tile, (i + 1) % 3 === 0 ? null : s.tileGap]}
                onPress={() => onOpenLightbox(items, i)}
              >
                <Image source={{ uri: m.thumbUrl }} style={s.thumb} />
                {m.kind === 'video' && (
                  <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          {items.length > 9 && (
            <TouchableOpacity style={s.more} onPress={onOpenGallery}>
              <Text style={s.moreLabel}>Ver todos los {items.length}</Text>
              <Feather name="chevron-right" size={16} color={theme.accent.primary} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingHorizontal: HORIZONTAL_PAD, paddingVertical: 16 },
  title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary, marginBottom: 12 },
  empty: { padding: 20, alignItems: 'center', backgroundColor: theme.bg.secondary, borderRadius: 12 },
  emptyText: { color: theme.text.muted, fontFamily: 'PlusJakartaSans-Regular', textAlign: 'center', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: GAP },
  tile: { width: TILE, height: TILE, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg.secondary },
  tileGap: { marginRight: GAP },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          marginTop: 12, paddingVertical: 8 },
  moreLabel: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold', marginRight: 4 },
});
