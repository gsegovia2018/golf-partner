import {
  beginStackTransition, endStackTransition, isStackTransitioning, stackTransitionListeners,
} from '../stackTransition';

describe('stackTransition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    endStackTransition('a');
    endStackTransition('b');
    jest.useRealTimers();
  });

  it('stays on until every moving screen has ended', () => {
    stackTransitionListeners.transitionStart({ target: 'a' });
    stackTransitionListeners.transitionStart({ target: 'b' });
    expect(isStackTransitioning()).toBe(true);
    stackTransitionListeners.transitionEnd({ target: 'a' });
    expect(isStackTransitioning()).toBe(true);
    stackTransitionListeners.transitionEnd({ target: 'b' });
    expect(isStackTransitioning()).toBe(false);
  });

  it('ignores an end for a screen that never started', () => {
    endStackTransition('zzz');
    expect(isStackTransitioning()).toBe(false);
  });

  it('clears by itself when a screen never reports its end', () => {
    beginStackTransition('a');
    jest.advanceTimersByTime(1499);
    expect(isStackTransitioning()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(isStackTransitioning()).toBe(false);
  });
});
