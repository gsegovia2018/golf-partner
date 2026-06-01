import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  RefreshControl, TextInput,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  buildFeed, loadReactions, toggleReaction, isValidReactionEmoji, loadCommentCounts,
} from '../store/feedStore';
import { notifyFeedActivity } from '../store/notificationStore';
import { subscribeTournamentChanges, formatRoundLabel } from '../store/tournamentStore';
import { useAuth } from '../context/AuthContext';
import CommentsSheet from '../components/CommentsSheet';
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';
import RoundStoriesRail from '../components/feed/RoundStoriesRail';
import FeedRoundCard from '../components/feed/FeedRoundCard';

const EMPTY_REACTION_COUNTS = {};
const EMPTY_REACTION_MINE = [];

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

// Emoji reaction bar. Optimistic: a tap flips the local count/mine state
// immediately, then persists via toggleReaction; a failed persist reverts.
function ReactionBar({
  itemKey,
  reactions,
  onChange,
  commentCount,
  onOpenComments,
  onReactionAdded,
  s,
  theme,
}) {
  const counts = reactions?.counts ?? EMPTY_REACTION_COUNTS;
  const mine = reactions?.mine ?? EMPTY_REACTION_MINE;
  const emojiInputRef = useRef(null);
  const [emojiDraft, setEmojiDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const onTap = async (emoji) => {
    const currentlyMine = mine.includes(emoji);
    // Optimistic update.
    onChange(itemKey, emoji, currentlyMine, true);
    const ok = await toggleReaction(itemKey, emoji, currentlyMine);
    if (!ok) onChange(itemKey, emoji, currentlyMine, false); // revert
    else if (!currentlyMine) onReactionAdded?.(emoji);
  };

  const emojiList = useMemo(() => {
    return Object.keys(counts).filter((emoji) => (counts[emoji] ?? 0) > 0);
  }, [counts]);

  const submitEmoji = () => {
    const emoji = emojiDraft.trim();
    if (isValidReactionEmoji(emoji)) onTap(emoji);
    setEmojiDraft('');
    setPickerOpen(false);
    emojiInputRef.current?.blur();
  };

  return (
    <View style={s.reactionRow}>
      {emojiList.map((emoji) => {
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
      <TouchableOpacity
        style={[s.reactionChip, pickerOpen && s.reactionChipActive]}
        onPress={() => {
          setPickerOpen((open) => !open);
          setTimeout(() => emojiInputRef.current?.focus?.(), 0);
        }}
        activeOpacity={0.7}
        accessibilityLabel="React with any emoji"
      >
        <Feather name="smile" size={14} color={theme.text.muted} />
        <Text style={s.reactionActionText}>React</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.reactionChip}
        onPress={() => onOpenComments?.(itemKey)}
        activeOpacity={0.7}
        accessibilityLabel="Comments"
      >
        <Feather name="message-circle" size={13} color={theme.text.muted} />
        {commentCount > 0 ? (
          <Text style={s.reactionCount}>{commentCount}</Text>
        ) : null}
      </TouchableOpacity>
      {pickerOpen ? (
        <View style={s.emojiInputWrap}>
          <TextInput
            ref={emojiInputRef}
            style={s.emojiInput}
            value={emojiDraft}
            onChangeText={setEmojiDraft}
            placeholder="Emoji"
            placeholderTextColor={theme.text.muted}
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={16}
            onSubmitEditing={submitEmoji}
            accessibilityLabel="Emoji reaction"
          />
          <TouchableOpacity
            style={[s.emojiSendBtn, !isValidReactionEmoji(emojiDraft) && s.emojiSendBtnDisabled]}
            disabled={!isValidReactionEmoji(emojiDraft)}
            onPress={submitEmoji}
            accessibilityLabel="Send reaction"
          >
            <Feather name="send" size={13} color={theme.text.inverse} />
          </TouchableOpacity>
        </View>
      ) : null}
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

export default function FeedScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth() ?? {};
  const userId = user?.id ?? null;
  const s = makeStyles(theme);
  const now = useNow();

  const [items, setItems] = useState([]);
  const [roundStories, setRoundStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 'ok' | 'error' | 'partial' — distinguishes a genuine empty feed from a
  // failed build.
  const [status, setStatus] = useState('ok');
  const [reactions, setReactions] = useState({});
  // { [itemKey]: number } comment-count overlay, and the item whose comment
  // thread sheet is currently open (null when closed).
  const [commentCounts, setCommentCounts] = useState({});
  const [openCommentsItem, setOpenCommentsItem] = useState(null);
  const [openStoryKey, setOpenStoryKey] = useState(null);
  // True once the first load has settled, so later focus-driven reloads keep
  // the current screen visible instead of showing the full spinner.
  const loadedOnceRef = useRef(false);
  const hasVisibleFeedRef = useRef(false);

  const applyFeedResult = useCallback((result) => {
    const feedItems = result.items ?? [];
    const stories = result.roundStories ?? [];
    const hasResultFeed = feedItems.length > 0 || stories.length > 0;

    if (result.error) {
      if (hasVisibleFeedRef.current) {
        setStatus('partial');
      } else {
        setItems([]);
        setRoundStories([]);
        setStatus('error');
      }
      loadedOnceRef.current = true;
      return;
    }

    setItems(feedItems);
    setRoundStories(stories);
    setStatus(result.partial ? 'partial' : 'ok');
    loadedOnceRef.current = true;
    hasVisibleFeedRef.current = hasResultFeed;
    // Reactions + comment counts are best-effort overlays — never block
    // the feed.
    const keys = feedItems.map((it) => it.key);
    loadReactions(keys)
      .then(setReactions)
      .catch(() => {});
    loadCommentCounts(keys)
      .then(setCommentCounts)
      .catch(() => {});
  }, []);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      if (!isRefresh && !loadedOnceRef.current) {
        const cachedResult = await buildFeed({
          userId,
          source: 'cache',
          includeMedia: false,
          limit: 30,
        });
        const hasCachedFeed = (cachedResult.items?.length ?? 0) > 0
          || (cachedResult.roundStories?.length ?? 0) > 0;
        if (hasCachedFeed) {
          applyFeedResult(cachedResult);
          setLoading(false);
        }
      }

      const result = await buildFeed({
        userId,
        source: 'remote',
        includeMedia: true,
        limit: 30,
      });
      applyFeedResult(result);
    } catch {
      // buildFeed is defensive and rarely throws; treat a throw as an error
      // state rather than silently showing an empty feed.
      if (!loadedOnceRef.current) setItems([]);
      if (!loadedOnceRef.current) setRoundStories([]);
      setStatus('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyFeedResult, userId]);

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

  // Keep the comment badge in sync when the sheet adds/removes a comment.
  const onCommentCountChange = useCallback((itemKey, delta) => {
    setCommentCounts((prev) => ({
      ...prev,
      [itemKey]: Math.max(0, (prev[itemKey] ?? 0) + delta),
    }));
  }, []);

  const storyPlaybackItems = useMemo(() => roundStories.flatMap((story) => (
    (story.mediaList ?? []).map((media) => ({
      ...media,
      storyKey: story.key,
      storyRoundLabel: story.roundLabel,
      storyTournamentName: story.tournamentName,
      storyRoundIndex: story.roundIndex,
    }))
  )), [roundStories]);

  const storyStartIndexByKey = useMemo(() => {
    const map = new Map();
    storyPlaybackItems.forEach((media, index) => {
      if (!map.has(media.storyKey)) map.set(media.storyKey, index);
    });
    return map;
  }, [storyPlaybackItems]);

  const openStoryIndex = openStoryKey ? storyStartIndexByKey.get(openStoryKey) : null;

  const openRound = (item) => navigation.navigate('RoundSummary', {
    tournamentId: item.tournamentId,
    roundId: item.roundId,
  });

  const openRoundMedia = (item, media) => navigation.navigate('Gallery', {
    tournamentId: item.tournamentId,
    mediaId: media?.id ?? item.mediaId ?? undefined,
  });

  const notifyForFeedItem = useCallback((item, type, payload = {}) => {
    if (!item?.tournamentId || !item?.roundId) return;
    notifyFeedActivity({
      type,
      tournamentId: item.tournamentId,
      roundId: item.roundId,
      itemKey: item.key,
      roundIndex: item.roundIndex,
      tournamentName: item.tournamentName,
      courseName: item.courseName,
      ...payload,
    }).catch(() => {});
  }, []);

  const renderRound = (item) => {
    const roundLabel = formatRoundLabel({
      kind: item.tournamentKind,
      courseName: item.courseName,
      roundIndex: item.roundIndex,
    });
    return (
      <FeedRoundCard
        item={item}
        roundLabel={roundLabel}
        timestamp={timeAgo(item.ts, now)}
        onPress={() => openRound(item)}
        onPressMedia={item.mediaCoverUrl ? (media) => openRoundMedia(item, media) : undefined}
      >
        <ReactionBar
          itemKey={item.key}
          reactions={reactions[item.key]}
          onChange={applyReaction}
          commentCount={commentCounts[item.key] ?? 0}
          onOpenComments={() => setOpenCommentsItem(item)}
          onReactionAdded={(emoji) => notifyForFeedItem(item, 'feed_reaction', { emoji })}
          s={s}
          theme={theme}
        />
      </FeedRoundCard>
    );
  };

  const renderEmpty = () => {
    // A failed build is a distinct state from a genuinely empty feed: it
    // offers a Retry instead of an "add friends" nudge.
    if (status === 'error') {
      return (
        <View style={s.emptyState}>
          <Feather name="cloud-off" size={46} color={theme.text.muted} />
          <Text style={s.emptyTitle}>Could not load your feed</Text>
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
        <Text style={s.emptyTitle}>Your feed is quiet</Text>
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
    <ScreenContainer style={s.container} edges={['top']}>
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

      {!loading ? (
        <RoundStoriesRail
          stories={roundStories}
          onPressStory={(story) => setOpenStoryKey(story.key)}
        />
      ) : null}

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
          data={items}
          keyExtractor={(it) => it.key}
          renderItem={({ item }) => renderRound(item)}
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

      <CommentsSheet
        visible={!!openCommentsItem}
        itemKey={openCommentsItem?.key}
        onClose={() => setOpenCommentsItem(null)}
        onCountChange={onCommentCountChange}
        onCommentAdded={(_, comment) => notifyForFeedItem(openCommentsItem, 'feed_comment', {
          commentBody: comment?.body,
        })}
      />
      <MemoriesStoriesViewer
        visible={openStoryIndex != null}
        items={storyPlaybackItems}
        startIndex={openStoryIndex ?? 0}
        rounds={[]}
        onClose={() => setOpenStoryKey(null)}
      />
    </ScreenContainer>
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
    reactionActionText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 11,
    },
    emojiInputWrap: {
      flexBasis: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    emojiInput: {
      flex: 1,
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.card,
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    emojiSendBtn: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.primary,
    },
    emojiSendBtnDisabled: {
      opacity: 0.45,
    },
    /* Skeleton */
    skelBlock: {
      backgroundColor: theme.bg.secondary, borderRadius: 6,
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
