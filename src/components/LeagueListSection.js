import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { semantic } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useT, tr } from '../i18n';
import { getTournamentSnapshot } from '../store/tournamentStore';
import { leagueRoundIndex } from '../store/leagueGameCards';

// The hero's button: the next step of my card this month (leagueView.homeAction),
// or the board. Label key and where it goes.
const ACTION_LABEL = {
  play: 'league.home.playWithApp',
  post: 'league.home.addScore',
  scorecard: 'league.list.hero.scorecard',
  proof: 'league.home.addProof',
  validate: 'league.list.hero.finish',
  open: 'league.list.hero.open',
};
function goAction(navigation, row) {
  const a = row.action ?? { kind: 'open' };
  const leagueId = row.id;
  switch (a.kind) {
    case 'play': return navigation.navigate('Setup', { kind: 'game', leagueId });
    case 'post': return navigation.navigate('LeagueAddScore', { leagueId, cardId: a.cardId });
    case 'scorecard': return navigation.navigate('Scorecard', {
      tournamentId: a.tournamentId, roundIndex: leagueRoundIndex(getTournamentSnapshot(a.tournamentId), a.roundId),
    });
    case 'proof': return navigation.navigate('LeagueAddProof', { leagueId, cardId: a.cardId, resume: true });
    case 'validate': return navigation.navigate('LeagueValidate', {
      leagueId, cardId: a.cardId, tournamentId: a.tournamentId, roundId: a.roundId, submitted: true,
    });
    default: return navigation.navigate('LeagueBoard', { leagueId });
  }
}

// LEAGUES section of the Play tab, given the rows from useMyLeagueRows. The
// first league is a card (my place, then what this month still needs, and a
// button for its next step); any further leagues fold into compact rows. Card
// surfaces, not deep green: on Home the deep surface belongs to the round
// that is ready or live, and the next-step button is the league's one green.
// Renders nothing when I'm in no league.
export default function LeagueListSection({ navigation, rows }) {
  const t = useT(); // re-render on a language switch
  const { theme } = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  if (!rows || rows.length === 0) return null;
  const [first, ...rest] = rows;
  const open = (row) => navigation.navigate('LeagueBoard', { leagueId: row.id });
  return (
    <View style={st.section}>
      <LeagueHero row={first} t={t} st={st} theme={theme} onPress={() => open(first)} onAction={() => goAction(navigation, first)} />
      {rest.map((row) => <LeagueRow key={row.id} row={row} t={t} st={st} theme={theme} onPress={() => open(row)} />)}
    </View>
  );
}

// '2.º' / 'T1st' → big '2' / 'T1' and a small suffix, so the ordinal mark
// doesn't grow with the number.
function Place({ value, style, suffixStyle }) {
  const m = /^(T?\d+)(.*)$/.exec(String(value ?? ''));
  if (!m) return <Text style={style}>{value}</Text>;
  return <Text style={style}>{m[1]}<Text style={suffixStyle}>{m[2]}</Text></Text>;
}

const currentMonthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// What this month still needs from me, from the row's month descriptor:
// { title, sub, chip } as finished text.
function monthParts(month) {
  if (!month) return null;
  if (typeof month === 'string') return { title: month }; // cached by an older version
  const p = month.params ?? {};
  const m = (key, extra) => tr({ key, params: { monthKey: p.monthKey, ...extra } });
  switch (month.key) {
    case 'league.play.monthNone':
      return { title: m('league.list.hero.cardDue'), sub: m('league.list.hero.cardDueSub'), chip: tr({ key: 'league.list.hero.daysLeft', params: { count: p.count } }) };
    case 'league.play.monthNoneLast':
      return { title: m('league.list.hero.cardDue'), sub: m('league.list.hero.cardDueSub'), chip: tr({ key: 'league.list.hero.lastDay' }) };
    case 'league.play.monthLive':
      return { title: m('league.list.hero.cardLive') };
    case 'league.play.monthMissed':
      return { title: m('league.list.hero.missed') };
    case 'league.play.monthRank':
      return { title: m('league.list.hero.rank', { points: p.points }), sub: m('league.list.hero.rankSub', { place: p.place }) };
    case 'league.play.monthRankScore':
      return { title: m('league.list.hero.rankScore', { score: p.score }), sub: m('league.list.hero.rankSub', { place: p.place }) };
    default:
      return { title: tr(month) };
  }
}

