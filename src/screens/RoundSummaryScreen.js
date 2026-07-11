import React, {
  useCallback, useRef, useState,
} from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  readLocal, roundTotals, formatRoundLabel,
  getTournamentSnapshot, isTournamentFinished,
} from '../store/tournamentStore';
import { loadRoundMedia } from '../store/mediaStore';
import RoundRecapPanel from '../components/roundSummary/RoundRecapPanel';
import RoundSummaryTabs from '../components/roundSummary/RoundSummaryTabs';
import PullToRefresh from '../components/PullToRefresh';
import RoundLeaderboard from '../components/roundSummary/RoundLeaderboard';
import CommentThread from '../components/CommentThread';
import { ScorecardTable, resolveScorecardRows } from '../components/scorecard/GridView';
import { buildRoundRecap } from './roundSummaryModel';
import { normalizeRoundNotes } from '../store/roundNotes';

// Read-only summary of a single round — the feed's drill-in target. Works
// for the current user's own rounds and for friends' rounds (read access
// granted by the friend-aware RLS in 20260515_friends_and_feed.sql).

async function fetchTournament(id) {
  try {
    const { data } = await supabase
      .from('tournaments').select('data').eq('id', id).maybeSingle();
    if (data?.data) return data.data;
  } catch { /* fall through to local cache */ }
  return readLocal(id);
}

function roundFeedKey(tournamentId, roundId) {
  return tournamentId && roundId ? `round:${tournamentId}:${roundId}` : null;
}

