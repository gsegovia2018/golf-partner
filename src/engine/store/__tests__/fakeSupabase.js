// A fake Supabase client for the card-store tests: an in-memory pair of
// tables, a record of every upsert and RPC attempted, injectable failures, and
// a hand crank for realtime payloads. `put_score_resolution` reproduces the
// first-wins rule of 20260906000000_score_resolutions_first_wins.sql.

const PRIMARY_KEYS = {
  scorer_cards: ['tournament_id', 'round_id', 'author_id'],
  score_resolutions: ['tournament_id', 'round_id', 'player_id', 'hole'],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// jsonb equality: by value, key order irrelevant — exactly how Postgres
// compares the `basis` column in put_score_resolution.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function createFakeSupabase() {
  const tables = { scorer_cards: [], score_resolutions: [] };
  const upserts = [];
  const deletes = [];
  const channels = [];
  // table -> { remaining, error }
  const failures = new Map();
  // [{ table, match, remaining, error }] — failures aimed at particular rows,
  // so a test can wedge one tournament while another keeps working.
  const matchedFailures = [];
  const deleteFailures = new Map();
  const rpcs = [];
  const rpcFailures = new Map();
  // Deterministic server clock for resolved_at, so a test can tell the row it
  // pushed from the row that was already standing.
  let stamp = Date.parse('2026-09-06T00:00:00.000Z');

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

  // The server side of 20260906000000_score_resolutions_first_wins.sql: the
  // first valid agreement on a basis wins; a row whose basis no longer matches
  // is stale and is replaced.
  function putScoreResolution(p) {
    const rows = tables.score_resolutions;
    const incoming = {
      tournament_id: p.p_tournament_id,
      round_id: p.p_round_id,
      player_id: p.p_player_id,
      hole: p.p_hole,
      value: p.p_value ?? null,
      resolved_by: p.p_resolved_by,
      basis: p.p_basis ?? {},
      resolved_at: new Date((stamp += 1000)).toISOString(),
    };
    const i = rows.findIndex((r) => pkOf('score_resolutions', r) === pkOf('score_resolutions', incoming));
    if (i >= 0 && canonical(rows[i].basis) === canonical(incoming.basis)) return clone(rows[i]);
    put('score_resolutions', incoming);
    return clone(incoming);
  }

  const client = {
    rpc(fn, params) {
      rpcs.push({ fn, params: clone(params ?? {}) });
      const fail = rpcFailures.get(fn);
      if (fail && fail.remaining > 0) {
        fail.remaining -= 1;
        return Promise.resolve({ data: null, error: fail.error });
      }
      if (fn === 'put_score_resolution') {
        return Promise.resolve({ data: putScoreResolution(params), error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}`, code: 'PGRST202' } });
    },
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
          const matched = matchedFailures.find((f) => f.table === table
            && f.remaining > 0
            && Object.entries(f.match).every(([c, v]) => row[c] === v));
          if (matched) {
            matched.remaining -= 1;
            return Promise.resolve({ data: null, error: matched.error });
          }
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
    rpcs,
    /** Seed a row without recording it as an upsert. */
    seed(table, row) {
      put(table, row);
    },
    /** Make the next `n` upserts against `table` fail with `error`. */
    failUpserts(table, n, error = { message: 'network down', code: 'PGRST000' }) {
      failures.set(table, { remaining: n, error });
    },
    /** Make the next `n` upserts against `table` whose row matches every
     *  column in `match` fail with `error`. Rows that do not match still land. */
    failUpsertsMatching(table, match, n, error = { message: 'network down', code: 'PGRST000' }) {
      matchedFailures.push({ table, match, remaining: n, error });
    },
    /** Make the next `n` calls of `fn` fail with `error`. */
    failRpc(fn, n, error = { message: 'network down', code: 'PGRST000' }) {
      rpcFailures.set(fn, { remaining: n, error });
    },
    rpcsFor(fn) {
      return rpcs.filter((r) => r.fn === fn);
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
