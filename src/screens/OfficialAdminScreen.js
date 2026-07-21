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
import {
  forceResolve, forceFinalizeParty, withdrawPlayer,
  listNotifications, overrideMarker,
} from '../store/officialAdmin';
import { cardDiscrepancyHoles, activeMarkerChain } from '../store/officialScoring';

function showError(message) {
  const msg = message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert('Error', msg);
}

// Human-friendly timestamp for the notifications feed.
function formatTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return then.toLocaleDateString();
}

// Clamp a stroke count into the valid 1-15 range.
function clampStrokes(n) {
  if (Number.isNaN(n)) return 1;
  return Math.min(15, Math.max(1, n));
}

export default function OfficialAdminScreen({ route, navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { tournamentId } = route.params ?? {};

  // Guards async handlers from calling setState after the screen unmounts.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Initial-load state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Loaded round + derived data.
  const [round, setRound] = useState(null);       // { id, round_index, status }
  const [hasLiveRound, setHasLiveRound] = useState(false);
  const [parties, setParties] = useState([]);     // [{ id, number, locked, members: [...] }]
  const [scores, setScores] = useState([]);       // flat tournament_scores rows
  const [notifications, setNotifications] = useState([]);

  // Mutation in-flight guard (string label) and an open force-resolve picker.
  const [busy, setBusy] = useState(false);
  // Key of the discrepancy whose stroke picker is open: `${partyId}:${rosterId}:${hole}`.
  const [openPicker, setOpenPicker] = useState(null);
  // Stroke value held in the open picker.
  const [pickerValue, setPickerValue] = useState(4);

  const load = useCallback(async () => {
    if (!tournamentId) { setLoading(false); setLoadError(true); return; }
    setLoading(true);
    setLoadError(false);
    try {
      // Find the round to monitor: prefer the live one, else the most recent.
      const roundsRes = await supabase
        .from('tournament_rounds')
        .select('id, round_index, status')
        .eq('tournament_id', tournamentId)
        .order('round_index', { ascending: false });
      if (roundsRes.error) throw roundsRes.error;
      const rounds = roundsRes.data ?? [];
      const live = rounds.find((r) => r.status === 'live');
      const target = live ?? rounds[0] ?? null;

      let partyRows = [];
      let scoreRows = [];
      if (target) {
        const [partyRes, scoreRes] = await Promise.all([
          supabase
            .from('tournament_parties')
            .select(
              'id, number, locked, '
              + 'tournament_party_members(roster_id, seat, '
              + 'tournament_roster(display_name, withdrawn))',
            )
            .eq('round_id', target.id)
            .order('number'),
          supabase
            .from('tournament_scores')
            .select('hole, subject_roster_id, source, strokes')
            .eq('round_id', target.id),
        ]);
        if (partyRes.error) throw partyRes.error;
        if (scoreRes.error) throw scoreRes.error;
        partyRows = (partyRes.data ?? []).map((p) => ({
          id: p.id,
          number: p.number,
          locked: !!p.locked,
          members: [...(p.tournament_party_members ?? [])]
            .sort((a, b) => a.seat - b.seat)
            .map((m) => ({
              roster_id: m.roster_id,
              seat: m.seat,
              display_name: m.tournament_roster?.display_name ?? 'Unknown',
              withdrawn: !!m.tournament_roster?.withdrawn,
            })),
        }));
        scoreRows = scoreRes.data ?? [];
      }

      const notifs = await listNotifications(tournamentId);

      if (!mountedRef.current) return;
      setRound(target);
      setHasLiveRound(!!live);
      setParties(partyRows);
      setScores(scoreRows);
      setNotifications(notifs);
    } catch (e) {
      if (!mountedRef.current) return;
      console.warn('OfficialAdminScreen: failed to load', e);
      setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  // Per-member open-discrepancy holes for a party member.
  function memberDiscrepancies(rosterId) {
    return cardDiscrepancyHoles(scores, rosterId);
  }

  // Total open discrepancies across a party (sum of per-member counts).
  function partyDiscrepancyCount(party) {
    return party.members.reduce(
      (acc, m) => acc + memberDiscrepancies(m.roster_id).length, 0,
    );
  }

  function partyStatusLine(party) {
    if (party.locked) return 'Locked';
    const n = partyDiscrepancyCount(party);
    if (n > 0) return `${n} discrepanc${n === 1 ? 'y' : 'ies'} open`;
    return 'Scoring';
  }

  // Run a mutation with the in-flight guard, then reload all screen data.
  async function runMutation(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (!mountedRef.current) return;
      await load();
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function openResolvePicker(party, member, hole) {
    const key = `${party.id}:${member.roster_id}:${hole}`;
    if (openPicker === key) { setOpenPicker(null); return; }
    setOpenPicker(key);
    setPickerValue(4);
  }

  async function handleForceResolve(member, hole) {
    if (!round) return;
    const strokes = clampStrokes(pickerValue);
    // NOTE: admin force-resolves are attributed to the subject's own roster id
    // (author_roster_id) because the admin is the tournament owner and has no
    // tournament_roster row. author_roster_id is a NOT NULL FK to that table,
    // so the subject's roster id is used as a pragmatic, valid stand-in.
    const adminRosterId = member.roster_id;
    await runMutation(() => forceResolve(
      round.id, hole, member.roster_id, strokes, adminRosterId,
    ));
    if (mountedRef.current) setOpenPicker(null);
  }

  async function handleForceFinalize(party) {
    await runMutation(() => forceFinalizeParty(party.id));
  }

  // Withdraw a player, then heal that party's marker chain in place via
  // overrideMarker. We deliberately do NOT call saveParties: it deletes and
  // re-inserts every party row for the round (non-atomic, changes ids) and is
  // documented setup-only. The withdrawn player stays a member row — only the
  // round-robin marker chain over the still-active members needs to re-close.
  function handleWithdraw(party, member) {
    if (!round) return;
    const confirm = () => runMutation(async () => {
      await withdrawPlayer(member.roster_id);
      // Build the party's full member list (including the withdrawn player —
      // activeMarkerChain filters it out) in seat order. Fall back to the
      // member's index within the seat-ordered list if `seat` is absent.
      const partyMembers = party.members.map((m, i) => ({
        rosterId: m.roster_id,
        seat: m.seat ?? i + 1,
      }));
      // Withdrawn ids in this party: the just-withdrawn player plus any
      // already flagged withdrawn in the loaded data.
      const withdrawnRosterIdsInParty = party.members
        .filter((m) => m.withdrawn || m.roster_id === member.roster_id)
        .map((m) => m.roster_id);
      const chain = activeMarkerChain(partyMembers, withdrawnRosterIdsInParty);
      for (const { rosterId, marksRosterId } of chain) {
        await overrideMarker(party.id, rosterId, marksRosterId);
      }
    });
    if (Platform.OS === 'web') {
      if (window.confirm(`Withdraw ${member.display_name}?`)) confirm();
    } else {
      Alert.alert(
        'Withdraw player',
        `Withdraw ${member.display_name} from the tournament?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Withdraw', style: 'destructive', onPress: confirm },
        ],
      );
    }
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={22} color={theme.accent.primary} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Admin Monitor</Text>
        <View style={s.refreshBtn}>
          <IconButton
            icon="refresh-cw"
            size={18}
            color={theme.accent.primary}
            onPress={() => !busy && load()}
            disabled={busy || loading}
            accessibilityLabel="Refresh"
          />
        </View>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      ) : loadError ? (
        <View style={s.centered}>
          <Text style={s.errorText}>Could not load this tournament.</Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={load}>
            <Text style={s.secondaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
          {!round ? (
            <Text style={s.hint}>No rounds exist for this tournament yet.</Text>
          ) : (
            <>
              <Text style={s.subtitle}>
                {`Round ${round.round_index + 1} · ${round.status}`}
              </Text>
              {!hasLiveRound && (
                <View style={s.noticeCard}>
                  <Feather name="info" size={14} color={theme.text.muted} style={{ marginRight: 6 }} />
                  <Text style={s.noticeText}>
                    No live round — showing the most recent round.
                  </Text>
                </View>
              )}

              {/* Parties */}
              <Text style={s.sectionTitle}>Parties</Text>
              {parties.length === 0 && (
                <Text style={s.hint}>No parties set up for this round.</Text>
              )}
              {parties.map((party) => (
                <View key={party.id} style={s.partyCard}>
                  <View style={s.partyHeader}>
                    <Text style={s.partyTitle}>{`Party ${party.number}`}</Text>
                    <Text style={[
                      s.partyStatus,
                      party.locked && s.partyStatusLocked,
                      !party.locked && partyDiscrepancyCount(party) > 0 && s.partyStatusWarn,
                    ]}
                    >
                      {partyStatusLine(party)}
                    </Text>
                  </View>

                  {party.members.map((member) => {
                    const discHoles = memberDiscrepancies(member.roster_id);
                    return (
                      <View key={member.roster_id} style={s.memberRow}>
                        <View style={s.memberTop}>
                          <Text style={[
                            s.memberName,
                            member.withdrawn && s.withdrawnText,
                          ]}
                          >
                            {member.display_name}
                            {member.withdrawn ? '  •  Withdrawn' : ''}
                          </Text>
                          {!member.withdrawn && (
                            <TouchableOpacity
                              style={[s.miniBtn, busy && s.btnDisabled]}
                              onPress={() => handleWithdraw(party, member)}
                              disabled={busy}
                            >
                              <Feather name="user-x" size={14} color={theme.destructive} />
                              <Text style={s.miniBtnTextDanger}>Withdraw</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Open discrepancies for this member */}
                        {discHoles.map((hole) => {
                          const key = `${party.id}:${member.roster_id}:${hole}`;
                          return (
                            <View key={hole} style={s.discRow}>
                              <View style={s.discLine}>
                                <Feather
                                  name="alert-triangle"
                                  size={12}
                                  color={theme.destructive}
                                  style={{ marginRight: 6 }}
                                />
                                <Text style={s.discText}>{`Hole ${hole} — scores disagree`}</Text>
                                <TouchableOpacity
                                  style={[s.miniBtn, busy && s.btnDisabled]}
                                  onPress={() => openResolvePicker(party, member, hole)}
                                  disabled={busy}
                                >
                                  <Text style={s.miniBtnText}>Force resolve</Text>
                                </TouchableOpacity>
                              </View>
                              {openPicker === key && (
                                <View style={s.picker}>
                                  <Text style={s.pickerLabel}>Agreed strokes</Text>
                                  <View style={s.stepperRow}>
                                    <TouchableOpacity
                                      style={s.stepBtn}
                                      onPress={() => setPickerValue((v) => clampStrokes(v - 1))}
                                    >
                                      <Feather name="minus" size={16} color={theme.accent.primary} />
                                    </TouchableOpacity>
                                    <Text style={s.stepValue}>{clampStrokes(pickerValue)}</Text>
                                    <TouchableOpacity
                                      style={s.stepBtn}
                                      onPress={() => setPickerValue((v) => clampStrokes(v + 1))}
                                    >
                                      <Feather name="plus" size={16} color={theme.accent.primary} />
                                    </TouchableOpacity>
                                  </View>
                                  <TouchableOpacity
                                    style={[s.confirmBtn, busy && s.btnDisabled]}
                                    onPress={() => handleForceResolve(member, hole)}
                                    disabled={busy}
                                  >
                                    {busy
                                      ? <ActivityIndicator size="small" color={theme.text.inverse} />
                                      : <Text style={s.confirmBtnText}>Confirm</Text>}
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}

                  {!party.locked && (
                    <TouchableOpacity
                      style={[s.finalizeBtn, busy && s.btnDisabled]}
                      onPress={() => handleForceFinalize(party)}
                      disabled={busy}
                    >
                      <Feather name="lock" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                      <Text style={s.finalizeBtnText}>Force finalize party</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {/* Notifications */}
              <Text style={s.sectionTitle}>Notifications</Text>
              {notifications.length === 0 ? (
                <Text style={s.hint}>No notifications.</Text>
              ) : (
                notifications.map((n) => (
                  <View key={n.id} style={s.notifCard}>
                    <View style={s.notifTop}>
                      <Text style={s.notifKind}>{n.kind}</Text>
                      <Text style={s.notifTime}>{formatTime(n.created_at)}</Text>
                    </View>
                    <Text style={s.notifBody}>{n.body}</Text>
                  </View>
                ))
              )}
            </>
          )}
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
  refreshBtn: { width: 64, alignItems: 'flex-end' },
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
  noticeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 12, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 12, marginTop: 10,
  },
  noticeText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, flex: 1 },
  partyCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  partyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  partyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
  partyStatus: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 12 },
  partyStatusLocked: { color: theme.accent.primary },
  partyStatusWarn: { color: theme.destructive },
  memberRow: {
    borderTopWidth: 1, borderTopColor: theme.border.subtle,
    paddingTop: 10, marginTop: 8,
  },
  memberTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14, flex: 1 },
  withdrawnText: { textDecorationLine: 'line-through', color: theme.text.muted },
  discRow: { marginTop: 8 },
  discLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  discText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, flex: 1 },
  miniBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 5, paddingHorizontal: 9,
  },
  miniBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 11 },
  miniBtnTextDanger: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 11 },
  btnDisabled: { opacity: 0.5 },
  picker: {
    marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    padding: 12,
  },
  pickerLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginBottom: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValue: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18,
    minWidth: 32, textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 10,
    padding: 10, alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 13 },
  finalizeBtn: {
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 10, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', marginTop: 12,
  },
  finalizeBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 12 },
  notifCard: {
    backgroundColor: theme.bg.card, borderRadius: 12, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 12, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  notifTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  notifKind: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 12,
    textTransform: 'capitalize',
  },
  notifTime: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
  notifBody: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13 },
  secondaryBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
    padding: 12, alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
});
