import { buildHoleMapHtml } from '../holeMapHtml';

const base = {
  mode: 'view', holeKey: 'C#1#view', holeLabel: 'Hole 1',
  green: [[38.56, -0.139]], greenCenter: [38.56, -0.139],
  tee: [38.5634, -0.1439], hazards: [], player: null,
  anchor: { pos: [38.5634, -0.1439], source: 'tee', playerDistance: 1234 },
};

describe('buildHoleMapHtml', () => {
  it('embeds the anchor in the page data', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('"source":"tee"'); // JSON.stringify is compact — no space
  });
  it('has the on-line distance chip machinery and no legacy layup chip', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('dchip');
    expect(html).not.toContain('🎯');
  });
  it('renders the unified tri cluster instead of the old cards', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('class="tri"');
    expect(html).not.toContain('class="card front"');
  });
});
