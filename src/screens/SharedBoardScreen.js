// Public, read-only live leaderboard page — see
// docs/superpowers/plans/2026-08-16-shareable-live-board.md, build item 4,
// rebuilt on-brand per the Phase 1.5 "feed-style live board" section (build
// item 3): a DEEP_GREEN hero, podium-style overall standings, a stories
// rail, and one FeedRoundCard per round — instead of the original flat
// tab-bar leaderboard.
//
// Rendered two ways: bare, pre-session, outside any navigator (App.js's
// `!session` branch, same precedent as JoinTournamentLinkScreen) with a
// `token` prop, or — a later work stream may add this — as a normal
// navigation route with `route.params.token`. Either way this screen must
// tolerate having no navigator around it, so it never touches a navigation
// hook.
//
// All scoring/ranking/feed-item math lives in `src/store/sharedBoard.js`
// (`buildSharedBoardModel` / `buildSharedMediaModel`) — this screen only
// renders that model's output. It talks to the network via exactly two
// calls: `get_shared_board` (board data, polled) and
// `get_shared_board_media` (photos/videos, fetched once + on manual
// refresh) — both SECURITY DEFINER RPCs granted to `anon`. The media RPC
// may not exist on the server yet; any error or null from it must silently
// produce an empty media model, never an error state.
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
  TouchableOpacity, Linking, AppState,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { buildSharedBoardModel, buildSharedMediaModel } from '../store/sharedBoard';
import FeedRoundCard from '../components/feed/FeedRoundCard';
import RoundStoriesRail from '../components/feed/RoundStoriesRail';
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';

// Same idea as useOfficialRound's 20s poll (src/hooks/useOfficialRound.js) —
// the RPC has no `updated_at` to diff against, so a full refetch is the only
// freshness mechanism. 30s here because this is a passive read-only page,
// not an active scoring session. Media is NOT part of this poll — fetched
// once on mount and again only on a manual pull-to-refresh.
const POLL_MS = 30000;

const BOARD_URL = 'golf-partner.vercel.app';

// Clubhouse dark-green hero surface — same constants as CoachHero.js /
// ShotDashboard.js / CareerMilestonesCard.js / CourseStatsScreen.js, copied
// locally by convention rather than imported. `theme.bg.deep` carries the
// same value in both themes (DEEP_GREEN, "green plays" per DESIGN.md), so
// the hero's on-dark text can't come from theme.text (which flips per
// theme) — it uses this fixed cream family instead, matching every other
// dark hero in the app.
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';
const GOLD = '#ffd700'; // semantic.winner.dark — full ceremony gold on dark surfaces.

// "Round 1 · Pebble Beach" -> "Pebble Beach". Round objects out of
// buildSharedBoardModel don't carry a bare courseName field, but `label`
// already folds it in via the same formatRoundLabel() call — reusing that
// string avoids re-deriving course context from anywhere else.
function courseFromLabel(label) {
  if (!label) return null;
  const idx = label.indexOf(' · ');
  return idx >= 0 ? label.slice(idx + 3) : null;
}

function formatHeroDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

// Attaches the same media fields feedStore.js's buildFeed attaches to its
// `type: 'round'` items (~611-623) — mediaList/mediaCount/mediaCoverUrl/etc —
// so FeedRoundCard's built-in photo strip renders unchanged here. `story` is
// one entry of buildSharedMediaModel's `stories[]` for this round, or
// undefined when the round has no media (or the media RPC failed/is absent).
function attachMedia(feedItem, story) {
  if (!feedItem || !story) return feedItem;
  const mediaList = story.mediaList ?? [];
  const newest = mediaList[mediaList.length - 1] ?? null;
  return {
    ...feedItem,
    mediaList: mediaList.slice(),
    mediaCount: story.count,
    mediaCountLabel: story.countLabel,
    mediaHasVideo: story.hasVideo,
    mediaId: newest?.id ?? null,
    mediaCoverUrl: newest?.thumbUrl || newest?.url || null,
    mediaUrl: newest?.url || newest?.thumbUrl || null,
  };
}

