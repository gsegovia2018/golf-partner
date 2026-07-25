import { CELEBRATION_TIERS, celebrationFor } from '../constants';

const LABELS = ['BIRDIE', 'EAGLE', 'ALBATROSS', 'HOLE IN ONE', 'NOELADA'];

describe('CELEBRATION_TIERS presentation policy', () => {
  it('every tier declares a complete config — no defaults to fall through to', () => {
    for (const label of LABELS) {
      const tier = CELEBRATION_TIERS[label];
      expect(tier).toBeDefined();
      expect(['toast', 'takeover']).toContain(tier.presentation);
      expect(typeof tier.holdMs).toBe('number');
      expect(tier.holdMs).toBeGreaterThan(0);
      expect(['light', 'selection', 'success']).toContain(tier.haptic);
      expect(typeof tier.accent).toBe('string');
      expect(typeof tier.icon).toBe('string');
      expect(typeof tier.eyebrow).toBe('string');
    }
  });

  it('common results toast; rare results take over', () => {
    const toast = LABELS.filter((l) => CELEBRATION_TIERS[l].presentation === 'toast');
    expect(toast.sort()).toEqual(['BIRDIE', 'NOELADA']);
  });

  // Regression: holdMs used to fall through a label chain whose `else` was
  // commented "HOLE IN ONE", so a double bogey held 1800ms — longest of any
  // tier, and twice a birdie.
  it('a bad hole never holds longer than a good one', () => {
    expect(CELEBRATION_TIERS.NOELADA.holdMs).toBeLessThan(CELEBRATION_TIERS.BIRDIE.holdMs);
    expect(CELEBRATION_TIERS.NOELADA.holdMs).toBeLessThan(CELEBRATION_TIERS['HOLE IN ONE'].holdMs);
  });

  // Regression: every celebration fired haptic('success'), including NOELADA.
  it('only good results get the success haptic', () => {
    expect(CELEBRATION_TIERS.NOELADA.haptic).not.toBe('success');
    expect(CELEBRATION_TIERS.EAGLE.haptic).toBe('success');
  });

  it('celebrationFor is unchanged', () => {
    expect(celebrationFor(4, 3)).toBe('BIRDIE');
    expect(celebrationFor(4, 2)).toBe('EAGLE');
    expect(celebrationFor(4, 1)).toBe('HOLE IN ONE');
    expect(celebrationFor(5, 2)).toBe('ALBATROSS');
    expect(celebrationFor(4, 6)).toBe('NOELADA');
    expect(celebrationFor(4, 4)).toBeNull();
    expect(celebrationFor(4, 5)).toBeNull();
  });
});
