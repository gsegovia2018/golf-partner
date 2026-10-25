import { TAB_SETTLE_MS, afterTabSettles, markTabSwitch } from '../tabSettle';

describe('afterTabSettles', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('runs at once outside a tab switch', () => {
    markTabSwitch(Date.now() - TAB_SETTLE_MS);
    const fn = jest.fn();
    afterTabSettles(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('waits for the slide after a tab press, and can be cancelled', () => {
    markTabSwitch();
    const fn = jest.fn();
    const cancelled = jest.fn();
    afterTabSettles(fn);
    afterTabSettles(cancelled)();
    jest.advanceTimersByTime(TAB_SETTLE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
