const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('#sidebar-nav [data-tab]')];
const mobileMenu = matchMedia('(max-width: 730px)');
const menuToggle = $('menu-toggle');
let desktopMenuCollapsed = false;
let mobileMenuOpen = false;

function updateMenu() {
  const expanded = mobileMenu.matches ? mobileMenuOpen : !desktopMenuCollapsed;
  $('layout').classList.toggle('menu-compact', !mobileMenu.matches && desktopMenuCollapsed);
  $('layout').classList.toggle('menu-open', mobileMenu.matches && mobileMenuOpen);
  menuToggle.setAttribute('aria-expanded', String(expanded));
  $('menu-label').textContent = expanded ? (mobileMenu.matches ? 'Cerrar menú' : 'Contraer menú') : 'Abrir menú';
  menuToggle.setAttribute('aria-label', $('menu-label').textContent);
  menuToggle.title = $('menu-label').textContent;
}
menuToggle.onclick = () => {
  if (mobileMenu.matches) mobileMenuOpen = !mobileMenuOpen;
  else desktopMenuCollapsed = !desktopMenuCollapsed;
  updateMenu();
};
mobileMenu.addEventListener('change', () => {
  if (mobileMenu.matches && $('sidebar-nav').contains(document.activeElement)) menuToggle.focus();
  mobileMenuOpen = false;
  updateMenu();
});
$('layout').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !mobileMenuOpen) return;
  mobileMenuOpen = false;
  updateMenu();
  menuToggle.focus();
});
updateMenu();
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function box(tag, cls, ...items) {
  const node = el(tag, null, cls);
  node.append(...items);
  return node;
}
function button(label, action, cls) {
  const node = el('button', label, cls);
  node.type = 'button';
  node.onclick = action;
  return node;
}
function link(label, url, cls) {
  const node = el('a', label, cls);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
function details(label, ...children) {
  return box('details', '', el('summary', label), ...children);
}
let statusTimer;
function status(text, error = false) {
  clearTimeout(statusTimer);
  $('status').textContent = text;
  $('status').toggleAttribute('data-error', error);
  if (text) statusTimer = setTimeout(() => status(''), 5000);
}
async function api(path, data, signal) {
  const response = await fetch(path, { signal, ...(data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }) });
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('Vuelve a iniciar sesión en el tablero.');
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('El servidor no pudo responder. Intenta de nuevo.');
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error), { status: response.status });
  return payload;
}

