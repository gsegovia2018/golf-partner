import {
  carriesByClub, clubDistances, clubAverages, typicalCarry, recommendClub,
  clubDetail, longestCarryByHole,
} from '../shotStats';

// Two points ~140m apart (lat delta 0.001259 ≈ 140m) for deterministic carries.
const A = { lat: 40.0, lng: -4.0 };
const step = (m) => m / 111320; // deg latitude per metre

function shot(holeNumber, seq, club, meters, roundId = 'g1') {
  return { roundId, roundIndex: 0, holeNumber, seq, club, holed: false,
    lat: A.lat + step((seq - 1) * meters), lng: A.lng };
}

describe('carriesByClub', () => {
  it('credits each spot club with the carry TO the next spot; the resting spot has none', () => {
    const shots = [
      shot(1, 1, 'driver', 200), // tee: driver played from here, carry 1->2 = 200m
      shot(1, 2, '7i', 200),     // ball: 7i played from here, carry 2->3 = 200m
      shot(1, 3, null, 200),     // where it came to rest, nothing played from it
    ];
    const m = carriesByClub(shots);
    expect(m.get('driver')[0]).toBeCloseTo(200, 0);
    expect(m.get('7i')[0]).toBeCloseTo(200, 0);
  });

  it('does not carry across holes', () => {
    const shots = [shot(1, 1, '7i', 200), shot(2, 1, '7i', 200)];
    expect(carriesByClub(shots).size).toBe(0);
  });
});

describe('clubDistances', () => {
  it('averages multiple carries per club, sorted longest-first', () => {
    const shots = [
      shot(1, 1, '7i', 140), shot(1, 2, null, 140),
      shot(2, 1, '7i', 150), shot(2, 2, null, 150),
      shot(3, 1, 'driver', 230), shot(3, 2, null, 230),
    ];
    const rows = clubDistances(shots);
    expect(rows[0].club).toBe('driver'); // catalog order: driver before 7i
    const seven = rows.find((r) => r.club === '7i');
    expect(seven.count).toBe(2);
    expect(seven.avg).toBeCloseTo(145, 0);
  });
});

describe('typicalCarry', () => {
  it('averages everything when there is too little to judge', () => {
    expect(typicalCarry([100, 110, 120])).toBeCloseTo(110, 5);
  });

  it('drops the thin skull and the cart-path runner', () => {
    // Ten normal 7i carries plus two freaks. The freaks must not move it.
    const normal = [128, 130, 132, 129, 131, 127, 133, 130, 129, 131];
    const clean = typicalCarry(normal);
    expect(typicalCarry([...normal, 178, 160])).toBeCloseTo(clean, 5);
  });

  it('averages only the best 15 strikes, so mishits do not shorten the club', () => {
    // 15 good ones at 150 and a pile of chunks. The club still plays 150.
    const good = Array(15).fill(150);
    const chunks = Array(10).fill(148);
    expect(typicalCarry([...good, ...chunks])).toBeCloseTo(150, 5);
  });

  it('returns null with nothing to average', () => {
    expect(typicalCarry([])).toBeNull();
  });
});

describe('clubAverages', () => {
  it('gives a club its best-strike distance, not its flat mean', () => {
    // A 7i struck well six times and topped once. The flat mean is 138.6; the
    // playing distance stays with the good strikes.
    const shots = [];
    [148, 150, 152, 149, 151, 150, 70].forEach((m, i) => {
      shots.push(shot(i + 1, 1, '7i', m), shot(i + 1, 2, null, m));
    });
    expect(clubAverages(shots).get('7i')).toBeGreaterThan(146);
  });
});

describe('clubDetail', () => {
  it('returns null for a club with no carries', () => {
    expect(clubDetail([], '7i')).toBeNull();
  });

  it('aggregates count, avg, spread and per-round trend', () => {
    const shots = [
      shot(1, 1, '7i', 140, 'g1'), shot(1, 2, null, 140, 'g1'),
      shot(2, 1, '7i', 150, 'g1'), shot(2, 2, null, 150, 'g1'),
      shot(1, 1, '7i', 130, 'g2'), shot(1, 2, null, 130, 'g2'),
    ];
    const d = clubDetail(shots, '7i');
    expect(d.count).toBe(3);
    expect(d.min).toBeCloseTo(130, 0);
    expect(d.max).toBeCloseTo(150, 0);
    expect(d.std).toBeGreaterThan(0);
    expect(d.byRound).toHaveLength(2); // g1 (two shots) then g2
    expect(d.byRound[0].count).toBe(2);
    expect(d.byRound[0].avg).toBeCloseTo(145, 0);
    expect(d.recent[d.recent.length - 1]).toBeCloseTo(130, 0);
  });

  it('locates the longest carry so the screen can reopen that hole', () => {
    const shots = [
      shot(1, 1, '7i', 140, 'g1'), shot(1, 2, null, 140, 'g1'),
      shot(4, 1, '7i', 150, 'g2'), shot(4, 2, null, 150, 'g2'),
    ];
    const d = clubDetail(shots, '7i');
    expect(d.longest.meters).toBeCloseTo(150, 0);
    expect(d.longest.roundId).toBe('g2');
    expect(d.longest.holeNumber).toBe(4);
  });
});

