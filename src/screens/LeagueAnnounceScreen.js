import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import DateField from '../components/DateField';
import CourseTeePicker from '../components/league/CourseTeePicker';
import LeagueShareSheet from '../components/league/LeagueShareSheet';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useT } from '../i18n';
import { announceLeagueCard } from '../store/leagueStore';
import { POST_WINDOW_HOURS, postByFor } from '../store/leagueRules';
import { clockWithDay } from '../components/league/DeadlineLine';
import {
  courseSnapshot, courseProblem, buildTeeTime, localDateText, localTimeText,
} from '../store/leagueOffApp';
import { leagueErrorText } from '../lib/leagueErrorText';

// Announce a card played without the app: course, tee and tee time. The group
// is notified now; the score is added after the round. The server stamps the
// announcement time, so there is no grace period: a late announcement is
// flagged there, and any server refusal is shown as is.
export default function LeagueAnnounceScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const leagueId = route?.params?.leagueId;
  const { user } = useAuth();
  const t = useT();
  const { data } = useLeague(navigation, leagueId);

  const [pick, setPick] = useState({ course: null, tee: null });
  const [dateText, setDateText] = useState(() => localDateText());
  const [timeText, setTimeText] = useState(() => localTimeText());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // After announcing: what the "Tell the group chat" message says.
  const [announced, setAnnounced] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // The post-by time for the tee time picked so far (null until it is valid).
  // A tee time already gone (beyond the server's 15 minutes of slack) can't be
  // announced, so it gets the way out instead of a deadline.
  const deadlineText = useMemo(() => {
    const tee = buildTeeTime(dateText, timeText);
    const postBy = postByFor(tee);
    if (!postBy) return null;
    if (new Date(tee).getTime() < Date.now() - 15 * 60000) return 'past';
    const sameDay = postBy.toDateString() === new Date(tee).toDateString();
    return clockWithDay(postBy, sameDay ? postBy : new Date());
  }, [dateText, timeText]);

  async function announce() {
    const problem = courseProblem(pick.course, pick.tee ?? pick.course);
    if (problem) { setError(problem); return; }
    const teeTime = buildTeeTime(dateText, timeText);
    if (!teeTime) { setError(t('league.announce.needDate')); return; }
    setError(null);
    setBusy(true);
    try {
      const course = courseSnapshot(pick.course, pick.tee);
      const res = await announceLeagueCard({
        leagueId,
        source: 'offapp',
        course,
        teeTime,
      });
      if (mountedRef.current) {
        setAnnounced({
          month: res.month, teeTime, postBy: res.postBy ?? postByFor(teeTime)?.toISOString() ?? null, course: course?.name ?? null,
        });
      }
    } catch (e) {
      if (mountedRef.current) setError(leagueErrorText(e) || t('league.announce.failed'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  if (announced) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} />
          <Text style={s.headerTitle}>{t('league.announce.title')}</Text>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={[s.text, { marginBottom: 16 }]} accessibilityRole="alert">{t('league.share.announced')}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => setShareOpen(true)} activeOpacity={0.8} accessibilityRole="button">
            <Text style={s.primaryText}>{t('league.share.tellGroup')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} accessibilityRole="button">
            <Text style={s.linkText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </ScrollView>
        <LeagueShareSheet
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          leagueId={leagueId}
          snapshot={data}
          meId={user?.id ?? null}
          mode="announce"
          announce={{ ...announced, leagueName: data?.league?.name ?? route?.params?.name ?? '' }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} />
        <Text style={s.headerTitle}>{t('league.announce.title')}</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={[s.text, { marginBottom: 8 }]}>
          {t('league.announce.intro')}
        </Text>

        <CourseTeePicker navigation={navigation} value={pick} onChange={(p) => { setPick(p); setError(null); }} />

        <Text style={s.fieldLabel}>{t('league.announce.dateTime')}</Text>
        <DateField
          label={t('league.announce.dateTime')}
          value={dateText}
          onChange={(v) => { setDateText(v); setError(null); }}
          time={timeText}
          onTimeChange={(v) => { setTimeText(v); setError(null); }}
          min={localDateText()}
        />

        {!!deadlineText && (
          <Text style={[s.text, { marginTop: 8 }]}>
            {deadlineText === 'past'
              ? t('league.announce.past')
              : t('league.announce.deadline', { time: deadlineText, hours: POST_WINDOW_HOURS })}
          </Text>
        )}

        {!!error && <Text style={s.errorText} accessibilityRole="alert">{error}</Text>}

        <TouchableOpacity
          style={[s.primaryBtn, busy && s.primaryBtnOff]}
          onPress={announce}
          disabled={busy}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={theme.text.inverse} /> : <Text style={s.primaryText}>{t('league.announce.button')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.linkBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.linkText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
