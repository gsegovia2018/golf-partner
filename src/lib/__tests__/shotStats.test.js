import {
  carriesByClub, clubDistances, recommendClub, clubDetail,
} from '../shotStats';

// Two points ~140m apart (lat delta 0.001259 ≈ 140m) for deterministic carries.
const A = { lat: 40.0, lng: -4.0 };
const step = (m) => m / 111320; // deg latitude per metre

function shot(holeNumber, seq, club, meters, roundId = 'g1') {
  return { roundId, roundIndex: 0, holeNumber, seq, club, holed: false,
    lat: A.lat + step((seq - 1) * meters), lng: A.lng };
}

describe('carriesByClub', () => {
  it('credits each spot club with the carry FROM the previous spot; origin has none', () => {
    const shots = [
      shot(1, 1, null, 200),   // origin (tee), no club
      shot(1, 2, 'driver', 200), // carry 1->2 = 200m credited to driver (got it here)
      shot(1, 3, '7i', 200),   // carry 2->3 = 200m credited to 7i
    ];
    const m = carriesByClub(shots);
    expect(m.get('driver')[0]).toBeCloseTo(200, 0);
    expect(m.get('7i')[0]).toBeCloseTo(200, 0);
  });

  it('does not carry across holes', () => {
    const shots = [shot(1, 1, null, 200), shot(2, 1, '7i', 200)];
    expect(carriesByClub(shots).size).toBe(0);
  });
});

describe('clubDistances', () => {
  it('averages multiple carries per club, sorted longest-first', () => {
    const shots = [
      shot(1, 1, null, 140), shot(1, 2, '7i', 140),
      shot(2, 1, null, 150), shot(2, 2, '7i', 150),
      shot(3, 1, null, 230), shot(3, 2, 'driver', 230),
    ];
    const rows = clubDistances(shots);
    expect(rows[0].club).toBe('driver'); // catalog order: driver before 7i
    const seven = rows.find((r) => r.club === '7i');
    expect(seven.count).toBe(2);
    expect(seven.avg).toBeCloseTo(145, 0);
  });
});

describe('clubDetail', () => {
  it('returns null for a club with no carries', () => {
    expect(clubDetail([], '7i')).toBeNull();
  });

  it('aggregates count, avg, spread and per-round trend', () => {
    const shots = [
      shot(1, 1, null, 140, 'g1'), shot(1, 2, '7i', 140, 'g1'),
      shot(2, 1, null, 150, 'g1'), shot(2, 2, '7i', 150, 'g1'),
      shot(1, 1, null, 130, 'g2'), shot(1, 2, '7i', 130, 'g2'),
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
});

describe('recommendClub', () => {
  const bag = ['driver', '7i', '8i', 'pw', 'putter'];

  it('prefers personal data closest to the target', () => {
    const shots = [
      shot(1, 1, null, 145), shot(1, 2, '7i', 145), // 7i carry 145
      shot(2, 1, null, 133), shot(2, 2, '8i', 133), // 8i carry 133
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

  it('never recommends the putter and ignores unbagged clubs', () => {
    const r = recommendClub(2, bag, []);
    expect(r.club).not.toBe('putter');
  });

  it('returns null for a non-positive target', () => {
    expect(recommendClub(0, bag, [])).toBeNull();
  });
});
