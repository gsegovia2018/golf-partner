import { figureLift } from '../figureLift';

describe('figureLift', () => {
  it('lifts descending figures more than x-height ones', () => {
    expect(figureLift(3, 48)).toBeCloseTo(10.8, 1);
    expect(figureLift(2, 48)).toBeCloseTo(7.3, 1);
    expect(figureLift(8, 48)).toBeCloseTo(2.95, 1);
  });

  it('centres a multi-digit number on its combined ink', () => {
    expect(figureLift('10', 48)).toBeCloseTo(7.5, 1);
  });

  it('leaves anything that is not a number alone', () => {
    expect(figureLift('—', 48)).toBe(0);
    expect(figureLift(null, 48)).toBe(0);
    expect(figureLift('', 48)).toBe(0);
  });
});
