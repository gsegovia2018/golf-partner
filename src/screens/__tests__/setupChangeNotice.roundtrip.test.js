import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import { setupSignature, describeSetupChange } from '../setupChangeNotice';

// The scorecard's "… changed on another phone" banner compares the setup it
// saw on focus (the local copy Setup just saved) with every later one. The
// first later one is the server's copy of the same game, arriving through the
// post-drain reconcile or the background fetch. A game started from Setup, with
// no other phone in play, must not read as changed when that copy lands.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));
jest.mock('../../components/PostCreateInviteModal', () => () => null);
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('../../store/mutate', () => ({
  ...jest.requireActual('../../store/mutate'),
  mutate: jest.fn((current) => Promise.resolve(current)),
}));
jest.mock('../../store/leagueStore', () => ({
  getMyLeagues: jest.fn(),
  getMyCardsForMonth: jest.fn(),
  announceLeagueCard: jest.fn(),
}));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })) },
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

const store = require('../../store/leagueStore');
const { mutate, applyPendingMutations, unionLocalRoster } = require('../../store/mutate');
const { supabase } = require('../../lib/supabase');
const repo = require('../../store/tournamentRepo');
const { resolveTeeForPlayer } = require('../../store/tees');

// jsonb does not keep key order: keys come back sorted by length, then bytes.
function jsonb(v) {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, jsonb(v[k])]));
  }
  return v;
}

// get_game_tournament's reassembly of what create_game_tournament stored.
function serverCopy(payload) {
  const p = jsonb(JSON.parse(JSON.stringify(payload)));
  const t = p.tournament;
  return jsonb({
    ...t.props,
    id: t.id,
    name: t.name,
    kind: t.props.kind ?? t.kind,
    createdAt: t.created_at,
    players: p.players.map((r) => ({ ...r.body, id: r.player_id })),
    rounds: p.rounds.map((r) => {
      const { notes, ...body } = r.body;
      return { ...body, id: r.id, scores: {}, shotDetails: {} };
    }),
    ...(t.current_round != null ? { currentRound: t.current_round } : {}),
  });
}

// Created locally by Setup, written by tournamentRepo.createTournament, read
// back and overlaid the way _overlayAndSave / the post-drain reconcile do.
async function roundTrip(local) {
  supabase.rpc.mockClear();
  await repo.createTournament(local);
  const [, { p_payload }] = supabase.rpc.mock.calls.find(([name]) => name === 'create_game_tournament');
  const merged = applyPendingMutations(unionLocalRoster({ ...serverCopy(p_payload) }, local), []);
  merged.meId = local.meId;
  return merged;
}

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const yellow = { label: 'Yellow', slope: 125, rating: 72 };
const league = {
  id: 'L1', name: 'El Club del Mulligan', seasonStart: '2000-01-01', seasonEnd: '2999-12-31',
  archivedAt: null, role: 'member', leagueHandicap: 18,
};
// The Tees step (RoundTeeAssignments) leaves each player's tee as
// resolveTeeForPlayer's {label, rating, slope} and an integer playing handicap.
const teesStepRound = {
  id: 'r1', courseName: 'Centro Nacional', holes, tees: [yellow],
  playerTees: { p1: resolveTeeForPlayer(yellow) }, playerHandicaps: { p1: 5 }, manualHandicaps: {},
};
const params = (over = {}) => ({
  kind: 'game',
  initialStep: 'review',
  prefill: {
    players: [{ id: 'p1', name: 'Marcos', handicap: 4, user_id: 'user-1' }],
    rounds: [teesStepRound],
  },
  ...over,
});
const navigation = { goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn() };

async function startFromSetup(routeParams, readyText) {
  const utils = render(<ThemeProvider><SetupScreen navigation={navigation} route={{ params: routeParams }} /></ThemeProvider>);
  await utils.findByText(readyText);
  fireEvent.press(utils.getByText('Start Game'));
  await waitFor(() => expect(mutate).toHaveBeenCalled());
  return mutate.mock.calls.find(([, m]) => m.type === 'tournament.create')[1].tournament;
}

describe('setup change notice across the server round trip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getMyLeagues.mockResolvedValue([league]);
    store.getMyCardsForMonth.mockResolvedValue([]);
    store.announceLeagueCard.mockResolvedValue({ id: 'card-1', month: '2026-10-01', announcedAt: 'x', leagueHandicap: 18 });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => { Alert.alert.mockRestore(); });

  test('a solo game: the server copy is not a change', async () => {
    const local = await startFromSetup(params(), 'Counts for El Club del Mulligan');
    const server = await roundTrip(local);
    expect(describeSetupChange(setupSignature(local, 0), setupSignature(server, 0))).toBeNull();
  });

  test('a solo league game: the server copy is not a change', async () => {
    const local = await startFromSetup(params({ leagueId: 'L1' }), /strokes from your league handicap/);
    expect(local.league).toBeTruthy();
    const server = await roundTrip(local);
    expect(describeSetupChange(setupSignature(local, 0), setupSignature(server, 0))).toBeNull();
  });
});
