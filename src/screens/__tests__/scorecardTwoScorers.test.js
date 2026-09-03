// The two-phone scenario the resume fix exists for, driven end to end through
// the real score.set reducer: one scorer fills a run of holes, the other opens
// the round afterwards. What the second phone must NOT do is inherit those
// holes as its own verified entries.
//
// This pins the whole chain the screen composes at runtime:
//   resumeVerifiedUpTo  → where the watermark restarts on a fresh session
//   authorScores        → the card the hole page renders above that watermark
//   changedScoreCells   → what autoSave writes when a ghost is accepted
//   deriveCell          → the resulting agreement between the two cards
import { applyToTournament } from '../../store/mutate';
import { authorScores, deriveCell } from '../../store/scoreEntries';
import {
  resumeVerifiedUpTo,
  changedScoreCells,
  nextVerifiedUpTo,
  resumeHole,
} from '../ScorecardScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ navigate: () => {}, goBack: () => {} }),
  useRoute: () => ({ params: {} }),
}));

const HOLES = [1, 2, 3, 4].map((number) => ({ number, par: 4, strokeIndex: number }));
const PLAYERS = [{ id: 'pm', name: 'Marcos' }, { id: 'pg', name: 'Guille' }];

const MARCOS = 'marcos-phone';
const GUILLE = 'guille-web';

function freshRound() {
  return { id: 't', rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }] };
}

// One scorer marking every player on a hole, the way the hole page writes it.
function markHole(t, authorId, hole, byPlayer, ts) {
  for (const [playerId, value] of Object.entries(byPlayer)) {
    applyToTournament(t, {
      type: 'score.set', roundId: 'r0', playerId, hole, value, authorId, ts,
    });
  }
}

