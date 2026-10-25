import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import BottomSheet from '../BottomSheet';

describe('BottomSheet onClosed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports once, after the exit animation, so a menu entry runs after the menu has gone', () => {
    const onClosed = jest.fn();
    const { rerender, queryByText } = render(
      <BottomSheet visible onClose={() => {}} onClosed={onClosed} rise><Text>Menu</Text></BottomSheet>,
    );
    rerender(<BottomSheet visible={false} onClose={() => {}} onClosed={onClosed} rise><Text>Menu</Text></BottomSheet>);
    // Still on screen while it animates out.
    expect(onClosed).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(queryByText('Menu')).toBeNull();
  });

  it('does not report a sheet that never opened', () => {
    const onClosed = jest.fn();
    render(<BottomSheet visible={false} onClose={() => {}} onClosed={onClosed}><Text>Menu</Text></BottomSheet>);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(onClosed).not.toHaveBeenCalled();
  });
});
