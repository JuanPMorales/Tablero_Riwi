import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
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
process.env.RIWI_TUTOR_SKILLS = 'Trazar los bucles con el tutor privado';
globalThis.fetch = async () => { throw new Error('Las pruebas solo admiten respuestas simuladas.'); };
const { handleRequest, closeDatabase, writeOriginAllowed } = await import('./server.mjs');
const ownerDetails = { document: '1000000001', password: 'Owner-fixture-42', confirmation: 'Owner-fixture-42', fullName: 'Persona Titular', email: 'titular@example.test', phone: '3000000000', clan: 'Ritchie' };
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
  for (const path of ['/ui.js', '/chat-blocks.js', '/health', '/api/state', '/api/chat/1', '/api/chat/1/2-0']) {
    const unauthorized = await call(path, undefined, { auth: false });
    assert.equal(unauthorized.status, 401, path);
  }
  const registration = await call('/api/auth/register', ownerDetails);
  assert.equal(registration.status, 200);
  assert.match(registration.headers['Set-Cookie'], /^__Host-riwi_session=.*; HttpOnly; SameSite=Lax; .*; Secure$/);
  ownerCookie = registration.headers['Set-Cookie'].split(';')[0];
  const fixture = await openStore(process.env.RIWI_DB_PATH);
  await fixture.db.execute("UPDATE logins SET account='owner'");
  await fixture.db.execute("UPDATE account_profiles SET account='owner'");
  await fixture.db.execute("UPDATE accounts SET id='owner' WHERE document=?", [ownerDetails.document]);
  await fixture.db.execute("INSERT INTO settings VALUES ('content-owner-account','owner')");
  fixture.close();
  assert.equal((await call('/api/chat', { id: 1, message: 'Hola' }, { auth: false })).status, 401);
  assert.equal((await call('/api/ticks', { id: 1, finish: true }, { origin: 'https://example.org' })).status, 403);
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.value, /Hoy \/ Checklist/);
  assert.equal(page.headers['Strict-Transport-Security'], 'max-age=31536000');
  assert.match(page.headers['Content-Security-Policy'], /frame-src 'self' https:\/\/teamlead\.up\.railway\.app;/);
  const runner = await call('/chat-runner.html', undefined, { auth: false });
  assert.equal(runner.status, 200);
  assert.match(runner.headers['Content-Security-Policy'], /connect-src 'none';.*sandbox allow-scripts$/);
  assert.match(runner.headers['Content-Security-Policy'], /script-src 'sha256-[^']+';/);
  const python = await call('/chat-python-runner.html', undefined, { auth: false });
  assert.equal(python.status, 200);
  assert.match(python.headers['Content-Security-Policy'], /'unsafe-eval'; worker-src blob:; connect-src 'none'/);
  const preview = await call('/chat-preview.html', undefined, { auth: false });
  assert.equal(preview.status, 200);
  assert.match(preview.headers['Content-Security-Policy'], /connect-src 'none';.*sandbox allow-scripts$/);
  for (const path of ['/chat-blocks.js', '/chat-markdown.js', '/chat-highlight.js']) {
    assert.equal((await call(path)).headers['Content-Type'], 'application/javascript; charset=utf-8');
  }
  assert.equal((await call('/api/cron')).status, 401);
  assert.equal((await call('/api/state', undefined, { auth: false, bearer: process.env.CRON_SECRET })).status, 401);
  const tablero = (await import('./api/tablero.js')).default;
  assert.equal((await call('/api/tablero?path=/', undefined, { handler: tablero })).status, 200);
  assert.equal((await call('/api/tablero?path=/api/state', undefined, { handler: tablero, auth: false })).status, 401);
  assert.equal((await call('/api/tablero?path=/health', undefined, { handler: tablero })).status, 200);
  const cron = (await import('./api/cron.js')).default;
  assert.equal((await call('/api/cron', undefined, { handler: cron, bearer: process.env.CRON_SECRET })).status, 200);
});

