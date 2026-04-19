import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { findParForHole } from '../lib/memoriesGalleryData';

const PHOTO_MS = 4000;
const TICK_MS = 50;

export default function MemoriesStoriesViewer({ visible, entry, round, onClose }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const longPressedRef = useRef(false);
  const videoRef = useRef(null);

  const items = entry?.items ?? [];
  const current = items[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    setProgress(0);
    setPaused(false);
  }, [visible, entry?.roundId]);

  useEffect(() => { setProgress(0); }, [index]);

  useEffect(() => {
    if (!visible || paused || !current || current.kind !== 'photo') return;
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / PHOTO_MS);
      setProgress(p);
      if (p >= 1) advance();
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused, index, current?.id]);

  if (!visible || !current) return null;

  const advance = () => {
    if (index + 1 >= items.length) onClose();
    else setIndex((i) => i + 1);
  };

  const back = () => {
    if (index > 0) setIndex((i) => i - 1);
  };

  const onLongPress = () => { longPressedRef.current = true; setPaused(true); };
  const onPressOut = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      setPaused(false);
    }
  };

  const par = findParForHole(round, current.holeIndex);
  const holeLabel =
    current.holeIndex == null
      ? null
      : par != null
        ? `Hoyo ${current.holeIndex + 1} · Par ${par}`
        : `Hoyo ${current.holeIndex + 1}`;
  const time = (() => {
    try {
      return new Date(current.createdAt).toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  })();

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={s.container}>
        {current.kind === 'photo' ? (
          <ExpoImage
            source={{ uri: current.url }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
          />
        ) : (
          <Video
            ref={videoRef}
            source={{ uri: current.url }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={!paused}
            isLooping={false}
            onPlaybackStatusUpdate={(st) => {
              if (!st.isLoaded) return;
              const total = st.durationMillis ?? 0;
              const pos = st.positionMillis ?? 0;
              if (total > 0) setProgress(Math.min(1, pos / total));
              if (st.didJustFinish) advance();
            }}
          />
        )}

        <View style={s.tapRow} pointerEvents="box-none">
          <Pressable
            style={s.tapLeft}
            onPress={back}
            onLongPress={onLongPress}
            onPressOut={onPressOut}
            delayLongPress={180}
          />
          <Pressable
            style={s.tapRight}
            onPress={advance}
            onLongPress={onLongPress}
            onPressOut={onPressOut}
            delayLongPress={180}
          />
        </View>

        <View style={[s.bars, { top: insets.top + 10 }]} pointerEvents="none">
          {items.map((_, i) => {
            const fill = i < index ? 1 : i === index ? progress : 0;
            return (
              <View key={i} style={s.bar}>
                <View style={[s.barFill, { width: `${fill * 100}%` }]} />
              </View>
            );
          })}
        </View>

        <View style={[s.top, { top: insets.top + 20 }]} pointerEvents="box-none">
          <View style={s.topLeft} pointerEvents="none">
            <Text style={s.topLabel}>
              R{(entry?.roundIndex ?? 0) + 1}
              {entry?.courseName ? ` · ${entry.courseName}` : ''}
              {` · ${index + 1}/${items.length}`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={s.closeBtn}
            accessibilityLabel="Cerrar"
            hitSlop={12}
          >
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[s.footer, { bottom: insets.bottom + 24 }]} pointerEvents="none">
          {holeLabel ? (
            <View style={s.holeChip}><Text style={s.holeChipText}>{holeLabel}</Text></View>
          ) : null}
          {current.caption ? (
            <Text style={s.caption} numberOfLines={3}>{current.caption}</Text>
          ) : null}
          <Text style={s.meta}>
            {current.uploaderLabel ? `${current.uploaderLabel} · ${time}` : time}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  tapRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 2 },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  bars: {
    position: 'absolute', left: 8, right: 8,
    flexDirection: 'row', gap: 3, zIndex: 10,
  },
  bar: { flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 99, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#fff' },
  top: {
    position: 'absolute', left: 12, right: 12, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  topLeft: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99,
  },
  topLabel: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 99,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  footer: {
    position: 'absolute', left: 16, right: 16, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 12,
  },
  holeChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99,
    marginBottom: 6,
  },
  holeChipText: { color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  caption: { color: '#fff', fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, marginBottom: 4 },
  meta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'PlusJakartaSans-Regular', fontSize: 11 },
});
