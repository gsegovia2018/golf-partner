import React, { useState, useRef, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Dimensions, FlatList, Alert, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme/ThemeContext';
import { deleteMedia } from '../store/mediaStore';
import { removeQueueEntry } from '../store/mediaQueue';

const { width, height } = Dimensions.get('window');

export default function MediaLightbox({ visible, items, initialIndex, onClose }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [index, setIndex] = useState(initialIndex ?? 0);

  useEffect(() => { if (visible) setIndex(initialIndex ?? 0); }, [visible, initialIndex]);

  const current = items?.[index];
  if (!visible || !current) return null;

  const onShare = async () => {
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(current.url);
  };

  const onDelete = () => {
    const proceed = async () => {
      try {
        if (current.status === 'uploading' || current.status === 'failed') {
          await removeQueueEntry(current.id);
        } else {
          await deleteMedia(current);
        }
        onClose();
      } catch (e) {
        Alert.alert('Error', String(e?.message ?? e));
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm('¿Borrar este recuerdo? No se puede deshacer.')) proceed();
    } else {
      Alert.alert('Borrar recuerdo', 'No se puede deshacer.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: proceed },
      ]);
    }
  };

  const formatHole = (i) => (i == null ? null : `Hoyo ${i + 1}`);
  const formatDate = (iso) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={s.container}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(i);
          }}
          renderItem={({ item, index: i }) => (
            <LightboxItem item={item} active={i === index} styles={s} />
          )}
        />

        <View style={[s.topBar, { top: insets.top + 12 }]}>
          <TouchableOpacity onPress={onClose} style={s.iconBtn} accessibilityLabel="Cerrar">
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={s.topActions}>
            {current.status === 'uploaded' && (
              <TouchableOpacity onPress={onShare} style={s.iconBtn} accessibilityLabel="Compartir">
                <Feather name="share" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onDelete} style={s.iconBtn} accessibilityLabel="Borrar">
              <Feather name="trash-2" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[s.footer, { bottom: insets.bottom + 24 }]}>
          {formatHole(current.holeIndex) && <Text style={s.hole}>{formatHole(current.holeIndex)}</Text>}
          {current.caption && <Text style={s.caption}>{current.caption}</Text>}
          <Text style={s.meta}>
            {formatDate(current.createdAt)}
            {current.uploaderLabel ? ` · ${current.uploaderLabel}` : ''}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function LightboxItem({ item, active, styles }) {
  if (item.kind === 'photo') {
    return (
      <View style={{ width, height }}>
        <ExpoImage source={{ uri: item.url }} style={styles.media} contentFit="contain" />
      </View>
    );
  }
  return (
    <View style={{ width, height }}>
      <LightboxVideo uri={item.url} active={active} style={styles.media} />
    </View>
  );
}

function LightboxVideo({ uri, active, style }) {
  // muted on first load so browsers don't block autoplay on web; the
  // native controls let the user unmute. When the item scrolls out of
  // view we pause it so audio doesn't bleed from off-screen pages.
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = true;
  });
  useEffect(() => {
    if (active) {
      try { player.play(); } catch (_) { /* autoplay may still be blocked; controls remain */ }
    } else {
      player.pause();
    }
  }, [active, player]);
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="contain"
      nativeControls
      allowsFullscreen
      allowsPictureInPicture={false}
    />
  );
}

const makeStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { width: '100%', height: '100%' },
  topBar: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16,
            flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
             backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999 },
  footer: { position: 'absolute', left: 16, right: 16, zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 12 },
  hole: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, marginBottom: 4 },
  caption: { color: '#fff', fontFamily: 'PlusJakartaSans-Regular', fontSize: 15, marginBottom: 4 },
  meta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'PlusJakartaSans-Regular', fontSize: 12 },
});
