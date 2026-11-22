import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
export const guidePrompt = 'Guíame en este paso con un ejemplo y una prueba.';
const savedGuide = (history, basic) => history.find((row, i) => row.role === 'assistant'
  && history[i - 1]?.role === 'user' && history[i - 1].content === guidePrompt
  && row.content.startsWith(basic ? 'Guía del tablero\n\n' : 'Respuesta de IA\n\n'));

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
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, document TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS logins_expiry ON logins(expires);
  CREATE TABLE IF NOT EXISTS auth_limits (bucket TEXT PRIMARY KEY, expires INTEGER NOT NULL, attempts INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS auth_limits_expiry ON auth_limits(expires);
  CREATE TABLE IF NOT EXISTS account_ticks (
    account TEXT NOT NULL, lesson INTEGER NOT NULL, step TEXT NOT NULL, PRIMARY KEY(account,lesson,step)
  );
  CREATE TABLE IF NOT EXISTS account_completions (
    account TEXT NOT NULL, lesson INTEGER NOT NULL, completed TEXT, PRIMARY KEY(account,lesson)
  );
  CREATE TABLE IF NOT EXISTS account_history_notes (
    account TEXT NOT NULL, lesson INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY(account,lesson)
  );
  CREATE TABLE IF NOT EXISTS account_messages (
    id INTEGER PRIMARY KEY, account TEXT NOT NULL, lesson INTEGER NOT NULL, step TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_thread ON account_messages(account,lesson,step,id);
  CREATE TABLE IF NOT EXISTS chat_revisions (
    account TEXT NOT NULL, lesson INTEGER NOT NULL, step TEXT NOT NULL, revision INTEGER NOT NULL,
    PRIMARY KEY(account,lesson,step)
  );
  CREATE TABLE IF NOT EXISTS account_threads (
    account TEXT NOT NULL, id TEXT NOT NULL, lesson INTEGER NOT NULL, step TEXT NOT NULL,
    title TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(account,id)
  );
  CREATE TABLE IF NOT EXISTS legacy_thread_titles (
    account TEXT NOT NULL, lesson INTEGER NOT NULL, step TEXT NOT NULL,
    title TEXT NOT NULL, PRIMARY KEY(account,lesson,step)
  );
  CREATE TABLE IF NOT EXISTS account_daily (
    account TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,date)
  );
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
  const readSettings = async () => Object.fromEntries((await all("SELECT key,value FROM settings WHERE instr(key, ':')=0")).map(row => [row.key, row.value]));
  const lessons = async () => (await all('SELECT id,data FROM lessons')).map(fromRow)
    .sort((a, b) => (moduleOrder.get(a.module) ?? 99) - (moduleOrder.get(b.module) ?? 99) || a.week - b.week || a.day - b.day);
  const find = async id => {
    const row = await get('SELECT id,data FROM lessons WHERE id=?', [id]);
    return row && fromRow(row);
  };
  const update = lesson => {
    const { id, ...data } = lesson;
    return execute('UPDATE lessons SET data=? WHERE id=?', [JSON.stringify(data), id]);
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
    const checked = await all('SELECT lesson,step FROM ticks');
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

  if (!(await get("SELECT value FROM settings WHERE key='schema-v3'"))) await transaction(async () => {
    if (await get("SELECT value FROM settings WHERE key='schema-v3'")) return;
    await execute("INSERT INTO account_ticks SELECT 'owner',lesson,step FROM ticks");
    await execute("INSERT INTO account_completions SELECT 'owner',lesson,completed FROM completions");
    await execute("INSERT INTO account_messages SELECT id,'owner',lesson,step,role,content,created FROM messages");
    await execute("INSERT INTO account_daily SELECT 'owner',date,data FROM daily");
    await saveSetting('schema-v3', 1);
  });

  function forAccount(account) {
    const owner = account === 'owner';
    const readTicks = () => all('SELECT lesson,step FROM account_ticks WHERE account=?', [account]);
    const ticks = async id => new Set((await all('SELECT step FROM account_ticks WHERE account=? AND lesson=?', [account, id])).map(row => row.step));
    const setPersonal = (key, value) => saveSetting(owner ? key : `${account}:${key}`, value);
    async function personalSettings() {
      const settings = await readSettings();
      if (owner) return settings;
      const personal = await all('SELECT key,value FROM settings WHERE key IN (?,?,?,?)',
        ['active', 'step', 'chat-focus', 'notifications-paused'].map(key => `${account}:${key}`));
      return { ...settings, active: '1', step: '2-0', 'chat-focus': undefined,
        'notifications-paused': '0',
        ...Object.fromEntries(personal.map(row => [row.key.split(':')[1], row.value])) };
    }
    async function writeMarks(lesson, list, checked) {
      if (!list.length) return;
      if (checked) {
        for (let start = 0; start < list.length; start += 300) {
          const steps = list.slice(start, start + 300);
          await execute('INSERT OR IGNORE INTO account_ticks VALUES ' + steps.map(() => '(?,?,?)').join(','),
            steps.flatMap(step => [account, lesson, step]));
        }
      } else {
        await execute('DELETE FROM account_ticks WHERE account=? AND lesson=? AND step IN (' + list.map(() => '?').join(',') + ')',
          [account, lesson, ...list]);
      }
    }

    function applyTicks(id, changes, finish, reopenWeek = false) {
      return transaction(async () => {
        const rows = await lessons();
        const day = rows.find(row => row.id === id);
        if (!day) return { invalid: true };
        const steps = keys(day);
        if (reopenWeek) {
          const days = rows.filter(row => row.module === day.module && row.week === day.week);
          const first = days.find(row => keys(row).length);
          if (!first) return { invalid: true };
          for (const row of days) await writeMarks(row.id, keys(row), false);
          await setPersonal('active', first.id);
          await setPersonal('step', keys(first)[0]);
          return { next: null, selected: first.id };
        }
        if (finish && steps.length) changes = Object.fromEntries(steps.map(step => [step, true]));
        if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length
          || Object.entries(changes).some(([key, value]) => !steps.includes(key) || typeof value !== 'boolean')) return { invalid: true };
        const marks = indexTicks(await readTicks());
        const settings = await personalSettings();
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
        if (isComplete && !wasComplete) await execute('INSERT OR IGNORE INTO account_completions VALUES (?,?,?)', [account, id, new Date().toISOString()]);
        if (drop.length) {
          await setPersonal('active', id);
          await setPersonal('step', steps.find(step => !checked.has(step)) ?? '');
        } else if (isComplete && (finish || active?.id === id)) {
          const index = rows.indexOf(day);
          next = [...rows.slice(index + 1), ...rows.slice(0, index)].find(row => !done(row, marks.get(row.id)))?.id ?? null;
          await setPersonal('active', next ?? '');
          await setPersonal('step', '');
        } else if (active?.id === id || !active) {
          settings.active = id;
          await setPersonal('active', id);
          await setPersonal('step', resume(rows, marks, settings)?.step ?? '');
        }
        return { next, ...(drop.length ? { selected: id } : {}) };
      });
    }
    const hasNotice = async date => Boolean(await get('SELECT 1 FROM account_daily WHERE account=? AND date=?', [account, date]));
    function setNotificationsPaused(paused) {
      return transaction(() => setPersonal('notifications-paused', paused ? '1' : '0'));
    }
    function makeNotice(now = new Date()) {
      return transaction(async () => {
        const { date, hour } = bogota(now);
        if (hour < 5) return false;
        const [rows, settings, marks, agenda] = await Promise.all([lessons(), personalSettings(), readTicks(), sessions()]);
        if (settings['notifications-paused'] === '1') return false;
        const cursor = resume(rows, indexTicks(marks), settings);
        const scheduled = agenda.filter(row => row.date === date);
        const ids = [...new Set(scheduled.map(row => row.lesson).filter(Boolean))];
        if (cursor && !ids.includes(cursor.id)) ids.push(cursor.id);
        const data = { date, created: now.toISOString(), track: TRAYECTO, cursor, scheduled, source: source(settings),
          lessons: ids.map(id => rows.find(day => day.id === id)).filter(Boolean) };
        return Boolean((await execute('INSERT OR IGNORE INTO account_daily VALUES (?,?,?)', [account, date, JSON.stringify(data)])).changes);
      });
    }
    function saveHistoryNote(id, note) {
      if (!note) return execute('DELETE FROM account_history_notes WHERE account=? AND lesson=?', [account, id]);
      return execute(`INSERT INTO account_history_notes VALUES (?,?,?)
        ON CONFLICT(account,lesson) DO UPDATE SET note=excluded.note`, [account, id, note]);
    }
    async function snapshot(now = new Date()) {
      const [rows, checked, settings, agenda, history, notes, notices, legacyNotices] = await Promise.all([
        lessons(), readTicks(), personalSettings(), sessions(),
        all('SELECT lesson,completed FROM account_completions WHERE account=? ORDER BY completed DESC, lesson', [account]),
        all('SELECT lesson,note FROM account_history_notes WHERE account=?', [account]),
        all('SELECT data FROM account_daily WHERE account=? ORDER BY date DESC', [account]),
        owner ? all('SELECT date,lesson FROM inbox ORDER BY date DESC, lesson') : [],
      ]);
      return {
        today: bogota(now).date, track: TRAYECTO, modules: MODULES, lessons: rows, checked, sessions: agenda,
        resume: resume(rows, indexTicks(checked), settings), source: source(settings), history,
        notificationsPaused: settings['notifications-paused'] === '1',
        historyNotes: Object.fromEntries(notes.map(row => [row.lesson, row.note])),
        notices: notices.map(row => JSON.parse(row.data)), legacyNotices, chatFocus: JSON.parse(settings['chat-focus'] || 'null'),
      };
    }
    async function chatHistory(id, step) {
      const recent = await all('SELECT role,content,created FROM account_messages WHERE account=? AND lesson=? AND step=? ORDER BY id', [account, id, step]);
      if (step || !owner) return recent;
      return [...await all('SELECT role,content,NULL AS created FROM chat WHERE lesson=? ORDER BY id', [id]), ...recent];
    }
    const chatRevision = async (id, step) => (await get(
      'SELECT revision FROM chat_revisions WHERE account=? AND lesson=? AND step=?', [account, id, step]))?.revision ?? 0;
    function deleteChat(id, step, chat) {
      return transaction(async () => {
        await execute('DELETE FROM account_messages WHERE account=? AND lesson=? AND step=?', [account, id, step]);
        if (chat) await execute('DELETE FROM account_threads WHERE account=? AND id=?', [account, chat]);
        else await execute('DELETE FROM legacy_thread_titles WHERE account=? AND lesson=? AND step=?', [account, id, step]);
        if (owner) {
          await execute('DELETE FROM messages WHERE lesson=? AND step=?', [id, step]);
          if (!step) await execute('DELETE FROM chat WHERE lesson=?', [id]);
        }
        await execute(`INSERT INTO chat_revisions VALUES (?,?,?,1)
          ON CONFLICT(account,lesson,step) DO UPDATE SET revision=revision+1`, [account, id, step]);
        return chatRevision(id, step);
      });
    }
    async function listChats() {
      const custom = await all('SELECT id AS chat,lesson AS id,step,title,created FROM account_threads WHERE account=?', [account]);
      const legacy = await all(`SELECT lesson AS id, step, MAX(created) AS created FROM account_messages
        WHERE account=? AND instr(step,'~')=0 GROUP BY lesson,step`, [account]);
      if (owner) {
        for (const row of await all("SELECT DISTINCT lesson AS id, '' AS step FROM chat")) {
          if (!legacy.some(item => item.id === row.id && !item.step)) legacy.push(row);
        }
      }
      const titles = new Map((await all('SELECT lesson,step,title FROM legacy_thread_titles WHERE account=?', [account]))
        .map(row => [row.lesson + '/' + row.step, row.title]));
      for (const row of legacy) row.title = titles.get(row.id + '/' + row.step);
      return [...custom, ...legacy].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    }
    async function createChat(id, step, title) {
      const chat = randomUUID();
      await execute('INSERT INTO account_threads VALUES (?,?,?,?,?,?)', [account, chat, id, step, title, new Date().toISOString()]);
      return { id, step, chat, title };
    }
    const findChat = chat => get('SELECT lesson AS id,step,title FROM account_threads WHERE account=? AND id=?', [account, chat]);
    const legacyChatTitle = async (id, step) => (await get(
      'SELECT title FROM legacy_thread_titles WHERE account=? AND lesson=? AND step=?', [account, id, step]))?.title;
    async function renameChat(id, step, chat, title) {
      if (chat) return Boolean((await execute(
        'UPDATE account_threads SET title=? WHERE account=? AND id=? AND lesson=? AND step=?',
        [title, account, chat, id, step])).changes);
      return transaction(async () => {
        const message = await get('SELECT 1 FROM account_messages WHERE account=? AND lesson=? AND step=? LIMIT 1', [account, id, step]);
        const olderMessage = !message && owner && !step && await get('SELECT 1 FROM chat WHERE lesson=? LIMIT 1', [id]);
        if (!message && !olderMessage) return false;
        await execute(`INSERT INTO legacy_thread_titles VALUES (?,?,?,?)
          ON CONFLICT(account,lesson,step) DO UPDATE SET title=excluded.title`, [account, id, step, title]);
        return true;
      });
    }
    function insertChat(id, step, prompt, answer) {
      const now = new Date().toISOString();
      return execute('INSERT INTO account_messages(account,lesson,step,role,content,created) VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)',
        [account, id, step, 'user', prompt, now, account, id, step, 'assistant', answer, now]);
    }
    function saveChat(id, step, prompt, answer, revision) {
      return transaction(async () => {
        if (revision !== await chatRevision(id, step)) return null;
        await insertChat(id, step, prompt, answer);
        return chatHistory(id, step);
      });
    }
    async function guideHistory(id, step, basic) {
      const history = await chatHistory(id, step);
      return savedGuide(history, basic) ? history : null;
    }
    function saveGuide(id, step, basic, answer, revision) {
      return transaction(async () => {
        if (revision !== await chatRevision(id, step)) return null;
        if (!await guideHistory(id, step, basic)) await insertChat(id, step, guidePrompt, answer);
        return chatHistory(id, step);
      });
    }
    return { find, ticks, applyTicks, setNotificationsPaused, hasNotice, makeNotice, snapshot, chatHistory, chatRevision, deleteChat, saveChat, guideHistory, saveGuide,
      saveHistoryNote, listChats, createChat, findChat, legacyChatTitle, renameChat,
      focus: (id, step, chat) => setPersonal('chat-focus', JSON.stringify({ id, step, ...(chat ? { chat } : {}) })) };
  }
  function saveLesson(id, data, { preserveStepPositions = false } = {}) {
    return transaction(async () => {
      if (id) {
        const lesson = await find(id);
        if (!lesson) return null;
        const previous = lesson.quests;
        const samePositions = previous.length === data.quests.length && previous.every((quest, i) =>
          data.quests[i]?.[0] === quest[0] && data.quests[i][2].length === quest[2].length);
        const sameSteps = previous.every((quest, i) => data.quests[i]?.[0] === quest[0]
          && quest[2].every((step, j) => step === data.quests[i][2][j]));
        // La Beta identifica las casillas y los hilos por posición.
        // Una carga local revisada puede ampliar la redacción sin cambiar las claves del avance.
        if (!sameSteps && !(preserveStepPositions && samePositions) && await get(`SELECT 1 FROM account_ticks WHERE lesson=?
          UNION ALL SELECT 1 FROM account_completions WHERE lesson=?
          UNION ALL SELECT 1 FROM account_messages WHERE lesson=?
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
  const owner = forAccount('owner');
  async function makeNotices(now) {
    const { date } = bogota(now);
    const accounts = await all(`SELECT id FROM (SELECT 'owner' AS id UNION SELECT id FROM accounts)
      WHERE NOT EXISTS (SELECT 1 FROM account_daily WHERE account=id AND date=?)`, [date]);
    let created = false;
    for (const { id } of accounts) created = await forAccount(id).makeNotice(now) || created;
    return created;
  }
  return { ...owner, forAccount: account => ({ ...forAccount(account), saveLesson, saveSession, removeSession, recordMoodle }),
    saveLesson, saveSession, removeSession, recordMoodle, makeNotices, db, close: db.close };
}
