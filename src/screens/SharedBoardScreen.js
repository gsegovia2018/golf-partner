// Public, read-only live leaderboard page — see
// docs/superpowers/plans/2026-08-16-shareable-live-board.md, build item 4.
//
// Rendered two ways: bare, pre-session, outside any navigator (App.js's
// `!session` branch, same precedent as JoinTournamentLinkScreen) with a
// `token` prop, or — a later work stream may add this — as a normal
// navigation route with `route.params.token`. Either way this screen must
// tolerate having no navigator around it, so it never touches a navigation
// hook.
//
// All scoring/ranking math lives in `src/store/sharedBoard.js`
// (`buildSharedBoardModel`) — this screen only renders that model's output.
// It talks to the network via exactly one call: the `get_shared_board`
// SECURITY DEFINER RPC (granted to `anon`), so it renders with zero auth
// affordances and no session is ever required.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
  TouchableOpacity, Linking, AppState,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { buildSharedBoardModel } from '../store/sharedBoard';

// Same idea as useOfficialRound's 20s poll (src/hooks/useOfficialRound.js) —
// the RPC has no `updated_at` to diff against, so a full refetch is the only
// freshness mechanism. 30s here because this is a passive read-only page,
// not an active scoring session.
const POLL_MS = 30000;

const BOARD_URL = 'golf-partner.vercel.app';

export default function SharedBoardScreen(props) {
  const token = props.token ?? props.route?.params?.token;
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [model, setModel] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // null = no manual pick yet, so the default (live round, else last round)
  // is derived at render time below. Only a tap sets this, so a poll refresh
  // never yanks a visitor back off a round they picked by hand.
  const [roundOverride, setRoundOverride] = useState(null);

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

  // Initial load + 30s poll, gated on the app/tab being foregrounded (a
  // background timer would just burn the anon RPC quota for nobody to see).
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchBoard();

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
  }, [fetchBoard]);

  // Selected round: a manual pick if it's still in range, else the live
  // round, else the last round.
  const selectedRound = (() => {
    if (!model || model.rounds.length === 0) return null;
    if (roundOverride != null && roundOverride < model.rounds.length) return roundOverride;
    return model.liveRoundIndex != null ? model.liveRoundIndex : model.rounds.length - 1;
  })();

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

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchBoard({ isRefresh: true })}
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
            <View style={s.header}>
              <Text style={s.tournamentName} numberOfLines={2}>{model.tournamentName}</Text>
              {model.liveRoundIndex != null && (
                <View style={s.liveRow}>
                  <View style={s.livePill}>
                    <View style={s.liveDot} />
                    <Text style={s.livePillText}>LIVE</Text>
                  </View>
                  <Text style={s.liveThru}>
                    Thru {model.rounds[model.liveRoundIndex]?.thru ?? 0}
                  </Text>
                </View>
              )}
              {error && (
                <Text style={s.staleHint}>Showing the last update — updating…</Text>
              )}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>OVERALL</Text>
              {model.overall.length === 0 ? (
                <Text style={s.emptyText}>No standings yet</Text>
              ) : model.overall.map((entry) => (
                <BoardRow key={entry.player.id} entry={entry} s={s} theme={theme} showStrokes={false} />
              ))}
            </View>

            {model.rounds.length === 0 ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>ROUNDS</Text>
                <Text style={s.emptyText}>No rounds yet</Text>
              </View>
            ) : (
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>ROUNDS</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar}>
                  {model.rounds.map((round, index) => (
                    <TouchableOpacity
                      key={round.id}
                      style={[s.tab, selectedRound === index && s.tabActive]}
                      onPress={() => setRoundOverride(index)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.tabText, selectedRound === index && s.tabTextActive]}>
                        {round.label}{round.isLive ? ' · LIVE' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {(() => {
                  const round = model.rounds[selectedRound] ?? model.rounds[model.rounds.length - 1];
                  if (!round) return null;
                  const showStrokes = round.leaderboard.unit === 'pts';
                  return (
                    <>
                      <Text style={s.roundStatus}>
                        {round.isLive ? `Live · thru ${round.thru}` : `Final · ${round.holesPlayed} holes`}
                      </Text>
                      {round.leaderboard.entries.length === 0 ? (
                        <Text style={s.emptyText}>No scores yet</Text>
                      ) : round.leaderboard.entries.map((entry) => (
                        <BoardRow
                          key={entry.player.id}
                          entry={entry}
                          s={s}
                          theme={theme}
                          unit={round.leaderboard.unit}
                          showStrokes={showStrokes}
                        />
                      ))}
                    </>
                  );
                })()}
              </View>
            )}
          </>
        )}

        {footer}
      </ScrollView>
    </View>
  );
}

function BoardRow({ entry, s, theme, unit, showStrokes }) {
  const rankColors = [theme.semantic.rank.gold, theme.semantic.rank.silver, theme.semantic.rank.bronze];
  const rankColor = rankColors[entry.place - 1] || theme.text.muted;
  const rankLabel = entry.isTie ? `T${entry.place}` : entry.place;
  return (
    <View style={s.row}>
      <View style={s.rankBadge}>
        <Text style={[s.rankText, { color: rankColor }]}>{rankLabel}</Text>
      </View>
      <Text style={s.rowName} numberOfLines={1}>{entry.player.name}</Text>
      <Text style={s.rowPoints}>{entry.points} {unit || 'pts'}</Text>
      {showStrokes && entry.strokes != null && (
        <Text style={s.rowStrokes}>{entry.strokes || '-'} str</Text>
      )}
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
  header: { marginBottom: 16 },
  tournamentName: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: theme.text.primary, marginBottom: 8,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: theme.destructive, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.text.inverse },
  livePillText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.text.inverse, letterSpacing: 0.5,
  },
  liveThru: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.muted },
  staleHint: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted,
    marginTop: 6, fontStyle: 'italic',
  },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border.default,
    padding: 16, marginBottom: 16,
  },
  cardTitleRow: { marginBottom: 8 },
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
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10,
    backgroundColor: theme.bg.secondary,
  },
  rankText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  rowName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary },
  rowPoints: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary, marginLeft: 8 },
  rowStrokes: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted, marginLeft: 8, width: 44, textAlign: 'right' },
  tabBar: { marginBottom: 10 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.bg.secondary,
    marginRight: 8,
  },
  tabActive: { backgroundColor: theme.accent.primary },
  tabText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted },
  tabTextActive: { color: theme.text.inverse },
  roundStatus: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted, marginBottom: 8,
  },
  footer: { alignItems: 'center', paddingTop: 12 },
  footerText: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted, textAlign: 'center',
  },
  footerLink: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.accent.primary,
  },
});
