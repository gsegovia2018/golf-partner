import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useRoundMedia } from '../hooks/useRoundMedia';
import { retryFailedEntry } from '../lib/uploadWorker';

const TILE = 88;

export default function RoundMediaStrip({ roundId, onAdd, onOpenLightbox }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { items } = useRoundMedia(roundId);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Recuerdos de esta ronda</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        <TouchableOpacity style={[s.tile, s.addTile]} onPress={onAdd} accessibilityLabel="Añadir recuerdo">
          <Feather name="plus" size={28} color={theme.accent.primary} />
        </TouchableOpacity>
        {items.map((m, i) => (
          <TouchableOpacity
            key={m.id}
            style={s.tile}
            onPress={() => {
              if (m.status === 'failed') return retryFailedEntry(m.id);
              onOpenLightbox(items, i);
            }}
            accessibilityLabel={`Recuerdo ${i + 1}`}
          >
            <Image source={{ uri: m.thumbUrl }} style={s.thumb} />
            {m.kind === 'video' && (
              <View style={s.videoBadge}><Feather name="play" size={12} color="#fff" /></View>
            )}
            {m.status === 'uploading' && (
              <View style={s.overlay}><ActivityIndicator color="#fff" /></View>
            )}
            {m.status === 'failed' && (
              <View style={s.overlay}>
                <Feather name="alert-triangle" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { paddingVertical: 12 },
  title: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted,
           fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5,
           paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 16 },
  tile: { width: TILE, height: TILE, borderRadius: 10, marginRight: 8,
          overflow: 'hidden', backgroundColor: theme.bg.secondary },
  addTile: { alignItems: 'center', justifyContent: 'center',
             borderWidth: 1, borderStyle: 'dashed', borderColor: theme.accent.primary },
  thumb: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', bottom: 4, right: 4,
                backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
             alignItems: 'center', justifyContent: 'center' },
});
