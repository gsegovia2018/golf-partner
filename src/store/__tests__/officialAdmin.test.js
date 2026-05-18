import { createOfficialTournament } from '../officialAdmin';

// mockState is read inside the jest.mock factory; the `mock` prefix is what
// lets jest's hoisted factory reference it.
const mockState = { insertedRow: undefined, user: { id: 'user-1' } };

// The `uuid` package ships ESM that jest-expo's transformIgnorePatterns skip;
// stub it so officialAdmin.js loads under jest.
jest.mock('uuid', () => ({ v4: () => 'test-uuid-0001' }));

jest.mock('../../lib/supabase', () => {
  const client = {
    from: () => client,
    insert: (row) => { mockState.insertedRow = row; return client; },
    select: () => client,
    single: () => {
      // Faithful to the real `tournaments` table: `id` is a text primary key
      // with no DB-side default, so an insert that omits it is rejected.
      const row = mockState.insertedRow;
      if (!row || row.id == null || row.id === '') {
        return Promise.resolve({
          data: null,
          error: {
            code: '23502',
            message: 'null value in column "id" of relation "tournaments" violates not-null constraint',
          },
        });
      }
      return Promise.resolve({ data: { id: row.id }, error: null });
    },
    auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
  };
  return { supabase: client };
});

describe('createOfficialTournament', () => {
  beforeEach(() => {
    mockState.insertedRow = undefined;
    mockState.user = { id: 'user-1' };
  });

  test('inserts a client-generated id so the non-defaulted tournaments.id PK is satisfied', async () => {
    const id = await createOfficialTournament({ name: 'Weekend Golf' });
    expect(mockState.insertedRow.id).toBeTruthy();
    expect(id).toBe(mockState.insertedRow.id);
  });

  test('flags the row official and owned by the current user', async () => {
    await createOfficialTournament({ name: 'Weekend Golf' });
    expect(mockState.insertedRow).toMatchObject({
      name: 'Weekend Golf',
      kind: 'official',
      created_by: 'user-1',
    });
  });

  test('throws when no user is signed in', async () => {
    mockState.user = null;
    await expect(createOfficialTournament({ name: 'X' })).rejects.toThrow('Not signed in');
  });
});
