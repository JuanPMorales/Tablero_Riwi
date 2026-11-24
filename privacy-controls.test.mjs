import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { accountAuth, digest } from './auth.mjs';
import { accountPrivacy } from './account-privacy.mjs';
import { privateChatDatabase } from './private-chat.mjs';
import { encryptBackup, decryptBackup, snapshotDatabase, restorePrivateSnapshot } from './backup-private.mjs';

const payload = { document: '9000000451', password: 'PruebaPrivada123!', confirmation: 'PruebaPrivada123!',
  fullName: 'Perfil Ficticio', email: 'perfil@example.test', phone: '3000000000', clan: 'Ubuntu' };
const req = cookie => ({ headers: cookie ? { cookie } : {} });
const res = () => ({ setHeader(name, value) { this[name] = value; } });
async function fixture(path = ':memory:') {
  const store = await openStore(path), auth = accountAuth(store.db, { secure: true });
  const response = res();
  await auth.authenticate(req(), response, payload, true, 'fixture');
  const cookie = response['Set-Cookie'].split(';')[0], id = await auth.session(req(cookie));
  return { store, auth, cookie, id };
}

test('el chat filtrado persiste al reabrir la base, mantiene su contexto y no mezcla cuentas ni guarda títulos personales', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riwi-private-chat-'));
  const path = join(directory, 'fixture.sqlite');
  const { store, id } = await fixture(path);
  let privacy = privateChatDatabase(store);
  try {
    const account = privacy.forAccount(id), other = privacy.forAccount('otra-cuenta');
    const chat = await account.createChat(1, '0-0', 'Nombre personal que no debe guardarse');
    await account.saveChat(1, '0-0', `Ayúdame con reduce. ${payload.fullName} ${payload.email}`, `Documento: ${payload.document}`, 0);
    assert.equal((await account.chatHistory(1, '0-0')).length, 2);
    assert.deepEqual(await other.chatHistory(1, '0-0'), []);
    assert.equal(chat.title, 'Conversación de estudio');
    await assert.rejects(account.saveHistoryNote(1, 'Nota privada'), { status: 403 });
    for (const table of ['account_history_notes', 'legacy_thread_titles', 'messages', 'chat']) {
      assert.equal((await store.db.execute(`SELECT COUNT(*) AS total FROM ${table}`)).rows[0].total, 0);
    }
    assert.equal((await store.db.execute('SELECT COUNT(*) AS total FROM account_messages')).rows[0].total, 2);
    const saved = await account.chatHistory(1, '0-0');
    for (const value of [payload.fullName, payload.email, payload.document]) assert.ok(!JSON.stringify(saved).includes(value));
    assert.ok(saved[0].content.includes('reduce'));
    await account.applyTicks(1, { '0-0': true });
    privacy.close();
    privacy = privateChatDatabase(await openStore(path));
    const reopened = privacy.forAccount(id);
    assert.deepEqual(await reopened.chatHistory(1, '0-0'), saved);
    assert.equal((await reopened.snapshot()).checked.length, 1);
    assert.equal((await reopened.findChat(chat.chat)).title, 'Conversación de estudio');
    assert.deepEqual(await privacy.forAccount('otra-cuenta').chatHistory(1, '0-0'), []);
  } finally {
    privacy.close();
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith('riwi-private-chat-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verificación y recuperación usan correo del perfil, tokens de un uso, vencimiento y revocación de sesiones', async () => {
  const { store, auth, id, cookie } = await fixture();
  let now = Date.now(); const mail = [];
  const privacy = accountPrivacy(store.db, { now: () => now, sendMail: async (...args) => { mail.push(args); } });
  const take = () => new URLSearchParams(new URL(mail.at(-1)[2]).hash.slice(1)).get('token');
  try {
    assert.equal((await privacy.state(id)).externalAIAllowed, false);
    await privacy.requestReset(payload.document, payload.email, 'ip', 'https://example.test');
    assert.equal(mail.length, 0, 'Un correo sin verificar no permite tomar la cuenta');
    await privacy.requestVerification(id, 'https://example.test');
    const verification = take();
    assert.equal(mail[0][0], payload.email);
    const stored = (await store.db.execute('SELECT * FROM account_action_tokens')).rows[0];
    assert.notEqual(stored.digest, verification);
    await assert.rejects(privacy.consume(verification, 'reset', { password: 'Cambio123!', confirmation: 'Cambio123!' }), { status: 400 });
    await privacy.consume(verification, 'verify');
    await assert.rejects(privacy.consume(verification, 'verify'), { status: 400 });
    assert.equal((await privacy.state(id)).emailVerified, true);
    await privacy.requestReset(payload.document, 'otra@example.test', 'ip', 'https://example.test');
    assert.equal(mail.length, 1);
    await privacy.requestReset(payload.document, payload.email, 'ip', 'https://example.test');
    const reset = take();
    const results = await Promise.allSettled([1, 2].map(() => privacy.consume(reset, 'reset', { password: 'Cambio123!', confirmation: 'Cambio123!' })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await auth.session(req(cookie)), null);
    await auth.authenticate(req(), res(), { ...payload, password: 'Cambio123!' }, false, 'new-login');
    await privacy.requestVerification(id, 'https://example.test');
    const expired = take(); now += 16 * 60000;
    await assert.rejects(privacy.consume(expired, 'verify'), { status: 400 });
    await privacy.requestVerification(id, 'https://example.test');
    const oldEmail = take();
    await store.forAccount(id).saveProfile({ ...payload, email: 'cambiado@example.test' });
    await assert.rejects(privacy.consume(oldEmail, 'verify'), { status: 400 });
    assert.equal((await privacy.state(id)).emailVerified, false);
  } finally { store.close(); }
});

test('eliminar cuenta exige contraseña y confirmación, conserva otras cuentas y deja constancia para restauraciones', async () => {
  const { store, auth, id, cookie } = await fixture();
  const privacy = accountPrivacy(store.db, { sendMail: async () => {} });
  try {
    await auth.authenticate(req(), res(), { ...payload, document: '9000000452' }, true, 'second');
    await store.forAccount(id).applyTicks(1, { '0-0': true });
    await privacy.consent(id, true, true);
    assert.equal((await privacy.state(id)).externalAIAllowed, true);
    await store.db.execute('UPDATE account_security SET privacy_version=? WHERE account=?', ['2026-11-24', id]);
    assert.equal((await privacy.state(id)).accepted, false, 'El cambio de conservación exige renovar el aviso');
    assert.equal((await privacy.state(id)).externalAIAllowed, false);
    await privacy.consent(id, false, true);
    assert.equal((await privacy.state(id)).externalAIAllowed, false);
    await assert.rejects(privacy.erase(id, 'Incorrecta123', 'ELIMINAR', 'otro-owner'), { status: 401 });
    await assert.rejects(privacy.erase(id, payload.password, 'ELIMINAR', id), { status: 409 });
    await privacy.erase(id, payload.password, 'ELIMINAR', 'otro-owner');
    assert.equal(await auth.session(req(cookie)), null);
    assert.equal((await store.db.execute('SELECT id FROM accounts')).rows.length, 1);
    assert.equal((await store.db.execute('SELECT * FROM privacy_deletions')).rows[0].account_digest, digest(id).toString('hex'));
    assert.ok((await store.find(1)).quests.length);
  } finally { store.close(); }
});

test('respaldo cifrado restaura progreso y chats filtrados sin sesiones ni revivir cuentas eliminadas', async () => {
  const { store, id } = await fixture();
  const privacy = accountPrivacy(store.db, { sendMail: async () => {} });
  try {
    await privacy.consent(id, true, true);
    await store.forAccount(id).applyTicks(1, { '0-0': true });
    await store.forAccount(id).saveHistoryNote(1, 'Texto antiguo que no debe ir al respaldo');
    await store.forAccount(id).saveChat(1, '0-0', `Ayúdame con reduce ${payload.email}`, 'Prueba el arreglo vacío', 0);
    const snapshot = await snapshotDatabase(store.db), key = randomBytes(32);
    const encrypted = encryptBackup(snapshot, key);
    assert.ok(!encrypted.includes(Buffer.from(payload.email)));
    assert.ok(!JSON.stringify(snapshot).includes('Texto antiguo'));
    assert.throws(() => decryptBackup(encrypted, randomBytes(32)));
    const damaged = Buffer.from(encrypted); damaged[damaged.length - 1] ^= 1;
    assert.throws(() => decryptBackup(damaged, key));
    const decoded = decryptBackup(encrypted, key), counts = restorePrivateSnapshot(decoded, ':memory:');
    assert.equal(counts.accounts, 1); assert.equal(counts.account_ticks, 1); assert.equal(counts.logins, 0);
    assert.equal(counts.account_history_notes, 0);
    assert.equal(counts.account_messages, 2);
    assert.ok(!JSON.stringify(decoded.tables.find(table => table.name === 'account_messages')).includes(payload.email));
    assert.equal(decoded.tables.find(table => table.name === 'account_security').rows[0].external_ai, 0);
    const afterDeletion = restorePrivateSnapshot(decoded, ':memory:', [digest(id).toString('hex')]);
    assert.equal(afterDeletion.accounts, 0); assert.equal(afterDeletion.account_profiles, 0); assert.equal(afterDeletion.account_ticks, 0);
    assert.equal(afterDeletion.account_messages, 0);
    assert.ok(afterDeletion.lessons > 0);
  } finally { store.close(); }
});

test('herramienta de respaldo crea, verifica y restaura un archivo cifrado en un entorno aislado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riwi-private-backup-'));
  mkdirSync(join(directory, 'data'));
  const source = join(directory, 'data', 'fixture.sqlite'), store = await openStore(source);
  const privacy = accountPrivacy(store.db, { sendMail: async () => {} });
  await privacy.state('owner');
  await store.forAccount('owner').applyTicks(1, { '0-0': true });
  store.close();
  const env = { ...process.env, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', RIWI_DB_PATH: source, RIWI_BACKUP_KEY: randomBytes(32).toString('base64') };
  const script = fileURLToPath(new URL('./scripts/private-backup.mjs', import.meta.url));
  const run = args => JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    assert.equal(run(['create', 'backups/fixture.enc']).operation, 'backup-verified');
    const bytes = readFileSync(join(directory, 'backups', 'fixture.enc'));
    assert.ok(bytes.subarray(0, 21).toString().startsWith('RIWI-PRIVATE-BACKUP-1'));
    assert.equal(run(['verify', 'backups/fixture.enc']).counts.account_ticks, 1);
    assert.equal(run(['restore', 'backups/fixture.enc', 'data/restored.sqlite']).counts.account_ticks, 1);
    assert.throws(() => run(['restore', 'backups/fixture.enc', 'data/restored.sqlite']));
  } finally {
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith('riwi-private-backup-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
