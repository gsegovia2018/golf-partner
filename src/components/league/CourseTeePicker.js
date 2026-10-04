import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { consumePendingCourses } from '../../lib/selectionBridge';
import { defaultTee } from '../../store/leagueOffApp';
import { makeOffAppStyles } from './offAppStyles';

// Course + tee for an off-app league card. Uses the existing CoursePicker
// round trip (the picker stashes its pick in the selection bridge and we
// consume it on focus), then a layout row for a club with several layouts and
// a tee row. `value` is { course, tee } (either may be null); `onChange` gets
// the same shape.
export default function CourseTeePicker({ navigation, value, onChange }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const [layouts, setLayouts] = useState(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useFocusEffect(useCallback(() => {
    const pick = consumePendingCourses()?.picks?.[0];
    if (!pick) return;
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
  const sub = course
    ? [tee?.label ? `${tee.label} tees` : null, `${course.holes?.length ?? 0} holes`].filter(Boolean).join(' · ')
    : 'Course and tee';

  return (
    <View>
      <Text style={s.fieldLabel}>Course</Text>
      <TouchableOpacity
        style={s.pickRow}
        onPress={() => navigation.navigate('CoursePicker', { roundIndex: 0, maxSelectable: 1 })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Pick the course"
      >
        <View style={{ flex: 1 }}>
          <Text style={s.pickTitle}>{course?.name ?? 'Pick the course'}</Text>
          <Text style={s.pickSub}>{sub}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </TouchableOpacity>

      {layouts && !course && (
        <>
          <Text style={s.fieldLabel}>Layout</Text>
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
          <Text style={s.fieldLabel}>Tee</Text>
          <View style={s.chips}>
            {tees.map((t) => {
              const on = tee?.label === t.label;
              return (
                <TouchableOpacity
                  key={t.id ?? t.label}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => onChange({ course, tee: t })}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}
