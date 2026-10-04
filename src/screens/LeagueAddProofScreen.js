import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Image, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { makeOffAppStyles } from '../components/league/offAppStyles';
import { useTheme } from '../theme/ThemeContext';
import { useLeague } from '../hooks/useLeague';
import { pickMedia } from '../lib/mediaCapture';
import { formatPoints } from '../store/leagueView';
import {
  proofSummary, dayLabel, submitOffAppCard, clearDraft,
} from '../store/leagueOffApp';

function findCard(data, cardId) {
  if (!data || !cardId) return null;
  for (const cards of Object.values(data.cardsByMonth ?? {})) {
    const hit = cards.find((c) => c.id === cardId);
    if (hit) return hit;
  }
  return null;
}

// Last step of an off-app card: the signed card photo (or an official result),
// the marker's name, then Submit. Submitting runs submit -> upload -> attach;
// a failed step is retried from where it stopped, so the card is never created
// twice. With `resume` (a submitted card that never got its proof) only the
// upload and attach run.
// With `source: 'app'` (from LeagueValidate) the card was played in the app and
// is already submitted: like `resume`, only the upload and attach run, the
// summary comes from the card, and `kind` ('photo' | 'official') presets the
// official toggle.
export default function LeagueAddProofScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeOffAppStyles(theme);
  const {
    leagueId, cardId = null, snapshot = null, playedOn = null, strokes = null,
    leagueHandicap = 0, resume = false, source = 'offapp', kind = 'photo',
  } = route?.params ?? {};
  const fromCard = resume || source === 'app';
  const { data } = useLeague(navigation, fromCard ? leagueId : null);

  const [photoUri, setPhotoUri] = useState(null);
  const [markerName, setMarkerName] = useState('');
  const [official, setOfficial] = useState(kind === 'official');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const progress = useRef(fromCard ? { cardId, submitted: true } : {});
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const summary = useMemo(() => {
    if (fromCard) {
      const c = findCard(data, cardId);
      if (!c) return null;
      return {
        line: [c.course?.name, dayLabel(c.playedOn), c.points != null ? `${formatPoints(c.points)} pts` : null,
          c.gross != null ? `gross ${c.gross}` : null].filter(Boolean).join(' · '),
      };
    }
    return proofSummary({ snapshot, playedOn, strokes, leagueHandicap });
  }, [fromCard, data, cardId, snapshot, playedOn, strokes, leagueHandicap]);

  async function capture(source) {
    setError(null);
    try {
      const asset = await pickMedia({ source, mediaTypes: 'photo' });
      if (asset?.localUri && mountedRef.current) {
        setPhotoUri(asset.localUri);
        progress.current.path = null; // a new photo must be uploaded again
      }
    } catch (e) {
      if (mountedRef.current) setError(e?.message || 'Could not get the photo.');
    }
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await submitOffAppCard({
        leagueId,
        cardId,
        snapshot,
        playedOn,
        strokes,
        gross: summary.gross,
        points: summary.points,
        playingHandicap: summary.playingHandicap,
        photoUri,
        kind: official ? 'official' : 'photo',
        markerName: markerName.trim() || null,
        progress: progress.current,
      });
      await clearDraft(leagueId, cardId);
      if (mountedRef.current) navigation.navigate('LeagueBoard', { leagueId });
    } catch (e) {
      if (mountedRef.current) setError(e?.message || 'Could not submit the card.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const canSubmit = !!photoUri && !!summary && !busy;
  const retrying = !!progress.current.submitted && !!error;
  const photoLabel = official ? 'Photo of the official result' : 'Photo of the signed paper card';

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
        <Text style={s.headerTitle}>Add proof</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {!!summary && <Text style={[s.cardTitle, { marginBottom: 12 }]}>{summary.line}</Text>}

        <Text style={s.fieldLabel}>{photoLabel}</Text>
        {!!photoUri && <Image source={{ uri: photoUri }} style={s.preview} resizeMode="cover" accessibilityLabel="Photo preview" />}
        <View style={[s.row, { marginBottom: 8 }]}>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={s.secondaryBtn} onPress={() => capture('camera')} activeOpacity={0.7} accessibilityRole="button">
              <Feather name="camera" size={16} color={theme.text.secondary} />
              <Text style={s.secondaryText}>{photoUri ? 'Retake' : 'Take photo'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.secondaryBtn} onPress={() => capture('library')} activeOpacity={0.7} accessibilityRole="button">
            <Feather name="image" size={16} color={theme.text.secondary} />
            <Text style={s.secondaryText}>From gallery</Text>
          </TouchableOpacity>
        </View>

        {!official && (
          <>
            <Text style={s.fieldLabel}>Marker's name</Text>
            <TextInput
              style={s.input}
              value={markerName}
              onChangeText={setMarkerName}
              placeholder="Who signed your card"
              placeholderTextColor={theme.text.muted}
              accessibilityLabel="Marker's name"
            />
          </>
        )}

        <View style={[s.card, { marginTop: 8 }]}>
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>It was an official tournament</Text>
              <Text style={s.hint}>Add the result instead of a signed card.</Text>
            </View>
            <Switch
              value={official}
              onValueChange={setOfficial}
              trackColor={{ true: theme.accent.primary }}
              accessibilityLabel="It was an official tournament"
            />
          </View>
        </View>

        <Text style={s.hint}>The group sees the photo next to your card.</Text>
        {!!error && <Text style={s.errorText} accessibilityRole="alert">{error}</Text>}

        <TouchableOpacity
          style={[s.primaryBtn, !canSubmit && s.primaryBtnOff]}
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          {busy ? <ActivityIndicator color={theme.text.inverse} /> : (
            <Text style={s.primaryText}>{retrying ? 'Retry' : 'Submit card'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