let state, selected, focus, week, pending = false, chatPending = false, chatLoad = 0;
let connection, googlePending, threadHistory = [], threadRevision, ollamaRequest;
let activeTab = 'check';
let mutationQueue = Promise.resolve();
$('logout').onclick = async () => {
  try {
    ollamaRequest?.abort();
    disconnect();
    await mutationQueue;
    await api('/api/auth/logout', {});
    location.replace('/login');
  } catch (error) {
    status(error.message, true);
  }
};
const opened = new Map();
const moduleName = id => state.modules.find(item => item.id === id)?.name || id;
const lesson = id => state.lessons.find(day => day.id === id);
const dayName = day => `Semana ${day.week} · Día ${day.day}`;
const fullName = day => moduleName(day.module) + ' · ' + dayName(day);
const dateLabel = (date, long = false) => new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC', ...(long ? { weekday: 'long' } : {}), day: 'numeric', month: 'long',
  ...(long ? { year: 'numeric' } : {}),
}).format(new Date(date + 'T12:00:00Z'));
function offset(date, days) {
  const instant = new Date(date + 'T12:00:00Z');
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
function monday(date) {
  const number = new Date(date + 'T12:00:00Z').getUTCDay();
  return offset(date, -((number + 6) % 7));
}
function completed(day) {
  const marked = new Set(state.checked.filter(row => row.lesson === day.id).map(row => row.step));
  const total = day.quests.reduce((sum, q) => sum + q[2].length, 0);
  const count = day.quests.reduce((sum, q, i) => sum + q[2].filter((_, j) => marked.has(i + '-' + j)).length, 0);
  return { marked, total, count, done: total > 0 && count === total };
}
function stateLabel(day) {
  const progress = completed(day);
  if (!progress.total) return 'Checklist pendiente de verificar';
  if (progress.done) return 'Completado';
  if (progress.count || state.resume?.id === day.id) return 'En curso';
  return 'Pendiente';
}
function cursorLabel(cursor, day) {
  if (!day) return 'Todos los días del tablero están completos.';
  if (!cursor?.step) return fullName(day) + ' · Checklist pendiente';
  const [i, j] = cursor.step.split('-').map(Number);
  const quest = day.quests[i];
  return quest ? fullName(day) + ` · MiniReto ${i + 1} · ${quest[0]} · Paso ${j + 1}` : fullName(day);
}
function show(tab) {
  activeTab = tab;
  const returnFocus = mobileMenu.matches && mobileMenuOpen && $('sidebar-nav').contains(document.activeElement);
  mobileMenuOpen = false;
  for (const item of tabs) {
    const current = item.dataset.tab === tab;
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
    $(item.dataset.tab).hidden = !current;
  }
  updateMenu();
  if (returnFocus) {
    $(tab).tabIndex = -1;
    $(tab).focus({ preventScroll: true });
  }
  if (state && tab === 'chat') openChat(focus || { id: selected, step: '' }, false);
  window.scrollTo(0, 0);
}
for (const tab of tabs) tab.onclick = () => state && show(tab.dataset.tab);
function select(id, step) {
  selected = id;
  if (step) opened.set(id, new Set([Number(step.split('-')[0])]));
  renderCheck();
  show('check');
}
const openDay = (id, step) => button('Abrir checklist', () => select(id, step), 'secondary');
function update(path, payload, onSuccess, message = 'Guardado.') {
  const operation = mutationQueue.then(() => saveUpdate(path, payload, onSuccess, message));
  mutationQueue = operation.catch(() => {});
  return operation;
}
async function saveUpdate(path, payload, onSuccess, message) {
  pending = true;
  status('Guardando…');
  try {
    const next = await api(path, payload);
    state = next;
    onSuccess?.(next);
    render();
    status(typeof message === 'function' ? message(next) : message);
    return true;
  } catch (error) {
    status(error.message, true);
    if (path === '/api/ticks') renderCheck();
  } finally {
    pending = false;
  }
}
function checkbox(title, checked, partial, action) {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.indeterminate = partial;
  input.onchange = () => action(input.checked);
  return box('label', 'check', input, el('span', title));
}
function setTicks(id, ids, value, finish = false) {
  const payload = { id, finish: finish && value, changes: Object.fromEntries(ids.map(key => [key, value])) };
  update('/api/ticks', payload,
    next => {
      if (selected === id && finish && value && next.next) selected = next.next;
    }, next => finish && value && next.next ? 'Día guardado. Estás viendo el siguiente día pendiente.' : 'Avance guardado.');
}
function field(form, label, name, value, options = {}) {
  let input;
  if (options.choices) {
    input = el('select');
    for (const [key, title] of options.choices) {
      const option = el('option', title);
      option.value = key;
      input.append(option);
    }
  } else {
    input = el(options.multiline ? 'textarea' : 'input');
    if (!options.multiline) input.type = options.type || 'text';
    if (options.type === 'number') { input.min = '1'; input.max = '99'; }
  }
  input.name = name;
  input.value = value ?? '';
  input.required = !options.optional;
  form.append(box('label', options.wide ? 'wide' : '', label, input));
  return input;
}
function renderSources() {
  const src = state.source;
  const title = { manual: 'Moodle · carga manual', available: 'Moodle · conexión comprobada',
    expired: 'Moodle · sesión vencida', unavailable: 'Moodle · conexión no disponible' }[src.status];
  const notice = details(title,
    el('p', 'Última consulta de contenido registrada: ' + dateLabel(src.consulted, true) + '.'),
    el('p', 'Las fichas y las vinculaciones de fechas que falten quedan pendientes de verificar. Consulta la fuente oficial y carga el resultado en el tablero.'),
    box('div', 'row', link('Reconectar Moodle', state.links.login, 'button secondary'),
      link('Mis cursos · Inglés y HSE ↗', state.links.courses, 'button secondary'),
      ...(state.canEdit ? [button('Indicar sesión vencida', () => update('/api/moodle', { action: 'expired' }), 'secondary'),
        button('Registrar consulta manual', () => update('/api/moodle', { action: 'manual' }), 'secondary')] : [])));
  if (state.canEdit && state.moodleProbe) notice.append(button('Comprobar conexión', () => update('/api/moodle', { action: 'probe' })));
  if (src.attempted) notice.append(el('small', 'Última comprobación: ' + dateLabel(src.attempted, true)));
  notice.className = 'source';
  if (src.status === 'expired') { notice.dataset.expired = ''; notice.open = true; }
  const previous = $('sources').querySelector('details');
  if (previous?.open) notice.open = true;
  $('sources').replaceChildren(notice);
}
const blankQuest = ['', '', [''], { requirements: '', criteria: '', deliverable: '' }];
function lessonForm(day) {
  const form = el('form', null, 'forms');
  if (!day) {
    field(form, 'Módulo', 'module', state.modules[0].id, { choices: state.modules.map(m => [m.id, m.name]) });
    field(form, 'Semana del curso', 'week', 1, { type: 'number' });
    field(form, 'Día del curso', 'day', 1, { type: 'number' });
  }
  field(form, 'Tema', 'title', day?.title);
  field(form, 'Tecnología de la ficha', 'technology', day?.technology);
  const url = field(form, 'Enlace oficial a Moodle', 'url', day?.url || state.links.course, { type: 'url', wide: true });
  if (!day) {
    form.elements.namedItem('module').onchange = event => {
      if (state.modules.some(module => module.url === url.value)) {
        url.value = state.modules.find(module => module.id === event.target.value).url;
      }
    };
  }
  field(form, 'Resumen', 'summary', day?.consulted ? day.summary : '', { multiline: true, wide: true });
  const quests = el('div', null, 'wide');
  form.append(quests);
  function appendQuest(q) {
    const part = el('fieldset', null, 'card');
    const legend = el('legend');
    part.append(legend);
    field(part, 'Título', 'title', q[0]);
    field(part, 'Contexto', 'context', q[1], { multiline: true });
    field(part, 'Pasos (uno por línea)', 'steps', q[2].join('\n'), { multiline: true });
    field(part, 'Requisitos', 'requirements', q[3]?.requirements);
    field(part, 'Criterios', 'criteria', q[3]?.criteria);
    field(part, 'Entregable', 'deliverable', q[3]?.deliverable);
    part.append(button('Quitar minirreto', () => {
      if (quests.children.length > 1) part.remove();
      [...quests.children].forEach((item, i) => item.firstChild.textContent = 'MiniReto ' + (i + 1));
    }, 'secondary'));
    quests.append(part);
    legend.textContent = 'MiniReto ' + quests.children.length;
  }
  (day?.quests.length ? day.quests : [blankQuest]).forEach(appendQuest);
  form.append(box('div', 'row wide', button('Añadir minirreto', () => appendQuest(blankQuest), 'secondary'), el('button', 'Guardar checklist')));
  form.onsubmit = event => {
    event.preventDefault();
    const input = name => form.elements.namedItem(name).value;
    const data = {
      id: day?.id, module: day?.module || input('module'), week: day?.week || Number(input('week')),
      day: day?.day || Number(input('day')), url: input('url'), technology: input('technology'), summary: input('summary'),
      title: form.querySelector('input[name=title]').value,
      quests: [...quests.children].map(part => {
        const value = name => part.elements.namedItem(name).value.trim();
        return [value('title'), value('context'), value('steps').split('\n').map(line => line.trim()).filter(Boolean), {
          requirements: value('requirements'), criteria: value('criteria'), deliverable: value('deliverable'),
        }];
      }),
    };
    update('/api/import', data, next => { selected = next.selected; }, 'Checklist guardado.');
  };
  return details(day?.quests.length ? 'Editar ficha de Moodle' : 'Cargar checklist', el('p', 'En Moodle abre Semana → Día correspondiente → Reto → Tus MiniRetos de hoy. Expande cada tarjeta y registra los datos de la ficha.'), form);
}
function renderCheck() {
  const d = lesson(selected);
  if (!d) return;
  const cursor = state.resume;
  const resume = box('article', 'card hero', el('small', state.track), el('h2', 'Retoma aquí'),
    el('p', cursorLabel(cursor, lesson(cursor?.id))));
  if (cursor && cursor.id !== d.id) resume.append(openDay(cursor.id, cursor.step));
  const today = state.sessions.filter(row => row.date === state.today);
  const scheduled = box('article', 'card', el('h3', 'Programado para el clan'), el('small', dateLabel(state.today, true)));
  if (!today.length) scheduled.append(el('p', 'Sin programación verificada'));
  today.forEach(session => scheduled.append(sessionContent(session, true)));
  const picker = el('select');
  picker.setAttribute('aria-label', 'Día del curso');
  for (const module of state.modules) {
    const group = el('optgroup');
    group.label = module.name;
    for (const row of state.lessons.filter(day => day.module === module.id)) {
      const option = el('option', dayName(row) + ' · ' + row.title);
      option.value = row.id;
      group.append(option);
    }
    if (group.childElementCount) picker.append(group);
  }
  picker.value = d.id;
  picker.onchange = () => select(Number(picker.value));
  const progress = completed(d);
  const sessions = state.sessions.filter(row => row.lesson === d.id);
  const intro = box('article', 'card', el('small', state.track), el('p', fullName(d), 'eyebrow'),
    el('h2', d.title), el('p', d.summary, 'copy'),
    el('p', sessions.length ? 'Fecha programada para Ritchie: ' + dateLabel(sessions[0].date, true) : 'Fecha programada para Ritchie: sin programación verificada.'),
    el('small', d.consulted ? 'Ficha consultada el ' + dateLabel(d.consulted, true) : 'Ficha de Moodle pendiente de verificar.'),
    el('small', d.technology || 'Tecnología pendiente de verificar.'),
    link('Ver la ficha en Moodle ↗', d.url));
  if (progress.total) {
    const bar = el('progress');
    bar.max = progress.total;
    bar.value = progress.count;
    bar.setAttribute('aria-label', 'Avance del día');
    const ids = d.quests.flatMap((q, i) => q[2].map((_, j) => i + '-' + j));
    intro.append(bar, el('small', progress.count + ' de ' + progress.total + ' pasos'), checkbox('Día completado',
      progress.done, progress.count > 0 && !progress.done, value => setTicks(d.id, ids, value, true)));
  } else intro.append(el('p', 'Pendiente de cargar las instrucciones de este día.', 'eyebrow'));
  $('check').replaceChildren(resume, scheduled, box('label', '', 'Día del curso', picker), intro);
  if (d.quests.length) $('check').append(el('h3', 'Tus MiniRetos de hoy'));
  d.quests.forEach(([title, context, steps, meta], i) => {
    const ids = steps.map((_, j) => i + '-' + j);
    const count = ids.filter(key => progress.marked.has(key)).length;
    const card = details(`MiniReto ${i + 1} · ${title} · ${count}/${ids.length}`, el('p', context, 'copy'),
      el('p', 'Entregable · ' + (meta?.deliverable || 'Pendiente de verificar en Moodle.'), 'copy quest-meta'),
      checkbox('MiniReto completado', count === ids.length, count > 0 && count < ids.length, value => setTicks(d.id, ids, value)),
      el('h4', 'Pasos del MiniReto ' + (i + 1)));
    if (meta) card.append(details('Requisitos y criterios', el('p', meta.requirements, 'copy'), el('p', meta.criteria, 'copy')));
    const saved = opened.get(d.id) || new Set(cursor?.id === d.id && cursor.step ? [Number(cursor.step.split('-')[0])] : []);
    card.open = saved.has(i);
    card.ontoggle = () => {
      if (card.open) saved.add(i);
      else saved.delete(i);
      opened.set(d.id, saved);
    };
    steps.forEach((task, j) => {
      const key = ids[j];
      const current = cursor?.id === d.id && cursor.step === key;
      const label = `Paso ${j + 1} · ${task}`;
      const ask = button('Pedir guía', () => {
        focus = { id: d.id, step: key };
        show('chat');
      }, 'secondary');
      ask.setAttribute('aria-label', 'Pedir guía del MiniReto ' + (i + 1) + ', Paso ' + (j + 1));
      card.append(box('div', current ? 'step current' : 'step',
        checkbox(label + (current ? ' (En curso)' : ''), progress.marked.has(key), false, value => setTicks(d.id, [key], value)), ask));
    });
    $('check').append(card);
  });
  if (state.canEdit) $('check').append(lessonForm(d), details('Añadir otro día del curso', lessonForm()));
}
function sessionContent(s, compact = false) {
  const day = lesson(s.lesson);
  const node = box('div', 'session', el('h4', s.label || day?.title), el('small', s.hours));
  if (day) {
    node.append(el('p', fullName(day) + ' · ' + day.title), el('small', stateLabel(day)),
      el('small', day.quests.length ? day.quests.map(q => q[0]).join(' · ') : 'MiniRetos pendientes de verificar'),
      openDay(day.id));
  } else {
    if (s.module) node.append(box('p', '', link(moduleName(s.module) + ' · Abrir en Moodle ↗',
      state.modules.find(module => module.id === s.module).url)));
    node.append(el('small', 'Día del curso y minirretos sin vincular.'));
  }
  node.append(box('small', '', link('Fuente oficial ↗', s.source)));
  if (!compact) {
    node.append(el('small', 'Consultado el ' + dateLabel(s.consulted)));
    if (state.canEdit) node.append(sessionForm(s, s.date));
  }
  return node;
}
function sessionForm(session, date) {
  const form = el('form');
  field(form, 'Fecha de Ritchie', 'date', date, { type: 'date' });
  field(form, 'Día del curso vinculado', 'lesson', session?.lesson, { optional: true,
    choices: [['', 'Sin vincular'], ...state.lessons.map(d => [d.id, fullName(d) + ' · ' + d.title])] });
  field(form, 'Actividad del horario', 'label', session?.label, { optional: true });
  field(form, 'Módulo', 'module', session?.module || '', { optional: true,
    choices: [['', 'Inferir del nombre del bloque'], ...state.modules.map(m => [m.id, m.name])] });
  field(form, 'Horario', 'hours', session?.hours, { optional: true });
  field(form, 'Enlace oficial de origen', 'source', session?.source || state.links.agenda, { type: 'url' });
  const controls = box('div', 'row', el('button', 'Guardar sesión'));
  if (session) controls.append(button('Quitar fecha', () => {
    if (window.confirm('¿Quitar esta sesión del calendario?')) update('/api/session', { id: session.id, remove: true });
  }, 'danger'));
  form.append(controls);
  form.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    update('/api/session', { ...data, id: session?.id, lesson: Number(data.lesson) || null });
  };
  return details(session ? 'Editar fecha o vincular checklist' : 'Agregar fecha', form);
}
function renderCalendar() {
  const heading = box('div', 'row between', el('h2', 'Calendario Ritchie'),
    box('div', 'row', button('Anterior', () => { week = offset(week, -7); renderCalendar(); }, 'secondary'),
      button('Semana actual', () => { week = monday(state.today); renderCalendar(); }, 'secondary'),
      button('Siguiente', () => { week = offset(week, 7); renderCalendar(); }, 'secondary')));
  const output = el('div', null, 'calendar-days');
  for (let i = 0; i < 7; i++) {
    const date = offset(week, i);
    const sessions = state.sessions.filter(row => row.date === date);
    output.append(box('article', 'card', el('h3', dateLabel(date, true)),
      ...(sessions.length ? sessions.map(s => sessionContent(s)) : [el('p', 'Sin programación verificada')]),
      ...(state.canEdit ? [sessionForm(null, date)] : [])));
  }
  let official = $('calendar').querySelector('#official-agenda');
  if (!official) {
    const frame = el('iframe', null, 'agenda-frame');
    frame.title = 'Agenda oficial del clan Ritchie';
    frame.referrerPolicy = 'no-referrer';
    official = details('Ver agenda oficial de Ritchie',
      box('p', '', link('Abrir agenda en otra pestaña ↗', state.links.agenda),
        ' · ', link('Genially oficial ↗', state.links.genially)), frame);
    official.id = 'official-agenda';
    official.ontoggle = () => { if (official.open && !frame.hasAttribute('src')) frame.src = state.links.agenda; };
  }
  $('calendar').replaceChildren(heading, official, el('p', dateLabel(week) + ' – ' + dateLabel(offset(week, 6)) + ' · Hora de Colombia'),
    box('div', 'row', link('Área personal de Moodle ↗', state.links.calendar), link('Mis cursos ↗', state.links.courses)), output);
}
function noticeDay(day, cursor) {
  const card = box('div', '', el('h4', fullName(day) + ' · ' + day.title), el('p', day.summary));
  if (cursor) card.append(el('p', 'Retoma aquí · ' + cursorLabel(cursor, day)));
  if (day.quests.length) {
    card.append(el('h4', 'Tus MiniRetos de hoy'));
    day.quests.forEach((q, i) => card.append(details('MiniReto ' + (i + 1) + ' · ' + q[0], el('p', q[1]),
      box('ol', 'notice-list', ...q[2].map((task, index) => el('li', 'Paso ' + (index + 1) + ' · ' + task))))));
  } else card.append(el('p', 'Pasos pendientes de verificar.'));
  card.append(box('div', 'row', openDay(day.id, cursor?.step), link('Ver Moodle ↗', day.url)));
  return card;
}
function renderInbox() {
  const records = state.notices.map(notice => {
    const card = box('article', 'card', el('h3', dateLabel(notice.date, true)), el('small', notice.track),
      el('h4', 'Programado para el clan'));
    if (!notice.scheduled.length) card.append(el('p', 'Sin programación verificada'));
    for (const row of notice.scheduled) {
      const day = notice.lessons.find(item => item.id === row.lesson);
      card.append(el('p', (row.label || day?.title) + (row.hours ? ' · ' + row.hours : '')), link('Fuente de la fecha ↗', row.source));
      card.append(day ? noticeDay(day) : box('div', '',
        ...(row.module ? [link(moduleName(row.module) + ' · Abrir en Moodle ↗', state.modules.find(m => m.id === row.module).url)] : []),
        el('p', 'Día del curso sin vincular.')));
    }
    card.append(el('h4', 'Tu siguiente paso'));
    const personal = notice.lessons.find(day => day.id === notice.cursor?.id);
    if (personal) {
      card.append(notice.scheduled.some(row => row.lesson === personal.id) ? el('p', 'Retoma aquí · ' + cursorLabel(notice.cursor, personal)) : noticeDay(personal, notice.cursor));
    } else card.append(el('p', cursorLabel(null, null)), link('Abrir curso en Moodle ↗', state.links.course));
    const pendingInfo = notice.source.status === 'expired' ? 'Sesión de Moodle vencida. ' : notice.source.status === 'unavailable' ? 'Consulta de Moodle sin acceso. ' : '';
    card.append(el('small', pendingInfo + 'Última consulta de contenido: ' + dateLabel(notice.source.consulted, true)
      + '. Quedan pendientes las fichas o las vinculaciones que falten.'));
    return card;
  });
  for (const entry of state.legacyNotices) {
    const day = lesson(entry.lesson);
    if (day) records.push(box('article', 'card', el('h3', dateLabel(entry.date, true)), el('small', 'Aviso de la Beta'), noticeDay(day)));
  }
  $('inbox').replaceChildren(el('h2', 'Avisos'), ...(records.length ? records : [el('p', 'Los avisos se guardan diariamente a partir de las 5:00 a. m., hora de Colombia.')]));
}
const searchText = value => value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const historyDrafts = new Map();
const openNotes = new Set();
function historyNote(day, saved) {
  const field = el('textarea');
  field.maxLength = 2000;
  field.id = 'note-' + day.id;
  field.value = historyDrafts.get(day.id) ?? saved;
  field.oninput = () => historyDrafts.set(day.id, field.value);
  const label = el('label', 'Nota personal');
  label.htmlFor = field.id;
  const save = el('button', 'Guardar nota');
  save.type = 'submit';
  const form = box('form', '', label, field, save);
  form.onsubmit = async event => {
    event.preventDefault();
    save.disabled = true;
    field.disabled = true;
    await update('/api/history/note', { id: day.id, note: field.value }, () => historyDrafts.delete(day.id),
      field.value.trim() ? 'Nota guardada.' : 'Nota eliminada.');
    save.disabled = false;
    field.disabled = false;
  };
  const editor = details(saved ? 'Editar nota' : 'Añadir nota', form);
  editor.open = openNotes.has(day.id);
  editor.ontoggle = () => {
    if (editor.isConnected) {
      if (editor.open) openNotes.add(day.id);
      else openNotes.delete(day.id);
    }
  };
  editor.classList.add('history-note');
  return editor;
}
function renderHistory() {
  const currentModule = $('history-module').value;
  const modules = state.modules.map(module => {
    const option = el('option', module.name);
    option.value = module.id;
    return option;
  });
  $('history-module').replaceChildren(el('option', 'Todos'), ...modules);
  $('history-module').firstElementChild.value = '';
  $('history-module').value = currentModule;
  const query = searchText($('history-search').value);
  const filterStatus = $('history-status').value;
  const completion = new Map(state.history.map(row => [row.lesson, row]));
  const records = state.lessons.map(day => {
    const progress = completed(day);
    const previous = completion.get(day.id);
    const note = state.historyNotes?.[day.id] || '';
    return { day, progress, previous, note, label: previous && !progress.done ? 'Reabierto' : stateLabel(day) };
  });
  const done = records.filter(row => row.progress.done).length;
  const summary = [
    ['Días completados', done + ' / ' + records.length],
    ['En curso o reabiertos', records.filter(({ label }) => label === 'En curso' || label === 'Reabierto').length],
    ['Notas personales', records.filter(row => row.note).length],
  ];
  $('history-summary').replaceChildren(...summary.map(([label, value]) =>
    box('div', 'card', el('strong', value), el('small', label))));
  const visible = records.filter(({ day, note, label }) =>
    (!currentModule || day.module === currentModule) && (!filterStatus || label === filterStatus)
    && searchText(fullName(day) + ' ' + day.title + ' ' + note).includes(query));
  visible.sort((a, b) => (b.previous?.completed || '').localeCompare(a.previous?.completed || ''));
  $('history-count').textContent = visible.length + ' de ' + records.length + ' días';
  const dateFormat = new Intl.DateTimeFormat('es-CO', { timeZone: state.zone, dateStyle: 'long' });
  $('history-records').replaceChildren(...visible.map(({ day, progress, previous, note, label }) => {
    const meter = el('progress');
    meter.max = progress.total || 1;
    meter.value = progress.count;
    meter.setAttribute('aria-label', 'Avance de ' + fullName(day));
    const completionDate = previous?.completed
      ? 'Primera finalización el ' + dateFormat.format(new Date(previous.completed))
      : 'Primera finalización sin fecha registrada';
    return box('article', 'card history-record',
      box('div', 'row between', el('small', fullName(day)), el('strong', label, 'history-state')),
      el('h3', day.title),
      ...(progress.total ? [meter, el('small', progress.count + ' de ' + progress.total + ' pasos')] : []),
      ...(previous ? [el('small', completionDate)] : []),
      ...(note ? [el('p', note, 'history-note-text')] : []),
      box('div', 'row history-actions', openDay(day.id)), historyNote(day, note));
  }));
  if (!visible.length) $('history-records').append(el('p', 'No hay días que coincidan con los filtros.'));
}
$('history-search').oninput = () => state && renderHistory();
$('history-module').onchange = $('history-status').onchange = () => state && renderHistory();
function renderMessages(history) {
  const list = $('messages');
  const keep = threadHistory.length <= history.length && threadHistory.every((row, index) =>
    row.role === history[index].role && row.content === history[index].content && row.created === history[index].created);
  const start = keep && threadHistory.length ? threadHistory.length : 0;
  if (!start) list.replaceChildren();
  threadHistory = history;
  list.append(...history.slice(start).map(row => box('article', 'card msg ' + row.role,
    el('p', row.role === 'user' ? 'Tú' : 'Asistente Riwi', 'message-role'),
    ...RiwiChatBlocks.split(row.content).map(block => RiwiChatBlocks.renderBlock(block, status)))));
  chatControls();
}
const connectWithKey = 'Pega la clave en este formulario, confirma el uso de tu cuota y pulsa Conectar. Envía una pregunta nueva para probar.';
const modelOptions = {
  groq: ['openai/gpt-oss-20b', [
    ['Crea una clave en Groq Console y mantén tu cuenta en el plan gratuito.', 'https://console.groq.com/keys'],
    'Usa openai/gpt-oss-20b o escribe otro modelo disponible en tu cuenta.', connectWithKey,
  ]],
  gemini: ['gemini-3.8-flash', [
    ['Crea una clave en Google AI Studio.', 'https://aistudio.google.com/apikey'],
    'Escribe el ID de un modelo disponible en tu proyecto de AI Studio.', connectWithKey,
  ]],
  'google-cloud': ['gemini-3.5-flash-lite', [
    ['Abre un proyecto de Google Cloud con la API de Vertex AI habilitada.', 'https://console.cloud.google.com/'],
    'Escribe el ID del proyecto y un modelo disponible en él.',
    'Confirma el uso de tu cuota, pulsa Continuar con Google y elige una cuenta con acceso al proyecto. Si falta configurar OAuth, avisa al administrador del tablero.',
  ]],
  openai: ['', [
    ['Crea una clave de la API de OpenAI en tu proyecto.', 'https://platform.openai.com/api-keys'],
    'Escribe el ID de un modelo disponible en tu proyecto.', connectWithKey,
  ]],
  claude: ['', [
    ['Crea una clave en Claude Console dentro de tu workspace.', 'https://platform.claude.com/settings/keys'],
    'Escribe el ID de un modelo disponible en ese workspace.', connectWithKey,
  ]],
  ollama: ['qwen3.5:4b', [
    'En el PC donde abriste el tablero, abre Ollama. Si el modelo falta en ollama list, ejecuta ollama pull qwen3.5:4b.',
    { label: 'Sal de Ollama, pega estas líneas en PowerShell y deja la terminal abierta.',
      command: `$env:OLLAMA_ORIGINS = '${location.origin}'\n$env:OLLAMA_HOST = '127.0.0.1:11434'\nollama serve` },
    'Escribe qwen3.5:4b, pulsa Conectar y concede el acceso local si el navegador lo pide. Envía una pregunta nueva para probar.',
  ]],
  agent: ['', [
    'Arranca el agente en este equipo con una API compatible con /v1/chat/completions en 127.0.0.1.',
    `Permite el origen ${location.origin} en la configuración CORS del agente.`,
    'Escribe el ID y el puerto que indica el agente, pulsa Conectar y envía una pregunta nueva.',
  ]],
};
const localProvider = provider => provider === 'ollama' || provider === 'agent';
let connectionStatusTimer;
function connectionStatus(message, error = false) {
  clearTimeout(connectionStatusTimer);
  $('connection-status').textContent = message;
  $('connection-status').toggleAttribute('data-error', error);
  if (message) connectionStatusTimer = setTimeout(() => connectionStatus(''), 5000);
}
function updateConnectionForm() {
  const provider = $('provider').value;
  const [model, steps] = modelOptions[provider];
  const local = localProvider(provider);
  $('model').placeholder = model || 'Nombre exacto del modelo';
  $('provider-steps').replaceChildren(...steps.map(step => {
    if (typeof step === 'string') return el('li', step);
    if (step.command) return box('li', '', step.label, box('pre', 'provider-command', el('code', step.command)));
    return box('li', '', link(...step));
  }));
  $('project-field').hidden = provider !== 'google-cloud';
  $('project').required = provider === 'google-cloud';
  $('credential-field').hidden = local || provider === 'google-cloud';
  $('credential').required = !$('credential-field').hidden;
  $('credential').value = '';
  $('port-field').hidden = !local || provider === 'ollama';
  $('local-port').placeholder = '1234';
  $('usage-field').hidden = local;
  $('usage-consent').required = !local;
  $('usage-consent').checked = false;
  $('connect-model').textContent = provider === 'google-cloud' ? 'Continuar con Google' : 'Conectar';
}
function chatControls() {
  const ready = Boolean(connection || state?.chatReady);
  $('send').disabled = !ready || threadRevision === undefined || chatPending;
  $('cancel-chat').hidden = !ollamaRequest;
  $('delete-chat').hidden = !threadHistory.length && !focus?.chat;
  $('delete-chat').disabled = chatPending;
  $('disconnect-model').hidden = !connection && !googlePending;
  $('active-model').textContent = connection ? `Modelo activo · ${connection.model}`
    : state?.chatReady ? 'Modelo activo · Ollama del servidor' : 'Conecta un modelo para enviar preguntas.';
}
function connect(modelConnection) {
  connection = modelConnection;
  $('chat-connection').open = false;
  connectionStatus('Seleccionado para este chat · ' + modelConnection.model + '.');
  chatControls();
}

