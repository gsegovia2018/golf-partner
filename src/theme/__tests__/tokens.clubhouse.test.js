import { light, dark, semantic } from '../tokens';

describe('Clubhouse tokens', () => {
  it('uses hairline borders and flat cards in light theme', () => {
    expect(light.border.default).toBe('#e7e2d5');
    expect(light.shadow.card.shadowOpacity).toBe(0);
    expect(light.shadow.card.elevation).toBe(0);
  });

  it('exposes a mode-aware winner gold', () => {
    expect(semantic.winner).toEqual({ light: '#a9821e', dark: '#ffd700' });
  });

  it('keeps the dark theme untouched', () => {
    expect(dark.bg.primary).toBe('#0c1a14');
    expect(dark.shadow.card.shadowOpacity).toBe(0.2);
    expect(dark.border.default).toBe('rgba(255,255,255,0.07)');
  });

  it('keeps existing semantic shape for consumers', () => {
    expect(semantic.rank.gold).toBe('#d4af37');
    expect(semantic.masters.yellow).toBe('#ffd700');
  });
});
