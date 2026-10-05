import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import DateField from '../components/DateField';
import CourseTeePicker from '../components/league/CourseTeePicker';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import { useTheme } from '../theme/ThemeContext';
import { announceLeagueCard } from '../store/leagueStore';
import {
  courseSnapshot, courseProblem, buildTeeTime, localDateText, localTimeText,
} from '../store/leagueOffApp';

// Announce a card played without the app: course, tee and tee time. The group
// is notified now; the score is added after the round. The server stamps the
// announcement time, so there is no grace period: a late announcement is
// flagged there, and any server refusal is shown as is.
export default function LeagueAnnounceScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const leagueId = route?.params?.leagueId;

  const [pick, setPick] = useState({ course: null, tee: null });
  const [dateText, setDateText] = useState(() => localDateText());
  const [timeText, setTimeText] = useState(() => localTimeText());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function announce() {
    const problem = courseProblem(pick.course);
    if (problem) { setError(problem); return; }
    const teeTime = buildTeeTime(dateText, timeText);
    if (!teeTime) { setError('Pick a date and a tee time.'); return; }
    setError(null);
    setBusy(true);
    try {
      await announceLeagueCard({
        leagueId,
        source: 'offapp',
        course: courseSnapshot(pick.course, pick.tee),
        teeTime,
      });
      if (mountedRef.current) navigation.goBack();
    } catch (e) {
      if (mountedRef.current) setError(e?.message || 'Could not announce the card.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
        <Text style={s.headerTitle}>Announce a card</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={[s.text, { marginBottom: 8 }]}>
          Announce before your first shot. Your group is notified now; you'll add the score after the round.
        </Text>

        <CourseTeePicker navigation={navigation} value={pick} onChange={setPick} />

        <Text style={s.fieldLabel}>Date and tee time</Text>
        <DateField
          label="Date and tee time"
          value={dateText}
          onChange={setDateText}
          time={timeText}
          onTimeChange={setTimeText}
          min={localDateText()}
        />

        {!!error && <Text style={s.errorText} accessibilityRole="alert">{error}</Text>}

        <TouchableOpacity
          style={[s.primaryBtn, busy && s.primaryBtnOff]}
          onPress={announce}
          disabled={busy}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={theme.text.inverse} /> : <Text style={s.primaryText}>Announce card</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.linkBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.linkText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
