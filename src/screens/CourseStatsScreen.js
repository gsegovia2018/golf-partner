import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import ScreenContainer from '../components/ScreenContainer';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds } from '../store/personalStats';
import { filterRoundsToCourse, buildCourseBreakdown } from '../store/courseBreakdown';
import SectionCard from '../components/mystats/SectionCard';
import RingStat from '../components/mystats/RingStat';
import FairwayFan from '../components/mystats/FairwayFan';
import ScoreMixBar from '../components/mystats/ScoreMixBar';
import HoleGrid from '../components/mystats/HoleGrid';
import CountUpText from '../components/mystats/CountUpText';
import { toneColor, toneFill } from '../components/mystats/metricTone';
import { statExplainers } from '../components/mystats/statExplainers';
import StatDetailSheet from '../components/StatDetailSheet';

// Clubhouse dark-green hero surface — same constants as CoachHero.js /
// ShotDashboard.js / CareerMilestonesCard.js, copied locally by convention
// rather than imported.
const GREEN = '#0f3d2c';
const CREAM = '#f3efe6';
const CREAM_85 = 'rgba(243,239,230,0.85)';
const CREAM_65 = 'rgba(243,239,230,0.65)';
const CREAM_55 = 'rgba(243,239,230,0.55)';
const HAIRLINE = 'rgba(243,239,230,0.14)';

const STAGGER_MS = 60;
const COUNT_MS = 500;

// Visual scales for the shot-detail progress rings. The ring is a gauge, not
// the number — the tile's CENTER always shows the real value; these only set
// how much of the ring that value fills (clamped at a full ring).
// - Putts: 36 = the 2-putt-per-hole benchmark; at/below it the ring is green,
//   over it the stroke flips to destructive.
const PUTTS_RING_BENCHMARK = 36;
// - 3-putts: 6 per 18 fills the ring — any 3-putt shows destructive.
const THREE_PUTT_RING_SCALE = 6;
// - Penalties: 9 per 18 fills the ring (a penalty every other hole).
const PENALTY_RING_SCALE = 9;

// The gold "Best pts" cell mirrors the honours-board convention (best value
// lands in semantic.winner.dark on the green surface).
const HERO_CELLS = [
  { key: 'rounds', label: 'Rounds', get: (sum) => sum.rounds },
  { key: 'avg-pts', label: 'Avg pts', get: (sum) => sum.avgPoints },
  { key: 'best-pts', label: 'Best pts', get: (sum) => sum.bestPoints, gold: true },
  { key: 'avg-strokes', label: 'Avg strokes', get: (sum) => sum.avgStrokes },
];