const localRequestOptions = { redirect: 'error', credentials: 'omit', targetAddressSpace: 'loopback' };
async function checkOllama(model, signal) {
  let tags;
  const probeTimeout = AbortSignal.timeout(10000);
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      ...localRequestOptions, signal: signal ? AbortSignal.any([signal, probeTimeout]) : probeTimeout,
    });
    if (response.ok) tags = await response.json();
  } catch {
    // A refused connection, CORS rejection and denied loopback access can look alike in fetch.
  }
  if (!tags) throw new Error('El navegador no pudo acceder a Ollama. Revisa que esté abierto, OLLAMA_ORIGINS y el permiso de red local.');
  if (!tags.models?.some(item => item.name === model && !item.remote_model && !item.remote_host)) {
    throw new Error('El modelo indicado debe estar descargado en Ollama.');
  }
}
function disconnect() {
  googlePending?.popup.close();
  googlePending = undefined;
  connection = undefined;
  $('credential').value = '';
  connectionStatus('Modelo desconectado.');
  chatControls();
}
function randomOAuthValue() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
async function startGoogle(modelConnection) {
  if (!state.googleOAuth) throw new Error('Falta configurar Google OAuth en el tablero.');
  googlePending?.popup.close();
  const popup = window.open('', 'riwi-google', 'popup,width=520,height=660');
  if (!popup) throw new Error('Permite la ventana emergente y vuelve a intentar.');
  const verifier = randomOAuthValue();
  const pending = { popup, verifier, nonce: randomOAuthValue(), modelConnection, expires: Date.now() + 300000 };
  googlePending = pending;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  if (googlePending !== pending) return;
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const query = new URLSearchParams({ client_id: state.googleOAuth, redirect_uri: location.origin + '/google-callback',
    response_type: 'code', scope: 'https://www.googleapis.com/auth/cloud-platform', access_type: 'online',
    prompt: 'select_account', state: pending.nonce, code_challenge: challenge, code_challenge_method: 'S256' });
  popup.location = 'https://accounts.google.com/o/oauth2/v2/auth?' + query;
  connectionStatus('Completa la autorización en Google.');
  chatControls();
}
window.addEventListener('message', async event => {
  const authorization = googlePending;
  if (!authorization || event.origin !== location.origin || event.source !== authorization.popup
    || event.data?.type !== 'riwi-google' || event.data.state !== authorization.nonce) return;
  try {
    if (!event.data.code || Date.now() >= authorization.expires) throw new Error('La autorización fue cancelada o venció.');
    const token = await api('/api/google/token', { code: event.data.code, verifier: authorization.verifier });
    if (googlePending === authorization) connect({ ...authorization.modelConnection, credential: token.accessToken,
      expires: Date.now() + Number(token.seconds) * 1000 });
  } catch (error) {
    if (googlePending === authorization) connectionStatus(error.message, true);
  } finally {
    if (googlePending === authorization) googlePending = undefined;
    chatControls();
  }
});
$('provider').onchange = updateConnectionForm;
$('disconnect-model').onclick = disconnect;
window.addEventListener('pagehide', () => {
  if (connection || googlePending || $('credential').value) disconnect();
});
$('model-form').onsubmit = async event => {
  event.preventDefault();
  const provider = $('provider').value;
  const model = $('model').value.trim();
  const project = $('project').value.trim();
  const credential = $('credential').value.trim();
  if (model.length > 120 || !/^[\w.:-]+(?:\/[\w.:-]+)?$/.test(model)) return connectionStatus('Escribe el nombre exacto del modelo o agente.', true);
  if (provider === 'google-cloud' && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
    return connectionStatus('Escribe un ID de proyecto de Google Cloud válido.', true);
  }
  disconnect();
  try {
    if (localProvider(provider)) {
      const port = provider === 'ollama' ? 11434 : Number($('local-port').value || 1234);
      if (provider === 'ollama') {
        $('connect-model').disabled = $('provider').disabled = true;
        connectionStatus('Comprobando Ollama…');
        await checkOllama(model);
      }
      connect({ provider, model, port });
    } else if (provider === 'google-cloud') {
      await startGoogle({ provider, model, project, allowCharges: true });
    } else if (/^[\x21-\x7e]{12,4096}$/.test(credential)) {
      connect({ provider, model, credential, allowCharges: true });
    } else {
      connectionStatus('Revisa tu clave de API.', true);
    }
  } catch (error) {
    disconnect();
    connectionStatus(error.message, true);
  } finally {
    $('connect-model').disabled = $('provider').disabled = false;
  }
};
updateConnectionForm();

