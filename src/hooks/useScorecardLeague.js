import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetupLeagues } from './useSetupLeagues';
import { getLeagueCard, getLeagueGameStatus, getMyLeagueCardsForRound } from '../store/leagueStore';
import { leagueCardOf } from '../store/leagueSetup';
import {
  hasScoreIn, leagueOptInState, leagueStripState, roundCanCount,
} from '../store/leagueGameCards';
import {
  announceMyRoundCard, dismissLeagueOptIn, isLeagueOptInDismissed,
} from '../lib/leagueOptIn';

// The scorecard's league layer (D5 B): the one-time "Count this round?" sheet
// on a member's phone, the strip ("2 league cards in this game: you and
// Javier · post by 17:02") and the LEAGUE chips. Reads are online and best
// effort: offline the sheet simply doesn't open (announcing needs the server
// anyway) and the strip/chips come from the cards recorded on the tournament.
//
// `record(card)` writes the announced card onto the tournament; the screen
// passes it so the write goes through its own save queue.
export function useScorecardLeague({
  tournament, round, meId, userId, official, scores, record,
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
  const [myCard, setMyCard] = useState(null);

  const leagueIds = leagues.map((l) => l.id).join(',');
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
      if (!cancelled) setStatusByLeague(out);
    })();
    return () => { cancelled = true; };
  }, [canCount, tid, roundId, leagueIds]);

  useEffect(() => {
    if (!tid || !roundId) return undefined;
    let cancelled = false;
    isLeagueOptInDismissed(tid, roundId).then((v) => { if (!cancelled) setDismissed(v); });
    return () => { cancelled = true; };
  }, [tid, roundId]);

  const scored = hasScoreIn(scores, meId);
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

  // My card's post deadline: null until the first shot starts its 8 hours.
  const myCardId = meId && roundId ? leagueCardOf(tournament, meId, roundId)?.cardId ?? null : null;
  useEffect(() => {
    if (!myCardId) { setMyCard(null); return undefined; }
    let cancelled = false;
    getLeagueCard(myCardId).then((c) => { if (!cancelled) setMyCard(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [myCardId, scored]);

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

  const strip = useMemo(
    () => leagueStripState({ tournament, round, meId, optIn }),
    [tournament, round, meId, optIn],
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
        setError(err?.offline || !err?.hint ? 'offline' : (err?.message ?? 'offline'));
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

  return {
    optIn,
    strip,
    sheet: {
      visible: sheetOpen && (optIn.kind === 'offer' || (sheetForced && optIn.kind === 'dismissed')),
      league: optIn.league,
      busy,
      error,
    },
    postBy: myCard?.postBy ?? null,
    toast,
    countIt,
    notThisRound,
    countMine,
  };
}
