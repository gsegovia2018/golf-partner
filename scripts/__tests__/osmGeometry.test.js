const {
  distinctiveWords, nameMatch, compareParsOsm, resolveGeometry, buildTokens, slugify, buildHoles, inRings,
} = require('../lib/osmGeometry');

describe('names', () => {
  it('drops generic words and diacritics', () => {
    expect(distinctiveWords('Real Club de Golf Sotogrande — Norte')).toEqual(['sotogrande', 'norte']);
    expect(distinctiveWords('Alhaurín Golf')).toEqual(['alhaurin']);
  });
  it('never matches on generic words alone', () => {
    expect(nameMatch('Club de Golf', 'Real Club de Golf de Sevilla').ok).toBe(false);
    expect(nameMatch('Real Club de Golf de Sevilla', 'Club de Golf Sevilla').ok).toBe(true);
    expect(nameMatch('Golf Costa Brava', 'Club de Golf Costa Dorada').ok).toBe(false);
  });
  it('does not match on a shared toponym alone', () => {
    expect(nameMatch('Marbella Golf Country Club', 'Higuerón Marbella Golf Resort').ok).toBe(false);
    expect(nameMatch('Marbella Club', 'Marbella Club Golf Resort').ok).toBe(true);
  });
  it('flags exact club names as strong', () => {
    expect(nameMatch('Golf Lerma', 'Golf Lerma').strong).toBe(true);
    expect(nameMatch('Aloha Golf', 'Aloha Golf Club Marbella — P&P').strong).toBe(false);
  });
  it('slugifies', () => {
    expect(slugify('Club de Golf Costa Brava — Verde')).toBe('club-de-golf-costa-brava-verde');
  });
});

describe('pars', () => {
  const lib = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  it('compares only tagged holes', () => {
    const osm = lib.map((p, i) => (i < 12 ? p : null));
    expect(compareParsOsm(osm, lib)).toEqual({ checked: 12, ok: true });
    osm[3] = 4;
    expect(compareParsOsm(osm, lib).ok).toBe(false);
  });
});

describe('tokens', () => {
  const lib = [
    { id: 'a', name: 'Club Sur — Norte' },
    { id: 'b', name: 'Club Sur — Sur' },
    { id: 'c', name: 'Club de Campo Algo' },
  ];
  it('resolves like findCourseGeometry: most tokens win, ties keep first', () => {
    const g = [{ id: 'x', matchTokens: [['club']] }, { id: 'y', matchTokens: [['club', 'sur']] }];
    expect(resolveGeometry('Club Sur', g).id).toBe('y');
    expect(resolveGeometry('Club Norte', g).id).toBe('x');
  });
  it('builds a group unique to the target', () => {
    expect(buildTokens(lib[0], lib, [], 'k').tokens).toEqual(['sur', 'norte']);
  });
  it('rejects when a sibling name would match too', () => {
    const l = [{ id: 'a', name: 'Foo Golf' }, { id: 'b', name: 'Foo Golf — P&P' }];
    expect(buildTokens(l[0], l, [], 'k').reason).toMatch(/clash/);
  });
  it('rejects a group that would hijack a course with existing geometry', () => {
    const l = [{ id: 'a', name: 'Club de Campo Zagaleta' }, { id: 'c', name: 'Club de Campo Villa' }];
    const existing = [{ id: 'old', matchTokens: [['club de campo']] }];
    // distinctive [zagaleta] ties 1 token with the existing group, which wins
    // the tie; the wider fallback group beats it without touching 'c'.
    expect(buildTokens(l[0], l, existing, 'k').tokens).toEqual(['club', 'campo', 'zagaleta']);
  });
});

const line = (n, lat) => ({
  type: 'way',
  tags: { golf: 'hole', ref: String(n), par: '4' },
  geometry: [{ lat, lon: 0 }, { lat: lat + 0.001, lon: 0 }],
});
const green = (lat) => ({
  type: 'way', tags: { golf: 'green' },
  geometry: [{ lat, lon: 0 }, { lat: lat + 0.0001, lon: 0 }, { lat, lon: 0.0001 }],
});
const eighteen = () => [...Array(18)].map((_, i) => line(i + 1, i * 0.01));

describe('buildHoles', () => {
  it('builds 18 holes with greens and nearby hazards', () => {
    const els = [...eighteen(), ...[...Array(18)].map((_, i) => green(i * 0.01 + 0.001)),
      { type: 'way', tags: { golf: 'bunker' }, geometry: [{ lat: 0.0005, lon: 0.0002 }, { lat: 0.0006, lon: 0.0002 }] }];
    const r = buildHoles(els);
    expect(r.holes).toHaveLength(18);
    expect(r.greensMatched).toBe(18);
    expect(r.holes[0].hazards).toHaveLength(1);
    expect(r.flags).toEqual([]);
  });
  it('rejects duplicates, extras and gaps', () => {
    expect(buildHoles([...eighteen(), line(3, 0.5)]).reason).toMatch(/duplicate/);
    expect(buildHoles([...eighteen(), line(19, 0.5)]).reason).toMatch(/outside 1-18/);
    expect(buildHoles(eighteen().slice(1)).reason).toMatch(/missing/);
  });
  it('flags a far green and ignores non-numeric refs', () => {
    const odd = { ...line(5, 0.9), tags: { golf: 'hole', ref: 'A' } };
    const r = buildHoles([...eighteen(), odd, green(0.5)]);
    expect(r.flags.some((f) => /no green|from line end/.test(f))).toBe(true);
  });
  it('aims at the line end when the nearest green belongs to another hole', () => {
    const r = buildHoles([...eighteen(), green(0.001)]); // only hole 1's green is mapped
    expect(r.holes[0].green).not.toBeNull();
    expect(r.holes[1].green).toBeNull();
    expect(r.holes[1].greenCenter).toEqual([0.011, 0]);
    expect(r.flags).toContain('hole 2: green 1108m from line end, aiming at the line end');
  });
  it('drops hole ways outside the outline', () => {
    const ring = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    expect(inRings([0, 0], [ring])).toBe(true);
    expect(buildHoles([...eighteen(), line(1, 5)], [ring]).holes).toHaveLength(18);
    expect(buildHoles([...eighteen().slice(1), line(1, 5)], [ring]).reason).toMatch(/missing/);
  });
});