async function askLocal(modelConnection, data, history, signal) {
  const { provider, port, model } = modelConnection;
  const base = `http://127.0.0.1:${port}`;
  const day = lesson(data.id);
  const [i, j] = data.step.split('-').map(Number);
  const quest = data.step && day.quests[i];
  const context = { course: state.track, module: moduleName(day.module), week: day.week, day: day.day,
    title: day.title, technology: day.technology, summary: day.summary,
    ...(quest ? { quest: quest[0], context: quest[1], instruction: quest[2][j], requirements: quest[3] } : {}),
    stepsDone: completed(day).count };
  const prompt = data.guide ? 'Guíame en este paso con un ejemplo y una prueba.' : data.message;
  const messages = [{ role: 'system', content: 'Ayuda con el ejercicio de Riwi en español. Explica los pasos con ejemplos pequeños y formas de comprobar el resultado.' },
    { role: 'user', content: JSON.stringify(context) }, ...history.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
    { role: 'user', content: prompt }];
  const ollama = provider === 'ollama';
  if (ollama) await checkOllama(model, signal);
  try {
    const response = await fetch(base + (ollama ? '/api/chat' : '/v1/chat/completions'), {
      ...localRequestOptions, signal: ollama ? signal : AbortSignal.timeout(90000),
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false,
        ...(ollama ? { think: false, options: { num_predict: data.guide ? 600 : 320 } } : { max_tokens: 1000 }) }) });
    if (!response.ok) throw new Error('El servicio local recibió la consulta y devolvió un error. Revisa el registro del modelo e inténtalo de nuevo.');
    const result = await response.json();
    const answer = (ollama ? result.message?.content : result.choices?.[0]?.message?.content)?.trim();
    if (!answer) throw new Error('El modelo local devolvió una respuesta vacía.');
    return answer.slice(0, 16000);
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('El modelo local tardó demasiado en responder. Intenta con una pregunta más corta.');
    if (error instanceof TypeError) throw new Error('Se perdió el acceso al servicio local. Revisa que esté abierto y que el navegador permita el acceso local.');
    throw error;
  }
}

