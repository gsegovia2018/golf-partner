import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import { listNotifications, markAllRead } from '../store/notificationStore';
import { renderNotification, notificationLink } from '../lib/notificationContent';

// Relative "time ago" for the notification list. Coarse on purpose.
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load on focus, and mark everything read — opening this screen IS the
  // user seeing their notifications, so the badge should clear.
  const reload = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data);
      // Opening this screen IS the user seeing their notifications — clear
      // the badge. Only after a successful load, so a fetch failure does not
      // silently mark unseen notifications read.
      markAllRead().catch(() => {});
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const openItem = (item) => {
    const { screen, params } = notificationLink(item.type, item.data);
    navigation.navigate(screen, params);
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton
          icon="chevron-left"
          size={24}
          color={theme.text.primary}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        />
        <Text style={s.title}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Feather name="bell" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {items.map((item) => {
            const { icon, title, body } = renderNotification(item.type, item.data);
            const unread = !item.readAt;
            return (
              <TouchableOpacity
                key={item.id}
                style={[s.row, unread && s.rowUnread]}
                onPress={() => openItem(item)}
                activeOpacity={0.7}
              >
                <View style={s.iconWrap}>
                  <Feather name={icon} size={14} color={theme.text.primary} />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{title}</Text>
                  {!!body && <Text style={s.rowText}>{body}</Text>}
                  <Text style={s.rowTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                {unread && <View style={s.unreadDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: t.text.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: t.text.muted },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    borderRadius: 14, marginBottom: 8,
    backgroundColor: t.bg.card,
    borderWidth: 1, borderColor: t.border.default,
  },
  rowUnread: { borderColor: t.accent.primary },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.bg.secondary,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.primary },
  rowText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: t.text.secondary },
  rowTime: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: t.text.muted },
  unreadDot: {
    width: 9, height: 9, borderRadius: 5, backgroundColor: t.accent.primary,
  },
});
