import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { calcPlayingHandicap, lastTeeForPlayerOnCourse } from '../store/tournamentStore';
import { middleTee } from '../store/tees';

// Common golf tee colours, keyed by lower-cased label.
const TEE_COLORS = {
  white: '#FFFFFF', yellow: '#F2C200', red: '#D7372E', blue: '#2F6FB5',
  black: '#23262B', gold: '#C9A227', green: '#2F7D5B', orange: '#E5862B',
  silver: '#B8BCC2', bronze: '#A9712E',
};

// Resolve a tee label to a swatch colour, or null when unknown.
function teeColor(label) {
  return TEE_COLORS[String(label || '').trim().toLowerCase()] || null;
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
  // expandedId: which player's row is open (only one at a time).
  // editingHandicapId: which player's handicap is in type-to-edit mode.
  const [expandedId, setExpandedId] = useState(null);
  const [editingHandicapId, setEditingHandicapId] = useState(null);

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
        if (resolved[p.id]) continue;
        let tee = null;
        if (courseId) {
          try { tee = await lastTeeForPlayerOnCourse(courseId, p.id); } catch (_) {}
        }
        if (!tee) {
          const mid = middleTee(tees);
          if (mid) tee = { label: mid.label, slope: mid.slope, rating: mid.rating };
        }
        if (tee) resolved[p.id] = tee;
      }
      if (cancelled) return;
      // Only update tee state when a missing tee was actually resolved —
      // avoids a spurious onChange (and autosave) when every player already
      // had a tee.
      const teesChanged = players.some((p) => playerTees[p.id] == null && resolved[p.id] != null);
      if (teesChanged) setPlayerTees(resolved);
      setPlayerHandicaps((prev) => {
        const next = { ...prev };
        let changed = false;
        players.forEach((p) => {
          if (manualHandicaps[p.id]) return;
          const tee = resolved[p.id];
          const auto = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
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
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    onChangeRef.current({
      playerTees,
      playerHandicaps: parsedHandicaps,
      manualHandicaps,
    });
  }, [playerTees, playerHandicaps, manualHandicaps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute non-manual handicaps from each player's current tee.
  function recomputeAuto(nextPlayerTees, manual) {
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manual[p.id]) return;
        const tee = nextPlayerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Assign a tee to one player and refresh their auto handicap.
  function setPlayerTee(playerId, tee) {
    const snapshot = { label: tee.label, slope: tee.slope, rating: tee.rating };
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
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
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
              accessibilityLabel={`${p.name}${teeLabel ? `, ${teeLabel} tee` : showPickPrompt ? ', no tee selected' : ''}, playing handicap ${valueStr || 'unset'}`}
              accessibilityState={{ expanded }}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{playerInitials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
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
                <Text style={s.editorLabel}>PLAYING HANDICAP</Text>
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
  hcpPillText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },

  editor: {
    paddingHorizontal: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: theme.border.default,
  },
  editorLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
    fontSize: 10, letterSpacing: 0.6, marginTop: 12, marginBottom: 7,
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
