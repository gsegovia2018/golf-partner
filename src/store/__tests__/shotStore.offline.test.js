import {
  hydrateShots, logShot, setShotClub, deleteShot, getShots, __shotUploadsSettled,
} from '../shotStore';
import { supabase } from '../../lib/supabase';

// Signed in, on a weak signal: every Supabase call hangs until the test lets
// it through.
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../lib/authUser', () => ({ authUserId: jest.fn().mockResolvedValue('u1') }));
jest.mock('../../lib/telemetry', () => ({ track: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const held = []; // { kind, row, release }
const sent = []; // every upserted row, in order
const hang = (kind) => (row) => new Promise((resolve) => {
  if (kind === 'upsert') sent.push(row);
  held.push({ kind, row, release: () => resolve({ error: null }) });
});
const releaseAll = async () => {
  while (held.length) { held.shift().release(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }
};

beforeAll(async () => {
  supabase.from.mockImplementation(() => ({
    upsert: hang('upsert'),
    delete: () => ({ eq: (_c, id) => hang('delete')({ id }) }),
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  }));
  await hydrateShots();
});

afterEach(async () => { await releaseAll(); await __shotUploadsSettled(); });

const mark = (seq, club = null) => logShot({ roundId: 'r1', roundIndex: 0, holeNumber: 1, pos: [40 + seq * 1e-3, -3], club });

test('a mark returns at once while its upload hangs, and so does the next', async () => {
  const a = await mark(1);
  const b = await mark(2);
  expect(getShots().filter((s) => s.roundId === 'r1').map((s) => s.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  expect(a.pending).toBe(true);
  await releaseAll();
  await __shotUploadsSettled();
  expect(a.pending).toBeUndefined();
  expect(b.pending).toBeUndefined();
});

test('a club changed while the mark is uploading reaches the server and stays pending until it does', async () => {
  const a = await mark(3);
  await setShotClub(a.id, '7i');
  held.shift().release(); // the mark's upload, sent without a club
  await new Promise((r) => setTimeout(r, 0));
  expect(a.pending).toBe(true);
  await releaseAll();
  await __shotUploadsSettled();
  expect(a.pending).toBeUndefined();
  const mine = sent.filter((r) => r.id === a.id);
  expect(mine.map((r) => r.club)).toEqual([null, '7i']);
});

test('a delete waits behind the shot\'s own upload', async () => {
  const a = await mark(4);
  await deleteShot(a.id);
  expect(held.map((h) => h.kind)).toEqual(['upsert']);
  await releaseAll();
  await __shotUploadsSettled();
  expect(getShots().some((s) => s.id === a.id)).toBe(false);
});
