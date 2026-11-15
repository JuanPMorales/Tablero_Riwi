import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openStore } from './store.mjs';
import { remoteDatabase } from './database.mjs';
import { localAnswer } from './guide.mjs';

const directory = mkdtempSync(join(tmpdir(), 'tablero-riwi-'));
process.env.RIWI_DB_PATH = join(directory, 'handlers.sqlite');
process.env.NODE_ENV = 'production';
process.env.RIWI_ORIGIN = 'https://tablero.example';
delete process.env.RIWI_OLLAMA_MODEL;
process.env.RIWI_MOODLE_TOKEN = 'token-fixture';
process.env.CRON_SECRET = 'cron-secret-for-fixture';
process.env.GOOGLE_CLIENT_ID = 'fixture.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'fixture-secret';
const { handleRequest, closeDatabase, writeOriginAllowed } = await import('./server.mjs');
const ownerDetails = { document: '1000000001', password: 'owner-fixture-password' };
let ownerCookie;

async function call(url, data, { auth = true, cookie = auth ? ownerCookie : undefined,
  origin = process.env.RIWI_ORIGIN, bearer, handler = handleRequest } = {}) {
  const request = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  request.method = data === undefined ? 'GET' : 'POST';
  request.url = url;
  request.headers = { origin, 'content-type': 'application/json' };
  if (cookie) request.headers.cookie = cookie;
  if (bearer) request.headers.authorization = 'Bearer ' + bearer;
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(value) { this.value = String(value); },
    get headersSent() { return Boolean(this.status); },
  };
  await handler(request, response);
  if (response.headers['Content-Type']?.startsWith('application/json')) response.json = JSON.parse(response.value);
  return response;
}

test('autenticación de las páginas, recursos y API; protección de origen', async () => {
  const headers = { host: 'mi-tablero.vercel.app', origin: 'https://mi-tablero.vercel.app', 'content-type': 'application/json' };
  assert.equal(writeOriginAllowed(headers, true), true);
  assert.equal(writeOriginAllowed({ ...headers, origin: 'https://otro.vercel.app' }, true), false);
  assert.equal(writeOriginAllowed({ ...headers, origin: 'http://mi-tablero.vercel.app' }, true), false);
  assert.equal((await call('/', undefined, { auth: false })).headers.Location, '/login');
  assert.match((await call('/login', undefined, { auth: false })).value, /Cédula/);
  for (const path of ['/ui.js', '/health', '/api/state', '/api/chat/1', '/api/chat/1/2-0']) {
    const unauthorized = await call(path, undefined, { auth: false });
    assert.equal(unauthorized.status, 401, path);
  }
  const registration = await call('/api/auth/register', ownerDetails);
  assert.equal(registration.status, 200);
  assert.match(registration.headers['Set-Cookie'], /^__Host-riwi_session=.*; HttpOnly; SameSite=Lax; .*; Secure$/);
  ownerCookie = registration.headers['Set-Cookie'].split(';')[0];
  const fixture = await openStore(process.env.RIWI_DB_PATH);
  await fixture.db.execute("UPDATE logins SET account='owner'");
  await fixture.db.execute("UPDATE accounts SET id='owner' WHERE document=?", [ownerDetails.document]);
  fixture.close();
  assert.equal((await call('/api/chat', { id: 1, message: 'Hola' }, { auth: false })).status, 401);
  assert.equal((await call('/api/ticks', { id: 1, finish: true }, { origin: 'https://example.org' })).status, 403);
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.value, /Hoy \/ Checklist/);
  assert.equal(page.headers['Strict-Transport-Security'], 'max-age=31536000');
  assert.match(page.headers['Content-Security-Policy'], /frame-src https:\/\/teamlead\.up\.railway\.app;/);
  assert.equal((await call('/api/cron')).status, 401);
  assert.equal((await call('/api/state', undefined, { auth: false, bearer: process.env.CRON_SECRET })).status, 401);
  const tablero = (await import('./api/tablero.js')).default;
  assert.equal((await call('/api/tablero?path=/', undefined, { handler: tablero })).status, 200);
  assert.equal((await call('/api/tablero?path=/api/state', undefined, { handler: tablero, auth: false })).status, 401);
  assert.equal((await call('/api/tablero?path=/health', undefined, { handler: tablero })).status, 200);
  const cron = (await import('./api/cron.js')).default;
  assert.equal((await call('/api/cron', undefined, { handler: cron, bearer: process.env.CRON_SECRET })).status, 200);
});

