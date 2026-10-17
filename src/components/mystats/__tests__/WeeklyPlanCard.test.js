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

describe('WeeklyPlanCard: minutes footer', () => {
  test('the header has no minutes picker and no split bar: the tile minutes are the split', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 120 });
    expect(r.queryByLabelText('Practice minutes per week')).toBeNull();
    expect(r.queryByText('min / week')).toBeNull();
    expect(r.queryByTestId('plan-split-text')).toBeNull();
    [30, 60, 90, 120].forEach((m) => expect(r.queryByTestId(`minutes-${m}`)).toBeNull());
    const tiles = r.getAllByText(/^\d+ min$/);
    expect(tiles.length).toBeGreaterThan(1);
  });

  test('the footer reads level, minutes a week and Change', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 90 });
    expect(r.getByTestId('plan-level').props.children).toBe('Level 1 of 3');
    expect(r.getByTestId('plan-minutes').props.children).toBe('90 min a week');
    const change = r.getByTestId('plan-change-minutes');
    expect(change.props.accessibilityRole).toBe('button');
    const style = StyleSheet.flatten(change.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(r.getByText('Change')).toBeTruthy();
  });

  test('Change opens the minutes sheet; picking a row reports the minutes and closes it', () => {
    const onChangeMinutes = jest.fn();
    const r = renderPlan(onePutting(), {}, { onChangeMinutes });
    expect(r.queryByText('Practice time')).toBeNull();
    fireEvent.press(r.getByTestId('plan-change-minutes'));
    expect(r.getByText('Practice time')).toBeTruthy();
    fireEvent.press(r.getByLabelText('120 min a week'));
    expect(onChangeMinutes).toHaveBeenCalledWith(120);
  });
});

describe('WeeklyPlanCard: split, sessions and the course task', () => {
  test('one tile per session with its why and its drills at their level', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 120 });
    expect(r.getByTestId('session-putting')).toBeTruthy();
    expect(r.getByTestId('session-range')).toBeTruthy();
    expect(r.getAllByText('Putting is your focus, the biggest leak right now.').length).toBeGreaterThan(0);
    expect(r.getByText('Approach is the second biggest leak.')).toBeTruthy();
    expect(r.getByText(/^Lag ladder/)).toBeTruthy();
    expect(r.getAllByText(/^Pass: /).length).toBeGreaterThan(1);
  });

  test('a session drill opens the detail sheet with how to do it', () => {
    const r = renderPlan(onePutting(), { minutesPerWeek: 120 });
    const row = r.getAllByTestId('drill-putt-lag-ladder')[0];
    expect(row.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(row);
    expect(r.getByText('How to do it')).toBeTruthy();
    expect(r.getByText(/^Take 10 putts from 8 m to one hole/)).toBeTruthy();
    expect(r.getByTestId('drill-level-1')).toBeTruthy();
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

  test('without a focus the level line is just the level', () => {
    const r = renderPlan(onePutting());
    expect(r.getByTestId('plan-level').props.children).toBe('Level 1 of 3');
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
