const {
  CLUBS,
  decodeEntities,
  parseTrazadoOptions,
} = require('../lib/madridCourses');

describe('CLUBS', () => {
  test('lists 29 Madrid clubs, each with code/name/path', () => {
    expect(CLUBS).toHaveLength(29);
    for (const c of CLUBS) {
      expect(typeof c.code).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(c.path).toMatch(/^\/(club|cmd)\//);
    }
  });

  test('Mistral Samaranch uses the /cmd/ route', () => {
    const mistral = CLUBS.find((c) => c.code === 'CMD9');
    expect(mistral.path).toBe('/cmd/CMD9');
  });
});

describe('decodeEntities', () => {
  test('decodes named, numeric and ampersand entities', () => {
    expect(decodeEntities('P&amp;P')).toBe('P&P');
    expect(decodeEntities('La Herrer&iacute;a')).toBe('La Herrería');
    expect(decodeEntities('A&#241;o')).toBe('Año');
  });

  test('returns empty string for nullish input', () => {
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
  });

  test('decodes hex numeric entities (lower and upper case)', () => {
    expect(decodeEntities('A&#xf1;o')).toBe('Año');
    expect(decodeEntities('A&#XF1;o')).toBe('Año');
  });
});

describe('parseTrazadoOptions', () => {
  const HTML = `
    <div><select name="x" id="trazados">
      <option value="1068">LA HERRERIA - La Herreria</option>
      <option value="656">LA MORALEJA - P&amp;P</option>
    </select></div>`;

  test('extracts id + decoded text for each option', () => {
    expect(parseTrazadoOptions(HTML)).toEqual([
      { id: '1068', text: 'LA HERRERIA - La Herreria' },
      { id: '656', text: 'LA MORALEJA - P&P' },
    ]);
  });

  test('returns [] when there is no trazados select', () => {
    expect(parseTrazadoOptions('<div>no select here</div>')).toEqual([]);
  });
});

const { deriveCourseName } = require('../lib/madridCourses');

describe('deriveCourseName', () => {
  test('single-trazado club → bare club name', () => {
    expect(
      deriveCourseName('Real Club de Golf La Herrería', 'LA HERRERIA - La Herreria', 1),
    ).toBe('Real Club de Golf La Herrería');
  });

  test('multi-trazado club → "Club — Trazado", short name after last " - "', () => {
    expect(
      deriveCourseName('Real Club La Moraleja', 'LA MORALEJA - Campo 1', 4),
    ).toBe('Real Club La Moraleja — Campo 1');
  });

  test('multi-trazado with no " - " separator → "Club — fullText"', () => {
    expect(deriveCourseName('Some Club', 'Recorrido Norte', 2))
      .toBe('Some Club — Recorrido Norte');
  });
});

const { buildHoles, validateStrokeIndex } = require('../lib/madridCourses');

describe('buildHoles', () => {
  test('18 holes → numbered 1..18 with par + strokeIndex', () => {
    const par = [4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4];
    const hcp = [7, 17, 3, 11, 1, 15, 5, 9, 13, 8, 18, 4, 12, 2, 16, 6, 10, 14];
    const holes = buildHoles(par, hcp);
    expect(holes).toHaveLength(18);
    expect(holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 7 });
    expect(holes[17]).toEqual({ number: 18, par: 4, strokeIndex: 14 });
  });

  test('drops "A" void holes and renumbers (9-hole course)', () => {
    const par = [4, 3, 5, 4, 4, 3, 5, 4, 4, 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'];
    const hcp = [3, 7, 1, 5, 9, 8, 2, 6, 4, '', '', '', '', '', '', '', '', ''];
    const holes = buildHoles(par, hcp);
    expect(holes).toHaveLength(9);
    expect(holes.map((h) => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holes[8]).toEqual({ number: 9, par: 4, strokeIndex: 4 });
  });
});

describe('validateStrokeIndex', () => {
  test('valid when indices are exactly 1..N', () => {
    const holes = [
      { number: 1, par: 4, strokeIndex: 2 },
      { number: 2, par: 3, strokeIndex: 1 },
      { number: 3, par: 5, strokeIndex: 3 },
    ];
    expect(validateStrokeIndex(holes)).toEqual({ valid: true });
  });

  test('invalid when an index is duplicated or out of range', () => {
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 3, strokeIndex: 1 },
      { number: 3, par: 5, strokeIndex: 9 },
    ];
    const res = validateStrokeIndex(holes);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('1..3');
  });

  test('invalid for an empty hole list', () => {
    expect(validateStrokeIndex([]).valid).toBe(false);
  });
});
