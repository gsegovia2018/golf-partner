import { parseHandicapIndex, normalizeHandicapInput } from '../handicap';

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

  // Comma-locale Android devices emit a comma decimal separator from the
  // `decimal-pad` keyboard (e.g. "12,5"). Without this, the value fails to
  // parse and every call site used to silently coerce it to 0, badly
  // skewing net scoring. See task-5-brief.md.
  it('accepts a comma decimal separator (comma-locale keyboards)', () => {
    expect(parseHandicapIndex('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseHandicapIndex('0,5')).toEqual({ ok: true, value: 0.5 });
    expect(parseHandicapIndex('54,0')).toEqual({ ok: true, value: 54 });
  });

  it('trims whitespace around a comma-decimal value', () => {
    expect(parseHandicapIndex('  13,4 ')).toEqual({ ok: true, value: 13.4 });
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

  it('still rejects garbage and out-of-range values rather than falling back to 0', () => {
    expect(parseHandicapIndex('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHandicapIndex('12,,5')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHandicapIndex('99,9')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('normalizeHandicapInput', () => {
  it('replaces a comma decimal separator with a period', () => {
    expect(normalizeHandicapInput('12,5')).toBe('12.5');
  });

  it('leaves a period decimal separator untouched', () => {
    expect(normalizeHandicapInput('12.5')).toBe('12.5');
  });

  it('leaves non-decimal text untouched', () => {
    expect(normalizeHandicapInput('12')).toBe('12');
    expect(normalizeHandicapInput('abc')).toBe('abc');
  });

  it('handles null/undefined by returning an empty string', () => {
    expect(normalizeHandicapInput(null)).toBe('');
    expect(normalizeHandicapInput(undefined)).toBe('');
  });

  it('coerces a JS number to its string form', () => {
    expect(normalizeHandicapInput(12.5)).toBe('12.5');
  });
});
