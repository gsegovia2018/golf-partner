import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { Skeleton, SkeletonRegion } from '../Skeleton';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('Skeleton', () => {
  test('the region announces loading once and keeps real content reachable', () => {
    const { getByLabelText, getByText } = render(wrap(
      <SkeletonRegion>
        <Text>Friends</Text>
        <Skeleton width={40} />
      </SkeletonRegion>,
    ));
    expect(getByLabelText('Loading…')).toBeTruthy();
    expect(getByText('Friends')).toBeTruthy();
  });

  test('blocks are hidden from screen readers', () => {
    const { UNSAFE_root } = render(wrap(<Skeleton testID="b" width={40} />));
    const block = UNSAFE_root.findAll((n) => n.props?.importantForAccessibility === 'no-hide-descendants');
    expect(block.length).toBeGreaterThan(0);
  });
});
