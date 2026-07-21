import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadTournament, subscribeTournamentChanges, DEFAULT_SETTINGS, buildTeamsForMode,
  normalizeRoundHandicaps, isRoundComplete, tournamentNounCapitalized,
  getActiveTournamentSnapshot, getTournamentSnapshot, getTournament,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { normalizeRoundNotes, roundNoteText } from '../store/roundNotes';
import { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
import { parseHandicapIndex } from '../lib/handicap';
import { shouldHandleStoreChange } from '../lib/navigationFocus';
import {
  canRemoveRoundFromEditor,
  roundRemovalConfirmation,
} from './editTournamentRoundDeletion';

async function confirmDialog(title, message, confirmLabel = 'Remove') {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

function editablePlayersFromTournament(t) {
  return (t?.players ?? []).map((p) => ({ ...p, handicap: String(p.handicap) }));
}

function editableSettingsFromTournament(t) {
  const settings = t?.settings ?? DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    bestBallValue: String((settings ?? DEFAULT_SETTINGS).bestBallValue ?? 1),
    worstBallValue: String((settings ?? DEFAULT_SETTINGS).worstBallValue ?? 1),
  };
}

function editableRoundsFromTournament(t) {
  return (t?.rounds ?? []).map((r) => {
    const normalized = normalizeRoundHandicaps(r, t.players ?? []);
    return {
      ...normalized,
      holes: [...(normalized.holes ?? [])],
      notes: normalizeRoundNotes(normalized.notes),
      playerHandicaps: Object.fromEntries(
        (t.players ?? []).map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
      ),
      manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
    };
  });
}

// The last round-note text this screen has EMITTED (or been seeded with from
// a load), keyed by round id. The note.set dedup gates on this — NOT on the
// tournament STATE — because tournamentRef lags the autosave (it's only
// updated by initialLoad/mergeLoad, never by the debounced save effect). If
// the dedup diffed against loaded state instead, a clear-after-save
// (load '' → type "Wet" → emit → delete back to '') would read prev='' /
// next='' and suppress the clear, so the server keeps "Wet" and the next
// load silently re-fills the field — a real data-loss bug. Seeding from the
// loaded value means a genuine revert-to-loaded-value still emits.
function emittedNotesSeed(t) {
  const seed = {};
  for (const r of t?.rounds ?? []) {
    seed[r.id] = normalizeRoundNotes(r.notes).round ?? '';
  }
  return seed;
}

export default function EditTournamentScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  // Edit the tournament the user navigated into (route param), not the global
  // active one. Falls back to the active tournament for legacy callers that
  // navigate here without params.
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const initialTournament = useMemo(
    () => (routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()),
    [routeTournamentId],
  );

  const [tournament, setTournament] = useState(() => initialTournament);
  const [players, setPlayers] = useState(() => editablePlayersFromTournament(initialTournament));
  const [rounds, setRounds] = useState(() => editableRoundsFromTournament(initialTournament));
  const [settings, setSettings] = useState(() => editableSettingsFromTournament(initialTournament));
  const [name, setName] = useState(() => initialTournament?.name ?? '');
  // 'idle' | 'saving' | 'saved' | 'error' — drives the small status pill.
  const [saveState, setSaveState] = useState('idle');
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const isFirstRender = useRef(true);
  // Last note text emitted (or seeded from a load) per round id — the dedup
  // baseline for note.set. See emittedNotesSeed above.
  const lastEmittedNotesRef = useRef(emittedNotesSeed(initialTournament));
  // Last tournament name EMITTED (or seeded from a load) — same dedup policy
  // as lastEmittedNotesRef above, so unrelated edits don't re-push an
  // unchanged name on every autosave.
  const lastEmittedNameRef = useRef(initialTournament?.name ?? '');
  // Set when a subscription-driven reload pushes fresh display-only data
  // into local state so the debounced save effect doesn't echo it back.
  const skipNextSaveRef = useRef(false);

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      const t = routeTournamentId ? await getTournament(routeTournamentId) : await loadTournament();
      if (cancelled) return;
      // Reset the note-dedup baseline to the freshly loaded server values
      // BEFORE the load-triggered autosave runs (debounced 400ms later), so
      // that save doesn't spuriously re-emit an unchanged note.
      lastEmittedNotesRef.current = emittedNotesSeed(t);
      lastEmittedNameRef.current = t?.name ?? '';
      setTournament(t);
      setPlayers(editablePlayersFromTournament(t));
      setSettings(editableSettingsFromTournament(t));
      setRounds(editableRoundsFromTournament(t));
      setName(t?.name ?? '');
    }

    // On subscription-driven reloads we only refresh display-only fields
    // (player names) so ongoing local edits are preserved. Any change that
    // originates from external writes (library rename, course slope
    // propagation, another screen's save) should not discard the user's
    // in-flight handicap/course-name/notes edits on this screen.
    async function mergeLoad() {
      const t = routeTournamentId ? await getTournament(routeTournamentId) : await loadTournament();
      if (cancelled || !t) return;
      // Re-seed the note-dedup baseline to the server's latest note per round.
      // mergeLoad deliberately does NOT overwrite the editor's in-flight note
      // text (only player names), so if the user's local note differs from
      // the reseeded baseline the next autosave still emits it — conservative
      // (may re-emit, never suppresses a needed write).
      lastEmittedNotesRef.current = emittedNotesSeed(t);
      lastEmittedNameRef.current = t?.name ?? '';
      setTournament(t);
      setPlayers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const fresh = t.players.find((x) => x.id === p.id);
          if (fresh && fresh.name !== p.name) {
            changed = true;
            return { ...p, name: fresh.name };
          }
          return p;
        });
        if (!changed) return prev;
        skipNextSaveRef.current = true;
        return next;
      });
    }

    initialLoad();
    const unsub = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) mergeLoad();
    });
    return () => { cancelled = true; unsub(); };
  }, [navigation, routeTournamentId]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveState('saving');
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const builtRounds = rounds.map((r) => ({
          ...r,
          playerHandicaps: Object.fromEntries(
            Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
          ),
          manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        }));

        // Round-level fields (course/holes/tees/handicaps, and brand-new
        // rounds from addRound) go through round.upsert — a whole-round
        // upsert, since a tournament.updateProfile patch only ever reaches
        // tournaments.props/name/kind (see patch_game_tournament), never the
        // normalized game_rounds rows. Tournament-wide settings still go
        // through tournament.updateProfile.
        //
        // isNew tells mutationWrites.js whether this round already exists on
        // the server: this screen deliberately never refreshes round-level
        // fields while open, so builtRounds[i] can be stale for an EXISTING
        // round — mutationWrites.js patches only the fields this screen owns
        // in that case (never the whole stale body) rather than clobbering a
        // concurrent device's pairs.set/round.reveal/handicap.set/etc. A
        // round this screen just created via addRound (not yet in
        // `current.rounds`, the pre-edit snapshot) is genuinely new and safe
        // to upsert in full.
        //
        // Round notes are deliberately NOT part of round.upsert's payload
        // (mutationWrites.js's ROUND_UPSERT_OWNED_FIELDS excludes `notes`):
        // get_game_tournament reassembles notes from game_round_notes, not
        // game_rounds.body, so a body patch would be a dead write — the
        // exact bug this fixes (Task 11 review finding C: editor notes never
        // reached peers). Each round's note is instead pushed through its own
        // note.set mutation, chained in the same sequential `current` pass so
        // it can't race the round.upsert call for the same round.
        //
        // The debounce fires on ANY field edit (course name, a handicap, …),
        // so note.set is emitted ONLY when this round's note text differs
        // from the last value we EMITTED for it (lastEmittedNotesRef, seeded
        // from the loaded value). Gating on the last-emitted value — NOT the
        // tournament STATE, which lags this effect — is what lets a
        // revert-to-loaded-value still emit: load '' → type "Wet" → emit →
        // delete back to '' must re-emit '' to clear the server row, or the
        // next load silently re-fills the field (data loss). Without any
        // dedup, every autosave would re-push an unchanged note for every
        // round, doubling round RPC/queue traffic.
        let current = tournamentRef.current;
        for (let i = 0; i < builtRounds.length; i++) {
          const built = builtRounds[i];
          const isNew = !current.rounds?.some((r) => r.id === built.id);
          const nextNote = normalizeRoundNotes(built.notes).round ?? '';
          const lastEmittedNote = lastEmittedNotesRef.current[built.id] ?? '';
          current = await mutate(current, {
            type: 'round.upsert', roundId: built.id, roundIndex: i, round: built, isNew,
          });
          if (nextNote !== lastEmittedNote) {
            lastEmittedNotesRef.current[built.id] = nextNote;
            current = await mutate(current, {
              type: 'note.set',
              scope: 'round',
              roundId: built.id,
              text: nextNote,
            });
          }
        }
        // The tournament name rides the same updateProfile patch, but only
        // when the trimmed value is non-empty (name is never-clearable:
        // mutate.js and the server both skip a null, and an empty string
        // would be written verbatim) AND differs from the last
        // emitted/seeded value.
        const trimmedName = name.trim();
        const includeName = !!trimmedName && trimmedName !== lastEmittedNameRef.current;
        await mutate(current, {
          type: 'tournament.updateProfile',
          patch: {
            ...(includeName ? { name: trimmedName } : {}),
            settings: {
              ...settings,
              bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
              worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
            },
          },
        });
        if (includeName) lastEmittedNameRef.current = trimmedName;
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        const msg = err?.message ?? 'Could not save changes';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Save failed', msg);
      }
    }, 400);
  }, [rounds, settings, name]);

  // Keep the scoring mode valid for the current player count. An existing
  // tournament loaded with e.g. bestball but only 3 players gets nudged back
  // to a safe mode rather than silently saving an unplayable configuration.
  useEffect(() => {
    if (players.length === 0) return;
    if (!isScoringModeAllowed(settings.scoringMode, players.length)) {
      setSettings((prev) => ({ ...prev, scoringMode: fallbackScoringMode(players.length) }));
    }
  }, [players.length, settings.scoringMode]);

  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes: patch.holes, tees: patch.tees };
      return next;
    });
  }, []);

  function updateCourseName(roundIndex, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], courseName: value };
      return next;
    });
  }

  function addRound() {
    setRounds((prev) => {
      const builtPlayers = players.map((p) => {
        const r = parseHandicapIndex(p.handicap);
        return { ...p, handicap: r.ok ? r.value : 0 };
      });
      // buildTeamsForMode covers every team shape (2x2 / 3+1 / 1x4) and
      // falls back to one singleton pair per player for solo modes.
      const mode = settings?.scoringMode;
      // With fixedTeams on, copy pairs from the latest existing round whose
      // pairs cover exactly the current roster (same member ids), instead
      // of building a fresh (re-randomized) set — keeps the new round's
      // teams consistent with the rest of the tournament. Falls back to a
      // fresh build when no round's pairs match the current roster.
      const rosterIds = builtPlayers.map((p) => p.id).sort().join(',');
      let pairs = null;
      if (settings?.fixedTeams) {
        for (let i = prev.length - 1; i >= 0; i--) {
          const pairIds = (prev[i].pairs ?? []).flat().map((p) => p.id).sort().join(',');
          if (pairIds && pairIds === rosterIds) {
            pairs = prev[i].pairs.map((pr) => [...pr]);
            break;
          }
        }
      }
      if (!pairs) pairs = buildTeamsForMode(mode, builtPlayers);
      const newRound = {
        id: `r${Date.now()}`,
        courseName: '',
        holes: defaultHoles(),
        tees: [],
        playerTees: {},
        playerHandicaps: Object.fromEntries(builtPlayers.map((p) => [p.id, String(p.handicap)])),
        manualHandicaps: {},
        pairs,
        scores: {},
      };
      return [...prev, newRound];
    });
  }

  async function removeRound(index) {
    const target = rounds[index];
    const confirmation = roundRemovalConfirmation({
      round: target,
      roundIndex: index,
      players,
      tournament: { ...tournamentRef.current, rounds },
    });
    const ok = await confirmDialog(
      confirmation.title,
      confirmation.message,
      confirmation.confirmLabel,
    );
    if (!ok) return;
    // Persist the deletion through mutate() so the round.remove mutation is
    // queued and the round drops out of the local blob immediately — the
    // repo-backed read path (row-based, not blob-merged) never resurrects a
    // deleted round from a stale remote copy.
    if (target?.id && tournamentRef.current) {
      try {
        const updated = await mutate(tournamentRef.current, {
          type: 'round.remove',
          roundId: target.id,
        });
        tournamentRef.current = updated;
        // Skip the next debounced save: mutate already wrote local + queued
        // the sync, and the spread in the save effect would otherwise echo
        // the deletion as a redundant write.
        skipNextSaveRef.current = true;
        setTournament(updated);
      } catch (_) {
        // Fall through to local-only filter so the UI still updates; the
        // debounced save will then push a truncated rounds list (without a
        // tombstone, so the historical bug shape can recur). This branch is
        // only hit if mutate itself throws, which is rare.
      }
    }
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  function updateNotes(roundIndex, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        notes: { ...normalizeRoundNotes(next[roundIndex].notes), round: value },
      };
      return next;
    });
  }

  if (!tournament) return null;

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <IconButton icon="chevron-left" size={22} color={theme.accent.primary} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Edit Tournament</Text>
        {saveState === 'idle' ? (
          <View style={{ width: 64 }} />
        ) : (
          <View style={[
            s.savePill,
            saveState === 'error' && s.savePillError,
            saveState === 'saved' && s.savePillSaved,
          ]}>
            <Feather
              name={saveState === 'error' ? 'alert-circle' : saveState === 'saved' ? 'check' : 'loader'}
              size={11}
              color={saveState === 'error' ? theme.destructive : theme.text.muted}
              style={{ marginRight: 4 }}
            />
            <Text style={[s.savePillText, saveState === 'error' && s.savePillTextError]}>
              {saveState === 'error' ? 'Save failed' : saveState === 'saved' ? 'Saved' : 'Saving…'}
            </Text>
          </View>
        )}
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        {/* Tournament / game name — editable at any time, including finished. */}
        <View style={s.roundHeader}>
          <Text style={s.sectionTitle}>{`${tournamentNounCapitalized(tournament)} Name`}</Text>
        </View>
        <View style={s.roundCard}>
          <TextInput
            style={s.input}
            placeholder={`${tournamentNounCapitalized(tournament)} name`}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Per-round playing handicaps */}
        {rounds.map((r, ri) => {
          // Finished rounds are score-edit locked, but can still be removed
          // from history when another round remains in the tournament.
          const finished = isRoundComplete(r, players) || !!tournament?.finishedAt;
          const canRemove = canRemoveRoundFromEditor({ ...tournament, rounds }, ri);
          return (
          <View key={r.id}>
            <View style={s.roundHeader}>
              <Text style={s.sectionTitle}>Round {ri + 1}{r.tees?.length ? `  --  ${r.tees.length} tees` : ''}</Text>
              {canRemove && (
                <TouchableOpacity onPress={() => removeRound(ri)} style={s.removeBtn}>
                  <Feather name="trash-2" size={14} color={theme.destructive} style={{ marginRight: 4 }} />
                  <Text style={s.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={s.roundCard}>
              <TextInput
                style={s.input}
                placeholder="Course name"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                value={r.courseName}
                onChangeText={(v) => updateCourseName(ri, v)}
              />
              {r.courseId ? (
                <Text style={s.courseNameHint}>
                  Renames this round only — the course saved in your library is unchanged.
                </Text>
              ) : null}
              <TextInput
                style={[s.input, s.notesInput]}
                placeholder="Round notes..."
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={roundNoteText(r.notes)}
                onChangeText={(v) => updateNotes(ri, v)}
              />
              {!finished && (
                <TouchableOpacity
                  style={s.editHolesBtn}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: ri,
                      courseName: r.courseName,
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      onSave: handleHolesSaved,
                      courseId: r.courseId ?? null,
                    })
                  }
                >
                  <Feather name="edit-3" size={14} color={theme.accent.primary} style={{ marginRight: 8 }} />
                  <Text style={s.editHolesBtnText}>
                    Edit Holes & Tees
                  </Text>
                  <View style={s.parBadge}>
                    <Text style={s.parBadgeText}>Par {r.holes.reduce((sum, h) => sum + h.par, 0)}</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
          );
        })}

        <View>
          <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
            <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.addRoundBtnText}>Add Round</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  savePill: {
    flexDirection: 'row', alignItems: 'center',
    minWidth: 64, justifyContent: 'center',
    backgroundColor: theme.bg.secondary,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  savePillSaved: { borderColor: theme.accent.primary + '55' },
  savePillError: { borderColor: theme.destructive, backgroundColor: theme.destructive + '15' },
  savePillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted },
  savePillTextError: { color: theme.destructive },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8, flex: 1,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  courseNameHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: -2, marginBottom: 10,
  },
  roundHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24, marginBottom: 8,
  },
  removeBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10 },
  removeBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 13 },
  roundCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, marginBottom: 8, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  notesInput: { minHeight: 60, textAlignVertical: 'top', marginTop: 8 },
  editHolesBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 12, alignItems: 'center', marginTop: 10,
    flexDirection: 'row', justifyContent: 'center',
  },
  editHolesBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  parBadge: {
    backgroundColor: theme.accent.light, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  parBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  addRoundBtn: {
    borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4,
    flexDirection: 'row', justifyContent: 'center',
  },
  addRoundBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  modeRow: { gap: 8 },
  modeBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, alignItems: 'center', marginBottom: 6,
    flexDirection: 'row', justifyContent: 'center',
  },
  modeBtnActive: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  modeBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14 },
  modeBtnTextActive: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
  },
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, alignItems: 'center', gap: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  valueLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  valueInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 56, textAlign: 'center', fontSize: 22,
    fontFamily: 'PlusJakartaSans-ExtraBold', padding: 8,
  },
  valueSuffix: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
});
