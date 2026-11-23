import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { accountAuth } from './auth.mjs';
import { openStore } from './store.mjs';
import { cloudRequest, cloudAnswer } from './providers.mjs';

const profile = { document: '9000000099', password: 'SoloPruebas123!', confirmation: 'SoloPruebas123!',
  fullName: 'Persona Ficticia', email: 'seguridad@example.test', phone: '3000000000', clan: 'Ubuntu' };
const req = cookie => ({ headers: cookie ? { cookie } : {} });
const response = () => ({ setHeader(name, value) { this[name] = value; } });

test('seguridad: registro repetido conserva cuenta, contraseña, perfil y sesión originales', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  try {
    const first = response();
    await auth.authenticate(req(), first, profile, true, 'registro-original');
    const cookie = first['Set-Cookie'].split(';')[0];
    const account = await auth.session(req(cookie));
    const before = (await store.db.execute('SELECT * FROM accounts')).rows;
    const repeated = response();
    await assert.rejects(auth.authenticate(req(cookie), repeated,
      { ...profile, document: ` ${profile.document} `, password: 'OtraClave456!', confirmation: 'OtraClave456!', fullName: 'Otro Perfil' },
      true, 'registro-repetido'), { status: 409 });
    assert.equal(repeated['Set-Cookie'], undefined);
    assert.deepEqual((await store.db.execute('SELECT * FROM accounts')).rows, before);
    assert.equal((await store.forAccount(account).readProfile()).fullName, profile.fullName);
    assert.equal(await auth.session(req(cookie)), account);
    await auth.authenticate(req(), response(), profile, false, 'comprobar-clave');
  } finally { store.close(); }
});

test('seguridad: dos registros simultáneos de la misma cédula crean exactamente una cuenta', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  try {
    const responses = [response(), response()];
    const results = await Promise.allSettled(responses.map((res, i) => auth.authenticate(req(), res, profile, true, `simultaneo-${i}`)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.deepEqual(results.filter(result => result.status === 'rejected').map(result => result.reason.status), [409]);
    for (const table of ['accounts', 'account_profiles', 'logins']) {
      assert.equal((await store.db.execute(`SELECT COUNT(*) AS total FROM ${table}`)).rows[0].total, 1);
    }
    assert.equal(responses.filter(res => res['Set-Cookie']).length, 1);
  } finally { store.close(); }
});

test('seguridad: intentos SQL no evaden el acceso ni modifican tablas o datos de otras cuentas', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  const attacks = ["' OR 1=1 --", "'; DROP TABLE accounts; --", "' UNION SELECT id,salt,hash FROM accounts --"];
  try {
    const registered = response();
    await auth.authenticate(req(), registered, profile, true, 'registro-local');
    const account = await auth.session(req(registered['Set-Cookie'].split(';')[0]));
    const own = store.forAccount(account);
    const other = store.forAccount('cuenta-ajena-de-prueba');
    await other.saveHistoryNote(1, 'Nota privada de otra cuenta');
    await other.saveChat(1, '', 'Pregunta privada', 'Respuesta privada', await other.chatRevision(1, ''));
    const beforeAccounts = (await store.db.execute('SELECT * FROM accounts')).rows;
    const beforeProfile = await own.readProfile();
    const beforeOther = await other.chatHistory(1, '');
    for (const [index, attack] of attacks.entries()) {
      const denied = response();
      await assert.rejects(auth.authenticate(req(), denied, { ...profile, document: attack }, false, `sql-doc-${index}`), { status: 400 });
      await assert.rejects(auth.authenticate(req(), denied, { ...profile, password: attack }, false, `sql-pass-${index}`), { status: 401 });
      assert.equal(denied['Set-Cookie'], undefined);
      assert.equal(await auth.session(req(`__Host-riwi_session=${attack}`)), null);
      await own.saveHistoryNote(1, attack);
      assert.equal((await own.snapshot()).historyNotes[1], attack);
      await own.saveChat(1, '', attack, 'Respuesta de prueba', await own.chatRevision(1, ''));
      assert.ok((await own.chatHistory(1, '')).some(message => message.content === attack));
      const thread = await own.createChat(1, '', attack);
      assert.equal((await own.findChat(thread.chat)).title, attack);
      assert.equal(await other.findChat(thread.chat), undefined);
      assert.equal(await own.findChat(attack), undefined);
      const maliciousScope = store.forAccount(attack);
      assert.deepEqual(await maliciousScope.chatHistory(1, ''), []);
      assert.equal(await maliciousScope.readProfile(), null);
    }
    await own.saveProfile({ ...beforeProfile, email: "x'/**/OR/**/1=1--@example.test" });
    assert.equal((await own.readProfile()).email, "x'/**/or/**/1=1--@example.test");
    assert.deepEqual((await store.db.execute('SELECT * FROM accounts')).rows, beforeAccounts);
    assert.deepEqual(await other.chatHistory(1, ''), beforeOther);
    assert.equal((await other.snapshot()).historyNotes[1], 'Nota privada de otra cuenta');
    assert.equal((await store.db.execute('SELECT integrity_check FROM pragma_integrity_check')).rows[0].integrity_check, 'ok');
  } finally { store.close(); }
});

