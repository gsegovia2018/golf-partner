import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import { computeHandicapIndex, MIN_DIFFERENTIALS } from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';
import { fetchCourses, getCachedCourses } from '../../../store/libraryStore';
import { resolveTeeForPlayer } from '../../../store/tees';
import { calcPlayingHandicap, totalParFromHoles } from '../../../store/scoring';

// "12 May" — short date for a differential row.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const fmt1 = (n) => n.toFixed(1);

export default function HandicapTab({ myRounds, profileHandicap, gender, onInfo, onApplied }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const result = useMemo(() => computeHandicapIndex(myRounds), [myRounds]);
  const [applyState, setApplyState] = useState('idle'); // idle | saving | done | error
  const [courses, setCourses] = useState(null); // null = loading
  const [courseId, setCourseId] = useState(null);
  const [teeId, setTeeId] = useState(null);

  // Profile writes clamp at 0 — the profile validator rejects plus (negative)
  // indexes. The hero still displays the true value.
  const applyValue = result.index == null ? null : Math.max(0, result.index);
  const isPlus = result.index != null && result.index < 0;

  const onApply = async () => {
    if (applyValue == null || applyState === 'saving') return;
    setApplyState('saving');
    try {
      await upsertProfile({ handicap: applyValue });
      setApplyState('done');
      onApplied?.(applyValue);
    } catch (_) {
      setApplyState('error');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = [];
      try {
        list = await fetchCourses();
      } catch (_) {
        list = await getCachedCourses();
      }
      if (!cancelled) setCourses(list.filter((c) => (c.tees ?? []).some((t) => t.slope)));
    })();
    return () => { cancelled = true; };
  }, []);

  const course = courses?.find((c) => c.id === courseId) ?? null;
  const tee = course?.tees?.find((t) => t.id === teeId) ?? null;
  // Preview off the calculated index; fall back to the profile handicap so
  // the section still works before 3 qualifying rounds exist.
  const previewIndex = result.index ?? profileHandicap;
  const resolved = tee ? resolveTeeForPlayer(tee, gender) : null;
  const courseHandicap = (resolved?.slope && previewIndex != null)
    ? calcPlayingHandicap(previewIndex, resolved.slope, resolved.rating, totalParFromHoles(course.holes))
    : null;

  const previewCard = (courses && courses.length > 0 && previewIndex != null) ? (
    <SectionCard title="Course handicap" infoKey="courseHandicap" onInfo={onInfo}>
      <Text style={s.caption}>What you'd play off, per course and tee</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={s.chips}>
          {courses.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[s.chip, courseId === c.id && s.chipOn]}
              onPress={() => { setCourseId(c.id); setTeeId(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: courseId === c.id }}
            >
              <Text style={[s.chipText, courseId === c.id && s.chipTextOn]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {course && (
        <View style={s.chips}>
          {course.tees.filter((t) => t.slope).map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[s.chip, teeId === t.id && s.chipOn]}
              onPress={() => setTeeId(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: teeId === t.id }}
            >
              <Text style={[s.chipText, teeId === t.id && s.chipTextOn]}>{t.label || 'Standard'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {courseHandicap != null && (
        <Text style={s.previewResult}>
          {`With index ${fmt1(previewIndex)} you'd play off ${courseHandicap} here.`}
        </Text>
      )}
    </SectionCard>
  ) : null;

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    return (
      <View style={s.wrap}>
        <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
          <Text style={s.emptyTitle}>Not enough qualifying rounds yet</Text>
          <Text style={s.note}>
            {`You need ${MIN_DIFFERENTIALS} qualifying rounds to calculate an index — ${missing} more to go. `}
            {'A round qualifies when it is a complete 18-hole round (no scrambles) on a tee with a slope and course rating.'}
          </Text>
        </SectionCard>
        {previewCard}
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.hero}>{fmt1(result.index)}</Text>
        <Text style={s.heroSub}>
          {`Best ${result.usedCount} of last ${result.windowCount} differentials`}
        </Text>
        {isPlus && (
          <Text style={s.note}>A negative index means you play better than scratch.</Text>
        )}
        <TouchableOpacity
          style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
          onPress={onApply}
          disabled={applyState === 'saving'}
          accessibilityRole="button"
        >
          <Text style={s.applyText}>
            {applyState === 'done' ? 'Saved to profile ✓' : `Set as my handicap${isPlus ? ' (0.0)' : ''}`}
          </Text>
        </TouchableOpacity>
        {applyState === 'error' && (
          <Text style={s.errorText}>Could not save — try again.</Text>
        )}
        <Text style={s.profileNote}>
          {profileHandicap != null
            ? `Profile handicap today: ${profileHandicap}`
            : 'No handicap on your profile yet.'}
        </Text>
      </SectionCard>

      <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.caption}>Last {result.windowCount} qualifying rounds · lowest count</Text>
        {[...result.differentials].reverse().map((d) => (
          <View key={d.key} style={[s.row, d.counting && s.rowCounting]}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle} numberOfLines={1}>{d.courseName}</Text>
              <Text style={s.rowSub}>{`${fmtDate(d.date)} · adjusted gross ${d.ags}`}</Text>
            </View>
            <Text style={[s.rowValue, d.counting && s.rowValueCounting]}>
              {fmt1(d.differential)}
            </Text>
          </View>
        ))}
      </SectionCard>

      {previewCard}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    hero: { ...theme.typography.display, color: theme.text.primary, textAlign: 'center' },
    heroSub: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center' },
    note: { ...theme.typography.caption, color: theme.text.muted, marginTop: theme.spacing.sm },
    emptyTitle: { ...theme.typography.subhead, color: theme.text.primary },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: theme.spacing.xs },
    applyBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
      alignItems: 'center',
    },
    applyBtnDisabled: { opacity: 0.6 },
    applyText: { ...theme.typography.subhead, color: theme.text.inverse },
    errorText: { ...theme.typography.caption, color: theme.destructive, textAlign: 'center', marginTop: theme.spacing.xs },
    profileNote: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    rowCounting: { backgroundColor: theme.accent.light, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm },
    rowMain: { flex: 1 },
    rowTitle: { ...theme.typography.body, color: theme.text.primary },
    rowSub: { ...theme.typography.tiny, color: theme.text.muted },
    rowValue: { ...theme.typography.subhead, color: theme.text.muted, fontVariant: ['tabular-nums'] },
    rowValueCounting: { color: theme.accent.primary, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: theme.spacing.sm },
    chip: {
      paddingHorizontal: theme.spacing.md, paddingVertical: 6,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    chipTextOn: { color: theme.text.inverse },
    previewResult: { ...theme.typography.body, color: theme.text.primary, marginTop: theme.spacing.md },
  });
}
