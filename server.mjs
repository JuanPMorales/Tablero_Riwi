import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MOODLE, COURSE, MY_COURSES, GENIALLY, AGENDA, MODULES, TRAYECTO, ZONE } from './catalog.mjs';
import { bogota, keys, openStore } from './store.mjs';
import { localAnswer, offlineGuide } from './guide.mjs';
import { accountAuth, digest } from './auth.mjs';

const { RIWI_PASSWORD, RIWI_ORIGIN, RIWI_MOODLE_TOKEN, CRON_SECRET } = process.env;
const onVercel = process.env.VERCEL === '1';
const RIWI_OLLAMA_MODEL = onVercel ? undefined : process.env.RIWI_OLLAMA_MODEL;
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 8765);
const origin = RIWI_ORIGIN || (onVercel ? 'https://localhost' : 'http://127.0.0.1:' + port);
if (new URL(origin).origin !== origin || ((production || onVercel) && !origin.startsWith('https://'))) {
  throw new Error('Configura RIWI_ORIGIN con el origen exacto. En producción debe usar HTTPS.');
}
if (RIWI_OLLAMA_MODEL && !/^[\w.-]+:[\w.-]+$/.test(RIWI_OLLAMA_MODEL)) throw new Error('Usa el nombre y etiqueta de un modelo local ya descargado.');
let storePromise;
function getStore() {
  storePromise ??= (async () => {
    if (!onVercel) return openStore(process.env.RIWI_DB_PATH || 'riwi.sqlite');
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = process.env;
    if (!TURSO_DATABASE_URL?.startsWith('libsql://') || !TURSO_AUTH_TOKEN) throw fault(503, 'Configura la base persistente de Turso.');
    const [{ createClient }, { remoteDatabase }] = await Promise.all([import('@libsql/client/web'), import('./database.mjs')]);
    const database = remoteDatabase(createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }));
    try {
      return await openStore(null, database);
    } catch (error) {
      database.close();
      throw error;
    }
  })().catch(error => { storePromise = undefined; throw error; });
  return storePromise;
}
export async function closeDatabase() {
  if (storePromise) (await storePromise).close();
}
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/ui.css', ['ui.css', 'text/css']],
  ['/ui.js', ['ui.js', 'application/javascript']], ['/login', ['login.html', 'text/html']],
  ['/login.js', ['login.js', 'application/javascript']],
].map(([path, [file, type]]) => [path, [readFileSync(new URL(file, import.meta.url)), type]]));

