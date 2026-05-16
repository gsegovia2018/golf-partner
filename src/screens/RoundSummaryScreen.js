import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { readLocal, roundTotals, setActiveTournament } from '../store/tournamentStore';
import { loadRoundMedia } from '../store/mediaStore';

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

export default function RoundSummaryScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { tournamentId, roundId } = route.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [media, setMedia] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: { user } }, t, roundMedia] = await Promise.all([
        supabase.auth.getUser(),
        fetchTournament(tournamentId),
        loadRoundMedia(roundId).catch(() => []),
      ]);
      setMe(user?.id ?? null);
      setTournament(t);
      setMedia(roundMedia);
    } finally {
      setLoading(false);
    }
  }, [tournamentId, roundId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function openInScorecard() {
    await setActiveTournament(tournamentId);
    navigation.navigate('Tournament');
  }

  const round = tournament?.rounds?.find((r) => r.id === roundId);
  const roundIndex = tournament?.rounds?.findIndex((r) => r.id === roundId) ?? -1;
  const players = tournament?.players ?? [];
  const iAmPlaying = players.some((p) => p.user_id && p.user_id === me);

  const totals = round ? roundTotals(round, players) : [];
  const ranked = [...totals]
    .filter((e) => e.totalStrokes > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);
  const holes = round?.holes ?? [];

  const strokeColor = (strokes, par) => {
    if (strokes == null) return theme.text.muted;
    if (strokes < par) return theme.accent.primary;
    if (strokes === par) return theme.text.primary;
    return theme.text.secondary;
  };

  const roundLabel = tournament?.kind === 'game'
    ? (round?.courseName || 'Round')
    : `Round ${roundIndex + 1}`;

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{roundLabel}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : !round ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={40} color={theme.text.muted} />
          <Text style={s.missingText}>This round is no longer available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.subTitle}>
            {tournament.name}
            {round.courseName ? ` · ${round.courseName}` : ''}
          </Text>

          <Text style={s.sectionLabel}>LEADERBOARD</Text>
          {ranked.length === 0 ? (
            <Text style={s.empty}>No scores recorded for this round.</Text>
          ) : (
            ranked.map((entry, i) => {
              const isMe = entry.player.user_id && entry.player.user_id === me;
              return (
                <View key={entry.player.id} style={[s.lbRow, isMe && s.lbRowMe]}>
                  <Text style={s.lbRank}>{i + 1}</Text>
                  <Text style={[s.lbName, isMe && s.lbNameMe]} numberOfLines={1}>
                    {entry.player.name}{isMe ? '  (you)' : ''}
                  </Text>
                  <View style={s.lbStat}>
                    <Text style={s.lbStatValue}>{entry.totalPoints}</Text>
                    <Text style={s.lbStatLabel}>PTS</Text>
                  </View>
                  <View style={s.lbStat}>
                    <Text style={s.lbStatValue}>{entry.totalStrokes}</Text>
                    <Text style={s.lbStatLabel}>STR</Text>
                  </View>
                </View>
              );
            })
          )}

          {holes.length > 0 && ranked.length > 0 && (
            <>
              <Text style={s.sectionLabel}>SCORECARD</Text>
              <View style={s.gridWrap}>
                <View style={s.gridLabelCol}>
                  <View style={s.gridHeadCell}><Text style={s.gridHeadText}>Hole</Text></View>
                  <View style={s.gridCell}><Text style={s.gridParLabel}>Par</Text></View>
                  {ranked.map((entry) => (
                    <View key={entry.player.id} style={s.gridCell}>
                      <Text style={s.gridNameText} numberOfLines={1}>
                        {entry.player.name.split(' ')[0]}
                      </Text>
                    </View>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={s.gridRow}>
                      {holes.map((h) => (
                        <View key={h.number} style={[s.gridHeadCell, s.gridDataCell]}>
                          <Text style={s.gridHeadText}>{h.number}</Text>
                        </View>
                      ))}
                      <View style={[s.gridHeadCell, s.gridDataCell, s.gridTotCell]}>
                        <Text style={s.gridHeadText}>Tot</Text>
                      </View>
                    </View>
                    <View style={s.gridRow}>
                      {holes.map((h) => (
                        <View key={h.number} style={[s.gridCell, s.gridDataCell]}>
                          <Text style={s.gridParValue}>{h.par}</Text>
                        </View>
                      ))}
                      <View style={[s.gridCell, s.gridDataCell, s.gridTotCell]}>
                        <Text style={s.gridParValue}>
                          {holes.reduce((sum, h) => sum + (h.par || 0), 0)}
                        </Text>
                      </View>
                    </View>
                    {ranked.map((entry) => {
                      const pScores = round.scores?.[entry.player.id] ?? {};
                      return (
                        <View key={entry.player.id} style={s.gridRow}>
                          {holes.map((h) => {
                            const v = pScores[h.number];
                            return (
                              <View key={h.number} style={[s.gridCell, s.gridDataCell]}>
                                <Text style={[s.gridScore, { color: strokeColor(v, h.par) }]}>
                                  {v ?? '·'}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={[s.gridCell, s.gridDataCell, s.gridTotCell]}>
                            <Text style={s.gridTotValue}>{entry.totalStrokes}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            </>
          )}

          {media.length > 0 && (
            <>
              <Text style={s.sectionLabel}>PHOTOS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {media.map((m) => (
                  <Image
                    key={m.id}
                    source={{ uri: m.thumbUrl || m.url }}
                    style={s.photo}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            </>
          )}

          {round.notes?.round ? (
            <>
              <Text style={s.sectionLabel}>NOTES</Text>
              <Text style={s.notes}>{round.notes.round}</Text>
            </>
          ) : null}

          {(() => {
            const holeNotes = Object.entries(round.notes?.hole ?? {})
              .filter(([, text]) => text && text.trim())
              .sort(([a], [b]) => Number(a) - Number(b));
            if (holeNotes.length === 0) return null;
            return (
              <>
                <Text style={s.sectionLabel}>HOLE NOTES</Text>
                {holeNotes.map(([hole, text]) => (
                  <View key={hole} style={s.holeNoteRow}>
                    <Text style={s.holeNoteLabel}>{`Hole ${hole}`}</Text>
                    <Text style={s.holeNoteText}>{text}</Text>
                  </View>
                ))}
              </>
            );
          })()}

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
        </ScrollView>
      )}
    </SafeAreaView>
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
      flex: 1, textAlign: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    missingText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },
    content: { padding: 20, paddingBottom: 60 },
    subTitle: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontSize: 13, marginBottom: 4,
    },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 22, marginBottom: 10, textTransform: 'uppercase',
    },
    empty: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13 },

    lbRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, padding: 12, marginBottom: 8,
    },
    lbRowMe: { borderColor: theme.accent.primary },
    lbRank: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.text.muted,
      width: 22, textAlign: 'center',
    },
    lbName: {
      flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary,
    },
    lbNameMe: { color: theme.accent.primary },
    lbStat: { alignItems: 'center', minWidth: 42 },
    lbStatValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary },
    lbStatLabel: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 8, letterSpacing: 1,
      color: theme.text.muted, marginTop: 1,
    },

    gridWrap: {
      flexDirection: 'row', backgroundColor: theme.bg.card,
      borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
      overflow: 'hidden',
    },
    gridLabelCol: {
      borderRightWidth: 1, borderRightColor: theme.border.default, width: 84,
    },
    gridRow: { flexDirection: 'row' },
    gridHeadCell: {
      height: 34, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.bg.secondary, paddingHorizontal: 8,
    },
    gridCell: {
      height: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
    },
    gridDataCell: { width: 34, paddingHorizontal: 0 },
    gridTotCell: {
      width: 42, borderLeftWidth: 1, borderLeftColor: theme.border.default,
    },
    gridHeadText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.text.muted,
    },
    gridParLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.muted,
    },
    gridParValue: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.muted,
    },
    gridNameText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.text.primary,
    },
    gridScore: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
    gridTotValue: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: theme.text.primary,
    },

    photo: {
      width: 130, height: 130, borderRadius: 12, marginRight: 8,
      backgroundColor: theme.bg.secondary,
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
  });
}
