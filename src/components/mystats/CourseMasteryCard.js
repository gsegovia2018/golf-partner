import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { scalePoints } from './chartGeometry';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const SPARK_W = 84;
const SPARK_H = 26;
const SPARK_PAD = 4;

// Per-course rounds/avgPoints/bestPoints/recentPoints — see `courseMastery`
// in personalStats.js. Each course renders as a card: big serif average on
// the left, name + meta in the middle, a per-round points sparkline on the
// right. Renders nothing when there is no complete round at any course yet.
export default function CourseMasteryCard({ courses, onInfo, onSelectCourse }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const rows = courses ?? [];
  if (rows.length === 0) return null;

  return (
    <SectionCard title="Course Mastery" infoKey="courseMastery" onInfo={onInfo}>
      <View style={s.rows}>
        {rows.map((course) => (
          <CourseCard
            key={course.courseKey ?? course.courseName}
            course={course}
            s={s}
            theme={theme}
            onPress={course.courseKey && onSelectCourse
              ? () => onSelectCourse(course)
              : null}
          />
        ))}
      </View>
    </SectionCard>
  );
}

function CourseCard({ course, s, theme, onPress }) {
  const body = (
    <>
      <View style={s.avgBlock}>
        <Text style={s.avg}>{course.avgPoints}</Text>
        <Text style={s.avgLabel}>AVG PTS</Text>
      </View>
      <View style={s.copy}>
        <Text style={s.courseName} numberOfLines={1}>{course.courseName}</Text>
        <Text style={s.meta}>
          {`${course.rounds} round${course.rounds === 1 ? '' : 's'} · best ${course.bestPoints} pts`}
        </Text>
      </View>
      <Sparkline points={course.recentPoints} theme={theme} s={s} />
      {onPress ? <Feather name="chevron-right" size={16} color={theme.text.muted} /> : null}
    </>
  );
  if (!onPress) return <View style={s.card}>{body}</View>;
  return (
    <PressableScale
      style={s.card}
      onPress={onPress}
      activeScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={`Open ${course.courseName} stats`}
    >
      {body}
    </PressableScale>
  );
}

// Compact per-round points line. One complete round has no shape to draw —
// fewer than 2 points renders nothing, and the row simply closes up.
function Sparkline({ points, theme, s }) {
  const values = points ?? [];
  if (values.length < 2) return null;
  const scaled = scalePoints(values, {
    width: SPARK_W, height: SPARK_H, padX: SPARK_PAD, padTop: SPARK_PAD, padBottom: SPARK_PAD,
  });
  const last = scaled[scaled.length - 1];
  return (
    <SparkReveal style={s.spark} innerStyle={s.sparkInner}>
      <Svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
        <Polyline
          points={scaled.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.accent.primary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={last.x} cy={last.y} r={3} fill={theme.accent.primary} />
      </Svg>
    </SparkReveal>
  );
}

// The sparkline sweeps in from the left on mount (scaleX 0→1, origin left)
// inside an overflow-hidden window — same convention as ScoreMixBar's
// GrowRow. Reduced motion ⇒ static full line.
function SparkReveal({ style, innerStyle, children }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withTiming(1, { duration: 300, easing: EASE_OUT });
    }
  }, [reduced, scaleX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return (
    <View style={style}>
      <Animated.View style={[innerStyle, animatedStyle]}>{children}</Animated.View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    rows: { gap: 8 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      borderRadius: 14,
      backgroundColor: theme.bg.primary,
    },
    avgBlock: { minWidth: 56, alignItems: 'center', gap: 1 },
    avg: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 32,
      lineHeight: 36,
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    avgLabel: {
      fontSize: 8.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    courseName: {
      fontSize: 14.5,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
    },
    meta: { fontSize: 11, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted },
    spark: { width: SPARK_W, height: SPARK_H, overflow: 'hidden' },
    sparkInner: { transformOrigin: 'left center' },
  });
}
