import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { findParForHole } from '../lib/memoriesGalleryData';

const PHOTO_MS = 4000;
const TICK_MS = 50;
// Drag distance past which a downward swipe dismisses the viewer.
const DISMISS_DISTANCE = 120;

// `items` is a flat, chronologically ordered list of media across every
// round; `startIndex` is where playback begins (the round the user tapped).
// Playback continues across round boundaries, so opening one round's story
// shows the whole tournament's memories.
export default function MemoriesStoriesViewer({ visible, items = [], startIndex = 0, rounds, onClose }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const longPressedRef = useRef(false);
  // Accumulated photo elapsed time (ms) across pause/resume cycles, so a
  // resume continues from where it stopped instead of replaying the full 4s.
  const elapsedRef = useRef(0);
  const dragY = useRef(new Animated.Value(0)).current;

  const current = items[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(startIndex);
    setProgress(0);
    setPaused(false);
    elapsedRef.current = 0;
    dragY.setValue(0);
  }, [visible, startIndex, dragY]);

  // New item → reset progress and the elapsed accumulator.
  useEffect(() => {
    setProgress(0);
    elapsedRef.current = 0;
    setBuffering(current?.kind === 'video');
  }, [index, current?.kind]);

  // Photo auto-advance timer. Tracks accumulated elapsed time in elapsedRef
  // so pausing (long-press) and resuming preserves progress: each run adds
  // (now - runStart) to the elapsed total rather than restarting from 0.
  useEffect(() => {
    if (!visible || paused || buffering || !current || current.kind !== 'photo') return;
    const runStart = Date.now();
    const id = setInterval(() => {
      const total = elapsedRef.current + (Date.now() - runStart);
      const p = Math.min(1, total / PHOTO_MS);
      setProgress(p);
      if (p >= 1) advance();
    }, TICK_MS);
    return () => {
      // Banking the elapsed time of this run so a resume continues from here.
      elapsedRef.current += Date.now() - runStart;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paused, buffering, index, current?.id]);

  // Swipe-down-to-dismiss. A predominantly-vertical downward drag tracks the
  // content; releasing past the threshold closes, otherwise it springs back.
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5,
    onPanResponderMove: (_e, g) => {
      if (g.dy > 0) dragY.setValue(g.dy);
    },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > DISMISS_DISTANCE || g.vy > 0.8) {
        onClose();
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [dragY, onClose]);

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

  // Each item carries its own roundId — resolve the round it belongs to so
  // the header label and par update as playback crosses round boundaries.
  const curRoundIndex = rounds ? rounds.findIndex((r) => r.id === current.roundId) : -1;
  const curRound = curRoundIndex >= 0 ? rounds[curRoundIndex] : null;
  const par = findParForHole(curRound, current.holeIndex);
  const holeLabel =
    current.holeIndex == null
      ? null
      : par != null
        ? `Hole ${current.holeIndex + 1} · Par ${par}`
        : `Hole ${current.holeIndex + 1}`;
  const time = (() => {
    try {
      return new Date(current.createdAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  })();

  // The progress bar is segmented PER ROUND, not per global media item — a
  // tournament with 60+ photos would otherwise render 60+ unreadable slivers.
  // Each round is one segment; the active round's segment fills with the
  // round's own item-by-item progress.
  const roundSegments = useMemo(() => {
    const segs = [];
    let prevRoundId;
    items.forEach((m, i) => {
      if (m.roundId !== prevRoundId) {
        segs.push({ roundId: m.roundId, start: i, count: 0 });
        prevRoundId = m.roundId;
      }
      segs[segs.length - 1].count += 1;
    });
    return segs;
  }, [items]);

  const activeSegmentIndex = roundSegments.findIndex(
    (seg) => index >= seg.start && index < seg.start + seg.count,
  );

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <Animated.View
        style={[s.container, { transform: [{ translateY: dragY }] }]}
        {...panResponder.panHandlers}
      >
        {current.kind === 'photo' ? (
          <ExpoImage
            source={{ uri: current.url }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
            onLoadStart={() => setBuffering(true)}
            onLoad={() => setBuffering(false)}
            onError={() => setBuffering(false)}
          />
        ) : (
          <StoryVideo
            uri={current.url}
            paused={paused}
            onProgress={setProgress}
            onFinished={advance}
            onBuffering={setBuffering}
          />
        )}

        {buffering ? (
          <View style={s.bufferWrap} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}

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
          {roundSegments.map((seg, i) => {
            let fill = 0;
            if (i < activeSegmentIndex) fill = 1;
            else if (i === activeSegmentIndex) {
              // Within the active round: completed items + the current item's
              // own progress, normalised over the round's item count.
              const doneInRound = index - seg.start;
              fill = seg.count > 0 ? (doneInRound + progress) / seg.count : 0;
            }
            return (
              <View key={seg.roundId ?? `seg-${i}`} style={s.bar}>
                <View style={[s.barFill, { width: `${Math.min(1, fill) * 100}%` }]} />
              </View>
            );
          })}
        </View>

        <View style={[s.top, { top: insets.top + 20 }]} pointerEvents="box-none">
          <View style={s.topLeft} pointerEvents="none">
            <Text style={s.topLabel}>
              R{curRoundIndex >= 0 ? curRoundIndex + 1 : '?'}
              {curRound?.courseName ? ` · ${curRound.courseName}` : ''}
              {` · ${index + 1}/${items.length}`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={s.closeBtn}
            accessibilityLabel="Close"
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
      </Animated.View>
    </Modal>
  );
}

function StoryVideo({ uri, paused, onProgress, onFinished, onBuffering }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

  // Surface the player's buffering/loading state so the viewer can show a
  // spinner until the video is actually ready to play.
  useEffect(() => {
    const sub = player.addListener?.('statusChange', (status) => {
      const value = status?.status ?? status;
      onBuffering(value === 'loading' || value === 'idle');
    });
    return () => { sub?.remove?.(); };
  }, [player, onBuffering]);

  // expo-video doesn't expose a per-frame callback, so we poll currentTime
  // against duration to drive the progress bar and advance when finished.
  useEffect(() => {
    const id = setInterval(() => {
      const total = player.duration;
      const pos = player.currentTime;
      if (!Number.isFinite(total) || total <= 0) return;
      const p = Math.min(1, pos / total);
      onProgress(p);
      if (p >= 0.999) onFinished();
    }, 120);
    return () => clearInterval(id);
  }, [player, onProgress, onFinished]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFillObject}
      contentFit="contain"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  tapRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 2 },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  bufferWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', zIndex: 5,
  },
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
