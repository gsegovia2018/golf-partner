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
    expect(parseHandicapIndex('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHandicapIndex('12abc')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects negative numbers', () => {
    expect(parseHandicapIndex('-1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects values above 54', () => {
    expect(parseHandicapIndex('55')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHandicapIndex('100')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects two or more decimal places', () => {
    expect(parseHandicapIndex('12.45')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHandicapIndex('12.456')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects trailing dot', () => {
    expect(parseHandicapIndex('12.')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a leading dot (no integer part)', () => {
    expect(parseHandicapIndex('.5')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('returns a number, not a string', () => {
    const result = parseHandicapIndex('12.4');
    expect(typeof result.value).toBe('number');
  });

  it('accepts a JS number (stored values re-passed as numbers)', () => {
    expect(parseHandicapIndex(12)).toEqual({ ok: true, value: 12 });
    expect(parseHandicapIndex(12.4)).toEqual({ ok: true, value: 12.4 });
    expect(parseHandicapIndex(0)).toEqual({ ok: true, value: 0 });
  });
});
