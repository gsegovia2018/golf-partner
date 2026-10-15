// Game Stats (Game settings → Statistics): the shell. Loads the game, picks
// the tab (Summary · Rounds · Players · Rivals) and owns the one detail
// sheet. Each tab lives in src/components/gamestats; the numbers come from
// src/store/gameStatsView + statsEngine. Plan:
// docs/superpowers/plans/2026-10-15-game-stats-redesign.md.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import StatDetailSheet from '../components/StatDetailSheet';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  loadTournament, getTournament, getActiveTournamentSnapshot, getTournamentSnapshot, roundScoringMode,
} from '../store/tournamentStore';
import { withoutScrambleScores } from '../store/statsEngine';
import { scoredRoundIndices } from '../store/gameStatsView';
import { scoringModeUsesTeams, isScrambleMode } from '../components/scoringModes';
import SummaryTab from '../components/gamestats/SummaryTab';
import RoundsTab from '../components/gamestats/RoundsTab';
import PlayersTab from '../components/gamestats/PlayersTab';
import RivalsTab from '../components/gamestats/RivalsTab';
import { Chip } from '../components/gamestats/ui';
import { useT } from '../i18n';

export default function StatsScreen({ navigation, route }) {
  const t = useT();
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const routeRoundId = route?.params?.roundId ?? null;
  const [tournament, setTournament] = useState(() => (
    routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()
  ));
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState(routeRoundId ? 'rounds' : 'summary');
  const [roundIndex, setRoundIndex] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [sheet, setSheet] = useState(null);

  useEffect(() => {
    const load = routeTournamentId ? getTournament(routeTournamentId) : loadTournament();
    load.then((loaded) => {
      if (!loaded) { setLoadFailed(true); return; }
      setTournament(loaded);
      if (routeRoundId) {
        const idx = loaded.rounds?.findIndex((r) => r.id === routeRoundId) ?? -1;
        if (idx >= 0) setRoundIndex(idx);
      }
    }).catch((e) => {
      console.warn('StatsScreen: failed to load tournament', e);
      setLoadFailed(true);
    });
  }, [routeTournamentId, routeRoundId]);

  // Scramble rounds keep one team ball under the captain: blank them so no
  // personal stat credits the team's play to one player.
  const statsTournament = useMemo(() => (tournament ? withoutScrambleScores(tournament) : null), [tournament]);

  const players = useMemo(() => tournament?.players ?? [], [tournament]);
  const meId = useMemo(() => {
    const mine = players.find((p) => user?.id && p.user_id === user.id);
    return mine?.id ?? tournament?.meId ?? players[0]?.id ?? null;
  }, [players, user?.id, tournament?.meId]);

  // Team data only from rounds really played in teams (not scramble, and a
  // mode the roster can play in pairs); other rounds lose their pairs so the
  // pair aggregates skip them without shifting any round index.
  const teamInfo = useMemo(() => {
    if (!statsTournament) return { any: false, pairsTournament: null };
    let any = false;
    const rounds = statsTournament.rounds.map((r) => {
      const mode = roundScoringMode(statsTournament, r);
      const team = players.length > 1 && scoringModeUsesTeams(mode, players.length) && !isScrambleMode(mode);
      if (team && r.pairs?.length >= 2 && r.scores && Object.keys(r.scores).length) any = true;
      return team ? r : { ...r, pairs: null };
    });
    return { any, pairsTournament: any ? { ...statsTournament, rounds } : null };
  }, [statsTournament, players.length]);

  const openSheet = useCallback((next) => setSheet(next), []);
  const showPlayer = useCallback((id) => { setPlayerId(id); setTab('players'); }, []);
  const openMyStats = useCallback(() => navigation.navigate('MyStats'), [navigation]);

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} />
      <View style={s.headerText}>
        <Text style={s.title}>{t('stats.screen.title')}</Text>
        {tournament?.name ? (
          <Text style={s.subtitle} numberOfLines={1}>
            {t('stats.game.header.sub', { name: tournament.name, count: tournament.rounds?.length ?? 0 })}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!tournament) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        {loadFailed ? (
          <View style={s.notice}>
            <Text style={s.noticeTitle}>{t('stats.game.error.title')}</Text>
            <Text style={s.noticeText}>{t('stats.game.error.body')}</Text>
          </View>
        ) : (
          <ActivityIndicator style={{ marginTop: 48 }} color={theme.accent.primary} />
        )}
      </ScreenContainer>
    );
  }

  const modes = (tournament.rounds ?? []).map((r) => roundScoringMode(tournament, r));
  if (modes.length > 0 && modes.every((m) => isScrambleMode(m))) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.notice}>
          <View style={s.noticeIcon}>
            <Feather name="users" size={26} color={theme.accent.primary} />
          </View>
          <Text style={s.noticeTitle}>{t('stats.screen.scrambleNotice.title')}</Text>
          <Text style={s.noticeText}>{t('stats.screen.scrambleNotice.body')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  const hasScores = scoredRoundIndices(statsTournament).length > 0;
  const tabs = [
    { key: 'summary', label: t('stats.game.tab.summary') },
    { key: 'rounds', label: t('stats.game.tab.rounds') },
    { key: 'players', label: t('stats.game.tab.players') },
    players.length > 1 && { key: 'rivals', label: t('stats.game.tab.rivals') },
  ].filter(Boolean);
  const activeTab = tabs.some((x) => x.key === tab) ? tab : 'summary';

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      {!hasScores ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>{t('stats.game.empty.title')}</Text>
          <Text style={s.noticeText}>{t('stats.game.empty.body')}</Text>
        </View>
      ) : (
        <>
          <View style={s.tabs} accessibilityRole="tablist">
            {tabs.map((x) => (
              <Chip key={x.key} testID={`tab-${x.key}`} label={x.label} active={activeTab === x.key} onPress={() => setTab(x.key)} />
            ))}
          </View>
          <ScrollView key={activeTab} style={s.scroll} contentContainerStyle={s.content}>
            {activeTab === 'summary' && (
              <SummaryTab
                tournament={statsTournament}
                resultTournament={tournament}
                teams={teamInfo.any}
                onOpenSheet={openSheet}
                onPlayerPress={showPlayer}
              />
            )}
            {activeTab === 'rounds' && (
              <RoundsTab
                tournament={statsTournament}
                pairsTournament={teamInfo.pairsTournament}
                roundIndex={roundIndex}
                onSelectRound={setRoundIndex}
                onOpenSheet={openSheet}
              />
            )}
            {activeTab === 'players' && (
              <PlayersTab
                tournament={statsTournament}
                selectedId={playerId ?? meId}
                onSelectPlayer={setPlayerId}
                onOpenSheet={openSheet}
                onOpenMyStats={openMyStats}
              />
            )}
            {activeTab === 'rivals' && (
              <RivalsTab
                tournament={statsTournament}
                pairsTournament={teamInfo.pairsTournament}
                fixedTeams={!!tournament.settings?.fixedTeams}
                defaultPlayerId={meId}
                onOpenSheet={openSheet}
              />
            )}
          </ScrollView>
        </>
      )}
      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        explainer={sheet?.explainer}
        rows={sheet?.rows || []}
      />
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, letterSpacing: -0.3, color: theme.text.primary },
  subtitle: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary, marginTop: 1 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  notice: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 48 },
  noticeIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.accent.light, marginBottom: 16,
  },
  noticeTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary, textAlign: 'center', marginBottom: 8 },
  noticeText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, lineHeight: 19, color: theme.text.secondary, textAlign: 'center' },
});
