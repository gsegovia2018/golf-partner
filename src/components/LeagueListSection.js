import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { light, onDeep, semantic } from '../theme/tokens';
import { useT, tr } from '../i18n';

// LEAGUES section of the Play tab, given the rows from useMyLeagueRows. The
// first league is a deep-green hero (my place, then what this month still
// needs); any further leagues fold into compact deep rows. Renders nothing
// when I'm in no league.
export default function LeagueListSection({ navigation, rows }) {
  const t = useT(); // re-render on a language switch
  if (!rows || rows.length === 0) return null;
  const [first, ...rest] = rows;
  const open = (row) => navigation.navigate('LeagueBoard', { leagueId: row.id });
  return (
    <View style={st.section}>
      <LeagueHero row={first} t={t} onPress={() => open(first)} />
      {rest.map((row) => <LeagueRow key={row.id} row={row} t={t} onPress={() => open(row)} />)}
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
    default:
      return { title: tr(month) };
  }
}

function LeagueHero({ row, t, onPress }) {
  const pos = row.position;
  const month = monthParts(row.month);
  const monthKey = row.month?.params?.monthKey ?? currentMonthKey();
  // '1st' / '1.º' / 'T1st': top of the table, shared or not.
  const isLeader = /^T?1\D/.test(String(pos?.params?.place ?? ''));
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
      {pos && typeof pos === 'object' ? (
        <View style={st.stand}>
          <Place value={pos.params.place} style={[st.place, isLeader && st.placeLeader]} suffixStyle={st.placeSuffix} />
          <View style={st.standText}>
            <Text style={st.of}>{t('league.list.hero.of', { total: pos.params.total })}</Text>
            <Text style={st.points}>{t('league.list.hero.points', { points: pos.params.points })}</Text>
          </View>
        </View>
      ) : (
        <Text style={st.noCards}>{pos ? tr(pos) : t('league.list.noCards')}</Text>
      )}
      <View style={st.divider} />
      <View style={st.monthRow}>
        <View style={st.monthText}>
          {month ? <Text style={st.monthTitle}>{month.title}</Text> : null}
          {month?.sub ? <Text style={st.monthSub}>{month.sub}</Text> : null}
        </View>
        <View style={st.btn}>
          <Text style={st.btnText}>{t('league.list.hero.open')}</Text>
          <Feather name="chevron-right" size={14} color={DEEP} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function LeagueRow({ row, t, onPress }) {
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
      <Feather name="chevron-right" size={18} color={onDeep.dim} />
    </TouchableOpacity>
  );
}

const DEEP = light.bg.deep;

const st = StyleSheet.create({
  section: { marginTop: 12 },
  hero: { backgroundColor: DEEP, borderRadius: 16, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, marginBottom: 10 },
  overRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 },
  overline: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: onDeep.faint },
  chip: { backgroundColor: onDeep.chip, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: onDeep.primary },
  heroName: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 27, color: onDeep.primary, marginTop: 4, marginBottom: 10 },
  stand: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  place: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 38, lineHeight: 42, color: onDeep.primary, fontVariant: ['tabular-nums'] },
  placeSuffix: { fontSize: 18 },
  placeLeader: { color: semantic.winner.dark },
  standText: { paddingBottom: 4 },
  of: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: onDeep.soft },
  points: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: onDeep.primary },
  noCards: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, lineHeight: 20, color: onDeep.soft },
  divider: { height: 1, backgroundColor: onDeep.border, marginTop: 12, marginBottom: 10 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthText: { flex: 1, minWidth: 0 },
  monthTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: onDeep.primary },
  monthSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: onDeep.soft, marginTop: 1 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: onDeep.primary, borderRadius: 12, paddingHorizontal: 12, minHeight: 40 },
  btnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: DEEP },
  row: { backgroundColor: DEEP, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  rowPlace: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: onDeep.primary, minWidth: 40, fontVariant: ['tabular-nums'] },
  rowPlaceSuffix: { fontSize: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: onDeep.primary },
  rowLine: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: onDeep.soft, marginTop: 1 },
});
