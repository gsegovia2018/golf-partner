import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  subscribeTournamentChanges,
  normalizeRoundHandicaps, readLocal,
  loadTournamentMembers, findClaimedSlot,
  removeTournamentMember, generateInviteCode, releaseTournamentPlayer, buildJoinLink,
  addPlayerRoundPatches, removePlayerRoundPatches,
  getTournament, getTournamentSnapshot,
} from '../store/tournamentStore';
import { supabase } from '../lib/supabase';
import { mutate } from '../store/mutate';
import RoundTeeAssignments, { playerInitials } from '../components/RoundTeeAssignments';
import { isScoringModeAllowed, fallbackScoringMode, getScoringMode } from '../components/scoringModes';
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
import BottomSheet from '../components/BottomSheet';
import { listFriends, getCachedFriends } from '../store/friendStore';
import { consumePendingPlayers } from '../lib/selectionBridge';
import { parseHandicapIndex } from '../lib/handicap';
import { shouldHandleStoreChange } from '../lib/navigationFocus';

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

function editablePlayersFromTournament(t) {
  return (t?.players ?? []).map((p) => ({ ...p, handicap: String(p.handicap) }));
}

function editableRoundsFromTournament(t) {
  return (t?.rounds ?? []).map((r) => {
    const normalized = normalizeRoundHandicaps(r, t.players ?? []);
    return {
      ...normalized,
      holes: [...(normalized.holes ?? [])],
      playerHandicaps: Object.fromEntries(
        (t.players ?? []).map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
      ),
      manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
    };
  });
}

