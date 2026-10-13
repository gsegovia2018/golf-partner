import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueCreateScreen from '../LeagueCreateScreen';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marcos', handicap: 18.4 })),
}));
jest.mock('../../store/friendStore', () => ({
  listFriends: jest.fn(() => Promise.resolve([
    { userId: 'f1', displayName: 'Javi', handicap: 12.4 },
    { userId: 'f2', displayName: 'Alvaro', handicap: 36.2 },
  ])),
  getCachedFriends: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../store/leagueStore', () => ({ createLeague: jest.fn() }));

const { createLeague } = require('../../store/leagueStore');

const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

async function toReview(utils, { pickFriends = true, morePoints = false } = {}) {
  const { getByText, getByPlaceholderText, findByText } = utils;
  fireEvent.changeText(getByPlaceholderText('El Club del Mulligan'), '  El Club  ');
  fireEvent.press(getByText('Next'));
  await findByText('How does it work?');
  fireEvent.changeText(utils.getByPlaceholderText('0'), '30');
  if (morePoints) fireEvent.press(utils.getByLabelText('More points'));
  fireEvent.press(getByText('Next'));
  await findByText("Who's playing?");
  if (pickFriends) {
    fireEvent.press(await findByText('Javi'));
    fireEvent.press(getByText('Alvaro'));
  }
  fireEvent.press(getByText('Next'));
  await findByText('REVIEW & CONFIRM');
}

describe('LeagueCreateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createLeague.mockResolvedValue({ id: 'L1', inviteCode: 'MULL-7Q4' });
  });

  test('Next is blocked until the league has a name', () => {
    const { getByText } = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    fireEvent.press(getByText('Next'));
    expect(getByText("What's the league called?")).toBeTruthy();
  });

  test('creates the league with rules, creator first, and friend handicaps clamped to the cap', async () => {
    const utils = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    await toReview(utils);
    fireEvent.press(utils.getByText('Create league'));

    await waitFor(() => expect(createLeague).toHaveBeenCalledTimes(1));
    const args = createLeague.mock.calls[0][0];
    expect(args.name).toBe('El Club');
    expect(args.feeCents).toBe(3000);
    expect(args.cap).toBe(30);
    expect(args.pointsTable[0]).toBe(500);
    expect(args.seasonEnd).toMatch(/-12-31$/);
    expect(args.members).toEqual([
      { userId: 'me', handicap: 18.4 },
      { userId: 'f1', handicap: 12.4 },
      { userId: 'f2', handicap: 30 },
    ]);
  });

  test('points for playing starts at 10, steps by 5 and is sent with the league', async () => {
    const utils = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    fireEvent.changeText(utils.getByPlaceholderText('El Club del Mulligan'), 'El Club');
    fireEvent.press(utils.getByText('Next'));
    await utils.findByText('How does it work?');
    expect(utils.getByText('Most Stableford points wins')).toBeTruthy();
    expect(utils.getByLabelText('Points for playing, 10')).toBeTruthy();
    expect(utils.getByText(/13th on/)).toBeTruthy();
    fireEvent.press(utils.getByLabelText('Fewer points'));
    fireEvent.press(utils.getByLabelText('Fewer points'));
    expect(utils.getByLabelText('Fewer points').props.accessibilityState.disabled).toBe(true);
    expect(utils.getByText(/Playing past 12th scores the same as not playing/)).toBeTruthy();
    fireEvent.press(utils.getByLabelText('More points'));
    fireEvent.press(utils.getByLabelText('More points'));
    fireEvent.press(utils.getByLabelText('More points'));
    expect(utils.getByLabelText('Points for playing, 15')).toBeTruthy();
  });

  test('the chosen points for playing reach createLeague', async () => {
    const utils = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    await toReview(utils, { pickFriends: false, morePoints: true });
    fireEvent.press(utils.getByText('Create league'));
    await waitFor(() => expect(createLeague).toHaveBeenCalledTimes(1));
    expect(createLeague.mock.calls[0][0].participationPoints).toBe(15);
  });

  test('shows the invite code and link on the done view, and a second tap cannot create twice', async () => {
    let release;
    createLeague.mockReturnValue(new Promise((r) => { release = r; }));
    const utils = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    await toReview(utils, { pickFriends: false });
    fireEvent.press(utils.getByText('Create league'));
    fireEvent.press(utils.getByText('Create league'));
    release({ id: 'L1', inviteCode: 'MULL-7Q4' });

    await utils.findByText('MULL-7Q4');
    expect(createLeague).toHaveBeenCalledTimes(1);
    expect(utils.getByText('LEAGUE CREATED')).toBeTruthy();

    fireEvent.press(utils.getByText('Open the league'));
    expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  test('a failed create keeps the wizard on review so the user can retry', async () => {
    createLeague.mockRejectedValueOnce(new Error('A league needs a name.'));
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    const utils = render(wrap(<LeagueCreateScreen navigation={navigation} />));
    await toReview(utils, { pickFriends: false });
    fireEvent.press(utils.getByText('Create league'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error', 'A league needs a name.'));
    fireEvent.press(utils.getByText('Create league'));
    await waitFor(() => expect(createLeague).toHaveBeenCalledTimes(2));
    alertSpy.mockRestore();
  });
});
