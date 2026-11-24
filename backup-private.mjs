import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { digest } from './auth.mjs';
import { profilePrivateValues, redactAIText } from './ai-privacy.mjs';

const header = Buffer.from('RIWI-PRIVATE-BACKUP-1\n');
const included = new Set(['lessons', 'settings', 'sessions', 'session_modules', 'accounts', 'account_profiles',
  'account_ticks', 'account_completions', 'account_daily', 'account_notice_dismissals', 'account_security', 'privacy_deletions',
  'account_messages', 'account_threads', 'legacy_thread_titles', 'chat_revisions']);
const schemaOnly = new Set(['ticks', 'inbox', 'chat', 'completions', 'daily', 'messages', 'logins', 'auth_limits',
  'account_history_notes', 'account_action_tokens']);

export function backupKey(value) {
  const key = Buffer.from(value || '', 'base64');
  if (key.length !== 32) throw new Error('Configura RIWI_BACKUP_KEY con una clave base64 de 32 bytes, guardada fuera del repositorio.');
  return key;
}
export function encryptBackup(snapshot, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(bytes, key) {
  if (!bytes.subarray(0, header.length).equals(header)) throw new Error('Formato de respaldo no válido.');
  const offset = header.length, decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(offset, offset + 12));
  decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  const snapshot = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]).toString('utf8'));
  if (snapshot.version !== 1 || !Array.isArray(snapshot.tables)) throw new Error('Contenido de respaldo no válido.');
  return snapshot;
}
export async function snapshotDatabase(db) {
  return db.transaction(async () => {
    const definitions = (await db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")).rows;
    const profiles = (await db.execute('SELECT a.id,a.document,p.full_name AS fullName,p.email,p.phone FROM accounts a LEFT JOIN account_profiles p ON p.account=a.id')).rows;
    const privateValues = new Map(profiles.map(profile => [profile.id, profilePrivateValues(profile)]));
    const tables = [];
    for (const { name, sql } of definitions) {
      if (!included.has(name) && !schemaOnly.has(name)) continue;
      let rows = included.has(name) ? (await db.execute(`SELECT * FROM ${name}`)).rows.map(row => ({ ...row })) : [];
      if (name === 'settings') rows = rows.filter(row => /^(?:schema-v[23]|content-owner-account|(?:(?:[a-f0-9-]+):)?(?:active|step|notifications-paused|notification-schedule))$/.test(row.key));
      if (name === 'account_security') rows = rows.map(row => ({ ...row, external_ai: 0, privacy_version: '', consent_at: 0 }));
      if (name === 'account_messages') rows = rows.map(row => ({ ...row, content: redactAIText(row.content, privateValues.get(row.account) || []) }));
      if (['account_threads', 'legacy_thread_titles'].includes(name)) rows = rows.map(row => ({ ...row, title: 'Conversación de estudio' }));
      tables.push({ name, sql, rows });
    }
    const indexes = (await db.execute("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")).rows
      .filter(row => included.has(row.tbl_name) || schemaOnly.has(row.tbl_name)).map(row => row.sql);
    return { version: 1, created: new Date().toISOString(), tables, indexes };
  });
}

export function restorePrivateSnapshot(snapshot, target, currentDeletionDigests = []) {
  if (target !== ':memory:' && existsSync(target)) throw new Error('El destino ya existe: no se sobrescribe una base en uso.');
  const database = new DatabaseSync(target);
  try {
    database.exec('BEGIN');
    for (const table of snapshot.tables) {
      if (!included.has(table.name) && !schemaOnly.has(table.name)) throw new Error('Tabla no permitida en respaldo.');
      if (!table.sql.startsWith('CREATE TABLE') || !Array.isArray(table.rows)) throw new Error('Esquema no válido.');
      database.exec(table.sql);
      if (schemaOnly.has(table.name) && table.rows.length) throw new Error('El respaldo contiene texto o sesiones que no deben restaurarse.');
      for (const row of table.rows) {
        const columns = Object.keys(row);
        if (columns.some(name => !/^\w+$/.test(name))) throw new Error('Columna no válida.');
        database.prepare(`INSERT INTO ${table.name} (${columns.map(name => `"${name}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(name => row[name]));
      }
    }
    for (const sql of snapshot.indexes || []) database.exec(sql);
    if (snapshot.tables.some(table => table.name === 'accounts')) {
      const deleted = new Set(currentDeletionDigests);
      if (snapshot.tables.some(table => table.name === 'privacy_deletions')) {
        for (const row of database.prepare('SELECT account_digest FROM privacy_deletions').all()) deleted.add(row.account_digest);
        for (const hash of currentDeletionDigests) database.prepare('INSERT OR IGNORE INTO privacy_deletions VALUES (?,?)').run(hash, Date.now());
      }
      for (const account of database.prepare('SELECT id FROM accounts').all()) if (deleted.has(digest(account.id).toString('hex'))) {
        for (const table of snapshot.tables) {
          if (table.name !== 'accounts' && included.has(table.name)
            && database.prepare(`PRAGMA table_info(${table.name})`).all().some(column => column.name === 'account')) {
            database.prepare(`DELETE FROM ${table.name} WHERE account=?`).run(account.id);
          }
        }
        database.prepare('DELETE FROM settings WHERE substr(key,1,?)=?').run(account.id.length + 1, account.id + ':');
        database.prepare('DELETE FROM accounts WHERE id=?').run(account.id);
      }
    }
    if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Falló la integridad del respaldo.');
    const counts = Object.fromEntries(snapshot.tables.map(table => [table.name, database.prepare(`SELECT COUNT(*) AS total FROM ${table.name}`).get().total]));
    database.exec('COMMIT'); return counts;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally { database.close(); }
}
