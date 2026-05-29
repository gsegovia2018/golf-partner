const mockState = {
  profileSelect: null,
  profileIn: null,
};

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => true),
}));

jest.mock('../../lib/supabase', () => {
  function feedCommentsBuilder() {
    return {
      select() { return this; },
      eq() { return this; },
      order() {
        return Promise.resolve({
          data: [
            {
              id: 'c1',
              user_id: 'user-2',
              body: 'Great round',
              created_at: '2026-05-29T10:00:00Z',
            },
          ],
          error: null,
        });
      },
    };
  }

  function profilesBuilder() {
    return {
      select(cols) {
        mockState.profileSelect = cols;
        return this;
      },
      in(column, values) {
        mockState.profileIn = { column, values };
        return Promise.resolve({
          data: [
            {
              user_id: 'user-2',
              display_name: 'Pablo',
              avatar_url: null,
              avatar_color: '#abcdef',
            },
          ],
          error: null,
        });
      },
    };
  }

  return {
    supabase: {
      from(table) {
        if (table === 'feed_comments') return feedCommentsBuilder();
        if (table === 'profiles') return profilesBuilder();
        throw new Error(`Unexpected table ${table}`);
      },
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
      },
    },
  };
});

describe('loadComments', () => {
  beforeEach(() => {
    mockState.profileSelect = null;
    mockState.profileIn = null;
    jest.resetModules();
  });

  test('hydrates comment authors from profiles.user_id', async () => {
    const { loadComments } = require('../feedStore');

    const comments = await loadComments('round:t1:r1');

    expect(mockState.profileSelect).toBe('user_id, display_name, avatar_url, avatar_color');
    expect(mockState.profileIn).toEqual({ column: 'user_id', values: ['user-2'] });
    expect(comments[0]).toMatchObject({
      id: 'c1',
      body: 'Great round',
      author: {
        name: 'Pablo',
        avatarColor: '#abcdef',
      },
    });
  });
});
