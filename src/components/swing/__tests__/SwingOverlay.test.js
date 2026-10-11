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
});
