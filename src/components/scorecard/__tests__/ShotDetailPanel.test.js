import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ShotDetailPanel } from '../ShotDetailPanel';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

const par4 = { number: 1, par: 4, strokeIndex: 5 };
const par3 = { number: 2, par: 3, strokeIndex: 9 };

describe('ShotDetailPanel drive + approach lie inputs', () => {
  test('drive distance row renders on par 4/5, not on par 3', () => {
    const p4 = render(<ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p4.getByText('Drive distance')).toBeTruthy();
    const p3 = render(<ShotDetailPanel hole={par3} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p3.queryByText('Drive distance')).toBeNull();
  });
  test('miss-lie chips appear only after a miss direction', () => {
    const fairway = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'fairway' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(fairway.queryByText('Drive finished in')).toBeNull();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(miss.getByText('Drive finished in')).toBeTruthy();
  });
  test('selecting a drive lie patches driveLie; changing direction clears it', () => {
    const onChange = jest.fn();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={onChange} strokes={null} />,
    );
    fireEvent.press(miss.getByLabelText('Drive lie Sand'));
    expect(onChange).toHaveBeenCalledWith({ driveLie: 'sand' });
    fireEvent.press(miss.getByLabelText('Driver Fairway'));
    expect(onChange).toHaveBeenCalledWith({ drive: 'fairway', driveLie: null });
  });
  test('approach lie chips show once a bucket is picked; default reads fairway', () => {
    const noBucket = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />,
    );
    expect(noBucket.queryByText('Approach lie')).toBeNull();
    const onChange = jest.fn();
    const withBucket = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    expect(withBucket.getByText('Approach lie')).toBeTruthy();
    expect(withBucket.getByLabelText('Approach lie Fairway').props.accessibilityState.selected).toBe(true);
    fireEvent.press(withBucket.getByLabelText('Approach lie Rough'));
    expect(onChange).toHaveBeenCalledWith({ approachLie: 'rough' });
  });
  test('approach lie hidden on par 3s', () => {
    const p3 = render(
      <ShotDetailPanel hole={par3} detail={{ approachBucket: '100-150' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(p3.queryByText('Approach lie')).toBeNull();
  });
  test('clearing the approach bucket clears approachLie too', () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', approachLie: 'rough' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    fireEvent.press(r.getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: null, approachResult: null, approachLie: null });
  });
});
