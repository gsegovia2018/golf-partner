import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getActiveTournamentSnapshot,
  loadTournament,
  getTournament,
  getTournamentSnapshot,
  subscribeTournamentChanges,
  getPlayingHandicap,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { roundScoringMode, laterRoundsForFixedTeamsPropagation } from '../store/scoring';
import { shouldHandleStoreChange } from '../lib/navigationFocus';
import { buildThreeVsOne, swapDuelOrder, shuffleTeams, randomizeDuelOrder } from '../lib/teamEditing';
import EditTeamsView from './editTeams/EditTeamsView';

export default function EditTeamsScreen({ navigation, route }) {
  const { roundIndex, tournamentId } = route?.params ?? {};

  // Load the tournament this screen was opened for. Fall back to the active
  // one only when no id was passed (older entry points), so every edit is
  // saved back to the *linked* round/game — never whatever happens to be
  // active. mutate() persists by the passed tournament's id, so as long as we
  // load the right one, the save lands on the right one.
  const initialTournament = useMemo(
    () => (tournamentId ? getTournamentSnapshot(tournamentId) : getActiveTournamentSnapshot()),
    [tournamentId],
  );
  const initialPairs = initialTournament?.rounds?.[roundIndex]?.pairs;

  const [tournament, setTournament] = useState(() => initialTournament);
  const [pairs, setPairs] = useState(() => (
    initialPairs?.length === 2 ? [[...initialPairs[0]], [...initialPairs[1]]] : null
  ));
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  // Set when the user performs a local edit so a subscription-driven reload
  // (e.g. a player rename in the library) doesn't discard it.
  const hasLocalEdits = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load({ force }) {
      const t = tournamentId ? await getTournament(tournamentId) : await loadTournament();
      if (cancelled) return;
      setTournament(t);
      const current = t?.rounds?.[roundIndex]?.pairs;
      if (!current || current.length !== 2) return;
      if (force || !hasLocalEdits.current) {
        setPairs([[...current[0]], [...current[1]]]);
      }
    }
    hasLocalEdits.current = false;
    load({ force: true });
    const unsub = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) load({ force: false });
    });
    return () => { cancelled = true; unsub(); };
  }, [navigation, roundIndex, tournamentId]);

  if (!tournament || !pairs) return null;

  const round = tournament.rounds[roundIndex];
  const scoringMode = roundScoringMode(tournament, round);
  const soloSide = pairs.find((side) => side.length === 1);
  const soloId = (soloSide ?? pairs[1])?.[0]?.id;
  // Per-player playing handicap for this round — shown on each tile and summed
  // per team so the editor doubles as a fair-teams aid.
  const handicaps = Object.fromEntries(
    (tournament.players ?? []).map((p) => [p.id, getPlayingHandicap(round, p)]),
  );

  function onTapSolo(playerId) {
    hasLocalEdits.current = true;
    setPairs(buildThreeVsOne(tournament.players ?? [], playerId));
  }

  function onShuffle() {
    hasLocalEdits.current = true;
    setSelected(null);
    setPairs((prev) => shuffleTeams(prev));
  }

  function onSwapDuels() {
    hasLocalEdits.current = true;
    setPairs(swapDuelOrder(pairs));
  }

  function onRandomizeDuels() {
    hasLocalEdits.current = true;
    setPairs((prev) => randomizeDuelOrder(prev));
  }

  function onTapPlayer(pairIdx, slotIdx) {
    if (!selected) {
      setSelected({ pairIdx, slotIdx });
      return;
    }
    if (selected.pairIdx === pairIdx && selected.slotIdx === slotIdx) {
      setSelected(null);
      return;
    }
    const next = [[...pairs[0]], [...pairs[1]]];
    const a = next[selected.pairIdx][selected.slotIdx];
    const b = next[pairIdx][slotIdx];
    next[selected.pairIdx][selected.slotIdx] = b;
    next[pairIdx][slotIdx] = a;
    hasLocalEdits.current = true;
    setPairs(next);
    setSelected(null);
  }

  async function onSave() {
    setSaving(true);
    try {
      let t = await mutate(tournament, {
        type: 'pairs.set',
        roundId: round.id,
        pairs,
      });
      // Fixed teams: the edited partnerships ARE the tournament's teams, so
      // carry them into every later round whose own effective mode shares
      // this round's team shape (a later round with a different shape —
      // e.g. scramble3v1 after a bestball edit — keeps its own pairs;
      // pairsForNextRound rebuilds it for its own mode at reveal time).
      // reveal:false keeps those rounds' own reveal moment intact.
      if (tournament?.settings?.fixedTeams) {
        for (const later of laterRoundsForFixedTeamsPropagation(tournament, round)) {
          t = await mutate(t, {
            type: 'pairs.set',
            roundId: later.id,
            pairs,
            reveal: false,
          });
        }
      }
      navigation.goBack();
    } catch {
      setSaving(false);
    }
  }

  return (
    <EditTeamsView
      roundNumber={roundIndex + 1}
      courseName={round?.courseName}
      scoringMode={scoringMode}
      players={tournament.players ?? []}
      pairs={pairs}
      soloId={soloId}
      selected={selected}
      saving={saving}
      handicaps={handicaps}
      onBack={() => navigation.goBack()}
      onTapPlayer={onTapPlayer}
      onTapSolo={onTapSolo}
      onShuffle={onShuffle}
      onRandomizeDuels={onRandomizeDuels}
      onSwapDuels={onSwapDuels}
      onSave={onSave}
    />
  );
}
