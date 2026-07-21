import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import IconButton from './ui/IconButton';
import {
  subscribeSyncStatus,
  subscribeConflicts,
  markConflictsRead,
} from '../store/tournamentStore';
import { syncQueue } from '../store/syncQueue';
import { retrySync } from '../store/syncWorker';

const STATE_LABEL = {
  idle: 'Al día',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Error',
};

const STATE_COLOR = {
  idle: '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error: '#b33a3a',
};

function formatRelative(ts) {
  if (!ts) return 'nunca';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'hace instantes';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  return `hace ${day} d`;
}

export default function SyncStatusSheet({ visible, onClose }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [status, setStatus] = useState('idle');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const offStatus = subscribeSyncStatus(setStatus);
    const offConflicts = subscribeConflicts(({ lastSyncAt: nextTs }) => {
      setLastSyncAt(nextTs);
    });
    return () => { offStatus(); offConflicts(); };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    markConflictsRead().catch(() => {});
    syncQueue.all().then((all) => setPending(all.length)).catch(() => setPending(0));
  }, [visible]);

  const onRetry = useCallback(() => { retrySync(); }, []);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
        <View style={s.header}>
          <Text style={s.title}>Sincronización</Text>
          <IconButton icon="x" onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} />
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          <Text style={s.sectionTitle}>Estado</Text>
          <View style={s.row}>
            <View style={[s.dot, { backgroundColor: STATE_COLOR[status] }]} />
            <Text style={s.stateLabel}>{STATE_LABEL[status]}</Text>
          </View>
          <Text style={s.meta}>Pendientes: {pending}</Text>
          <Text style={s.meta}>Último sync: {formatRelative(lastSyncAt)}</Text>
          {(status === 'error' || status === 'pending') && (
            <TouchableOpacity onPress={onRetry} style={s.retry}>
              <Text style={s.retryLabel}>Reintentar</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
    </BottomSheet>
  );
}

const makeStyles = (t) => StyleSheet.create({
  sheet: {
    backgroundColor: t.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
    borderTopWidth: 1, borderColor: t.border.default,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.border.default,
    alignSelf: 'center', marginTop: 10,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  title: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 17 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: t.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  stateLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 16, color: t.text.primary },
  meta: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: t.text.secondary, marginBottom: 2 },
  retry: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: t.accent.primary,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  retryLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.inverse, fontSize: 14 },
});
