import React from 'react';
import { render } from '@testing-library/react-native';
import { MarkLayer } from '../MarkCanvasParts';

const rect = { w: 300, h: 500 };
const shaft = (r) => r.UNSAFE_root.findAll((n) => n.props.testID === 'mark-shaft' && typeof n.type !== 'string');
const lines = (r) => r.UNSAFE_root.findAll((n) => n.type === 'RNSVGLine');
const marks = (head, hands = { pt: [0.4, 0.5], status: 'confirmed' }) => ({ hands, head, ball: null });

describe('MarkLayer: the shaft between the hands and the clubhead', () => {
  test('both marks on the still: a line from the hands to the clubhead, solid once confirmed', () => {
    const r = render(<MarkLayer rect={rect} active="head" marks={marks({ pt: [0.6, 0.8], status: 'confirmed' })} />);
    expect(shaft(r).length).toBeGreaterThan(0);
    const top = lines(r).at(-1).props;
    expect([top.x1, top.y1, top.x2, top.y2]).toEqual([120, 250, 180, 400]);
    expect(top.strokeDasharray).toBeUndefined();
  });

  test('dashed while the clubhead is still a proposal', () => {
    const r = render(<MarkLayer rect={rect} active="head" marks={marks({ pt: [0.6, 0.8], status: 'proposed' })} />);
    expect(lines(r).at(-1).props.strokeDasharray).toBeTruthy();
  });

  test('no line for a hidden or missing clubhead, or while a mark is under the finger', () => {
    [{ pt: null, status: 'hidden' }, { pt: null, status: 'missing', prior: [0.6, 0.8] }].forEach((head) => {
      expect(lines(render(<MarkLayer rect={rect} active="head" marks={marks(head)} />))).toHaveLength(0);
    });
    const r = render(<MarkLayer rect={rect} active="head" hidden="head" marks={marks({ pt: [0.6, 0.8], status: 'confirmed' })} />);
    expect(lines(r)).toHaveLength(0);
  });
});
