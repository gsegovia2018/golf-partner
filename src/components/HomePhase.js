import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { onDeep } from '../theme/tokens';
import { useT, formatOrdinal } from '../i18n';
import { PAIR_COLORS } from './HomeLiveScorecard';

// The Play tab's phase heroes (store/homePhase.js picks the phase), all on
// the deep-green play surface: Before and the "Your game" pair. Live is
// HomeLiveScorecard.
const CREAM = '#f3efe6';

function Cta({ icon, label, onPress, a11y, s }) {
  return (
    <TouchableOpacity style={s.cta} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} activeOpacity={0.85}>
      {icon ? <Feather name={icon} size={16} color="#00553c" /> : null}
      <Text style={s.ctaText}>{label}</Text>
    </TouchableOpacity>
  );
}

function useStyles() {
  const { theme } = useTheme();
  return { theme, s: useMemo(() => makeStyles(theme), [theme]) };
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

export function YourGame({ swingLine, onSwing, onCoach }) {
  const { theme, s } = useStyles();
  const t = useT();
  const tile = (icon, title, sub, onPress, testID) => (
    <TouchableOpacity style={[s.card, s.gameTile]} onPress={onPress} accessibilityRole="button" activeOpacity={0.85} testID={testID}>
      <View style={s.gameIcon}><Feather name={icon} size={14} color={theme.accent.primary} /></View>
      <View style={s.flex}>
        <Text style={s.gameTitle}>{title}</Text>
        <Text style={s.gameSub} numberOfLines={1}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
  return (
    <View style={s.gameSection}>
      <Text style={s.sectionLabel}>{t('home.phase.yourGame')}</Text>
      <View style={s.gameRow}>
        {tile('video', t('home.phase.swing'), swingLine || t(Platform.OS === 'web' ? 'home.phase.swingEmptyWeb' : 'home.phase.swingEmpty'), onSwing, 'home-your-game-swing')}
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
  ctaText: { color: '#00553c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, textAlign: 'center' },
  link: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  linkText: { color: onDeep.strong, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
    padding: 16, gap: 6,
  },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1.4,
    marginBottom: 10, marginTop: 6, textTransform: 'uppercase',
  },
  gameSection: { marginTop: 16 },
  gameRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  gameTile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8, paddingHorizontal: 10 },
  gameSub: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  gameIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.light },
  gameTitle: { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
});
