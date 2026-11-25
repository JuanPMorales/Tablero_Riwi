import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { runInNewContext } from 'node:vm';
import { openStore } from './store.mjs';
import { accountAuth } from './auth.mjs';
import { accountPrivacy } from './account-privacy.mjs';
import { credentialVault } from './credential-vault.mjs';
import { snapshotDatabase } from './backup-private.mjs';

const details = { document: '9000000621', password: 'PruebaVault123!', confirmation: 'PruebaVault123!',
  fullName: 'Persona Ficticia', email: 'vault@example.test', phone: '', clan: 'Ubuntu' };
const connection = { provider: 'groq', model: 'openai/gpt-oss-20b', credential: 'clave-ficticia-solo-para-pruebas' };
async function create(store, document) {
  const auth = accountAuth(store.db, { secure: true }), response = { setHeader(name, value) { this[name] = value; } };
  await auth.authenticate({ headers: {} }, response, { ...details, document }, true, document);
  return auth.session({ headers: { cookie: response['Set-Cookie'].split(';')[0] } });
}

test('clave cifrada sobrevive a reiniciar la base sin devolverse en metadatos ni mezclarse con otra cuenta', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riwi-vault-')), path = join(directory, 'test.sqlite');
  const previous = process.env.RIWI_CREDENTIAL_KEY;
  process.env.RIWI_CREDENTIAL_KEY = randomBytes(32).toString('base64');
  let store = await openStore(path);
  try {
    const account = await create(store, details.document), other = await create(store, '9000000622');
    let vault = credentialVault(store.db);
    const metadata = await vault.save(account, connection);
    assert.equal(metadata.saved, true);
    assert.ok(!JSON.stringify(metadata).includes(connection.credential));
    assert.equal((await vault.metadata(other)).saved, false);
    await assert.rejects(vault.load(other), { status: 404 });
    const row = (await store.db.execute('SELECT * FROM account_ai_connections')).rows[0];
    assert.ok(!JSON.stringify(row).includes(connection.credential));
    assert.equal(Buffer.from(row.nonce, 'base64').length, 12);
    store.close(); store = await openStore(path); vault = credentialVault(store.db);
    assert.equal((await vault.load(account)).credential, connection.credential);
    await store.db.execute('INSERT INTO account_ai_connections VALUES (?,?,?,?,?,?,?)',
      [other, row.provider, row.model, row.nonce, row.ciphertext, row.tag, row.updated]);
    await assert.rejects(vault.load(other), { status: 503 }, 'Copiar el cifrado entre cuentas no permite abrirlo');
    const backup = await snapshotDatabase(store.db);
    assert.equal(backup.tables.find(table => table.name === 'account_ai_connections').rows.length, 0);
    assert.ok(!JSON.stringify(backup).includes(row.ciphertext));
    const privacy = accountPrivacy(store.db, { sendMail: async () => {} });
    await privacy.erase(account, details.password, 'ELIMINAR', 'otra-cuenta-admin');
    assert.equal((await vault.metadata(account)).saved, false);
    await vault.forget(other);
    assert.equal((await vault.metadata(other)).saved, false);
  } finally {
    store.close();
    if (previous === undefined) delete process.env.RIWI_CREDENTIAL_KEY; else process.env.RIWI_CREDENTIAL_KEY = previous;
    assert.equal(dirname(directory), tmpdir()); assert.ok(basename(directory).startsWith('riwi-vault-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reemplazar y borrar una clave solo cambia la conexión de su cuenta', async () => {
  const store = await openStore(':memory:'), previous = process.env.RIWI_CREDENTIAL_KEY;
  process.env.RIWI_CREDENTIAL_KEY = randomBytes(32).toString('base64');
  try {
    const account = await create(store, details.document), other = await create(store, '9000000622');
    const vault = credentialVault(store.db);
    await vault.save(account, connection);
    await vault.save(other, connection);
    const replacement = { provider: 'openai', model: 'modelo-de-prueba', credential: 'otra-clave-ficticia-para-pruebas' };
    await vault.save(account, replacement);
    assert.equal((await vault.load(account)).credential, replacement.credential);
    assert.equal((await vault.metadata(account)).provider, replacement.provider);
    assert.equal((await vault.load(other)).credential, connection.credential);
    assert.equal((await store.db.execute('SELECT COUNT(*) AS total FROM account_ai_connections WHERE account=?', [account])).rows[0].total, 1);
    await vault.forget(account);
    await assert.rejects(vault.load(account), { status: 404 });
    assert.equal((await vault.load(other)).credential, connection.credential);
  } finally {
    store.close();
    if (previous === undefined) delete process.env.RIWI_CREDENTIAL_KEY; else process.env.RIWI_CREDENTIAL_KEY = previous;
  }
});

test('sin clave maestra el guardado falla cerrado, sin usar texto plano ni aceptar OAuth', async () => {
  const store = await openStore(':memory:'), previous = process.env.RIWI_CREDENTIAL_KEY;
  delete process.env.RIWI_CREDENTIAL_KEY;
  try {
    const account = await create(store, details.document), vault = credentialVault(store.db);
    await assert.rejects(vault.save(account, connection), { status: 503 });
    await assert.rejects(vault.save(account, { ...connection, provider: 'google-cloud' }), { status: 400 });
    assert.equal((await vault.metadata(account)).configured, false);
    assert.equal((await store.db.execute('SELECT * FROM account_ai_connections')).rows.length, 0);
  } finally {
    store.close(); if (previous !== undefined) process.env.RIWI_CREDENTIAL_KEY = previous;
  }
});

test('Enter envía una vez; Shift+Enter, composición, mensajes vacíos y envío pendiente no envían', () => {
  const source = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const start = source.indexOf("$('question').onkeydown ="), end = source.indexOf("$('attach-chat-file').onclick", start);
  assert.ok(start > 0 && end > start);
  let sent = 0, prevented = 0;
  const fields = { question: { value: 'Mi pregunta' }, send: { disabled: false }, ask: { requestSubmit() { sent++; } } };
  runInNewContext(source.slice(start, end), { $: id => fields[id] });
  const press = extra => fields.question.onkeydown({ key: 'Enter', preventDefault() { prevented++; }, ...extra });
  press({}); assert.equal(sent, 1); assert.equal(prevented, 1);
  for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { isComposing: true }, { keyCode: 229 }, { key: 'a' }]) press(extra);
  assert.equal(sent, 1); assert.equal(prevented, 1);
  fields.question.value = '  '; press({}); assert.equal(sent, 1);
  fields.question.value = 'Otra pregunta'; fields.send.disabled = true; press({}); assert.equal(sent, 1);
});