export default function RoundSummaryScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { tournamentId, roundId } = route.params ?? {};
  const initialTournament = getTournamentSnapshot(tournamentId);

  const [tournament, setTournament] = useState(() => initialTournament);
  const [media, setMedia] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(() => !initialTournament);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(!!initialTournament);
  const [activeTab, setActiveTab] = useState('scorecard');

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const [{ data: { user } }, t, roundMedia] = await Promise.all([
        supabase.auth.getUser(),
        fetchTournament(tournamentId),
        loadRoundMedia(tournamentId, roundId).catch(() => []),
      ]);
      setMe(user?.id ?? null);
      setTournament(t);
      setMedia(roundMedia);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [tournamentId, roundId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  function openInScorecard() {
    navigation.navigate('Tournament', { tournamentId, viewMode: 'tournament' });
  }

  const round = tournament?.rounds?.find((r) => r.id === roundId);
  const roundIndex = tournament?.rounds?.findIndex((r) => r.id === roundId) ?? -1;
  const players = tournament?.players ?? [];
  const iAmPlaying = players.some((p) => p.user_id && p.user_id === me);

  const totals = round ? roundTotals(round, players) : [];
  const ranked = [...totals]
    .filter((e) => e.totalStrokes > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);

  const roundLabel = formatRoundLabel({
    kind: tournament?.kind,
    courseName: round?.courseName,
    roundIndex,
  });
  const recap = round ? buildRoundRecap({ round, ranked }) : null;
  const totalHoles = round?.holes?.length ?? 18;
  // Round is live when the tournament is still open and play has started but
  // not everyone has finished — mirrors the feed's `live` flag.
  const live = !!round
    && !isTournamentFinished(tournament)
    && (recap?.holesPlayed ?? 0) > 0
    && (recap?.holesPlayed ?? 0) < totalHoles;

  const liveRef = useRef(false);
  liveRef.current = live;

  useFocusEffect(useCallback(() => {
    load();
    // Poll while the round is live so scores tick in without a manual pull.
    const id = setInterval(() => { if (liveRef.current) load(); }, 45000);
    return () => clearInterval(id);
  }, [load]));

  // The scorecard highlights "my" row by player id, not auth user id.
  const myPlayerId = players.find((p) => p.user_id && p.user_id === me)?.id ?? null;
  const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
    round, settings: tournament?.settings, players, meId: myPlayerId,
  });

  const normalizedNotes = normalizeRoundNotes(round?.notes);
  const roundNote = typeof normalizedNotes.round === 'string'
    ? normalizedNotes.round.trim()
    : '';
  const holeNotes = Object.entries(normalizedNotes.hole ?? {})
    .filter(([, text]) => typeof text === 'string' && text.trim())
    .sort(([a], [b]) => Number(a) - Number(b));
  const hasNotes = Boolean(roundNote) || holeNotes.length > 0;

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{roundLabel}</Text>
        {live ? (
          <View style={s.liveBadge} accessibilityLabel="Live round in progress">
            <View style={s.liveDot} />
            <Text style={s.liveBadgeText}>LIVE</Text>
          </View>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : !round ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={40} color={theme.text.muted} />
          <Text style={s.missingText}>This round is no longer available.</Text>
        </View>
      ) : (
        <PullToRefresh
          contentContainerStyle={s.content}
          refreshing={refreshing}
          onRefresh={onRefresh}
        >
          <RoundSummaryTabs active={activeTab} onChange={setActiveTab} />

          {activeTab === 'scorecard' ? (
            <>
              {/* Recap belongs to the scorecard story — Photos and Comments
                  go straight to their content under the tabs. */}
              <RoundRecapPanel
                recap={recap}
                roundLabel={roundLabel}
                tournamentName={tournament?.name}
                live={live}
                totalHoles={totalHoles}
              />
              <RoundLeaderboard entries={ranked} round={round} live={live} />
              <ScorecardTable
                round={round}
                players={rowPlayers}
                scores={round.scores ?? {}}
                onSetScore={() => {}}
                editable={() => false}
                mode={mode}
                meId={effectiveMeId}
                handicapsOverride={rowHandicaps}
                showTotalsCard={false}
                highlightCurrentHole={live}
              />
            </>
          ) : null}

          {activeTab === 'photos' ? (
            media.length > 0 ? (
              <View style={s.photoGrid}>
                {media.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={s.photoCell}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('Gallery', { tournamentId, mediaId: m.id })}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open photo in gallery"
                  >
                    <Image source={{ uri: m.thumbUrl || m.url }} style={s.photo} resizeMode="cover" />
                    {m.kind === 'video' ? (
                      <View style={s.photoKindBadge}>
                        <Feather name="film" size={11} color="#fff" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={s.empty}>No photos for this round.</Text>
            )
          ) : null}

          {activeTab === 'comments' ? (
            <View>
              <CommentThread itemKey={roundFeedKey(tournamentId, roundId)} active={activeTab === 'comments'} />

              {hasNotes ? (
                <>
                  {roundNote ? (
                    <>
                      <Text style={s.sectionLabel}>NOTES</Text>
                      <Text style={s.notes}>{roundNote}</Text>
                    </>
                  ) : null}
                  {holeNotes.length > 0 ? (
                    <>
                      <Text style={s.sectionLabel}>HOLE NOTES</Text>
                      {holeNotes.map(([hole, text]) => (
                        <View key={hole} style={s.holeNoteRow}>
                          <Text style={s.holeNoteLabel}>{`Hole ${hole}`}</Text>
                          <Text style={s.holeNoteText}>{text.trim()}</Text>
                        </View>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}

          {iAmPlaying && (
            <TouchableOpacity
              style={s.openBtn}
              onPress={openInScorecard}
              activeOpacity={0.85}
            >
              <Feather name="edit-3" size={15} color={theme.text.inverse} />
              <Text style={s.openBtnText}>Open in scorecard</Text>
            </TouchableOpacity>
          )}
        </PullToRefresh>
      )}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 16, color: theme.text.primary,
      flex: 1, textAlign: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    missingText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },
    content: {
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 60,
      gap: 12,
    },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 22, marginBottom: 10, textTransform: 'uppercase',
    },
    empty: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13 },

    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photoCell: {
      width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    photo: { width: '100%', height: '100%' },
    photoKindBadge: {
      position: 'absolute', right: 6, bottom: 6,
      borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.58)', padding: 5,
    },
    notes: {
      fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
      fontSize: 14, lineHeight: 20,
    },
    holeNoteRow: {
      flexDirection: 'row', gap: 10, marginBottom: 8,
      backgroundColor: theme.bg.card, borderRadius: 12, borderWidth: 1,
      borderColor: theme.border.default, padding: 12,
    },
    holeNoteLabel: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
      fontSize: 12, width: 56,
    },
    holeNoteText: {
      flex: 1, fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
      fontSize: 14, lineHeight: 20,
    },
    openBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: theme.accent.primary, borderRadius: 14,
      padding: 15, marginTop: 28,
    },
    openBtnText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 15,
    },

    // Glowing red "LIVE" badge in the header while the round is in progress.
    liveBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: theme.scoreColor('poor') + '22',
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
      borderWidth: 1, borderColor: theme.scoreColor('poor'),
      shadowColor: theme.scoreColor('poor'), shadowOpacity: 0.5,
      shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 4,
    },
    liveDot: {
      width: 6, height: 6, borderRadius: 3, backgroundColor: theme.scoreColor('poor'),
    },
    liveBadgeText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.scoreColor('poor'),
      fontSize: 10, letterSpacing: 0.5,
    },
  });
}
