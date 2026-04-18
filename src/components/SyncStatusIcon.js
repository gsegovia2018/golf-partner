import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { subscribeSyncStatus } from '../store/tournamentStore';
import { retrySync } from '../store/syncWorker';

const COLOR = {
  idle:    '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error:   '#b33a3a',
};

const LABEL = {
  idle: '',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Reintentar',
};

export default function SyncStatusIcon() {
  const [status, setStatus] = useState('idle');
  useEffect(() => subscribeSyncStatus(setStatus), []);

  if (status === 'idle') {
    return (
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR.idle, marginHorizontal: 8 }} />
    );
  }

  const content = status === 'syncing'
    ? <ActivityIndicator size="small" color={COLOR.syncing} />
    : (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[status], marginRight: 6 }} />
        <Text style={{ color: COLOR[status], fontSize: 12 }}>{LABEL[status]}</Text>
      </View>
    );

  if (status === 'error') {
    return <Pressable onPress={retrySync} style={{ paddingHorizontal: 8 }}>{content}</Pressable>;
  }
  return <View style={{ paddingHorizontal: 8 }}>{content}</View>;
}