const sameChat = (a, b) => a?.id === b.id && a.step === b.step && a.chat === b.chat;
let lastChat;
let savedChats = [];
let chatListLoad = 0;
function renderChatList() {
  const query = searchText($('chat-search').value);
  const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: state.zone });
  const rows = savedChats.flatMap(chat => {
    const day = lesson(chat.id);
    const context = day ? (chat.step ? cursorLabel(chat, day) : fullName(day)) : '';
    const title = chat.title || (chat.step ? 'Guía de ' + day?.title : day?.title) || 'Conversación';
    if (!searchText([title, context, day?.title].join(' ')).includes(query)) return [];
    const open = button(title, () => openChat(chat), 'secondary');
    if (sameChat(focus, chat)) open.setAttribute('aria-current', 'true');
    const field = el('input');
    field.value = title;
    field.maxLength = 100;
    field.required = true;
    const save = el('button', 'Guardar título');
    save.type = 'submit';
    const form = box('form', '', box('label', '', el('span', 'Título de la conversación'), field), save);
    const editor = details('Renombrar', form);
    form.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        const { title } = await api('/api/chat/rename', { ...chat, title: field.value });
        chat.title = title;
        if (sameChat(focus, chat)) {
          focus.title = title;
          $('chat-title').textContent = title;
        }
        renderChatList();
        status('Título guardado.');
      } catch (error) { status(error.message, true); }
      finally { save.disabled = false; }
    };
    const metadata = [context, chat.created && date.format(new Date(chat.created))].filter(Boolean).join(' · ');
    return [box('li', 'chat-list-item', box('div', '', open, el('small', metadata)), editor)];
  });
  $('chat-list').replaceChildren(...(rows.length ? rows : [el('li',
    query ? 'No hay conversaciones que coincidan con la búsqueda.' : 'Todavía no hay conversaciones guardadas.')]));
}
$('chat-search').oninput = () => state && renderChatList();
async function refreshChats() {
  const stamp = ++chatListLoad;
  try {
    const chats = await api('/api/chat/list');
    if (stamp !== chatListLoad) return;
    savedChats = chats;
    renderChatList();
  } catch (error) {
    if (stamp === chatListLoad) $('chat-list').replaceChildren(el('li', error.message));
  }
}
$('new-chat-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  const { id, step } = focus || { id: selected, step: '' };
  try {
    const chat = await api('/api/chat/new', { id, step, title: $('new-chat-title').value });
    form.reset();
    await openChat(chat);
    status('Conversación creada.');
  } catch (error) {
    status(error.message, true);
  } finally {
    submit.disabled = false;
  }
};
async function openChat(selection, guide) {
  const day = lesson(selection?.id);
  if (!day) return;
  const stamp = ++chatLoad;
  focus = selection;
  void refreshChats();
  const [i, j] = focus.step.split('-').map(Number);
  const quest = focus.step && day.quests[i];
  if (!sameChat(selection, lastChat || {})) $('question').value = '';
  lastChat = selection;
  $('chat-title').textContent = selection.title || (quest ? 'Guía paso a paso' : 'Chat Riwi');
  $('chat-context').replaceChildren(box('article', 'card', el('small', state.track),
    el('h3', quest ? cursorLabel(focus, day) : fullName(day)), el('p', quest ? quest[1] : day.summary),
    el('p', quest ? quest[2][j] : day.title), el('small', day.technology || 'Tecnología pendiente de verificar.'),
    ...(quest ? [button('Ver o generar guía de IA', () => sendChat({ ...selection, guide: true }), 'secondary'),
      button('Pedir más explicación', () => sendChat({ ...selection, message: 'Explícame este paso con más detalle y otro ejemplo.' }), 'secondary')] : []),
    box('div', 'row', openDay(day.id, focus.step),
      button('Chat general del día', () => openChat({ id: day.id, step: '' }, false), 'secondary'),
      ...(selected !== day.id ? [button('Chat del checklist seleccionado', () => openChat({ id: selected, step: '' }, false), 'secondary')] : [])),
    el('small', 'Puedes usar la guía del tablero o conectar un modelo para generar guías y conversar aquí.')));
  threadHistory = [];
  threadRevision = undefined;
  $('messages').replaceChildren(el('p', 'Cargando conversación…'));
  chatControls();
  try {
    const result = await api('/api/focus', selection);
    if (stamp !== chatLoad) return;
    if (result.title) $('chat-title').textContent = selection.title = result.title;
    threadRevision = result.revision ?? 0;
    renderMessages(result.history);
    if (quest && !selection.chat && (guide || !result.history.length)) await sendChat({ ...selection, guide: true, basic: true }, false);
  } catch (error) {
    if (stamp === chatLoad && selection.chat && error.status === 404) return openChat({ id: day.id, step: selection.step });
    if (stamp === chatLoad) status(error.message, true);
  }
}
async function sendChat(data, useConnection = true) {
  if (chatPending || threadRevision === undefined) return;
  data = { ...data, revision: threadRevision };
  const previousMessages = threadHistory;
  chatPending = true;
  const active = useConnection ? connection : undefined;
  const controller = active?.provider === 'ollama' || (!active && state.chatReady && !data.basic) ? new AbortController() : undefined;
  ollamaRequest = controller;
  chatControls();
  status('Preparando respuesta…');
  try {
    if (data.guide && useConnection) {
      const saved = await api('/api/chat', { ...data, lookup: true }, controller?.signal);
      if (saved) {
        if (sameChat(focus, data)) renderMessages(saved);
        status('Guía guardada cargada.');
        return;
      }
      if (!active && !state.chatReady) {
        $('chat-connection').open = true;
        throw new Error('Conecta un modelo para generar la primera guía de IA.');
      }
    }
    if (active?.expires && Date.now() >= active.expires - 5000) {
      disconnect();
      throw new Error('La sesión de Google venció. Vuelve a conectar.');
    }
    if (active && localProvider(active.provider)) data = { ...data, localAnswer: await askLocal(active, data, previousMessages, controller?.signal) };
    else if (active) data = { ...data, connection: active };
    const history = await api('/api/chat', data, controller?.signal);
    if (sameChat(focus, data)) {
      renderMessages(history);
      if (!data.guide) $('question').value = '';
    }
    if (!previousMessages.length) void refreshChats();
    status('Conversación guardada.');
  } catch (error) {
    if (controller?.signal.aborted) status('Respuesta cancelada.');
    else status(error.message, true);
  } finally {
    ollamaRequest = undefined;
    chatPending = false;
    chatControls();
  }
}
$('cancel-chat').onclick = () => ollamaRequest?.abort();
$('delete-chat').onclick = async () => {
  if (chatPending || (!threadHistory.length && !focus?.chat) || !window.confirm('¿Eliminar esta conversación y sus guías guardadas?')) return;
  const selection = focus;
  chatPending = true;
  chatControls();
  try {
    const result = await api('/api/chat/delete', selection);
    if (sameChat(focus, selection)) {
      threadRevision = result.revision;
      renderMessages([]);
      if (selection.chat) {
        chatPending = false;
        await openChat({ id: selection.id, step: '' });
      }
    }
    void refreshChats();
    status('Conversación eliminada.');
  } catch (error) {
    status(error.message, true);
  } finally {
    chatPending = false;
    chatControls();
  }
};
$('ask').onsubmit = event => {
  event.preventDefault();
  if (focus && (connection || state.chatReady)) sendChat({ ...focus, message: $('question').value });
};
$('attach-chat-file').onclick = () => $('chat-file').click();
$('chat-file').onchange = async event => {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = '';
  if (!file) return;
  const selection = focus;
  const field = $('question');
  try {
    if (file.size > field.maxLength * 4) throw new Error('El mensaje con el archivo debe tener hasta 4.000 caracteres.');
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('Elige un archivo de texto en UTF-8.'); }
    if (!content.trim() || content.includes('\0')) throw new Error('Elige un archivo de texto con contenido.');
    if (!sameChat(focus, selection)) return;
    const name = file.name.replace(/[\r\n]/g, ' ');
    const message = [field.value.trimEnd(), 'Archivo: ' + name, RiwiChatBlocks.wrap(content, name)]
      .filter(Boolean).join('\n\n');
    if (message.length > field.maxLength) throw new Error('El mensaje con el archivo debe tener hasta 4.000 caracteres.');
    field.value = message;
    field.focus();
  } catch (error) { status(error.message, true); }
};
function render() {
  const day = lesson(state.resume?.id ?? selected);
  const sidebar = $('sidebar-progress');
  const progress = day && completed(day);
  sidebar.hidden = !progress?.total;
  if (progress?.total) {
    const meter = el('progress');
    meter.setAttribute('aria-label', 'Avance del día');
    meter.max = progress.total;
    meter.value = progress.count;
    sidebar.replaceChildren(el('strong', 'Avance del día'), meter, el('small', `${progress.count} de ${progress.total} pasos`));
  }
  renderSources();
  renderCheck();
  renderCalendar();
  renderInbox();
  renderHistory();
}
async function refresh(initial) {
  if (pending || chatPending) return;
  try {
    const next = await api('/api/state');
    if (pending || chatPending) return;
    state = next;
    if (!selected) selected = state.resume?.id ?? state.lessons.at(-1)?.id;
    if (initial) {
      week = monday(state.today);
      focus = state.chatFocus;
      show('check');
    }
    if (initial || activeTab === 'inbox') render();
    if (initial) status('');
  } catch (error) {
    if (initial) {
      status(error.message, true);
      $('sources').replaceChildren(button('Volver a cargar', () => refresh(true), 'secondary'));
    }
  }
}
refresh(true);
setInterval(() => {
  if (state && activeTab === 'inbox' && !document.hidden) refresh(false);
}, 30000);

