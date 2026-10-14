import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { consumePendingCourses } from '../../lib/selectionBridge';
import { defaultTee } from '../../store/leagueOffApp';
import { isRatedTee } from '../../store/handicapIndex';
import { fetchCourses } from '../../store/libraryStore';
import { makeOffAppStyles } from './offAppStyles';

// Course + tee for an off-app league card. Uses the existing CoursePicker
// round trip (the picker stashes its pick in the selection bridge and we
// consume it on focus), then a layout row for a club with several layouts and
// a tee row. `value` is { course, tee } (either may be null); `onChange` gets
// the same shape.
export default function CourseTeePicker({ navigation, value, onChange }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const l = makeStyles(theme);
  const tt = useT();
  const [layouts, setLayouts] = useState(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  // Set when I leave for the course editor to rate a tee; on return the
  // course is re-read so the chip shows the new slope and rating.
  const editingRef = useRef(false);

  useFocusEffect(useCallback(() => {
    const pick = consumePendingCourses()?.picks?.[0];
    if (!pick) {
      const { course: cur, tee: curTee } = valueRef.current;
      if (editingRef.current && cur?.id) {
        editingRef.current = false;
        fetchCourses().then((all) => {
          const fresh = all.find((c) => c.id === cur.id);
          if (!fresh) return;
          const tees = fresh.tees ?? [];
          onChangeRef.current({
            course: { ...cur, tees },
            tee: tees.find((t) => t.label === curTee?.label) ?? defaultTee({ tees }),
          });
        }).catch(() => {});
      }
      return;
    }
    if (pick.kind === 'course') {
      setLayouts(null);
      onChangeRef.current({ course: pick.course, tee: defaultTee(pick.course) });
    } else if (pick.layouts?.length === 1) {
      setLayouts(null);
      onChangeRef.current({ course: pick.layouts[0], tee: defaultTee(pick.layouts[0]) });
    } else {
      setLayouts(pick.layouts ?? []);
      onChangeRef.current({ course: null, tee: null });
    }
  }, []));

  const { course, tee } = value;
  const tees = course?.tees ?? [];
  const ratedTee = tees.find(isRatedTee) ?? null;
  const sub = course
    ? [tee?.label ? tt('league.tee.teesSub', { tee: tee.label }) : null, tt('league.tee.holes', { count: course.holes?.length ?? 0 })].filter(Boolean).join(' · ')
    : tt('league.tee.courseAndTee');

  return (
    <View>
      <Text style={s.fieldLabel}>{tt('league.tee.course')}</Text>
      <TouchableOpacity
        style={s.pickRow}
        onPress={() => navigation.navigate('CoursePicker', { roundIndex: 0, maxSelectable: 1 })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={tt('league.tee.pickCourse')}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.pickTitle}>{course?.name ?? tt('league.tee.pickCourse')}</Text>
          <Text style={s.pickSub}>{sub}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </TouchableOpacity>

      {layouts && !course && (
        <>
          <Text style={s.fieldLabel}>{tt('league.tee.layout')}</Text>
          <View style={s.chips}>
            {layouts.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={s.chip}
                onPress={() => { setLayouts(null); onChange({ course: l, tee: defaultTee(l) }); }}
                activeOpacity={0.7}
              >
                <Text style={s.chipText}>{l.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {course && tees.length > 0 && (
        <>
          <Text style={s.fieldLabel}>{tt('league.tee.tee')}</Text>
          <View style={s.chips}>
            {tees.map((t) => {
              const on = tee?.label === t.label;
              const rated = isRatedTee(t);
              const slope = rated ? formatNumber(parseInt(t.slope, 10)) : null;
              const rating = rated ? formatNumber(parseFloat(t.rating)) : null;
              const sub = rated ? tt('league.tee.rated', { slope, rating }) : tt('league.tee.unrated');
              // Rated: filled when on. Unrated: dashed, and an on chip keeps the
              // dashed border with a light accent fill instead of the solid one.
              return (
                <TouchableOpacity
                  key={t.id ?? t.label}
                  style={[s.chip, l.chip, !rated && l.chipUnrated, on && (rated ? s.chipOn : l.chipUnratedOn)]}
                  onPress={() => onChange({ course, tee: t })}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={rated ? tt('league.tee.a11yRated', { tee: t.label, slope, rating }) : tt('league.tee.a11yUnrated', { tee: t.label })}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, on && (rated ? s.chipTextOn : l.chipTextUnratedOn)]}>{t.label}</Text>
                  <Text style={[l.chipSub, on && (rated ? s.chipTextOn : l.chipTextUnratedOn)]}>{sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {tee && !isRatedTee(tee) && (
            <View style={l.note} accessibilityRole="alert">
              <Text style={l.noteTitle}>{tt('league.tee.unratedTitle', { tee: tee.label })}</Text>
              <Text style={l.noteBody}>
                {tt('league.tee.unratedBody')}
              </Text>
              <View style={l.noteActions}>
                {!!course.id && (
                  <TouchableOpacity
                    onPress={() => {
                      editingRef.current = true;
                      navigation.navigate('CourseLibraryDetail', { courseId: course.id, courseName: course.name });
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="link"
                  >
                    <Text style={s.linkText}>{tt('league.tee.addRating')}</Text>
                  </TouchableOpacity>
                )}
                {!!ratedTee && (
                  <TouchableOpacity
                    style={l.useBtn}
                    onPress={() => onChange({ course, tee: ratedTee })}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <Text style={s.secondaryText}>{tt('league.tee.use', { tee: ratedTee.label })}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    chip: { alignItems: 'center' },
    chipUnrated: { borderStyle: 'dashed' },
    chipUnratedOn: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
    chipTextUnratedOn: { color: theme.accent.primary },
    chipSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 10 },
    note: {
      backgroundColor: theme.bg.secondary, borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
      padding: 12, marginBottom: 8,
    },
    noteTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 13, marginBottom: 4 },
    noteBody: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17 },
    noteActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 8 },
    useBtn: { paddingVertical: 4 },
  });
}
