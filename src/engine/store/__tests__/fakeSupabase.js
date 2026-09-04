// A fake Supabase client for the card-store tests: an in-memory pair of
// tables, a record of every upsert attempted, injectable failures, and a hand
// crank for realtime payloads.

const PRIMARY_KEYS = {
  scorer_cards: ['tournament_id', 'round_id', 'author_id'],
  score_resolutions: ['tournament_id', 'round_id', 'player_id', 'hole'],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

export function createFakeSupabase() {
  const tables = { scorer_cards: [], score_resolutions: [] };
  const upserts = [];
  const deletes = [];
  const channels = [];
  // table -> { remaining, error }
  const failures = new Map();
  const deleteFailures = new Map();

  function pkOf(table, row) {
    return PRIMARY_KEYS[table].map((c) => String(row[c])).join('|');
  }

  function put(table, row) {
    const rows = tables[table];
    const i = rows.findIndex((r) => pkOf(table, r) === pkOf(table, row));
    if (i >= 0) rows[i] = clone(row);
    else rows.push(clone(row));
  }

  function deleteBuilder(table) {
    const filters = [];
    const run = () => {
      deletes.push({ table, filters: filters.map(([c, v]) => [c, v]) });
      const fail = deleteFailures.get(table);
      if (fail && fail.remaining > 0) {
        fail.remaining -= 1;
        return Promise.resolve({ data: null, error: fail.error });
      }
      const rows = tables[table];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (filters.every(([c, v]) => rows[i][c] === v)) rows.splice(i, 1);
      }
      return Promise.resolve({ data: null, error: null });
    };
    const builder = {
      eq(column, value) {
        filters.push([column, value]);
        return builder;
      },
      then(onFulfilled, onRejected) {
        return run().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function selectBuilder(table) {
    const filters = [];
    const run = () => {
      const data = tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
      return Promise.resolve({ data: clone(data), error: null });
    };
    const builder = {
      eq(column, value) {
        filters.push([column, value]);
        return builder;
      },
      then(onFulfilled, onRejected) {
        return run().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const client = {
    from(table) {
      return {
        select() {
          return selectBuilder(table);
        },
        delete() {
          return deleteBuilder(table);
        },
        upsert(row, options) {
          upserts.push({ table, row: clone(row), options });
          const fail = failures.get(table);
          if (fail && fail.remaining > 0) {
            fail.remaining -= 1;
            return Promise.resolve({ data: null, error: fail.error });
          }
          put(table, row);
          return Promise.resolve({ data: [clone(row)], error: null });
        },
      };
    },
    channel(name) {
      const handlers = [];
      const ch = {
        name,
        statusCb: null,
        handlers,
        on(type, config, handler) {
          handlers.push({ type, config, handler });
          return ch;
        },
        subscribe(cb) {
          ch.statusCb = cb;
          if (cb) cb('SUBSCRIBED');
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      const i = channels.indexOf(ch);
      if (i >= 0) channels.splice(i, 1);
    },
  };

  return {
    client,
    tables,
    upserts,
    deletes,
    channels,
    /** Seed a row without recording it as an upsert. */
    seed(table, row) {
      put(table, row);
    },
    /** Make the next `n` upserts against `table` fail with `error`. */
    failUpserts(table, n, error = { message: 'network down', code: 'PGRST000' }) {
      failures.set(table, { remaining: n, error });
    },
    /** Make the next `n` deletes against `table` fail with `error`. */
    failDeletes(table, n, error = { message: 'network down', code: 'PGRST000' }) {
      deleteFailures.set(table, { remaining: n, error });
    },
    deletesFor(table) {
      return deletes.filter((d) => d.table === table);
    },
    upsertsFor(table) {
      return upserts.filter((u) => u.table === table);
    },
    /** Deliver a postgres_changes payload to every matching handler. */
    emit(table, row, eventType = 'UPDATE') {
      for (const ch of channels) {
        for (const h of ch.handlers) {
          if (h.config?.table !== table) continue;
          h.handler({ eventType, schema: 'public', table, new: clone(row), old: null });
        }
      }
    },
    /** Drive the channel status callback (CHANNEL_ERROR, SUBSCRIBED, …). */
    emitStatus(status) {
      for (const ch of channels) ch.statusCb?.(status);
    },
  };
}

/** An in-memory AsyncStorage-shaped backing store. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: jest.fn((k) => Promise.resolve(map.has(k) ? map.get(k) : null)),
    setItem: jest.fn((k, v) => {
      map.set(k, v);
      return Promise.resolve();
    }),
    removeItem: jest.fn((k) => {
      map.delete(k);
      return Promise.resolve();
    }),
  };
}