export default function SharedBoardScreen(props) {
  const token = props.token ?? props.route?.params?.token;
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [model, setModel] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mediaRows, setMediaRows] = useState([]);
  const [openStoryKey, setOpenStoryKey] = useState(null);

  // Guards against a late poll/refresh response calling setState after
  // unmount (same pattern as useOfficialRound).
  const mountedRef = useRef(true);

  const fetchBoard = useCallback(async ({ isRefresh = false } = {}) => {
    if (!token) {
      if (mountedRef.current) { setLoading(false); setNotFound(true); }
      return;
    }
    if (isRefresh && mountedRef.current) setRefreshing(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_shared_board', { p_token: token });
      if (rpcError) throw rpcError;
      const built = buildSharedBoardModel(data);
      if (!mountedRef.current) return;
      setError(null);
      if (!built) {
        // No such token, or it's been revoked/rotated (RPC returns nothing
        // for those cases) — friendly dead-end, not a scary error.
        setNotFound(true);
        setModel(null);
      } else {
        setNotFound(false);
        setModel(built);
        setCreatedAt(data?.createdAt ?? null);
      }
    } catch (e) {
      // A transient failure must never blank a board that's already on
      // screen — only surface it as a hard error state when there's nothing
      // to fall back to yet.
      if (mountedRef.current) setError(e);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [token]);

  // Media is a separate, best-effort fetch: the RPC may not exist on the
  // server yet, and per the plan ANY error or null here must silently
  // degrade to "no media UI" — it never turns into an error state, and it
  // never touches the `error`/`notFound` state the board fetch owns.
  const fetchMedia = useCallback(async () => {
    if (!token) return;
    try {
      const { data, error: mErr } = await supabase.rpc('get_shared_board_media', { p_token: token });
      if (!mountedRef.current) return;
      setMediaRows(!mErr && Array.isArray(data) ? data : []);
    } catch {
      if (mountedRef.current) setMediaRows([]);
    }
  }, [token]);

  // Initial load (board + media) + 30s board-only poll, gated on the
  // app/tab being foregrounded (a background timer would just burn the anon
  // RPC quota for nobody to see).
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchBoard();
    fetchMedia();

    const appState = { current: AppState.currentState };
    const sub = AppState.addEventListener('change', (next) => { appState.current = next; });
    const id = setInterval(() => {
      if (appState.current === 'active') fetchBoard();
    }, POLL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
      sub.remove();
    };
  }, [fetchBoard, fetchMedia]);

  const onRefresh = () => {
    fetchBoard({ isRefresh: true });
    fetchMedia();
  };

  const mediaModel = useMemo(
    () => buildSharedMediaModel(mediaRows, model),
    [mediaRows, model],
  );

  const storyByRoundId = useMemo(() => {
    const map = new Map();
    for (const story of mediaModel.stories) map.set(story.roundId, story);
    return map;
  }, [mediaModel]);

  // Flat, chronologically-ordered playback list across every round's media —
  // same shape MemoriesStoriesViewer expects, built the same way FeedScreen
  // builds it (storyKey/storyRoundLabel/storyTournamentName/storyRoundIndex
  // stamped onto each item so the viewer's header updates as it crosses
  // round boundaries even with no `rounds` list of its own).
  const storyPlaybackItems = useMemo(() => mediaModel.stories.flatMap((story) => (
    (story.mediaList ?? []).map((media) => ({
      ...media,
      storyKey: story.key,
      storyRoundLabel: story.roundLabel,
      storyTournamentName: model?.tournamentName,
      storyRoundIndex: story.roundIndex,
    }))
  )), [mediaModel, model]);

  const storyStartIndexByKey = useMemo(() => {
    const map = new Map();
    storyPlaybackItems.forEach((media, index) => {
      if (!map.has(media.storyKey)) map.set(media.storyKey, index);
    });
    return map;
  }, [storyPlaybackItems]);

  const openStoryIndex = openStoryKey ? storyStartIndexByKey.get(openStoryKey) : null;

  const openApp = () => Linking.openURL(`https://${BOARD_URL}`).catch(() => {});

  const footer = (
    <View style={s.footer}>
      <TouchableOpacity onPress={openApp} activeOpacity={0.7}>
        <Text style={s.footerText}>
          Scored with Golf Partner 🏌️ — <Text style={s.footerLink}>{BOARD_URL}</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={s.screen}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      </View>
    );
  }

  // Newest/live round first — the round someone is most likely to care about
  // leads the feed, matching "live round first/most prominent".
  const orderedRounds = model ? [...model.rounds].reverse() : [];

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent.primary}
          />
        )}
      >
        {notFound && (
          <View style={s.centeredCard}>
            <View style={s.icon}>
              <Feather name="link" size={28} color={theme.text.muted} />
            </View>
            <Text style={s.stateTitle}>This board link isn't active</Text>
            <Text style={s.stateSubtitle}>
              It may have been rotated or revoked. Ask the organiser for a fresh link.
            </Text>
          </View>
        )}

        {!notFound && error && !model && (
          <View style={s.centeredCard}>
            <View style={s.icon}>
              <Feather name="wifi-off" size={28} color={theme.text.muted} />
            </View>
            <Text style={s.stateTitle}>Couldn't load this board</Text>
            <Text style={s.stateSubtitle}>Check your connection and pull down to try again.</Text>
          </View>
        )}

        {!notFound && model && (
          <>
            <Hero model={model} createdAt={createdAt} s={s} />

            {error && (
              <Text style={s.staleHint}>Showing the last update — updating…</Text>
            )}

            {mediaModel.stories.length > 0 && (
              <RoundStoriesRail
                stories={mediaModel.stories}
                onPressStory={(story) => setOpenStoryKey(story.key)}
              />
            )}

            <OverallStandings overall={model.overall} s={s} theme={theme} />

            {orderedRounds.length === 0 ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>ROUNDS</Text>
                <Text style={s.emptyText}>No rounds yet</Text>
              </View>
            ) : orderedRounds.map((round) => {
              const story = storyByRoundId.get(round.id);
              const displayItem = attachMedia(round.feedItem, story);
              if (!displayItem) {
                return (
                  <View key={round.id} style={s.card}>
                    <Text style={s.cardTitle}>
                      {round.label}{round.isLive ? ' · LIVE' : ''}
                    </Text>
                    <Text style={s.emptyText}>No scores yet</Text>
                  </View>
                );
              }
              return (
                <FeedRoundCard
                  key={round.id}
                  item={displayItem}
                  roundLabel={round.label}
                  timestamp={round.isLive ? `Live · thru ${round.thru}` : `Final · ${round.holesPlayed} holes`}
                  onPressMedia={displayItem.mediaCoverUrl
                    ? () => setOpenStoryKey(`board-story:${round.id}`)
                    : undefined}
                />
              );
            })}
          </>
        )}

        {footer}
      </ScrollView>

      <MemoriesStoriesViewer
        visible={openStoryIndex != null}
        items={storyPlaybackItems}
        startIndex={openStoryIndex ?? 0}
        rounds={[]}
        storyTitle={model?.tournamentName}
        onClose={() => setOpenStoryKey(null)}
      />
    </View>
  );
}

