import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import DateField from '../components/DateField';
import CourseTeePicker from '../components/league/CourseTeePicker';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import { ScorecardTable } from '../components/scorecard/GridView';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { scoreCard } from '../store/leagueRules';
import { parseIsoDate } from '../store/leagueDraft';
import { lastDayOfMonth } from '../lib/calendar';
import {
  courseSnapshot, courseFromSnapshot, courseProblem, scoresComplete, applyStrokeText,
  loadDraft, saveDraft, localDateText, timeLabel,
} from '../store/leagueOffApp';

const ME = 'me';
const minIso = (a, b) => (a < b ? a : b);

function findCard(data, cardId) {
  if (!data || !cardId) return null;
  for (const cards of Object.values(data.cardsByMonth ?? {})) {
    const hit = cards.find((c) => c.id === cardId);
    if (hit) return hit;
  }
  return null;
}

// Type the 18 holes of a card played without the app, into the existing
// scorecard grid (Strokes mode, one editable row). With a `cardId` it is the
// card announced earlier; without, the member adds a card nobody announced in
// the app and picks the course here. The draft lives in AsyncStorage per card.
export default function LeagueAddScoreScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeOffAppStyles(theme);
  const leagueId = route?.params?.leagueId;
  const cardId = route?.params?.cardId ?? null;
  const { data, loading, error } = useLeague(navigation, leagueId);

  const [strokes, setStrokes] = useState({});
  const [pick, setPick] = useState({ course: null, tee: null });
  const [dateText, setDateText] = useState(() => localDateText());
  const [problem, setProblem] = useState(null);
  const [draftReady, setDraftReady] = useState(false);
  const dateSeeded = useRef(false);

  const card = findCard(data, cardId);
  const member = data?.members.find((m) => m.userId === user?.id) ?? null;
  const leagueHandicap = card?.leagueHandicap ?? member?.leagueHandicap ?? 0;

  // Restore the draft once.
  useEffect(() => {
    let alive = true;
    loadDraft(leagueId, cardId).then((d) => {
      if (!alive) return;
      if (d?.strokes) setStrokes(d.strokes);
      if (!cardId && d?.pick) setPick(d.pick);
      if (d?.dateText) { setDateText(d.dateText); dateSeeded.current = true; }
      setDraftReady(true);
    });
    return () => { alive = false; };
  }, [leagueId, cardId]);

  // An announced card brings its own day, unless the draft already has one.
  useEffect(() => {
    if (draftReady && card?.playedOn && !dateSeeded.current) {
      dateSeeded.current = true;
      setDateText(String(card.playedOn).slice(0, 10));
    }
  }, [draftReady, card?.playedOn]);

  useEffect(() => {
    if (!draftReady) return;
    saveDraft(leagueId, cardId, { strokes, pick: cardId ? null : pick, dateText });
  }, [draftReady, leagueId, cardId, strokes, pick, dateText]);

  const snapshot = useMemo(() => {
    if (cardId) return card?.course ?? null;
    return pick.course ? courseSnapshot(pick.course, pick.tee) : null;
  }, [cardId, card?.course, pick]);
  const course = useMemo(() => (snapshot ? courseFromSnapshot(snapshot) : null), [snapshot]);

  const playingHandicap = course
    ? scoreCard({ holes: strokes, course, leagueHandicap, tee: course.tee }).playingHandicap
    : 0;
  // A card counts for the month it was played: the card's month, or this one.
  const playMonthStart = `${(card?.month ? String(card.month) : localDateText()).slice(0, 7)}-01`;
  const playedOn = parseIsoDate(dateText);
  const ready = !!course && !courseProblem(course) && scoresComplete(strokes) && !!playedOn;

  function next() {
    setProblem(null);
    if (!playedOn) { setProblem('Pick the date you played.'); return; }
    navigation.navigate('LeagueAddProof', {
      leagueId, cardId, snapshot, playedOn, strokes, leagueHandicap,
    });
  }

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle}>{cardId ? 'Add your score' : 'Add a card'}</Text>
    </View>
  );

  if (cardId && !card) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <Text style={s.text}>{error || 'This card is no longer available.'}</Text>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const noteText = cardId
    ? `League card · announced ${timeLabel(card.announcedAt)}`
    : 'Not announced in the app';

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.note}>
          <Feather name="flag" size={14} color={theme.text.secondary} />
          <Text style={s.noteText}>{noteText}</Text>
        </View>

        {!cardId && <CourseTeePicker navigation={navigation} value={pick} onChange={setPick} />}

        <Text style={s.fieldLabel}>Date played</Text>
        <DateField
          label="Date played"
          value={dateText}
          onChange={setDateText}
          min={playMonthStart}
          max={minIso(localDateText(), lastDayOfMonth(playMonthStart))}
        />

        {course && (
          <>
            {!!courseProblem(course) && <Text style={s.errorText}>{courseProblem(course)}</Text>}
            <ScorecardTable
              round={{
                holes: course.holes,
                courseName: course.name,
                scoringMode: 'stableford',
                playerHandicaps: { [ME]: playingHandicap },
              }}
              players={[{ id: ME, name: 'You', handicap: playingHandicap }]}
              scores={{ [ME]: strokes }}
              onSetScore={(_playerId, holeNumber, text) => setStrokes((prev) => applyStrokeText(prev, holeNumber, text))}
              editable={() => true}
              mode="stableford"
              meId={ME}
            />
          </>
        )}

        {!!problem && <Text style={s.errorText}>{problem}</Text>}
        <TouchableOpacity
          style={[s.primaryBtn, !ready && s.primaryBtnOff]}
          onPress={next}
          disabled={!ready}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
        >
          <Text style={s.primaryText}>Next: add proof</Text>
        </TouchableOpacity>
        {!ready && !!course && (
          <Text style={[s.hint, { textAlign: 'center', marginTop: 8 }]}>
            Every hole needs a whole number of strokes, 1 to 30.
          </Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
