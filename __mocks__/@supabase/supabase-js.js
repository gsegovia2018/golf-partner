// Jest mock for @supabase/supabase-js — prevents URL-validation errors in unit tests.
const mockClient = {
  from: () => mockClient,
  select: () => mockClient,
  insert: () => mockClient,
  update: () => mockClient,
  delete: () => mockClient,
  eq: () => mockClient,
  single: () => Promise.resolve({ data: null, error: null }),
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  removeChannel: () => {},
};

export const createClient = () => mockClient;
