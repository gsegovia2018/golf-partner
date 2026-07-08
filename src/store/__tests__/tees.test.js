import { middleTee, teeByLabel, blankTee, resolveTeeForPlayer } from '../tees';

describe('middleTee', () => {
  it('returns null for an empty or missing tee list', () => {
    expect(middleTee([])).toBeNull();
    expect(middleTee(undefined)).toBeNull();
  });

  it('returns the only tee for a single-tee list', () => {
    const tees = [{ label: 'White' }];
    expect(middleTee(tees)).toBe(tees[0]);
  });

  it('returns the middle tee (floor index) for an odd-length list', () => {
    const tees = [{ label: 'Black' }, { label: 'White' }, { label: 'Red' }];
    expect(middleTee(tees)).toBe(tees[1]);
  });

  it('returns the lower-middle tee for an even-length list', () => {
    const tees = [{ label: 'Black' }, { label: 'Blue' }, { label: 'White' }, { label: 'Red' }];
    expect(middleTee(tees)).toBe(tees[2]); // floor(4/2) = 2
  });
});

describe('teeByLabel', () => {
  const tees = [{ label: 'White' }, { label: 'Yellow' }];

  it('finds a tee by exact label', () => {
    expect(teeByLabel(tees, 'Yellow')).toBe(tees[1]);
  });

  it('matches case-insensitively and trims', () => {
    expect(teeByLabel(tees, '  yellow ')).toBe(tees[1]);
  });

  it('returns null when nothing matches or inputs are missing', () => {
    expect(teeByLabel(tees, 'Red')).toBeNull();
    expect(teeByLabel(undefined, 'White')).toBeNull();
    expect(teeByLabel(tees, null)).toBeNull();
  });
});

describe('blankTee', () => {
  it('creates a tee with an id and empty fields', () => {
    const t = blankTee();
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
    expect(t).toMatchObject({ label: '', rating: null, slope: null });
  });

  it('gives distinct ids', () => {
    expect(blankTee().id).not.toBe(blankTee().id);
  });
});

describe('resolveTeeForPlayer', () => {
  const tee = { id: 't1', label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 };

  it('returns women\'s rating/slope for female players', () => {
    expect(resolveTeeForPlayer(tee, 'female')).toEqual({ label: 'Amarillas', rating: 79.3, slope: 151 });
  });

  it('returns base rating/slope for male players', () => {
    expect(resolveTeeForPlayer(tee, 'male')).toEqual({ label: 'Amarillas', rating: 72.7, slope: 141 });
  });

  it('falls back to base values when women\'s columns are missing', () => {
    const plain = { label: 'Rojas', rating: 67.6, slope: 131 };
    expect(resolveTeeForPlayer(plain, 'female')).toEqual({ label: 'Rojas', rating: 67.6, slope: 131 });
  });

  it('treats null/undefined gender as male', () => {
    expect(resolveTeeForPlayer(tee, null)).toEqual({ label: 'Amarillas', rating: 72.7, slope: 141 });
    expect(resolveTeeForPlayer(tee, undefined).slope).toBe(141);
  });

  it('returns null for a missing tee', () => {
    expect(resolveTeeForPlayer(null, 'female')).toBeNull();
  });

  it('blankTee carries empty women\'s fields', () => {
    const t = blankTee();
    expect(t.ratingWomen).toBeNull();
    expect(t.slopeWomen).toBeNull();
  });
});
