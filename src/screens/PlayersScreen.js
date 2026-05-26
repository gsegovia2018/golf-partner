import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Alert, Platform, Share,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  loadTournament, saveTournament, subscribeTournamentChanges,
  normalizeRoundHandicaps, readLocal,
  loadTournamentMembers, findClaimedSlot,
  removeTournamentMember, generateInviteCode, releaseTournamentPlayer, buildJoinLink,
  addPlayerRoundPatches, removePlayerRoundPatches,
} from '../store/tournamentStore';
import { supabase } from '../lib/supabase';
import { mutate } from '../store/mutate';
import RoundTeeAssignments, { playerInitials } from '../components/RoundTeeAssignments';
import { isScoringModeAllowed, fallbackScoringMode, getScoringMode } from '../components/scoringModes';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import { consumePendingPlayers } from '../lib/selectionBridge';
import { parseHandicapIndex } from '../lib/handicap';

async function confirmDialog(title, message, confirmLabel = 'Remove') {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}

async function updateMemberRole(tournamentId, userId, role) {
  const { error } = await supabase
    .from('tournament_members')
    .update({ role })
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);
  if (error) throw error;
}

export default function PlayersScreen({ navigation, route }) {
  const { tournamentId, tournamentName } = route.params ?? {};
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const [tournament, setTournament] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editPlayers, setEditPlayers] = useState([]);   // [{ id, name, handicap: string, user_id }]
  const [rounds, setRounds] = useState([]);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState(null);
  const [releasingId, setReleasingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [modePrompt, setModePrompt] = useState(null);
  const [removeModePrompt, setRemoveModePrompt] = useState(null);
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const skipNextSaveRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, mem] = await Promise.all([
        loadTournament(),
        tournamentId ? loadTournamentMembers(tournamentId) : Promise.resolve([]),
      ]);
      skipNextSaveRef.current = true;
      setTournament(t);
      setMembers(mem);
      setEditPlayers(t.players.map((p) => ({ ...p, handicap: String(p.handicap) })));
      setRounds(t.rounds.map((r) => {
        const normalized = normalizeRoundHandicaps(r, t.players);
        return {
          ...normalized,
          holes: [...normalized.holes],
          playerHandicaps: Object.fromEntries(
            t.players.map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
          ),
          manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
        };
      }));
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load players');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const commitAdds = useCallback(async (picked, initialChosenMode) => {
    let t = await loadTournament();
    if (!t) return;
    let chosenMode = initialChosenMode;
    for (const p of picked) {
      if ((t.players ?? []).length >= 4) break;
      if ((t.players ?? []).some((x) => x.id === p.id)) continue;
      const parsed = parseHandicapIndex(p.handicap);
      const player = { id: p.id, name: p.name, handicap: parsed.ok ? parsed.value : 0 };
      const { patches: roundPatches, nextScoringMode } = addPlayerRoundPatches(t, player, { mode: chosenMode });
      const modeChanged = nextScoringMode !== (t.settings?.scoringMode ?? 'stableford');
      t = await mutate(t, {
        type: 'tournament.addPlayer',
        player,
        roundPatches,
        ...(modeChanged ? { nextScoringMode } : {}),
      });
      chosenMode = undefined;
    }
    await load();
  }, [load]);

  const applyAddPlayers = useCallback(async (picked) => {
    const t = await loadTournament();
    if (!t) return;
    const currentMode = t.settings?.scoringMode ?? 'stableford';
    const existingIds = new Set((t.players ?? []).map((p) => p.id));
    let simulatedCount = (t.players ?? []).length;
    for (const p of picked) {
      if (simulatedCount >= 4) break;
      if (existingIds.has(p.id)) continue;
      simulatedCount += 1;
    }
    if (simulatedCount === (t.players ?? []).length) return;
    if (isScoringModeAllowed(currentMode, simulatedCount)) {
      await commitAdds(picked, undefined);
      return;
    }
    setModePrompt({
      picked,
      newCount: simulatedCount,
      defaultMode: fallbackScoringMode(simulatedCount),
      prevMode: currentMode,
    });
  }, [commitAdds]);

  const commitRemove = useCallback(async (playerId, chosenMode) => {
    let t = await loadTournament();
    if (!t) return;
    const { patches: roundPatches, nextScoringMode } =
      removePlayerRoundPatches(t, playerId, { mode: chosenMode });
    const modeChanged = nextScoringMode !== (t.settings?.scoringMode ?? 'stableford');
    t = await mutate(t, {
      type: 'tournament.removePlayer',
      playerId,
      roundPatches,
      ...(modeChanged ? { nextScoringMode } : {}),
    });
    await load();
  }, [load]);

  const applyRemovePlayer = useCallback(async (playerId) => {
    const t = await loadTournament();
    if (!t) return;
    const newCount = (t.players ?? []).length - 1;
    if (newCount < 2) {
      Alert.alert('Cannot remove', 'A game needs at least 2 players.');
      return;
    }
    const currentMode = t.settings?.scoringMode ?? 'stableford';
    if (isScoringModeAllowed(currentMode, newCount)) {
      await commitRemove(playerId, undefined);
      return;
    }
    setRemoveModePrompt({
      playerId,
      newCount,
      defaultMode: fallbackScoringMode(newCount),
      prevMode: currentMode,
    });
  }, [commitRemove]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      const picked = consumePendingPlayers();
      if (picked && picked.length > 0) applyAddPlayers(picked);
    });
    return unsub;
  }, [navigation, applyAddPlayers]);

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    const unsub = subscribeTournamentChanges(async () => {
      const t = await loadTournament();
      if (!t) return;
      setTournament(t);
      setMembers(tournamentId ? await loadTournamentMembers(tournamentId) : []);
      setEditPlayers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const fresh = t.players.find((x) => x.id === p.id);
          if (fresh && fresh.name !== p.name) { changed = true; return { ...p, name: fresh.name }; }
          return p;
        });
        if (!changed) return prev;
        skipNextSaveRef.current = true;
        return next;
      });
    });
    return unsub;
  }, [tournamentId]);

  useEffect(() => {
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveState('saving');
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const builtPlayers = editPlayers.map((p) => {
          const r = parseHandicapIndex(p.handicap);
          return { ...p, handicap: r.ok ? r.value : 0 };
        });
        const builtRounds = rounds.map((r) => ({
          ...r,
          playerHandicaps: Object.fromEntries(
            Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
          ),
          manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        }));
        const baseId = tournamentRef.current?.id;
        let t = (baseId && (await readLocal(baseId))) || tournamentRef.current;
        for (const r of builtRounds) {
          const prevRound = t.rounds.find((pr) => pr.id === r.id);
          if (!prevRound) continue;
          for (const [pid, v] of Object.entries(r.playerHandicaps)) {
            const before = prevRound.playerHandicaps?.[pid];
            if (before === v) continue;
            t = await mutate(t, { type: 'handicap.set', roundId: r.id, playerId: pid, handicap: v });
          }
        }
        await saveTournament({ ...t, players: builtPlayers, rounds: builtRounds });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        const msg = err?.message ?? 'Could not save changes';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Save failed', msg);
      }
    }, 400);
  }, [editPlayers, rounds]);

  function updateBaseHandicap(playerId, value) {
    setEditPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, handicap: value } : p)));
  }

  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);

  async function confirmRemove(row) {
    const name = row.profile?.display_name || 'this member';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove ${name} from the tournament?`)
      : await new Promise((resolve) => Alert.alert(
          'Remove member', `Remove ${name} from the tournament?`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setRemovingId(row.userId);
    try {
      await removeTournamentMember(tournamentId, row.userId);
      await load();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not remove member');
    } finally {
      setRemovingId(null);
    }
  }

  async function releaseSlot(row, slot) {
    const name = slot?.name || row.profile?.display_name || 'this player';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Release the "${name}" slot? They will be removed and the slot reopens for someone else to claim.`)
      : await new Promise((resolve) => Alert.alert(
          'Release player slot',
          `Release the "${name}" slot? They will be removed and the slot reopens.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Release', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setReleasingId(row.userId);
    try {
      await releaseTournamentPlayer(tournamentId, slot.id);
      await load();
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not release the slot');
    } finally {
      setReleasingId(null);
    }
  }

  async function handleInvite() {
    if (inviting) return;
    setInviting(true);
    try {
      const { editorCode } = await generateInviteCode(tournamentId);
      const origin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : '';
      const link = buildJoinLink(origin, editorCode);
      const message = `Join "${tournamentName ?? 'my tournament'}" on Golf Partner:\n${link}`;
      if (Platform.OS === 'web') {
        try { await navigator.clipboard?.writeText(link); } catch (_) {}
        window.alert(`Invite link copied:\n${link}`);
      } else {
        await Share.share({ message });
      }
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not create invite link');
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(row) {
    const nextRole = row.role === 'editor' ? 'viewer' : 'editor';
    const name = row.profile?.display_name || 'this member';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Change ${name} to ${nextRole}?`)
      : await new Promise((resolve) => Alert.alert(
          'Change role', `Change ${name} to ${nextRole}?`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Change', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setRoleBusyId(row.userId);
    try {
      await updateMemberRole(tournamentId, row.userId, nextRole);
      await load();
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not update role');
    } finally {
      setRoleBusyId(null);
    }
  }

  async function leaveTournament() {
    if (leaving || !user?.id) return;
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Leave this tournament? You will need a new invite code to rejoin.')
      : await new Promise((resolve) => Alert.alert(
          'Leave tournament',
          'Leave this tournament? You will need a new invite code to rejoin.',
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Leave', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setLeaving(true);
    try {
      await removeTournamentMember(tournamentId, user.id);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', err?.message ?? 'Could not leave tournament');
      setLeaving(false);
    }
  }

  const ownerRow = members.find((m) => m.role === 'owner');
  const isOwner = !!ownerRow && ownerRow.userId === user?.id;
  const myRow = members.find((m) => m.userId === user?.id);
  const isViewer = myRow?.role === 'viewer';

  const players = tournament?.players ?? [];

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Players</Text>
          {tournamentName ? <Text style={s.headerSubtitle} numberOfLines={1}>{tournamentName}</Text> : null}
        </View>
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

      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : loadError ? (
        <View style={s.errorBox}>
          <Feather name="wifi-off" size={22} color={theme.destructive} />
          <Text style={s.errorTitle}>Couldn't load players</Text>
          <Text style={s.errorMsg}>{loadError}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.7}>
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <View style={s.topRow}>
            <Text style={s.sectionLabel}>{editPlayers.length} {editPlayers.length === 1 ? 'player' : 'players'}</Text>
            {!isViewer && editPlayers.length < 4 && (
              <TouchableOpacity
                style={s.addBtn}
                onPress={() => navigation.navigate('PlayerPicker', {
                  alreadySelectedIds: editPlayers.map((p) => p.id),
                })}
                activeOpacity={0.7}
              >
                <Feather name="user-plus" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          {editPlayers.map((p) => {
            const member = members.find((m) => m.userId === p.user_id) || null;
            const canManage = isOwner && !!member && member.role !== 'owner' && member.userId !== user?.id;
            const color = member?.profile?.avatar_color || theme.accent.primary;
            return (
              <View key={p.id} style={s.row}>
                <View style={[s.avatar, { backgroundColor: color }]}>
                  {member?.profile?.avatar_url
                    ? <Image source={{ uri: member.profile.avatar_url }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{playerInitials(p.name)}</Text>}
                </View>
                <View style={s.info}>
                  <Text style={s.name}>{p.name}</Text>
                  <View style={s.metaRow}>
                    {member ? (
                      <View style={[s.roleBadge, member.role === 'owner' && s.roleBadgeOwner]}>
                        <Text style={[s.roleText, member.role === 'owner' && s.roleTextOwner]}>
                          {member.role.toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {isViewer ? (
                  <Text style={s.metaText}>HCP {p.handicap}</Text>
                ) : (
                  <TextInput
                    style={s.hcpInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    value={p.handicap}
                    onChangeText={(v) => updateBaseHandicap(p.id, v)}
                    placeholder="0"
                    placeholderTextColor={theme.text.muted}
                    accessibilityLabel={`Handicap for ${p.name}`}
                  />
                )}
                {!isViewer && editPlayers.length > 2 && (
                  removingId === `roster:${p.id}`
                    ? <ActivityIndicator color={theme.destructive} />
                    : (
                      <TouchableOpacity
                        onPress={async () => {
                          const ok = await confirmDialog(
                            'Remove player',
                            `Remove ${p.name} from the game? Their scores for this game will be deleted.`,
                          );
                          if (ok) applyRemovePlayer(p.id);
                        }}
                        style={s.removeBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove ${p.name} from the game`}
                      >
                        <Feather name="user-x" size={18} color={theme.destructive} />
                      </TouchableOpacity>
                    )
                )}
                {canManage && (
                  <View style={s.rowActions}>
                    {roleBusyId === member.userId ? (
                      <ActivityIndicator color={theme.accent.primary} />
                    ) : (
                      <TouchableOpacity
                        onPress={() => changeRole(member)}
                        style={s.roleActionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={member.role === 'editor' ? `Demote ${p.name} to viewer` : `Promote ${p.name} to editor`}
                      >
                        <Feather name={member.role === 'editor' ? 'arrow-down' : 'arrow-up'} size={16} color={theme.accent.primary} />
                      </TouchableOpacity>
                    )}
                    {findClaimedSlot(players, member.userId) && (
                      releasingId === member.userId
                        ? <ActivityIndicator color={theme.accent.primary} />
                        : (
                          <TouchableOpacity
                            onPress={() => releaseSlot(member, findClaimedSlot(players, member.userId))}
                            style={s.roleActionBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel={`Release the ${p.name} player slot`}
                          >
                            <Feather name="rotate-ccw" size={15} color={theme.accent.primary} />
                          </TouchableOpacity>
                        )
                    )}
                    {removingId === member.userId
                      ? <ActivityIndicator color={theme.destructive} />
                      : (
                        <TouchableOpacity
                          onPress={() => confirmRemove(member)}
                          style={s.removeBtn}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityLabel={`Remove ${p.name} member access`}
                        >
                          <Feather name="user-minus" size={18} color={theme.destructive} />
                        </TouchableOpacity>
                      )}
                  </View>
                )}
              </View>
            );
          })}
          {isOwner && (
            <TouchableOpacity style={s.inviteBtn} onPress={handleInvite} disabled={inviting} activeOpacity={0.7}>
              {inviting
                ? <ActivityIndicator size="small" color={theme.accent.primary} />
                : <Feather name="user-plus" size={16} color={theme.accent.primary} />}
              <Text style={s.inviteBtnText}>Invite people</Text>
            </TouchableOpacity>
          )}
          {!isViewer && rounds.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Tees & playing handicaps</Text>
              {rounds.map((r, ri) => (
                <View key={r.id} style={s.roundCard}>
                  <Text style={s.roundCardTitle}>
                    Round {ri + 1}{r.courseName ? ` — ${r.courseName}` : ''}
                  </Text>
                  <RoundTeeAssignments
                    key={`${r.id}:${editPlayers.map((p) => p.handicap).join(',')}`}
                    round={r}
                    players={editPlayers.map((p) => {
                      const r = parseHandicapIndex(p.handicap);
                      return { ...p, handicap: r.ok ? r.value : 0 };
                    })}
                    theme={theme}
                    onChange={(patch) => handleRoundTeesChange(ri, patch)}
                  />
                </View>
              ))}
            </>
          )}
          {myRow && !isOwner && (
            <TouchableOpacity style={s.leaveBtn} onPress={leaveTournament} disabled={leaving} activeOpacity={0.7}>
              {leaving
                ? <ActivityIndicator size="small" color={theme.destructive} />
                : <Feather name="log-out" size={16} color={theme.destructive} />}
              <Text style={s.leaveBtnText}>Leave tournament</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
      <ScoringModeChangeSheet
        visible={!!modePrompt}
        playerCount={modePrompt?.newCount ?? 0}
        defaultMode={modePrompt?.defaultMode}
        title="Pick a new scoring mode"
        subtitle={modePrompt
          ? `Adding this player makes ${getScoringMode(modePrompt.prevMode).label} invalid (${getScoringMode(modePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${modePrompt.newCount} players.`
          : undefined}
        onConfirm={async (chosenMode) => {
          const picked = modePrompt.picked;
          setModePrompt(null);
          await commitAdds(picked, chosenMode);
        }}
        onCancel={() => setModePrompt(null)}
      />
      <ScoringModeChangeSheet
        visible={!!removeModePrompt}
        playerCount={removeModePrompt?.newCount ?? 0}
        defaultMode={removeModePrompt?.defaultMode}
        title="Pick a new scoring mode"
        subtitle={removeModePrompt
          ? `Removing this player makes ${getScoringMode(removeModePrompt.prevMode).label} invalid (${getScoringMode(removeModePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${removeModePrompt.newCount} players.`
          : undefined}
        onConfirm={async (chosenMode) => {
          const playerId = removeModePrompt.playerId;
          setRemoveModePrompt(null);
          await commitRemove(playerId, chosenMode);
        }}
        onCancel={() => setRemoveModePrompt(null)}
      />
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerSubtitle: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 15 },
  info: { flex: 1 },
  name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.bg.secondary },
  roleBadgeOwner: { backgroundColor: 'rgba(212,175,55,0.15)' },
  roleText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted, letterSpacing: 0.8 },
  roleTextOwner: { color: '#d4af37' },
  // --- handicap input (Task 2) ---
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 54, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 7,
  },
  // --- save pill (Task 2) ---
  savePill: {
    flexDirection: 'row', alignItems: 'center', minWidth: 64, justifyContent: 'center',
    backgroundColor: theme.bg.secondary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 8, paddingVertical: 4,
  },
  savePillSaved: { borderColor: theme.accent.primary + '55' },
  savePillError: { borderColor: theme.destructive, backgroundColor: theme.destructive + '15' },
  savePillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted },
  savePillTextError: { color: theme.destructive },
  // --- row actions (Tasks 4 & 5) ---
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleActionBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: theme.accent.light,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: { padding: 8 },
  // --- add / invite / leave buttons (Tasks 4 & 5) ---
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.accent.light, borderRadius: 12,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    padding: 14, marginTop: 6,
  },
  inviteBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, marginTop: 24, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
  },
  leaveBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 14 },
  // --- tees section (Task 3) ---
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  roundCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  roundCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 14, marginBottom: 8,
  },
  // --- error box ---
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, marginTop: 10 },
  errorMsg: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.accent.light,
    borderRadius: 10, borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