test('cada cédula conserva sus propios cambios, sesión e historial de guía', async () => {
  const details = { document: '1000000002', password: 'other-fixture-password' };
  const registration = await call('/api/auth/register', details, { auth: false });
  assert.equal(registration.status, 200);
  const cookie = registration.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call('/api/auth/register', details, { auth: false })).status, 409);
  assert.equal((await call('/api/auth/login', { ...details, password: 'incorrecta' }, { auth: false })).status, 401);
  const permissions = (await call('/api/state', undefined, { cookie })).json;
  assert.equal(permissions.canEdit, false);
  assert.equal(permissions.checked.length, 0);
  assert.equal((await call('/api/session', {}, { cookie })).status, 403);
  assert.equal((await call('/api/ticks', { id: 1, changes: { '2-0': true } }, { cookie })).json.checked.length, 1);
  assert.equal((await call('/api/chat', { id: 1, step: '2-0', guide: true }, { cookie })).status, 200);
  assert.equal((await call('/api/state')).json.checked.length, 0);
  assert.deepEqual((await call('/api/chat/1/2-0')).json, []);
  const login = await call('/api/auth/login', details, { auth: false });
  assert.equal(login.status, 200);
  const otherDevice = login.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call('/api/state', undefined, { cookie: otherDevice })).json.checked.length, 1);
  assert.equal((await call('/api/chat/1/2-0', undefined, { cookie: otherDevice })).json.length, 2);
  assert.equal((await call('/api/auth/logout', {}, { cookie })).status, 200);
  assert.equal((await call('/api/state', undefined, { cookie })).status, 401);
  assert.equal((await call('/api/state', undefined, { cookie: otherDevice })).status, 200);
});

