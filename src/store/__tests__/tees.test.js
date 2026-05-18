import { middleTee, teeByLabel, blankTee } from '../tees';

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
