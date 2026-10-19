import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  feedShotDetection, getRoundStops, loadShotProposals, dismissProposal, confirmProposals,
  setDetectionHole, PROPOSALS_PREFIX, __resetShotProposalsForTests,
} from '../shotProposalStore';
import { shotsForHole, pruneShotsToRounds, logShot } from '../shotStore';
import { getActiveTrailRound, isTrailRecordingEnabled } from '../gpsTrailStore';

jest.mock('../gpsTrailStore', () => ({
  ...jest.requireActual('../gpsTrailStore'),
  getActiveTrailRound: jest.fn(),
  isTrailRecordingEnabled: jest.fn(),
}));
// No signed-in user: shotStore stays local-only.
jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } },
}));

const M = 1 / 111195;
// An expo-location fix `north` metres up a line, at second `t`.
const fix = (t, north) => ({ timestamp: t * 1000, coords: { latitude: 40 + north * M, longitude: -3.7, accuracy: 4 } });
// Stand 20 s at 0 m, then walk 2 m every 2 s to 40 m.
const standThenWalk = () => {
  const out = [fix(0, 0)];
  let t = 20;
  for (let d = 2; d <= 40; d += 2) { out.push(fix(t, d)); t += 2; }
  return out;
};
const ROUND = { userId: 'u1', tournamentId: 't1', roundId: 't1-r0', roundIndex: 0 };

beforeEach(async () => {
  await AsyncStorage.clear();
  await pruneShotsToRounds(new Set());
  __resetShotProposalsForTests();
  getActiveTrailRound.mockResolvedValue(ROUND);
  isTrailRecordingEnabled.mockResolvedValue(true);
});

test('fixes become a stored proposal stamped with the hole on screen', async () => {
  setDetectionHole(4);
  expect(await feedShotDetection(standThenWalk())).toBe(1);
  const [p] = getRoundStops('t1-r0', 0);
  expect(p).toMatchObject({ hole: 4, status: 'open' });
  expect(JSON.parse(await AsyncStorage.getItem(`${PROPOSALS_PREFIX}t1-r0|0`))).toHaveLength(1);
});

test('nothing is detected with the setting off or no live round', async () => {
  isTrailRecordingEnabled.mockResolvedValue(false);
  expect(await feedShotDetection(standThenWalk())).toBe(0);
  isTrailRecordingEnabled.mockResolvedValue(true);
  getActiveTrailRound.mockResolvedValue(null);
  expect(await feedShotDetection(standThenWalk())).toBe(0);
  expect(getRoundStops('t1-r0', 0)).toEqual([]);
});

test('stored proposals load back; confirm writes a shot in order; dismiss', async () => {
  const stops = [
    { id: 'a', start: 1, end: 2, lat: 40, lng: -3.7, hole: 1, status: 'open' },
    { id: 'b', start: 3, end: 4, lat: 40 + 200 * M, lng: -3.7, hole: 1, status: 'open' },
  ];
  await AsyncStorage.setItem(`${PROPOSALS_PREFIX}t1-r0|0`, JSON.stringify(stops));
  await loadShotProposals('t1-r0', 0);
  expect(getRoundStops('t1-r0', 0)).toHaveLength(2);

  // A shot marked by hand at 300 m: the 200 m proposal goes before it.
  await logShot({ roundId: 't1-r0', roundIndex: 0, holeNumber: 1, pos: [40 + 300 * M, -3.7], club: '9i' });
  const created = await confirmProposals({
    roundId: 't1-r0', roundIndex: 0, holeNumber: 1, proposals: [stops[1]], green: [40 + 360 * M, -3.7], clubFor: () => '7i',
  });
  expect(created.map((s) => s.club)).toEqual(['7i']);
  expect(shotsForHole('t1-r0', 0, 1).map((s) => s.club)).toEqual(['7i', '9i']);
  expect(getRoundStops('t1-r0', 0)[1]).toMatchObject({ status: 'added' });

  // Confirming again (a second tap queued behind the first) adds nothing.
  await confirmProposals({ roundId: 't1-r0', roundIndex: 0, holeNumber: 1, proposals: [stops[1]] });
  expect(shotsForHole('t1-r0', 0, 1)).toHaveLength(2);

  await dismissProposal('t1-r0', 0, 'a');
  expect(getRoundStops('t1-r0', 0)[0].status).toBe('dismissed');
});