describe('longestCarryByHole', () => {
  it('keeps the longest carry per hole across rounds', () => {
    const shots = [
      shot(1, 1, 'driver', 200, 'g1'), shot(1, 2, null, 200, 'g1'),
      shot(1, 1, 'driver', 230, 'g2'), shot(1, 2, null, 230, 'g2'),
    ];
    const m = longestCarryByHole(shots);
    expect(m.get(1).meters).toBeCloseTo(230, 0);
    expect(m.get(1).roundId).toBe('g2');
  });

  it('teeOnly ignores every carry after the first spot on the hole', () => {
    // 180m drive off the tee, then a 200m second shot — the drive still wins.
    const shots = [
      { roundId: 'g1', roundIndex: 0, holeNumber: 1, seq: 1, club: 'driver', lat: A.lat, lng: A.lng },
      { roundId: 'g1', roundIndex: 0, holeNumber: 1, seq: 2, club: '3w', lat: A.lat + step(180), lng: A.lng },
      { roundId: 'g1', roundIndex: 0, holeNumber: 1, seq: 3, club: null, lat: A.lat + step(380), lng: A.lng },
    ];
    expect(longestCarryByHole(shots).get(1).meters).toBeCloseTo(200, 0);
    const tee = longestCarryByHole(shots, { teeOnly: true }).get(1);
    expect(tee.meters).toBeCloseTo(180, 0);
    expect(tee.club).toBe('driver');
  });

  it('roundKeys restricts the pool to the given rounds', () => {
    const shots = [
      shot(1, 1, 'driver', 200, 'g1'), shot(1, 2, null, 200, 'g1'),
      shot(1, 1, 'driver', 240, 'g2'), shot(1, 2, null, 240, 'g2'),
    ];
    const m = longestCarryByHole(shots, { roundKeys: new Set(['g1|0']) });
    expect(m.get(1).meters).toBeCloseTo(200, 0);
  });
});

describe('recommendClub', () => {
  const bag = ['driver', '7i', '8i', 'pw', 'putter'];

  it('prefers personal data closest to the target', () => {
    const shots = [
      shot(1, 1, '7i', 145), shot(1, 2, null, 145), // 7i carry 145
      shot(2, 1, '8i', 133), shot(2, 2, null, 133), // 8i carry 133
    ];
    const r = recommendClub(140, bag, shots);
    expect(r.club).toBe('7i');
    expect(r.source).toBe('personal');
    expect(r.delta).toBeCloseTo(-5, 0); // 140 - 145
  });

  it('falls back to nominal when no bagged club has data', () => {
    const r = recommendClub(105, bag, []);
    expect(r.source).toBe('nominal');
    expect(r.club).toBe('pw'); // nominal 105
  });

  it('does not return the only-measured club for a distance it does not fit', () => {
    // Only the 7i has data (avg 170). A 123m target should NOT pick the 7i just
    // because it is the sole measured club — the pw's nominal is far closer.
    const shots = [shot(1, 1, '7i', 170), shot(1, 2, null, 170)];
    const r = recommendClub(123, bag, shots);
    expect(r.club).not.toBe('7i');
    expect(r.club).toBe('8i'); // nominal 130, closest to 123
  });

  it('honors a manual override over the measured average', () => {
    const shots = [shot(1, 1, '7i', 170), shot(1, 2, null, 170)];
    // Override the 7i down to 120 — now 123m should land on it.
    const r = recommendClub(123, bag, shots, { '7i': 120 });
    expect(r.club).toBe('7i');
    expect(r.source).toBe('manual');
  });

  it('never recommends the putter and ignores unbagged clubs', () => {
    const r = recommendClub(2, bag, []);
    expect(r.club).not.toBe('putter');
  });

  it('returns null for a non-positive target', () => {
    expect(recommendClub(0, bag, [])).toBeNull();
  });

  it('excludeDriver drops the driver from the candidates', () => {
    // 300m would nominally pick the driver (230); excluded, the 7i (140,
    // longest remaining in this bag) wins instead.
    expect(recommendClub(300, bag, []).club).toBe('driver');
    const r = recommendClub(300, bag, [], null, { excludeDriver: true });
    expect(r.club).toBe('7i');
  });
});
