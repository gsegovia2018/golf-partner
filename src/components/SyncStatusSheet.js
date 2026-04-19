import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import {
  subscribeSyncStatus,
  subscribeConflicts,
  markConflictsRead,
  readLocal,
} from '../store/tournamentStore';
import { syncQueue } from '../store/syncQueue';
import { retrySync } from '../store/syncWorker';
import { pathToLabel } from '../store/conflictLabels';

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

function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return '…';
  const str = String(v);
  return str.length > 24 ? str.slice(0, 23) + '…' : str;
}

export default function SyncStatusSheet({ visible, onClose }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [pending, setPending] = useState(0);
  const [blob, setBlob] = useState(null);

  useEffect(() => {
    if (!visible) return;
    const offStatus = subscribeSyncStatus(setStatus);
    const offConflicts = subscribeConflicts(({ log: nextLog, lastSyncAt: nextTs }) => {
      setLog(nextLog);
      setLastSyncAt(nextTs);
    });
    return () => { offStatus(); offConflicts(); };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    markConflictsRead().catch(() => {});
    syncQueue.all().then((all) => setPending(all.length)).catch(() => setPending(0));
  }, [visible]);

  // Best-effort: resolve the blob for the most recent conflict's tournament
  // so labels can show player names. Unknown tournaments fall back to em-dashes.
  useEffect(() => {
    if (!visible || log.length === 0) { setBlob(null); return; }
    const latest = log[log.length - 1]?.tournamentId;
    if (!latest) { setBlob(null); return; }
    readLocal(latest).then(setBlob).catch(() => setBlob(null));
  }, [visible, log]);

  const onRetry = useCallback(() => { retrySync(); }, []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={s.title}>Sincronización</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={theme.text.muted} />
          </TouchableOpacity>
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

          <View style={s.divider} />

          <Text style={s.sectionTitle}>Cambios sobrescritos</Text>
          {log.length === 0 ? (
            <Text style={s.empty}>Sin cambios sobrescritos recientes</Text>
          ) : (
            log.slice().reverse().map((entry, i) => (
              <View key={`${entry.detectedAt}-${entry.path}-${i}`} style={s.logItem}>
                <Text style={s.logPrimary}>{pathToLabel(entry, blob)}</Text>
                <Text style={s.logSecondary}>
                  {formatRelative(entry.detectedAt)}
                  {entry.winnerValue !== undefined && entry.losingValue !== undefined
                    ? ` · quedó en ${formatValue(entry.winnerValue)} (antes ${formatValue(entry.losingValue)})`
                    : ''}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
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
  divider: { height: 1, backgroundColor: t.border.subtle, marginVertical: 14 },
  empty: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: t.text.muted, fontStyle: 'italic' },
  logItem: { paddingVertical: 8 },
  logPrimary: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: t.text.primary },
  logSecondary: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: t.text.secondary, marginTop: 2 },
});
