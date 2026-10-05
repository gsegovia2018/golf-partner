import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueAddScoreScreen from '../LeagueAddScoreScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
}));
jest.mock('../../lib/selectionBridge', () => ({ consumePendingCourses: jest.fn(() => null) }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
}));

const store = require('../../store/leagueStore');
const { saveDraft, loadDraft } = require('../../store/leagueOffApp');

const MONTH = '2025-10';
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const announced = {
  id: 'c1', userId: 'me', status: 'announced', source: 'offapp', month: `${MONTH}-01`,
  announcedAt: new Date(2025, 9, 4, 9, 12).toISOString(), teeTime: new Date(2025, 9, 4, 9, 30).toISOString(),
  playedOn: '2025-10-04', leagueHandicap: 18, course: { name: 'Golf Olivar', tee: null, slope: 125, rating: 72, holes },
};

function snapshot(cards = [announced]) {
  return {
    league: {
      id: 'L1', name: 'El Club', pointsTable: [500], handicapCap: 30, entryFeeCents: 0,
      seasonStart: '2025-01-01', seasonEnd: '2025-12-31', archivedAt: null,
    },
    members: [{ userId: 'me', displayName: 'Marcos', role: 'admin', leagueHandicap: 18, leftAt: null }],
    cardsByMonth: { [MONTH]: cards },
  };
}

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) });
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const cardRoute = { params: { leagueId: 'L1', cardId: 'c1' } };

function fillHoles(utils, upTo) {
  for (let n = 1; n <= upTo; n += 1) {
    fireEvent.changeText(utils.getByLabelText(`Strokes for You on hole ${n}`), '5');
  }
}
const nextDisabled = (utils) => utils.getByRole('button', { name: 'Next: add proof' }).props.accessibilityState.disabled;

describe('LeagueAddScoreScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await require('@react-native-async-storage/async-storage').clear();
    store.getLeague.mockResolvedValue(snapshot());
  });

  test('announced card: note, and "Next: add proof" opens only once all 18 holes are filled', async () => {
    const navigation = nav();
    const utils = render(wrap(<LeagueAddScoreScreen navigation={navigation} route={cardRoute} />));
    await waitFor(() => utils.getByText('League card · announced 09:12'));
    await waitFor(() => utils.getByLabelText('Strokes for You on hole 1'));

    fillHoles(utils, 17);
    expect(nextDisabled(utils)).toBe(true);
    fireEvent.press(utils.getByText('Next: add proof'));
    expect(navigation.navigate).not.toHaveBeenCalled();

    fireEvent.changeText(utils.getByLabelText('Strokes for You on hole 18'), '5');
    await waitFor(() => expect(nextDisabled(utils)).toBe(false));
    fireEvent.press(utils.getByText('Next: add proof'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueAddProof', expect.objectContaining({
      leagueId: 'L1', cardId: 'c1', playedOn: '2025-10-04', leagueHandicap: 18,
      strokes: expect.objectContaining({ 1: 5, 18: 5 }),
    }));
  });

  test('a stroke of 31 keeps the gate closed', async () => {
    const utils = render(wrap(<LeagueAddScoreScreen navigation={nav()} route={cardRoute} />));
    await waitFor(() => utils.getByLabelText('Strokes for You on hole 1'));
    fillHoles(utils, 18);
    await waitFor(() => expect(nextDisabled(utils)).toBe(false));
    fireEvent.changeText(utils.getByLabelText('Strokes for You on hole 2'), '31');
    await waitFor(() => expect(nextDisabled(utils)).toBe(true));
  });

  test('the date is limited to the card\'s month, even when that month is past', async () => {
    const utils = render(wrap(<LeagueAddScoreScreen navigation={nav()} route={cardRoute} />));
    await waitFor(() => utils.getByLabelText('Strokes for You on hole 1'));
    fireEvent.press(utils.getByLabelText('Date played'));
    expect(utils.getByLabelText('Fri 3 Oct 2025').props.accessibilityState.disabled).toBe(false);
    expect(utils.getByLabelText('Fri 31 Oct 2025').props.accessibilityState.disabled).toBe(false);
    expect(utils.getByLabelText('Next month').props.accessibilityState.disabled).toBe(true);
    expect(utils.getByLabelText('Previous month').props.accessibilityState.disabled).toBe(true);
  });

  test('unannounced mode shows "Not announced in the app" and asks for a course', async () => {
    const utils = render(wrap(<LeagueAddScoreScreen navigation={nav()} route={{ params: { leagueId: 'L1' } }} />));
    await waitFor(() => utils.getByText('Not announced in the app'));
    expect(utils.getByText('Pick the course')).toBeTruthy();
    expect(utils.queryByLabelText('Strokes for You on hole 1')).toBeNull();
  });

  test('restores the draft for the card and saves new entries', async () => {
    await saveDraft('L1', 'c1', { strokes: { 1: 6, 2: 4 }, dateText: '2025-10-04' });
    const utils = render(wrap(<LeagueAddScoreScreen navigation={nav()} route={cardRoute} />));
    await waitFor(() => expect(utils.getByLabelText('Strokes for You on hole 1').props.value).toBe('6'));
    fireEvent.changeText(utils.getByLabelText('Strokes for You on hole 3'), '7');
    await waitFor(async () => expect((await loadDraft('L1', 'c1')).strokes[3]).toBe(7));
  });
});