function serveAsset(res, path) {
  const [file, type] = assets.get(path);
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
  res.end(file);
}
export function writeOriginAllowed(headers, isVercel = onVercel) {
  // Vercel supplies the host used by the browser, including custom and preview domains.
  const host = headers.host;
  const expected = isVercel && typeof host === 'string' && /^[a-z0-9.-]+$/i.test(host)
    ? 'https://' + host.toLowerCase() : origin;
  return headers.origin === expected && /^application\/json(?:;|$)/i.test(headers['content-type'] || '');
}
const text = (value, max, optional = false) => typeof value === 'string' && value.length <= max && (optional || Boolean(value.trim()));
const integer = (value, max = 1000000) => Number.isSafeInteger(value) && value >= 1 && value <= max;
function official(value, calendar = false) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ![...url.searchParams.keys()].some(key => /token|sesskey|password|secret/i.test(key))
      && (url.origin === MOODLE || (calendar && (value === GENIALLY || value === AGENDA)));
  } catch {
    return false;
  }
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dt = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(+dt) && dt.toISOString().slice(0, 10) === value;
}
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
function fault(status, message) {
  return Object.assign(new Error(message), { status });
}
async function body(req) {
  if (req.body !== undefined) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw fault(400, 'El contenido debe ser un objeto JSON válido.');
    if (Buffer.byteLength(JSON.stringify(req.body)) > 256000) throw fault(413, 'La ficha supera el tamaño permitido.');
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256000) throw fault(413, 'La ficha supera el tamaño permitido.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw fault(400, 'El contenido debe ser un objeto JSON válido.');
  }
}
async function state(store, account) {
  return { ...await store.snapshot(), zone: ZONE, canEdit: account === 'owner',
    chatReady: Boolean(RIWI_OLLAMA_MODEL), moodleProbe: Boolean(RIWI_MOODLE_TOKEN),
    links: { course: COURSE, courses: MY_COURSES, calendar: MOODLE + '/my/', login: MOODLE + '/login/index.php', genially: GENIALLY, agenda: AGENDA } };
}
async function lessonFor(store, id) {
  const lesson = integer(id) && await store.find(id);
  if (!lesson) throw fault(404, 'Día no encontrado.');
  return lesson;
}
function validQuest(q) {
  return Array.isArray(q) && q.length === 4 && text(q[0], 240) && text(q[1], 3000)
    && Array.isArray(q[2]) && q[2].length > 0 && q[2].length <= 25 && q[2].every(step => text(step, 1700))
    && ['requirements', 'criteria', 'deliverable'].every(field => text(q[3]?.[field], 3000));
}
async function probeMoodle() {
  try {
    const response = await fetch(MOODLE + '/webservice/rest/server.php', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ wstoken: RIWI_MOODLE_TOKEN, wsfunction: 'core_webservice_get_site_info', moodlewsrestformat: 'json' }),
    });
    if (response.status === 401 || /\/login\//.test(response.headers.get('location') || '')) return 'expired';
    if (!response.ok) return 'unavailable';
    const result = await response.json();
    if (['invalidtoken', 'tokenexpired'].includes(result.errorcode)) return 'expired';
    return result.userid ? 'available' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
const busy = new Set();
async function request(req, res, pathname) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src https://teamlead.up.railway.app; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (production || onVercel) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const path = typeof pathname === 'string' ? pathname : new URL(req.url, origin).pathname;
  if (path === '/api/cron') {
    if (req.method !== 'GET' || !CRON_SECRET || CRON_SECRET.length < 16
      || !timingSafeEqual(digest(req.headers.authorization || ''), digest('Bearer ' + CRON_SECRET))) {
      throw fault(401, 'Acceso reservado al programador.');
    }
    return json(res, 200, { created: await generateNotice() });
  }
  if (req.method === 'GET' && ['/login', '/login.js', '/ui.css'].includes(path)) return serveAsset(res, path);
  const accountEndpoint = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/logout';
  if (accountEndpoint && req.method !== 'POST') throw fault(405, 'Método no permitido.');
  if (req.method === 'POST' && !writeOriginAllowed(req.headers)) {
    throw fault(403, 'Origen no permitido. Abre el tablero directamente y vuelve a intentar.');
  }
  const database = await getStore();
  const auth = accountAuth(database.db, { secure: production || onVercel,
    previousPassword: RIWI_PASSWORD?.length >= 16 ? RIWI_PASSWORD : undefined });
  if (accountEndpoint) {
    if (path === '/api/auth/logout') await auth.logout(req, res);
    else await auth.authenticate(req, res, await body(req), path.endsWith('/register'),
      (onVercel ? req.headers['x-forwarded-for'] : req.socket?.remoteAddress) || 'unknown');
    return json(res, 200, { ok: true });
  }
  const account = await auth.session(req);
  if (!account) {
    if (req.method === 'GET' && path === '/') {
      res.writeHead(303, { Location: '/login' });
      return res.end();
    }
    throw fault(401, 'Inicia sesión en el tablero.');
  }
  if (req.method === 'GET' && assets.has(path)) return serveAsset(res, path);
  const store = database.forAccount(account);
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/api/state') {
    if (onVercel && process.env.RIWI_SCHEDULER !== '0' && bogota().hour >= 5 && !await store.hasNotice(bogota().date)) {
      await store.makeNotice().catch(error => console.error('Aviso diario:', error.code || error.name));
    }
    return json(res, 200, await state(store, account));
  }
  if (req.method === 'GET' && /^\/api\/chat\/\d+(\/[0-9]+-[0-9]+)?$/.test(path)) {
    const [, , , id, step = ''] = path.split('/');
    const lesson = await lessonFor(store, Number(id));
    if (step && !keys(lesson).includes(step)) throw fault(404, 'Paso no encontrado.');
    return json(res, 200, await store.chatHistory(lesson.id, step));
  }
  if (req.method !== 'POST') throw fault(404, 'Ruta no encontrada.');
  if (account !== 'owner' && ['/api/import', '/api/session', '/api/moodle'].includes(path)) {
    throw fault(403, 'Solo el titular del tablero puede editar las fichas y el calendario compartidos.');
  }
  const p = await body(req);
  if (path === '/api/ticks') {
    if (!integer(p.id)) throw fault(400, 'Día inválido.');
    const { next, invalid } = await store.applyTicks(p.id, p.changes, p.finish === true);
    if (invalid) throw fault(400, 'Las casillas no corresponden a este día.');
    return json(res, 200, { ...await state(store, account), next });
  }
  if (path === '/api/import') {
    const previous = p.id ? await lessonFor(store, p.id) : null;
    const module = previous?.module || p.module;
    const week = previous?.week || p.week;
    const day = previous?.day || p.day;
    if (!MODULES.some(item => item.id === module) || !integer(week, 99) || !integer(day, 99)
      || !text(p.title, 240) || !text(p.summary, 2400) || !text(p.technology, 240)
      || !official(p.url) || !Array.isArray(p.quests) || !p.quests.length || p.quests.length > 15 || !p.quests.every(validQuest)) {
      throw fault(400, 'Completa los datos del día y de cada minirreto, con su enlace oficial de Moodle.');
    }
    const id = await store.saveLesson(previous?.id, { week, day, module, title: p.title.trim(), summary: p.summary.trim(),
      technology: p.technology.trim(), url: p.url, quests: p.quests, consulted: bogota().date });
    if (!id) throw fault(409, 'Ya existe esa ficha o el cambio alteraría la correspondencia con tu avance o chat.');
    await store.recordMoodle('manual');
    return json(res, 200, { ...await state(store, account), selected: id });
  }
  if (path === '/api/session') {
    if (p.id != null && !integer(p.id)) throw fault(400, 'Sesión inválida.');
    if (p.remove === true && p.id) {
      if (!(await store.removeSession(p.id)).changes) throw fault(404, 'Sesión no encontrada.');
    } else {
      if (p.lesson != null) await lessonFor(store, p.lesson);
      if (p.module && !MODULES.some(module => module.id === p.module)) throw fault(400, 'Módulo inválido.');
      if (!validDate(p.date) || !official(p.source, true) || !text(p.label, 180, Boolean(p.lesson)) || !text(p.hours, 100, true)) {
        throw fault(400, 'Incluye fecha, actividad y enlace oficial de la programación.');
      }
      if (!(await store.saveSession({ id: p.id, lesson: p.lesson ?? null, date: p.date, module: p.module,
        label: p.label.trim(), hours: p.hours.trim(), source: p.source }))) throw fault(409, 'Edita la sesión existente de ese día.');
    }
    return json(res, 200, await state(store, account));
  }
  if (path === '/api/moodle') {
    if (p.action === 'probe' && RIWI_MOODLE_TOKEN) await store.recordMoodle(await probeMoodle());
    else if (['expired', 'manual'].includes(p.action)) await store.recordMoodle(p.action);
    else throw fault(400, 'Selecciona un estado de Moodle válido.');
    return json(res, 200, await state(store, account));
  }
  if (path === '/api/focus' || path === '/api/chat') {
    const lesson = await lessonFor(store, p.id);
    const step = p.step ?? '';
    if (typeof step !== 'string' || (step && !keys(lesson).includes(step))) throw fault(404, 'Paso no encontrado.');
    if (path === '/api/focus') {
      await store.focus(lesson.id, step);
      return json(res, 200, { history: await store.chatHistory(lesson.id, step) });
    }
    const guide = p.guide === true && step;
    if (!guide && !text(p.message, 4000)) throw fault(400, 'Escribe una pregunta.');
    if (!guide && !RIWI_OLLAMA_MODEL) throw fault(503, 'Para conversar, abre ChatGPT e inicia sesión con tu propia cuenta.');
    const thread = account + '/' + lesson.id + '/' + step;
    if (busy.has(thread) || (RIWI_OLLAMA_MODEL && busy.size)) throw fault(409, 'Ya hay una respuesta en curso.');
    busy.add(thread);
    const prompt = guide ? 'Guíame en este paso con un ejemplo y una prueba.' : p.message.trim();
    try {
      let answer;
      if (RIWI_OLLAMA_MODEL) {
        const [i, j] = step.split('-').map(Number);
        const quest = step && lesson.quests[i];
        const { quests, ...day } = lesson;
        const context = { track: TRAYECTO, module: MODULES.find(m => m.id === lesson.module).name, day,
          quest: quest ? { number: i + 1, title: quest[0], context: quest[1], ...quest[3] } : quests.map(q => q[0]),
          step: quest ? { number: j + 1, instruction: quest[2][j] } : null, marks: [...await store.ticks(lesson.id)] };
        try {
          answer = await localAnswer(RIWI_OLLAMA_MODEL, context, await store.chatHistory(lesson.id, step), prompt);
        } catch {
          if (!guide) throw fault(503, 'El modelo local no respondió. Revisa Ollama e inténtalo de nuevo.');
        }
      }
      answer ??= offlineGuide(lesson, step);
      await store.saveChat(lesson.id, step, prompt, answer);
      return json(res, 200, await store.chatHistory(lesson.id, step));
    } finally {
      busy.delete(thread);
    }
  }
  throw fault(404, 'Ruta no encontrada.');
}
let checking = false;
async function generateNotice() {
  if (checking || process.env.RIWI_SCHEDULER === '0' || bogota().hour < 5) return false;
  checking = true;
  try {
    const store = await getStore();
    if (RIWI_MOODLE_TOKEN && !await store.hasNotice(bogota().date)) await store.recordMoodle(await probeMoodle());
    return await store.makeNotices();
  } finally {
    checking = false;
  }
}
function checkClock() {
  return generateNotice().catch(error => console.error('Aviso diario:', error.code || error.name));
}
export function handleRequest(req, res, pathname) {
  return request(req, res, pathname).catch(error => {
    if (!error.status) console.error(error.code || error.name);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación.' });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  createServer(handleRequest).listen(port, process.env.RIWI_BIND || '127.0.0.1', () => {
    console.log('Tablero Riwi en puerto ' + port);
    void checkClock();
  });
  setInterval(checkClock, 15000).unref();
}
