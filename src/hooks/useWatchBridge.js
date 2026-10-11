import { useCallback, useEffect, useRef, useState } from 'react';
import { addWatchCommandListener, setWatchState } from '../lib/watchBridge';
import { holeFeatures } from '../lib/geo';
import { calcExtraShots, calcStablefordPoints, getPlayingHandicap, holeCountOf } from '../store/scoring';
import { driveLieFromDetail } from '../store/statsEngine';
import { watchStateOf, parseWatchCommand, decideWatchCommand } from '../store/watchProtocol';
import { NOTIFICATION_MIN_DELTA_M } from './useRoundTracking';

// Mirrors the live scorecard to the Wear OS watch and applies the watch's
// commands through the scorecard's own callbacks, so a watch tap is
// indistinguishable from a phone tap (drafts, publish-on-leave, disputes).
// The pure state/command logic lives in store/watchProtocol.
//
// State goes out when its content changes; the phone's own distances change
// with every fix and the watch measures for itself, so they only count once the
// centre has moved NOTIFICATION_MIN_DELTA_M (and such a push is not urgent).
// After every command, accepted or not, state is republished unconditionally,
// once the command's write has landed: that is the watch's ack.
//
// Commands run one at a time, in arrival order. A watch that was out of range
// replays its queue in a burst (strokes 7, shot 7, hole 8, strokes 8, ...), and
// each one must be judged against where the previous one left the phone.

// rev is a millisecond-based monotonic counter: it starts from the wall clock,
// so a new JS session (app restart, OTA reload) never publishes below a rev the
// watch still holds from the last one, then steps by at least 1.
let lastRev = 0;
function takeRev() {
  lastRev = Math.max(lastRev + 1, Date.now());
  return lastRev;
}

// Command ids already handled, process-wide (the native hub can replay a
// buffered command after a remount, the watch can retry one it saw no ack
// for). A duplicate is only acked, never applied twice.
const SEEN_IDS_MAX = 64;
const seenIds = new Set();
function firstSighting(id) {
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  if (seenIds.size > SEEN_IDS_MAX) seenIds.delete(seenIds.values().next().value);
  return true;
}

const triple = (p) => (Array.isArray(p) && p.length === 2 ? p : null);

function greenOf(courseName, holeNumber) {
  const f = holeFeatures(courseName, holeNumber);
  if (!f?.greenCenter) return null;
  return { front: triple(f.greenFront), center: triple(f.greenCenter), back: triple(f.greenBack) };
}

// `scores` is the card as I have marked it: { [playerId]: { [hole]: strokes } }.
export function watchInputsOf({
  round, players, meId, scores, shotDetails, currentHole, courseName,
  distances, source, units, statGroups, blocked,
}) {
  const hole = round?.holes?.find((h) => h.number === currentHole);
  const player = players?.find((p) => p.id === meId);
  if (!round || !hole || !player) return { round: null };
  const holeCount = holeCountOf(round);
  const handicap = getPlayingHandicap(round, player);
  const mine = scores?.[meId] ?? {};
  let totalPoints = 0;
  let thru = 0;
  for (const h of round.holes) {
    if (!mine[h.number]) continue;
    thru += 1;
    totalPoints += calcStablefordPoints(h.par, mine[h.number], handicap, h.strokeIndex, holeCount);
  }
  const strokes = mine[currentHole] ?? null;
  const detail = shotDetails?.[meId]?.[currentHole] ?? null;
  return {
    round: { id: round.id }, // all watchStateOf reads; keeps the dedupe key small
    courseName,
    holeNumber: currentHole,
    holeCount,
    par: hole.par,
    si: hole.strokeIndex,
    extraShots: calcExtraShots(handicap, hole.strokeIndex, holeCount),
    green: greenOf(courseName, currentHole),
    phoneDistances: distances ? {
      front: distances.front ?? null,
      center: distances.center ?? null,
      back: distances.back ?? null,
      source: source ?? 'gps',
    } : null,
    units,
    me: {
      playerId: meId,
      name: player.name,
      strokes,
      points: strokes ? calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex, holeCount) : null,
      totalPoints,
      thru,
      putts: detail?.putts ?? null,
      driveLie: driveLieFromDetail(detail),
      sandShots: detail?.sandShots ?? 0,
      otherPenalties: detail?.otherPenalties ?? 0,
    },
    track: statGroups ?? {},
    blocked,
  };
}