// Per-course drill-down: personal stats on one course, down to hole level.
// Opened from the Course Mastery card with { courseKey, courseName }.
// See docs/superpowers/specs/2026-07-15-course-breakdown-design.md
export default function CourseStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const courseKey = route?.params?.courseKey ?? null;
  const fallbackName = route?.params?.courseName ?? 'Course';

  const [breakdown, setBreakdown] = useState(undefined); // undefined = loading, null = no rounds
  const [error, setError] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [infoKey, setInfoKey] = useState(null);
  const activeExplainer = infoKey ? statExplainers[infoKey] : null;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const [{ list }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        const myRounds = collectMyRounds(list, user?.id, profile?.displayName);
        const courseRounds = filterRoundsToCourse(myRounds, courseKey);
        if (!cancelled) setBreakdown(buildCourseBreakdown(courseRounds));
      } catch (e) {
        console.warn('CourseStatsScreen: failed to load', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, courseKey, loadNonce]);

  const Header = (
    <View style={s.header}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
        style={s.backBtn}
      >
        <Feather name="chevron-left" size={22} color={theme.accent.primary} />
      </PressableScale>
      <Text style={s.headerTitle} numberOfLines={1}>
        {breakdown?.courseName ?? fallbackName}
      </Text>
    </View>
  );

  if (breakdown === undefined && !error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Could not load course stats.</Text>
          <PressableScale
            accessibilityRole="button"
            style={s.retryBtn}
            onPress={() => { setBreakdown(undefined); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </PressableScale>
        </View>
      </ScreenContainer>
    );
  }

  if (breakdown === null) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="map" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds at this course yet.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const { summary, shots, holes, highlights } = breakdown;

  // Each card mounts inside a Reveal with a contiguous 40ms stagger (matching
  // the mystats tabs) — addCard keeps conditional cards from leaving gaps.
  const cards = [];
  const addCard = (key, node) => {
    cards.push(<Reveal key={key} delay={cards.length * 40}>{node}</Reveal>);
  };

  addCard('record', <CourseRecordBoard summary={summary} onInfo={setInfoKey} s={s} />);

  if (summary.scoreMix.total > 0) {
    addCard('score-mix', (
      <SectionCard title="Score mix" infoKey="courseScoreMix" onInfo={setInfoKey}>
        <ScoreMixBar distribution={summary.scoreMix} />
      </SectionCard>
    ));
  }

  if (highlights) {
    addCard('highlights', (
      <SectionCard title="Highlights" infoKey="courseHighlights" onInfo={setInfoKey}>
        <HighlightRow
          icon="alert-triangle"
          kind="nemesis"
          label={`Nemesis · hole ${highlights.nemesis.holeNumber}`}
          detail={`${signed(highlights.nemesis.avgVsPar)} vs par over ${highlights.nemesis.timesPlayed} rounds`}
          s={s}
          theme={theme}
        />
        <HighlightRow
          icon="award"
          kind="best"
          label={`Best · hole ${highlights.best.holeNumber}`}
          detail={`${signed(highlights.best.avgVsPar)} vs par over ${highlights.best.timesPlayed} rounds`}
          s={s}
          theme={theme}
        />
      </SectionCard>
    ));
  }

  addCard('shot-detail', shots ? (
    <SectionCard title="Shot detail" infoKey="courseShotDetail" onInfo={setInfoKey}>
      <View style={s.ringRow}>
        <RingStat
          index={0}
          testID="ring-putts"
          label="Putts / 18"
          value={shots.putts.per18}
          fill={shots.putts.per18 != null ? shots.putts.per18 / PUTTS_RING_BENCHMARK : null}
          color={shots.putts.per18 != null && shots.putts.per18 > PUTTS_RING_BENCHMARK
            ? theme.destructive : theme.accent.primary}
        />
        <RingStat
          index={1}
          testID="ring-three-putts"
          label="3-putts / 18"
          value={shots.putts.threePuttPer18}
          fill={shots.putts.threePuttPer18 != null
            ? shots.putts.threePuttPer18 / THREE_PUTT_RING_SCALE : null}
          color={shots.putts.threePuttPer18 > 0 ? theme.destructive : theme.accent.primary}
        />
        <RingStat
          index={2}
          testID="ring-gir"
          label="GIR"
          value={shots.gir.eligible > 0 ? shots.gir.pct : null}
          suffix="%"
          fill={shots.gir.eligible > 0 ? shots.gir.pct / 100 : null}
          color={theme.accent.primary}
        />
        <RingStat
          index={3}
          testID="ring-penalties"
          label="Penalties / 18"
          value={shots.penalties.per18}
          fill={shots.penalties.per18 != null ? shots.penalties.per18 / PENALTY_RING_SCALE : null}
          color={theme.destructive}
        />
      </View>
      {shots.drives.recorded > 0 ? (
        <View style={s.drivesBlock}>
          <Text style={s.panelHeading}>Off the tee</Text>
          <FairwayFan drives={shots.drives} />
          <Text style={s.metaLine}>
            {`${shots.drives.recorded} drive${shots.drives.recorded === 1 ? '' : 's'} logged`}
          </Text>
        </View>
      ) : null}
    </SectionCard>
  ) : (
    <SectionCard title="Shot detail" infoKey="courseShotDetail" onInfo={setInfoKey}>
      <Text style={s.metaLine}>No shot detail logged at this course yet.</Text>
    </SectionCard>
  ));

  if (holes.length > 0) {
    addCard('holes', (
      <SectionCard title="Hole by hole" infoKey="courseHoleByHole" onInfo={setInfoKey}>
        <HoleGrid holes={holes} highlights={highlights} />
      </SectionCard>
    ));
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {cards}
      </ScrollView>
      <StatDetailSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={activeExplainer?.title ?? ''}
        subtitle={activeExplainer?.subtitle ?? ''}
        explainer={activeExplainer?.explainer ?? ''}
        rows={[]}
        shareable={false}
      />
    </ScreenContainer>
  );
}

