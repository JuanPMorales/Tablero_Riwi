import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MOODLE, COURSE, MY_COURSES, GENIALLY, MODULES, TRAYECTO, ZONE, agendaForClan, calendarSessionsForClan } from './catalog.mjs';
import { bogota, guidePrompt, keys, openStore } from './store.mjs';
import { localAnswer, offlineGuide } from './guide.mjs';
import { accountAuth, digest } from './auth.mjs';
import { chatTurns, cloudAnswer } from './providers.mjs';
import { lessonContext } from './chat-context.mjs';
import { tutorPolicy } from './tutor-policy.mjs';

const { RIWI_ORIGIN, RIWI_MOODLE_TOKEN, CRON_SECRET, RIWI_OWNER_ACCOUNT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const googleOAuth = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? GOOGLE_CLIENT_ID : null;
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
  ['/riwi-inter.woff2', ['riwi-inter.woff2', 'font/woff2']],
  ['/ui.js', ['ui.js', 'application/javascript']], ['/login', ['login.html', 'text/html']],
  ['/chat-blocks.js', ['chat-blocks.js', 'application/javascript']],
  ['/chat-context.mjs', ['chat-context.mjs', 'application/javascript']],
  ['/tutor-rules.mjs', ['tutor-rules.mjs', 'application/javascript']],
  ['/chat-markdown.js', ['node_modules/markdown-it/dist/browser/markdown-it.umd.min.js', 'application/javascript']],
  ['/chat-highlight.js', ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'application/javascript']],
  ['/login.js', ['login.js', 'application/javascript']],
  ['/google-callback', ['google-callback.html', 'text/html']],
  ['/google-callback.js', ['google-callback.js', 'application/javascript']],
].map(([path, [file, type]]) => [path, [readFileSync(new URL(file, import.meta.url)), type]]));
const iconAssets = new Set([
  'grid', 'grid-on', 'chat', 'chat-on', 'book', 'book-on',
  'calendar', 'calendar-on', 'history', 'history-on', 'help', 'bell',
  'menu', 'mobile-grid', 'mobile-chat', 'mobile-history',
].map(name => '/riwi-' + name + '.svg'));
for (const path of iconAssets) {
  assets.set(path, [readFileSync(new URL('.' + path, import.meta.url)), 'image/svg+xml']);
}
const runner = readFileSync(new URL('./chat-runner.html', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const htmlPreview = readFileSync(new URL('./chat-preview.html', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const python = [
  readFileSync(new URL('./node_modules/skulpt/dist/skulpt.min.js', import.meta.url), 'utf8'),
  readFileSync(new URL('./node_modules/skulpt/dist/skulpt-stdlib.js', import.meta.url), 'utf8'),
].join('\n;\n');
const pythonRunner = runner.replace('id="python-runtime" hidden>', 'id="python-runtime" hidden>' + Buffer.from(python).toString('base64'));
const frameAssets = new Map([
  ['/chat-runner.html', [runner, '', 'worker-src blob:']],
  ['/chat-python-runner.html', [pythonRunner, " 'unsafe-eval'", 'worker-src blob:']],
  ['/chat-preview.html', [htmlPreview, '', "style-src 'unsafe-inline'; img-src data:"]],
].map(([path, [document, scriptOptions, directives]]) => {
  const hash = createHash('sha256').update(document.split('<script>')[1].split('</script>')[0]).digest('base64');
  return [path, [document, `default-src 'none'; script-src 'sha256-${hash}'${scriptOptions}; ${directives}; connect-src 'none'; frame-ancestors 'self'; sandbox allow-scripts`]];
}));

function serveFrame(res, [document, policy]) {
  res.setHeader('Content-Security-Policy', policy);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(document);
}

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
      && (url.origin === MOODLE || (calendar && (value === GENIALLY
        || value === agendaForClan(url.searchParams.get('clan')))));
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
async function state(store, canEdit) {
  const snapshot = await store.snapshot();
  return { ...snapshot, sessions: calendarSessionsForClan(snapshot.sessions, snapshot.profile?.clan), zone: ZONE, canEdit,
    chatReady: Boolean(RIWI_OLLAMA_MODEL), googleOAuth, moodleProbe: Boolean(RIWI_MOODLE_TOKEN),
    links: { course: COURSE, courses: MY_COURSES, calendar: MOODLE + '/my/', login: MOODLE + '/login/index.php', genially: GENIALLY, agenda: agendaForClan(snapshot.profile?.clan) } };
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
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' http://127.0.0.1:*; frame-src 'self' https://teamlead.up.railway.app; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (production || onVercel) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const path = typeof pathname === 'string' ? pathname : new URL(req.url, origin).pathname;
  if (req.method === 'GET' && frameAssets.has(path)) return serveFrame(res, frameAssets.get(path));
  if (path === '/api/cron') {
    if (req.method !== 'GET' || !CRON_SECRET || CRON_SECRET.length < 16
      || !timingSafeEqual(digest(req.headers.authorization || ''), digest('Bearer ' + CRON_SECRET))) {
      throw fault(401, 'Acceso reservado al programador.');
    }
    return json(res, 200, { created: await generateNotice() });
  }
  if (req.method === 'GET' && (iconAssets.has(path) || ['/login', '/login.js', '/ui.css', '/riwi-inter.woff2', '/google-callback', '/google-callback.js'].includes(path))) return serveAsset(res, path);
  const accountEndpoint = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/logout';
  if (accountEndpoint && req.method !== 'POST') throw fault(405, 'Método no permitido.');
  if (req.method === 'POST' && !writeOriginAllowed(req.headers)) {
    throw fault(403, 'Origen no permitido. Abre el tablero directamente y vuelve a intentar.');
  }
  const database = await getStore();
  const auth = accountAuth(database.db, { secure: production || onVercel });
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
  const canEdit = account === ((await database.contentOwner()) || RIWI_OWNER_ACCOUNT_ID);
  const store = database.forAccount(account);
  if (path === '/api/auth/profile') {
    if (req.method === 'GET') return json(res, 200, await store.readProfile());
    if (req.method === 'POST') return json(res, 200, await store.saveProfile(await body(req)));
    throw fault(405, 'Método no permitido.');
  }
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/api/state') {
    if (onVercel && process.env.RIWI_SCHEDULER !== '0' && !await store.hasNotice(bogota().date)) {
      await store.makeNotice().catch(error => console.error('Aviso diario:', error.code || error.name));
    }
    return json(res, 200, await state(store, canEdit));
  }
  if (req.method === 'GET' && path === '/api/chat/list') return json(res, 200, await store.listChats());
  if (req.method === 'GET' && /^\/api\/chat\/\d+(\/[0-9]+-[0-9]+)?$/.test(path)) {
    const [, , , id, step = ''] = path.split('/');
    const lesson = await lessonFor(store, Number(id));
    if (step && !keys(lesson).includes(step)) throw fault(404, 'Paso no encontrado.');
    return json(res, 200, await store.chatHistory(lesson.id, step));
  }
  if (req.method !== 'POST') throw fault(404, 'Ruta no encontrada.');
  if (!canEdit && ['/api/import', '/api/session', '/api/moodle'].includes(path)) {
    throw fault(403, 'Solo el titular del tablero puede editar las fichas y el calendario compartidos.');
  }
  const p = await body(req);
  if (path === '/api/google/token') {
    if (!googleOAuth) throw fault(503, 'El inicio de sesión con Google aún no está configurado.');
    if (!text(p.code, 2048) || !/^[A-Za-z0-9_-]{43}$/.test(p.verifier || '')) throw fault(400, 'La autorización no es válida.');
    let result;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ code: p.code, code_verifier: p.verifier, client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: req.headers.origin + '/google-callback' }),
      });
      if (response.ok) result = await response.json();
    } catch {
      throw fault(502, 'No se pudo completar la conexión con Google. Vuelve a intentar.');
    }
    if (!result?.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0
      || !result.scope?.split(' ').includes('https://www.googleapis.com/auth/cloud-platform')) {
      throw fault(400, 'Google no concedió acceso a Cloud. Vuelve a conectar o revisa el dominio autorizado.');
    }
    return json(res, 200, { accessToken: result.access_token, seconds: result.expires_in });
  }
  if (path === '/api/ticks') {
    if (!integer(p.id)) throw fault(400, 'Día inválido.');
    const { next, invalid, selected } = await store.applyTicks(p.id, p.changes, p.finish === true);
    if (invalid) throw fault(400, 'Las casillas no corresponden a este día.');
    return json(res, 200, { ...await state(store, canEdit), next, ...(selected ? { selected } : {}) });
  }
  if (path === '/api/week/reopen') {
    if (!integer(p.id)) throw fault(400, 'Día inválido.');
    const { invalid, selected } = await store.applyTicks(p.id, null, false, true);
    if (invalid) throw fault(400, 'La semana no tiene pasos cargados.');
    return json(res, 200, { ...await state(store, canEdit), selected });
  }
  if (path === '/api/notifications') {
    if (p.dismissDate !== undefined) {
      if (!validDate(p.dismissDate)) throw fault(400, 'Fecha de aviso inválida.');
      await store.dismissNotice(p.dismissDate);
    } else if (p.days !== undefined || p.time !== undefined) {
      if (!Array.isArray(p.days) || p.days.length > 7 || new Set(p.days).size !== p.days.length
        || !p.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time || '')) throw fault(400, 'Selecciona días válidos y una hora de Colombia.');
      await store.setNotificationSchedule({ days: [...p.days].sort(), time: p.time });
    } else {
      if (typeof p.paused !== 'boolean') throw fault(400, 'Selecciona si quieres pausar los avisos.');
      await store.setNotificationsPaused(p.paused);
    }
    return json(res, 200, await state(store, canEdit));
  }
  if (path === '/api/history/note') {
    const day = await lessonFor(store, p.id);
    if (!text(p.note, 2000, true)) throw fault(400, 'La nota debe tener hasta 2000 caracteres.');
    await store.saveHistoryNote(day.id, p.note.trim());
    return json(res, 200, await state(store, canEdit));
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
    return json(res, 200, { ...await state(store, canEdit), selected: id });
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
    return json(res, 200, await state(store, canEdit));
  }
  if (path === '/api/moodle') {
    if (p.action === 'probe' && RIWI_MOODLE_TOKEN) await store.recordMoodle(await probeMoodle());
    else if (['expired', 'manual'].includes(p.action)) await store.recordMoodle(p.action);
    else throw fault(400, 'Selecciona un estado de Moodle válido.');
    return json(res, 200, await state(store, canEdit));
  }
  if (['/api/focus', '/api/chat', '/api/chat/delete', '/api/chat/new', '/api/chat/rename'].includes(path)) {
    const lesson = await lessonFor(store, p.id);
    const step = p.step ?? '';
    if (typeof step !== 'string' || (step && !keys(lesson).includes(step))) throw fault(404, 'Paso no encontrado.');
    if (path === '/api/chat/new') {
      if (!text(p.title, 100)) throw fault(400, 'Escribe un título para la conversación.');
      return json(res, 201, await store.createChat(lesson.id, step, p.title.trim()));
    }
    let chat;
    if (p.chat !== undefined) {
      if (typeof p.chat !== 'string' || !/^[0-9a-f-]{36}$/.test(p.chat)) throw fault(404, 'Conversación no encontrada.');
      chat = await store.findChat(p.chat);
      if (!chat || chat.id !== lesson.id || chat.step !== step) throw fault(404, 'Conversación no encontrada.');
    }
    const threadStep = p.chat ? `${step}~${p.chat}` : step;
    if (path === '/api/chat/rename') {
      if (!text(p.title, 100)) throw fault(400, 'Escribe un título para la conversación.');
      const title = p.title.trim();
      if (!await store.renameChat(lesson.id, step, p.chat, title)) throw fault(404, 'Conversación no encontrada.');
      return json(res, 200, { title });
    }
    if (path === '/api/focus') {
      await store.focus(lesson.id, step, p.chat);
      const revision = await store.chatRevision(lesson.id, threadStep);
      const title = chat?.title ?? await store.legacyChatTitle(lesson.id, step);
      return json(res, 200, { history: await store.chatHistory(lesson.id, threadStep), revision,
        ...(title ? { title } : {}) });
    }
    if (path === '/api/chat/delete') return json(res, 200, { revision: await store.deleteChat(lesson.id, threadStep, p.chat) });
    const revision = await store.chatRevision(lesson.id, threadStep);
    const deleted = () => fault(409, 'La conversación se eliminó o cambió. Vuelve a abrirla antes de enviar otra consulta.');
    if (p.revision !== undefined && p.revision !== revision) throw deleted();
    const guide = p.guide === true && step;
    const basic = p.basic === true || (!p.connection && p.localAnswer === undefined && !RIWI_OLLAMA_MODEL && p.lookup !== true);
    if (guide) {
      const history = await store.guideHistory(lesson.id, threadStep, basic);
      if (history || p.lookup === true) return json(res, 200, history);
    }
    if (!guide && !text(p.message, 4000)) throw fault(400, 'Escribe una pregunta.');
    if (!guide && !p.connection && !p.localAnswer && !RIWI_OLLAMA_MODEL) throw fault(503, 'Conecta un modelo para conversar.');
    const thread = account + '/' + lesson.id + '/' + threadStep;
    if (busy.has(thread) || (RIWI_OLLAMA_MODEL && busy.size)) throw fault(409, 'Ya hay una respuesta en curso.');
    busy.add(thread);
    let prompt = guide ? guidePrompt : p.message.trim();
    if (typeof p.connection?.credential === 'string' && p.connection.credential) {
      prompt = prompt.replaceAll(p.connection.credential, '[credencial omitida]');
    }
    try {
      let answer;
      if (p.localAnswer !== undefined) {
        if (p.connection || !text(p.localAnswer, 16000)) throw fault(400, 'La respuesta local no es válida.');
        answer = p.localAnswer;
      } else if (p.connection || (RIWI_OLLAMA_MODEL && !(guide && p.basic === true))) {
        const context = lessonContext(lesson, { track: TRAYECTO,
          module: MODULES.find(m => m.id === lesson.module).name, step,
          stepsDone: (await store.ticks(lesson.id)).size });
        const history = await store.chatHistory(lesson.id, threadStep);
        if (p.connection) {
          if (typeof p.connection !== 'object' || p.connection.allowCharges !== true) {
            throw fault(400, 'Confirma el uso de la cuota de tu proveedor antes de enviar la consulta.');
          }
          answer = await cloudAnswer(p.connection, chatTurns(context, history, prompt));
        } else {
          const controller = new AbortController();
          res.once?.('close', () => controller.abort());
          try {
            answer = await localAnswer(RIWI_OLLAMA_MODEL, chatTurns(context, history, prompt), tutorPolicy, Boolean(guide), controller.signal);
          } catch {
            if (controller.signal.aborted) return;
            if (!guide) throw fault(503, 'El modelo local no respondió. Revisa Ollama e inténtalo de nuevo.');
          }
        }
      }
      const usedBasic = !answer;
      answer = usedBasic ? 'Guía del tablero\n\n' + offlineGuide(lesson, step) : 'Respuesta de IA\n\n' + answer;
      const saved = guide ? await store.saveGuide(lesson.id, threadStep, usedBasic, answer, revision)
        : await store.saveChat(lesson.id, threadStep, prompt, answer, revision);
      if (!saved) throw deleted();
      return json(res, 200, saved);
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
