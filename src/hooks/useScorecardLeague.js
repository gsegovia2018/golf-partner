import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetupLeagues } from './useSetupLeagues';
import { getLeagueGameStatus, getMyLeagueCardsForRound, getMyLeagues } from '../store/leagueStore';
import { isMedalFormat } from '../store/leagueStandings';
import { leagueCardOf } from '../store/leagueSetup';
import {
  leagueOptInState, leagueStripState, roundCanCount, roundLeagueCards,
} from '../store/leagueGameCards';
import {
  announceMyRoundCard, dismissLeagueOptIn, isLeagueOptInDismissed,
} from '../lib/leagueOptIn';
import { leagueErrorText } from '../lib/leagueErrorText';

// `medal` is true when a league this round counts for (a recorded card, or the
// one on offer) is medal play: the scorecard then hides the pick-up, since a
// hole that isn't holed out can't count.
//
// The scorecard's league layer (D5 B): the one-time "Count this round?" sheet
// on a member's phone, the header's "Count this round" action after "Not this
// round", and the LEAGUE chips on counting players' cards (`strip.playerIds`;
// there is no strip on the holes). Reads are online and best effort: offline
// the sheet simply doesn't open (announcing needs the server anyway) and the
// chips come from the cards recorded on the tournament.
//
// `record(card)` writes the announced card onto the tournament; the screen
// passes it so the write goes through its own save queue.
//
// `refreshKey` re-reads the members' status: the screen bumps it on focus and
// every minute while the round is live, so another member's opt-in shows here
// even when the tournament's leagueCards link has not reached this phone yet.
export function useScorecardLeague({
  tournament, round, meId, userId, official, scores, record, refreshKey = 0,
}) {
  const tid = tournament?.id ?? null;
  const roundId = round?.id ?? null;
  const canCount = !official && roundCanCount(tournament, round, { official }) && !!meId;
  const { leagues } = useSetupLeagues(canCount, userId);

  const [statusByLeague, setStatusByLeague] = useState({});
  const [dismissed, setDismissed] = useState(null); // null until read
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetForced, setSheetForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lateHint, setLateHint] = useState(false);
  const [toast, setToast] = useState(null);
  // League formats of the recorded cards' leagues, for those not on offer.
  const [formatById, setFormatById] = useState({});

  // My leagues with a free month (the sheet) plus the leagues already carrying
  // a card on this round (the strip: my month may be taken by this very card).
  const recordedIds = roundLeagueCards(tournament, roundId).map((e) => e.leagueId).filter(Boolean);
  const leagueIds = [...new Set([...leagues.map((l) => l.id), ...recordedIds])].sort().join(',');
  useEffect(() => {
    if (!canCount || !tid || !roundId || !leagueIds) return undefined;
    let cancelled = false;
    (async () => {
      const out = {};
      for (const id of leagueIds.split(',')) {
        try {
          out[id] = await getLeagueGameStatus(id, tid, roundId);
        } catch {
          // Offline or refused: no sheet for that league.
        }
      }
      // A failed re-read keeps what the last one said.
      if (!cancelled) setStatusByLeague((prev) => ({ ...prev, ...out }));
    })();
    return () => { cancelled = true; };
  }, [canCount, tid, roundId, leagueIds, refreshKey]);

  const unknownFormatIds = recordedIds.filter((id) => !leagues.some((l) => l.id === id) && formatById[id] === undefined).join(',');
  useEffect(() => {
    if (!canCount || !unknownFormatIds) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const mine = await getMyLeagues();
        if (!cancelled) setFormatById((prev) => ({ ...prev, ...Object.fromEntries(mine.map((l) => [l.id, l.format ?? 'stableford'])) }));
      } catch {
        // Offline: Stableford rules (the pick-up stays) until the next read.
      }
    })();
    return () => { cancelled = true; };
  }, [canCount, unknownFormatIds]);

  useEffect(() => {
    if (!tid || !roundId) return undefined;
    let cancelled = false;
    isLeagueOptInDismissed(tid, roundId).then((v) => { if (!cancelled) setDismissed(v); });
    return () => { cancelled = true; };
  }, [tid, roundId]);

  const optIn = useMemo(() => {
    const state = leagueOptInState({
      tournament, round, meId, official, leagues, statusByLeague, scores, dismissed: !!dismissed,
    });
    return lateHint && state.kind !== 'none' ? { ...state, kind: 'tooLate' } : state;
  }, [tournament, round, meId, official, leagues, statusByLeague, scores, dismissed, lateHint]);

  // Opens once, when the offer first becomes true on this phone.
  useEffect(() => {
    if (dismissed === false && optIn.kind === 'offer') setSheetOpen(true);
    if (optIn.kind === 'none' || optIn.kind === 'tooLate') setSheetOpen(false);
  }, [dismissed, optIn.kind]);

  // My card for this round, as linked on the tournament.
  const myCardId = meId && roundId ? leagueCardOf(tournament, meId, roundId)?.cardId ?? null : null;

  // Repair: the server has my card for this round but the game has no link
  // for it (the record write was lost, or another phone of mine announced).
  // Announcing again returns the same card (existing: true); record it so the
  // strip, chips and Validate see it. Once per round on this screen.
  const hasLink = !!myCardId;
  const repairedRef = useRef(null);
  useEffect(() => {
    if (!canCount || hasLink || !tid || !roundId || !meId) return undefined;
    const key = `${tid}:${roundId}`;
    if (repairedRef.current === key) return undefined;
    repairedRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const [mine] = await getMyLeagueCardsForRound(tid, roundId);
        if (!mine || cancelled) return;
        const league = { id: mine.leagueId };
        const card = await announceMyRoundCard({ tournament, roundId, meId, league });
        if (!cancelled) await record({ league, card });
      } catch {
        // Offline: try again the next time the scorecard opens.
        repairedRef.current = null;
      }
    })();
    return () => { cancelled = true; };
  }, [canCount, hasLink, tid, roundId, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Announced. It's your October card." for a few seconds.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const serverPlayerIds = useMemo(() => {
    const ids = [];
    for (const rows of Object.values(statusByLeague)) {
      for (const r of rows ?? []) if (r?.thisRound && r.playerId && !ids.includes(r.playerId)) ids.push(r.playerId);
    }
    return ids;
  }, [statusByLeague]);
  const strip = useMemo(
    () => leagueStripState({ tournament, round, meId, optIn, serverPlayerIds }),
    [tournament, round, meId, optIn, serverPlayerIds],
  );

  const countIt = useCallback(async () => {
    const league = optIn.league;
    if (!league || busy) return;
    setBusy(true);
    setError(null);
    try {
      const card = await announceMyRoundCard({ tournament, roundId, meId, league });
      await record({ league, card });
      setSheetOpen(false);
      const hcp = card.leagueHandicap ?? league.leagueHandicap ?? null;
      setToast({ key: hcp == null ? 'league.optIn.announced' : 'league.optIn.announcedHcp', month: card.month, hcp });
    } catch (err) {
      if (err?.hint === 'round_started') {
        setLateHint(true);
        setSheetOpen(false);
      } else {
        setError(err?.offline || !err?.hint ? 'offline' : (leagueErrorText(err) || 'offline'));
      }
    } finally {
      setBusy(false);
    }
  }, [optIn.league, busy, tournament, roundId, meId, record]);

  const notThisRound = useCallback(() => {
    setSheetOpen(false);
    setSheetForced(false);
    setError(null);
    setDismissed(true);
    dismissLeagueOptIn(tid, roundId);
  }, [tid, roundId]);

  const countMine = useCallback(() => {
    setError(null);
    setSheetForced(true);
    setSheetOpen(true);
  }, []);

  const formatOf = (id) => leagues.find((l) => l.id === id)?.format ?? formatById[id];
  const medal = [...recordedIds, optIn.league?.id].filter(Boolean).some((id) => isMedalFormat(formatOf(id)));

  return {
    optIn,
    strip,
    medal,
    sheet: {
      visible: sheetOpen && (optIn.kind === 'offer' || (sheetForced && optIn.kind === 'dismissed')),
      league: optIn.league,
      busy,
      error,
    },
    // "Count this round for <league>" in the scorecard header: only while I
    // said "Not this round" and can still opt in (gone once I've scored).
    canCountMine: optIn.kind === 'dismissed' && !!optIn.league,
    toast,
    countIt,
    notThisRound,
    countMine,
  };
}
