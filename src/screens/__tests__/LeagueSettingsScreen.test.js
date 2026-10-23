import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueSettingsScreen from '../LeagueSettingsScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../components/PullToRefresh', () => {
  const { ScrollView } = require('react-native');
  return function PullToRefresh({ children }) { return <ScrollView>{children}</ScrollView>; };
});
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  updateLeagueRules: jest.fn(() => Promise.resolve()),
  setLeagueFeePaid: jest.fn(() => Promise.resolve()),
  setLeagueRole: jest.fn(() => Promise.resolve()),
  archiveLeague: jest.fn(() => Promise.resolve()),
  leaveLeague: jest.fn(() => Promise.resolve()),
  getLeagueShareLink: jest.fn(() => Promise.resolve('tokAAAAAAAAAAAAAAAAAAAAA')),
  setLeaguePublicBoard: jest.fn((id, enabled) => Promise.resolve({ enabled, token: enabled ? 'tokAAAAAAAAAAAAAAAAAAAAA' : null })),
  rotateLeaguePublicBoard: jest.fn(() => Promise.resolve({ enabled: true, token: 'tokBBBBBBBBBBBBBBBBBBBBB' })),
}));
jest.mock('../../store/settingsStore', () => ({
  updateAppSettings: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../hooks/useAppSettings', () => ({ useAppSettings: () => ({ notifications: {} }) }));

const store = require('../../store/leagueStore');
const { updateAppSettings } = require('../../store/settingsStore');

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 20, ...extra,
});

function snapshot({ admin = true } = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', handicapCap: 30, entryFeeCents: 3000, archivedAt: null, inviteCode: 'MULL',
      pointsTable: [500, 300, 190], participationPoints: 10, seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
    },
    members: [
      member('me', 'Marcos', { role: admin ? 'admin' : 'member' }),
      member('javi', 'Javi'),
    ],
    cards: [], cardsByMonth: {}, votes: [], handicapEvents: [], final: null,
  };
}

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeagueCached.mockResolvedValue(null);
  });
  afterEach(() => { jest.useRealTimers(); });

  test('an admin edits the rules and saves them through updateLeagueRules', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByDisplayValue, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByDisplayValue('El Club'));
    fireEvent.changeText(getByDisplayValue('El Club'), 'El Club 2');
    fireEvent.press(getByLabelText('1st place, 500 points'));
    fireEvent.changeText(getByLabelText('Points for 1st place'), '400');
    fireEvent.press(getByLabelText('2nd place, 300 points'));
    fireEvent.changeText(getByLabelText('Points for 2nd place'), '250');
    fireEvent.press(getByLabelText('3rd place, 190 points'));
    fireEvent.changeText(getByLabelText('Points for 3rd place'), '100');
    fireEvent.changeText(getByLabelText('Handicap cap'), '28');
    fireEvent.press(getByLabelText('More points'));
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledWith('L1', {
      name: 'El Club 2', seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
      pointsTable: [400, 250, 100], cap: 28, feeCents: 3000, participationPoints: 15,
    }));
  });

  test('the points table is the bar chart, starting from the league\'s table', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByLabelText, queryByDisplayValue } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByLabelText('1st place, 500 points'));
    getByLabelText('2nd place, 300 points');
    getByLabelText('3rd place, 190 points');
    expect(queryByDisplayValue('500, 300, 190')).toBeNull();
  });

  test('a place left empty blocks saving until it has a number', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByLabelText('3rd place, 190 points'));
    fireEvent.press(getByLabelText('3rd place, 190 points'));
    fireEvent.changeText(getByLabelText('Points for 3rd place'), '');
    fireEvent.press(getByText('Save rules'));
    expect(store.updateLeagueRules).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('Points for 3rd place'), '90');
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledTimes(1));
    expect(store.updateLeagueRules.mock.calls[0][1].pointsTable).toEqual([500, 300, 90]);
  });

  test('with no card yet the admin can change the format; only a change reaches updateLeagueRules', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText, queryByText, findByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByLabelText(/League format: Stableford/));
    expect(queryByText('Locked once the league has a card.')).toBeNull();
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledTimes(1));
    expect(store.updateLeagueRules.mock.calls[0][1]).not.toHaveProperty('format');

    fireEvent.press(getByLabelText(/League format: Stableford/));
    fireEvent.press(getByText('Medal play, net'));
    fireEvent.press(await findByText('Save rules', {}, { timeout: 4000 })); // "Saved" shows for 2 s
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledTimes(2));
    expect(store.updateLeagueRules.mock.calls[1][1]).toMatchObject({ format: 'medal_net' });
  });

  test('the server refusing a format change (format_locked) is explained', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const err = Object.assign(new Error("The format can't change once the league has a card."), { hint: 'format_locked' });
    store.updateLeagueRules.mockRejectedValueOnce(err);
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByLabelText(/League format: Stableford/));
    fireEvent.press(getByLabelText(/League format: Stableford/));
    fireEvent.press(getByText('Medal play, gross'));
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => getByText("The format can't change once the league has a card."));
  });

  test('a gross league has no handicap cap field and its fixed-rules note drops Stableford', async () => {
    const snap = snapshot();
    snap.league.format = 'medal_gross';
    store.getLeague.mockResolvedValue(snap);
    const { getByText, queryByLabelText, queryByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Medal play, gross'));
    expect(queryByLabelText('Handicap cap')).toBeNull();
    expect(getByText('One card a month is fixed for every league.')).toBeTruthy();
    expect(queryByText(/net Stableford are fixed/)).toBeNull();
  });

  test('once the league has a card the format is shown locked, with the note, and is not sent', async () => {
    const snap = snapshot();
    snap.league.format = 'medal_net';
    snap.cardsByMonth = { '2026-10': [{ userId: 'javi', status: 'submitted' }] };
    store.getLeague.mockResolvedValue(snap);
    const { getByText, queryByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Medal play, net'));
    expect(getByText('Locked once the league has a card.')).toBeTruthy();
    expect(queryByLabelText(/League format/)).toBeNull(); // not a picker
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledTimes(1));
    expect(store.updateLeagueRules.mock.calls[0][1]).not.toHaveProperty('format');
  });

  test('a read-only member sees the format in the rules', async () => {
    const snap = snapshot({ admin: false });
    snap.league.format = 'medal_gross';
    store.getLeague.mockResolvedValue(snap);
    const { getByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('One card a month · fewest gross strokes against par'));
  });

  test('points for playing is a stepper (step 5, never below 0) with a live payout line', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText, getByTestId } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Points for playing'));
    expect(getByText('Saving recomputes every month of the season.')).toBeTruthy();
    // 2 members, table of 3: the preview lists the places that exist.
    expect(getByTestId('payout-preview').props.children).toBeTruthy();
    fireEvent.press(getByLabelText('Fewer points'));
    fireEvent.press(getByLabelText('Fewer points'));
    expect(getByLabelText('Fewer points').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Points for playing, 0')).toBeTruthy();
    fireEvent.press(getByLabelText('More points'));
    expect(getByLabelText('Points for playing, 5')).toBeTruthy();
  });

  test('season dates are picked in the calendar sheet and the end cannot precede the start', async () => {
    // BottomSheet unmounts after a real 250 ms exit timer; under a loaded CI runner that blew past
    // waitFor's 1 s default and left the sheet mounted. Fake timers (clock pinned late on a UTC day,
    // a month-end-adjacent time that must not matter) make the close deterministic.
    jest.useFakeTimers({ now: new Date('2026-10-13T23:30:00.000Z') });
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByDisplayValue, getByLabelText, queryAllByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByDisplayValue('El Club'));
    fireEvent.press(getByLabelText('Season starts'));
    fireEvent.press(getByLabelText('Thu 15 Jan 2026'));
    fireEvent.press(getByLabelText('Done'));
    act(() => { jest.advanceTimersByTime(500); }); // exit animation + its fallback timer
    expect(queryAllByLabelText('Previous month')).toHaveLength(0); // sheet closed
    fireEvent.press(getByLabelText('Season ends'));
    for (let i = 0; i < 11; i += 1) fireEvent.press(getByLabelText('Previous month')); // Dec -> Jan
    expect(getByLabelText('Wed 14 Jan 2026').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Thu 15 Jan 2026').props.accessibilityState.disabled).toBe(false);
    expect(getByLabelText('Previous month').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByLabelText('Done'));
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledWith('L1', expect.objectContaining({
      seasonStart: '2026-01-15', seasonEnd: '2026-12-31',
    })));
  });

  test('a plain member sees the rules read-only and no admin controls', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, queryByText, queryByDisplayValue } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('One card a month · most Stableford points'));
    expect(getByText('Points for playing')).toBeTruthy();
    expect(getByText('10 for every confirmed card, whatever its place')).toBeTruthy();
    expect(queryByDisplayValue('El Club')).toBeNull();
    expect(queryByText('Save rules')).toBeNull();
    expect(queryByText('Archive the league')).toBeNull();
    expect(getByText('Leave league')).toBeTruthy();
  });

  test('LEAGUE section: the admin gets Members, no "Set up the Final" (hidden); a recorded Final is still an open link', async () => {
    store.getLeague.mockResolvedValueOnce({ ...snapshot(), votes: [{ id: 'v1' }] });
    const first = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => first.getByText('Members and handicaps'));
    expect(first.getByText('2 members · cap 30')).toBeTruthy();
    expect(first.getByText('1 vote open')).toBeTruthy();
    fireEvent.press(first.getByText('Members and handicaps'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueMembers', { leagueId: 'L1' });
    // The Final is hidden for now (LEAGUE_FINAL_ENABLED): no way to set it up.
    expect(first.queryByText('Set up the Final')).toBeNull();
    expect(first.queryByText('December · extra strokes from the standings')).toBeNull();
    first.unmount();

    store.getLeague.mockResolvedValueOnce({
      ...snapshot(), final: { tournamentId: 't9', strokes: {}, createdAt: '2026-12-13T10:00:00Z' },
    });
    const second = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => second.getByText(/^The Final · /));
    expect(second.queryByText('Set up the Final')).toBeNull();
    expect(second.queryByText('1 vote open')).toBeNull();
    fireEvent.press(second.getByText(/^The Final · /));
    expect(navigation.navigate).toHaveBeenCalledWith('Tournament', { tournamentId: 't9', viewMode: 'tournament' });
  });

  test('LEAGUE section: a member sees their handicap and no "Set up the Final"', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, queryByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Your league handicap 20.0'));
    expect(queryByText('Set up the Final')).toBeNull();
  });

  test('fee and admin switches call the store', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('MEMBERS'));
    fireEvent(getByLabelText('Javi paid'), 'valueChange', true);
    await waitFor(() => expect(store.setLeagueFeePaid).toHaveBeenCalledWith('L1', 'javi', true));
    // The switches are disabled while the fee saves.
    await waitFor(() => expect(getByLabelText('Javi admin').props.accessibilityState.disabled).toBe(false));
    fireEvent(getByLabelText('Javi admin'), 'valueChange', true);
    await waitFor(() => expect(store.setLeagueRole).toHaveBeenCalledWith('L1', 'javi', 'admin'));
  });

  test('notification switches save the whole league prefs object with defaults', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('NOTIFICATIONS'));
    fireEvent(getByLabelText('Someone tees off (email)'), 'valueChange', true);
    const patch = updateAppSettings.mock.calls[0][0];
    expect(patch.notifications.league.email.league_tee_off).toBe(true);
    expect(patch.notifications.league.push.league_tee_off).toBe(true);
  });

  test('archive asks first and only then archives', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Archive the league'));
    fireEvent.press(getByText('Archive the league'));
    expect(store.archiveLeague).not.toHaveBeenCalled();
    // The confirm is an in-app sheet; its action button is the exact word.
    fireEvent.press(getByText('Archive'));
    await waitFor(() => expect(store.archiveLeague).toHaveBeenCalledWith('L1'));
  });

  test('sharing (admin): the public board switch, the link and a new link', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const {
      getByText, getAllByText, getByLabelText, queryByText, findByText,
    } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    expect(await findByText('https://golf-partner.vercel.app/league-board/tokAAAAAAAAAAAAAAAAAAAAA')).toBeTruthy();
    expect(getByText('SHARING')).toBeTruthy();
    // A new link asks first and says what stops working.
    fireEvent.press(getByText('Make a new link'));
    expect(getByText('Every link already shared stops working. Members who left can still open the current link until you make a new one.')).toBeTruthy();
    expect(store.rotateLeaguePublicBoard).not.toHaveBeenCalled();
    const buttons = getAllByText('Make a new link');
    fireEvent.press(buttons[buttons.length - 1]);
    expect(await findByText('https://golf-partner.vercel.app/league-board/tokBBBBBBBBBBBBBBBBBBBBB')).toBeTruthy();
    expect(getByText('New link made. The old one no longer works.')).toBeTruthy();
    expect(store.rotateLeaguePublicBoard).toHaveBeenCalledWith('L1');
    fireEvent(getByLabelText('Public board link'), 'valueChange', false);
    await waitFor(() => expect(store.setLeaguePublicBoard).toHaveBeenCalledWith('L1', false));
    await waitFor(() => expect(queryByText(/league-board/)).toBeNull());
    expect(queryByText('Make a new link')).toBeNull();
  });

  test('sharing: a failed first load says so and Try again loads it', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    store.getLeagueShareLink.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { getByText, findByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    expect(await findByText("Couldn't load the public board link.")).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(await findByText('https://golf-partner.vercel.app/league-board/tokAAAAAAAAAAAAAAAAAAAAA')).toBeTruthy();
  });

  test('sharing is admin only', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, queryByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Leave league'));
    expect(queryByText('SHARING')).toBeNull();
    expect(store.getLeagueShareLink).not.toHaveBeenCalled();
  });

  test('leave asks first, leaves and goes back to the main tabs', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Leave league'));
    fireEvent.press(getByText('Leave league'));
    expect(store.leaveLeague).not.toHaveBeenCalled();
    fireEvent.press(getByText('Leave'));
    await waitFor(() => expect(store.leaveLeague).toHaveBeenCalledWith('L1'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Main'));
  });
});
