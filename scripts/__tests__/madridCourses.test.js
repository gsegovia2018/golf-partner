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
