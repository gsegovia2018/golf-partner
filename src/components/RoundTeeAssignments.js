import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { calcPlayingHandicap, lastTeeForPlayerOnCourse } from '../store/tournamentStore';
import { middleTee, resolveTeeForPlayer } from '../store/tees';

// Common golf tee colours, matched against the tee label by keyword —
// covers both English ("White") and Spanish ("Blancas") naming, singular
// or plural, since course tee labels come from free-text course setup
// (see TeesEditor.js) and this group's course data is Spanish-labeled.
const TEE_COLOR_KEYWORDS = [
  { match: /blanc|white/, color: '#FFFFFF' },
  { match: /amarill|yellow/, color: '#F2C200' },
  { match: /roj|\bred\b/, color: '#D7372E' },
  { match: /azul|blue/, color: '#2F6FB5' },
  { match: /negr|black/, color: '#23262B' },
  { match: /dorad|gold/, color: '#C9A227' },
  { match: /verd|green/, color: '#2F7D5B' },
  { match: /naranj|orange/, color: '#E5862B' },
  { match: /plat(a|ead)|silver/, color: '#B8BCC2' },
  { match: /bronc|bronze/, color: '#A9712E' },
];

// Resolve a tee label to a swatch colour, or null when unknown.
function teeColor(label) {
  const norm = String(label || '').trim().toLowerCase();
  if (!norm) return null;
  const found = TEE_COLOR_KEYWORDS.find((k) => k.match.test(norm));
  return found ? found.color : null;
}

// Up to two uppercase initials for a player's avatar badge.
export function playerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Clamp a playing handicap to a sane integer range.
export function clampPlayingHandicap(n) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(-9, Math.min(54, v));
}

// Resolve a player's tee for a round, reconciled against the course's current
// tees. An existing tee is kept when its label still matches one of `tees`;
// otherwise the player's last-used tee (matched the same way) is adopted with
// the current course tee's data, falling back to the course's middle tee.
// This drops a stored tee naming one the course no longer has — e.g. a legacy
// synthetic tee carried over from an older round. Gender parameter applies
// gendered rating/slope when resolving.
export function resolvePlayerTee(existing, lastUsed, tees, gender) {
  const list = Array.isArray(tees) ? tees : [];
  const find = (tee) => (tee
    ? list.find((t) => String(t?.label ?? '') === String(tee.label ?? '')) ?? null
    : null);
  if (find(existing)) return existing;
  const pick = find(lastUsed) || middleTee(list);
  return resolveTeeForPlayer(pick, gender);
}

