import { readFileSync } from 'node:fs';
import { AGENDA, MODULES, RITCHIE_AGENDA, TRAYECTO, VERIFIED, ZONE, agendaModule, seedLesson } from './catalog.mjs';
import { localDatabase } from './database.mjs';

const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export function bogota(now = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: Number(parts.hour) };
}
export const keys = lesson => lesson.quests.flatMap((quest, i) => quest[2].map((_, j) => i + '-' + j));

const schema = `
  CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ticks (lesson INTEGER NOT NULL, step TEXT NOT NULL, PRIMARY KEY(lesson,step));
  CREATE TABLE IF NOT EXISTS inbox (date TEXT NOT NULL, lesson INTEGER NOT NULL, PRIMARY KEY(date,lesson));
  CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, lesson INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS completions (lesson INTEGER PRIMARY KEY, completed TEXT);
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY, lesson INTEGER, date TEXT NOT NULL, label TEXT NOT NULL,
    hours TEXT NOT NULL, source TEXT NOT NULL, consulted TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sessions_lesson ON sessions(lesson) WHERE lesson IS NOT NULL;
  CREATE TABLE IF NOT EXISTS daily (date TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, lesson INTEGER NOT NULL, step TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_modules (session INTEGER PRIMARY KEY, module TEXT NOT NULL);
`;
const seed = JSON.parse(readFileSync(new URL('./lessons.json', import.meta.url), 'utf8'));
const moduleOrder = new Map(MODULES.map(({ id }, i) => [id, i]));
const fromRow = row => ({ ...JSON.parse(row.data), id: row.id });
const done = (lesson, marks) => {
  const steps = keys(lesson);
  return steps.length > 0 && steps.every(key => marks?.has(key));
};