export default function PlayersScreen({ navigation, route }) {
  const { tournamentId, tournamentName } = route.params ?? {};
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const initialTournament = useMemo(() => getTournamentSnapshot(tournamentId), [tournamentId]);

  const [tournament, setTournament] = useState(() => initialTournament);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(() => !initialTournament);
  const [loadError, setLoadError] = useState(null);
  const [editPlayers, setEditPlayers] = useState(() => editablePlayersFromTournament(initialTournament));   // [{ id, name, handicap: string, user_id }]
  const [rounds, setRounds] = useState(() => editableRoundsFromTournament(initialTournament));
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState(null);
  const [releasingId, setReleasingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [modePrompt, setModePrompt] = useState(null);
  const [removeModePrompt, setRemoveModePrompt] = useState(null);
  // Friend-chooser sheet for linking a local roster slot to an app account.
  const [linkTarget, setLinkTarget] = useState(null);   // the roster player being linked
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const skipNextSaveRef = useRef(false);
  const hasLoadedOnceRef = useRef(!!initialTournament);

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
    setLoadError(null);
    try {
      const [t, mem] = await Promise.all([
        getTournament(tournamentId),
        tournamentId ? loadTournamentMembers(tournamentId) : Promise.resolve([]),
      ]);
      skipNextSaveRef.current = true;
      setTournament(t);
      setMembers(mem);
      setEditPlayers(editablePlayersFromTournament(t));
      setRounds(editableRoundsFromTournament(t));
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load players');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const commitAdds = useCallback(async (picked, initialChosenMode) => {
    let t = await getTournament(tournamentId);
    if (!t) return;
    let chosenMode = initialChosenMode;
    for (const p of picked) {
      if ((t.players ?? []).length >= 4) break;
      if ((t.players ?? []).some((x) => x.id === p.id)) continue;
      const parsed = parseHandicapIndex(p.handicap);
      // Carry the account link (user_id) + avatar through. Dropping them here
      // saved a friend-with-account as a plain local name, so the participant
      // → member → "added to game" notification path never fired and that
      // person never saw the tournament. SetupScreen already preserves these.
      const player = {
        id: p.id,
        name: p.name,
        handicap: parsed.ok ? parsed.value : 0,
        gender: p.gender ?? null,
        user_id: p.user_id ?? null,
        avatar_url: p.avatar_url ?? null,
      };
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
  }, [load, tournamentId]);

  const applyAddPlayers = useCallback(async (picked) => {
    const t = await getTournament(tournamentId);
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
  }, [commitAdds, tournamentId]);

  const commitRemove = useCallback(async (playerId, chosenMode) => {
    let t = await getTournament(tournamentId);
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
  }, [load, tournamentId]);

  const applyRemovePlayer = useCallback(async (playerId) => {
    const t = await getTournament(tournamentId);
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
  }, [commitRemove, tournamentId]);

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
      if (!shouldHandleStoreChange(navigation)) return;
      const t = await getTournament(tournamentId);
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
  }, [navigation, tournamentId]);

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
          playerIndexes: Object.fromEntries(
            Object.entries(r.playerIndexes ?? {}).map(([id, v]) => [id, Number(v) || 0]),
          ),
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
          for (const [pid, v] of Object.entries(r.playerIndexes)) {
            const before = prevRound.playerIndexes?.[pid];
            if (before === v) continue;
            t = await mutate(t, { type: 'index.set', roundId: r.id, playerId: pid, index: v });
          }
        }
        // Roster edits (base handicap, and any friend-link user_id/avatar_url
        // patched via pickFriendForSlot) go through tournament.updatePlayer —
        // NOT tournament.updateProfile, whose patch only ever reaches
        // tournaments.props (players live in the normalized game_players
        // table and would be silently invisible to reads otherwise). Round
        // fields (playerTees from handleRoundTeesChange, plus the
        // handicaps/indexes already stamped above) go through round.upsert.
        for (const p of builtPlayers) {
          t = await mutate(t, { type: 'tournament.updatePlayer', playerId: p.id, patch: p });
        }
        // isNew tells mutationWrites.js whether this round already exists on
        // the server — see EditTournamentScreen's matching comment. This
        // screen never adds rounds, so it's always false in practice, but is
        // still derived from the pre-edit snapshot rather than hardcoded, so
        // a future round-adding feature here stays covered automatically.
        for (let i = 0; i < builtRounds.length; i++) {
          const isNew = !t.rounds?.some((r) => r.id === builtRounds[i].id);
          t = await mutate(t, {
            type: 'round.upsert', roundId: builtRounds[i].id, roundIndex: i, round: builtRounds[i], isNew,
          });
        }
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

  // Open the friend chooser to link a local roster slot to an app account.
  async function openLinkSheet(player) {
    setLinkTarget(player);
    setFriendsLoading(true);
    try {
      const list = await listFriends();
      setFriends(list);
    } catch (_) {
      setFriends(await getCachedFriends());
    } finally {
      setFriendsLoading(false);
    }
  }

  // Attach a friend's account to the target slot. Setting user_id and letting
  // the debounced save run triggers the participant → member → "added to game"
  // notification path, so the friend now sees the game. Guards against linking
  // an account already used by another slot in this roster.
  function pickFriendForSlot(friend) {
    const target = linkTarget;
    setLinkTarget(null);
    if (!target) return;
    const alreadyUsed = editPlayers.some((p) => p.id !== target.id && p.user_id === friend.userId);
    if (alreadyUsed) {
      const msg = `${friend.displayName} is already linked to another player in this game.`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Already linked', msg);
      return;
    }
    setEditPlayers((prev) => prev.map((p) => (
      p.id === target.id
        ? { ...p, user_id: friend.userId, avatar_url: friend.avatarUrl ?? null }
        : p
    )));
  }

  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
        playerIndexes: { ...(patch.playerIndexes ?? {}) },
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
                    {p.user_id ? (
                      <View style={s.linkedBadge}>
                        <Feather name="user-check" size={10} color={theme.accent.primary} />
                        <Text style={s.linkedBadgeText}>Linked</Text>
                      </View>
                    ) : (
                      <View style={s.localBadge}>
                        <Feather name="user" size={10} color={theme.text.muted} />
                        <Text style={s.localBadgeText}>Local</Text>
                      </View>
                    )}
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
                {!isViewer && !p.user_id && (
                  <TouchableOpacity
                    onPress={() => openLinkSheet(p)}
                    style={s.linkBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel={`Link ${p.name} to an app account`}
                  >
                    <Feather name="link" size={16} color={theme.accent.primary} />
                  </TouchableOpacity>
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

      <BottomSheet visible={!!linkTarget} onClose={() => setLinkTarget(null)} sheetStyle={s.linkSheet}>
        <View style={s.linkSheetHandle} />
        <Text style={s.linkSheetTitle}>
          {linkTarget ? `Link ${linkTarget.name} to an account` : 'Link to an account'}
        </Text>
        <Text style={s.linkSheetSubtitle}>
          Pick the friend who plays as this player so the game shows up for them.
        </Text>
        {friendsLoading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 24 }} />
        ) : friends.length === 0 ? (
          <Text style={s.linkSheetEmpty}>
            No friends yet. Add friends first, or share an invite link from “Invite people”.
          </Text>
        ) : (
          <ScrollView style={s.linkSheetList}>
            {friends.map((f) => {
              const used = editPlayers.some((p) => p.user_id === f.userId);
              return (
                <TouchableOpacity
                  key={f.userId}
                  style={[s.linkFriendRow, used && s.linkFriendRowDisabled]}
                  onPress={() => !used && pickFriendForSlot(f)}
                  disabled={used}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Link to ${f.displayName}${used ? ', already linked' : ''}`}
                >
                  <View style={[s.linkFriendAvatar, { backgroundColor: f.avatarColor || theme.accent.primary }]}>
                    {f.avatarUrl
                      ? <Image source={{ uri: f.avatarUrl }} style={s.linkFriendAvatarImg} />
                      : <Text style={s.linkFriendAvatarText}>{playerInitials(f.displayName)}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.linkFriendName}>{f.displayName}</Text>
                    {f.username ? <Text style={s.linkFriendMeta}>@{f.username}</Text> : null}
                  </View>
                  {used
                    ? <Text style={s.linkFriendUsed}>Linked</Text>
                    : <Feather name="chevron-right" size={18} color={theme.text.muted} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </BottomSheet>
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
  // --- linked account vs local badge ---
  linkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    backgroundColor: theme.accent.light,
  },
  linkedBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.accent.primary, letterSpacing: 0.4 },
  localBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    backgroundColor: theme.bg.secondary,
  },
  localBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted, letterSpacing: 0.4 },
  linkBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: theme.accent.light,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    alignItems: 'center', justifyContent: 'center',
  },
  // --- link-account friend chooser sheet ---
  linkSheet: { backgroundColor: theme.bg.primary, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  linkSheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border.default,
    alignSelf: 'center', marginBottom: 14,
  },
  linkSheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary },
  linkSheetSubtitle: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, color: theme.text.muted, marginTop: 4, marginBottom: 12 },
  linkSheetEmpty: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted, marginVertical: 20, lineHeight: 19 },
  linkSheetList: { maxHeight: 340 },
  linkFriendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
  },
  linkFriendRowDisabled: { opacity: 0.45 },
  linkFriendAvatar: {
    width: 38, height: 38, borderRadius: 19, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  linkFriendAvatarImg: { width: '100%', height: '100%' },
  linkFriendAvatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 13 },
  linkFriendName: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
  linkFriendMeta: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted, marginTop: 1 },
  linkFriendUsed: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: theme.accent.primary },
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
