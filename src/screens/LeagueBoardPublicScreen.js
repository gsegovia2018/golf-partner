// The public, read-only league board (/league-board/<token>, D4 B). Anyone
// with the link, signed out included: league name, the month so far / the
// season / last month, first name + initial, course, Stableford points and
// league points. No handicaps, ids or photos (the RPC never sends them:
// supabase/migrations/20261017000000_league_public_board.sql).
//
// Rendered like SharedBoardScreen: bare and pre-session from App.js's
// `!session` branch with a `token` prop, or as the routed `LeagueBoardPublic`
// screen (route.params.token) for a signed-in visitor. It never touches a
// navigation hook.
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity, Linking, AppState,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import LeaderboardCard from '../components/LeaderboardCard';
import { useT, formatNumber, formatDate, getLanguage } from '../i18n';
import { getPublicLeagueBoard } from '../store/publicLeagueBoardStore';
import { publicBoardSnapshot, publicBoardView, publicBoardScopes } from '../store/leagueShare';
import { currentMonthKey, leaguePointsText } from '../store/leagueView';

const POLL_MS = 60000;
const SITE = 'golf-partner.vercel.app';
// Cream on the deep-green hero (same family as SharedBoardScreen's hero).
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const GOLD = semantic.winner.dark;

const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const monthWord = (key) => cap(formatDate(`${key}-01`, 'monthName'));

