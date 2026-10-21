import {
  toneColor, toneFill, toneSurface, toneOfDirection, toneOfSigned, toneOfSeries, scoreBandColors,
} from '../tone';
import { light, dark, semantic } from '../tokens';

const themeOf = (colors, mode) => ({
  ...colors,
  semantic,
  isDark: mode === 'dark',
  destructive: mode === 'dark' ? semantic.destructive.dark : semantic.destructive.light,
});
const L = themeOf(light, 'light');
const D = themeOf(dark, 'dark');

describe('the tone rule', () => {
  test('good is the accent green, mid is ink, bad is red — the round report colours', () => {
    expect(toneColor(L, 'good')).toBe('#006747');
    expect(toneColor(L, 'neutral')).toBe('#1a1a1a');
    expect(toneColor(L, 'bad')).toBe('#c8102e');
    expect(toneColor(D, 'good')).toBe('#4fae8a');
    expect(toneColor(D, 'neutral')).toBe('#f0f2f5');
    expect(toneColor(D, 'bad')).toBe('#f87171');
  });

  test('surfaces match the colours, washes come from tokens', () => {
    expect(toneSurface(L, 'good')).toBe(toneColor(L, 'good'));
    expect(toneSurface(L, 'neutral')).toBe(L.text.primary);
    expect(toneSurface(D, 'bad')).toBe('#f87171');
    expect(toneFill(L, 'bad')).toBe(semantic.destructive.washLight);
    expect(toneFill(D, 'bad')).toBe(semantic.destructive.washDark);
    expect(toneFill(L, 'good')).toBe(L.accent.light);
    expect(toneFill(L, 'neutral')).toBe(L.bg.secondary);
  });

  test('direction and sign map to tones; zero is mid, never green', () => {
    expect(toneOfDirection('up')).toBe('good');
    expect(toneOfDirection('down')).toBe('bad');
    expect(toneOfDirection('flat')).toBe('neutral');
    expect(toneOfDirection(undefined)).toBe('neutral');
    expect(toneOfSigned(0.4)).toBe('good');
    expect(toneOfSigned(-0.4)).toBe('bad');
    expect(toneOfSigned(0)).toBe('neutral');
    expect(toneOfSigned(0.04, 0.05)).toBe('neutral');
    expect(toneOfSigned(null)).toBe('neutral');
  });

  test('a series compares its later half with its earlier half', () => {
    // A handicap coming down is good; going up is bad.
    expect(toneOfSeries([16, 15.5, 14, 13], { lowerIsBetter: true })).toBe('good');
    expect(toneOfSeries([13, 14, 15.5, 16], { lowerIsBetter: true })).toBe('bad');
    // One odd last round does not flip a falling trend.
    expect(toneOfSeries([18, 17, 15, 14, 13, 17], { lowerIsBetter: true })).toBe('good');
    // Points / { value } entries with gaps.
    expect(toneOfSeries([{ value: 40 }, { value: null }, { value: 50 }, { value: 60 }])).toBe('good');
    expect(toneOfSeries([5, 5.05], { tolerance: 0.1 })).toBe('neutral');
    expect(toneOfSeries([7])).toBe('neutral');
  });

  test('on the golf result scale par is ink-grey, not green', () => {
    const bands = scoreBandColors(L);
    expect(bands.birdiePlus).toBe('#006747');
    expect(bands.par).toBe(L.text.secondary);
    expect(bands.worse).toBe('#c8102e');
  });
});
