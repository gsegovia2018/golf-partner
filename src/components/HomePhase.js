import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { onDeep } from '../theme/tokens';
import { useT, formatOrdinal, formatTime, formatNumber } from '../i18n';
import { verdictKey } from './mystats/reportKeys';
import { fmtDelta } from './mystats/reportCardView';
import ShotScorecard from './scorecard/ShotScorecard';
import { PAIR_COLORS, SoloTotals, useLiveStyles } from './HomeLiveScorecard';
import { shortName } from './gamestats/ui';

// The Play tab's phase heroes (store/homePhase.js picks the phase), all on
// the deep-green play surface: Before and After, plus the one-line After and
// the "Your game" pair. Live is HomeLiveScorecard.
const CREAM = '#f3efe6';
const INK = '#0c1a14';

function Cta({ icon, label, onPress, a11y, s, half }) {
  return (
    <TouchableOpacity style={[s.cta, half && s.half]} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} activeOpacity={0.85}>
      {icon ? <Feather name={icon} size={16} color="#00553c" /> : null}
      <Text style={s.ctaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function useStyles() {
  const { theme } = useTheme();
  return { theme, s: useMemo(() => makeStyles(theme), [theme]) };
}

// "You & Javier": me first, short names for the rest.
function pairNameOf(tournament, t) {
  const players = tournament?.players ?? [];
  const byId = new Map(players.map((p) => [p.id, p]));
  return (ids, meId) => {
    const order = [...ids].sort((a, b) => (b === meId) - (a === meId));
    return order.map((id) => (id === meId ? t('home.phase.you') : shortName(byId.get(id) ?? { name: '?' }, players))).join(' & ');
  };
}

export function BeforeHero({ model, modeLabel, onStart, onEditTeams }) {
  const { s } = useStyles();
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
      <Text style={s.personStrokes}>{p.strokes < 0 ? `−${-p.strokes}` : t('home.phase.before.shots', { count: p.strokes })}</Text>
    </View>
  );
  const hint = model.shotHoles?.length === 1
    ? t('home.phase.before.shotOn', { hole: formatOrdinal(model.shotHoles[0].number), si: model.shotHoles[0].strokeIndex })
    : model.shotHoles?.length === 2
      ? t('home.phase.before.shotsOn', { a: formatOrdinal(model.shotHoles[0].number), b: formatOrdinal(model.shotHoles[1].number) })
      : null;
  return (
    <View style={s.deep} testID="home-phase-before">
      <View style={s.head}>
        <View style={[s.headDot, { backgroundColor: PAIR_COLORS[0] }]} />
        <Text style={s.overline} numberOfLines={1}>{overline}{model.kind === 'game' ? '' : ` · ${model.name}`}</Text>
      </View>
      <Text style={s.course} numberOfLines={2}>{model.courseName || model.name}</Text>
      {meta ? <Text style={s.meta} numberOfLines={1}>{meta}</Text> : null}
      {model.teams ? (
        <View style={s.teams}>
          {model.teams.map((team) => (
            <View key={team.side} style={s.team} testID={`home-before-pair-${team.side}`}>
              <View style={s.teamHead}>
                <View style={[s.teamDot, { backgroundColor: PAIR_COLORS[team.side] }]} />
                <Text style={s.teamLabel}>{t(team.side ? 'home.phase.before.pairB' : 'home.phase.before.pairA')}</Text>
              </View>
              {team.members.map(person)}
            </View>
          ))}
        </View>
      ) : (
        <View style={s.solo}>
          {model.players.map(person)}
          {hint ? <Text style={s.hint} testID="home-before-shot-hint">{hint}</Text> : null}
        </View>
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

function whenLabel(t, ms) {
  const d = new Date(ms);
  const today = new Date();
  const time = formatTime(d);
  return d.toDateString() === today.toDateString()
    ? t('home.phase.after.today', { time })
    : t('home.phase.after.yesterday', { time });
}

// Who took the best-ball and the worst-ball point on each hole: A / B / ½.
function BallStrip({ balls, s, t }) {
  const nines = balls.length > 9 ? [balls.slice(0, 9), balls.slice(9)] : [balls];
  const cell = (winner, key) => {
    if (winner == null) return <View key={key} style={[s.ball, s.ballEmpty]} />;
    if (winner === 'halved') return <View key={key} style={[s.ball, s.ballHalved]}><Text style={s.ballHalvedText}>½</Text></View>;
    return (
      <View key={key} style={[s.ball, { backgroundColor: PAIR_COLORS[winner] }]}>
        <Text style={s.ballText}>{winner ? 'B' : 'A'}</Text>
      </View>
    );
  };
  return (
    <View style={s.strip} testID="home-after-balls">
      {nines.map((nine, i) => (
        <View key={i} style={s.stripNine}>
          <View style={s.stripRow}>
            <Text style={s.stripLabel}>{t(nines.length > 1 ? (i ? 'stats.game.ledger.in' : 'stats.game.ledger.out') : 'stats.game.ledger.hole')}</Text>
            {nine.map((b) => <Text key={b.number} style={s.stripNum}>{b.number}</Text>)}
          </View>
          <View style={s.stripRow}>
            <Text style={s.stripLabel}>{t('home.phase.after.best')}</Text>
            {nine.map((b) => cell(b.best, b.number))}
          </View>
          <View style={s.stripRow}>
            <Text style={s.stripLabel}>{t('home.phase.after.worst')}</Text>
            {nine.map((b) => cell(b.worst, b.number))}
          </View>
        </View>
      ))}
    </View>
  );
}

function PairResult({ model, tournament, meId, s, t }) {
  const { pairs } = model;
  const nameOf = pairNameOf(tournament, t);
  const title = pairs.leader == null
    ? t('home.phase.after.pairLevel')
    : t('home.phase.after.pairWon', { name: nameOf(pairs.sides.find((sd) => sd.side === pairs.leader).ids, meId) });
  const [left, right] = pairs.sides;
  const side = (sd, alignEnd) => (
    <View style={[s.side, alignEnd && s.sideEnd]}>
      <View style={[s.sideHead, alignEnd && s.sideHeadEnd]}>
        {!alignEnd && <View style={[s.teamDot, { backgroundColor: PAIR_COLORS[sd.side] }]} />}
        <Text style={s.sideName} numberOfLines={1}>{nameOf(sd.ids, meId)}</Text>
        {alignEnd && <View style={[s.teamDot, { backgroundColor: PAIR_COLORS[sd.side] }]} />}
      </View>
      <Text style={s.bigNum}>{formatNumber(sd.points)}</Text>
    </View>
  );
  return (
    <>
      <Text style={s.afterTitle} testID="home-after-title">{title}</Text>
      <View style={s.scoreline}>
        {side(left, false)}
        <Text style={s.dash}>–</Text>
        {side(right, true)}
      </View>
      {pairs.balls ? (
        <>
          <BallStrip balls={pairs.balls} s={s} t={t} />
          <View style={s.legend}>
            {pairs.sides.map((sd) => (
              <View key={sd.side} style={s.legendKey}>
                <View style={[s.legendSwatch, { backgroundColor: PAIR_COLORS[sd.side] }]} />
                <Text style={s.legendText}>{`${sd.side ? 'B' : 'A'} · ${nameOf(sd.ids, meId)}`}</Text>
              </View>
            ))}
            <View style={s.legendKey}>
              <View style={[s.legendSwatch, { backgroundColor: onDeep.chip }]} />
              <Text style={s.legendText}>{t('home.phase.after.halved')}</Text>
            </View>
          </View>
        </>
      ) : null}
    </>
  );
}

function IndividualResult({ model, s, t, theme }) {
  const gold = theme.semantic.winner.soft;
  const title = model.tied
    ? t('home.phase.after.tied', {
      names: model.tied.players.map((p) => (p.me ? t('home.phase.you') : p.name)).join(' & '),
      points: formatNumber(model.tied.points),
    })
    : model.winner
      ? t('home.phase.after.winner', { name: model.winner.name, points: formatNumber(model.winner.points) })
      : t('home.phase.after.youWon');
  return (
    <>
      {model.count > 1 ? <Text style={s.afterTitle} testID="home-after-title">{title}</Text> : null}
      <View style={s.afterTop}>
        {model.myPoints != null ? (
          <Text style={s.bigNum}>
            {formatNumber(model.myPoints)}
            <Text style={s.unit}> {t(model.unit === 'holes' ? 'home.phase.after.holesUnit' : 'home.live.pts')}</Text>
          </Text>
        ) : null}
        {model.place != null && model.count > 1 ? (
          <View style={[s.rank, { backgroundColor: onDeep.goldFill }]}>
            <Feather name="award" size={12} color={gold} />
            <Text style={[s.rankText, { color: gold }]}>{t('home.phase.after.place', { place: formatOrdinal(model.place), count: model.count })}</Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

function SoloResult({ model, s, t }) {
  const { s: ls } = useLiveStyles();
  const total = model.card?.rows[0]?.total;
  const shots = model.shots;
  const line = shots ? [
    shots.fairways.of > 0 ? t('home.phase.after.fairways', { hit: shots.fairways.hit, of: shots.fairways.of }) : null,
    shots.greens.of > 0 ? t('home.phase.after.greens', { count: shots.greens.hit }) : null,
    shots.penalties > 0 ? t('home.phase.after.penalties', { count: shots.penalties }) : null,
  ].filter(Boolean).join(' · ') : '';
  return (
    <>
      {total ? <SoloTotals total={total} s={ls} t={t} /> : null}
      <ShotScorecard card={model.card} mode="strokes" tone="deep" summary={false} pointsRow />
      {line ? <Text style={s.cardLine} testID="home-after-shots">{line}</Text> : null}
    </>
  );
}

export function AfterHero({ model, tournament, meId, report, photos, onOpen, onAddPhotos }) {
  const { theme, s } = useStyles();
  const t = useT();
  const shown = photos.slice(0, 4);
  const verdict = report
    ? [verdictKey(report.verdict) ? t(verdictKey(report.verdict)) : report.verdict,
      report.vsAvg != null ? t('stats.my.report.vsAvgChip', { delta: fmtDelta(report.vsAvg) }) : null].filter(Boolean).join(' · ')
    : null;
  return (
    <View style={s.deep} testID="home-phase-after">
      <View style={s.head}>
        <View style={[s.headDot, { backgroundColor: onDeep.faint }]} />
        <Text style={s.overline} numberOfLines={1}>{whenLabel(t, model.endedAt)} · {model.courseName || model.name}</Text>
      </View>
      {model.card
        ? <SoloResult model={model} s={s} t={t} />
        : model.pairs
          ? <PairResult model={model} tournament={tournament} meId={meId} s={s} t={t} />
          : <IndividualResult model={model} s={s} t={t} theme={theme} />}
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
        <Cta s={s} half label={t('home.phase.after.summary')} onPress={onOpen} />
        <TouchableOpacity style={s.ghost} onPress={onAddPhotos} accessibilityRole="button" activeOpacity={0.85}>
          <Feather name="camera" size={14} color={onDeep.strong} />
          <Text style={s.ghostText}>{t('home.phase.after.addPhotos')}</Text>
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
  deep: {
    backgroundColor: theme.bg.deep, borderRadius: 14, paddingTop: 15, paddingBottom: 14, paddingHorizontal: 14,
    marginBottom: 16, gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headDot: { width: 7, height: 7, borderRadius: 4 },
  overline: { flex: 1, minWidth: 0, color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
  course: { color: CREAM, fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28 },
  meta: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  teams: { flexDirection: 'row', gap: 8, marginTop: 6 },
  team: { flex: 1, backgroundColor: onDeep.fill, borderRadius: 10, padding: 10, gap: 4, minWidth: 0 },
  // No flex here: in a column, flex collapses the box to nothing on web.
  solo: { backgroundColor: onDeep.fill, borderRadius: 10, padding: 10, gap: 4, marginTop: 6 },
  hint: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  teamLabel: { color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  person: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  personName: { color: CREAM, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, flexShrink: 1 },
  personStrokes: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, fontVariant: ['tabular-nums'] },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: 8,
    backgroundColor: CREAM, borderRadius: 12, paddingHorizontal: 14,
  },
  half: { flex: 1, marginTop: 0 },
  ctaText: { color: '#00553c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  link: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  linkText: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  afterTitle: { color: CREAM, fontFamily: 'PlayfairDisplay-Bold', fontSize: 24, lineHeight: 30 },
  afterTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  bigNum: { color: CREAM, fontFamily: 'PlayfairDisplay-Black', fontSize: 44, lineHeight: 50, fontVariant: ['tabular-nums'] },
  unit: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  scoreline: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  side: { flex: 1, minWidth: 0 },
  sideEnd: { alignItems: 'flex-end' },
  sideHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sideHeadEnd: { justifyContent: 'flex-end' },
  sideName: { flexShrink: 1, color: onDeep.strong, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  dash: { color: onDeep.faint, fontSize: 26, paddingBottom: 8 },
  strip: { gap: 8, marginTop: 4 },
  stripNine: { gap: 3 },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stripLabel: { width: 42, color: onDeep.faint, fontFamily: 'PlusJakartaSans-Bold', fontSize: 10 },
  stripNum: { flex: 1, textAlign: 'center', color: onDeep.faint, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, fontVariant: ['tabular-nums'] },
  ball: { flex: 1, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  ballEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: onDeep.borderStrong },
  ballHalved: { backgroundColor: onDeep.chip },
  ballText: { color: INK, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10 },
  ballHalvedText: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  legendKey: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  rankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  verdict: { color: CREAM, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  cardLine: { color: onDeep.soft, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  photos: { flexDirection: 'row', gap: 6, marginTop: 4 },
  photo: { flex: 1, aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: onDeep.fill },
  photoMore: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14 },
  btns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ghost: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: onDeep.borderStrong,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
    padding: 16, gap: 6,
  },
  cardMeta: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12 },
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
  gameSection: { marginTop: 16 },
  gameRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  gameTile: { flex: 1, padding: 12 },
  gameIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.light },
  gameTitle: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
});
