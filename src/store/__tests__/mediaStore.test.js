import { insertMediaRow, subscribeMediaChanges } from '../mediaStore';

// mockState is read inside the jest.mock factory; the `mock` prefix is what
// lets jest's hoisted factory reference it.
const mockState = { insertError: null };

jest.mock('../../lib/supabase', () => {
  const client = {
    from: () => client,
    insert: () => Promise.resolve({ error: mockState.insertError }),
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `https://example.test/${path}` } }),
      }),
    },
  };
  return { supabase: client };
});

describe('insertMediaRow', () => {
  beforeEach(() => {
    mockState.insertError = null;
  });

  const baseRow = {
    id: 'm1',
    tournamentId: 't1',
    roundId: 'r1',
    holeIndex: 0,
    kind: 'photo',
    storagePath: 't1/r1/m1.jpg',
    thumbPath: 't1/r1/thumbs/m1.jpg',
    durationS: null,
    caption: null,
    uploaderLabel: 'Ana',
  };

  test('resolves cleanly on a fresh insert', async () => {
    await expect(insertMediaRow(baseRow)).resolves.toBeUndefined();
  });

  test('a 23505 unique-violation (re-run after crash between insert and dequeue) is treated as success, not thrown', async () => {
    mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };

    await expect(insertMediaRow(baseRow)).resolves.toBeUndefined();
  });

  test('a non-duplicate error still throws', async () => {
    mockState.insertError = { code: '23502', message: 'null value in column violates not-null constraint' };

    await expect(insertMediaRow(baseRow)).rejects.toMatchObject({ code: '23502' });
  });

  test('a successful insert notifies subscribers', async () => {
    const fn = jest.fn();
    const unsubscribe = subscribeMediaChanges(fn);
    try {
      await insertMediaRow(baseRow);
      expect(fn).toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
