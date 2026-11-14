import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';

export function localDatabase(path) {
  const database = new DatabaseSync(path);
  const scope = new AsyncLocalStorage();
  let tail = Promise.resolve();
  function serialize(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  return {
    execute(sql, args = []) {
      const run = () => {
        const statement = database.prepare(sql);
        if (/^\s*SELECT\b/i.test(sql)) return { rows: statement.all(...args) };
        const result = statement.run(...args);
        return { changes: result.changes, id: Number(result.lastInsertRowid) };
      };
      return scope.getStore() ? run() : serialize(run);
    },
    schema(sql) {
      database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;' + sql);
    },
    transaction(work) {
      return serialize(async () => {
        database.exec('BEGIN IMMEDIATE');
        try {
          const result = await scope.run(true, work);
          database.exec('COMMIT');
          return result;
        } catch (error) {
          if (database.isTransaction) database.exec('ROLLBACK');
          throw error;
        }
      });
    },
    close: () => database.close(),
  };
}

export function remoteDatabase(client) {
  const scope = new AsyncLocalStorage();
  return {
    async execute(sql, args = []) {
      const result = await (scope.getStore() || client).execute({ sql, args });
      return { rows: result.rows, changes: result.rowsAffected, id: Number(result.lastInsertRowid) };
    },
    schema: sql => client.executeMultiple(sql),
    async transaction(work) {
      const tx = await client.transaction('write');
      try {
        const result = await scope.run(tx, work);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
      } finally {
        tx.close();
      }
    },
    close: () => client.close(),
  };
}