test('el mensaje conserva el documento Markdown y resalta bloques sin interpretar HTML incrustado', () => {
  const browser = {};
  for (const path of ['./node_modules/markdown-it/dist/browser/markdown-it.umd.min.js',
    './node_modules/@highlightjs/cdn-assets/highlight.min.js', './chat-blocks.js']) {
    runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), browser);
  }
  const { describe, highlight, markdown, renderDocument, wrap } = browser.RiwiChatBlocks;
  const tick = String.fromCharCode(96);
  const example = [
    '# Café Origen – Análisis de ventas', '', '## Descripción', 'Se usa **Node.js LTS** y ' + tick + 'require' + tick,
    '', '## Uso', '1. Ejecuta el análisis:', '', tick.repeat(3) + 'bash', 'node src/analitica.js',
  ].join('\n');
  const message = describe(example);
  assert.equal(message.kind.id, 'markdown');
  assert.equal(message.standalone, false);
  assert.equal(message.value, example);
  const rendered = markdown.render(message.value);
  assert.match(rendered, /<h1>Café Origen – Análisis de ventas<\/h1>/);
  assert.match(rendered, /<strong>Node.js LTS<\/strong>.*<code>require<\/code>/);
  assert.match(rendered, /<ol>[\s\S]*<pre class="chat-code">[\s\S]*node src\/analitica\.js/);
  const attachment = describe('Archivo: café.md\n\n' + wrap(example, 'café.md'));
  assert.equal(attachment.filename, 'café.md');
  assert.equal(attachment.value, example);
  assert.equal(attachment.standalone, true);
  const answer = [
    '# Objetivo del paso', '', '| Archivo | Contenido |', '|---|---|', '| café.md | Descripción<br>Uso |', '',
    tick.repeat(3) + 'js', 'module.exports = [1, 2];', tick.repeat(3), '',
    'Abre café.md y escribe ' + tick + 'require' + tick + ' como código en línea.', '',
    tick.repeat(3) + 'bash', 'node src/analitica.js', tick.repeat(3),
  ].join('\n');
  const { html, snippets } = renderDocument(answer);
  assert.match(html, /<h1>Objetivo del paso<\/h1>[\s\S]*<table>[\s\S]*Descripción<br>\nUso/);
  assert.match(html, /data-chat-snippet="0"[\s\S]*<code>require<\/code>[\s\S]*data-chat-snippet="1"/);
  assert.equal(snippets.length, 2);
  assert.equal(snippets[0].value, 'module.exports = [1, 2];');
  assert.equal(snippets[1].kind.id, 'bash');
  assert.equal(renderDocument('Texto con ' + tick + 'código en línea' + tick).snippets.length, 0);
  assert.equal(describe('Hola, esta es una explicación.').standalone, false);
  assert.equal(describe('print("Café")').kind.id, 'python');
  assert.equal(describe('const total = 6;').kind.id, 'javascript');
  assert.equal(describe('<h1>Café</h1>').kind.id, 'html');
  assert.match(highlight('print("Café")', 'python'), /hljs-string/);
  assert.doesNotMatch(markdown.render('[enlace](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![remota](https://example.org/)'),
    /href="javascript:|<script>|<img\b/);
});