describe('a scorer who opens the round after a peer has already filled holes', () => {
  // Marcos (round creator, Android) marks both cards on holes 1-3 before
  // Guille's web app ever loads the round.
  function afterMarcosScoredThreeHoles() {
    const t = freshRound();
    markHole(t, MARCOS, 1, { pm: 5, pg: 4 }, 100);
    markHole(t, MARCOS, 2, { pm: 4, pg: 6 }, 200);
    markHole(t, MARCOS, 3, { pm: 3, pg: 5 }, 300);
    return t;
  }

  test('the second phone resumes having verified nothing', () => {
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = authorScores(round, [GUILLE]);

    expect(resumeVerifiedUpTo(HOLES, PLAYERS, mine)).toBe(0);
  });

  test('the second phone lands on hole 1, where its OWN card ends', () => {
    // Not hole 4. Guille has entered nothing yet, so every hole from 1 on is
    // still his to mark — dropping him at the end of Marcos's card would skip
    // him past three holes only he can fill in.
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = resumeVerifiedUpTo(HOLES, PLAYERS, authorScores(round, [GUILLE]));

    expect(resumeHole(HOLES, mine)).toBe(1);
  });

  test('the phone that scored 1-3 lands on hole 4', () => {
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = resumeVerifiedUpTo(HOLES, PLAYERS, authorScores(round, [MARCOS]));

    expect(resumeHole(HOLES, mine)).toBe(4);
  });

  test('landing at the watermark + 1 lets the watermark step forward again', () => {
    // The two resume values are consistent by construction, so walking the
    // round from where it opens advances the watermark contiguously instead
    // of leaving it pinned at 0 for the rest of the round.
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = resumeVerifiedUpTo(HOLES, PLAYERS, authorScores(round, [GUILLE]));
    const landed = resumeHole(HOLES, mine);

    expect(nextVerifiedUpTo(mine, landed)).toBe(mine + 1);
  });

  test("holes 1-3 render off the second phone's own (empty) card, not the merged one", () => {
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = authorScores(round, [GUILLE]);

    // What HolePage reads for `strokes` above the watermark — every cell blank,
    // so each one ghosts Marcos's value instead of pre-filling as Guille's.
    for (const hole of [1, 2, 3]) {
      expect(mine.pm?.[hole]).toBeUndefined();
      expect(mine.pg?.[hole]).toBeUndefined();
      // The merged card (HolePage's `peerScores`) still carries the value that
      // gets shown as the ghost.
      expect(round.scores.pm[hole]).toBeDefined();
    }
  });

  test('the phone that DID score those holes still resumes with them verified', () => {
    // The other half of the asymmetry: this must not regress into hiding a
    // scorer's own work behind ghosts.
    const round = afterMarcosScoredThreeHoles().rounds[0];
    const mine = authorScores(round, [MARCOS]);

    expect(resumeVerifiedUpTo(HOLES, PLAYERS, mine)).toBe(3);
  });

  test('accepting a ghost writes the agreement under the accepting author', () => {
    const t = afterMarcosScoredThreeHoles();
    const round = t.rounds[0];

    // Guille taps the ghost on hole 1 for Marcos's card. The merged card
    // already reads 5, so a plain value diff would write nothing — the cell
    // has to be written anyway or it falls straight back to a ghost.
    const cells = changedScoreCells({
      prevScores: round.scores,
      newScores: round.scores,
      dirtyKeys: new Set(['pm:1']),
      scoreEntries: round.scoreEntries,
      authorId: GUILLE,
    });
    expect(cells).toEqual([{ playerId: 'pm', hole: 1, value: 5 }]);

    for (const c of cells) {
      applyToTournament(t, {
        type: 'score.set', roundId: 'r0', playerId: c.playerId, hole: c.hole,
        value: c.value, authorId: GUILLE, ts: 400,
      });
    }

    // The ghost is gone: the cell is now on Guille's own card too...
    expect(authorScores(round, [GUILLE]).pm[1]).toBe(5);
    // ...and the two authors are recorded as agreeing, not conflicting.
    expect(deriveCell(round, 'pm', 1, [GUILLE]).status).toBe('agreed');
    expect(round.scoreEntries.pm[1][GUILLE]).toEqual({ value: 5, ts: 400 });
    expect(round.scoreEntries.pm[1][MARCOS]).toEqual({ value: 5, ts: 100 });
  });

  test('accepting a ghost is idempotent — a second save writes nothing', () => {
    const t = afterMarcosScoredThreeHoles();
    const round = t.rounds[0];
    applyToTournament(t, {
      type: 'score.set', roundId: 'r0', playerId: 'pm', hole: 1,
      value: 5, authorId: GUILLE, ts: 400,
    });

    expect(changedScoreCells({
      prevScores: round.scores,
      newScores: round.scores,
      dirtyKeys: new Set(['pm:1']),
      scoreEntries: round.scoreEntries,
      authorId: GUILLE,
    })).toEqual([]);
  });

  test('a disagreement still lands as a conflict, not a silent overwrite', () => {
    const t = afterMarcosScoredThreeHoles();
    const round = t.rounds[0];
    // Guille types 6 where Marcos entered 5.
    const next = { ...round.scores, pm: { ...round.scores.pm, 1: 6 } };
    const cells = changedScoreCells({
      prevScores: round.scores,
      newScores: next,
      dirtyKeys: new Set(['pm:1']),
      scoreEntries: round.scoreEntries,
      authorId: GUILLE,
    });
    expect(cells).toEqual([{ playerId: 'pm', hole: 1, value: 6 }]);

    applyToTournament(t, {
      type: 'score.set', roundId: 'r0', playerId: 'pm', hole: 1,
      value: 6, authorId: GUILLE, ts: 400,
    });
    expect(deriveCell(round, 'pm', 1, [GUILLE]).status).toBe('conflict');
  });
});

describe('nextVerifiedUpTo', () => {
  test('walking the holes in order grows the watermark one at a time', () => {
    let v = 0;
    for (const hole of [1, 2, 3, 4]) v = nextVerifiedUpTo(v, hole);
    expect(v).toBe(4);
  });

  test('leaving a hole far above the watermark does not sweep the ones below in', () => {
    // Guille resumed at hole 4 having verified nothing. Walking off hole 4
    // must not retroactively claim holes 1-3, which Marcos scored alone.
    expect(nextVerifiedUpTo(0, 4)).toBe(0);
  });

  test('re-leaving an already verified hole never moves the watermark back', () => {
    expect(nextVerifiedUpTo(3, 2)).toBe(3);
    expect(nextVerifiedUpTo(3, 3)).toBe(3);
  });
});

describe('resumeHole', () => {
  test('a scorer part-way through their own card resumes at the next hole', () => {
    expect(resumeHole(HOLES, 2)).toBe(3);
  });

  test('a fully marked card resumes on the last hole', () => {
    expect(resumeHole(HOLES, 4)).toBe(4);
  });

  test('a completed round opens on the last hole even for a phone that marked nothing', () => {
    // Spectating a finished round: there is nothing left to enter, so the
    // own-card rule must not drop the viewer back to hole 1.
    expect(resumeHole(HOLES, 0, { complete: true })).toBe(4);
  });
});
