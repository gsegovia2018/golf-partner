import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { listRoster, saveParties, startRound, overrideMarker } from '../store/officialAdmin';
import {
  autoBalanceParties, balancePartiesFromPairs, assignRoundRobinMarkers,
} from '../store/officialScoring';

function showError(message) {
  const msg = message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert('Error', msg);
}

// Map listRoster rows -> objects autoBalanceParties expects (rosterId/handicap).
function toRosterObjects(roster, ids) {
  const byId = new Map(roster.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({ rosterId: r.id, handicap: r.handicap ?? 0 }));
}

export default function PartyBoardScreen({ route, navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { tournamentId, roundId } = route.params ?? {};

  // Guards async handlers from calling setState after the screen unmounts.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Initial-load state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [roster, setRoster] = useState([]);
  const [roundFormat, setRoundFormat] = useState('stableford');
  const [roundStatus, setRoundStatus] = useState('setup');

  // Working layout: array of arrays of rosterId strings, each inner array a
  // party in seat order.
  const [parties, setParties] = useState([]);
  // Pairing method currently selected (display only).
  const [method, setMethod] = useState('manual');
  // Marker overrides keyed by rosterId -> marksRosterId. Default = round-robin.
  const [markerOverrides, setMarkerOverrides] = useState({});

  // In-flight guards.
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  // Which player's action menu is open (rosterId), and which marker picker.
  const [openMoveMenu, setOpenMoveMenu] = useState(null);
  const [openMarkerMenu, setOpenMarkerMenu] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [rosterRows, roundRes, partyRes] = await Promise.all([
        listRoster(tournamentId),
        supabase
          .from('tournament_rounds')
          .select('format, status')
          .eq('id', roundId)
          .single(),
        supabase
          .from('tournament_parties')
          .select('id, number, tournament_party_members(roster_id, seat, marks_roster_id)')
          .eq('round_id', roundId)
          .order('number'),
      ]);
      if (roundRes.error) throw roundRes.error;
      if (partyRes.error) throw partyRes.error;
      if (!mountedRef.current) return;

      setRoster(rosterRows);
      setRoundFormat(roundRes.data?.format ?? 'stableford');
      setRoundStatus(roundRes.data?.status ?? 'setup');

      // Build local parties shape from any existing rows, seat-ordered.
      const existing = (partyRes.data ?? [])
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((p) => {
          const members = [...(p.tournament_party_members ?? [])]
            .sort((a, b) => a.seat - b.seat);
          return members.map((m) => m.roster_id);
        });
      setParties(existing);

      // Seed marker overrides from any saved markers that diverge from the
      // round-robin default, so re-saving preserves them.
      const overrides = {};
      for (const p of partyRes.data ?? []) {
        const members = [...(p.tournament_party_members ?? [])]
          .sort((a, b) => a.seat - b.seat)
          .map((m, i) => ({ rosterId: m.roster_id, seat: i + 1 }));
        const rr = assignRoundRobinMarkers(members);
        const rrById = new Map(rr.map((x) => [x.rosterId, x.marksRosterId]));
        for (const m of p.tournament_party_members ?? []) {
          if (m.marks_roster_id && m.marks_roster_id !== rrById.get(m.roster_id)) {
            overrides[m.roster_id] = m.marks_roster_id;
          }
        }
      }
      setMarkerOverrides(overrides);
    } catch (e) {
      if (!mountedRef.current) return;
      console.warn('PartyBoardScreen: failed to load', e);
      setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tournamentId, roundId]);

  useEffect(() => {
    if (tournamentId && roundId) load();
    else { setLoading(false); setLoadError(true); }
  }, [tournamentId, roundId, load]);

  // Derived: roster ids not placed in any party.
  const assignedIds = new Set(parties.flat());
  const unassigned = roster.filter((r) => !assignedIds.has(r.id));

  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const nameOf = (id) => rosterById.get(id)?.display_name ?? 'Unknown';
  const handicapOf = (id) => rosterById.get(id)?.handicap ?? 0;

  // Auto-fill helper. Excludes withdrawn players from the balance input.
  function autoFill(mode) {
    const activeIds = roster.filter((r) => !r.withdrawn).map((r) => r.id);
    const rosterObjects = toRosterObjects(roster, activeIds);
    if (rosterObjects.length === 0) {
      setParties([]);
      return;
    }
    let balanced;
    if (roundFormat === 'pairs') {
      // TODO: pair formation (Spec 2) — forming the pairs themselves is out of
      // Core scope. Fall back to plain party auto-balance for now.
      void balancePartiesFromPairs;
      balanced = autoBalanceParties(rosterObjects, { partySize: 4, mode });
    } else {
      balanced = autoBalanceParties(rosterObjects, { partySize: 4, mode });
    }
    // autoBalanceParties returns arrays of roster objects; map back to ids.
    setParties(balanced.map((party) => party.map((p) => p.rosterId)));
    // Auto-fill resets any manual marker overrides since seats changed.
    setMarkerOverrides({});
  }

  function handleMethod(next) {
    setMethod(next);
    setOpenMoveMenu(null);
    setOpenMarkerMenu(null);
    if (next === 'handicap') autoFill('handicap');
    else if (next === 'random' || next === 'reroll') autoFill('random');
    // 'manual' leaves the layout untouched.
  }

  // Move a player to a target party index, or to unassigned (target = null).
  function movePlayer(rosterId, targetPartyIdx) {
    setOpenMoveMenu(null);
    setParties((prev) => {
      const next = prev.map((p) => p.filter((id) => id !== rosterId));
      if (targetPartyIdx != null) {
        while (next.length <= targetPartyIdx) next.push([]);
        next[targetPartyIdx] = [...next[targetPartyIdx], rosterId];
      }
      // Drop any now-empty trailing parties.
      while (next.length > 0 && next[next.length - 1].length === 0) next.pop();
      return next;
    });
    // A move changes seats; clear that player's stale override.
    setMarkerOverrides((prev) => {
      if (!(rosterId in prev)) return prev;
      const { [rosterId]: _omit, ...rest } = prev;
      return rest;
    });
  }

  function handleAddParty() {
    setParties((prev) => [...prev, []]);
  }

  function setMarker(rosterId, marksRosterId) {
    setOpenMarkerMenu(null);
    setMarkerOverrides((prev) => ({ ...prev, [rosterId]: marksRosterId }));
  }

  function clearMarker(rosterId) {
    setOpenMarkerMenu(null);
    setMarkerOverrides((prev) => {
      const { [rosterId]: _omit, ...rest } = prev;
      return rest;
    });
  }

  // Persist parties, then re-query to get the new party ids and apply any
  // marker overrides on top of the round-robin defaults saveParties writes.
  async function persist() {
    const filled = parties.filter((p) => p.length > 0);
    await saveParties(tournamentId, roundId, filled);
    if (Object.keys(markerOverrides).length === 0) return;
    const { data, error } = await supabase
      .from('tournament_parties')
      .select('id, number, tournament_party_members(roster_id)')
      .eq('round_id', roundId)
      .order('number');
    if (error) throw error;
    for (const party of data ?? []) {
      const memberIds = new Set(
        (party.tournament_party_members ?? []).map((m) => m.roster_id),
      );
      for (const [rosterId, marksRosterId] of Object.entries(markerOverrides)) {
        if (memberIds.has(rosterId) && memberIds.has(marksRosterId)) {
          await overrideMarker(party.id, rosterId, marksRosterId);
        }
      }
    }
  }

  async function handleSave() {
    if (saving || starting) return;
    setSaving(true);
    try {
      await persist();
      if (!mountedRef.current) return;
      if (Platform.OS === 'web') window.alert('Parties saved');
      else Alert.alert('Saved', 'Parties saved.');
    } catch {
      if (!mountedRef.current) return;
      // persist() is non-atomic, but a plain retry of Save is self-healing
      // because saveParties does a full delete + re-insert.
      showError(
        "Couldn't fully save the parties. Some changes may not have been "
        + 'stored — tap Save to try again.',
      );
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function handleStart() {
    if (saving || starting) return;

    // Pre-flight checks: starting a round locks the parties and cannot be
    // undone from this screen. Withdrawn players may stay unassigned.
    const unassignedActive = unassigned.filter((r) => !r.withdrawn);
    if (unassignedActive.length > 0) {
      showError('Assign every player to a party before starting the round.');
      return;
    }
    if (parties.some((p) => p.length === 0)) {
      showError('Remove empty parties before starting the round.');
      return;
    }

    setStarting(true);
    try {
      await persist();
      await startRound(roundId);
      if (!mountedRef.current) return;
      navigation.navigate('OfficialAdmin', { tournamentId });
    } catch {
      if (!mountedRef.current) return;
      // persist() is non-atomic, but a plain retry of Save is self-healing
      // because saveParties does a full delete + re-insert.
      showError(
        "Couldn't fully save the parties. Some changes may not have been "
        + 'stored — tap Save to try again.',
      );
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }

  const busy = saving || starting;

  // Compute the displayed marker for a player in a given party.
  function markerInfo(partyIds, rosterId, seatIdx) {
    const members = partyIds.map((id, i) => ({ rosterId: id, seat: i + 1 }));
    const rr = assignRoundRobinMarkers(members);
    const rrTarget = rr.find((x) => x.rosterId === rosterId)?.marksRosterId;
    const overridden = markerOverrides[rosterId];
    const target = overridden ?? rrTarget;
    const loops = seatIdx === partyIds.length - 1 && target === partyIds[0];
    return { target, isOverride: !!overridden && overridden !== rrTarget, loops };
  }

  function avgHandicap(partyIds) {
    if (partyIds.length === 0) return 0;
    const sum = partyIds.reduce((acc, id) => acc + (handicapOf(id) || 0), 0);
    return sum / partyIds.length;
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={22} color={theme.accent.primary} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Party & Markers</Text>
        <View style={{ width: 64 }} />
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      ) : loadError ? (
        <View style={s.centered}>
          <Text style={s.errorText}>Could not load this round.</Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={load}>
            <Text style={s.secondaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
          <Text style={s.subtitle}>
            {`${roundFormat} format · ${roster.length} player${roster.length !== 1 ? 's' : ''}`}
            {roundStatus !== 'setup' ? `  •  ${roundStatus}` : ''}
          </Text>

          {/* Pairing method */}
          <Text style={s.sectionTitle}>Pairing method</Text>
          <View style={s.methodRow}>
            {[
              { key: 'manual', label: 'Manual' },
              { key: 'handicap', label: 'Auto by handicap' },
              { key: 'random', label: 'Random' },
              { key: 'reroll', label: 'Re-roll' },
            ].map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[
                  s.methodBtn,
                  method === m.key && s.methodBtnActive,
                  m.key === 'reroll' && s.methodBtnDashed,
                ]}
                onPress={() => handleMethod(m.key)}
                disabled={busy}
              >
                <Text style={[s.methodBtnText, method === m.key && s.methodBtnTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.hint}>
            Auto/Random fill the parties; you can still move any player by hand.
            Markers default to round-robin (↓) — tap a marker to override.
          </Text>

          {/* Unassigned */}
          <Text style={s.sectionTitle}>{`Unassigned (${unassigned.length})`}</Text>
          {unassigned.length === 0 ? (
            <Text style={s.hint}>All players assigned.</Text>
          ) : (
            unassigned.map((r) => (
              <View key={r.id} style={s.playerCard}>
                <View style={s.playerRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.playerName, r.withdrawn && s.withdrawnText]}>
                      {r.display_name}
                    </Text>
                    <Text style={s.playerMeta}>
                      Handicap {r.handicap}{r.withdrawn ? '  •  Withdrawn' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.miniBtn}
                    onPress={() => setOpenMoveMenu(openMoveMenu === r.id ? null : r.id)}
                    disabled={busy}
                  >
                    <Feather name="corner-up-right" size={13} color={theme.accent.primary} />
                    <Text style={s.miniBtnText}>Move</Text>
                  </TouchableOpacity>
                </View>
                {openMoveMenu === r.id && (
                  <View style={s.menu}>
                    {parties.map((_p, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={s.menuItem}
                        onPress={() => movePlayer(r.id, idx)}
                      >
                        <Text style={s.menuItemText}>{`Party ${idx + 1}`}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={s.menuItem} onPress={handleAddParty}>
                      <Text style={[s.menuItemText, { color: theme.accent.primary }]}>
                        + New party
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )}

          {/* Party cards */}
          <Text style={s.sectionTitle}>Parties</Text>
          {parties.length === 0 && (
            <Text style={s.hint}>
              No parties yet. Pick a pairing method, or add one below.
            </Text>
          )}
          {parties.map((partyIds, idx) => (
            <View key={idx} style={s.partyCard}>
              <View style={s.partyHeader}>
                <Text style={s.partyTitle}>{`Party ${idx + 1}`}</Text>
                <Text style={s.partyAvg}>{`Avg hcp ${avgHandicap(partyIds).toFixed(1)}`}</Text>
              </View>
              {partyIds.length === 0 ? (
                <Text style={s.emptyParty}>No players — move someone here.</Text>
              ) : (
                partyIds.map((rid, seatIdx) => {
                  const info = markerInfo(partyIds, rid, seatIdx);
                  return (
                    <View key={rid} style={s.memberRow}>
                      <View style={s.memberTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.memberName}>
                            {nameOf(rid)}
                            <Text style={s.memberHcp}>{`  hcp ${handicapOf(rid)}`}</Text>
                          </Text>
                          <Text style={s.markerLine}>
                            {info.loops ? '↳' : '↓'} marks {nameOf(info.target)}
                            {info.loops ? ' (loops)' : ''}
                            {info.isOverride ? '  • overridden' : ''}
                          </Text>
                        </View>
                        <Text style={s.seatLabel}>{`seat ${seatIdx + 1}`}</Text>
                      </View>
                      <View style={s.memberActions}>
                        <TouchableOpacity
                          style={s.miniBtn}
                          onPress={() => {
                            setOpenMarkerMenu(openMarkerMenu === rid ? null : rid);
                            setOpenMoveMenu(null);
                          }}
                          disabled={busy}
                        >
                          <Feather name="edit-2" size={12} color={theme.accent.primary} />
                          <Text style={s.miniBtnText}>Marker</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.miniBtn}
                          onPress={() => {
                            setOpenMoveMenu(openMoveMenu === rid ? null : rid);
                            setOpenMarkerMenu(null);
                          }}
                          disabled={busy}
                        >
                          <Feather name="corner-up-right" size={12} color={theme.accent.primary} />
                          <Text style={s.miniBtnText}>Move</Text>
                        </TouchableOpacity>
                      </View>
                      {openMarkerMenu === rid && (
                        <View style={s.menu}>
                          {partyIds.filter((x) => x !== rid).map((other) => (
                            <TouchableOpacity
                              key={other}
                              style={s.menuItem}
                              onPress={() => setMarker(rid, other)}
                            >
                              <Text style={s.menuItemText}>{`Marks ${nameOf(other)}`}</Text>
                            </TouchableOpacity>
                          ))}
                          {info.isOverride && (
                            <TouchableOpacity
                              style={s.menuItem}
                              onPress={() => clearMarker(rid)}
                            >
                              <Text style={[s.menuItemText, { color: theme.accent.primary }]}>
                                Reset to round-robin
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                      {openMoveMenu === rid && (
                        <View style={s.menu}>
                          {parties.map((_p, tIdx) => (
                            tIdx !== idx && (
                              <TouchableOpacity
                                key={tIdx}
                                style={s.menuItem}
                                onPress={() => movePlayer(rid, tIdx)}
                              >
                                <Text style={s.menuItemText}>{`Move to Party ${tIdx + 1}`}</Text>
                              </TouchableOpacity>
                            )
                          ))}
                          <TouchableOpacity
                            style={s.menuItem}
                            onPress={() => {
                              handleAddParty();
                              movePlayer(rid, parties.length);
                            }}
                          >
                            <Text style={[s.menuItemText, { color: theme.accent.primary }]}>
                              Move to new party
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.menuItem}
                            onPress={() => movePlayer(rid, null)}
                          >
                            <Text style={[s.menuItemText, { color: theme.destructive }]}>
                              Unassign
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          ))}

          <TouchableOpacity style={s.addPartyBtn} onPress={handleAddParty} disabled={busy}>
            <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.addPartyBtnText}>Add Party</Text>
          </TouchableOpacity>

          {/* Save / Start */}
          <TouchableOpacity
            style={[s.secondaryBtn, { marginTop: 24 }, busy && s.btnDisabled]}
            onPress={handleSave}
            disabled={busy}
          >
            {saving
              ? <ActivityIndicator size="small" color={theme.accent.primary} />
              : <Text style={s.secondaryBtnText}>Save</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.btnDisabled]}
            onPress={handleStart}
            disabled={busy}
          >
            {starting
              ? <ActivityIndicator size="small" color={theme.text.inverse} />
              : <Text style={s.primaryBtnText}>Start Round — locks parties</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
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
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
    fontSize: 13, marginTop: 4, textTransform: 'capitalize',
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginBottom: 8 },
  errorText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive, fontSize: 13, marginBottom: 12 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodBtn: {
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  methodBtnActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  methodBtnDashed: { borderStyle: 'dashed' },
  methodBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  methodBtnTextActive: { color: theme.text.inverse },
  playerCard: {
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  playerRow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  withdrawnText: { textDecorationLine: 'line-through', color: theme.text.muted },
  playerMeta: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginTop: 2 },
  partyCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  partyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  partyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
  partyAvg: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12 },
  emptyParty: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  memberRow: {
    borderTopWidth: 1, borderTopColor: theme.border.subtle,
    paddingTop: 10, marginTop: 4,
  },
  memberTop: { flexDirection: 'row', alignItems: 'flex-start' },
  memberName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
  memberHcp: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  markerLine: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.accent.primary,
    fontSize: 12, marginTop: 2,
  },
  seatLabel: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
  memberActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  miniBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 5, paddingHorizontal: 9,
  },
  miniBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 11 },
  menu: {
    marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    overflow: 'hidden',
  },
  menuItem: {
    paddingVertical: 9, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
  },
  menuItemText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary, fontSize: 13 },
  addPartyBtn: {
    borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 4,
    flexDirection: 'row', justifyContent: 'center',
  },
  addPartyBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  primaryBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 12,
    padding: 14, alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  primaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
    padding: 12, alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
});
