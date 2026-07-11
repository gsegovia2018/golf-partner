import { roundBestBallValues } from '../scoring';

describe('roundBestBallValues', () => {
  const tournament = { settings: { bestBallValue: 2, worstBallValue: 3 } };

  test('round overrides win over tournament settings', () => {
    const round = { bestBallValue: 5, worstBallValue: 4 };
    expect(roundBestBallValues(tournament, round)).toEqual({ bestBallValue: 5, worstBallValue: 4 });
  });

  test('missing round values fall back to settings', () => {
    expect(roundBestBallValues(tournament, {})).toEqual({ bestBallValue: 2, worstBallValue: 3 });
  });

  test('each value falls back independently', () => {
    expect(roundBestBallValues(tournament, { bestBallValue: 7 }))
      .toEqual({ bestBallValue: 7, worstBallValue: 3 });
  });

  test('no settings at all defaults to 1', () => {
    expect(roundBestBallValues({}, {})).toEqual({ bestBallValue: 1, worstBallValue: 1 });
    expect(roundBestBallValues(null, null)).toEqual({ bestBallValue: 1, worstBallValue: 1 });
  });

  test('non-positive, fractional, or string values do not count as present', () => {
    const round = { bestBallValue: 0, worstBallValue: '4' };
    expect(roundBestBallValues(tournament, round)).toEqual({ bestBallValue: 2, worstBallValue: 3 });
    expect(roundBestBallValues({ settings: { bestBallValue: 1.5 } }, {}))
      .toEqual({ bestBallValue: 1, worstBallValue: 1 });
  });
});