// DEEP_GREEN hero — "green plays" per DESIGN.md: tournament name in
// Playfair, LIVE pill + "Thru N" (or a quiet FINAL chip once the tournament
// is done), course/date line, and the overall leader called out in ceremony
// gold. Same visual family as HomeScreen's mastersCard / LiveRoundCard /
// FormHero / CourseStatsScreen's CourseRecordBoard.
function Hero({ model, createdAt, s }) {
  const live = model.liveRoundIndex != null;
  const heroRound = live ? model.rounds[model.liveRoundIndex] : model.rounds[model.rounds.length - 1];
  const courseName = heroRound ? courseFromLabel(heroRound.label) : null;
  const dateLabel = formatHeroDate(createdAt);
  const metaLine = [courseName, dateLabel].filter(Boolean).join(' · ');
  const leader = model.overall[0] ?? null;

  return (
    <View style={s.hero} testID="shared-board-hero">
      <View style={s.heroTopRow}>
        {live ? (
          <View style={s.heroLivePill}>
            <View style={s.heroLiveDot} />
            <Text style={s.heroLivePillText}>LIVE</Text>
          </View>
        ) : model.rounds.length > 0 ? (
          <View style={s.heroFinalPill}>
            <Feather name="check-circle" size={11} color={CREAM_70} />
            <Text style={s.heroFinalPillText}>FINAL</Text>
          </View>
        ) : null}
        {live && <Text style={s.heroThru}>Thru {heroRound?.thru ?? 0}</Text>}
      </View>

      <Text style={s.heroTitle} numberOfLines={2}>{model.tournamentName}</Text>

      {metaLine ? <Text style={s.heroMeta} numberOfLines={1}>{metaLine}</Text> : null}

      {leader && (
        <View style={s.heroLeaderRow}>
          <Feather name="award" size={15} color={GOLD} />
          <Text style={s.heroLeaderText} numberOfLines={1}>
            {`${leader.player.name} leads · ${leader.points} pts`}
          </Text>
        </View>
      )}
    </View>
  );
}