// The "Course record" honours board: dark-green hero surface, overline
// kicker, Playfair cream numbers counting up with a stagger. Non-integer
// values (avg pts / avg strokes) render statically — CountUpText rounds every
// frame to a whole number, so animating 100.5 would flash wrong values.
function CourseRecordBoard({ summary, onInfo, s }) {
  const reduced = useReducedMotion();

  const footnote = summary.frontBack
    ? `Front ${summary.frontBack.frontAvg} · back ${summary.frontBack.backAvg} pts/hole across ${summary.frontBack.rounds} round${summary.frontBack.rounds === 1 ? '' : 's'}`
    : summary.rounds === 0
      ? 'No complete round here yet — hole stats below still count every scored hole.'
      : null;

  return (
    <View style={s.board} testID="course-record-board">
      <View style={s.boardHead}>
        <Text style={s.boardKicker}>Course Record</Text>
        <TouchableOpacity
          onPress={() => onInfo('courseRecord')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="What is Course record"
        >
          <Feather name="info" size={14} color={CREAM_85} />
        </TouchableOpacity>
      </View>
      <View style={s.boardGrid}>
        {HERO_CELLS.map((cell, i) => {
          const value = cell.get(summary);
          const has = Number.isFinite(value);
          return (
            <View
              key={cell.key}
              style={s.boardCell}
              accessible
              accessibilityLabel={`${cell.label}: ${has ? value : 'no data yet'}`}
              testID={`course-record-${cell.key}`}
            >
              <Text
                style={[s.boardNumber, cell.gold && s.boardNumberGold]}
                testID={`course-record-${cell.key}-value`}
              >
                {!has ? '—'
                  : Number.isInteger(value)
                    ? <CountUpText value={value} duration={COUNT_MS} delay={i * STAGGER_MS} disabled={reduced} />
                    : `${value}`}
              </Text>
              <Text style={s.boardLabel}>{cell.label}</Text>
            </View>
          );
        })}
      </View>
      {footnote ? <Text style={s.boardFootnote}>{footnote}</Text> : null}
    </View>
  );
}

function HighlightRow({ icon, kind, label, detail, s, theme }) {
  const gold = kind === 'best';
  const iconColor = gold
    ? (theme.isDark ? semantic.winner.dark : semantic.winner.light)
    : toneColor(theme, 'bad');
  const fill = gold
    ? (theme.isDark ? 'rgba(255,215,0,0.14)' : 'rgba(169,130,30,0.12)')
    : toneFill(theme, 'bad');
  return (
    <View style={s.highlightRow}>
      <View style={[s.highlightIcon, { backgroundColor: fill }]}>
        <Feather name={icon} size={14} color={iconColor} />
      </View>
      <View style={s.highlightCopy}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    // Same container metrics as MyStatsScreen's header — serif title sits
    // left-aligned next to the chevron, no bottom hairline.
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    },
    backBtn: {
      width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
      padding: theme.spacing.xs, marginLeft: -theme.spacing.sm,
    },
    headerTitle: {
      flex: 1, fontFamily: 'PlayfairDisplay-Black', fontSize: 23,
      color: theme.text.primary,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.md, gap: theme.spacing.lg, paddingBottom: theme.spacing.lg * 2 },
    ringRow: { flexDirection: 'row', gap: theme.spacing.sm },
    drivesBlock: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
    // "OFF THE TEE" panel heading over the fairway fan.
    panelHeading: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.accent.primary,
    },
    metaLine: { ...theme.typography.caption, color: theme.text.secondary },
    // Course-record honours board.
    board: {
      backgroundColor: GREEN,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    boardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    boardKicker: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: 'rgba(243,239,230,0.7)',
    },
    boardGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: theme.spacing.md,
      columnGap: theme.spacing.sm,
    },
    boardCell: { flexBasis: '22%', flexGrow: 1, gap: 2 },
    boardNumber: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 28,
      lineHeight: 34,
      color: CREAM,
      fontVariant: ['tabular-nums'],
    },
    boardNumberGold: { color: semantic.winner.dark },
    boardLabel: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: CREAM_65,
    },
    boardFootnote: {
      fontSize: 10.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: CREAM_55,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: HAIRLINE,
      paddingTop: 10,
      marginTop: theme.spacing.xs,
    },
    highlightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
    highlightIcon: {
      width: 28, height: 28, borderRadius: theme.radius.pill,
      alignItems: 'center', justifyContent: 'center',
    },
    highlightCopy: { flex: 1, minWidth: 0, gap: 1 },
    highlightLabel: { fontSize: 13.5, lineHeight: 19, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    highlightDetail: { fontSize: 11, lineHeight: 15, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted },
  });
}
