import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import BottomSheet from './BottomSheet';
import {
  parseIso, todayIso, addDays, nearestSaturday, inBounds, clampIso, addMonths, monthGrid,
  stepTime, formatLabel, monthTitle,
} from '../lib/calendar';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const STEP_MINUTES = 10;

const monthOf = (iso) => {
  const p = parseIso(iso);
  return { y: p.y, m: p.m };
};
const monthKey = ({ y, m }) => y * 12 + m;

// Pure-JS calendar sheet (no native picker, so it ships over the air and looks
// the same on web and Android). Dates are 'YYYY-MM-DD', time is 'HH:MM'.
//   min / max   - inclusive selectable range (either may be omitted)
//   quickDates  - false hides the Today / Saturday chips
//   time        - when set, a tee-time stepper is shown and passed back
//   onChange    - (iso, time) on Done
export default function DateSheet({ visible, title, value, onChange, onClose, min, max, time, quickDates = true }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const today = todayIso();

  const [sel, setSel] = useState(null);
  const [clock, setClock] = useState(time);
  const [view, setView] = useState(() => monthOf(clampIso(today, min, max)));

  // Re-seed from the field's value every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const start = inBounds(value, min, max) ? value : null;
    setSel(start);
    setClock(time);
    setView(monthOf(start || clampIso(today, min, max)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const candidates = [
    ['Today', today],
    ['Yesterday', addDays(today, -1)],
    ['Tomorrow', addDays(today, 1)],
    ['Saturday', nearestSaturday(today)],
  ];
  const seen = new Set();
  let pastShown = false;
  const chips = candidates.filter(([label, iso]) => {
    if (!inBounds(iso, min, max) || seen.has(iso)) return false;
    // Yesterday and Tomorrow are alternatives: one is enough.
    if (label === 'Yesterday' || label === 'Tomorrow') {
      if (pastShown) return false;
      pastShown = true;
    }
    seen.add(iso);
    return true;
  });

  const canPrev = !min || monthKey(view) > monthKey(monthOf(min));
  const canNext = !max || monthKey(view) < monthKey(monthOf(max));
  const pick = (iso) => { setSel(iso); setView(monthOf(iso)); };

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
      <View style={s.titleRow}>
        <Text style={s.title}>{title}</Text>
        {!!sel && <Text style={s.selected}>{formatLabel(sel)}</Text>}
      </View>

      {quickDates && <View style={s.chips}>
        {chips.map(([label, iso]) => (
          <TouchableOpacity
            key={label}
            style={[s.chip, sel === iso && s.chipOn]}
            onPress={() => pick(iso)}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${formatLabel(iso)}`}
          >
            <Text style={[s.chipText, sel === iso && s.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>}

      <View style={s.monthRow}>
        <TouchableOpacity
          style={[s.arrow, !canPrev && s.off]}
          disabled={!canPrev}
          onPress={() => setView(addMonths(view, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityState={{ disabled: !canPrev }}
        >
          <Feather name="chevron-left" size={22} color={theme.text.primary} />
        </TouchableOpacity>
        <Text style={s.monthText}>{monthTitle(view)}</Text>
        <TouchableOpacity
          style={[s.arrow, !canNext && s.off]}
          disabled={!canNext}
          onPress={() => setView(addMonths(view, 1))}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: !canNext }}
        >
          <Feather name="chevron-right" size={22} color={theme.text.primary} />
        </TouchableOpacity>
      </View>

      <View style={s.week}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={s.weekday}>{d}</Text>)}
      </View>
      <View style={s.grid}>
        {monthGrid(view).map((iso, i) => {
          if (!iso) return <View key={`b${i}`} style={s.cell} />;
          const ok = inBounds(iso, min, max);
          const on = iso === sel;
          return (
            <View key={iso} style={s.cell}>
              <TouchableOpacity
                style={[s.day, iso === today && !on && s.dayToday, on && s.dayOn]}
                disabled={!ok}
                onPress={() => pick(iso)}
                accessibilityRole="button"
                accessibilityLabel={formatLabel(iso)}
                accessibilityState={{ disabled: !ok, selected: on }}
              >
                <Text style={[s.dayText, !ok && s.dayTextOff, on && s.dayTextOn]}>{Number(iso.slice(8))}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {clock != null && (
        <View style={s.timeBlock}>
          <View style={s.timeRow}>
            <TouchableOpacity
              style={s.stepBtn}
              onPress={() => setClock(stepTime(clock, -STEP_MINUTES))}
              accessibilityRole="button"
              accessibilityLabel="Earlier tee time"
            >
              <Feather name="minus" size={20} color={theme.accent.primary} />
            </TouchableOpacity>
            <Text style={s.time} accessibilityLabel={`Tee time ${clock}`}>{clock}</Text>
            <TouchableOpacity
              style={s.stepBtn}
              onPress={() => setClock(stepTime(clock, STEP_MINUTES))}
              accessibilityRole="button"
              accessibilityLabel="Later tee time"
            >
              <Feather name="plus" size={20} color={theme.accent.primary} />
            </TouchableOpacity>
          </View>
          <Text style={s.rule}>Tee time moves in 10-minute steps.</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.done, !sel && s.off]}
        disabled={!sel}
        onPress={() => { onChange(sel, clock); onClose(); }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Done"
      >
        <Text style={s.doneText}>Done</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border.default, marginBottom: 14,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22 },
  selected: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 8, minHeight: 34 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: theme.border.default,
  },
  chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  chipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  chipTextOn: { color: theme.text.inverse },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.3 },
  monthText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
  week: { flexDirection: 'row', marginBottom: 2 },
  weekday: {
    width: `${100 / 7}%`, textAlign: 'center', fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.text.muted, fontSize: 11,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: theme.accent.primary },
  dayOn: { backgroundColor: theme.accent.primary },
  dayText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
  dayTextOff: { color: theme.text.muted, opacity: 0.45 },
  dayTextOn: { color: theme.text.inverse, fontFamily: 'PlusJakartaSans-ExtraBold' },
  timeBlock: { alignItems: 'center', marginTop: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  time: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 32,
    fontVariant: ['tabular-nums'], minWidth: 96, textAlign: 'center',
  },
  rule: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 4 },
  done: {
    backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16,
  },
  doneText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
});
