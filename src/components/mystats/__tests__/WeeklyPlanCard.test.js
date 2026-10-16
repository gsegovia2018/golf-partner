import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import WeeklyPlanCard from '../WeeklyPlanCard';
import {
  onePutting, tieStats, teeLeft, fewRounds, approachShort, week, driverSwing, focusRecord, verdictOf,
} from './coachFixtures';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const renderPlan = (stats, opts = {}, props = {}) => render(wrap(
  <WeeklyPlanCard week={week(stats, opts)} focus={opts.focus ?? null} verdict={opts.verdict ?? null} onChangeMinutes={jest.fn()} {...props} />,
));

describe('WeeklyPlanCard: minutes picker', () => {
  test('is a radio group of 30 / 60 / 90 / 120 with the plan minutes checked', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 90 });
    expect(r.getByLabelText('Practice minutes per week')).toBeTruthy();
    [30, 60, 90, 120].forEach((m) => {
      const radio = r.getByLabelText(`${m} minutes`);
      expect(radio.props.accessibilityRole).toBe('radio');
      expect(radio.props.accessibilityState.checked).toBe(m === 90);
      // react-native-web only reads aria-checked, so the option must pass it too
      expect(r.UNSAFE_getAllByProps({ testID: `minutes-${m}` })[0].props['aria-checked']).toBe(m === 90);
    });
    expect(r.getByText('min / week')).toBeTruthy();
  });

  test('every option is at least 44 px', () => {
    const r = renderPlan(onePutting());
    [30, 60, 90, 120].forEach((m) => {
      const style = StyleSheet.flatten(r.getByTestId(`minutes-${m}`).props.style);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    });
  });

  test('pressing an option reports the minutes', () => {
    const onChangeMinutes = jest.fn();
    const r = renderPlan(onePutting(), {}, { onChangeMinutes });
    fireEvent.press(r.getByLabelText('120 minutes'));
    expect(onChangeMinutes).toHaveBeenCalledWith(120);
  });
});

describe('WeeklyPlanCard: split, sessions and the course task', () => {
  test('the split is also in text, with the total', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 120 });
    const text = r.getByTestId('plan-split-text').props.children;
    expect(String(text)).toMatch(/Putting \d+/);
    expect(String(text)).toMatch(/Range \d+/);
    const parts = String(text).match(/\d+/g).map(Number);
    expect(r.getByText(`${parts.reduce((a, b) => a + b, 0)} min`, { exact: true })).toBeTruthy();
  });

  test('one tile per session with its why and its drills at their level', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 120 });
    expect(r.getByTestId('session-putting')).toBeTruthy();
    expect(r.getByTestId('session-range')).toBeTruthy();
    expect(r.getAllByText('Putting is your focus, the biggest leak right now.').length).toBeGreaterThan(0);
    expect(r.getByText('Approach is the second biggest leak.')).toBeTruthy();
    expect(r.getByText(/^Lag ladder/)).toBeTruthy();
    expect(r.getAllByText(/^Pass: /).length).toBeGreaterThan(1);
  });

  test('the course task tile carries the task and no minutes budget', () => {
    const r = renderPlan(onePutting());
    expect(r.getByTestId('session-course-task')).toBeTruthy();
    expect(r.getByText('On the course, track every putt from 6+ m and count the three-putts.')).toBeTruthy();
    expect(r.getByText('on course')).toBeTruthy();
  });

  test('30 minutes is one session plus the task', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 30 });
    expect(r.queryByTestId('session-range')).toBeNull();
    expect(r.getByTestId('session-putting')).toBeTruthy();
    expect(r.getByTestId('session-course-task')).toBeTruthy();
  });

  test('a tie gives both leaks time; same-kind blocks share one tile', () => {
    const r = renderPlan(tieStats(), { minutesPerWeek: 90 });
    expect(r.getAllByText('Approach is level with the second leak, so it gets equal time.').length).toBeGreaterThan(0);
    expect(r.getByTestId('session-range')).toBeTruthy();
    expect(r.getByText('Wedge ladder', { exact: false })).toBeTruthy(); // approach block
    expect(r.getByText('Fairway window', { exact: false })).toBeTruthy(); // off the tee block
  });

  test('the swing drill is a tile row tagged as swing, with the progression line', () => {
    const r = renderPlan(teeLeft(), { swings: [driverSwing()], minutesPerWeek: 90 });
    expect(r.getAllByText('Swing drill').length).toBeGreaterThan(0);
    expect(r.getByText(/^Start slow with a 7-iron/)).toBeTruthy();
  });

  test('collect plan with its logging ask when rounds are few', () => {
    const r = renderPlan(fewRounds());
    expect(r.getAllByText('Not enough tracked data yet to choose a focus.').length).toBeGreaterThan(0);
    expect(r.getByText('On the course, keep score with shot detail so the next plan has data.')).toBeTruthy();
  });

  test('renders nothing without a plan', () => {
    expect(render(wrap(<WeeklyPlanCard week={null} />)).toJSON()).toBeNull();
  });
});

describe('WeeklyPlanCard: level and re-plan note', () => {
  test('level line from the focus: level, rounds in and the commit date', () => {
    const stats = approachShort();
    const focus = focusRecord();
    const r = renderPlan(stats, { focus, verdict: verdictOf({ level: 2, roundsSince: 4 }) });
    expect(r.getByTestId('plan-level').props.children).toBe('Level 2 of 3 · 4 rounds in · since 2 Oct');
  });

  test('without a focus the level line says how to start', () => {
    const r = renderPlan(onePutting());
    expect(r.getByTestId('plan-level').props.children).toBe('Level 1 of 3 · pin a focus and the plan levels up with your rounds');
  });

  test('the re-planned note names what changed and the round date', () => {
    const prev = {
      collect: false, focusLeakId: 'leak:putting:6+', focusCategory: 'putting', causeId: null,
      secondCategory: null, keepCategory: null, level: 1, tie: false, swingDrillId: null,
    };
    const r = renderPlan(approachShort(), { previousPlan: prev, lastRound: { course: 'Alhaurín', date: '2026-10-14' } });
    expect(r.getByTestId('plan-replanned')).toBeTruthy();
    expect(r.getByText(/^Plan updated after your round on 14 Oct\. New top leak: Approach/)).toBeTruthy();
  });

  test('no note when the plan did not change', () => {
    const r = renderPlan(onePutting());
    expect(r.queryByTestId('plan-replanned')).toBeNull();
  });
});
