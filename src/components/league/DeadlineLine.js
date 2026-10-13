import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { deadlineInfo } from '../../store/leagueRules';
import { dayLabel, timeLabel } from '../../store/leagueOffApp';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// 'today' | 'tomorrow' | 'Saturday' (within a week) | 'Sat 4 Oct'.
export function dayWord(date, now = new Date()) {
  const diff = Math.round((midnight(new Date(date)) - midnight(new Date(now))) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) return WEEKDAYS[new Date(date).getDay()];
  return dayLabel(date);
}

// '18:30', with the day when it isn't today ('02:15 tomorrow'); withToday adds 'today'.
export function clockWithDay(date, now = new Date(), withToday = false) {
  const day = dayWord(date, now);
  return [timeLabel(date), day === 'today' && !withToday ? null : day].filter(Boolean).join(' ');
}

// '5 h 22 m'; minutes only under an hour.
export function countdownText(msLeft) {
  const mins = Math.max(0, Math.floor(msLeft / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${mins % 60} m` : `${mins} m`;
}

function spokenCountdown(msLeft) {
  const mins = Math.max(0, Math.floor(msLeft / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return [h > 0 ? part(h, 'hour') : null, h === 0 || m > 0 ? part(m, 'minute') : null].filter(Boolean).join(' ');
}

// The deadline to post a live card: clock, "Post by 18:30", and a minute-level
// countdown. Under 2 hours it turns amber and says "left", so colour is never
// the only signal. Renders nothing for a card with no deadline. Pass the
// screen's `now` so every countdown on it ticks together.
export default function DeadlineLine({ card, now: nowProp, style }) {
  const { theme } = useTheme();
  const tick = useMinuteClock();
  const now = nowProp ?? tick;
  const info = deadlineInfo(card, now);
  if (!info || info.msLeft <= 0) return null;
  const color = info.urgent ? semantic.warning[theme.isDark ? 'dark' : 'light'] : theme.text.secondary;
  const countdown = `${countdownText(info.msLeft)}${info.urgent ? ' left' : ''}`;
  const label = `Post your score by ${clockWithDay(info.postBy, now, true)}, ${spokenCountdown(info.msLeft)} left`;
  return (
    <View style={[s.row, style]} accessible accessibilityLabel={label}>
      <Feather name="clock" size={14} color={color} />
      <Text style={[s.text, { color }]}>
        {`Post by ${clockWithDay(info.postBy, now)} · `}
        <Text style={s.count}>{countdown}</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
  count: { fontFamily: 'PlusJakartaSans-Bold', fontVariant: ['tabular-nums'] },
});
