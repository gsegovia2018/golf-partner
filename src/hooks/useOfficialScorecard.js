// Official mode: the RPC round state (flat `members` / `scores` lists from
// useOfficialRound) mapped into the casual render shapes ScorecardScreen
// feeds its views, plus the official-only discrepancy helpers and leaderboard.
// Every value is null / empty when `official` is false.
import { useMemo } from 'react';
import { DEFAULT_SETTINGS } from '../store/tournamentStore';
import { cardDiscrepancyHoles, officialHolesFromCourse } from '../store/officialScoring';
import { buildLeaderboard } from '../store/officialLeaderboard';
import { t as tNow } from '../i18n';

export function useOfficialScorecard({ official, officialData }) {
  // --- Official mode: map RPC round state into the casual render shapes ---
  // The official data layer returns flat `members` / `scores` lists. The
  // existing render (HoleView / HolePage / GridView / totals) consumes a
  // casual `tournament` blob, a `players` array, and a per-player per-hole
  // `scores` map. We build those here and feed them into the SAME state the
  // casual path writes to, so every downstream read stays byte-identical.
  //
  // Player id == roster_id throughout official mode. `editableSource` from
  // the hook decides which cards this device may write.
  const officialTournament = useMemo(() => {
    if (!official || !officialData.round) return null;
    const holes = officialHolesFromCourse(officialData.round.course);
    const players = (officialData.members ?? []).map((m) => ({
      id: m.roster_id,
      name: m.display_name,
      handicap: m.handicap ?? 0,
    }));
    const playerHandicaps = {};
    (officialData.members ?? []).forEach((m) => {
      playerHandicaps[m.roster_id] = m.handicap ?? 0;
    });
    const r = officialData.round;
    return {
      id: r.tournament_id ?? r.id ?? 'official',
      kind: 'official',
      players,
      meId: officialData.myRosterId,
      settings: { ...DEFAULT_SETTINGS },
      currentRound: 0,
      rounds: [{
        id: r.id,
        courseName: r.course_name ?? r.name ?? tNow('game.official.round'),
        holes,
        playerHandicaps,
        pairs: [],
        scores: {},
        shotDetails: {},
        notes: {},
      }],
    };
  }, [official, officialData.round, officialData.members, officialData.myRosterId]);

  // Flatten official `scores` rows into the casual { [playerId]: { [hole]:
  // strokes } } map. A subject can have up to two rows per hole (its own
  // `self` entry and its marker's `marker` entry). For display we show, per
  // subject, the entry THIS device is responsible for — `self` for our own
  // card, `marker` for the player we mark — falling back to whichever row
  // exists. That mirrors what `setScore` would write, so the stepper and the
  // displayed number stay consistent on the writing device. (Cross-device
  // discrepancy surfacing is Task 15.)
  const officialScores = useMemo(() => {
    if (!official) return null;
    // chosen[pid][hole] = { strokes, source } — the row currently picked
    // for display. A later row replaces it only when it better matches the
    // device's preferred source for that subject.
    const chosen = {};
    for (const row of (officialData.scores ?? [])) {
      const pid = row.subject_roster_id;
      if (pid == null) continue;
      const wanted = officialData.editableSource(pid); // 'self' | 'marker' | null
      const byHole = (chosen[pid] = chosen[pid] ?? {});
      const prev = byHole[row.hole];
      if (
        prev === undefined
        // Upgrade to the preferred source if a non-preferred row was picked.
        || (wanted && row.source === wanted && prev.source !== wanted)
      ) {
        byHole[row.hole] = { strokes: row.strokes, source: row.source };
      }
    }
    // Flatten to the casual { [playerId]: { [hole]: strokes } } shape.
    const map = {};
    for (const pid of Object.keys(chosen)) {
      map[pid] = {};
      for (const hole of Object.keys(chosen[pid])) {
        map[pid][hole] = chosen[pid][hole].strokes;
      }
    }
    return map;
  }, [official, officialData.scores, officialData.editableSource]);

  // ── Official discrepancy surfacing (Task 15) ───────────────────────────
  // The casual `scores` blob collapses each player/hole to ONE number, so it
  // can't show a self-vs-marker mismatch. These helpers read the raw two-row
  // `officialData.scores` list instead. All of this is official-only; casual
  // mode never touches `officialDiscrepancy`.
  const officialDiscrepancy = useMemo(() => {
    if (!official) return null;
    const rows = officialData.scores ?? [];
    const members = officialData.members ?? [];
    // Both entries for one subject on one hole: { self, marker } strokes.
    const cellEntries = (subjectRosterId, holeNumber) => {
      let self = null;
      let marker = null;
      for (const r of rows) {
        if (r.subject_roster_id !== subjectRosterId || r.hole !== holeNumber) continue;
        if (r.source === 'self') self = r.strokes;
        else if (r.source === 'marker') marker = r.strokes;
      }
      return { self, marker };
    };
    // Display name of whoever marks `subjectRosterId` (for labelling the
    // read-only side of the resolve sheet).
    const markerNameFor = (subjectRosterId) => {
      const m = members.find((x) => x.marks_roster_id === subjectRosterId && !x.withdrawn);
      return m?.display_name ?? tNow('scorecard.discrepancy.marker');
    };
    return {
      cellEntries,
      markerNameFor,
      // The token holder's own discrepancy holes — ascending hole numbers.
      myHoles: cardDiscrepancyHoles(rows, officialData.myRosterId),
    };
  }, [official, officialData.scores, officialData.members, officialData.myRosterId]);

  // Official-only: ranked NET Stableford leaderboard rows built from the
  // flat members / scores lists, using the round's real course holes for
  // par/stroke-index (see officialLeaderboard.js). Discrepancy holes are
  // excluded from each total and flagged on the row. Casual mode never
  // builds this.
  const officialLeaderboard = useMemo(() => {
    if (!official) return [];
    return buildLeaderboard({
      members: officialData.members ?? [],
      scores: officialData.scores ?? [],
      holes: officialHolesFromCourse(officialData.round?.course),
      format: 'net_stableford',
    });
  }, [official, officialData.members, officialData.scores, officialData.round]);

  return { officialTournament, officialScores, officialDiscrepancy, officialLeaderboard };
}
