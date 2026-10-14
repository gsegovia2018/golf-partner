import {
  bagLadder, ladderMax, parseDistanceInput, TIGHT_GAP_M,
} from '../bagLadder';

const A = { lat: 40.0, lng: -4.0 };
const step = (m) => m / 111320; // deg latitude per metre

// One tracked carry of `meters` with `club`, on its own hole.
function carry(holeNumber, club, meters) {
  return [
    { roundId: 'g1', roundIndex: 0, holeNumber, seq: 1, club, lat: A.lat, lng: A.lng },
    { roundId: 'g1', roundIndex: 0, holeNumber, seq: 2, club: null, lat: A.lat + step(meters), lng: A.lng },
  ];
}

describe('bagLadder', () => {
  it('picks your number, then measured, then the estimate — and drops the putter', () => {
    const shots = [...carry(1, '7i', 138), ...carry(2, '7i', 142), ...carry(3, '8i', 128)];
    const rows = bagLadder({ bag: ['putter', '8i', '7i', '9i'], shots, overrides: { '7i': 145 } });
    expect(rows.map((r) => r.club)).toEqual(['7i', '8i', '9i']);

    const [seven, eight, nine] = rows;
    expect(seven.source).toBe('mine');
    expect(seven.distance).toBe(145);
    expect(seven.measured).toBeCloseTo(140, 0);
    expect(seven.carries).toHaveLength(2);

    expect(eight.source).toBe('measured');
    expect(eight.distance).toBeCloseTo(128, 0);

    expect(nine.source).toBe('estimate');
    expect(nine.distance).toBe(118);
    expect(nine.carries).toEqual([]);
  });

  it('ignores a cleared (0) override', () => {
    const [row] = bagLadder({ bag: ['7i'], overrides: { '7i': 0 } });
    expect(row.source).toBe('estimate');
    expect(row.mine).toBeNull();
  });

  it('measures the gap to the next club; the shortest has none', () => {
    const rows = bagLadder({ bag: ['5i', '4h', 'pw'], overrides: { '4h': 166, '5i': 162 } });
    expect(rows.map((r) => r.gapToNext)).toEqual([4, 57, null]);
    expect(rows[0].gapToNext).toBeLessThan(TIGHT_GAP_M);
  });

  it('falls back to the default bag when none is set', () => {
    expect(bagLadder({ bag: null }).length).toBe(13);
  });
});

describe('ladderMax', () => {
  it('covers the longest bar or carry, rounded up to 25 m', () => {
    expect(ladderMax([{ distance: 231, carries: [] }])).toBe(250);
    expect(ladderMax([{ distance: 140, carries: [252] }])).toBe(275);
    expect(ladderMax([])).toBe(50);
  });
});

describe('parseDistanceInput', () => {
  it('reads metres and yards into whole metres', () => {
    expect(parseDistanceInput('142', 'meters')).toBe(142);
    expect(parseDistanceInput(' 142,6 ', 'meters')).toBe(143);
    expect(parseDistanceInput('150', 'yards')).toBe(137);
  });

  it('treats empty or 0 as clear and rejects junk', () => {
    expect(parseDistanceInput('', 'meters')).toBe(0);
    expect(parseDistanceInput('0', 'meters')).toBe(0);
    expect(parseDistanceInput('abc', 'meters')).toBeNull();
    expect(parseDistanceInput('-5', 'meters')).toBeNull();
  });
});
