import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useT } from '../i18n';
import { fetchPlayers } from '../store/libraryStore';
import { seasonTable } from '../store/leagueStandings';
import { formatPoints } from '../store/leagueView';
import { memberName } from '../lib/leagueNames';
import { MAX_FINAL_STROKES, clampFinalStrokes, suggestFinalStrokes } from '../store/leagueFinal';
import { leagueErrorText } from '../lib/leagueErrorText';
import { useConfirmSheet } from '../components/league/ConfirmSheet';

// Admin only: set the extra strokes each member gets in the December Final
// (prefilled from the standings, freely editable), then continue to Setup.
export default function LeagueFinalScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const t = useT();
  const { ask, sheet: confirmSheet } = useConfirmSheet();
  const notify = (title, message) => ask({ title, message });
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, loading, error } = useLeague(navigation, leagueId);
  const [strokes, setStrokes] = useState(null);
  const [busy, setBusy] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.members.filter((m) => !m.leftAt);
    return { active, table: seasonTable(active, data.cardsByMonth, data.league.pointsTable,
      { participationPoints: data.league.participationPoints }) };
  }, [data]);

  // Seed once from the standings; later refreshes never overwrite admin edits.
  useEffect(() => {
    if (view && strokes == null) setStrokes(suggestFinalStrokes(view.table));
  }, [view, strokes]);

  const header = (
    <ScreenHeader onBack={() => navigation.goBack()} title={t('league.final.title')} />
  );

  if (!view || !strokes) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <Text style={s.note}>{error || t('league.final.loadFailed')}</Text>
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
        <View style={s.center}><Text style={s.note}>{t('league.final.adminOnly')}</Text></View>
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
        notify(t('league.final.noPlayersTitle'), t('league.final.noPlayers'));
        return;
      }
      if (missing.length > 0) {
        notify(t('league.final.missingTitle'), t('league.final.missing', { count: missing.length, names: missing.join(', ') }));
      }
      navigation.navigate('Setup', {
        kind: 'tournament',
        leagueFinal: { leagueId, strokes },
        prefill: {
          name: t('league.final.tournamentName', { league: league.name }),
          players,
          settings: { scoringMode: 'individual' },
        },
      });
    } catch (err) {
      notify(t('league.final.continueFailed'), leagueErrorText(err) || t('league.final.connection'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.note}>{t('league.final.intro')}</Text>
        <View style={s.card}>
          {view.table.map((r, i) => {
            const name = memberName(members, r.userId, meId);
            const n = strokes[r.userId] ?? 0;
            return (
              <View key={r.userId} style={[s.row, i < view.table.length - 1 && s.divider]}>
                <Text style={s.place}>{r.place == null ? '–' : `${r.isTie ? 'T' : ''}${r.place}`}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{name}</Text>
                  <Text style={s.points}>{t('league.scoring.pts', { points: formatPoints(r.total) })}</Text>
                </View>
                <Text style={s.label}>{t('league.final.extraStrokes')}</Text>
                <View style={s.stepper}>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => bump(r.userId, -1)}
                    disabled={n <= 0}
                    accessibilityRole="button"
                    accessibilityLabel={t('league.final.fewer', { name })}
                  >
                    <Feather name="minus" size={16} color={n <= 0 ? theme.text.muted : theme.text.primary} />
                  </TouchableOpacity>
                  <Text style={s.value} accessibilityLabel={t('league.final.extraFor', { name })}>{n}</Text>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => bump(r.userId, 1)}
                    disabled={n >= MAX_FINAL_STROKES}
                    accessibilityRole="button"
                    accessibilityLabel={t('league.final.more', { name })}
                  >
                    <Feather name="plus" size={16} color={n >= MAX_FINAL_STROKES ? theme.text.muted : theme.text.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
        <TouchableOpacity style={s.primaryBtn} onPress={onContinue} disabled={busy} activeOpacity={0.8}>
          {busy ? <ActivityIndicator color={theme.text.inverse} /> : <Text style={s.primaryText}>{t('league.final.continue')}</Text>}
        </TouchableOpacity>
      </ScrollView>
      {confirmSheet}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, paddingBottom: 40 },
    note: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingHorizontal: 14, marginBottom: 16, ...(theme.isDark ? {} : theme.shadow.card),
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
    divider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    place: { width: 26, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.secondary, fontSize: 14, textAlign: 'center' },
    name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
    points: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 11, marginTop: 2 },
    label: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 11, width: 48, textAlign: 'right' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepBtn: {
      width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    value: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16, minWidth: 22, textAlign: 'center' },
    primaryBtn: btn.primaryBtn,
    primaryText: btn.primaryText,
  });
}