test('los entornos de prueba devuelven la salida de JavaScript y Python', async () => {
  async function execute(path, code) {
    const { value: html } = await call(path, undefined, { auth: false });
    const runtime = html.match(/<textarea id="python-runtime" hidden>([^<]*)<\/textarea>/)[1];
    const script = html.split('<script>')[1].split('</script>')[0];
    return new Promise(resolve => {
      let onRequest;
      const parent = { postMessage: resolve };
      const frame = {
        parent, URL, Blob, setTimeout, clearTimeout, atob, TextDecoder, Uint8Array,
        document: { getElementById: () => ({ value: runtime }) },
        addEventListener: (_, callback) => { onRequest = callback; },
        Worker: class {
          constructor(url) { void this.start(url); }
          async start(url) {
            const source = await resolveObjectURL(url).text();
            const worker = {
              console: {}, setTimeout, clearTimeout, addEventListener() {}, importScripts() {},
              postMessage: data => this.onmessage({ data }),
            };
            worker.self = worker;
            try { runInNewContext(source, worker, { timeout: 1000 }); }
            catch (error) { this.onerror({ message: String(error), preventDefault() {} }); }
          }
          terminate() {}
        },
      };
      runInNewContext(script, frame);
      onRequest({ source: parent, origin: 'https://tablero.example', data: { code } });
    });
  }
  const js = await execute('/chat-runner.html', 'console.log(6 * 7)');
  assert.equal(js.lines.join().trim(), '42', js.error);
  const commonJS = await execute('/chat-runner.html', 'module.exports = [{ producto: "Café" }];');
  assert.equal(commonJS.lines.join().trim(), '[{"producto":"Café"}]', commonJS.error);
  const py = await execute('/chat-python-runner.html', 'print("Café", sum([6, 36]))');
  assert.equal(py.lines.join().trim(), 'Café 42', py.error);
  const error = await execute('/chat-python-runner.html', 'print(nombre_inexistente)');
  assert.match(error.error, /NameError/);
});

test('cada cédula conserva sus propios cambios, sesión e historial de guía', async () => {
  const details = { document: '1000000002', password: 'Other-fixture-42', confirmation: 'Other-fixture-42', fullName: 'Otra Persona', email: 'otra@example.test', phone: '3000000001', clan: 'Tesla' };
  const registration = await call('/api/auth/register', details, { auth: false });
  assert.equal(registration.status, 200);
  const cookie = registration.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call('/api/auth/register', details, { auth: false })).status, 409);
  assert.equal((await call('/api/auth/login', { ...details, password: 'incorrecta' }, { auth: false })).status, 401);
  const permissions = (await call('/api/state', undefined, { cookie })).json;
  assert.equal(permissions.canEdit, false);
  assert.equal((await call('/api/import', {}, { cookie })).status, 403);
  assert.equal(permissions.profile.fullName, details.fullName);
  assert.equal(permissions.checked.length, 0);
  assert.equal((await call('/api/session', {}, { cookie })).status, 403);
  assert.equal((await call('/api/ticks', { id: 1, changes: { '2-0': true } }, { cookie })).json.checked.length, 1);
  assert.equal((await call('/api/chat', { id: 1, step: '2-0', guide: true }, { cookie })).status, 200);
  assert.equal((await call('/api/state')).json.checked.length, 0);
  assert.deepEqual((await call('/api/chat/1/2-0')).json, []);
  const login = await call('/api/auth/login', details, { auth: false });
  assert.equal(login.status, 200);
  const otherDevice = login.headers['Set-Cookie'].split(';')[0];
  await call('/api/notifications', { paused: true }, { cookie: otherDevice });
  const relogin = await call('/api/auth/login', details, { auth: false });
  const freshCookie = relogin.headers['Set-Cookie'].split(';')[0];
  await call('/api/auth/logout', {}, { cookie: freshCookie });
  const newLogin = await call('/api/auth/login', details, { auth: false });
  const resumedCookie = newLogin.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call('/api/state', undefined, { cookie: resumedCookie })).json.notificationsPaused, true);
  assert.equal((await call('/api/state')).json.notificationsPaused, false);
  await call('/api/notifications', { paused: false }, { cookie: resumedCookie });
  assert.equal((await call('/api/state', undefined, { cookie: otherDevice })).json.checked.length, 1);
  assert.equal((await call('/api/chat/1/2-0', undefined, { cookie: otherDevice })).json.length, 2);
  assert.equal((await call('/api/history/note', { id: 1, note: ' Repasar reduce ' }, { cookie: otherDevice })).json.historyNotes[1], 'Repasar reduce');
  assert.equal((await call('/api/state')).json.historyNotes[1], undefined);
  assert.equal((await call('/api/state', undefined, { cookie: otherDevice })).json.historyNotes[1], 'Repasar reduce');
  assert.equal((await call('/api/history/note', { id: 1, note: '' }, { cookie: otherDevice })).json.historyNotes[1], undefined);
  assert.equal((await call('/api/chat/rename', { id: 1, step: '2-0', title: 'Privado' })).status, 404);
  assert.equal((await call('/api/chat/rename', { id: 1, step: '2-0', title: ' Repasar arreglos ' }, { cookie: otherDevice })).status, 200);
  assert.equal((await call('/api/chat/list', undefined, { cookie: otherDevice })).json[0].title, 'Repasar arreglos');
  assert.equal((await call('/api/focus', { id: 1, step: '2-0' }, { cookie: otherDevice })).json.title, 'Repasar arreglos');
  assert.equal((await call('/api/chat/1/2-0', undefined, { cookie: otherDevice })).json.length, 2);
  assert.equal((await call('/api/auth/logout', {}, { cookie })).status, 200);
  assert.equal((await call('/api/state', undefined, { cookie })).status, 401);
  assert.equal((await call('/api/state', undefined, { cookie: otherDevice })).status, 200);
});

