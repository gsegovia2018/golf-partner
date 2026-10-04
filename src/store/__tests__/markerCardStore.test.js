import { getMarkerCard, confirmMarkerCard, MarkerCardError } from '../markerCardStore';

const mockState = { calls: [], result: { data: null, error: null }, throws: null };

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => {
      mockState.calls.push([fn, args]);
      if (mockState.throws) return Promise.reject(mockState.throws);
      return Promise.resolve(mockState.result);
    },
  },
}));

beforeEach(() => {
  mockState.calls = [];
  mockState.result = { data: null, error: null };
  mockState.throws = null;
});

describe('getMarkerCard', () => {
  test('sends the token and maps the whitelist to camelCase', async () => {
    mockState.result = {
      data: {
        player_first_name: 'Marcos', course: 'El Saler', tee: 'Yellow', date: '2026-10-04',
        playing_handicap: 20, gross: 80, points: 36, expires_at: '2026-10-04T12:00:00Z',
        holes: [{ n: 1, par: 4, si: 7, strokes: 5 }, { n: 2, par: 3, si: 15 }],
      },
      error: null,
    };
    const card = await getMarkerCard('tok');
    expect(mockState.calls).toEqual([['get_marker_card', { p_token: 'tok' }]]);
    expect(card).toEqual({
      playerFirstName: 'Marcos', course: 'El Saler', tee: 'Yellow', date: '2026-10-04',
      playingHandicap: 20, gross: 80, points: 36, expiresAt: '2026-10-04T12:00:00Z',
      holes: [{ n: 1, par: 4, si: 7, strokes: 5 }, { n: 2, par: 3, si: 15, strokes: null }],
    });
  });

  test.each(['expired', 'used', 'invalid', 'changed'])('server "%s" becomes reason', async (word) => {
    mockState.result = { data: null, error: { code: 'P0001', message: word } };
    const err = await getMarkerCard('tok').catch((e) => e);
    expect(err).toBeInstanceOf(MarkerCardError);
    expect(err.message).toBe(word);
    expect(err.reason).toBe(word);
    expect(err.offline).toBe(false);
  });

  test('network failure is offline with no reason', async () => {
    mockState.throws = new TypeError('Failed to fetch');
    const err = await getMarkerCard('tok').catch((e) => e);
    expect(err.offline).toBe(true);
    expect(err.reason).toBeNull();
  });
});

describe('confirmMarkerCard', () => {
  test('confirm sends name, ok and note', async () => {
    mockState.result = { data: { status: 'confirmed' }, error: null };
    expect(await confirmMarkerCard('tok', 'Pepe', true)).toEqual({ status: 'confirmed' });
    expect(mockState.calls).toEqual([['confirm_marker_card', {
      p_token: 'tok', p_marker_name: 'Pepe', p_ok: true, p_note: null,
    }]]);
  });

  test('"something is wrong" returns the card with the note', async () => {
    mockState.result = { data: { status: 'returned' }, error: null };
    expect(await confirmMarkerCard('tok', 'Pepe', false, 'hole 4 is a 6')).toEqual({ status: 'returned' });
    expect(mockState.calls[0][1]).toMatchObject({ p_ok: false, p_note: 'hole 4 is a 6' });
  });

  test('server message is kept for a missing name', async () => {
    mockState.result = { data: null, error: { code: 'P0001', message: 'Type your name to sign the card.' } };
    const err = await confirmMarkerCard('tok', '', true).catch((e) => e);
    expect(err.message).toBe('Type your name to sign the card.');
    expect(err.reason).toBeNull();
  });

  test('changed snapshot surfaces as reason', async () => {
    mockState.result = { data: null, error: { code: 'P0001', message: 'changed' } };
    const err = await confirmMarkerCard('tok', 'Pepe', true).catch((e) => e);
    expect(err.reason).toBe('changed');
  });
});
