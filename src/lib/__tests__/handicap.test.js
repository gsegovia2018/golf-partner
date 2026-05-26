import { parseHandicapIndex } from '../handicap';

describe('parseHandicapIndex', () => {
  it('accepts integer strings', () => {
    expect(parseHandicapIndex('0')).toEqual({ ok: true, value: 0 });
    expect(parseHandicapIndex('12')).toEqual({ ok: true, value: 12 });
    expect(parseHandicapIndex('54')).toEqual({ ok: true, value: 54 });
  });

  it('accepts one-decimal strings', () => {
    expect(parseHandicapIndex('12.4')).toEqual({ ok: true, value: 12.4 });
    expect(parseHandicapIndex('0.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseHandicapIndex('  12.4 ')).toEqual({ ok: true, value: 12.4 });
  });

  it('rejects empty input', () => {
    expect(parseHandicapIndex('')).toEqual({ ok: false, reason: 'required' });
    expect(parseHandicapIndex('   ')).toEqual({ ok: false, reason: 'required' });
  });

  it('rejects non-numeric strings', () => {
    expect(parseHandicapIndex('abc').ok).toBe(false);
    expect(parseHandicapIndex('12abc').ok).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(parseHandicapIndex('-1').ok).toBe(false);
  });

  it('rejects values above 54', () => {
    expect(parseHandicapIndex('55').ok).toBe(false);
    expect(parseHandicapIndex('100').ok).toBe(false);
  });

  it('rejects two or more decimal places', () => {
    expect(parseHandicapIndex('12.45').ok).toBe(false);
    expect(parseHandicapIndex('12.456').ok).toBe(false);
  });

  it('rejects trailing dot', () => {
    expect(parseHandicapIndex('12.').ok).toBe(false);
  });

  it('rejects a leading dot (no integer part)', () => {
    expect(parseHandicapIndex('.5').ok).toBe(false);
  });

  it('returns a number, not a string', () => {
    const result = parseHandicapIndex('12.4');
    expect(typeof result.value).toBe('number');
  });
});
