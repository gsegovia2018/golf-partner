import { cardCellBasis } from '../CardGrid';

describe('cardCellBasis', () => {
  test('1 column is full width', () => {
    expect(cardCellBasis(1)).toBe('100%');
  });

  test('2 columns leaves room for the gap', () => {
    // Two cells per row with a gap between -> just under 50%.
    expect(cardCellBasis(2)).toBe('48%');
  });

  test('3 columns leaves room for two gaps', () => {
    expect(cardCellBasis(3)).toBe('31%');
  });

  test('unexpected column counts fall back to full width', () => {
    expect(cardCellBasis(0)).toBe('100%');
    expect(cardCellBasis(5)).toBe('100%');
  });
});