test('avance inicial, minirreto, completar y reabrir el día, guía e historial persistente', async () => {
  let result = (await call('/api/state')).json;
  assert.deepEqual(result.resume, { id: 1, step: '2-0' });
  assert.equal(result.checked.length, 0);
  const focus = await call('/api/focus', { id: 1, step: '2-0' });
  assert.deepEqual(focus.json.history, []);
  const guided = await call('/api/chat', { id: 1, step: '2-0', guide: true });
  assert.equal(guided.status, 200);
  assert.match(guided.json[1].content, /totalVendidoM.*[\s\S]*reduce[\s\S]*Cómo comprobarlo/);
  assert.deepEqual((await call('/api/chat/1/2-0')).json, guided.json);
  assert.deepEqual((await call('/api/chat/1/2-1')).json, []);
  assert.equal((await call('/api/chat', { id: 1, message: 'Hola' })).status, 503);

  const partial = await call('/api/ticks', { id: 1, changes: { '2-0': true } });
  assert.deepEqual(partial.json.resume, { id: 1, step: '2-1' });
  const finish = await call('/api/ticks', { id: 1, finish: true });
  assert.equal(finish.status, 200);
  assert.equal(finish.json.checked.length, 28);
  assert.equal(finish.json.next, 2);
  assert.deepEqual(finish.json.resume, { id: 2, step: null });
  assert.equal(finish.json.lessons.find(day => day.id === 2).quests.length, 0);
  assert.equal(finish.json.history[0].lesson, 1);

  await call('/api/ticks', { id: 1, changes: { '2-0': false } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://moodle.riwi.io/webservice/rest/server.php');
    assert.equal(options.body.get('wsfunction'), 'core_webservice_get_site_info');
    return Response.json({ errorcode: 'invalidtoken' });
  };
  try {
    assert.equal((await call('/api/moodle', { action: 'probe' })).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  result = (await call('/api/state')).json;
  assert.equal(result.checked.length, 27);
  assert.equal(result.history.length, 1);
  assert.equal(result.source.status, 'expired');
  assert.equal(result.links.login, 'https://moodle.riwi.io/login/index.php');
  assert.deepEqual(result.chatFocus, { id: 1, step: '2-0' });
  const reread = await openStore(process.env.RIWI_DB_PATH);
  assert.equal((await reread.snapshot()).checked.length, 27);
  assert.equal((await reread.snapshot()).history[0].lesson, 1);
  assert.deepEqual((await reread.chatHistory(1, '2-0')).map(row => ({ ...row })), guided.json);
  reread.close();

  const form = {
    title: 'Complejidad', summary: 'Medir operaciones.', technology: 'JavaScript y Node.js',
    url: result.lessons[1].url, quests: [['Medición', 'Medir la suma', ['Cuenta las operaciones.'], {
      requirements: 'Node.js', criteria: 'Contrasta dos tamaños', deliverable: 'Tabla',
    }]],
  };
  for (const [id, next] of [[2, 3], [3, 4]]) {
    assert.equal((await call('/api/import', { id, ...form })).status, 200);
    assert.equal((await call('/api/ticks', { id, finish: true })).json.next, next);
  }
  assert.equal((await call('/api/import', { id: 1, ...form })).status, 409);
  assert.equal((await call('/api/import', { module: 'ia', week: 1, day: 1, ...form })).status, 200);
  assert.equal((await call('/api/import', { ...form, url: result.links.courses, module: 'ingles', week: 1, day: 1 })).status, 200);
});

test('fechas enlazadas, correcciones y aviso único a las 5:00 en Bogotá', async () => {
  const s = await openStore(join(directory, 'schedule.sqlite'));
  const source = 'https://moodle.riwi.io/my/';
  await s.saveSession({ lesson: 2, date: '2026-11-21', label: '', hours: '', source });
  const entry = (await s.snapshot()).sessions.find(row => row.lesson === 2);
  assert.equal(entry.date, '2026-11-21');
  await s.saveSession({ id: entry.id, lesson: 2, date: '2026-11-22', label: '', hours: '', source });
  await s.recordMoodle('expired');
  assert.equal(await s.makeNotice(new Date('2026-11-22T09:59:59Z')), false);
  assert.equal(await s.makeNotice(new Date('2026-11-22T10:00:00Z')), true);
  assert.equal(await s.makeNotice(new Date('2026-11-22T10:01:00Z')), false);
  const record = (await s.snapshot()).notices[0];
  assert.equal(record.date, '2026-11-22');
  assert.equal(record.scheduled[0].lesson, 2);
  assert.deepEqual(record.cursor, { id: 1, step: '2-0' });
  assert.equal(record.source.status, 'expired');
  assert.deepEqual(record.lessons.map(day => day.id), [2, 1]);
  await s.removeSession(entry.id);
  assert.equal((await s.snapshot()).notices[0].scheduled[0].lesson, 2);
  s.close();
  assert.equal((await call('/api/session', { lesson: 2, date: '2026-02-30', label: '', hours: '', source })).status, 400);
  assert.equal((await call('/api/session', { lesson: 2, date: '2026-11-23', label: '', hours: '', source })).status, 200);
  const otherClient = await openStore(process.env.RIWI_DB_PATH);
  try {
    await otherClient.makeNotice(new Date('2026-11-23T10:00:00Z'));
    const state = (await call('/api/state')).json;
    const notice = state.notices.find(item => item.date === '2026-11-23');
    assert.equal(state.sessions.find(item => item.date === '2026-11-23').lesson, 2);
    assert.equal(notice.scheduled[0].lesson, 2);
    assert.equal(notice.lessons.find(day => day.id === 2).title, 'Complejidad');
    assert.equal(state.sessions.find(row => row.label === 'Desarrollo').module, 'algoritmia');
    for (const [label, module] of [['Inglés', 'ingles'], ['HSE', 'hse']]) {
      const result = await call('/api/session', { date: '2026-11-24', label, hours: '', source });
      assert.equal(result.json.sessions.find(row => row.label === label).module, module);
      assert.equal(result.json.modules.find(row => row.id === module).url, 'https://moodle.riwi.io/my/courses.php');
    }
  } finally {
    otherClient.close();
  }
});

test('el chat usa la credencial solo con el proveedor y conserva el hilo sin guardarla', async () => {
  const credential = 'test-credential-riwi-only';
  const message = 'Explícame el enfoque';
  const originalFetch = globalThis.fetch;
  const vendors = [
    ['groq', 'https://api.groq.com/openai/v1/chat/completions', { choices: [{ message: { content: credential } }] }],
    ['openai', 'https://api.openai.com/v1/responses', { output: [{ content: [{ type: 'output_text', text: credential }] }] }],
    ['claude', 'https://api.anthropic.com/v1/messages', { content: [{ type: 'text', text: credential }] }],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/models/fixture:generateContent', { candidates: [{ content: { parts: [{ text: credential }] } }] }],
    ['google-cloud', 'https://aiplatform.googleapis.com/v1/projects/fixture-project/locations/global/publishers/google/models/fixture:generateContent', { candidates: [{ content: { parts: [{ text: credential }] } }] }],
  ];
  for (const [provider, endpoint, response] of vendors) {
    const connection = { provider, credential, model: provider === 'groq' ? 'openai/gpt-oss-20b' : 'fixture', project: 'fixture-project' };
    assert.equal((await call('/api/chat', { id: 1, message, connection })).status, 400);
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json(response);
    };
    try {
      const result = await call('/api/chat', { id: 1, step: '2-2', message: `${message} ${credential}`,
        connection: { ...connection, allowCharges: true } });
      assert.equal(result.status, 200);
      assert.match(result.json.at(-1).content, /Respuesta de IA/);
      assert.ok(!result.value.includes(credential));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, endpoint);
      assert.ok(!calls[0].options.body.includes(credential));
      assert.ok(calls[0].options.body.includes('JavaScript y Node.js'));
      assert.equal(provider === 'gemini' ? calls[0].options.headers['x-goog-api-key'] : calls[0].options.headers.Authorization,
        provider === 'gemini' ? credential : `Bearer ${credential}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  assert.ok(!(await call('/api/chat/1/2-2')).value.includes(credential));
  const local = await call('/api/chat', { id: 1, step: '2-3', message, localAnswer: 'Respuesta del modelo local.' });
  assert.match(local.json.at(-1).content, /Respuesta del modelo local/);
  assert.match((await call('/api/chat', { id: 1, step: '2-4', guide: true, basic: true })).json.at(-1).content, /^Guía del tablero/);
});

test('Ollama solicita una respuesta directa y usa un límite distinto para las guías', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3.5:4b' }] });
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.signal, undefined);
    requests.push(JSON.parse(options.body));
    return Response.json({ message: { content: '¡Hola!' } });
  };
  try {
    const messages = [{ role: 'user', content: 'Hola' }];
    assert.equal(await localAnswer('qwen3.5:4b', messages, 'Tutor'), '¡Hola!');
    assert.equal(await localAnswer('qwen3.5:4b', messages, 'Tutor', true), '¡Hola!');
    assert.deepEqual(requests.map(request => [request.think, request.options.num_predict]), [[false, 320], [false, 600]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('elimina un hilo y bloquea respuestas tardías de la misma conversación', async () => {
  const selection = { id: 1, step: '2-6' };
  await call('/api/chat', { ...selection, message: 'Hola', localAnswer: 'Hola', revision: 0 });
  const focus = await call('/api/focus', selection);
  assert.equal(focus.json.history.length, 2);
  assert.equal((await call('/api/chat/delete', selection, { auth: false })).status, 401);
  const deletion = await call('/api/chat/delete', selection);
  assert.equal(deletion.json.revision, focus.json.revision + 1);
  assert.deepEqual((await call('/api/chat/1/2-6')).json, []);
  assert.equal((await call('/api/chat', { ...selection, message: 'Hola', localAnswer: 'Tarde', revision: focus.json.revision })).status, 409);
  assert.ok((await call('/api/chat/1/2-3')).json.length);
  assert.equal((await call('/api/chat', { ...selection, message: 'Nuevo hilo', localAnswer: 'Hola', revision: deletion.json.revision })).status, 200);
});

test('Google intercambia el código con PKCE y devuelve solo el acceso temporal', async () => {
  const data = { code: 'fixture-code', verifier: 'A'.repeat(43) };
  assert.equal((await call('/api/google/token', data, { auth: false })).status, 401);
  assert.equal((await call('/api/google/token', { ...data, verifier: 'incorrecto' })).status, 400);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('code_verifier'), data.verifier);
    assert.equal(options.body.get('redirect_uri'), 'https://tablero.example/google-callback');
    return Response.json({ access_token: 'temporary-fixture', expires_in: 3600, refresh_token: 'discard',
      scope: 'https://www.googleapis.com/auth/cloud-platform' });
  };
  try {
    const exchange = await call('/api/google/token', data);
    assert.deepEqual(exchange.json, { accessToken: 'temporary-fixture', seconds: 3600 });
    assert.equal(exchange.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reutiliza la guía de IA guardada y solo consulta el modelo al ampliar la explicación', async () => {
  const guide = { id: 1, step: '2-5', guide: true };
  const connection = { provider: 'openai', model: 'fixture', credential: 'test-guide-key', allowCharges: true };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ output: [{ content: [{ type: 'output_text', text: `Explicación ${calls}` }] }] });
  };
  try {
    const basic = await call('/api/chat', { ...guide, basic: true });
    assert.equal(basic.json.length, 2);
    assert.equal((await call('/api/chat', { ...guide, lookup: true })).json, null);
    const first = await call('/api/chat', { ...guide, connection });
    assert.equal(first.json.length, 4);
    assert.equal(calls, 1);
    assert.deepEqual((await call('/api/chat', { ...guide, lookup: true })).json, first.json);
    assert.deepEqual((await call('/api/chat', { ...guide, connection })).json, first.json);
    assert.deepEqual((await call('/api/chat', { ...guide, basic: true })).json, first.json);
    assert.equal(calls, 1);
    const followUp = await call('/api/chat', { id: guide.id, step: guide.step, message: 'Dame otro ejemplo', connection });
    assert.equal(followUp.json.length, 6);
    assert.match(followUp.json.at(-1).content, /Explicación 2/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migración de una base Beta con fichas y conversaciones previas', async () => {
  const file = join(directory, 'beta.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE lessons(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE ticks(lesson INTEGER NOT NULL, step TEXT NOT NULL, PRIMARY KEY(lesson,step));
    CREATE TABLE inbox(date TEXT NOT NULL, lesson INTEGER NOT NULL, PRIMARY KEY(date,lesson));
    CREATE TABLE chat(id INTEGER PRIMARY KEY, lesson INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
    INSERT INTO ticks VALUES(1,'0-0');
    INSERT INTO inbox VALUES('2026-11-12',2);
    INSERT INTO chat VALUES(1,1,'assistant','Guía conservada');
  `);
  old.close();
  const current = await openStore(file);
  try {
    const snapshot = await current.snapshot();
    assert.deepEqual(snapshot.resume, { id: 1, step: '0-1' });
    assert.deepEqual(snapshot.legacyNotices.map(row => ({ ...row })), [{ date: '2026-11-12', lesson: 2 }]);
    assert.equal((await current.chatHistory(1, ''))[0].content, 'Guía conservada');
  } finally {
    current.close();
  }
});

test('el adaptador remoto aplica las mismas reglas de avance y agenda', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const execute = async ({ sql, args }) => {
    const statement = sqlite.prepare(sql);
    if (/^\s*SELECT\b/i.test(sql)) return { rows: statement.all(...args) };
    const result = statement.run(...args);
    return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
  };
  const client = {
    execute,
    executeMultiple: async sql => sqlite.exec(sql),
    transaction: async mode => {
      assert.equal(mode, 'write');
      sqlite.exec('BEGIN IMMEDIATE');
      return { execute, commit: async () => sqlite.exec('COMMIT'), rollback: async () => sqlite.exec('ROLLBACK'), close() {} };
    },
    close: () => sqlite.close(),
  };
  const store = await openStore(null, remoteDatabase(client));
  try {
    assert.deepEqual((await store.snapshot()).resume, { id: 1, step: '2-0' });
    assert.equal((await store.applyTicks(1, {}, true)).next, 2);
    await store.saveSession({
      lesson: null, module: 'hse', date: '2026-11-24', label: 'Habilidades', hours: '', source: 'https://moodle.riwi.io/my/',
    });
    const state = await store.snapshot();
    assert.equal(state.checked.length, 28);
    assert.equal(state.sessions.find(row => row.date === '2026-11-24').module, 'hse');
  } finally {
    store.close();
  }
});

test.after(async () => {
  await closeDatabase();
  for (const file of ['schedule.sqlite', 'beta.sqlite', 'handlers.sqlite']) rmSync(join(directory, file), { force: true });
});

