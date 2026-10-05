import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import DateSheet from '../DateSheet';

// Monday 5 Oct 2026, 08:00 local.
const NOW = new Date(2026, 9, 5, 8, 0);

const setup = (props = {}) => {
  const onChange = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <ThemeProvider>
      <DateSheet visible title="Date played" onChange={onChange} onClose={onClose} {...props} />
    </ThemeProvider>,
  );
  return { ...utils, onChange, onClose };
};
const disabled = (el) => !!el.props.accessibilityState?.disabled;

describe('DateSheet', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => jest.useRealTimers());

  test('days outside the bounds are disabled and not pressable', () => {
    const { getByLabelText, onChange } = setup({ min: '2026-10-01', max: '2026-10-05' });
    expect(disabled(getByLabelText('Mon 5 Oct 2026'))).toBe(false);
    const future = getByLabelText('Tue 6 Oct 2026');
    expect(disabled(future)).toBe(true);
    fireEvent.press(future);
    fireEvent.press(getByLabelText('Done'));
    expect(onChange).not.toHaveBeenCalled(); // nothing selected, Done is off
  });

  test('month arrows cannot leave the bounds', () => {
    const { getByLabelText } = setup({ min: '2026-10-01', max: '2026-10-05' });
    expect(disabled(getByLabelText('Previous month'))).toBe(true);
    expect(disabled(getByLabelText('Next month'))).toBe(true);
  });

  test('picking a day then Done returns the ISO date and closes', () => {
    const { getByLabelText, getByText, onChange, onClose } = setup({ min: '2026-10-01', max: '2026-10-31' });
    fireEvent.press(getByLabelText('Sat 10 Oct 2026'));
    expect(getByText('Sat 10 Oct 2026')).toBeTruthy();
    fireEvent.press(getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('2026-10-10', undefined);
    expect(onClose).toHaveBeenCalled();
  });

  test('quick chips only show for days inside the bounds', () => {
    const past = setup({ max: '2026-10-05' });
    expect(past.queryByText('Tomorrow')).toBeNull();
    expect(past.getByText('Yesterday')).toBeTruthy();
    past.unmount();
    const future = setup({ min: '2026-10-05' });
    expect(future.queryByText('Yesterday')).toBeNull();
    fireEvent.press(future.getByText('Tomorrow'));
    fireEvent.press(future.getByLabelText('Done'));
    expect(future.onChange).toHaveBeenCalledWith('2026-10-06', undefined);
  });

  test('tee time steps by 10 minutes and is returned with the date', () => {
    const { getByLabelText, getByText, onChange } = setup({ min: '2026-10-05', value: '2026-10-10', time: '09:30' });
    expect(getByText('09:30')).toBeTruthy();
    fireEvent.press(getByLabelText('Later tee time'));
    fireEvent.press(getByLabelText('Later tee time'));
    fireEvent.press(getByLabelText('Earlier tee time'));
    expect(getByText('09:40')).toBeTruthy();
    fireEvent.press(getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('2026-10-10', '09:40');
  });

  test('without a time there is no stepper', () => {
    const { queryByLabelText } = setup();
    expect(queryByLabelText('Later tee time')).toBeNull();
  });
});
