import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds } from '../store/personalStats';
import { filterRoundsToCourse, buildCourseBreakdown } from '../store/courseBreakdown';
import SectionCard from '../components/mystats/SectionCard';
import StatTile from '../components/mystats/StatTile';
import DistributionBars from '../components/mystats/DistributionBars';
import HoleBreakdownTable from '../components/mystats/HoleBreakdownTable';
import { toneColor, toneFill } from '../components/mystats/metricTone';
// Spatial display order for the drive bars (miss-short, miss-left, fairway,
// super, miss-right) — deliberately NOT shotMetrics' canonical DRIVE_ORDER.
const DRIVE_BAR_ORDER = ['short', 'left', 'fairway', 'super', 'right'];

// Short bar labels — the long DRIVE_LABELS copy doesn't fit under a bar.
const DRIVE_BAR_LABELS = {
  super: 'Super', fairway: 'Fairway', left: 'Left', right: 'Right', short: 'Short',
};

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
      <TouchableOpacity
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
        style={s.backBtn}
      >
        <Feather name="chevron-left" size={22} color={theme.accent.primary} />
      </TouchableOpacity>
      <Text style={s.headerTitle} numberOfLines={1}>
        {breakdown?.courseName ?? fallbackName}
      </Text>
      <View style={s.backBtn} />
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
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setBreakdown(undefined); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
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

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <SectionCard title="Course record">
          <View style={s.tileRow}>
            <StatTile value={summary.rounds} caption="rounds" />
            <StatTile value={summary.avgPoints ?? '—'} caption="avg pts" />
            <StatTile value={summary.bestPoints ?? '—'} caption="best pts" tone="up" />
            <StatTile value={summary.avgStrokes ?? '—'} caption="avg strokes" />
          </View>
          {summary.frontBack ? (
            <Text style={s.metaLine}>
              {`Front ${summary.frontBack.frontAvg} · back ${summary.frontBack.backAvg} pts/hole across ${summary.frontBack.rounds} round${summary.frontBack.rounds === 1 ? '' : 's'}`}
            </Text>
          ) : null}
          {summary.rounds === 0 ? (
            <Text style={s.metaLine}>No complete round here yet — hole stats below still count every scored hole.</Text>
          ) : null}
        </SectionCard>

        {summary.scoreMix.total > 0 ? (
          <SectionCard title="Score mix">
            <DistributionBars bars={[
              { label: 'Eagle+', count: summary.scoreMix.eagles, muted: summary.scoreMix.eagles === 0 },
              { label: 'Birdie', count: summary.scoreMix.birdies, muted: summary.scoreMix.birdies === 0 },
              { label: 'Par', count: summary.scoreMix.pars, muted: summary.scoreMix.pars === 0 },
              { label: 'Bogey', count: summary.scoreMix.bogeys, muted: summary.scoreMix.bogeys === 0 },
              { label: 'Double', count: summary.scoreMix.doubles, muted: summary.scoreMix.doubles === 0 },
              { label: 'Worse', count: summary.scoreMix.worse, muted: summary.scoreMix.worse === 0 },
            ]} />
          </SectionCard>
        ) : null}

        {highlights ? (
          <SectionCard title="Highlights">
            <HighlightRow
              icon="alert-triangle"
              tone="bad"
              label={`Nemesis · hole ${highlights.nemesis.holeNumber}`}
              detail={`${signed(highlights.nemesis.avgVsPar)} vs par over ${highlights.nemesis.timesPlayed} rounds`}
              s={s}
              theme={theme}
            />
            <HighlightRow
              icon="award"
              tone="good"
              label={`Best · hole ${highlights.best.holeNumber}`}
              detail={`${signed(highlights.best.avgVsPar)} vs par over ${highlights.best.timesPlayed} rounds`}
              s={s}
              theme={theme}
            />
          </SectionCard>
        ) : null}

        {shots ? (
          <SectionCard title="Shot detail">
            <View style={s.tileRow}>
              <StatTile
                value={shots.putts.per18 ?? '—'}
                caption="putts / 18 holes"
              />
              <StatTile value={shots.putts.threePuttPer18 ?? '—'} caption="3-putts / 18" />
              <StatTile value={shots.penalties.per18 ?? '—'} caption="penalties / 18" />
              <StatTile
                value={shots.gir.eligible > 0 ? `${shots.gir.pct}%` : '—'}
                caption={shots.gir.eligible > 0 ? `GIR · ${shots.gir.eligible} holes` : 'GIR'}
              />
            </View>
            {shots.drives.recorded > 0 ? (
              <View style={s.drivesBlock}>
                <DistributionBars bars={DRIVE_BAR_ORDER.map((k) => {
                  const count = shots.drives.distribution[k] ?? 0;
                  return {
                    label: DRIVE_BAR_LABELS[k],
                    count,
                    displayValue: `${Math.round((count / shots.drives.recorded) * 100)}%`,
                    muted: count === 0,
                  };
                })} />
                <Text style={s.metaLine}>
                  {`${shots.drives.recorded} drive${shots.drives.recorded === 1 ? '' : 's'} logged`}
                </Text>
              </View>
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title="Shot detail">
            <Text style={s.metaLine}>No shot detail logged at this course yet.</Text>
          </SectionCard>
        )}

        {holes.length > 0 ? (
          <SectionCard title="Hole by hole">
            <HoleBreakdownTable holes={holes} />
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function HighlightRow({ icon, tone, label, detail, s, theme }) {
  return (
    <View style={s.highlightRow}>
      <View style={[s.highlightIcon, { backgroundColor: toneFill(theme, tone) }]}>
        <Feather name={icon} size={14} color={toneColor(theme, tone)} />
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
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    backBtn: {
      width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
      padding: theme.spacing.xs,
    },
    headerTitle: {
      ...theme.typography.heading, color: theme.text.primary,
      flex: 1, textAlign: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.md, gap: theme.spacing.lg, paddingBottom: theme.spacing.lg * 2 },
    tileRow: { flexDirection: 'row', gap: theme.spacing.sm },
    // The bar chart's value labels sit at its very top edge — without extra
    // margin they visually collide with the stat tiles above.
    drivesBlock: { marginTop: theme.spacing.md, gap: theme.spacing.sm },
    metaLine: { ...theme.typography.caption, color: theme.text.secondary },
    highlightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
    highlightIcon: {
      width: 28, height: 28, borderRadius: theme.radius.pill,
      alignItems: 'center', justifyContent: 'center',
    },
    highlightCopy: { flex: 1, minWidth: 0, gap: 1 },
    highlightLabel: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    highlightDetail: { ...theme.typography.caption, color: theme.text.secondary },
  });
}
