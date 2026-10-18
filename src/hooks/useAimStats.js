import { useEffect, useState } from 'react';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';

// The slice of the owner's personal stats the aim tips read (aimTip.js,
// holeBriefing.js). Computed ONCE per mount from the saved rounds (same
// default selection as My Stats), never per score or per hole: a briefing is
// about the pattern built before today's round, and computeMyStats is too
// heavy to sit on the scorecard's render path. Null until loaded, and for
// anyone with no rounds. A fresh object only when it first resolves, so the
// HolePage memo is not disturbed.
export function useAimStats({ userId, enabled }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let live = true;
    (async () => {
      try {
        const [{ list }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        if (!live) return;
        const selected = resolveSelection(collectMyRounds(list, userId, profile?.displayName));
        if (!selected.length) return;
        const all = computeMyStats(selected, { targetHandicap: profile?.targetHandicap ?? 0 });
        if (!live) return;
        setStats({
          approachMissByDistance: all.approachMissByDistance,
          approachTendency: all.approachTendency,
          driveImpact: all.driveImpact,
          driveDistance: all.driveDistance,
        });
      } catch {
        // Best-effort: no stats, no briefing.
      }
    })();
    return () => { live = false; };
  }, [enabled, userId]);
  return enabled ? stats : null;
}
