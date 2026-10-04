import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueAddProofScreen from '../LeagueAddProofScreen';

jest.mock('../../hooks/useLeague', () => ({ useLeague: () => ({ data: null }) }));
jest.mock('../../lib/mediaCapture', () => ({ pickMedia: jest.fn() }));
jest.mock('../../store/leagueStore', () => ({
  submitLeagueCard: jest.fn(),
  addUnannouncedLeagueCard: jest.fn(),
  uploadLeagueProof: jest.fn(),
  attachLeagueProof: jest.fn(),
}));

const store = require('../../store/leagueStore');
const { pickMedia } = require('../../lib/mediaCapture');
const { courseSnapshot, holesPayload } = require('../../store/leagueOffApp');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const snapshot = courseSnapshot({ name: 'Golf Olivar', holes }, null);
const strokes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 5]));

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) });
const params = (extra = {}) => ({
  params: {
    leagueId: 'L1', cardId: null, snapshot, playedOn: '2025-10-04', strokes, leagueHandicap: 18, ...extra,
  },
});
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const submitDisabled = (utils, name = 'Submit card') => utils.getByRole('button', { name }).props.accessibilityState.disabled;

async function choosePhoto(utils) {
  fireEvent.press(utils.getByText('From gallery'));
  await waitFor(() => expect(submitDisabled(utils)).toBe(false));
}

describe('LeagueAddProofScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pickMedia.mockResolvedValue({ localUri: 'file:///card.jpg' });
    store.addUnannouncedLeagueCard.mockResolvedValue({ id: 'new1' });
    store.submitLeagueCard.mockResolvedValue({ id: 'c1' });
    store.uploadLeagueProof.mockResolvedValue('L1/new1.jpg');
    store.attachLeagueProof.mockResolvedValue();
  });

  test('shows the summary and keeps Submit disabled until a photo is chosen', async () => {
    const utils = render(wrap(<LeagueAddProofScreen navigation={nav()} route={params()} />));
    expect(utils.getByText(/^Golf Olivar · Sat 4 Oct · \d+ pts · gross 90$/)).toBeTruthy();
    expect(submitDisabled(utils)).toBe(true);
    await choosePhoto(utils);
  });

  test('unannounced: adds, uploads, attaches with the marker, then returns to the board', async () => {
    const navigation = nav();
    const utils = render(wrap(<LeagueAddProofScreen navigation={navigation} route={params()} />));
    await choosePhoto(utils);
    fireEvent.changeText(utils.getByLabelText("Marker's name"), 'Lucía');
    fireEvent.press(utils.getByText('Submit card'));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' }));
    expect(store.addUnannouncedLeagueCard).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'L1', playedOn: '2025-10-04', holes: holesPayload(strokes), gross: 90, teeTime: null,
    }));
    expect(store.uploadLeagueProof).toHaveBeenCalledWith('L1', 'new1', 'file:///card.jpg');
    expect(store.attachLeagueProof).toHaveBeenCalledWith('new1', 'L1/new1.jpg', 'photo', 'Lucía');
  });

  test('a failed upload shows the error, offers Retry and does not add the card twice', async () => {
    store.uploadLeagueProof.mockRejectedValueOnce(new Error('Upload failed'));
    const navigation = nav();
    const utils = render(wrap(<LeagueAddProofScreen navigation={navigation} route={params()} />));
    await choosePhoto(utils);
    fireEvent.press(utils.getByText('Submit card'));
    expect(await utils.findByText('Upload failed')).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();

    fireEvent.press(await utils.findByText('Retry'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' }));
    expect(store.addUnannouncedLeagueCard).toHaveBeenCalledTimes(1);
  });

  test('announced card with the official toggle: submit then attach as "official"', async () => {
    store.uploadLeagueProof.mockResolvedValue('L1/c1.jpg');
    const navigation = nav();
    const utils = render(wrap(<LeagueAddProofScreen navigation={navigation} route={params({ cardId: 'c1' })} />));
    fireEvent(utils.getByLabelText('It was an official tournament'), 'valueChange', true);
    expect(utils.queryByLabelText("Marker's name")).toBeNull();
    await choosePhoto(utils);
    fireEvent.press(utils.getByText('Submit card'));
    await waitFor(() => expect(store.attachLeagueProof).toHaveBeenCalledWith('c1', 'L1/c1.jpg', 'official', null));
    expect(store.submitLeagueCard).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'c1', gross: 90 }));
  });
});
