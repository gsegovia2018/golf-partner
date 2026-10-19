import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { onDeep } from '../theme/tokens';
import { useT, formatOrdinal, formatTime } from '../i18n';
import { verdictKey } from './mystats/reportKeys';
import { fmtDelta } from './mystats/reportCardView';

// The Play tab's phase heroes (store/homePhase.js picks the phase): Before,
// Live and After on the deep-green play surface, plus the one-line After,
// the compact create row and the idle "Your game" pair.
const CREAM = '#f3efe6';

function Cta({ icon, label, onPress, a11y, s }) {
  return (
    <TouchableOpacity style={s.cta} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} activeOpacity={0.85}>
      <Feather name={icon} size={16} color="#00553c" />
      <Text style={s.ctaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function useStyles() {
  const { theme } = useTheme();
  return { theme, s: useMemo(() => makeStyles(theme), [theme]) };
}

export function BeforeHero({ model, modeLabel, onStart, onEditTeams }) {
  const { theme, s } = useStyles();
  const t = useT();
  const overline = model.kind === 'game'
    ? t('home.phase.before.overlineGame')
    : t('home.phase.before.overline', { n: model.roundNumber, total: model.roundCount });
  const meta = [model.tee, modeLabel].filter(Boolean).join(' · ');
  const person = (p) => (
    <View
      key={p.id}
      style={s.person}
      accessible
      accessibilityLabel={`${p.me ? t('home.phase.you') : p.name}, ${t('home.phase.before.strokesA11y', { count: p.strokes })}`}
    >
      <Text style={[s.personName, p.me && s.bold]} numberOfLines={1}>{p.me ? t('home.phase.you') : p.name}</Text>
      {/* A plus handicap gives strokes back: show its own sign. */}
      <Text style={s.personStrokes}>{p.strokes < 0 ? `−${-p.strokes}` : t('home.phase.before.strokes', { count: p.strokes })}</Text>
    </View>
  );
  return (
    <View style={s.deep} testID="home-phase-before">
      <Text style={s.overline} numberOfLines={1}>{overline}{model.kind === 'game' ? '' : ` · ${model.name}`}</Text>
      <Text style={s.course} numberOfLines={2}>{model.courseName || model.name}</Text>
      {meta ? <Text style={s.meta} numberOfLines={1}>{meta}</Text> : null}
      {model.teams ? (
        <View style={s.teams}>
          {model.teams.map((team, i) => (
            <View key={i} style={s.team}>
              <View style={s.teamHead}>
                <View style={[s.teamDot, { backgroundColor: i ? onDeep.bronze : theme.semantic.pair.a.dark }]} />
                <Text style={s.teamLabel}>{t(i ? 'home.phase.before.pairB' : 'home.phase.before.pairA')}</Text>
              </View>
              {team.map(person)}
            </View>
          ))}
        </View>
      ) : (
        <View style={[s.team, s.teamsSolo]}>{model.players.map(person)}</View>
      )}
      <Cta
        s={s}
        icon="flag"
        label={t('home.phase.before.start')}
        a11y={t('home.phase.before.startA11y', { n: model.roundNumber, course: model.courseName })}
        onPress={onStart}
      />
      {model.teams && onEditTeams ? (
        <TouchableOpacity onPress={onEditTeams} accessibilityRole="button" style={s.link}>
          <Text style={s.linkText}>{t('home.phase.before.editTeams')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function LiveHero({ model, onOpen }) {
  const { s } = useStyles();
  const t = useT();
  const sub = model.unit === 'holes'
    ? t('home.phase.live.holesWon', { count: model.thru })
    : t('home.phase.live.pointsAfter', { count: model.thru });
  return (
    <View style={s.deep} testID="home-phase-live">
      <View style={s.row}>
        <View style={s.liveMark}><View style={s.liveDot} /><Text style={s.liveText}>{t('shared.live').toUpperCase()}</Text></View>
        <Text style={[s.overline, s.flex]} numberOfLines={1}>{t('shared.round.numbered', { n: model.roundNumber })} · {model.courseName || model.name}</Text>
      </View>
      <View style={s.liveTop}>
        <View>
          <Text style={s.big}>{model.myPoints ?? '–'}</Text>
          <Text style={s.bigSub}>{sub}</Text>
        </View>
        {model.next ? (
          <View style={s.next}>
            <Text style={s.nextLabel}>{t('home.phase.live.next')}</Text>
            <Text style={s.nextNum}>{model.next.number}</Text>
            {model.next.par != null ? (
              <Text style={s.nextMeta}>{t('map.parSi', { par: model.next.par, si: model.next.strokeIndex ?? '–' })}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {model.board.length > 1 ? (
        <View style={s.board} accessibilityRole="list">
          {model.board.map((b) => (
            <View key={b.id} style={s.boardRow}>
              <Text style={[s.boardName, b.me && s.bold]} numberOfLines={1}>{b.me ? t('home.phase.you') : b.name}</Text>
              <Text style={[s.boardPts, b.me && s.bold]}>{b.points}</Text>
              <Text style={s.boardThru}>{t('home.phase.live.thru', { count: b.thru })}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Cta s={s} icon="clipboard" label={t('home.phase.live.open')} onPress={onOpen} />
    </View>
  );
}

function whenLabel(t, ms) {
  const d = new Date(ms);
  const today = new Date();
  const time = formatTime(d);
  return d.toDateString() === today.toDateString()
    ? t('home.phase.after.today', { time })
    : t('home.phase.after.yesterday', { time });
}

export function AfterHero({ model, report, photos, onOpen, onAddPhotos }) {
  const { theme, s } = useStyles();
  const t = useT();
  const gold = theme.isDark ? theme.semantic.winner.soft : theme.semantic.winner.light;
  const shown = photos.slice(0, 4);
  const verdict = report
    ? [verdictKey(report.verdict) ? t(verdictKey(report.verdict)) : report.verdict,
      report.vsAvg != null ? t('stats.my.report.vsAvgChip', { delta: fmtDelta(report.vsAvg) }) : null].filter(Boolean).join(' · ')
    : null;
  return (
    <View style={s.card} testID="home-phase-after">
      <Text style={s.cardOverline} numberOfLines={1}>{whenLabel(t, model.endedAt)} · {model.courseName || model.name}</Text>
      <View style={s.afterTop}>
        {model.myPoints != null ? (
          <Text style={s.afterPts}>{t(model.unit === 'holes' ? 'home.phase.after.holes' : 'home.phase.after.points', { count: model.myPoints })}</Text>
        ) : null}
        {model.place != null && model.count > 1 ? (
          <View style={[s.rank, { backgroundColor: theme.semantic.rank.gold + '26' }]}>
            <Feather name="award" size={12} color={gold} />
            <Text style={[s.rankText, { color: gold }]}>{t('home.phase.after.place', { place: formatOrdinal(model.place), count: model.count })}</Text>
          </View>
        ) : null}
      </View>
      {model.count > 1 ? (
        <Text style={s.cardMeta}>{model.winner ? t('home.phase.after.winner', { name: model.winner.name, points: model.winner.points }) : t('home.phase.after.youWon')}</Text>
      ) : null}
      {verdict ? <Text style={s.verdict}>{verdict}</Text> : null}
      {shown.length > 0 ? (
        <View style={s.photos}>
          {shown.map((m, i) => (
            <View key={m.id} style={s.photo}>
              {m.thumbUrl ? <Image source={{ uri: m.thumbUrl }} style={StyleSheet.absoluteFillObject} accessibilityIgnoresInvertColors /> : null}
              {i === 3 && photos.length > 4 ? (
                <View style={s.photoMore}><Text style={s.photoMoreText}>+{photos.length - 3}</Text></View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={s.btns}>
        <TouchableOpacity style={s.btnPrimary} onPress={onOpen} accessibilityRole="button" activeOpacity={0.85}>
          <Text style={s.btnPrimaryText}>{t('home.phase.after.summary')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnSecondary} onPress={onAddPhotos} accessibilityRole="button" activeOpacity={0.85}>
          <Feather name="camera" size={14} color={theme.text.secondary} />
          <Text style={s.btnSecondaryText}>{t('home.phase.after.addPhotos')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// After, shrunk to one row when a Before hero leads.
export function AfterLine({ model, onOpen }) {
  const { theme, s } = useStyles();
  const t = useT();
  const pts = model.myPoints != null
    ? t(model.unit === 'holes' ? 'home.phase.after.holes' : 'home.phase.after.points', { count: model.myPoints })
    : null;
  return (
    <TouchableOpacity style={s.lineRow} onPress={onOpen} accessibilityRole="button" activeOpacity={0.8} testID="home-phase-after-line">
      <Feather name="award" size={16} color={theme.accent.primary} />
      <View style={s.flex}>
        <Text style={s.lineTitle} numberOfLines={1}>{[pts, model.courseName].filter(Boolean).join(' · ')}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{whenLabel(t, model.endedAt)}</Text>
      </View>
      <Text style={s.lineCta}>{t('home.phase.after.summary')}</Text>
      <Feather name="chevron-right" size={16} color={theme.text.muted} />
    </TouchableOpacity>
  );
}

export function CreatePills({ onGame, onTournament, onJoin }) {
  const { theme, s } = useStyles();
  const t = useT();
  const pill = (icon, label, onPress) => (
    <TouchableOpacity key={label} style={s.pill} onPress={onPress} accessibilityRole="button" activeOpacity={0.8}>
      <Feather name={icon} size={14} color={theme.accent.primary} />
      <Text style={s.pillText}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View>
      <Text style={s.sectionLabel}>{t('home.phase.newHeading')}</Text>
      <View style={s.pills}>
        {pill('plus', t('home.list.gameTile'), onGame)}
        {pill('award', t('home.list.tournamentTile'), onTournament)}
        {pill('link', t('home.phase.join'), onJoin)}
      </View>
    </View>
  );
}

export function YourGame({ swingLine, onSwing, onCoach }) {
  const { theme, s } = useStyles();
  const t = useT();
  const tile = (icon, title, sub, onPress, testID) => (
    <TouchableOpacity style={[s.card, s.gameTile]} onPress={onPress} accessibilityRole="button" activeOpacity={0.85} testID={testID}>
      <View style={s.gameIcon}><Feather name={icon} size={14} color={theme.accent.primary} /></View>
      <Text style={s.gameTitle}>{title}</Text>
      <Text style={s.cardMeta} numberOfLines={2}>{sub}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={s.gameSection}>
      <Text style={s.sectionLabel}>{t('home.phase.yourGame')}</Text>
      <View style={s.gameRow}>
        {tile('video', t('home.phase.swing'), swingLine || t('home.phase.swingEmpty'), onSwing, 'home-your-game-swing')}
        {tile('target', t('home.phase.coach'), t('home.phase.coachSub'), onCoach, 'home-your-game-coach')}
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontFamily: 'PlusJakartaSans-ExtraBold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deep: {
    backgroundColor: theme.bg.deep, borderRadius: 14, paddingTop: 15, paddingBottom: 12, paddingHorizontal: 16,
    marginBottom: 16, gap: 4,
  },
  overline: { color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  course: { color: CREAM, fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28 },
  meta: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  teams: { flexDirection: 'row', gap: 8, marginTop: 8 },
  team: { flex: 1, backgroundColor: onDeep.fill, borderRadius: 10, padding: 10, gap: 4, minWidth: 0 },
  teamsSolo: { flex: 0, marginTop: 8 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamDot: { width: 7, height: 7, borderRadius: 4 },
  teamLabel: { color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  person: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  personName: { color: CREAM, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, flexShrink: 1 },
  personStrokes: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, fontVariant: ['tabular-nums'] },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, marginTop: 12,
    backgroundColor: CREAM, borderRadius: 12, paddingHorizontal: 14,
  },
  ctaText: { color: '#00553c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  link: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  linkText: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff6b5e' },
  liveText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  liveTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginTop: 6 },
  big: { color: CREAM, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 40, lineHeight: 44, fontVariant: ['tabular-nums'] },
  bigSub: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  next: { backgroundColor: onDeep.chip, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  nextLabel: { color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  nextNum: { color: CREAM, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22, lineHeight: 26 },
  nextMeta: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  board: { marginTop: 10, borderTopWidth: 1, borderTopColor: onDeep.border },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: onDeep.border },
  boardName: { flex: 1, color: CREAM, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  boardPts: { color: CREAM, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 24, textAlign: 'right' },
  boardThru: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, minWidth: 64, textAlign: 'right' },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
    padding: 16, gap: 6,
  },
  cardOverline: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  cardMeta: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12 },
  afterTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  afterPts: { color: theme.text.primary, fontFamily: 'PlayfairDisplay-Black', fontSize: 30, lineHeight: 38 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  rankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  verdict: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  photos: { flexDirection: 'row', gap: 6, marginTop: 4 },
  photo: { flex: 1, aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg.secondary },
  photoMore: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnPrimary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: theme.accent.primary, alignItems: 'center', justifyContent: 'center' },
  btnPrimaryText: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  btnSecondary: {
    flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  btnSecondaryText: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, marginBottom: 12,
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default, paddingHorizontal: 14, paddingVertical: 10,
  },
  lineTitle: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  lineCta: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1.4,
    marginBottom: 10, marginTop: 6, textTransform: 'uppercase',
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default,
  },
  pillText: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  gameSection: { marginTop: 16 },
  gameRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  gameTile: { flex: 1, padding: 12 },
  gameIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.light },
  gameTitle: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
});
