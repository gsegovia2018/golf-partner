import {
  normalizeStakes, hasStakes, parseEuros, formatEuros,
  potBalances, perPointBalances, skinsBalances, settleUp, stakeLedger,
} from '../sideBets';

// Scratch players on par-4 holes: points = 2 + (4 - strokes).
const players = ['marcos', 'javier', 'pablo', 'inigo'].map((id) => ({ id, name: id, handicap: 0 }));

function game(strokesById, { mode = 'individual', stakes, roster = players } = {}) {
  const n = Object.values(strokesById)[0]?.length ?? 3;
  const holes = Array.from({ length: n }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const scores = Object.fromEntries(Object.entries(strokesById).map(([id, arr]) => [
    id, Object.fromEntries(arr.map((s, i) => [i + 1, s])),
  ]));
  return {
    id: 't1',
    players: roster,
    currentRound: 0,
    settings: { scoringMode: mode, stakes },
    rounds: [{
      id: 't1-r0', courseName: 'La Moraleja', holes,
      playerHandicaps: Object.fromEntries(roster.map((p) => [p.id, 0])),
      scores,
    }],
  };
}

const sum = (bal) => Object.values(bal).reduce((s, v) => s + v, 0);

describe('stakes input and display', () => {
  test('normalizeStakes keeps positive integer cents only', () => {
    expect(normalizeStakes({ pot: 1000, perPoint: -5, skin: 1.5 })).toEqual({ pot: 1000, perPoint: 0, skin: 0 });
    expect(normalizeStakes(undefined)).toEqual({ pot: 0, perPoint: 0, skin: 0 });
    expect(hasStakes({ skin: 100 })).toBe(true);
    expect(hasStakes(null)).toBe(false);
  });

  test('parseEuros takes dots or commas, blank is off, junk is null', () => {
    expect(parseEuros('0.50')).toBe(50);
    expect(parseEuros('0,5')).toBe(50);
    expect(parseEuros('10')).toBe(1000);
    expect(parseEuros(' ')).toBe(0);
    expect(parseEuros('abc')).toBeNull();
    expect(parseEuros('-1')).toBeNull();
    expect(parseEuros('1.234')).toBeNull();
  });

  test('formatEuros by hand in both languages', () => {
    expect(formatEuros(2750, {}, 'en')).toBe('€27.50');
    expect(formatEuros(2750, {}, 'es')).toBe('27,50\u00A0€');
    expect(formatEuros(-350, { sign: true }, 'en')).toBe('−\u2060€3.50');
    expect(formatEuros(4650, { sign: true }, 'es')).toBe('+\u206046,50\u00A0€');
    expect(formatEuros(0, { sign: true }, 'en')).toBe('€0.00');
    // No break opportunity anywhere inside an amount.
    expect(formatEuros(-1200, { sign: true }, 'es')).not.toMatch(/ /);
  });
});

describe('pot', () => {
  test('the leader takes everyone\'s stake', () => {
    const t = game({ marcos: [3, 4, 4], javier: [4, 4, 4], pablo: [5, 4, 4], inigo: [5, 5, 4] });
    expect(potBalances(t, 1000)).toEqual({ marcos: 3000, javier: -1000, pablo: -1000, inigo: -1000 });
  });

  test('a tie splits the pot and hands the odd cents out one each', () => {
    const roster = players.slice(0, 3);
    const t = game({ marcos: [3, 4, 4], javier: [3, 4, 4], pablo: [5, 4, 4] }, { roster });
    const bal = potBalances(t, 333); // 999 split two ways
    expect(bal).toEqual({ marcos: 167, javier: 166, pablo: -333 });
    expect(sum(bal)).toBe(0);
  });

  test('no scores, or everyone level: nothing changes hands', () => {
    const t = game({ marcos: [4, 4, 4], javier: [4, 4, 4], pablo: [4, 4, 4], inigo: [4, 4, 4] });
    expect(sum(Object.values(potBalances(t, 1000)).map(Math.abs))).toBe(0);
    const empty = game({});
    empty.rounds[0].scores = {};
    expect(Object.values(potBalances(empty, 1000)).every((v) => v === 0)).toBe(true);
  });
});

describe('per point', () => {
  test('each pair settles the gap on the board', () => {
    // points: marcos 7, javier 6, pablo 5, inigo 4
    const t = game({ marcos: [3, 4, 4], javier: [4, 4, 4], pablo: [5, 4, 4], inigo: [5, 5, 4] });
    const bal = perPointBalances(t, 50);
    // marcos: (7-6)+(7-5)+(7-4)=6 points -> 300
    expect(bal).toEqual({ marcos: 300, javier: 100, pablo: -100, inigo: -300 });
    expect(sum(bal)).toBe(0);
  });
});

describe('skins', () => {
  test('a tied hole carries to the next won hole', () => {
    const roster = players.slice(0, 3);
    // hole 1 tie (carry), hole 2 marcos wins 2 skins, hole 3 pablo wins 1.
    const t = game({ marcos: [4, 3, 4], javier: [4, 4, 4], pablo: [5, 4, 3] }, { roster });
    const { balances, carry } = skinsBalances(t, 100);
    expect(balances).toEqual({ marcos: 400 - 100, javier: -200 - 100, pablo: -200 + 200 });
    expect(sum(balances)).toBe(0);
    expect(carry).toBe(0);
  });

  test('a carry still open after the last hole is void', () => {
    const roster = players.slice(0, 2);
    const t = game({ marcos: [3, 4, 4], javier: [4, 4, 4] }, { roster });
    const { balances, carry } = skinsBalances(t, 100);
    expect(balances).toEqual({ marcos: 100, javier: -100 });
    expect(carry).toBe(2);
  });

  test('scramble rounds play no skins', () => {
    const t = game({ marcos: [3, 3, 3], javier: [4, 4, 4], pablo: [4, 4, 4], inigo: [4, 4, 4] }, { mode: 'scramble4' });
    expect(Object.values(skinsBalances(t, 100).balances).every((v) => v === 0)).toBe(true);
  });
});

describe('settleUp', () => {
  test('pays off every balance in at most n-1 transfers', () => {
    const bal = { marcos: 4650, javier: -350, pablo: -1550, inigo: -2750 };
    const out = settleUp(bal);
    expect(out).toEqual([
      { from: 'inigo', to: 'marcos', amount: 2750 },
      { from: 'pablo', to: 'marcos', amount: 1550 },
      { from: 'javier', to: 'marcos', amount: 350 },
    ]);
  });

  test('several creditors: everyone ends square', () => {
    const bal = { a: 500, b: 300, c: -600, d: -200, e: 0 };
    const out = settleUp(bal);
    expect(out.length).toBeLessThanOrEqual(4);
    const after = { ...bal };
    out.forEach(({ from, to, amount }) => { after[from] += amount; after[to] -= amount; });
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  test('all square: no transfers', () => {
    expect(settleUp({ a: 0, b: 0 })).toEqual([]);
  });
});

describe('stakeLedger', () => {
  test('null when the game has no stakes', () => {
    expect(stakeLedger(game({ marcos: [4, 4, 4] }))).toBeNull();
  });

  test('adds the three bets per player and settles the net', () => {
    const t = game(
      { marcos: [3, 4, 4], javier: [4, 4, 4], pablo: [5, 4, 4], inigo: [5, 5, 4] },
      { stakes: { pot: 1000, perPoint: 50, skin: 100 } },
    );
    const l = stakeLedger(t);
    // skins: hole 1 marcos (+300, others -100); holes 2-3 tie -> void carry.
    expect(l.byPlayer.marcos).toEqual({ pot: 3000, perPoint: 300, skin: 300, net: 3600 });
    expect(l.byPlayer.inigo).toEqual({ pot: -1000, perPoint: -300, skin: -100, net: -1400 });
    expect(sum(Object.fromEntries(Object.entries(l.byPlayer).map(([k, v]) => [k, v.net])))).toBe(0);
    expect(l.transfers.every((x) => x.to === 'marcos')).toBe(true);
    expect(l.transfers.reduce((s, x) => s + x.amount, 0)).toBe(3600);
  });
});
