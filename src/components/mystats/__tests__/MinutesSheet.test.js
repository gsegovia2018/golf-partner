import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import MinutesSheet from '../MinutesSheet';
import WeeklyPlanCard from '../WeeklyPlanCard';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../../../store/settingsStore';
import { onePutting, week } from './coachFixtures';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../store/profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  __resetAppSettingsForTests();
});

describe('MinutesSheet', () => {
  const setup = (props = {}) => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const r = render(wrap(<MinutesSheet visible minutes={60} onSelect={onSelect} onClose={onClose} {...props} />));
    return { r, onSelect, onClose };
  };

  test('four radio rows of 48 px with the current one checked, and a one-line note', () => {
    const { r } = setup({ minutes: 90 });
    expect(r.getByLabelText('Practice time').props.accessibilityRole).toBe('radiogroup');
    [30, 60, 90, 120].forEach((m) => {
      const row = r.getByLabelText(`${m} min a week`);
      expect(row.props.accessibilityRole).toBe('radio');
      expect(row.props.accessibilityState.checked).toBe(m === 90);
      // react-native-web only reads aria-checked
      expect(r.UNSAFE_getAllByProps({ testID: `minutes-${m}` })[0].props['aria-checked']).toBe(m === 90);
      expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
    });
    expect(r.getByText('The plan is sized to this time and re-packs when you change it.')).toBeTruthy();
  });

  test('picking a row reports it and closes the sheet', () => {
    const { r, onSelect, onClose } = setup();
    fireEvent.press(r.getByLabelText('30 min a week'));
    expect(onSelect).toHaveBeenCalledWith(30);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the close button closes without choosing', () => {
    const { r, onSelect, onClose } = setup();
    fireEvent.press(r.getAllByLabelText('Close').pop());
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('MinutesSheet writes practiceMinutesPerWeek through the settings store', () => {
  test('from the plan card: Change, a row, and the setting holds the choice', async () => {
    const stats = onePutting();
    const onChangeMinutes = (m) => updateAppSettings({ practiceMinutesPerWeek: m });
    const r = render(wrap(<WeeklyPlanCard week={week(stats)} onChangeMinutes={onChangeMinutes} />));
    expect(getAppSettings().practiceMinutesPerWeek).toBe(60);
    fireEvent.press(r.getByTestId('plan-change-minutes'));
    fireEvent.press(r.getByLabelText('120 min a week'));
    await waitFor(() => expect(getAppSettings().practiceMinutesPerWeek).toBe(120));
  });
});
