// A real-shaped casual game: one 18-hole round, 4 players, Best Ball / Worst
// Ball (1 point each), Marcos+Yeyen vs Molden+Charlie. Mirrors the phone
// walkthrough of 2026-10-15. Individual Stableford: Marcos 30, Molden 29,
// Yeyen 27, Charlie 25. The game's own result (the Play board, best/worst-ball
// points): Marcos 5, Yeyen 5, Molden 4.5, Charlie 4.5 — the pairs 10–9.
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4];
const SI = [7, 11, 15, 1, 5, 13, 17, 3, 9, 8, 16, 2, 6, 12, 10, 18, 4, 14];
// Strokes over par per hole, per player (all play off scratch here).
const OVER = {
  bb1: [0, 1, 1, -1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0],
  bb2: [1, 2, 0, -1, 0, 2, 1, 0, 1, 1, 1, 0, 0, 0, 0, -1, 0, 2],
  bb3: [1, 1, 0, 1, 0, -1, 1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 0, 0],
  bb4: [0, 1, 0, 1, 1, 2, 0, -1, 0, 1, 2, 0, -1, 2, 1, -1, 1, 2],
};

const holes = PARS.map((par, i) => ({ number: i + 1, par, strokeIndex: SI[i] }));
const card = (over) => Object.fromEntries(holes.map((h, i) => [h.number, h.par + over[i]]));

const FIXTURE = {
  id: 'bb-game-1',
  kind: 'game',
  name: 'Partida del sábado',
  players: [
    { id: 'bb1', name: 'Marcos Pecker', handicap: 0, user_id: 'u1' },
    { id: 'bb2', name: 'Yeyen', handicap: 0 },
    { id: 'bb3', name: 'Molden', handicap: 0 },
    { id: 'bb4', name: 'Charlie', handicap: 0 },
  ],
  settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1, fixedTeams: false },
  rounds: [{
    id: 'bb-r0',
    courseName: 'La Moraleja',
    holes,
    playerHandicaps: { bb1: 0, bb2: 0, bb3: 0, bb4: 0 },
    pairs: [[{ id: 'bb1' }, { id: 'bb2' }], [{ id: 'bb3' }, { id: 'bb4' }]],
    scores: Object.fromEntries(Object.entries(OVER).map(([id, over]) => [id, card(over)])),
  }],
  currentRound: 0,
  meId: 'bb1',
};

export const bestBallGameFixture = () => JSON.parse(JSON.stringify(FIXTURE));
