import { roundDifferential } from '../handicapIndex';

// 18 identical holes: par 4, SI = hole number. Total par 72.
const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1,
}));

// Every hole scored `gross`; playerTees carries slope/rating; playerHandicaps
// stores the playing handicap so getPlayingHandicap reads it directly.
function makeMyRound({ gross = 5, slope = 113, rating = 72, playingHandicap = 18, scores } = {}) {
  const scoreMap = scores
    ?? Object.fromEntries(holes.map((h) => [h.number, gross]));
  return {
    key: 't1:0',
    courseName: 'Test Course',
    tournamentDate: '2026-07-01T00:00:00Z',
    playerId: 'p1',
    player: { id: 'p1', handicap: playingHandicap },
    isComplete: true,
    round: {
      holes,
      scores: { p1: scoreMap },
      playerTees: { p1: { slope, rating } },
      playerHandicaps: { p1: playingHandicap },
    },
  };
}

describe('roundDifferential', () => {
  it('computes (113/slope) × (AGS − rating) to one decimal', () => {
    // 18 bogeys = 90 gross, hcp 18 → net double bogey cap is par+2+1=7,
    // no hole capped. Differential = (113/113) × (90 − 72) = 18.0
    const d = roundDifferential(makeMyRound({ gross: 5 }));
    expect(d).toMatchObject({ differential: 18, ags: 90, slope: 113, rating: 72 });
  });

  it('applies the slope factor', () => {
    // (113/126) × (90 − 70.5) = 17.488… → 17.5
    const d = roundDifferential(makeMyRound({ gross: 5, slope: 126, rating: 70.5 }));
    expect(d.differential).toBe(17.5);
  });

  it('caps holes at net double bogey', () => {
    // hcp 18 → 1 extra shot per hole → cap 4+2+1 = 7. A 10 counts as 7.
    const scores = Object.fromEntries(holes.map((h) => [h.number, h.number === 1 ? 10 : 5]));
    const d = roundDifferential(makeMyRound({ scores }));
    expect(d.ags).toBe(17 * 5 + 7); // 92
  });

  it('respects plus-handicap stroke giving in the cap', () => {
    // hcp -2 → gives a stroke back on the two easiest holes (SI 17, 18):
    // cap there is par+2−1 = 5, elsewhere par+2 = 6.
    const scores = Object.fromEntries(holes.map((h) => [h.number, 9]));
    const d = roundDifferential(makeMyRound({ scores, playingHandicap: -2 }));
    expect(d.ags).toBe(16 * 6 + 2 * 5); // 106
  });

  it('returns null for incomplete rounds', () => {
    const r = makeMyRound();
    r.isComplete = false;
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null for non-18-hole rounds', () => {
    const r = makeMyRound();
    r.round = { ...r.round, holes: holes.slice(0, 9) };
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null when slope or rating is missing', () => {
    expect(roundDifferential(makeMyRound({ slope: null, rating: 72 }))).toBeNull();
    expect(roundDifferential(makeMyRound({ slope: 113, rating: null }))).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(roundDifferential(null)).toBeNull();
    expect(roundDifferential(undefined)).toBeNull();
  });
});
