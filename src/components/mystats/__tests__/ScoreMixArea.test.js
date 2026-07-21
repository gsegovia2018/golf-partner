import React from 'react';
import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ScoreMixArea from '../ScoreMixArea';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const rounds = [
  { label: 'R1', birdie: 2, par: 10, bogey: 6 },
  { label: 'R2', birdie: 4, par: 9, bogey: 5 },
  { label: 'R3', birdie: 1, par: 11, bogey: 6 },
];

describe('ScoreMixArea', () => {
  test('shows the empty state with fewer than two rounds', () => {
    const view = render(wrap(<ScoreMixArea rounds={[rounds[0]]} />));
    expect(view.getByText('Select two or more rounds to see the score mix.')).toBeTruthy();
  });

  test('draws three translucent bands plus a full-opacity top-edge stroke each', () => {
    const view = render(wrap(<ScoreMixArea rounds={rounds} />));
    const paths = view.UNSAFE_getAllByType(Path);

    const bands = paths.filter((p) => p.props.fill !== 'none');
    expect(bands).toHaveLength(3);
    bands.forEach((b) => {
      expect(b.props.fillOpacity).toBe(0.85);
      expect(b.props.d.endsWith('Z')).toBe(true);
    });

    const edges = paths.filter((p) => p.props.fill === 'none');
    expect(edges).toHaveLength(3);
    edges.forEach((e, i) => {
      expect(e.props.stroke).toBe(bands[i].props.fill);
      expect(e.props.strokeOpacity).toBeUndefined();
      expect(e.props.d.endsWith('Z')).toBe(false);
    });
  });

  test('renders the legend', () => {
    const view = render(wrap(<ScoreMixArea rounds={rounds} />));
    ['Birdie+', 'Par', 'Bogey+'].forEach((label) => {
      expect(view.getByText(label)).toBeTruthy();
    });
  });
});
