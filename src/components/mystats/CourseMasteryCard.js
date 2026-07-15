import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import { toneColor, toneFill } from './metricTone';

// Per-course rounds/avgPoints/bestPoints/trend — see
// `courseMastery` in personalStats.js. Renders nothing when there is no
// complete round at any course yet.
export default function CourseMasteryCard({ courses, onInfo, onSelectCourse }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const rows = courses ?? [];
  if (rows.length === 0) return null;

  return (
    <SectionCard title="Course Mastery" infoKey="courseMastery" onInfo={onInfo}>
      <View style={s.rows}>
        {rows.map((course) => (
          <CourseRow
            key={course.courseKey ?? course.courseName}
            course={course}
            s={s}
            theme={theme}
            onPress={course.courseKey != null && onSelectCourse
              ? () => onSelectCourse(course)
              : null}
          />
        ))}
      </View>
    </SectionCard>
  );
}

function CourseRow({ course, s, theme, onPress }) {
  // trend null = only one complete round here — there is no trend claim to
  // make, so no icon at all (a minus would read as "flat", i.e. two equal
  // rounds). trend 0 IS a claim (two genuinely equal consecutive rounds)
  // and keeps the minus.
  const hasTrend = course.trend != null;
  const tone = course.trend > 0 ? 'good' : course.trend < 0 ? 'bad' : 'neutral';
  const icon = course.trend > 0 ? 'trending-up' : course.trend < 0 ? 'trending-down' : 'minus';
  const color = toneColor(theme, tone);
  const body = (
    <>
      <View style={s.copy}>
        <Text style={s.courseName} numberOfLines={1}>{course.courseName}</Text>
        <Text style={s.meta}>
          {`${course.rounds} round${course.rounds === 1 ? '' : 's'} · best ${course.bestPoints} pts`}
        </Text>
      </View>
      <View style={s.right}>
        <Text style={s.avg}>{`${course.avgPoints} pts avg`}</Text>
        {hasTrend ? (
          <View
            style={[s.trendPill, { backgroundColor: toneFill(theme, tone) }]}
            accessible
            accessibilityLabel={`${course.courseName} trend ${tone}`}
          >
            <Feather name={icon} size={13} color={color} />
          </View>
        ) : (
          <View style={s.trendPill} />
        )}
        {onPress ? <Feather name="chevron-right" size={16} color={theme.text.muted} /> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Open ${course.courseName} stats`}
    >
      {body}
    </TouchableOpacity>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    rows: { gap: 6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      borderRadius: theme.radius.md,
      backgroundColor: theme.bg.card,
    },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    courseName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    meta: { ...theme.typography.caption, color: theme.text.secondary },
    right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexShrink: 0 },
    avg: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    trendPill: {
      width: 26, height: 26, borderRadius: theme.radius.pill,
      alignItems: 'center', justifyContent: 'center',
    },
  });
}