export default function LeagueBoardPublicScreen(props) {
  const token = props.token ?? props.route?.params?.token;
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const t = useT();
  const [payload, setPayload] = useState(undefined); // undefined = not loaded, null = link off
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    if (!token) { setPayload(null); return; }
    if (isRefresh) setRefreshing(true);
    try {
      const data = await getPublicLeagueBoard(token);
      if (!mounted.current) return;
      setPayload(data ?? null);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    mounted.current = true;
    load();
    const appState = { current: AppState.currentState };
    const sub = AppState.addEventListener('change', (next) => { appState.current = next; });
    const id = setInterval(() => { if (appState.current === 'active') load(); }, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); sub.remove(); };
  }, [load]);

  const now = new Date();
  const snapshot = useMemo(() => publicBoardSnapshot(payload), [payload]);
  const scopes = snapshot ? publicBoardScopes(snapshot, now) : [];
  const active = scope && scopes.includes(scope) ? scope : scopes[0];
  const curKey = currentMonthKey(now);

  const footer = (
    <View style={s.footer}>
      <TouchableOpacity onPress={() => Linking.openURL(`https://${SITE}`).catch(() => {})} activeOpacity={0.7}>
        <Text style={s.footerText}>
          {`${t('league.public.footerScored')} · `}
          <Text style={s.footerLink}>{SITE}</Text>
        </Text>
      </TouchableOpacity>
      <Text style={s.footerNote}>{t('league.public.footerNote')}</Text>
    </View>
  );

  if (payload === undefined && !error) {
    return (
      <View style={s.screen}>
        <View style={s.centered}><ActivityIndicator size="large" color={theme.accent.primary} /></View>
      </View>
    );
  }

  const state = (icon, title, text, retry) => (
    <View style={s.centeredCard}>
      <View style={s.icon}><Feather name={icon} size={28} color={theme.text.muted} /></View>
      <Text style={s.stateTitle} accessibilityRole="header">{title}</Text>
      <Text style={s.stateText}>{text}</Text>
      {retry && (
        <TouchableOpacity style={s.retry} onPress={() => load()} accessibilityRole="button">
          <Text style={s.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  let body;
  if (!snapshot && error) {
    body = state('wifi-off', t('league.public.errorTitle'), t('league.public.errorText'), true);
  } else if (!snapshot) {
    body = state('link', t('league.public.offTitle'), t('league.public.offText'), false);
  } else {
    const view = publicBoardView(snapshot, active, now, getLanguage());
    const season = active === 'season';
    const leader = view.rows[0];
    let heroLine;
    if (season) {
      heroLine = view.last ? t('league.public.seasonAfter', { month: formatDate(`${view.last}-01`, 'monthName') })
        : t('league.public.season');
    } else if (active === curKey) {
      const params = { month: monthWord(active), count: view.daysLeft, in: view.ranked, total: view.total };
      heroLine = view.daysLeft === 0 ? t('league.public.lastDay', params) : t('league.public.soFar', params);
    } else {
      heroLine = t('league.public.monthDone', { month: monthWord(active), in: view.ranked, total: view.total });
    }
    const leaderLine = leader && (season
      ? (leader.league > 0 ? t('league.public.seasonLeader', { name: leader.name, points: leaguePointsText(leader.league) }) : null)
      : t('league.public.leader', { name: leader.name, points: formatNumber(leader.points) }));
    const place = (r) => `${r.isTie ? 'T' : ''}${r.place}`;

    const chips = scopes.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow} contentContainerStyle={{ gap: 6 }}>
        {scopes.map((key) => {
          const on = key === active;
          return (
            <TouchableOpacity
              key={key}
              style={[s.chip, on && s.chipOn]}
              onPress={() => setScope(key)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              {key === curKey && <View style={[s.chipDot, on && s.chipDotOn]} />}
              <Text style={[s.chipText, on && s.chipTextOn]}>{key === 'season' ? t('league.share.chipSeason') : monthWord(key)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    ) : null;

    const empty = view.rows.length === 0 || (season && !view.last);
    const sections = empty ? [{
      key: 'empty',
      label: season ? t('league.public.season') : monthWord(active),
      icon: 'calendar',
      body: (
        <Text style={s.emptyText}>
          {season ? t('league.public.emptySeason') : t('league.public.emptyMonth', { month: formatDate(`${active}-01`, 'monthName') })}
        </Text>
      ),
    }] : [{
      key: 'rows',
      label: t('league.public.colPlayer'),
      icon: season ? 'award' : 'check',
      gold: true,
      cols: season ? [t('league.board.colTotal'), t('league.board.colLast')] : [t('league.board.colPts'), t('league.board.colLeague')],
      rows: view.rows.map((r) => (season ? {
        key: r.key,
        place: r.place,
        isTie: r.isTie,
        name: r.name,
        points: leaguePointsText(r.league),
        pointsLabel: t('league.public.seasonRow', { place: place(r), name: r.name, league: leaguePointsText(r.league) }),
        // What the last scored month added ("LAST" column, like the board).
        sub: r.lastMonth > 0 ? `+${leaguePointsText(r.lastMonth)}` : '—',
      } : {
        key: r.key,
        place: r.place,
        isTie: r.isTie,
        name: r.name,
        detail: r.course ?? undefined,
        white: true,
        points: formatNumber(r.points),
        pointsLabel: t('league.public.row', {
          place: place(r), name: r.name, points: formatNumber(r.points), league: leaguePointsText(r.league),
        }),
        sub: `+${leaguePointsText(r.league)}`,
        subGold: true,
      })),
    }];

    body = (
      <>
        <View style={s.hero} testID="league-public-hero">
          <Text style={s.heroTitle} numberOfLines={2} accessibilityRole="header">{snapshot.league.name}</Text>
          <Text style={s.heroMeta}>{heroLine}</Text>
          {!!leaderLine && !empty && (
            <View style={s.heroLeaderRow}>
              <Feather name="award" size={15} color={GOLD} />
              <Text style={s.heroLeaderText} numberOfLines={1}>{leaderLine}</Text>
            </View>
          )}
        </View>
        <LeaderboardCard
          title={season ? t('league.public.season').toUpperCase() : monthWord(active).toUpperCase()}
          subheader={chips}
          sections={sections}
        />
      </>
    );
  }

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ isRefresh: true })} tintColor={theme.accent.primary} />}
      >
        {body}
        {footer}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: {
    padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  centeredCard: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  icon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  stateTitle: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary, marginBottom: 6, textAlign: 'center',
  },
  stateText: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.secondary, textAlign: 'center', maxWidth: 320, lineHeight: 20,
  },
  retry: {
    marginTop: 18, minHeight: 44, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  retryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.accent.primary },

  hero: {
    backgroundColor: theme.bg.deep, borderRadius: 20, padding: 18, marginBottom: 14,
    ...(theme.isDark ? {} : { shadowColor: '#004030', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 6 }),
  },
  heroTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: CREAM, marginBottom: 4 },
  heroMeta: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, lineHeight: 19, color: CREAM_70 },
  heroLeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(243,239,230,0.14)',
  },
  heroLeaderText: { flex: 1, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: CREAM },

  chipRow: { flexGrow: 0, marginBottom: 12 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', minHeight: 32,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  chipDotOn: { backgroundColor: theme.bg.deep },
  chipOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  chipTextOn: { color: theme.bg.deep },
  emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 20, paddingVertical: 6 },

  footer: { alignItems: 'center', paddingTop: 16, gap: 4 },
  footerText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted, textAlign: 'center' },
  footerLink: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.accent.primary },
  footerNote: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted, textAlign: 'center' },
});
