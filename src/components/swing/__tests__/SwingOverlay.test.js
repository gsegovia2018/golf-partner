import React from 'react';
import { render } from '@testing-library/react-native';
import SwingOverlay, { fitRect } from '../SwingOverlay';

const lm = () => Array.from({ length: 33 }, (_, i) => [0.3 + (i % 5) * 0.08, 0.2 + (i % 7) * 0.08, 0.9]);
const VIDEO = { width: 478, height: 850 };

// react-native-svg keeps text in the `content` prop of its RNSVGTSpan host node.
const svgTexts = (r) => r.UNSAFE_root.findAll((n) => n.type === 'RNSVGTSpan').map((n) => n.props.content);

describe('fitRect', () => {
  test('contain-fits the frame and centres it', () => {
    const r = fitRect(350, 464, 478, 850);
    expect(r.h).toBeCloseTo(464);
    expect(r.w).toBeCloseTo(464 * (478 / 850));
    expect(r.x).toBeCloseTo((350 - r.w) / 2);
    expect(r.y).toBe(0);
  });
  test('a wide frame letterboxes top and bottom', () => {
    const r = fitRect(300, 300, 400, 200);
    expect(r).toEqual({ x: 0, y: 75, w: 300, h: 150 });
  });
});

describe('SwingOverlay', () => {
  const props = { width: 350, height: 464, video: VIDEO };

  test('key lines keep only the planes they name', () => {
    const reference = { ball: [0.57, 0.59], handsAddress: [0.44, 0.5], trailShoulder: [0.4, 0.3], shaftPlaneDeg: 52, shoulderPlaneDeg: 67 };
    const r = render(<SwingOverlay {...props} reference={reference} keyLines={{ shaft: true, shoulder: false, extra: [] }} />);
    expect(svgTexts(r)).toContain('Shaft plane 52°');
    expect(svgTexts(r)).not.toContain('Shoulder plane 67°');
  });

  test('without a still it says so and still draws the overlay', () => {
    const r = render(<SwingOverlay {...props} pose={lm()} club={{ hands: [0.4, 0.5], head: null, hidden: true, source: 'user' }} />);
    expect(r.getByText('Still not available')).toBeTruthy();
    expect(svgTexts(r)).toContain('clubhead hidden');
  });

  test('an estimated clubhead is labelled; a placed one is not', () => {
    const est = render(<SwingOverlay {...props} club={{ hands: [0.4, 0.5], head: [0.5, 0.7], hidden: false, source: 'edge' }} />);
    expect(svgTexts(est)).toContain('estimated');
    const placed = render(<SwingOverlay {...props} club={{ hands: [0.4, 0.5], head: [0.5, 0.7], hidden: false, source: 'user' }} />);
    expect(svgTexts(placed)).not.toContain('estimated');
  });

  test('draws the planes with their angles and the selected measure label', () => {
    const r = render(
      <SwingOverlay
        {...props}
        reference={{ ball: [0.57, 0.59], handsAddress: [0.44, 0.5], trailShoulder: [0.4, 0.3], shaftPlaneDeg: 52, shoulderPlaneDeg: 67 }}
        highlight={[{ t: 'label', at: [0.4, 0.5], text: '+10 cm' }]}
      />,
    );
    expect(svgTexts(r)).toEqual(expect.arrayContaining(['Shaft plane 52°', 'Shoulder plane 67°', '+10 cm']));
  });

  describe('focus mode', () => {
    const hl = [
      { t: 'line', a: [0.4, 0.2], b: [0.4, 0.6], dash: true, role: 'target' },
      { t: 'line', a: [0.4, 0.6], b: [0.5, 0.6], dash: true },
      { t: 'label', at: [0.5, 0.6], text: '+8 cm' },
    ];
    const lines = (r) => r.UNSAFE_root.findAll((n) => n.type === 'RNSVGLine');
    const circles = (r) => r.UNSAFE_root.findAll((n) => n.type === 'RNSVGCircle');
    const full = { ...props, pose: lm(), club: { hands: [0.4, 0.5], head: [0.5, 0.7], hidden: false, source: 'edge' }, ball: [0.57, 0.59, 0.012], highlight: hl, reference: { ball: [0.57, 0.59], handsAddress: [0.44, 0.5], trailShoulder: [0.4, 0.3], shaftPlaneDeg: 52, shoulderPlaneDeg: 67 } };

    test('off: no legend, planes and the estimated label stay', () => {
      const r = render(<SwingOverlay {...full} />);
      expect(r.queryByTestId('overlay-legend')).toBeNull();
      expect(svgTexts(r)).toEqual(expect.arrayContaining(['Shaft plane 52°', 'estimated']));
    });

    test('on: legend, no planes or clubhead chrome, labels and the ball kept', () => {
      const r = render(<SwingOverlay {...full} focus tone="#e0b24d" />);
      expect(r.getByTestId('overlay-legend')).toBeTruthy();
      expect(r.getByText('You')).toBeTruthy();
      expect(r.getByText('Target')).toBeTruthy();
      const texts = svgTexts(r);
      expect(texts).toContain('+8 cm');
      expect(texts).not.toContain('Shaft plane 52°');
      expect(texts).not.toContain('estimated');
      expect(circles(r)).toHaveLength(1); // the ball only: no joints, nose ring or head marker
    });

    test('on: target is the accent and dashed, you is the tone and solid', () => {
      const r = render(<SwingOverlay {...full} focus tone="#e0b24d" pose={null} club={null} />);
      const rgb = (n) => n.props.stroke.payload & 0xffffff; // react-native-svg packs colours as ARGB numbers
      // every stroke sits on a dark halo (#0a0d10) drawn first; the coloured strokes are the others
      const halos = lines(r).filter((n) => rgb(n) === 0x0a0d10);
      const [target, you] = lines(r).filter((n) => rgb(n) !== 0x0a0d10);
      expect(halos).toHaveLength(2);
      expect(rgb(target)).toBe(0x4fae8a);
      expect(target.props.strokeWidth).toBe(2.5);
      expect(target.props.strokeDasharray).toEqual(['4', '3']);
      expect(rgb(you)).toBe(0xe0b24d);
      expect(you.props.strokeWidth).toBe(3);
      expect(you.props.strokeDasharray).toBeUndefined();
    });
  });
});
