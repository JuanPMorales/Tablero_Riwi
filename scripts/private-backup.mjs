import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { localDatabase, remoteDatabase } from '../database.mjs';
import { backupKey, encryptBackup, decryptBackup, snapshotDatabase, restorePrivateSnapshot } from '../backup-private.mjs';

const [command, file, target] = process.argv.slice(2);
const key = backupKey(process.env.RIWI_BACKUP_KEY);
const privatePath = value => {
  const path = resolve(value || '');
  if (!['data', 'backups'].some(folder => path.startsWith(resolve(folder) + '\\') || path.startsWith(resolve(folder) + '/'))) throw new Error('Usa un archivo dentro de data/ o backups/, excluidos de GitHub.');
  return path;
};
async function sourceDatabase() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    const { createClient } = await import('@libsql/client');
    return remoteDatabase(createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }));
  }
  const source = process.env.RIWI_DB_PATH;
  if (!source || !existsSync(source)) throw new Error('Configura la base de origen. No se creará una base vacía.');
  return localDatabase(source);
}
if (command === 'create') {
  const output = privatePath(file || `backups/riwi-private-${Date.now()}.enc`);
  if (existsSync(output)) throw new Error('El archivo de respaldo ya existe.');
  const db = await sourceDatabase();
  try {
    const snapshot = await snapshotDatabase(db), encrypted = encryptBackup(snapshot, key);
    const counts = restorePrivateSnapshot(decryptBackup(encrypted, key), ':memory:');
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, encrypted, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ operation: 'backup-verified', file: output, counts }));
  } finally { db.close(); }
} else if (command === 'verify' || command === 'restore') {
  const snapshot = decryptBackup(readFileSync(privatePath(file)), key);
  let deletions = [];
  if (command === 'restore') {
    // Reapply deletions made AFTER the backup; never silently resurrect accounts.
    const db = await sourceDatabase();
    try { deletions = (await db.execute('SELECT account_digest FROM privacy_deletions')).rows.map(row => row.account_digest); }
    finally { db.close(); }
    if (!target) throw new Error('Indica un destino nuevo dentro de data/. Nunca se sobrescribe producción.');
  }
  const counts = restorePrivateSnapshot(snapshot, command === 'verify' ? ':memory:' : privatePath(target), deletions);
  console.log(JSON.stringify({ operation: command, counts }));
} else throw new Error('Usa create [backups/archivo.enc], verify backups/archivo.enc o restore backups/archivo.enc data/base-nueva.sqlite.');