test('seguridad: sesión aleatoria, secretos derivados, rotación, expiración y cierre efectivo', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  try {
    const registered = response();
    await auth.authenticate(req(), registered, profile, true, 'registro-local');
    const cookie = registered['Set-Cookie'].split(';')[0];
    const token = cookie.split('=')[1];
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(registered['Set-Cookie'], /HttpOnly; SameSite=Lax;.*Secure/);
    const account = await auth.session(req(cookie));
    assert.ok(account);
    const saved = (await store.db.execute('SELECT * FROM accounts')).rows[0];
    assert.notEqual(saved.hash, profile.password);
    assert.equal(saved.hash.length, 128);
    const session = (await store.db.execute('SELECT * FROM logins')).rows[0];
    assert.notEqual(session.token, token);
    assert.equal(session.token.length, 64);
    assert.equal(await auth.session(req(cookie.slice(0, -1) + '!')), null);
    const logged = response();
    await auth.authenticate(req(cookie), logged, profile, false, 'login-local');
    const fresh = logged['Set-Cookie'].split(';')[0];
    assert.notEqual(fresh, cookie);
    assert.equal(await auth.session(req(cookie)), null);
    assert.equal(await auth.session(req(fresh)), account);
    await store.db.execute('UPDATE logins SET expires=?', [Date.now() - 1]);
    assert.equal(await auth.session(req(fresh)), null);
    await auth.authenticate(req(), logged, profile, false, 'login-local');
    const finalCookie = logged['Set-Cookie'].split(';')[0];
    await auth.logout(req(finalCookie), logged);
    assert.match(logged['Set-Cookie'], /Max-Age=0/);
    assert.equal(await auth.session(req(finalCookie)), null);
  } finally { store.close(); }
});

test('seguridad: bloquea fuerza bruta por cuenta aunque cambie la dirección del cliente', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  try {
    await auth.authenticate(req(), response(), profile, true, 'registro-local');
    for (let i = 0; i < 8; i++) {
      await assert.rejects(auth.authenticate(req(), response(), { ...profile, password: 'Incorrecta123' }, false, `cliente-${i}`), { status: 401 });
    }
    await assert.rejects(auth.authenticate(req(), response(), profile, false, 'otra-direccion'), { status: 429 });
    await assert.rejects(auth.authenticate(req(), response(), { ...profile, document: "' OR 1=1 --" }, false, 'otra'), { status: 400 });
    assert.equal((await store.db.execute('SELECT id FROM accounts')).rows.length, 1);
  } finally { store.close(); }
});

test('seguridad: Markdown bloquea HTML, enlaces ejecutables e imágenes de rastreo', () => {
  const browser = {};
  for (const path of ['./node_modules/markdown-it/dist/browser/markdown-it.umd.min.js',
    './node_modules/@highlightjs/cdn-assets/highlight.min.js', './chat-blocks.js']) {
    runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), browser);
  }
  const { markdown } = browser.RiwiChatBlocks;
  for (const input of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
    '[abrir](javascript:alert(1))', '[abrir](data:text/html;base64,PHNjcmlwdD4=)',
    '![seguimiento](https://example.invalid/pixel.png)']) {
    const html = markdown.render(input);
    assert.doesNotMatch(html, /<script|<img|href="(?:javascript|data):/i);
  }
  assert.match(markdown.render('[documentación](https://example.test)'), /rel="noopener noreferrer"/);
});

test('seguridad: proveedores fijos, sin redirecciones y sin eco de credenciales', async () => {
  const connection = { provider: 'groq', model: 'openai/gpt-oss-20b', credential: 'clave-ficticia-para-pruebas' };
  assert.throws(() => cloudRequest({ ...connection, provider: 'http://127.0.0.1' }, []), { status: 400 });
  assert.throws(() => cloudRequest({ ...connection, model: '../../archivo' }, []), { status: 400 });
  assert.throws(() => cloudRequest({ ...connection, credential: 'valor\r\nHeader: inyectado' }, []), { status: 400 });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      return Response.json({ choices: [{ message: { content: `No mostrar ${connection.credential}` } }] });
    };
    const answer = await cloudAnswer(connection, []);
    assert.ok(!answer.includes(connection.credential));
    assert.match(answer, /credencial omitida/);
  } finally { globalThis.fetch = original; }
});
