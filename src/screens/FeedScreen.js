import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  buildFeed, loadReactions, toggleReaction, FEED_REACTION_EMOJI,
} from '../store/feedStore';
import { subscribeTournamentChanges } from '../store/tournamentStore';

// Compact relative time: "just now", "3h", "2d", "5w". Pure function of a
// timestamp and a "now" — `now` is passed in so the value can re-render live.
function timeAgo(ts, now) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return new Date(ts).toLocaleDateString();
}

// Re-renders the consumer every `intervalMs` so relative timestamps stay
// fresh without each card owning its own timer.
function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  // Recompute on focus too — covers the app being backgrounded for a while.
  useFocusEffect(useCallback(() => { setNow(Date.now()); }, []));
  return now;
}

function Avatar({ item, theme }) {
  const initial = (item.actorName || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[
      feedAvatar.wrap,
      { backgroundColor: item.actorAvatarColor || theme.accent.primary },
    ]}>
      {item.actorAvatarUrl
        ? <Image source={{ uri: item.actorAvatarUrl }} style={feedAvatar.img} />
        : <Text style={feedAvatar.text}>{initial}</Text>}
    </View>
  );
}

// Small avatar for one player inside a grouped round card.
function MiniAvatar({ result, theme }) {
  const initial = (result.name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[
      feedAvatar.mini,
      { backgroundColor: result.avatarColor || theme.accent.primary },
    ]}>
      {result.avatarUrl
        ? <Image source={{ uri: result.avatarUrl }} style={feedAvatar.img} />
        : <Text style={feedAvatar.miniText}>{initial}</Text>}
    </View>
  );
}

const feedAvatar = StyleSheet.create({
  wrap: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  mini: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  text: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 15 },
  miniText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 11 },
});

// A photo group from the feed. One photo renders flush; multiple photos from
// the same round become a horizontally paged carousel with a count badge,
// page dots, and a caption that follows the visible photo.
function PhotoCarousel({ mediaList, s }) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const multi = mediaList.length > 1;

  const onScroll = (e) => {
    if (!width) return;
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(Math.max(0, Math.min(p, mediaList.length - 1)));
  };

  const current = mediaList[Math.min(page, mediaList.length - 1)];

  return (
    <View>
      <View
        style={s.carouselWrap}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled={multi}
            scrollEnabled={multi}
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {mediaList.map((m) => (
              <Image
                key={m.id}
                source={{ uri: m.thumbUrl || m.url }}
                style={[s.carouselPhoto, { width }]}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        ) : null}
        {multi ? (
          <View style={s.countBadge}>
            <Text style={s.countBadgeText}>{page + 1}/{mediaList.length}</Text>
          </View>
        ) : null}
      </View>
      {multi ? (
        <View style={s.dots}>
          {mediaList.map((m, i) => (
            <View key={m.id} style={[s.dot, i === page && s.dotActive]} />
          ))}
        </View>
      ) : null}
      {current?.caption ? <Text style={s.caption}>{current.caption}</Text> : null}
    </View>
  );
}

