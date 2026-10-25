import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useTabBarScroll, useTabBarClearance } from '../navigation/tabBarChrome';
import IconButton from '../components/ui/IconButton';
import PersonAvatar from '../components/ui/PersonAvatar';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useT, formatNumber } from '../i18n';
import PullToRefresh from '../components/PullToRefresh';
import {
  searchUsers, listFriends, listPendingRequests,
  sendRequest, acceptRequest, declineRequest, removeFriend,
  isAbortError,
} from '../store/friendStore';

const alert = (title, msg) => {
  if (Platform.OS === 'web') window.alert(msg ?? title);
  else Alert.alert(title, msg);
};

const SEARCH_DEBOUNCE_MS = 300;

export default function FriendsScreen({ navigation }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Search request sequencing. Each keystroke bumps the sequence id; only the
  // newest in-flight request is allowed to write results, and an
  // AbortController cancels the prior request so a slow stale response can
  // never overwrite a newer one. A debounce timer batches keystrokes.
  const searchSeqRef = useRef(0);
  const searchAbortRef = useRef(null);
  const debounceRef = useRef(null);

  const reload = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([listFriends(), listPendingRequests()]);
      setFriends(f);
      setIncoming(p.incoming);
      setOutgoing(p.outgoing);
    } catch (err) {
      alert(t('players.errorTitle'), err.message ?? t('players.friends.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  // Clean up any pending debounce / in-flight search on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
  }, [reload]);

  // Fire the actual search. Guarded by a sequence id so only the most recent
  // request's results land, and an AbortController so the previous request is
  // cancelled outright.
  const performSearch = useCallback(async (text) => {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      setResults([]);
      setSearching(false);
      return;
    }
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const rows = await searchUsers(text, { signal: controller.signal });
      if (seq !== searchSeqRef.current) return; // a newer search superseded us
      setResults(rows);
    } catch (err) {
      if (isAbortError(err) || seq !== searchSeqRef.current) return;
      alert(t('players.errorTitle'), err.message ?? t('players.friends.searchFailed'));
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [t]);

  // Debounced entry point bound to the input. Updates the visible text
  // immediately; defers the network call ~300ms.
  const onChangeQuery = useCallback((text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      // Short query: drop results right away, no network round-trip.
      searchAbortRef.current?.abort();
      searchSeqRef.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => performSearch(text), SEARCH_DEBOUNCE_MS);
  }, [performSearch]);

  // Relationship of a search result to the current user — drives its button.
  const relationOf = useCallback((userId) => {
    if (friends.some((f) => f.userId === userId)) return 'friends';
    if (outgoing.some((o) => o.person.userId === userId)) return 'outgoing';
    if (incoming.some((i) => i.person.userId === userId)) return 'incoming';
    return 'none';
  }, [friends, outgoing, incoming]);

  async function withBusy(id, fn) {
    setBusyId(id);
    try {
      await fn();
      await reload();
    } catch (err) {
      alert(t('players.errorTitle'), err.message ?? t('players.friends.somethingWrong'));
    } finally {
      setBusyId(null);
    }
  }

  const onAdd = (person) => withBusy(person.userId, async () => {
    await sendRequest(person.userId);
  });
  const onAccept = (req) => withBusy(req.friendshipId, () => acceptRequest(req.friendshipId));
  const onDecline = (req) => withBusy(req.friendshipId, () => declineRequest(req.friendshipId));
  const onRemove = (person) => {
    const go = () => withBusy(person.userId, () => removeFriend(person.userId));
    if (Platform.OS === 'web') {
      if (window.confirm(t('players.friends.removeWebConfirm', { name: person.displayName }))) go();
    } else {
      Alert.alert(t('players.friends.removeTitle'), t('players.friends.removeConfirm', { name: person.displayName }), [
        { text: t('players.cancel'), style: 'cancel' },
        { text: t('players.friends.remove'), style: 'destructive', onPress: go },
      ]);
    }
  };

  // `onPressRow` makes a row tappable (used for friends → profile view).
  const renderPerson = (person, right, onPressRow) => {
    const Wrapper = onPressRow ? TouchableOpacity : View;
    return (
      <Wrapper
        key={person.userId}
        style={s.row}
        {...(onPressRow ? { onPress: onPressRow, activeOpacity: 0.7 } : {})}
      >
        <PersonAvatar person={person} theme={theme} />
        <View style={s.rowText}>
          <Text style={s.name}>{person.displayName}</Text>
          <Text style={s.sub}>
            @{person.username}
            {person.handicap != null ? ` · ${t('players.hcp', { hcp: formatNumber(person.handicap) })}` : ''}
          </Text>
        </View>
        {right}
      </Wrapper>
    );
  };

  const searchButton = (person) => {
    const rel = relationOf(person.userId);
    const busy = busyId === person.userId;
    if (busy) return <ActivityIndicator color={theme.accent.primary} />;
    if (rel === 'friends') {
      return <Feather name="check-circle" size={14} color={theme.accent.primary} />;
    }
    if (rel === 'outgoing') return <Text style={s.pendingTag}>{t('players.friends.requested')}</Text>;
    if (rel === 'incoming') {
      return (
        <TouchableOpacity style={s.primaryBtn} onPress={() => {
          const req = incoming.find((i) => i.person.userId === person.userId);
          if (req) onAccept(req);
        }}>
          <Text style={s.primaryBtnText}>{t('players.friends.accept')}</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity style={s.primaryBtn} onPress={() => onAdd(person)}>
        <Feather name="user-plus" size={14} color={theme.text.inverse} />
        <Text style={s.primaryBtnText}>{t('players.add')}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('players.friends.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <PullToRefresh
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]}
        automaticallyAdjustKeyboardInsets
        {...tabBarScroll}
      >
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} />
          <TextInput
            style={s.searchInput}
            placeholder={t('players.friends.searchPlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={onChangeQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <IconButton icon="x" onPress={() => onChangeQuery('')} />
          ) : null}
        </View>

        {query.trim().length >= 2 && (
          <>
            <Text style={s.sectionLabel}>{t('players.friends.resultsLabel')}</Text>
            {searching ? (
              <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 12 }} />
            ) : results.length === 0 ? (
              <Text style={s.empty}>{t('players.friends.noMatch', { query: query.trim() })}</Text>
            ) : (
              results.map((p) => renderPerson(p, searchButton(p)))
            )}
          </>
        )}

        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 30 }} />
        ) : (
          <>
            {incoming.length > 0 && (
              <>
                <Text style={s.sectionLabel}>{t('players.friends.requestsLabel')}</Text>
                {incoming.map((req) => renderPerson(req.person, (
                  busyId === req.friendshipId ? (
                    <ActivityIndicator color={theme.accent.primary} />
                  ) : (
                    <View style={s.actionPair}>
                      <TouchableOpacity style={s.primaryBtn} onPress={() => onAccept(req)}>
                        <Text style={s.primaryBtnText}>{t('players.friends.accept')}</Text>
                      </TouchableOpacity>
                      <IconButton icon="x" style={s.ghostBtn} onPress={() => onDecline(req)} />
                    </View>
                  )
                )))}
              </>
            )}

            {outgoing.length > 0 && (
              <>
                <Text style={s.sectionLabel}>{t('players.friends.sentLabel')}</Text>
                {outgoing.map((req) => renderPerson(req.person, (
                  busyId === req.friendshipId ? (
                    <ActivityIndicator color={theme.accent.primary} />
                  ) : (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => onDecline(req)}>
                      <Text style={s.ghostBtnText}>{t('players.cancel')}</Text>
                    </TouchableOpacity>
                  )
                )))}
              </>
            )}

            <Text style={s.sectionLabel}>
              {friends.length
                ? t('players.friends.mineCount', { count: formatNumber(friends.length) })
                : t('players.friends.mineLabel')}
            </Text>
            {friends.length === 0 ? (
              <View style={s.emptyState}>
                <Feather name="users" size={44} color={theme.text.muted} />
                <Text style={s.emptyTitle}>{t('players.friends.noFriends')}</Text>
                <Text style={s.emptySub}>
                  {t('players.friends.noFriendsSub')}
                </Text>
              </View>
            ) : (
              friends.map((p) => renderPerson(
                p,
                (busyId === p.userId ? (
                  <ActivityIndicator color={theme.accent.primary} />
                ) : (
                  <IconButton icon="user-minus" color={theme.destructive} style={s.ghostBtn} onPress={() => onRemove(p)} />
                )),
                () => navigation.navigate('PlayerStats', { friend: p }),
              ))
            )}
          </>
        )}
      </PullToRefresh>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary,
    },
    content: { padding: 20, paddingTop: 4, paddingBottom: 60 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
      paddingHorizontal: 12,
    },
    searchInput: {
      flex: 1, paddingVertical: 12, color: theme.text.primary, fontSize: 15,
      fontFamily: 'PlusJakartaSans-Medium',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
    },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 22, marginBottom: 10, textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 12, marginBottom: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    rowText: { flex: 1 },
    name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
    sub: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12,
      color: theme.text.secondary, marginTop: 2,
    },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: theme.accent.primary, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 9,
    },
    primaryBtnText: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 13,
      textAlign: 'center',
    },
    ghostBtn: {
      borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
      paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
    },
    ghostBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 13,
      textAlign: 'center',
    },
    actionPair: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pendingTag: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 12,
    },
    empty: {
      fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
      fontSize: 13, marginTop: 10,
    },
    emptyState: { alignItems: 'center', paddingVertical: 36, gap: 10 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.text.primary },
    emptySub: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 30,
    },
  });
}