// `getCurrentHole` reads the hole the scorecard is on right now (a ref), not as
// of the last render: a command queued behind a hole move must see the move.
// The handlers may return promises; the ack waits for them.
export function useWatchBridge({
  active, onStrokes, onShot, onGoToHole, getCurrentHole, ...inputs
}) {
  const [ackTick, setAckTick] = useState(0);
  const forceRef = useRef(false);
  const last = useRef(null); // { key, center } of the last state pushed
  // The hole the watch was last told about, and the rev since which it has
  // stood there by the phone's doing. A move the watch itself asked for keeps
  // the old rev: the watch's later commands still carry their older baseRev.
  const holeMark = useRef({ hole: null, rev: 0 });
  const ackRef = useRef(null); // id of the last command processed, see watchStateOf
  const state = active ? watchInputsOf(inputs) : { round: null };

  // The command listener outlives renders; it reads the latest through this.
  const latest = useRef(null);
  latest.current = {
    roundId: state.round?.id ?? null,
    currentHole: inputs.currentHole,
    holeCount: state.holeCount,
    blocked: inputs.blocked ?? null,
    onStrokes, onShot, onGoToHole, getCurrentHole,
  };

  const center = state.phoneDistances?.center ?? null;
  const contentKey = JSON.stringify({
    ...state,
    // phone distances are gated separately, below
    phoneDistances: state.phoneDistances && { source: state.phoneDistances.source, has: center != null },
  });

  useEffect(() => {
    const prev = last.current;
    const moved = prev && prev.center != null && center != null
      && Math.abs(prev.center - center) >= NOTIFICATION_MIN_DELTA_M;
    const forced = forceRef.current;
    if (!forced && prev && prev.key === contentKey && !moved) return;
    forceRef.current = false;
    last.current = { key: contentKey, center };
    const rev = takeRev();
    const hole = state.round ? state.holeNumber : null;
    if (hole !== holeMark.current.hole) holeMark.current = { hole, rev };
    // Only a distance-only refresh may wait for the Data Layer's batching.
    const urgent = forced || !prev || prev.key !== contentKey;
    setWatchState(watchStateOf({ ...state, rev, ack: ackRef.current }), { urgent });
    // `state` is derived from the same inputs contentKey and center summarise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, center, ackTick]);

  const republish = useCallback(() => {
    forceRef.current = true;
    setAckTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    let chain = Promise.resolve();
    const handle = async (json) => {
      if (!live) return;
      const ctx = latest.current;
      const cmd = parseWatchCommand(json);
      if (cmd && !firstSighting(cmd.id)) { ackRef.current = cmd.id; republish(); return; }
      const currentHole = ctx.getCurrentHole ? ctx.getCurrentHole() : ctx.currentHole;
      const mark = holeMark.current;
      const decision = decideWatchCommand(cmd, {
        ...ctx,
        currentHole,
        holeRev: currentHole === mark.hole ? mark.rev : Infinity,
      });
      try {
        if (decision.kind === 'strokes') await ctx.onStrokes(decision.hole, decision.value);
        else if (decision.kind === 'shot') await ctx.onShot(decision.hole, decision.patch);
        else if (decision.kind === 'hole') {
          await ctx.onGoToHole(decision.to);
          const now = ctx.getCurrentHole ? ctx.getCurrentHole() : decision.to;
          if (now === decision.to) holeMark.current = { hole: now, rev: mark.rev };
        }
      } catch {
        // A handler failure is just a rejected command: the republish below
        // tells the watch what the phone really has.
      }
      // An unparseable message has no id to ack; the republish still goes out.
      if (cmd) ackRef.current = cmd.id;
      if (live) republish();
    };
    const sub = addWatchCommandListener((json) => {
      chain = chain.then(() => handle(json)).catch(() => undefined);
      return chain;
    });
    return () => {
      live = false;
      sub.remove();
      // Leaving the scorecard: the watch must not keep showing a stale hole.
      last.current = null;
      holeMark.current = { hole: null, rev: 0 };
      setWatchState(watchStateOf({ rev: takeRev(), ack: ackRef.current, round: null }), { urgent: true });
    };
  }, [republish]);
}
