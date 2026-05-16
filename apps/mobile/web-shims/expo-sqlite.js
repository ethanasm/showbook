// In-memory no-op SQLite handle for the web target.
//
// The cache layer (apps/mobile/lib/cache/) opens an expo-sqlite handle
// on first request and reuses it for the React Query persister + outbox.
// Web verification doesn't care about cache correctness — we just need
// the imports to resolve and the handle methods to return sensible
// empty results so the app boots into the auth gate.

const databases = new Map();

function makeHandle(name) {
  return {
    _name: name,
    async closeAsync() {
      databases.delete(name);
    },
    async execAsync(_sql) {
      return undefined;
    },
    async runAsync(_sql, _params) {
      return { lastInsertRowId: 0, changes: 0 };
    },
    async getFirstAsync(_sql, _params) {
      return null;
    },
    async getAllAsync(_sql, _params) {
      return [];
    },
  };
}

async function openDatabaseAsync(name) {
  let handle = databases.get(name);
  if (!handle) {
    handle = makeHandle(name);
    databases.set(name, handle);
  }
  return handle;
}

async function deleteDatabaseAsync(name) {
  databases.delete(name);
}

module.exports = {
  openDatabaseAsync,
  deleteDatabaseAsync,
  // The real module also exports openDatabaseSync, SQLiteDatabase, etc.
  // App code only uses the two async helpers above; if a new call site
  // needs more, add it here rather than in a real web implementation.
};
