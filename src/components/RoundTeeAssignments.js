import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { calcPlayingHandicap, lastTeeForPlayerOnCourse } from '../store/tournamentStore';
import { middleTee } from '../store/tees';

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
  const s = makeStyles(theme);
  const tees = round?.tees ?? [];
  const holes = round?.holes ?? [];
  const courseId = round?.courseId ?? null;
  const totalPar = holes.reduce((sum, h) => sum + (h.par || 0), 0);

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

  if (players.length === 0) {
    return <Text style={s.emptyText}>Add players first.</Text>;
  }

  return (
    <View>
      {tees.length > 0 && (
        <Text style={s.hint}>Auto-calculated from each player's tee — tap a handicap to override.</Text>
      )}
      {Object.values(manualHandicaps).some(Boolean) && (
        <TouchableOpacity style={s.resetBtn} onPress={resetAllToAuto} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Reset all handicaps to auto">
          <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.resetBtnText}>Reset all to auto</Text>
        </TouchableOpacity>
      )}
      {players.map((p) => {
        const pTee = playerTees[p.id];
        const auto = pTee
          ? calcPlayingHandicap(p.handicap, pTee.slope, pTee.rating, totalPar)
          : null;
        const current = parseInt(playerHandicaps[p.id], 10);
        const isDifferent = auto !== null && !Number.isNaN(current) && current !== auto;
        return (
          <View key={p.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{p.name}</Text>
              <View style={s.teeChips}>
                {tees.length === 0 && (
                  <Text style={s.noTeeText}>No tees on this course</Text>
                )}
                {tees.map((tee) => {
                  const selected = playerTees[p.id]?.label === tee.label;
                  return (
                    <TouchableOpacity
                      key={tee.id ?? tee.label}
                      style={[s.teeChip, selected && s.teeChipActive]}
                      onPress={() => setPlayerTee(p.id, tee)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name} tee ${tee.label || 'unnamed'}`}
                    >
                      <Text style={[s.teeChipText, selected && s.teeChipTextActive]}>
                        {tee.label || '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <Text style={s.index}>Index {p.handicap}</Text>
            {auto !== null && (
              <Feather name="arrow-right" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
            )}
            <TextInput
              style={[s.hcpInput, isDifferent && s.hcpInputOverride]}
              keyboardType="numeric"
              maxLength={4}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={playerHandicaps[p.id] ?? ''}
              onChangeText={(v) => {
                setPlayerHandicaps((prev) => ({ ...prev, [p.id]: v }));
                setManualHandicaps((prev) => ({ ...prev, [p.id]: true }));
              }}
            />
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
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  index: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13, marginRight: 8 },
  teeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  teeChip: {
    backgroundColor: theme.bg.secondary, borderRadius: 7, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 9, paddingVertical: 4,
  },
  teeChipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  teeChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  teeChipTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 12 },
  noTeeText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 50, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 6,
  },
  hcpInputOverride: { backgroundColor: theme.accent.light, borderColor: theme.accent.primary },
});