test('avance inicial, minirreto, completar y reabrir el día, guía e historial persistente', async () => {
  let result = (await call('/api/state')).json;
  assert.deepEqual(result.resume, { id: 1, step: '0-0' });
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
  assert.deepEqual(partial.json.resume, { id: 1, step: '0-0' });
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

test('fechas enlazadas, correcciones y aviso único a las 5:00 en Bogotá', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2040-11-23T11:00:00Z').getTime() });
  const login = await call('/api/auth/login', ownerDetails, { auth: false });
  ownerCookie = login.headers['Set-Cookie'].split(';')[0];
  const s = await openStore(join(directory, 'schedule.sqlite'));
  const source = 'https://moodle.riwi.io/my/';
  await s.saveSession({ lesson: 2, date: '2040-11-21', label: '', hours: '', source });
  const entry = (await s.snapshot()).sessions.find(row => row.lesson === 2);
  assert.equal(entry.date, '2040-11-21');
  await s.saveSession({ id: entry.id, lesson: 2, date: '2040-11-22', label: '', hours: '', source });
  await s.recordMoodle('expired');
  assert.equal(await s.makeNotice(new Date('2040-11-22T09:59:59Z')), false);
  assert.equal(await s.makeNotice(new Date('2040-11-22T10:00:00Z')), true);
  assert.equal(await s.makeNotice(new Date('2040-11-22T10:01:00Z')), false);
  const record = (await s.snapshot(new Date('2040-11-22T10:01:00Z'))).notices[0];
  assert.equal(record.date, '2040-11-22');
  assert.equal(record.scheduled[0].lesson, 2);
  assert.deepEqual(record.cursor, { id: 1, step: '0-0' });
  assert.equal(record.source.status, 'expired');
  assert.deepEqual(record.lessons.map(day => day.id), [2, 1]);
  await s.removeSession(entry.id);
  assert.equal((await s.snapshot(new Date('2040-11-22T10:01:00Z'))).notices[0].scheduled[0].lesson, 2);
  s.close();
  assert.equal((await call('/api/session', { lesson: 2, date: '2026-02-30', label: '', hours: '', source })).status, 400);
  assert.equal((await call('/api/session', { lesson: 2, date: '2040-11-23', label: '', hours: '', source })).status, 200);
  const otherClient = await openStore(process.env.RIWI_DB_PATH);
  try {
    await otherClient.makeNotice(new Date('2040-11-23T10:00:00Z'));
    const state = (await call('/api/state')).json;
    const notice = state.notices.find(item => item.date === '2040-11-23');
    assert.equal(state.sessions.find(item => item.date === '2040-11-23').lesson, 2);
    assert.equal(notice.scheduled[0].lesson, 2);
    assert.equal(notice.lessons.find(day => day.id === 2).title, 'Complejidad');
    assert.equal(state.sessions.find(row => row.label === 'Desarrollo').module, 'algoritmia');
    for (const [label, module] of [['Inglés', 'ingles'], ['HSE', 'hse']]) {
      const result = await call('/api/session', { date: '2040-11-24', label, hours: '', source });
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
      if (provider === 'groq') {
        const sent = JSON.parse(JSON.parse(calls[0].options.body).messages[1].content);
        const day = (await call('/api/state')).json.lessons.find(item => item.id === 1);
        assert.deepEqual(sent.selected, { quest: 3, step: 3 });
        assert.equal(sent.quests.length, day.quests.length);
        for (const [index, quest] of sent.quests.entries()) {
          assert.equal(quest.context, day.quests[index][1]);
          assert.deepEqual(quest.steps, day.quests[index][2]);
        }
        assert.equal(sent.profile, undefined);
      }
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

test('varias conversaciones del mismo paso se aíslan y las instrucciones del tutor quedan en el servidor', async () => {
  const selection = { id: 1, step: '2-1' };
  const profile = { context: 'Nivel principiante', skills: 'Trazar los bucles', limits: 'Priorizar pistas' };
  assert.equal((await call('/api/chat/tutor', profile)).status, 404);
  assert.equal((await call('/api/chat/tutor')).status, 404);
  const first = await call('/api/chat/new', { ...selection, title: 'Bucles con ejemplos' });
  const second = await call('/api/chat/new', { ...selection, title: 'Pruebas de bucles' });
  assert.equal(first.status, 201);
  assert.notEqual(first.json.chat, second.json.chat);
  assert.equal((await call('/api/focus', first.json)).json.instructions, undefined);
  assert.equal((await call('/api/chat/rename', { ...first.json, title: 'Ejercicios de bucles' })).json.title, 'Ejercicios de bucles');
  assert.equal((await call('/api/focus', first.json)).json.title, 'Ejercicios de bucles');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(JSON.parse(options.body).messages[0].content, /Trazar los bucles con el tutor privado/);
    return Response.json({ choices: [{ message: { content: 'Empieza por una iteración.' } }] });
  };
  try {
    assert.equal((await call('/api/chat', { ...first.json, message: '¿Cómo empiezo?', connection: {
      provider: 'groq', model: 'openai/gpt-oss-20b', credential: 'test-fixture-key', allowCharges: true,
    } })).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal((await call('/api/focus', first.json)).json.history.length, 2);
  assert.deepEqual((await call('/api/focus', second.json)).json.history, []);
  assert.ok((await call('/api/chat/list')).json.some(item => item.chat === first.json.chat));
  await call('/api/chat/delete', first.json);
  assert.equal((await call('/api/focus', first.json)).status, 404);
  assert.equal((await call('/api/focus', second.json)).status, 200);
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
    assert.deepEqual(snapshot.legacyNotices, [], 'Los avisos antiguos vencieron; las conversaciones se conservan');
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
    assert.deepEqual((await store.snapshot()).resume, { id: 1, step: '0-0' });
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

test('pausar avisos se conserva por cuenta y evita avisos nuevos hasta reanudar', async () => {
  const store = await openStore(':memory:');
  const now = new Date('2026-11-21T12:00:00Z');
  try {
    await store.setNotificationsPaused(true);
    assert.equal(await store.makeNotice(now), false);
    assert.equal((await store.snapshot(now)).notificationsPaused, true);
    const student = store.forAccount('student-fixture');
    assert.equal((await student.snapshot(now)).notificationsPaused, false);
    assert.equal(await student.makeNotice(now), true);
    await student.setNotificationsPaused(true);
    await store.setNotificationsPaused(false);
    assert.equal(await store.makeNotice(now), true);
    assert.equal(await store.makeNotice(now), false);
    assert.equal((await student.snapshot(now)).notificationsPaused, true);
    await store.makeNotice(new Date('2026-11-22T12:00:00Z'));
    assert.equal(await student.makeNotice(new Date('2026-11-22T12:00:00Z')), false);
    assert.equal((await student.snapshot(now)).notices.length, 1);
    assert.equal((await store.snapshot(now)).notices.length, 2);
    assert.equal((await call('/api/notifications', { paused: 'sí' })).status, 400);
    assert.equal((await call('/api/notifications', { paused: true })).json.notificationsPaused, true);
    assert.equal((await call('/api/state')).json.notificationsPaused, true);
    assert.equal((await call('/api/notifications', { paused: false })).json.notificationsPaused, false);
    assert.equal((await call('/api/notifications', { paused: true }, { auth: false })).status, 401);
  } finally {
    store.close();
  }
});

test('reabrir un día o una semana fija el retorno y conserva el avance de otras semanas y cuentas', async () => {
  const store = await openStore(':memory:');
  try {
    const initial = await store.snapshot();
    const data = { title: 'Ficha de prueba', summary: 'Prueba de avance', technology: 'JavaScript',
      url: initial.lessons[0].url, consulted: '2026-11-21',
      quests: [['Reto', 'Contexto', ['Primer paso', 'Segundo paso']]] };
    for (const id of [2, 3, 4]) await store.saveLesson(id, { ...initial.lessons.find(day => day.id === id), ...data });
    for (const id of [1, 2, 3, 4]) await store.applyTicks(id, {}, true);
    const other = store.forAccount('other-fixture');
    await other.applyTicks(1, {}, true);
    await store.applyTicks(2, { '0-1': false }, false);
    assert.deepEqual((await store.snapshot()).resume, { id: 2, step: '0-1' });
    await store.applyTicks(3, { '0-0': true }, false);
    assert.equal((await store.snapshot()).resume.id, 2);
    await store.applyTicks(1, { '2-0': false }, false);
    assert.deepEqual((await store.snapshot()).resume, { id: 1, step: '2-0' });
    await store.applyTicks(2, {}, true);
    const result = await store.applyTicks(3, null, false, true);
    assert.equal(result.selected, 1);
    const state = await store.snapshot();
    assert.deepEqual(state.resume, { id: 1, step: '0-0' });
    assert.deepEqual([...new Set(state.checked.map(row => row.lesson))], [4]);
    assert.equal((await other.snapshot()).checked.length, 28);
    assert.equal(state.history.filter(row => [1, 2, 3].includes(row.lesson)).length, 3);
    assert.equal((await call('/api/week/reopen', { id: 999999 })).status, 400);
    assert.equal((await call('/api/week/reopen', { id: 1 }, { auth: false })).status, 401);
    const reopened = await call('/api/week/reopen', { id: 1 });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.json.resume.id, reopened.json.selected);
    assert.equal((await call('/api/state')).json.resume.id, reopened.json.selected);
  } finally {
    store.close();
  }
});

test('la pausa y el retorno sobreviven al reinicio sin afectar otros módulos ni cuentas', async () => {
  const path = join(directory, 'preferences.sqlite');
  let store = await openStore(path);
  try {
    const initial = await store.snapshot();
    const data = { module: 'ia', week: 2, day: 2, title: 'Ficha sintética', summary: 'Prueba',
      technology: 'JavaScript', url: initial.lessons[0].url,
      quests: [['Prueba', 'Contexto sintético', ['Paso uno', 'Paso dos']]] };
    const second = await store.saveLesson(null, data);
    const first = await store.saveLesson(null, { ...data, day: 1 });
    const otherModule = await store.saveLesson(null, { ...data, module: 'datos', day: 1 });
    const account = store.forAccount('persistent-fixture');
    for (const id of [first, second, otherModule]) await account.applyTicks(id, {}, true);
    await store.applyTicks(first, {}, true);
    const now = new Date('2026-11-21T12:00:00Z');
    await account.makeNotice(now);
    await account.setNotificationsPaused(true);
    await account.applyTicks(second, { '0-1': false }, false);
    store.close();
    store = await openStore(path);
    const reopened = store.forAccount('persistent-fixture');
    assert.deepEqual((await reopened.snapshot(new Date('2026-11-21T13:00:00Z'))).resume, { id: second, step: '0-1' });
    assert.equal((await reopened.snapshot(new Date('2026-11-21T13:00:00Z'))).notificationsPaused, true);
    assert.equal(await reopened.makeNotice(new Date('2026-11-22T12:00:00Z')), false);
    assert.equal((await reopened.snapshot(new Date('2026-11-21T13:00:00Z'))).notices.length, 1);
    await reopened.applyTicks(second, null, false, true);
    store.close();
    store = await openStore(path);
    const state = await store.forAccount('persistent-fixture').snapshot();
    assert.deepEqual(state.resume, { id: first, step: '0-0' });
    assert.deepEqual([...new Set(state.checked.map(row => row.lesson))], [otherModule]);
    assert.equal((await store.snapshot()).checked.filter(row => row.lesson === first).length, 2);
    await store.forAccount('persistent-fixture').setNotificationsPaused(false);
    assert.equal(await store.forAccount('persistent-fixture').makeNotice(new Date('2026-11-22T12:00:00Z')), true);
  } finally {
    store.close();
    rmSync(path, { force: true });
  }
});

test('la carga local revisada amplía instrucciones sin perder casillas ni conversaciones', async () => {
  const store = await openStore(':memory:');
  try {
    const original = await store.find(1);
    await store.applyTicks(1, { '2-0': true }, false);
    await store.saveChat(1, '2-0', 'Consulta previa', 'Respuesta guardada', 0);
    const before = await store.snapshot();
    const expanded = { ...original, quests: original.quests.map(q => [q[0], q[1], q[2].map(s => s + ' Detalle verificado.'), q[3]]) };
    assert.equal(await store.saveLesson(1, expanded), null);
    assert.equal(await store.saveLesson(1, expanded, { preserveStepPositions: true }), 1);
    assert.deepEqual((await store.snapshot()).checked, before.checked);
    assert.equal((await store.chatHistory(1, '2-0')).length, 2);
    const changed = { ...expanded, quests: expanded.quests.map((q,i) => i ? q : [q[0],q[1],q[2].slice(1),q[3]]) };
    assert.equal(await store.saveLesson(1, changed, { preserveStepPositions: true }), null);
  } finally { store.close(); }
});

test('API restringe cargas y valida horarios y eliminación de avisos', async () => {
  assert.equal((await call('/api/state')).json.canEdit, true);
  assert.equal((await call('/api/notifications', { days: [1, 3, 5], time: '18:45' })).status, 200);
  assert.deepEqual((await call('/api/state')).json.notificationSchedule, { days: [1, 3, 5], time: '18:45' });
  for (const invalid of [{ days: [7], time: '18:45' }, { days: [1, 1], time: '18:45' }, { days: [1], time: '25:00' }, { dismissDate: 'no-es-fecha' }]) {
    assert.equal((await call('/api/notifications', invalid)).status, 400);
  }
  assert.equal((await call('/api/notifications', { dismissDate: '2026-11-22' })).status, 200);
});

test('perfil privado valida cambios de nombre y conserva contacto por cuenta', async () => {
  assert.equal((await call('/api/auth/profile', undefined, { auth: false })).status, 401);
  const before = (await call('/api/auth/profile')).json;
  assert.equal(before.nameLocked, true);
  assert.equal(before.fullName, ownerDetails.fullName);
  assert.equal((await call('/api/auth/profile', { ...before, fullName: 'Nombre distinto' })).status, 409);
  assert.equal((await call('/api/auth/profile', { ...before, phone: '3000000099' })).status, 200);
  assert.equal((await call('/api/auth/profile')).json.phone, '3000000099');
});

test.after(async () => {
  await closeDatabase();
  for (const file of ['schedule.sqlite', 'beta.sqlite', 'handlers.sqlite']) rmSync(join(directory, file), { force: true });
});