// Overall standings, podium-style: top 3 get gold/silver/bronze rank badges
// (semantic.rank) and the leader's name reads in Playfair; the rest of the
// field is clean rows. This is the screen's centerpiece card.
function OverallStandings({ overall, s, theme }) {
  return (
    <View style={s.card} testID="shared-board-overall">
      <Text style={s.cardTitle}>OVERALL</Text>
      {overall.length === 0 ? (
        <Text style={s.emptyText}>No standings yet</Text>
      ) : overall.map((entry) => (
        <PodiumRow key={entry.player.id} entry={entry} s={s} theme={theme} />
      ))}
    </View>
  );
}

function PodiumRow({ entry, s, theme }) {
  const rank = theme.semantic.rank;
  const podiumColor = entry.place === 1 ? rank.gold : entry.place === 2 ? rank.silver
    : entry.place === 3 ? rank.bronze : null;
  const isLeader = entry.place === 1;
  const rankColor = podiumColor || theme.text.muted;
  const rankBg = podiumColor ? `${podiumColor}26` : theme.bg.secondary;
  const rankLabel = entry.isTie ? `T${entry.place}` : entry.place;
  const winnerColor = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;

  return (
    <View style={s.row}>
      <View style={[s.rankBadge, { backgroundColor: rankBg }]}>
        <Text style={[s.rankText, { color: rankColor }]}>{rankLabel}</Text>
      </View>
      <Text
        style={[s.rowName, isLeader && s.rowNameLeader]}
        numberOfLines={1}
      >
        {entry.player.name}
      </Text>
      <Text style={[s.rowPoints, isLeader && { color: winnerColor }]}>{entry.points} pts</Text>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: {
    padding: 20, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  centeredCard: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24,
  },
  icon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  stateTitle: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary,
    marginBottom: 6, textAlign: 'center',
  },
  stateSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.muted,
    textAlign: 'center', maxWidth: 300, lineHeight: 20,
  },

  // Hero — DEEP_GREEN surface, cream-on-green text (see CREAM constants
  // above; theme.bg.deep is the same fixed dark value in both themes, so its
  // text can't come from theme.text).
  hero: {
    backgroundColor: theme.bg.deep, borderRadius: 20, padding: 18, marginBottom: 16,
    ...(theme.isDark ? {} : { shadowColor: '#004030', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 6 }),
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  heroLivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: theme.destructive, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  heroLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CREAM },
  heroLivePillText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: CREAM, letterSpacing: 0.5,
  },
  heroFinalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  heroFinalPillText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: CREAM_70, letterSpacing: 0.5,
  },
  heroThru: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: CREAM_85 },
  heroTitle: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: CREAM, marginBottom: 4,
  },
  heroMeta: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: CREAM_70 },
  heroLeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(243,239,230,0.14)',
  },
  heroLeaderText: { flex: 1, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: CREAM },

  staleHint: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted,
    marginBottom: 12, fontStyle: 'italic',
  },

  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border.default,
    padding: 16, marginBottom: 16,
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.text.muted,
    letterSpacing: 1, marginBottom: 8,
  },
  emptyText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.muted, paddingVertical: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  rankText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  rowName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
  rowNameLeader: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16 },
  rowPoints: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary, marginLeft: 8 },

  footer: { alignItems: 'center', paddingTop: 12 },
  footerText: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted, textAlign: 'center',
  },
  footerLink: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.accent.primary,
  },
});
