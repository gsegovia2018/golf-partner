import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import PullToRefresh from '../components/PullToRefresh';
import {
  searchUsers, listFriends, listPendingRequests,
  sendRequest, acceptRequest, declineRequest, removeFriend,
  getFriendProfile, isAbortError,
} from '../store/friendStore';

const alert = (title, msg) => {
  if (Platform.OS === 'web') window.alert(msg ?? title);
  else Alert.alert(title, msg);
};

const SEARCH_DEBOUNCE_MS = 300;

function PersonAvatar({ person, theme, size }) {
  const initials = (person.displayName || person.username || '?')
    .slice(0, 2).toUpperCase();
  const dim = size ?? 42;
  return (
    <View style={[
      styles_avatar.wrap,
      { width: dim, height: dim, borderRadius: dim / 2 },
      { backgroundColor: person.avatarColor || theme.accent.primary },
    ]}>
      {person.avatarUrl
        ? <Image source={{ uri: person.avatarUrl }} style={styles_avatar.img} />
        : <Text style={styles_avatar.text}>{initials}</Text>}
    </View>
  );
}

const styles_avatar = StyleSheet.create({
  wrap: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  text: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 14 },
});

export default function FriendsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [profileFriend, setProfileFriend] = useState(null);

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
      alert('Error', err.message ?? 'Could not load friends');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      alert('Error', err.message ?? 'Search failed');
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, []);

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
      alert('Error', err.message ?? 'Something went wrong');
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
      if (window.confirm(`Remove ${person.displayName} from friends?`)) go();
    } else {
      Alert.alert('Remove friend', `Remove ${person.displayName}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: go },
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
            {person.handicap != null ? ` · HCP ${person.handicap}` : ''}
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
      return <Feather name="check-circle" size={20} color={theme.accent.primary} />;
    }
    if (rel === 'outgoing') return <Text style={s.pendingTag}>Requested</Text>;
    if (rel === 'incoming') {
      return (
        <TouchableOpacity style={s.primaryBtn} onPress={() => {
          const req = incoming.find((i) => i.person.userId === person.userId);
          if (req) onAccept(req);
        }}>
          <Text style={s.primaryBtnText}>Accept</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity style={s.primaryBtn} onPress={() => onAdd(person)}>
        <Feather name="user-plus" size={14} color={theme.text.inverse} />
        <Text style={s.primaryBtnText}>Add</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Friends</Text>
        <View style={{ width: 22 }} />
      </View>

      <PullToRefresh
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={s.content}
        automaticallyAdjustKeyboardInsets
      >
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} />
          <TextInput
            style={s.searchInput}
            placeholder="Find golfers by username"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={onChangeQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <TouchableOpacity onPress={() => onChangeQuery('')}>
              <Feather name="x" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {query.trim().length >= 2 && (
          <>
            <Text style={s.sectionLabel}>SEARCH RESULTS</Text>
            {searching ? (
              <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 12 }} />
            ) : results.length === 0 ? (
              <Text style={s.empty}>No golfers match "{query.trim()}"</Text>
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
                <Text style={s.sectionLabel}>REQUESTS</Text>
                {incoming.map((req) => renderPerson(req.person, (
                  busyId === req.friendshipId ? (
                    <ActivityIndicator color={theme.accent.primary} />
                  ) : (
                    <View style={s.actionPair}>
                      <TouchableOpacity style={s.primaryBtn} onPress={() => onAccept(req)}>
                        <Text style={s.primaryBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.ghostBtn} onPress={() => onDecline(req)}>
                        <Feather name="x" size={16} color={theme.text.muted} />
                      </TouchableOpacity>
                    </View>
                  )
                )))}
              </>
            )}

            {outgoing.length > 0 && (
              <>
                <Text style={s.sectionLabel}>SENT</Text>
                {outgoing.map((req) => renderPerson(req.person, (
                  busyId === req.friendshipId ? (
                    <ActivityIndicator color={theme.accent.primary} />
                  ) : (
                    <TouchableOpacity style={s.ghostBtn} onPress={() => onDecline(req)}>
                      <Text style={s.ghostBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )
                )))}
              </>
            )}

            <Text style={s.sectionLabel}>
              MY FRIENDS{friends.length ? ` (${friends.length})` : ''}
            </Text>
            {friends.length === 0 ? (
              <View style={s.emptyState}>
                <Feather name="users" size={42} color={theme.text.muted} />
                <Text style={s.emptyTitle}>No friends yet</Text>
                <Text style={s.emptySub}>
                  Search for golfers above to send a friend request.
                </Text>
              </View>
            ) : (
              friends.map((p) => renderPerson(
                p,
                (busyId === p.userId ? (
                  <ActivityIndicator color={theme.accent.primary} />
                ) : (
                  <TouchableOpacity style={s.ghostBtn} onPress={() => onRemove(p)}>
                    <Feather name="user-minus" size={16} color={theme.destructive} />
                  </TouchableOpacity>
                )),
                () => setProfileFriend(p),
              ))
            )}
          </>
        )}
      </PullToRefresh>

      <FriendProfileModal
        friend={profileFriend}
        theme={theme}
        onClose={() => setProfileFriend(null)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Friend profile sheet — recent rounds, handicap, and head-to-head record
// against the current user. Data comes from getFriendProfile (derived from
// the shared feed), so no extra navigation route is needed.
// ---------------------------------------------------------------------------
function FriendProfileModal({ friend, theme, onClose }) {
  const s = makeStyles(theme);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!friend) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    getFriendProfile(friend)
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [friend]);

  if (!friend) return null;

  const h2h = data?.headToHead ?? { wins: 0, losses: 0, ties: 0 };
  const rounds = data?.recentRounds ?? [];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <View style={s.modalHead}>
            <PersonAvatar person={friend} theme={theme} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{friend.displayName}</Text>
              <Text style={s.sub}>
                @{friend.username}
                {(data?.handicap ?? friend.handicap) != null
                  ? ` · HCP ${data?.handicap ?? friend.handicap}`
                  : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={s.modalClose}>
              <Feather name="x" size={20} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 30 }} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              <Text style={s.sectionLabel}>HEAD-TO-HEAD</Text>
              <View style={s.h2hRow}>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.wins}</Text>
                  <Text style={s.h2hLabel}>YOUR WINS</Text>
                </View>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.ties}</Text>
                  <Text style={s.h2hLabel}>TIES</Text>
                </View>
                <View style={s.h2hCell}>
                  <Text style={s.h2hValue}>{h2h.losses}</Text>
                  <Text style={s.h2hLabel}>THEIR WINS</Text>
                </View>
              </View>

              <Text style={s.sectionLabel}>RECENT ROUNDS</Text>
              {rounds.length === 0 ? (
                <Text style={s.empty}>No shared rounds yet.</Text>
              ) : (
                rounds.map((r) => (
                  <View key={r.key} style={s.miniRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.miniTitle} numberOfLines={1}>
                        {r.courseName || `Round ${r.roundIndex + 1}`}
                      </Text>
                      <Text style={s.miniSub} numberOfLines={1}>{r.tournamentName}</Text>
                    </View>
                    <View style={s.miniStat}>
                      <Text style={s.miniStatValue}>{r.points}</Text>
                      <Text style={s.miniStatLabel}>PTS</Text>
                    </View>
                    <View style={s.miniStat}>
                      <Text style={s.miniStatValue}>{r.strokes}</Text>
                      <Text style={s.miniStatLabel}>STRK</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    },
    backBtn: {},
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
    },
    ghostBtn: {
      borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
      paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
    },
    ghostBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 13,
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

    /* Friend profile modal */
    modalBackdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 22, borderTopRightRadius: 22,
      paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24,
      maxHeight: '82%',
    },
    modalHandle: {
      alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
      backgroundColor: theme.border.default, marginBottom: 12,
    },
    modalHead: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4,
    },
    modalClose: {
      width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
    },
    h2hRow: { flexDirection: 'row', gap: 8 },
    h2hCell: {
      flex: 1, backgroundColor: theme.bg.card, borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      paddingVertical: 14, alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    h2hValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: theme.text.primary },
    h2hLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
      color: theme.text.muted, marginTop: 3,
    },
    miniRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 12, marginBottom: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    miniTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
    miniSub: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 11,
      color: theme.text.muted, marginTop: 2,
    },
    miniStat: { alignItems: 'center', minWidth: 44 },
    miniStatValue: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.text.primary,
    },
    miniStatLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
      color: theme.text.muted, marginTop: 2,
    },
  });
}
