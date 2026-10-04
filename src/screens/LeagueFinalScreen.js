import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { fetchPlayers } from '../store/libraryStore';
import { seasonTable } from '../store/leagueStandings';
import { formatPoints, memberName } from '../store/leagueView';
import { MAX_FINAL_STROKES, clampFinalStrokes, suggestFinalStrokes } from '../store/leagueFinal';

function notify(title, message) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}

// Admin only: set the extra strokes each member gets in the December Final
// (prefilled from the standings, freely editable), then continue to Setup.
export default function LeagueFinalScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, loading, error } = useLeague(navigation, leagueId);
  const [strokes, setStrokes] = useState(null);
  const [busy, setBusy] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.members.filter((m) => !m.leftAt);
    return { active, table: seasonTable(active, data.cardsByMonth, data.league.pointsTable) };
  }, [data]);

  // Seed once from the standings; later refreshes never overwrite admin edits.
  useEffect(() => {
    if (view && strokes == null) setStrokes(suggestFinalStrokes(view.table));
  }, [view, strokes]);

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle}>The Final</Text>
    </View>
  );

  if (!view || !strokes) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <Text style={s.note}>{error || 'Could not load the league.'}</Text>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { league, members } = data;
  const isAdmin = view.active.some((m) => m.userId === meId && m.role === 'admin');
  if (!isAdmin) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}><Text style={s.note}>Only the league admin can set up the Final.</Text></View>
      </ScreenContainer>
    );
  }

  const bump = (userId, delta) => setStrokes((prev) => ({
    ...prev, [userId]: clampFinalStrokes((prev[userId] ?? 0) + delta),
  }));

  async function onContinue() {
    if (busy) return;
    setBusy(true);
    try {
      const library = await fetchPlayers();
      const players = [];
      const missing = [];
      for (const m of view.active) {
        const p = library.find((x) => x.user_id === m.userId);
        if (p) {
          players.push({
            id: p.id, name: p.name, handicap: p.handicap, user_id: p.user_id,
            avatar_url: p.avatar_url ?? null, gender: p.gender ?? null,
          });
        } else missing.push(memberName(members, m.userId, meId));
      }
      if (players.length < 1) {
        notify('No players found', 'None of the members have a player profile yet.');
        return;
      }
      if (missing.length > 0) {
        notify('Not in the Final', `${missing.join(', ')} ${missing.length > 1 ? 'have' : 'has'} no player profile yet. Add them in Setup if they play.`);
      }
      navigation.navigate('Setup', {
        kind: 'tournament',
        leagueFinal: { leagueId, strokes },
        prefill: {
          name: `${league.name} Final`,
          players,
          settings: { scoringMode: 'individual' },
        },
      });
    } catch (err) {
      notify('Could not continue', err?.message ?? 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.note}>Extra strokes are added to each player's playing handicap for the Final.</Text>
        <View style={s.card}>
          {view.table.map((r, i) => {
            const name = memberName(members, r.userId, meId);
            const n = strokes[r.userId] ?? 0;
            return (
              <View key={r.userId} style={[s.row, i < view.table.length - 1 && s.divider]}>
                <Text style={s.place}>{r.place == null ? '–' : `${r.isTie ? 'T' : ''}${r.place}`}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{name}</Text>
                  <Text style={s.points}>{`${formatPoints(r.total)} pts`}</Text>
                </View>
                <Text style={s.label}>Extra strokes</Text>
                <View style={s.stepper}>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => bump(r.userId, -1)}
                    disabled={n <= 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Fewer extra strokes for ${name}`}
                  >
                    <Feather name="minus" size={16} color={n <= 0 ? theme.text.muted : theme.text.primary} />
                  </TouchableOpacity>
                  <Text style={s.value} accessibilityLabel={`Extra strokes for ${name}`}>{n}</Text>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => bump(r.userId, 1)}
                    disabled={n >= MAX_FINAL_STROKES}
                    accessibilityRole="button"
                    accessibilityLabel={`More extra strokes for ${name}`}
                  >
                    <Feather name="plus" size={16} color={n >= MAX_FINAL_STROKES ? theme.text.muted : theme.text.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
        <TouchableOpacity style={s.primaryBtn} onPress={onContinue} disabled={busy} activeOpacity={0.8}>
          {busy ? <ActivityIndicator color={theme.text.inverse} /> : <Text style={s.primaryText}>Continue to setup</Text>}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 4 },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3 },
    content: { padding: 16, paddingBottom: 40 },
    note: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingHorizontal: 14, marginBottom: 16, ...(theme.isDark ? {} : theme.shadow.card),
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    place: { width: 26, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.muted, fontSize: 14, textAlign: 'center' },
    name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
    points: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11, marginTop: 2 },
    label: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 10, width: 48, textAlign: 'right' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepBtn: {
      width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    value: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16, minWidth: 22, textAlign: 'center' },
    primaryBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14 },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
  });
}