function LeagueHero({ row, t, st, theme, onPress, onAction }) {
  const kind = ACTION_LABEL[row.action?.kind] ? row.action.kind : 'open';
  const label = t(ACTION_LABEL[kind]);
  const pos = row.position;
  const month = monthParts(row.month);
  const monthKey = row.month?.params?.monthKey ?? currentMonthKey();
  // '1st' / '1.º' / 'T1st': top of the table, shared or not.
  const isLeader = /^T?1\D/.test(String(pos?.params?.place ?? ''));
  const btnInk = theme.isDark ? theme.accent.primary : theme.text.inverse;
  return (
    <TouchableOpacity
      style={st.hero}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={[t('league.list.a11y', { name: row.name }), pos ? tr(pos) : t('league.list.noCards'), month?.title].filter(Boolean).join('. ')}
    >
      <View style={st.overRow}>
        <Text style={st.overline}>{tr({ key: 'league.list.hero.overline', params: { monthKey } })}</Text>
        {month?.chip ? <View style={st.chip}><Text style={st.chipText}>{month.chip}</Text></View> : null}
      </View>
      <Text style={st.heroName} numberOfLines={2}>{row.name}</Text>
      <View style={[st.standRow, !(pos && typeof pos === 'object') && { alignItems: 'center' }]}>
        {pos && typeof pos === 'object' ? (
          <View style={st.stand}>
            <Place value={pos.params.place} style={[st.place, isLeader && st.placeLeader]} suffixStyle={st.placeSuffix} />
            <View style={st.standText}>
              <Text style={st.of}>{t('league.list.hero.of', { total: pos.params.total })}</Text>
              <Text style={st.points}>{t('league.list.hero.points', { points: pos.params.points })}</Text>
            </View>
          </View>
        ) : (
          <Text style={[st.noCards, { flex: 1 }]}>{pos ? tr(pos) : t('league.list.noCards')}</Text>
        )}
        {/* When the button does a card step, the board keeps its own way in,
            above the button, in the space beside my place. */}
        {kind !== 'open' && (
          <TouchableOpacity
            style={st.viewLink}
            onPress={onPress}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8 }}
            accessibilityRole="link"
            accessibilityLabel={t('league.list.hero.view')}
          >
            <Text style={st.viewLinkText}>{t('league.list.hero.view')}</Text>
            <Feather name="chevron-right" size={14} color={theme.accent.primary} />
          </TouchableOpacity>
        )}
      </View>
      <View style={st.divider} />
      <View style={st.monthRow}>
        <View style={st.monthText}>
          {month ? <Text style={st.monthTitle}>{month.title}</Text> : null}
          {month?.sub ? <Text style={st.monthSub}>{month.sub}</Text> : null}
        </View>
        {/* The card itself opens the board; the button does the next step. */}
        <TouchableOpacity
          style={[st.btn, kind === 'open' && st.btnOpen]}
          onPress={onAction}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={{ top: 4, bottom: 4 }}
        >
          {kind === 'play' && <Feather name="play" size={12} color={btnInk} style={{ marginRight: 4 }} />}
          <Text style={[st.btnText, kind === 'open' && st.btnTextOpen]}>{label}</Text>
          {kind === 'open' && <Feather name="chevron-right" size={14} color={theme.text.primary} />}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function LeagueRow({ row, t, st, theme, onPress }) {
  const pos = row.position;
  const place = pos && typeof pos === 'object' ? pos.params.place : '–';
  const line = row.month ? tr(row.month) : (typeof pos === 'string' ? pos : t('league.list.noCards'));
  return (
    <TouchableOpacity
      style={st.row}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={t('league.list.a11y', { name: row.name })}
    >
      <Place value={place} style={st.rowPlace} suffixStyle={st.rowPlaceSuffix} />
      <View style={st.rowBody}>
        <Text style={st.rowName} numberOfLines={1}>{row.name}</Text>
        <Text style={st.rowLine} numberOfLines={1}>{line}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.text.muted} />
    </TouchableOpacity>
  );
}

// Card surface as the Home game cards (homeStyles.tournamentCard); the
// next-step button is the primary button (homeStyles.primaryBtn).
const makeStyles = (t) => {
  const card = {
    backgroundColor: t.bg.card, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
  };
  return StyleSheet.create({
    section: { marginTop: 12 },
    hero: { ...card, borderRadius: 16, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, marginBottom: 10 },
    overRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 },
    overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: t.text.secondary },
    chip: { backgroundColor: t.bg.secondary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: t.text.primary },
    heroName: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 27, color: t.text.primary, marginTop: 4, marginBottom: 10 },
    stand: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    place: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 38, lineHeight: 42, color: t.text.primary, fontVariant: ['tabular-nums'] },
    placeSuffix: { fontSize: 18 },
    // Winner gold that reads on the surface: deep ledger gold on white, soft gold on dark.
    placeLeader: { color: t.isDark ? semantic.winner.soft : semantic.winner.light },
    standText: { paddingBottom: 4 },
    of: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: t.text.secondary },
    points: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: t.text.primary },
    noCards: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 20, color: t.text.secondary },
    divider: { height: 1, backgroundColor: t.border.default, marginTop: 12, marginBottom: 10 },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    monthText: { flex: 1, minWidth: 0 },
    monthTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: t.text.primary },
    monthSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: t.text.secondary, marginTop: 1 },
    btn: {
      flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 12, paddingHorizontal: 12, minHeight: 44,
      backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
      borderWidth: t.isDark ? 1 : 0, borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
    },
    // "Ver liga" is navigation, not a card step: neutral, so green stays for steps.
    btnOpen: { backgroundColor: t.bg.secondary, borderWidth: 0 },
    btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: t.isDark ? t.accent.primary : t.text.inverse, textAlign: 'center' },
    btnTextOpen: { color: t.text.primary },
    standRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
    viewLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28, marginBottom: 2 },
    viewLinkText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: t.accent.primary },
    row: { ...card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
    rowPlace: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: t.text.primary, minWidth: 40, fontVariant: ['tabular-nums'] },
    rowPlaceSuffix: { fontSize: 12 },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.primary },
    rowLine: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: t.text.secondary, marginTop: 1 },
  });
};