// Emoji reaction bar. Optimistic: a tap flips the local count/mine state
// immediately, then persists via toggleReaction; a failed persist reverts.
function ReactionBar({ itemKey, reactions, onChange, s, theme }) {
  const counts = reactions?.counts ?? {};
  const mine = reactions?.mine ?? [];

  const onTap = async (emoji) => {
    const currentlyMine = mine.includes(emoji);
    // Optimistic update.
    onChange(itemKey, emoji, currentlyMine, true);
    const ok = await toggleReaction(itemKey, emoji, currentlyMine);
    if (!ok) onChange(itemKey, emoji, currentlyMine, false); // revert
  };

  return (
    <View style={s.reactionRow}>
      {FEED_REACTION_EMOJI.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const isMine = mine.includes(emoji);
        return (
          <TouchableOpacity
            key={emoji}
            style={[s.reactionChip, isMine && s.reactionChipActive]}
            onPress={() => onTap(emoji)}
            activeOpacity={0.7}
          >
            <Text style={s.reactionEmoji}>{emoji}</Text>
            {count > 0 ? (
              <Text style={[s.reactionCount, isMine && s.reactionCountActive]}>
                {count}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Placeholder card shown on the very first load instead of a bare spinner.
function SkeletonCard({ s }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={[s.skelBlock, { width: 38, height: 38, borderRadius: 19 }]} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={[s.skelBlock, { width: '55%', height: 12 }]} />
          <View style={[s.skelBlock, { width: '75%', height: 10 }]} />
        </View>
      </View>
      <View style={[s.skelBlock, { height: 48, marginTop: 14, borderRadius: 12 }]} />
    </View>
  );
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'friends', label: 'Friends' },
];

export default function FeedScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const now = useNow();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 'ok' | 'error' | 'partial' — distinguishes a genuine empty feed from a
  // failed build.
  const [status, setStatus] = useState('ok');
  const [filter, setFilter] = useState('all');
  const [reactions, setReactions] = useState({});
  // True once at least one successful load has populated the list, so
  // focus-driven reloads keep the existing list visible (no full spinner).
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      const result = await buildFeed();
      const feedItems = result.items ?? [];
      setItems(feedItems);
      setStatus(result.error ? 'error' : (result.partial ? 'partial' : 'ok'));
      loadedOnceRef.current = true;
      // Reactions are a best-effort overlay — never blocks the feed.
      loadReactions(feedItems.map((it) => it.key))
        .then(setReactions)
        .catch(() => {});
    } catch {
      // buildFeed is defensive and rarely throws; treat a throw as an error
      // state rather than silently showing an empty feed.
      if (!loadedOnceRef.current) setItems([]);
      setStatus('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    // Only show the full spinner on the very first load; later focus-driven
    // reloads keep the current list visible.
    if (!loadedOnceRef.current) setLoading(true);
    load(false);
    const unsub = subscribeTournamentChanges(() => { if (!cancelled) load(false); });
    return () => { cancelled = true; unsub(); };
  }, [load]));

  // Apply an optimistic reaction change to local state.
  const applyReaction = useCallback((itemKey, emoji, wasMine, apply) => {
    setReactions((prev) => {
      const bucket = prev[itemKey] ?? { counts: {}, mine: [] };
      const counts = { ...bucket.counts };
      let mine = bucket.mine.slice();
      // `apply` true = make the change; false = revert it. Reverting a toggle
      // is the same operation as re-applying the opposite, so the math here
      // is symmetric: when apply is false we undo what `wasMine` implied.
      const adding = apply ? !wasMine : wasMine;
      if (adding) {
        counts[emoji] = (counts[emoji] ?? 0) + 1;
        if (!mine.includes(emoji)) mine.push(emoji);
      } else {
        counts[emoji] = Math.max(0, (counts[emoji] ?? 0) - 1);
        mine = mine.filter((e) => e !== emoji);
      }
      return { ...prev, [itemKey]: { counts, mine } };
    });
  }, []);

  const filteredItems = useMemo(() => {
    if (filter === 'mine') return items.filter((it) => it.isMine);
    if (filter === 'friends') return items.filter((it) => !it.isMine);
    return items;
  }, [items, filter]);

  const openRound = (item) => navigation.navigate('RoundSummary', {
    tournamentId: item.tournamentId,
    roundId: item.roundId,
  });

  const renderRound = (item) => {
    const roundLabel = item.tournamentKind === 'game'
      ? (item.courseName || 'Round')
      : `Round ${item.roundIndex + 1}`;
    const results = item.results ?? [];
    const multi = results.length > 1;
    const verb = multi
      ? ` and ${results.length - 1} other${results.length - 1 > 1 ? 's' : ''} played a round`
      : ' played a round';
    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.75}
        onPress={() => openRound(item)}
      >
        <View style={s.cardHead}>
          <Avatar item={item} theme={theme} />
          <View style={{ flex: 1 }}>
            <Text style={s.actorLine}>
              <Text style={s.actorName}>{item.actorName}</Text>
              <Text style={s.actorVerb}>{verb}</Text>
            </Text>
            <Text style={s.metaLine}>
              {roundLabel} · {item.tournamentName} · {timeAgo(item.ts, now)}
            </Text>
          </View>
        </View>

        {multi ? (
          // Grouped round: one row per player.
          <View style={s.resultsList}>
            {results.map((r) => (
              <View key={r.playerId} style={s.resultRow}>
                <MiniAvatar result={r} theme={theme} />
                <Text style={s.resultName} numberOfLines={1}>{r.name}</Text>
                <View style={s.resultStat}>
                  <Text style={s.resultStatValue}>{r.points}</Text>
                  <Text style={s.resultStatLabel}>PTS</Text>
                </View>
                <View style={s.resultStat}>
                  <Text style={s.resultStatValue}>{r.strokes}</Text>
                  <Text style={s.resultStatLabel}>STRK</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={s.scoreRow}>
            <View style={s.scoreCell}>
              <Text style={s.scoreValue}>{item.points}</Text>
              <Text style={s.scoreLabel}>POINTS</Text>
            </View>
            <View style={s.scoreCell}>
              <Text style={s.scoreValue}>{item.strokes}</Text>
              <Text style={s.scoreLabel}>STROKES</Text>
            </View>
            <View style={s.scoreCell}>
              <Text style={s.scoreValue}>{item.holes}</Text>
              <Text style={s.scoreLabel}>HOLES</Text>
            </View>
            {item.courseName ? (
              <View style={[s.scoreCell, s.courseCell]}>
                <Feather name="map-pin" size={12} color={theme.text.muted} />
                <Text style={s.courseText} numberOfLines={1}>{item.courseName}</Text>
              </View>
            ) : null}
          </View>
        )}

        {!item.isMine && !item.withMe ? (
          <View style={s.tagRow}>
            <Feather name="users" size={11} color={theme.text.muted} />
            <Text style={s.tagText}>A round without you</Text>
          </View>
        ) : null}

        <ReactionBar
          itemKey={item.key}
          reactions={reactions[item.key]}
          onChange={applyReaction}
          s={s}
          theme={theme}
        />
      </TouchableOpacity>
    );
  };

  const renderPhoto = (item) => {
    const list = item.mediaList ?? (item.media ? [item.media] : []);
    if (list.length === 0) return null;
    const verb = list.length > 1 ? ` added ${list.length} photos` : ' added a photo';
    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('Gallery', { tournamentId: item.tournamentId })}
      >
        <View style={s.cardHead}>
          {/* Uploader avatar when known, falling back to the camera glyph. */}
          {item.actorAvatarUrl || item.actorAvatarColor ? (
            <Avatar item={item} theme={theme} />
          ) : (
            <View style={[feedAvatar.wrap, { backgroundColor: theme.accent.primary }]}>
              <Feather name="camera" size={16} color="#ffd700" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.actorLine}>
              <Text style={s.actorName}>{item.actorName}</Text>
              <Text style={s.actorVerb}>{verb}</Text>
            </Text>
            <Text style={s.metaLine}>
              {item.tournamentName} · {timeAgo(item.ts, now)}
            </Text>
          </View>
        </View>
        <PhotoCarousel mediaList={list} s={s} />
        <ReactionBar
          itemKey={item.key}
          reactions={reactions[item.key]}
          onChange={applyReaction}
          s={s}
          theme={theme}
        />
      </TouchableOpacity>
    );
  };

  const renderFilters = () => (
    <View style={s.filterRow}>
      {FILTERS.map((f) => (
        <TouchableOpacity
          key={f.key}
          style={[s.filterChip, filter === f.key && s.filterChipActive]}
          onPress={() => setFilter(f.key)}
          activeOpacity={0.8}
        >
          <Text style={[s.filterText, filter === f.key && s.filterTextActive]}>
            {f.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderEmpty = () => {
    // A failed build is a distinct state from a genuinely empty feed: it
    // offers a Retry instead of an "add friends" nudge.
    if (status === 'error') {
      return (
        <View style={s.emptyState}>
          <Feather name="cloud-off" size={46} color={theme.text.muted} />
          <Text style={s.emptyTitle}>Couldn't load your feed</Text>
          <Text style={s.emptySub}>
            Check your connection and try again.
          </Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => load(true)}>
            <Feather name="refresh-cw" size={15} color={theme.text.inverse} />
            <Text style={s.emptyBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={s.emptyState}>
        <Feather name="rss" size={46} color={theme.text.muted} />
        <Text style={s.emptyTitle}>
          {filter === 'mine' ? 'No rounds of yours yet'
            : filter === 'friends' ? 'No friend activity yet'
              : 'Your feed is quiet'}
        </Text>
        <Text style={s.emptySub}>
          Play a round or add friends to see their golf here.
        </Text>
        <TouchableOpacity
          style={s.emptyBtn}
          onPress={() => navigation.navigate('Friends')}
        >
          <Feather name="user-plus" size={15} color={theme.text.inverse} />
          <Text style={s.emptyBtnText}>Add friends</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Feed</Text>
        <TouchableOpacity
          style={s.headerBtn}
          onPress={() => navigation.navigate('Friends')}
          activeOpacity={0.7}
        >
          <Feather name="users" size={18} color={theme.accent.primary} />
        </TouchableOpacity>
      </View>

      {renderFilters()}

      {/* Partial-load banner: some data reached us, some didn't. */}
      {status === 'partial' && items.length > 0 ? (
        <TouchableOpacity style={s.partialBanner} onPress={() => load(true)} activeOpacity={0.8}>
          <Feather name="alert-circle" size={13} color={theme.text.muted} />
          <Text style={s.partialText}>Feed may be incomplete · Tap to retry</Text>
        </TouchableOpacity>
      ) : null}

      {loading ? (
        // First-load: show skeleton cards rather than a bare spinner.
        <ScrollView contentContainerStyle={s.list}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} s={s} />)}
        </ScrollView>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(it) => it.key}
          renderItem={({ item }) => (
            item.type === 'round' ? renderRound(item) : renderPhoto(item)
          )}
          contentContainerStyle={s.list}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={theme.accent.primary}
            />
          )}
          ListEmptyComponent={renderEmpty()}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Black', fontSize: 26, color: theme.text.primary,
    },
    headerBtn: {
      width: 38, height: 38, borderRadius: 12,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: 16, paddingBottom: 30, flexGrow: 1 },
    filterRow: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8,
    },
    filterChip: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1, borderColor: theme.border.default,
    },
    filterChipActive: {
      backgroundColor: theme.accent.primary, borderColor: theme.accent.primary,
    },
    filterText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.secondary,
    },
    filterTextActive: { color: theme.text.inverse },
    partialBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
      marginHorizontal: 16, marginBottom: 6, paddingVertical: 7,
      borderRadius: 10, backgroundColor: theme.bg.secondary,
    },
    partialText: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted,
    },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 18,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 14, marginBottom: 12,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actorLine: { fontSize: 14 },
    actorName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    actorVerb: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 14 },
    metaLine: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted,
      fontSize: 11, marginTop: 2,
    },
    scoreRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginTop: 14,
    },
    scoreCell: {
      backgroundColor: theme.bg.secondary, borderRadius: 12,
      paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center', minWidth: 62,
    },
    courseCell: {
      flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minWidth: 0,
    },
    courseText: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
      fontSize: 12, flexShrink: 1,
    },
    scoreValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary },
    scoreLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
      color: theme.text.muted, marginTop: 2,
    },
    /* Grouped round: per-player rows */
    resultsList: { marginTop: 12, gap: 6 },
    resultRow: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      backgroundColor: theme.bg.secondary, borderRadius: 12,
      paddingVertical: 7, paddingHorizontal: 10,
    },
    resultName: {
      flex: 1, fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13, color: theme.text.primary,
    },
    resultStat: { alignItems: 'center', minWidth: 44 },
    resultStatValue: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 15, color: theme.text.primary,
    },
    resultStatLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 7, letterSpacing: 1,
      color: theme.text.muted, marginTop: 1,
    },
    tagRow: {
      flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    },
    tagText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11 },
    /* Reactions */
    reactionRow: {
      flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap',
    },
    reactionChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: 'transparent',
    },
    reactionChipActive: {
      backgroundColor: theme.accent.light,
      borderColor: theme.accent.primary,
    },
    reactionEmoji: { fontSize: 14 },
    reactionCount: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.text.secondary,
    },
    reactionCountActive: { color: theme.accent.primary },
    /* Skeleton */
    skelBlock: {
      backgroundColor: theme.bg.secondary, borderRadius: 6,
    },
    carouselWrap: {
      height: 200, borderRadius: 12, marginTop: 12, overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    carouselPhoto: { height: 200, backgroundColor: theme.bg.secondary },
    countBadge: {
      position: 'absolute', top: 8, right: 8,
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 99,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    countBadgeText: {
      color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 11,
    },
    dots: {
      flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8,
    },
    dot: {
      width: 6, height: 6, borderRadius: 3, backgroundColor: theme.border.default,
    },
    dotActive: { backgroundColor: theme.accent.primary },
    caption: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontSize: 13, marginTop: 8,
    },
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12, flex: 1, justifyContent: 'center' },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySub: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
    emptyBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6,
      backgroundColor: theme.accent.primary, borderRadius: 12,
      paddingHorizontal: 18, paddingVertical: 11,
    },
    emptyBtnText: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 14,
    },
  });
}
