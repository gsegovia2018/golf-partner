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
  it('inlines Leaflet — no CDN dependency', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('unpkg.com');
  });
  it('ships the recenter control that flies back to the initial framing', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('id="recenter"');
    expect(html).toContain('flyTo(homeView.center');
  });
  it('uses the bridged tile layer, not a direct Esri tileLayer', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('server.arcgisonline.com');
    expect(html).toContain("type:'tile'");
  });
  it('inline map script parses as valid JavaScript', () => {
    const html = buildHoleMapHtml(base);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const inline = scripts[scripts.length - 1][1];
    expect(() => new Function(inline)).not.toThrow();
  });
  it('tracks aim circles as an array with a chain renderer', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('let targets = []');
    expect(html).toContain('function drawTargets');
  });
  it('adds a second circle on a timed long-press (not the flaky native contextmenu) with a two-circle cap', () => {
    const html = buildHoleMapHtml(base);
    // Manual hold timer on mousedown (fires for touch + held mouse), swallowing
    // the ending click; contextmenu kept only as a desktop right-click bonus.
    expect(html).toContain("map.on('mousedown'");
    expect(html).toContain('lpTimer = setTimeout');
    expect(html).toContain('lpFired');
    expect(html).toContain('targets.length >= 2');
  });
  it('removes a circle on long-press but never the last one', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('targets.splice(i, 1)');
    expect(html).toContain('targets.length < 2');
  });
  it('embeds yards units and ships the yd conversion machinery', () => {
    const html = buildHoleMapHtml({ ...base, units: 'yards' });
    expect(html).toContain('"units":"yards"');
    expect(html).toContain('const M2YD = 1.09361;');
    expect(html).toContain("const U = DATA.units === 'yards' ? 'yd' : 'm';");
  });
  it('makes non-origin shot pins interactive and posts a shot-tap with the index', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain("type:'shot-tap'");
    expect(html).toContain('interactive: !origin');
  });
  it('keeps the tee/origin pin (index 0, no club) non-interactive', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('const origin = i === 0 && !list[i].club');
  });
  it('makes landing pins draggable and posts shot-move on dragend', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('draggable: !origin');
    expect(html).toContain("type:'shot-move'");
  });
  it('has no placing mode remnants', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('placehint');
    expect(html).not.toContain("type:'shot-point'");
  });
  it('posts the full ring chain with the aim and accepts set-targets', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('rings:');
    expect(html).toContain("type:'set-targets'");
  });
  // A redraw removes and recreates the marker layers, which detaches Leaflet's
  // Draggable mid-gesture. Android's 1s GPS watch posts a 'player' message that
  // second, so the ring stopped following the finger about a second into a drag.
  // draw()/endDrag() own the hold, so lift them out and exercise them directly.
  describe('draw() — holding redraws for the duration of a drag', () => {
    const run = () => {
      const html = buildHoleMapHtml(base);
      const src = html.match(/let dragging = false[\s\S]*?function endDrag\(\)\s*\{[\s\S]*?\n\}/)[0];
      const drawn = [];
      const api = new Function(
        'drawNow', 'document',
        `${src}; return { draw, endDrag, startDrag: () => { dragging = true; } };`,
      )(() => drawn.push(1), { addEventListener() {} });
      return { ...api, count: () => drawn.length };
    };

    it('redraws immediately when no drag is in flight', () => {
      const m = run();
      m.draw();
      expect(m.count()).toBe(1);
    });
    it('holds redraws that arrive mid-drag', () => {
      const m = run();
      m.startDrag();
      m.draw(); // a GPS tick lands while the finger is down
      expect(m.count()).toBe(0);
    });
    it('runs one held redraw when the drag ends, however many arrived', () => {
      const m = run();
      m.startDrag();
      m.draw(); m.draw(); m.draw();
      m.endDrag();
      expect(m.count()).toBe(1);
    });
    it('does not redraw on a drag that no update interrupted', () => {
      const m = run();
      m.startDrag();
      m.endDrag();
      expect(m.count()).toBe(0);
    });
    it('is back to drawing immediately after the drag', () => {
      const m = run();
      m.startDrag();
      m.endDrag();
      m.draw();
      expect(m.count()).toBe(1);
    });
  });
  it('hands the drag lifecycle to the aim rings, the shot pins and touch cancel', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain("mk.on('dragstart'");
    expect(html).toContain("mk.on('dragend', endDrag)");
    expect(html).toContain("addEventListener('touchcancel', endDrag)");
  });
  it('drops the drag-to-measure hint', () => {
    const html = buildHoleMapHtml(base);
    expect(html).not.toContain('Drag the ring to measure');
  });

  // The top-right F/C/B card is anchored to where the player is, not to the
  // draggable aim ring. hudSource() owns that choice, so lift it out of the
  // inline script and exercise it directly rather than asserting on markup.
  describe('hudSource — what the F/C/B card measures from', () => {
    const run = (anchor, aim) => {
      const html = buildHoleMapHtml(base);
      const src = html.match(/function hudSource\(aim\)\{[\s\S]*?\n\}/)[0];
      const valid = (p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
      // hudSource closes over `anchor`/`valid`; supplying them as parameters of
      // the wrapper puts them in its enclosing scope.
      return new Function('anchor', 'valid', 'aim', `${src}; return hudSource(aim);`)(anchor, valid, aim);
    };
    const GPS = [38.5601, -0.1401];
    const TEE = [38.5634, -0.1439];
    const RING = [38.5620, -0.1420];

    it('measures from the live GPS fix when the host says the player is on the hole', () => {
      expect(run({ pos: GPS, source: 'gps' }, RING)).toEqual({ from: GPS, label: 'You' });
    });
    it('falls back to the tee when GPS is off or out of range', () => {
      expect(run({ pos: TEE, source: 'tee' }, RING)).toEqual({ from: TEE, label: 'From tee' });
    });
    it('falls back to the aim ring only when the hole has neither a fix nor a tee', () => {
      expect(run({ pos: null, source: null }, RING)).toEqual({ from: RING, label: 'Aim' });
    });
    it('never measures from the aim ring while an anchor exists', () => {
      expect(run({ pos: GPS, source: 'gps' }, RING).from).not.toBe(RING);
      expect(run({ pos: TEE, source: 'tee' }, RING).from).not.toBe(RING);
    });
    it('yields no origin when there is no anchor and no ring', () => {
      expect(run({ pos: null, source: null }, null).from).toBeNull();
    });
    it('ignores a source that carries no usable position', () => {
      expect(run({ pos: null, source: 'gps' }, RING)).toEqual({ from: RING, label: 'Aim' });
    });
  });

  it('drops the tee/last-shot row the anchored card replaces', () => {
    const html = buildHoleMapHtml(base);
    expect(html).toContain('class="src"');
    expect(html).not.toContain('class="row hole"');
    expect(html).not.toContain('.tri .hole');
  });
});