export async function openStore(path, db = localDatabase(path)) {
  const { execute, transaction } = db;
  const all = async (sql, args) => (await execute(sql, args)).rows;
  const get = async (sql, args) => (await all(sql, args))[0];
  const saveSetting = (key, value) => execute('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
  const readSettings = async () => Object.fromEntries((await all('SELECT key,value FROM settings')).map(row => [row.key, row.value]));
  const lessons = async () => (await all('SELECT id,data FROM lessons')).map(fromRow)
    .sort((a, b) => (moduleOrder.get(a.module) ?? 99) - (moduleOrder.get(b.module) ?? 99) || a.week - b.week || a.day - b.day);
  const find = async id => {
    const row = await get('SELECT id,data FROM lessons WHERE id=?', [id]);
    return row && fromRow(row);
  };
  const readTicks = () => all('SELECT lesson,step FROM ticks');
  const ticks = async id => new Set((await all('SELECT step FROM ticks WHERE lesson=?', [id])).map(row => row.step));
  const update = lesson => {
    const { id, ...data } = lesson;
    return execute('UPDATE lessons SET data=? WHERE id=?', [JSON.stringify(data), id]);
  };
  const writeMarks = async (lesson, list, checked) => {
    if (!list.length) return;
    if (checked) {
      await execute('INSERT OR IGNORE INTO ticks VALUES ' + list.map(() => '(?,?)').join(','), list.flatMap(step => [lesson, step]));
    } else {
      await execute('DELETE FROM ticks WHERE lesson=? AND step IN (' + list.map(() => '?').join(',') + ')', [lesson, ...list]);
    }
  };
  function indexTicks(checked) {
    const marks = new Map();
    for (const row of checked) {
      if (!marks.has(row.lesson)) marks.set(row.lesson, new Set());
      marks.get(row.lesson).add(row.step);
    }
    return marks;
  }
  function resume(rows, marks, settings) {
    const active = Number(settings.active);
    const lesson = rows.find(day => day.id === active && !done(day, marks.get(day.id))) || rows.find(day => !done(day, marks.get(day.id)));
    if (!lesson) return null;
    const steps = keys(lesson);
    const start = lesson.id === active ? Math.max(0, steps.indexOf(settings.step)) : 0;
    const checked = marks.get(lesson.id);
    const step = [...steps.slice(start), ...steps.slice(0, start)].find(key => !checked?.has(key)) ?? null;
    return { id: lesson.id, step };
  }

  await db.schema(schema);
  if (!(await get("SELECT value FROM settings WHERE key='schema-v2'"))) await transaction(async () => {
    if (await get("SELECT value FROM settings WHERE key='schema-v2'")) return;
    const baseline = seed.flatMap((lesson, i) => [i + 1, JSON.stringify(seedLesson(lesson, i))]);
    await execute('INSERT OR IGNORE INTO lessons VALUES ' + seed.map(() => '(?,?)').join(','), baseline);
    const rows = await lessons();
    const checked = await readTicks();
    const marks = indexTicks(checked);
    for (const lesson of rows) {
      if (!lesson.module) {
        const legacy = seed[lesson.id - 1];
        const matches = legacy && JSON.stringify(lesson.quests) === JSON.stringify(legacy.quests);
        const enriched = matches ? seedLesson(lesson, lesson.id - 1) : { ...lesson, module: 'algoritmia' };
        await update(enriched);
        lesson.module = enriched.module;
      }
      if (done(lesson, marks.get(lesson.id))) await execute('INSERT OR IGNORE INTO completions VALUES (?,NULL)', [lesson.id]);
    }
    const hadProgress = checked.length
      || await get('SELECT 1 FROM inbox LIMIT 1') || await get('SELECT 1 FROM chat LIMIT 1')
      || rows.some(day => day.id > seed.length || (day.id > 1 && day.quests.length));
    const first = rows.find(day => !done(day, marks.get(day.id)));
    if (first) {
      await saveSetting('active', first.id);
      if (!hadProgress && first.id === 1) await saveSetting('step', '2-0');
    }
    await execute('INSERT INTO sessions(lesson,date,label,hours,source,consulted) VALUES '
      + RITCHIE_AGENDA.map(() => '(NULL,?,?,?,?,?)').join(','),
    RITCHIE_AGENDA.flatMap(([date, label, hours = '06:00–08:30']) => [date, label, hours, AGENDA, VERIFIED]));
    await saveSetting('schema-v2', 1);
  });

  function applyTicks(id, changes, finish) {
    return transaction(async () => {
      const rows = await lessons();
      const day = rows.find(row => row.id === id);
      if (!day) return { invalid: true };
      const steps = keys(day);
      if (finish && steps.length) changes = Object.fromEntries(steps.map(step => [step, true]));
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length
        || Object.entries(changes).some(([key, value]) => !steps.includes(key) || typeof value !== 'boolean')) return { invalid: true };
      const marks = indexTicks(await readTicks());
      const settings = await readSettings();
      const active = resume(rows, marks, settings);
      const checked = marks.get(id) || new Set();
      marks.set(id, checked);
      const wasComplete = done(day, checked);
      const add = [];
      const drop = [];
      for (const [step, value] of Object.entries(changes)) {
        if (value) { add.push(step); checked.add(step); }
        else { drop.push(step); checked.delete(step); }
      }
      await writeMarks(id, add, true);
      await writeMarks(id, drop, false);
      const isComplete = done(day, checked);
      let next = null;
      if (isComplete && !wasComplete) await execute('INSERT OR IGNORE INTO completions VALUES (?,?)', [id, new Date().toISOString()]);
      if (isComplete && (finish || active?.id === id)) {
        const index = rows.indexOf(day);
        next = [...rows.slice(index + 1), ...rows.slice(0, index)].find(row => !done(row, marks.get(row.id)))?.id ?? null;
        await saveSetting('active', next ?? '');
        await saveSetting('step', '');
      } else if (active?.id === id || !active) {
        settings.active = id;
        await saveSetting('active', id);
        await saveSetting('step', resume(rows, marks, settings)?.step ?? '');
      }
      return { next };
    });
  }
  function saveLesson(id, data) {
    return transaction(async () => {
      if (id) {
        const lesson = await find(id);
        if (!lesson) return null;
        const previous = lesson.quests;
        const sameSteps = previous.every((quest, i) => data.quests[i]?.[0] === quest[0]
          && quest[2].every((step, j) => step === data.quests[i][2][j]));
        // La Beta identifica las casillas y los hilos por posición.
        if (!sameSteps && await get(`SELECT 1 FROM ticks WHERE lesson=?
          UNION ALL SELECT 1 FROM completions WHERE lesson=?
          UNION ALL SELECT 1 FROM messages WHERE lesson=?
          UNION ALL SELECT 1 FROM chat WHERE lesson=? LIMIT 1`, [id, id, id, id])) return null;
        await update({ ...lesson, ...data });
        return id;
      }
      if ((await lessons()).some(day => day.module === data.module && day.week === data.week && day.day === data.day)) return null;
      return (await execute('INSERT INTO lessons(data) VALUES (?)', [JSON.stringify(data)])).id;
    });
  }
  const sessions = async () => (await all(`SELECT s.*, sm.module AS explicit_module, l.data AS lesson_data
    FROM sessions s LEFT JOIN session_modules sm ON s.id=sm.session
    LEFT JOIN lessons l ON l.id=s.lesson ORDER BY s.date,s.id`))
    .map(({ explicit_module, lesson_data, ...row }) => ({
      ...row, module: (lesson_data && JSON.parse(lesson_data).module) || explicit_module || agendaModule(row.label)?.id || null,
    }));
  function saveSession({ id, lesson, date, label, hours, source, module }) {
    return transaction(async () => {
      if (id && !(await get('SELECT id FROM sessions WHERE id=?', [id]))) return false;
      const duplicate = lesson && await get('SELECT id FROM sessions WHERE lesson=?', [lesson]);
      if (duplicate && duplicate.id !== id) return false;
      const args = [lesson, date, label, hours, source, bogota().date];
      if (id) await execute('UPDATE sessions SET lesson=?,date=?,label=?,hours=?,source=?,consulted=? WHERE id=?', [...args, id]);
      else id = (await execute('INSERT INTO sessions(lesson,date,label,hours,source,consulted) VALUES(?,?,?,?,?,?)', args)).id;
      if (module) await execute('INSERT INTO session_modules VALUES (?,?) ON CONFLICT(session) DO UPDATE SET module=excluded.module', [id, module]);
      else await execute('DELETE FROM session_modules WHERE session=?', [id]);
      return true;
    });
  }
  function removeSession(id) {
    return transaction(async () => {
      await execute('DELETE FROM session_modules WHERE session=?', [id]);
      return execute('DELETE FROM sessions WHERE id=?', [id]);
    });
  }
  const source = settings => ({ status: settings['moodle-status'] || 'manual',
    consulted: settings['moodle-consulted'] || VERIFIED, attempted: settings['moodle-attempted'] || null });
  function recordMoodle(status) {
    return transaction(async () => {
      await saveSetting('moodle-status', status);
      await saveSetting('moodle-attempted', bogota().date);
      if (status === 'manual') await saveSetting('moodle-consulted', bogota().date);
    });
  }
  const hasNotice = async date => Boolean(await get('SELECT 1 FROM daily WHERE date=?', [date]));
  async function makeNotice(now = new Date()) {
    const { date, hour } = bogota(now);
    if (hour < 5) return false;
    return transaction(async () => {
      if (await hasNotice(date)) return false;
      const rows = await lessons();
      const settings = await readSettings();
      const cursor = resume(rows, indexTicks(await readTicks()), settings);
      const scheduled = (await sessions()).filter(row => row.date === date);
      const ids = [...new Set(scheduled.map(row => row.lesson).filter(Boolean))];
      if (cursor && !ids.includes(cursor.id)) ids.push(cursor.id);
      const data = { date, created: now.toISOString(), track: TRAYECTO, cursor, scheduled, source: source(settings),
        lessons: ids.map(id => rows.find(day => day.id === id)).filter(Boolean) };
      await execute('INSERT INTO daily VALUES (?,?)', [date, JSON.stringify(data)]);
      return true;
    });
  }
  async function snapshot(now = new Date()) {
    const [rows, checked, settings, agenda, history, notices, legacyNotices] = await Promise.all([
      lessons(), readTicks(), readSettings(), sessions(), all('SELECT * FROM completions ORDER BY completed DESC, lesson'),
      all('SELECT data FROM daily ORDER BY date DESC'), all('SELECT date,lesson FROM inbox ORDER BY date DESC, lesson'),
    ]);
    return {
      today: bogota(now).date, track: TRAYECTO, modules: MODULES, lessons: rows, checked, sessions: agenda,
      resume: resume(rows, indexTicks(checked), settings), source: source(settings), history,
      notices: notices.map(row => JSON.parse(row.data)), legacyNotices, chatFocus: JSON.parse(settings['chat-focus'] || 'null'),
    };
  }
  async function chatHistory(id, step) {
    const recent = await all('SELECT role,content,created FROM messages WHERE lesson=? AND step=? ORDER BY id', [id, step]);
    if (step) return recent;
    return [...await all('SELECT role,content,NULL AS created FROM chat WHERE lesson=? ORDER BY id', [id]), ...recent];
  }
  function saveChat(id, step, prompt, answer) {
    const now = new Date().toISOString();
    return execute('INSERT INTO messages(lesson,step,role,content,created) VALUES(?,?,?,?,?),(?,?,?,?,?)',
      [id, step, 'user', prompt, now, id, step, 'assistant', answer, now]);
  }
  return { find, ticks, applyTicks, saveLesson, saveSession, removeSession, recordMoodle, hasNotice, makeNotice, snapshot,
    chatHistory, saveChat, focus: (id, step) => saveSetting('chat-focus', JSON.stringify({ id, step })), close: db.close };
}

