import {
  getStatExplainer, resolveStatExplainer, statExplainerKeys, statExplainers,
} from '../statExplainers';
import { setLanguagePref, tr } from '../../../i18n';
import en from '../../../i18n/locales/en';
import es from '../../../i18n/locales/es';

afterEach(async () => {
  await setLanguagePref('en');
});

describe('statExplainers', () => {
  it('has es title/subtitle/explainer for every infoKey', () => {
    statExplainerKeys.forEach((key) => {
      const variants = [getStatExplainer(key)];
      if (key === 'strokesGained') variants.push(getStatExplainer(key, { targetHandicap: 12 }));
      variants.forEach((d) => {
        ['title', 'subtitle', 'explainer'].forEach((f) => {
          expect(en[d[f].key]).toBeTruthy();
          expect(es[d[f].key]).toBeTruthy();
        });
      });
    });
  });

  it('returns null for an unknown key', () => {
    expect(getStatExplainer('nope')).toBeNull();
    expect(resolveStatExplainer('nope')).toBeNull();
  });

  it('keeps the English text', () => {
    expect(resolveStatExplainer('recentForm')).toEqual({
      title: 'Recent Form',
      subtitle: 'Are you trending up or down?',
      explainer: 'Compares your last few rounds against everything before them. '
        + 'The line shows points scored in each selected round, oldest to newest. '
        + 'Improving means your recent points-per-round average beats your earlier one.',
    });
    expect(resolveStatExplainer('strokesGained').title).toBe('Strokes Gained');
    const sg = resolveStatExplainer('strokesGained', { targetHandicap: 12 });
    expect(sg.title).toBe('Strokes Gained vs handicap 12');
    expect(sg.subtitle).toBe('How you compare to a handicap-12 golfer');
    expect(sg.explainer).toContain('compares to a handicap-12 golfer');
    expect(sg.explainer).toContain('better than your target');
    // typicalScoreVsPar(12) = 13 + (18.4 − 13)·(2/5) = 15.16 → "15.2"
    expect(sg.explainer).toContain('averages (about 15.2 over par), not par plus handicap');
    expect(resolveStatExplainer('strokesGained').explainer).toContain('averages (about 2 over par), not par.');
  });

  it('compat object resolves lazily and strokesGained stays a function', () => {
    expect(statExplainers.playSmarter.title).toBe('Play Smarter');
    expect(statExplainers.strokesGained(0).title).toBe('Strokes Gained');
    expect(statExplainers.strokesGained(8.5).title).toBe('Strokes Gained vs handicap 8.5');
  });

  it('renders in Spanish', async () => {
    await setLanguagePref('es');
    const d = getStatExplainer('strokesGained', { targetHandicap: 8.5 });
    expect(tr(d.title)).toBe('Golpes ganados (SG) frente a hándicap 8,5');
    expect(resolveStatExplainer('recentForm').title).toBe('Forma reciente');
    expect(statExplainers.putts.title).toBe('Putts por vuelta');
  });
});
