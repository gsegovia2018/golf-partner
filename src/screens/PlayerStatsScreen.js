import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import PersonAvatar from '../components/ui/PersonAvatar';
import StatDetailSheet from '../components/StatDetailSheet';
import { useTheme } from '../theme/ThemeContext';
import { loadFriendStatsData, getCachedFriends } from '../store/friendStore';
import {
  sharedRounds, headToHead, buildFriendSummary, friendVerdict,
} from '../store/friendStats';
import { statExplainers } from '../components/mystats/statExplainers';
import SummaryTab from '../components/playerstats/SummaryTab';
import TogetherTab from '../components/playerstats/TogetherTab';
import FormTab from '../components/mystats/tabs/FormTab';
import BreakdownTab from '../components/mystats/tabs/BreakdownTab';
import HandicapTab from '../components/mystats/tabs/HandicapTab';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'form', label: 'Form' },
  { key: 'handicap', label: 'Handicap' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'together', label: 'Together' },
];

// A friend's game, read-only: Summary (new), the existing Form/Handicap/
// Breakdown tab bodies fed from this friend's rounds, and a Together tab of
// rounds you've both played. All the maths lives in store/friendStats.js and
// store/personalStats.js — this screen only wires data to components.
export default function PlayerStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const paramFriend = route?.params?.friend;
  // Callers that only know a player's id/name/avatar (the feed) pass a
  // partial person; fill username, gender and handicap from the friends
  // cache so the header and verdict pronouns read the same as from Friends.
  const [cachedFriend, setCachedFriend] = useState(null);
  useEffect(() => {
    if (!paramFriend?.userId || paramFriend.username) return undefined;
    let cancelled = false;
    getCachedFriends().then((list) => {
      const hit = (list || []).find((f) => f.userId === paramFriend.userId);
      if (!cancelled && hit) setCachedFriend(hit);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [paramFriend]);
  const friend = useMemo(
    () => (paramFriend ? { ...(cachedFriend ?? {}), ...paramFriend } : paramFriend),
    [paramFriend, cachedFriend],
  );

  const [data, setData] = useState(null); // { me, myRounds, friendRounds, tournaments }
  const [error, setError] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [tab, setTab] = useState('summary');
  const [n, setN] = useState(5);
  const [infoKey, setInfoKey] = useState(null);

  useEffect(() => {
    if (!friend) return undefined;
    let cancelled = false;
    setError(false);
    loadFriendStatsData(friend)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        console.warn('PlayerStatsScreen: failed to load friend stats', e);
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [friend, loadNonce]);

  const summary = useMemo(
    () => (data?.friendRounds?.length ? buildFriendSummary(data.friendRounds, { n }) : null),
    [data, n],
  );
  const verdict = useMemo(
    () => (summary ? friendVerdict(summary, { gender: friend?.gender }) : null),
    [summary, friend],
  );
  const shared = useMemo(
    () => (data?.myRounds && data?.friendRounds ? sharedRounds(data.myRounds, data.friendRounds) : []),
    [data],
  );
  const h2h = useMemo(() => headToHead(shared), [shared]);

  const onInfo = useCallback((key) => setInfoKey(key), []);
  const activeExplainer = infoKey ? statExplainers[infoKey] : null;
  const explainer = typeof activeExplainer === 'function' ? activeExplainer() : activeExplainer;

  const Header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => navigation.goBack()} />
      {friend ? <PersonAvatar person={friend} theme={theme} size={40} /> : null}
      <View style={s.headerText}>
        <Text style={s.headerTitle} numberOfLines={1}>{friend?.displayName ?? 'Player'}</Text>
        {friend ? (
          <Text style={s.headerSub} numberOfLines={1}>
            {friend.username ? `@${friend.username}` : ''}
            {summary?.index?.value != null ? ` · HCP ${summary.index.value.toFixed(1)}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!friend) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Text style={s.emptyText}>No player selected.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const TabBar = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.tabScroll}
      contentContainerStyle={s.tabBar}
    >
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <PressableScale
            key={t.key}
            style={[s.tabPill, active && s.tabPillOn]}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.tabText, active && s.tabTextOn]}>{t.label}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );

  // ── Loading ──
  if (data === null && !error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>{`Could not load ${friend.displayName}'s stats.`}</Text>
          <PressableScale
            style={s.retryBtn}
            onPress={() => { setData(null); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </PressableScale>
        </View>
      </ScreenContainer>
    );
  }

  // ── Empty: friend has no rounds at all ──
  if (!data.friendRounds || data.friendRounds.length === 0) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="bar-chart-2" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds yet.</Text>
        </View>
      </ScreenContainer>
    );
  }

  // Summary already prints this line as part of its own footer — showing it
  // again there would be a duplicate.
  const footer = tab !== 'summary' ? (
    <Text style={s.footer}>
      {`Based on ${summary?.roundCount ?? 0} rounds you can see · 9-hole and unfinished rounds don't count toward differentials`}
    </Text>
  ) : null;

  let body = null;
  if (tab === 'summary') {
    body = (
      <SummaryTab
        summary={summary}
        verdict={verdict}
        h2h={h2h}
        name={friend.displayName}
        onInfo={onInfo}
        onGoTogether={() => setTab('together')}
      />
    );
  } else if (tab === 'form') {
    body = <FormTab stats={summary.stats} n={n} onChangeN={setN} onInfo={onInfo} />;
  } else if (tab === 'handicap') {
    body = (
      <HandicapTab
        myRounds={summary.selected}
        profileHandicap={friend.handicap}
        onInfo={onInfo}
        readOnly
      />
    );
  } else if (tab === 'breakdown') {
    body = <BreakdownTab stats={summary.stats} onInfo={onInfo} onSelectCourse={undefined} />;
  } else if (tab === 'together') {
    body = <TogetherTab shared={shared} h2h={h2h} name={friend.displayName} navigation={navigation} />;
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      {TabBar}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {body}
        {footer}
      </ScrollView>
      <StatDetailSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={explainer?.title ?? ''}
        subtitle={explainer?.subtitle ?? ''}
        explainer={explainer?.explainer ?? ''}
        rows={[]}
        shareable={false}
      />
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
      paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    },
    headerText: { flex: 1, minWidth: 0 },
    headerTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary },
    headerSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.muted, marginTop: 1 },
    // The pill row sits above a flex:1 content ScrollView; without
    // flexGrow/flexShrink 0 the web layout squeezes it to the text height.
    tabScroll: { flexGrow: 0, flexShrink: 0 },
    tabBar: {
      flexDirection: 'row', gap: 6,
      paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm,
    },
    tabPill: {
      paddingVertical: 6, paddingHorizontal: 14, borderRadius: theme.radius.pill,
      backgroundColor: theme.bg.secondary,
    },
    tabPillOn: { backgroundColor: theme.accent.primary },
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabTextOn: { color: theme.text.inverse },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
    footer: {
      fontSize: 11, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.md,
    },
  });
}
