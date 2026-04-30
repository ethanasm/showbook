/**
 * Shared fake `ctx.db` for unit tests on tRPC routers. Drizzle's fluent
 * query builder is awkward to mock — every call (`.from`, `.where`,
 * `.innerJoin`, `.limit`, `.values`, `.onConflictDoNothing`,
 * `.returning`, `.set`, `.groupBy`, `.orderBy`) chains and the result is
 * a thenable. Rather than tracking each method name we expose a single
 * Proxy that:
 *   - returns itself for any chained method call
 *   - resolves (when awaited) to whatever `next()` from the scripted
 *     result list returns
 *
 * Each script entry is consumed by a terminal `select`/`update`/etc.
 * call, in source order. This gives unit tests a way to drive the
 * router's logic without standing up Postgres.
 */

export interface FakeDbOptions {
  /** Sequential results returned by terminal `select` chains. */
  selectResults?: unknown[];
  /** Sequential results returned by terminal `update().returning()` chains. */
  updateResults?: unknown[];
  /** Sequential results returned by terminal `delete().returning()` chains. */
  deleteResults?: unknown[];
  /** Sequential results returned by terminal `insert().returning()` chains. */
  insertResults?: unknown[];
}

export interface FakeDb {
  select: () => unknown;
  selectDistinct: () => unknown;
  insert: () => unknown;
  update: () => unknown;
  delete: () => unknown;
  transaction: <T>(fn: (tx: FakeDb) => Promise<T>) => Promise<T>;
  query: { shows: { findMany: () => Promise<unknown[]> } };
  /** Number of unconsumed select results — useful in assertions. */
  _remainingSelects(): number;
}

export function makeFakeDb(opts: FakeDbOptions = {}): FakeDb {
  const selects = [...(opts.selectResults ?? [])];
  const updates = [...(opts.updateResults ?? [])];
  const deletes = [...(opts.deleteResults ?? [])];
  const inserts = [...(opts.insertResults ?? [])];

  function chain(getResult: () => unknown) {
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          const value = getResult();
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(value).then(resolve);
        }
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  }

  function shift<T>(label: string, q: T[]): T {
    if (q.length === 0) {
      throw new Error(
        `fake db: ${label} called more times than scripted (out of results)`,
      );
    }
    return q.shift() as T;
  }

  const db: FakeDb = {
    select: () => chain(() => shift('select', selects)),
    // selectDistinct shares the same scripted select queue. Drizzle treats
    // it as a sibling of `select`, so for unit-test purposes routing both
    // through one queue keeps the script simple.
    selectDistinct: () => chain(() => shift('selectDistinct', selects)),
    insert: () => chain(() => (inserts.length ? shift('insert', inserts) : undefined)),
    update: () => chain(() => (updates.length ? shift('update', updates) : [])),
    delete: () => chain(() => (deletes.length ? shift('delete', deletes) : undefined)),
    transaction: async (fn) => fn(db),
    query: { shows: { findMany: async () => [] } },
    _remainingSelects: () => selects.length,
  };
  return db;
}

/**
 * Build a typed tRPC context with the given fake db and a session for
 * `userId`. The cast lets us hand `ctx` to `protectedProcedure` callers
 * without the real `Database` type.
 */
export function fakeCtx(db: FakeDb, userId = 'test-user'): unknown {
  return { db, session: { user: { id: userId } } };
}
