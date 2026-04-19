import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { subscribeSyncStatus, subscribeConflicts } from '../store/tournamentStore';
import SyncStatusSheet from './SyncStatusSheet';

const COLOR = {
  idle:    '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error:   '#b33a3a',
};

const BADGE_COLOR = '#c77a0a'; // ámbar, distinct from the error red

const LABEL = {
  idle: '',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Error',
};

export default function SyncStatusIcon() {
  const [status, setStatus] = useState('idle');
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const lastUnreadRef = useRef(0);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  // Seed `lastUnreadRef` from the FIRST subscribe callback (which carries
  // the persisted-on-disk unread count after AsyncStorage hydration). That
  // way the pulse effect sees `prev === unread` on its first run and does
  // not fire. Subsequent live deltas (prev=0 → n>0) fire normally.
  useEffect(() => {
    let seeded = false;
    return subscribeConflicts(({ unread: nextUnread }) => {
      if (!seeded) {
        seeded = true;
        lastUnreadRef.current = nextUnread;
      }
      setUnread(nextUnread);
    });
  }, []);

  // Fire a single pulse animation on genuine 0 → n transitions within a
  // running session. The hydration snapshot from AsyncStorage does not
  // trigger this because `lastUnreadRef` was pre-seeded above.
  useEffect(() => {
    const prev = lastUnreadRef.current;
    lastUnreadRef.current = unread;
    if (prev === 0 && unread > 0) {
      pulse.setValue(1);
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [unread, pulse]);

  const open = useCallback(() => setSheetOpen(true), []);
  const close = useCallback(() => setSheetOpen(false), []);

  const badge = unread > 0 ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
    </View>
  ) : null;

  const content = status === 'syncing'
    ? <ActivityIndicator size="small" color={COLOR.syncing} />
    : (
      <View style={styles.dotRow}>
        <Animated.View style={[
          styles.dot,
          { backgroundColor: COLOR[status], transform: [{ scale: pulse }] },
        ]} />
        {status !== 'idle' && <Text style={[styles.label, { color: COLOR[status] }]}>{LABEL[status]}</Text>}
      </View>
    );

  return (
    <>
      <Pressable onPress={open} style={styles.hit} hitSlop={10}>
        <View style={styles.container}>
          {content}
          {badge}
        </View>
      </Pressable>
      <SyncStatusSheet visible={sheetOpen} onClose={close} />
    </>
  );
}

const styles = StyleSheet.create({
  hit: { paddingHorizontal: 8, paddingVertical: 4 },
  container: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  dotRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 12, marginLeft: 6 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: BADGE_COLOR,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Bold',
    lineHeight: 12,
  },
});