// Per-round, per-player tee picker + playing-handicap editor.
//
// Props:
//   round    - { courseId, tees, holes, playerTees, playerHandicaps, manualHandicaps }
//   players  - [{ id, name, handicap }]   (handicap = base index)
//   onChange - (patch) => void, patch = { playerTees, playerHandicaps, manualHandicaps }
//              playerHandicaps values are numbers.
//   theme    - theme object
//
// Hosts MUST pass key={round.id} (and, where base indexes can change, fold a
// base-index signature into the key) so the component remounts and re-resolves.
export default function RoundTeeAssignments({ round, players = [], onChange, theme }) {
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tees = round?.tees ?? [];
  const holes = round?.holes ?? [];
  const courseId = round?.courseId ?? null;
  const totalPar = holes.reduce((sum, h) => sum + (h.par || 0), 0);

  // A legacy course carries one synthetic tee with no label, purely to hold a
  // rating/slope. Only tees with a real label are a genuine tee *choice* worth
  // showing a picker for; an unnamed tee is "no tee" as far as the UI cares.
  const namedTees = tees.filter((t) => String(t?.label ?? '').trim());
  const hasNamedTees = namedTees.length > 0;

  // playerTees: { [playerId]: { label, slope, rating } }
  const [playerTees, setPlayerTees] = useState(() => ({ ...(round?.playerTees ?? {}) }));
  // playerHandicaps: { [playerId]: string } — editable
  const [playerHandicaps, setPlayerHandicaps] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = round?.playerHandicaps?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });
  const [manualHandicaps, setManualHandicaps] = useState(
    () => ({ ...(round?.manualHandicaps ?? {}) }),
  );
  // playerIndexes: { [playerId]: string } — per-round handicap INDEX override,
  // editable. Defaults to the player's base index; changing it recomputes the
  // (non-manual) playing handicap for THIS round only, without touching the
  // player's global/tournament index.
  const [playerIndexes, setPlayerIndexes] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = round?.playerIndexes?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });
  // expandedId: which player's row is open (only one at a time).
  // editingHandicapId: which player's handicap is in type-to-edit mode.
  const [expandedId, setExpandedId] = useState(null);
  const [editingHandicapId, setEditingHandicapId] = useState(null);

  // The effective index a player plays off this round: the round override if
  // set and valid, else the player's base index.
  const effIndex = (p, indexes = playerIndexes) => {
    const parsed = parseFloat(indexes[p.id]);
    if (Number.isFinite(parsed)) return parsed;
    const base = parseFloat(p.handicap);
    return Number.isFinite(base) ? base : 0;
  };

  const isFirstRender = useRef(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // On mount: ensure every player has a tee (last-used on this course, else
  // the middle tee), then align non-manual playing handicaps to each tee.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = { ...playerTees };
      for (const p of players) {
        const existing = resolved[p.id];
        // Skip the history lookup when the existing tee already matches a
        // current course tee — only stale/missing tees need re-resolving.
        const existingValid = !!existing
          && tees.some((t) => String(t?.label ?? '') === String(existing.label ?? ''));
        let lastUsed = null;
        if (!existingValid && courseId) {
          try { lastUsed = await lastTeeForPlayerOnCourse(courseId, p.id); } catch (_) {}
        }
        const tee = resolvePlayerTee(existing, lastUsed, tees, p.gender);
        if (tee) resolved[p.id] = tee;
        else delete resolved[p.id];
      }
      if (cancelled) return;
      // Update tee state when reconciliation changed any player's tee — a
      // freshly resolved tee, or a stale one corrected to a current course
      // tee. Unchanged tees emit nothing, avoiding a spurious autosave.
      const teesChanged = players.some(
        (p) => (playerTees[p.id]?.label ?? null) !== (resolved[p.id]?.label ?? null),
      );
      if (teesChanged) setPlayerTees(resolved);
      setPlayerHandicaps((prev) => {
        const next = { ...prev };
        let changed = false;
        players.forEach((p) => {
          if (manualHandicaps[p.id]) return;
          const tee = resolved[p.id];
          const auto = String(calcPlayingHandicap(effIndex(p), tee?.slope, tee?.rating, totalPar));
          if (next[p.id] !== auto) { next[p.id] = auto; changed = true; }
        });
        return changed ? next : prev;
      });
    })();
    return () => { cancelled = true; };
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit changes to the host (skip the initial render).
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    const parsedIndexes = {};
    players.forEach((p) => {
      parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0;
      parsedIndexes[p.id] = effIndex(p);
    });
    onChangeRef.current({
      playerTees,
      playerHandicaps: parsedHandicaps,
      manualHandicaps,
      playerIndexes: parsedIndexes,
    });
  }, [playerTees, playerHandicaps, manualHandicaps, playerIndexes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute non-manual handicaps from each player's current tee (and index).
  function recomputeAuto(nextPlayerTees, manual) {
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manual[p.id]) return;
        const tee = nextPlayerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(effIndex(p), tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Assign a tee to one player and refresh their auto handicap.
  function setPlayerTee(playerId, tee) {
    const gender = players.find((pl) => pl.id === playerId)?.gender;
    const snapshot = resolveTeeForPlayer(tee, gender);
    const next = { ...playerTees, [playerId]: snapshot };
    setPlayerTees(next);
    recomputeAuto(next, manualHandicaps);
  }

  // Explicit "Reset all to auto": clear manual overrides, recompute from tees.
  function resetAllToAuto() {
    setEditingHandicapId(null);
    setManualHandicaps({});
    setPlayerHandicaps(() => {
      const next = {};
      players.forEach((p) => {
        const tee = playerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(effIndex(p), tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Set a player's per-round index override and recompute their playing
  // handicap from it — unless the playing handicap was manually overridden,
  // in which case the manual value is preserved.
  function setIndexValue(playerId, value) {
    setPlayerIndexes((prev) => ({ ...prev, [playerId]: value }));
    if (manualHandicaps[playerId]) return;
    const p = players.find((pl) => pl.id === playerId);
    const parsed = parseFloat(value);
    const idx = Number.isFinite(parsed) ? parsed : (parseFloat(p?.handicap) || 0);
    const tee = playerTees[playerId];
    setPlayerHandicaps((prev) => ({
      ...prev,
      [playerId]: String(calcPlayingHandicap(idx, tee?.slope, tee?.rating, totalPar)),
    }));
  }

  // Restore a player's round index to their base index (and recompute).
  function resetIndex(playerId) {
    const base = players.find((pl) => pl.id === playerId)?.handicap ?? 0;
    setIndexValue(playerId, String(base));
  }

  // Set a player's handicap to an explicit value and mark it a manual override.
  function setHandicapValue(playerId, value) {
    setPlayerHandicaps((prev) => ({ ...prev, [playerId]: value }));
    setManualHandicaps((prev) => ({ ...prev, [playerId]: true }));
  }

  // Nudge a player's handicap by delta (+/-1), clamped to a sane range.
  // Reads prior state via the setter callback so rapid taps don't drop a step.
  function stepHandicap(playerId, delta) {
    setPlayerHandicaps((prev) => {
      const current = parseInt(prev[playerId], 10) || 0;
      return { ...prev, [playerId]: String(clampPlayingHandicap(current + delta)) };
    });
    setManualHandicaps((prev) => ({ ...prev, [playerId]: true }));
  }

  // Commit a typed handicap: clamp the entered value and leave edit mode.
  function commitHandicapEdit(playerId) {
    setHandicapValue(
      playerId,
      String(clampPlayingHandicap(parseInt(playerHandicaps[playerId], 10) || 0)),
    );
    setEditingHandicapId(null);
  }

  if (players.length === 0) {
    return <Text style={s.emptyText}>Add players first.</Text>;
  }

  const anyManual = Object.values(manualHandicaps).some(Boolean);

  return (
    <View>
      <Text style={s.hint}>
        {hasNamedTees
          ? 'Tap a player to set their tee. Handicaps auto-calculate.'
          : 'Playing handicaps auto-calculate — tap a player to adjust.'}
      </Text>
      {anyManual && (
        <TouchableOpacity style={s.resetBtn} onPress={resetAllToAuto} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Reset all handicaps to auto">
          <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.resetBtnText}>Reset all to auto</Text>
        </TouchableOpacity>
      )}
      {players.map((p) => {
        const expanded = expandedId === p.id;
        const pTee = playerTees[p.id];
        const teeLabel = pTee?.label ?? null;
        const dotColor = teeColor(teeLabel);
        const valueStr = playerHandicaps[p.id] ?? '';
        const overridden = !!manualHandicaps[p.id];
        const editing = editingHandicapId === p.id;
        const indexStr = playerIndexes[p.id] ?? String(p.handicap);
        const indexChanged = effIndex(p) !== (parseFloat(p.handicap) || 0);
        // On a course with named tees every player gets one resolved on mount,
        // so "Pick a tee" only ever shows defensively. A player on an unnamed
        // (legacy synthetic) tee shows no tee line at all.
        const showPickPrompt = !pTee && hasNamedTees;
        return (
          <View key={p.id} style={[s.card, expanded && s.cardExpanded]}>
            <TouchableOpacity
              style={s.rowHeader}
              activeOpacity={0.7}
              onPress={() => {
                setEditingHandicapId(null);
                setExpandedId(expanded ? null : p.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, index ${p.handicap}${teeLabel ? `, ${teeLabel} tee` : showPickPrompt ? ', no tee selected' : ''}, playing handicap ${valueStr || 'unset'}`}
              accessibilityState={{ expanded }}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{playerInitials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.indexText}>
                  Index {indexChanged ? `${indexStr} · base ${p.handicap}` : p.handicap}
                </Text>
                {(teeLabel || showPickPrompt || overridden) && (
                  <View style={s.teeSummary}>
                    {teeLabel && (
                      <>
                        <View style={[s.teeDot, { backgroundColor: dotColor || theme.bg.secondary }]} />
                        <Text style={s.teeSummaryText}>{teeLabel} tee</Text>
                      </>
                    )}
                    {showPickPrompt && <Text style={s.teeSummaryMuted}>Pick a tee</Text>}
                    {overridden && <Text style={s.editedTag}>· Edited</Text>}
                  </View>
                )}
              </View>
              <View style={s.hcpPill}>
                <Text style={s.hcpPillLabel}>PLAY</Text>
                <Text style={s.hcpPillText}>{valueStr || '—'}</Text>
              </View>
              <Feather
                name={expanded ? 'chevron-down' : 'chevron-right'}
                size={18}
                color={theme.text.muted}
                style={{ marginLeft: 6 }}
              />
            </TouchableOpacity>

            {expanded && (
              <View style={s.editor}>
                {hasNamedTees && (
                  <>
                    <Text style={s.editorLabel}>TEE</Text>
                    <View style={s.teePills}>
                      {namedTees.map((tee) => {
                        const selected = playerTees[p.id]?.label === tee.label;
                        const tColor = teeColor(tee.label);
                        return (
                          <TouchableOpacity
                            key={tee.id ?? tee.label}
                            style={[s.teePill, selected && s.teePillActive]}
                            onPress={() => setPlayerTee(p.id, tee)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`${tee.label} tee`}
                            accessibilityState={{ selected }}
                          >
                            <View style={[s.teeDot, { backgroundColor: tColor || theme.bg.secondary }]} />
                            <Text style={[s.teePillText, selected && s.teePillTextActive]}>
                              {tee.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                <View style={s.editorLabelRow}>
                  <Text style={s.editorLabel}>INDEX · THIS ROUND</Text>
                  {indexChanged && (
                    <TouchableOpacity onPress={() => resetIndex(p.id)} activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Reset ${p.name} index to base ${p.handicap}`}>
                      <Text style={s.indexResetText}>Reset to {p.handicap}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={s.indexInput}
                  keyboardType="decimal-pad"
                  maxLength={5}
                  returnKeyType="done"
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  value={indexStr}
                  placeholder={String(p.handicap)}
                  placeholderTextColor={theme.text.muted}
                  onChangeText={(v) => setIndexValue(p.id, v)}
                  accessibilityLabel={`${p.name} handicap index for this round`}
                />
                <Text style={s.indexHint}>
                  Changing the index recalculates this round&apos;s playing handicap only —
                  the player&apos;s saved index is unchanged.
                </Text>

                <View style={s.editorLabelRow}>
                  <Text style={s.editorLabel}>PLAYING HANDICAP</Text>
                  <Text style={s.indexRef}>Index {effIndex(p)}</Text>
                </View>
                <View style={s.stepper}>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => stepHandicap(p.id, -1)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${p.name} handicap`}
                  >
                    <Feather name="minus" size={18} color={theme.accent.primary} />
                  </TouchableOpacity>
                  {editing ? (
                    <TextInput
                      style={s.stepInput}
                      keyboardType="numeric"
                      maxLength={4}
                      autoFocus
                      returnKeyType="done"
                      keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                      selectionColor={theme.accent.primary}
                      value={playerHandicaps[p.id] ?? ''}
                      onChangeText={(v) => setHandicapValue(p.id, v)}
                      onSubmitEditing={() => commitHandicapEdit(p.id)}
                      onBlur={() => commitHandicapEdit(p.id)}
                    />
                  ) : (
                    <TouchableOpacity
                      style={s.stepValueWrap}
                      onPress={() => setEditingHandicapId(p.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${p.name} handicap, currently ${valueStr || '0'}`}
                    >
                      <Text style={s.stepValue}>{valueStr || '0'}</Text>
                      <Feather name="edit-2" size={12} color={theme.text.muted} style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => stepHandicap(p.id, 1)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${p.name} handicap`}
                  >
                    <Feather name="plus" size={18} color={theme.accent.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  emptyText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12, marginBottom: 10 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },

  card: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    marginBottom: 8,
  },
  cardExpanded: { borderColor: theme.accent.primary + '66' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11 },

  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: theme.accent.light,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },

  name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  indexText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11, marginTop: 1 },
  teeSummary: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  teeDot: {
    width: 13, height: 13, borderRadius: 7,
    borderWidth: 1, borderColor: theme.border.default, marginRight: 6,
  },
  teeSummaryText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12 },
  teeSummaryMuted: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  editedTag: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11, marginLeft: 6 },

  hcpPill: {
    backgroundColor: theme.accent.light, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 5, minWidth: 40, alignItems: 'center',
  },
  hcpPillLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 9,
    letterSpacing: 0.4, opacity: 0.7,
  },
  hcpPillText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },

  editor: {
    paddingHorizontal: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: theme.border.default,
  },
  editorLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
    fontSize: 10, letterSpacing: 0.6, marginTop: 12, marginBottom: 7,
  },
  editorLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  indexRef: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11 },
  indexResetText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 11 },
  indexInput: {
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.secondary,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, paddingVertical: 9,
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 16,
  },
  indexHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 10.5, marginTop: 5, lineHeight: 15,
  },
  teePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  teePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.secondary,
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  teePillActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  teePillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  teePillTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 12 },

  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.secondary,
    borderRadius: 12, padding: 5,
  },
  stepBtn: {
    width: 40, height: 40, borderRadius: 9,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 20 },
  stepInput: {
    flex: 1, marginHorizontal: 8, textAlign: 'center',
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 20,
    padding: 0,
  },
});
