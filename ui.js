const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('#sidebar-nav [data-tab]')];
for (const item of tabs) {
  item.setAttribute('aria-label', item.textContent.trim());
  item.title = item.textContent.trim();
}
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

let state, selected, focus, calendarDate, pending = false, chatPending = false, chatLoad = 0;
let connection, googlePending, threadHistory = [], threadRevision, ollamaRequest;
let activeTab = 'check';
let readThroughDate = '';
let mutationQueue = Promise.resolve();
$('edit-profile').onclick = async () => {
  const dialog = $('profile-dialog');
  try {
    const profile = await api('/api/auth/profile');
    const form = el('form');
    const fullName = field(form, 'Nombre completo', 'fullName', profile.fullName);
    fullName.minLength = 3;
    fullName.maxLength = 160;
    fullName.readOnly = profile.nameLocked;
    form.append(el('p', profile.nameLocked ? 'Tu nombre ya está registrado y no se puede modificar.' : 'Puedes guardar tu nombre una sola vez. Revísalo antes de confirmar.', 'muted'));
    const email = field(form, 'Correo personal', 'email', profile.email, { type: 'email' });
    email.maxLength = 254;
    let savedEmail = profile.email;
    const currentPassword = field(form, 'Contraseña actual (para cambiar el correo)', 'currentPassword', '', { type: 'password' });
    currentPassword.required = false;
    currentPassword.closest('label').hidden = true;
    email.oninput = () => {
      const changed = email.value.trim().toLowerCase() !== savedEmail;
      currentPassword.required = changed;
      currentPassword.closest('label').hidden = !changed;
    };
    const phone = field(form, 'Celular (opcional; puedes borrarlo)', 'phone', profile.phone, { type: 'tel' });
    phone.required = false;
    phone.minLength = 7;
    phone.maxLength = 24;
    const clan = field(form, 'Clan', 'clan', profile.clan, { choices: [['', 'Selecciona tu clan'],
      ...['Gosling', 'Nakamoto', 'Ritchie', 'Tesla', 'Turing', 'Ubuntu', 'Van Rossum'].map(value => [value, value])] });
    const documentField = field(form, 'Cédula (no se puede cambiar)', 'document', profile.document);
    documentField.readOnly = true;
    const message = el('p', '', 'status');
    message.setAttribute('role', 'status');
    const save = el('button', 'Guardar perfil');
    form.append(message, box('div', 'row', save, button('Cancelar', () => dialog.close(), 'secondary')));
    form.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      message.textContent = 'Guardando…';
      message.removeAttribute('data-error');
      try {
        const saved = await api('/api/auth/profile', { fullName: fullName.value, email: email.value, phone: phone.value, clan: clan.value, currentPassword: currentPassword.value });
        savedEmail = saved.email;
        currentPassword.value = '';
        currentPassword.required = false;
        currentPassword.closest('label').hidden = true;
        fullName.value = saved.fullName;
        fullName.readOnly = saved.nameLocked;
        state.profile = { fullName: saved.fullName, clan: saved.clan };
        state = await api('/api/state');
        renderCalendar();
        $('account-title').textContent = saved.fullName;
        $('clan-label').textContent = 'Clan ' + saved.clan;
        message.textContent = 'Perfil guardado. El nombre ya no se puede modificar.';
      } catch (error) {
        message.textContent = error.message;
        message.setAttribute('data-error', '');
      } finally { save.disabled = false; }
    };
    dialog.replaceChildren(box('div', 'row between', el('h2', 'Mi perfil'), button('Cerrar', () => dialog.close(), 'text-button')), form);
    $('account-title').parentElement.open = false;
    dialog.showModal();
    fullName.focus();
  } catch (error) { status(error.message, true); }
};
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

async function openPrivacySettings() {
  const dialog = $('privacy-dialog');
  try {
    const privacy = await api('/api/auth/privacy');
    const close = button('Cerrar', () => dialog.close(), 'secondary');
    const message = el('p', '', 'status'); message.setAttribute('role', 'status');
    const allow = el('input'); allow.type = 'checkbox'; allow.checked = privacy.externalAIAllowed;
    const accepted = el('input'); accepted.type = 'checkbox'; accepted.checked = privacy.accepted; accepted.required = true;
    const form = box('form', '', box('label', 'check', accepted, el('span', 'He leído el aviso y autorizo los datos necesarios de mi cuenta.')),
      box('label', 'check', allow, el('span', 'Permitir proveedores externos de IA. Si lo desmarco, solo usaré guías o modelos locales.')),
      el('button', 'Guardar privacidad'));
    form.onsubmit = async event => {
      event.preventDefault(); const save = form.querySelector('button'); save.disabled = true;
      try {
        state.privacy = await api('/api/auth/privacy', { externalAIAllowed: allow.checked, accepted: accepted.checked });
        if (!allow.checked && connection && connection.provider !== 'ollama') disconnect();
        message.textContent = 'Preferencia guardada. El chat no escribe texto libre en la base de datos.';
      } catch (error) { message.textContent = error.message; } finally { save.disabled = false; }
    };
    const verify = button(privacy.emailVerified ? 'Correo verificado' : 'Verificar mi correo', async () => {
      verify.disabled = true;
      try { await api('/api/auth/verify-email', {}); message.textContent = 'Revisa el correo guardado en tu perfil. El enlace vence en 15 minutos.'; }
      catch (error) { message.textContent = error.message; } finally { verify.disabled = !privacy.mailReady || privacy.emailVerified; }
    }, 'secondary');
    verify.disabled = !privacy.mailReady || privacy.emailVerified;
    const cleanup = box('form', '', el('h3', 'Eliminar textos históricos'),
      el('p', 'Las conversaciones y notas antiguas no se borran automáticamente. Puedes retirarlas sin perder las casillas.'));
    const cleanupConfirm = field(cleanup, 'Escribe BORRAR para confirmar', 'confirmation', ''); cleanupConfirm.required = true;
    cleanup.append(el('button', 'Eliminar textos anteriores', 'danger'));
    cleanup.onsubmit = async event => {
      event.preventDefault();
      try { await api('/api/auth/erase-history', { confirmation: cleanupConfirm.value }); renderMessages([]); message.textContent = 'Textos anteriores eliminados. El progreso se conserva.'; }
      catch (error) { message.textContent = error.message; }
    };
    const erase = box('form', '', el('h3', 'Eliminar mi cuenta'),
      el('p', state.canEdit ? 'Transfiere primero la administración para poder eliminar esta cuenta.' : 'Retira tu perfil, acceso y progreso de las tablas activas. Las fichas compartidas y las otras cuentas se conservan.'));
    if (!state.canEdit) {
      const password = field(erase, 'Contraseña actual', 'password', '', { type: 'password' }); password.required = true;
      const confirm = field(erase, 'Escribe ELIMINAR', 'confirmation', ''); confirm.required = true;
      erase.append(el('button', 'Eliminar mi cuenta', 'danger'));
      erase.onsubmit = async event => {
        event.preventDefault();
        try { await api('/api/auth/delete-account', { password: password.value, confirmation: confirm.value }); disconnect(); location.replace('/login'); }
        catch (error) { password.value = ''; message.textContent = error.message; }
      };
    }
    dialog.replaceChildren(box('div', 'row between', el('h2', 'Privacidad y seguridad'), close),
      link('Leer el aviso de privacidad ↗', '/privacy'),
      el('p', 'Los chats son temporales y las notas están desactivadas. El perfil y el progreso sí se conservan.'), form,
      el('h3', 'Correo y recuperación'), el('p', privacy.mailReady
        ? 'La recuperación utiliza solo el correo verificado de tu perfil.'
        : 'El servicio de correo aún no está configurado. La verificación y recuperación no están disponibles por ahora.'), verify, message, cleanup, erase);
    dialog.showModal();
  } catch (error) { status(error.message, true); }
}
$('privacy-settings').onclick = openPrivacySettings;
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
function show(tab, chatMode = '') {
  setInbox(false);
  activeTab = tab;
  const returnFocus = mobileMenu.matches && mobileMenuOpen && $('sidebar-nav').contains(document.activeElement);
  mobileMenuOpen = false;
  for (const item of tabs) {
    const current = item.dataset.tab === tab;
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
    $(item.dataset.tab).hidden = !current;
  }
  $('breadcrumb').textContent = tabs.find(item => item.dataset.tab === tab).textContent.trim();
  document.querySelectorAll('.mobile-nav button').forEach(item => {
    if (item.dataset.section === tab) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  $('sources').hidden = tab !== 'cards';
  updateMenu();
  if (returnFocus) {
    $(tab).tabIndex = -1;
    $(tab).focus({ preventScroll: true });
  }
  if (state && tab === 'chat') {
    setConnectionView(false);
    setChatListView(!chatMode);
    void openChat(focus || { id: selected, step: '' }, chatMode, Boolean(chatMode));
  }
  window.scrollTo(0, 0);
}
for (const tab of [...tabs, ...document.querySelectorAll('.mobile-nav button')]) {
  tab.onclick = () => state && show(tab.dataset.tab || tab.dataset.section);
}
function setInbox(open) {
  $('inbox').hidden = !open;
  $('inbox-toggle').setAttribute('aria-expanded', String(open));
}
$('inbox-toggle').onclick = () => {
  if (!state) return;
  const open = $('inbox').hidden;
  setInbox(open);
  if (open) refresh(false);
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('inbox').hidden && !$('delete-chat-dialog').open) {
    setInbox(false);
    $('inbox-toggle').focus();
  }
});
function select(id, step) {
  selected = id;
  if (step) {
    opened.set(id, new Set([Number(step.split('-')[0])]));
    selectedSteps.set(id, step);
  }
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
      if (next.selected) {
        selected = next.selected;
        selectedSteps.delete(selected);
      }
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
const selectedSteps = new Map();
function progressBar({total, count}, label) {
  const meter = el('progress');
  meter.max = total || 1;
  meter.value = count;
  meter.setAttribute('aria-label', label);
  return meter;
}
function progressPercent({total, count}) {
  return total ? Math.round(count / total * 100) : 0;
}
function coursePicker(d) {
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
  return picker;
}
function richText(value) {
  const node = el('div', null, 'lesson-document chat-markdown');
  node.innerHTML = RiwiChatBlocks.markdown.render(value || '');
  return node;
}
function renderCheck() {
  const d = lesson(selected);
  if (!d) return;
  const progress = completed(d);
  const cursor = state.resume;
  const scheduled = state.sessions.find(row => row.lesson === d.id);
  const title = progress.done ? 'Completaste tu ruta de hoy.' : progress.count ? '¡Vamos por ese siguiente paso!' : 'Tu primer paso empieza aquí.';
  const heading = box('div', 'row between page-heading', box('div', '',
    el('p', 'Mi aprendizaje', 'eyebrow'), el('h1', title),
    el('p', [fullName(d), scheduled && dateLabel(scheduled.date, true)].filter(Boolean).join(' / '), 'page-description')),
    button('Ver calendario ↗', () => show('calendar'), 'white-button'));
  const hero = box('article', 'card hero dashboard-hero',
    box('div', '', el('h2', d.title), el('p', d.technology || moduleName(d.module)),
      box('div', 'row', el('span', d.quests.length + ' actividades', 'pill'), el('span', progress.total + ' pasos', 'pill'))),
    box('div', 'dashboard-progress', el('strong', progressPercent(progress) + '%'),
      el('small', progress.count + ' de ' + progress.total + ' pasos completados'), progressBar(progress, 'Avance del día')));
  const allSteps = d.quests.flatMap((q, i) => q[2].map((_, j) => i + '-' + j));
  const firstPending = allSteps.find(key => !progress.marked.has(key));
  const step = selectedSteps.get(d.id) || (cursor?.id === d.id && cursor.step) || firstPending || allSteps[0];
  const [activity, stepIndex] = (step || '').split('-').map(Number);
  const guide = (mode = '') => {
    focus = { id: d.id, step };
    show('chat', mode);
  };
  const picker = box('div', 'route-controls', coursePicker(d));
  const controls = box('div', 'route-controls');
  if (cursor && cursor.id !== d.id) controls.append(button('Retomar mi avance', () => select(cursor.id, cursor.step), 'secondary'));
  const days = state.lessons.filter(day => day.module === d.module && day.week === d.week);
  if (days.some(day => completed(day).count > 0)) {
    controls.append(button('Desmarcar semana ' + d.week, () => {
      update('/api/week/reopen', { id: d.id }, next => {
        selected = next.selected;
        opened.delete(selected);
      }, 'Semana desmarcada. Retomarás desde su primer día con pasos.');
    }, 'secondary'));
  }
  const routeTitle = box('div', 'row between route-title', el('h2', 'Tu ruta de hoy'),
    el('span', progress.count ? '✓ Avance guardado' : 'Aún no has comenzado', 'pill success-pill'));
  const route = box('div', 'card activity-list');
  const openActivities = opened.get(d.id) || new Set();
  if (!d.quests.length) route.append(el('p', 'Pendiente de cargar las instrucciones de este día.'));
  d.quests.forEach(([questTitle, context, steps, meta], i) => {
    const ids = steps.map((_, j) => i + '-' + j);
    const count = ids.filter(key => progress.marked.has(key)).length;
    const label = box('summary', 'activity-heading', el('span', String(i + 1).padStart(2, '0'), 'pill'),
      el('strong', questTitle), el('small', count + ' de ' + ids.length + ' pasos'), el('span', '⌄', 'disclosure-mark'));
    const card = box('details', 'activity', label);
    card.open = openActivities.has(i) || (!opened.has(d.id) && i === activity);
    card.ontoggle = () => {
      if (!card.isConnected) return;
      if (card.open) openActivities.add(i);
      else openActivities.delete(i);
      opened.set(d.id, openActivities);
    };
    if (context) card.append(box('section', 'quest-meta activity-context',
      el('h3', 'Contexto del minirreto'), richText(context)));
    steps.forEach((task, j) => {
      const key = ids[j];
      const check = checkbox(task, progress.marked.has(key), false, value => setTicks(d.id, [key], value));
      check.lastElementChild.classList.add('sr-only');
      const selectStep = button(task, () => {
        selectedSteps.set(d.id, key);
        openActivities.add(i);
        opened.set(d.id, openActivities);
        renderCheck();
        if (mobileMenu.matches) $('step-detail').scrollIntoView({ block: 'nearest' });
        $('step-detail').querySelector('h2').focus({preventScroll: true});
      }, 'step-select');
      if (step === key) selectStep.setAttribute('aria-current', 'step');
      card.append(box('div', step === key ? 'step current' : 'step', check,
        box('div', '', selectStep, el('small', 'Paso ' + (j + 1) + (progress.marked.has(key) ? ' · Completado' : '')))));
    });
    if (meta) card.append(details('Requisitos y entrega',
      box('section', 'quest-meta', el('h3', 'Requisitos'), richText(meta.requirements)),
      box('section', 'quest-meta', el('h3', 'Criterios'), richText(meta.criteria)),
      box('section', 'quest-meta', el('h3', 'Entregable'), richText(meta.deliverable))));
    card.append(checkbox('Completar toda la actividad', count === ids.length, count > 0 && count < ids.length,
      value => setTicks(d.id, ids, value)));
    route.append(card);
  });
  if (allSteps.length) route.append(checkbox('Marcar día completo', progress.done, progress.count > 0 && !progress.done,
    value => setTicks(d.id, allSteps, value, true)));
  const quest = d.quests[activity];
  const detailTitle = el('h2', quest?.[2][stepIndex] || d.title);
  detailTitle.tabIndex = -1;
  const detail = box('aside', 'card step-detail', el('span', progress.count ? 'Estás aquí' : 'Empieza aquí', 'pill'),
    detailTitle, details('Consultar contexto del minirreto', richText(quest?.[1] || d.summary)));
  detail.id = 'step-detail';
  if (quest) detail.append(el('p', 'Apoyo para este paso', 'eyebrow'),
    box('div', 'step-actions', button('Pedir guía →', () => guide('basic')),
      button('Ver o generar guía de IA ↗', () => guide('saved'), 'secondary'),
      button('Pedir más explicación', () => guide('explain'), 'text-button')));
  detail.append(link('Ver ficha en Moodle ↗', d.url));
  $('check').replaceChildren(heading, picker, hero, routeTitle, box('div', 'dashboard-grid', route, detail), controls);
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
  const monthTitle = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(calendarDate + 'T12:00:00Z'));
  const first = calendarDate.slice(0, 7) + '-01';
  const month = new Date(first + 'T12:00:00Z');
  const shiftMonth = offsetMonths => {
    month.setUTCMonth(month.getUTCMonth() + offsetMonths);
    calendarDate = month.toISOString().slice(0, 10);
    renderCalendar();
  };
  const previous = button('‹', () => shiftMonth(-1), 'text-button');
  previous.setAttribute('aria-label', 'Mes anterior');
  const next = button('›', () => shiftMonth(1), 'text-button');
  next.setAttribute('aria-label', 'Mes siguiente');
  const header = box('div', 'row between page-heading',
    box('div', '', el('h1', 'Haz espacio para aprender.'), el('p', 'Calendario del clan · ' + monthTitle, 'page-description')));
  if (state.canEdit) {
    const create = sessionForm(null, calendarDate);
    create.classList.add('calendar-create');
    header.append(box('div', 'row', el('span', 'Cuenta titular', 'pill'), create));
  }
  const days = box('div', 'month-grid', ...['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => el('span', day, 'month-weekday')));
  const beginning = monday(first);
  const dateIndex = new Map();
  for (const session of state.sessions) {
    if (!dateIndex.has(session.date)) dateIndex.set(session.date, []);
    dateIndex.get(session.date).push(session);
  }
  for (let i = 0; i < 42; i++) {
    const date = offset(beginning, i);
    if (i >= 28 && i % 7 === 0 && date.slice(0, 7) > first.slice(0, 7)) break;
    if (!date.startsWith(first.slice(0, 7))) {
      days.append(el('span'));
      continue;
    }
    const day = button(String(Number(date.slice(8))), () => {
      calendarDate = date;
      renderCalendar();
      $('agenda-day').focus({preventScroll:true});
    }, 'calendar-day');
    day.setAttribute('aria-label', dateLabel(date, true));
    if (date === calendarDate) day.setAttribute('aria-current', 'date');
    day.append(...(dateIndex.get(date) || []).map(session => el('span', session.label || lesson(session.lesson)?.title || 'Actividad', 'calendar-event')));
    days.append(day);
  }
  const schedule = box('article', 'card month-card', box('div', 'row between',
    el('h2', monthTitle, 'month-title'), box('div', 'row', previous,
      button('Hoy', () => { calendarDate = state.today; renderCalendar(); }, 'text-button'), next)), days);
  const agendaTitle = el('h2', calendarDate === state.today ? 'Tu agenda de hoy' : 'Agenda del día');
  agendaTitle.id = 'agenda-day';
  agendaTitle.tabIndex = -1;
  const sessions = dateIndex.get(calendarDate) || [];
  const future = state.sessions.filter(session => session.date > calendarDate).slice(0, 3);
  const agenda = box('aside', 'card agenda-card', el('span', dateLabel(calendarDate), 'pill'), agendaTitle,
    ...(sessions.length ? sessions.map(s => sessionContent(s)) : [el('p', 'Sin programación verificada.', 'muted')]),
    ...(future.length ? [el('h3', 'Próximamente'), ...future.map(s => el('p', dateLabel(s.date) + ' · ' + (s.label || lesson(s.lesson)?.title || 'Actividad'), 'muted'))] : []));
  let official = $('calendar').querySelector('#official-agenda');
  if (official?.dataset.agenda !== state.links.agenda) {
    const wasOpen = official?.open ?? false;
    const frame = el('iframe', null, 'agenda-frame');
    const clanName = state.profile?.clan || 'Ritchie';
    frame.title = 'Agenda oficial del clan ' + clanName;
    frame.referrerPolicy = 'no-referrer';
    official = details('Ver agenda oficial de ' + clanName,
      box('p', '', link('Abrir agenda en otra pestaña ↗', state.links.agenda),
        ' · ', link('Genially oficial ↗', state.links.genially)), frame);
    official.id = 'official-agenda';
    official.dataset.agenda = state.links.agenda;
    official.ontoggle = () => { if (official.open && !frame.hasAttribute('src')) frame.src = state.links.agenda; };
    official.open = wasOpen;
    if (wasOpen) frame.src = state.links.agenda;
  }
  $('calendar').replaceChildren(header, el('p', state.canEdit ? 'Puedes editar este calendario. Los estudiantes lo consultan en modo de solo lectura.' : 'Calendario compartido · Hora de Colombia', 'provider-privacy'),
    box('div', 'calendar-layout', schedule, agenda), official);
}
function noticeDay(day, cursor) {
  const card = box('div', '', el('h4', fullName(day) + ' · ' + day.title), el('p', day.summary));
  if (cursor) card.append(el('p', 'Retoma aquí · ' + cursorLabel(cursor, day)));
  if (day.quests.length) {
    card.append(el('h4', 'Tus MiniRetos de hoy'));
    day.quests.forEach((q, i) => card.append(details('MiniReto ' + (i + 1) + ' · ' + q[0], richText(q[1]),
      box('ol', 'notice-list', ...q[2].map((task, index) => el('li', 'Paso ' + (index + 1) + ' · ' + task))))));
  } else card.append(el('p', 'Pasos pendientes de verificar.'));
  card.append(box('div', 'row', openDay(day.id, cursor?.step), link('Ver Moodle ↗', day.url)));
  return card;
}
function renderInbox() {
  const expires = notice => Date.parse(notice.created || notice.date + 'T05:00:00-05:00') + 86400000;
  const removeNotice = date => button('Eliminar aviso', () => update('/api/notifications', { dismissDate: date }, undefined, 'Aviso eliminado de tu buzón.'), 'danger');
  const records = state.notices.filter(notice => expires(notice) > Date.now()).map(notice => {
    const card = box('article', 'card', el('h3', dateLabel(notice.date, true)), el('small', notice.track),
      el('h4', 'Programado para el clan'));
    card.append(el('small', 'Se elimina el ' + new Intl.DateTimeFormat('es-CO', {
      timeZone: state.zone, dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(expires(notice)))));
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
    card.toggleAttribute('data-unread', notice.date > readThroughDate);
    card.dataset.expires = expires(notice);
    card.append(removeNotice(notice.date));
    return card;
  });
  for (const entry of state.legacyNotices.filter(entry => expires(entry) > Date.now())) {
    const day = lesson(entry.lesson);
    if (day) {
      const card = box('article', 'card', el('h3', dateLabel(entry.date, true)), el('small', 'Aviso de la Beta'), noticeDay(day));
      card.toggleAttribute('data-unread', entry.date > readThroughDate);
      card.dataset.expires = expires(entry);
      card.append(removeNotice(entry.date));
      records.push(card);
    }
  }
  const unread = records.some(card => card.hasAttribute('data-unread'));
  $('inbox-toggle').toggleAttribute('data-unread', unread);
  const close = button('Cerrar', () => { setInbox(false); $('inbox-toggle').focus(); }, 'text-button');
  const paused = state.notificationsPaused;
  const toggle = button(paused ? 'Reanudar avisos' : 'Pausar avisos', async () => {
    toggle.disabled = true;
    try {
      await update('/api/notifications', { paused: !paused }, undefined, paused ? 'Avisos reanudados.' : 'Avisos pausados.');
    } finally {
      toggle.disabled = false;
      if (!$('inbox').hidden) $('inbox-preferences')?.focus();
    }
  }, 'secondary');
  toggle.id = 'inbox-preferences';
  const preferences = box('div', 'row between', el('p', paused ? 'Avisos diarios pausados.' : 'Avisos diarios activos.'), toggle);
  const schedule = state.notificationSchedule;
  const scheduleForm = el('form');
  const choices = box('fieldset', 'notification-days', el('legend', 'Días para recibir avisos'));
  const dayInputs = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map((name, i) => {
    const option = checkbox(name, schedule.days.includes(i), false, () => {});
    choices.append(option);
    return option.querySelector('input');
  });
  const time = field(scheduleForm, 'Hora de Colombia', 'time', schedule.time, { type: 'time' });
  scheduleForm.prepend(choices);
  scheduleForm.append(el('button', 'Guardar programación'), el('p', 'Los avisos llegan a este buzón. Con el tablero abierto se revisan cada 30 segundos; si está cerrado, se generan en la siguiente apertura o ejecución del servidor.', 'muted'));
  scheduleForm.onsubmit = event => {
    event.preventDefault();
    update('/api/notifications', { days: dayInputs.flatMap((input, i) => input.checked ? [i] : []), time: time.value }, undefined, 'Programación de avisos guardada.');
  };
  $('inbox').replaceChildren(box('div', 'row between', el('h2', 'Buzón de notificaciones'), close), preferences,
    details('Personalizar días y hora', scheduleForm),
    ...(records.length || paused ? records : [el('p', 'Aún no hay avisos. Se guardarán según tu programación.')]));
  if (unread) $('inbox').append(button('Marcar todo como leído', () => {
    readThroughDate = [...state.notices, ...state.legacyNotices].map(notice => notice.date).sort().at(-1);
    renderInbox();
    $('inbox').querySelector('button').focus();
  }, 'text-button inbox-read'));
}
const searchText = value => value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
let importingChecklists = false;
function checklistFileImport() {
  const input = el('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.disabled = importingChecklists;
  input.setAttribute('aria-label', 'Importar fichas desde archivo');
  input.onchange = async () => {
    if (importingChecklists || !input.files[0]) return;
    let loaded = 0;
    try {
      const file = input.files[0];
      if (file.size > 1000000) throw new Error('El archivo debe ocupar menos de 1 MB.');
      const days = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (!Array.isArray(days) || !days.length || days.length > 50) throw new Error('Selecciona un archivo con entre 1 y 50 fichas.');
      const seen = new Set();
      for (const day of days) {
        if (!day || !state.modules.some(m => m.id === day.module)
          || !Number.isInteger(day.week) || !Number.isInteger(day.day)
          || typeof day.title !== 'string' || typeof day.summary !== 'string'
          || typeof day.technology !== 'string' || typeof day.url !== 'string'
          || !Array.isArray(day.quests) || !day.quests.length) throw new Error('El archivo contiene una ficha incompleta.');
        const key = [day.module, day.week, day.day].join('/');
        if (seen.has(key)) throw new Error('El archivo repite un día del curso.');
        seen.add(key);
      }
      importingChecklists = true;
      input.disabled = true;
      for (const day of days) {
        const previous = state.lessons.find(d => d.module === day.module && d.week === day.week && d.day === day.day);
        const ok = await update('/api/import', { ...day, id: previous?.id }, undefined,
          `Fichas guardadas: ${loaded + 1} de ${days.length}.`);
        if (!ok) return;
        loaded++;
      }
      status(`Importación completada: ${loaded} fichas guardadas en este tablero.`);
    } catch (error) {
      status(`${error.message} Fichas guardadas: ${loaded}.`, true);
    } finally {
      importingChecklists = false;
      renderCards();
    }
  };
  return box('div', 'card', el('h2', 'Importar fichas desde archivo'),
    el('p', 'Carga tus fichas privadas en este tablero. Las casillas y conversaciones se conservan; se rechazan cambios incompatibles con el progreso.'), input);
}
function renderCards() {
  const module = $('cards-module');
  const currentModule = module.value;
  module.replaceChildren(new Option('Todos los módulos', ''), ...state.modules.map(item => new Option(item.name, item.id)));
  module.value = currentModule;
  $('cards-role').textContent = state.canEdit ? 'Cuenta titular' : 'Estudiante · Solo lectura';
  const query = searchText($('cards-search').value);
  const cards = state.lessons.filter(day => day.quests.length && (!module.value || module.value === day.module)
    && searchText([fullName(day), day.title, day.summary, day.technology, ...day.quests.map(quest => quest[0])].join(' ')).includes(query));
  $('cards-list').replaceChildren(...cards.map(day => box('article', 'card resource-card',
    el('span', String(day.day).padStart(2, '0'), 'resource-number'), el('h2', day.title),
    el('p', fullName(day), 'eyebrow'), el('p', day.summary, 'muted'),
    box('div', 'row', link('Abrir ficha en Moodle ↗', day.url, 'button secondary'),
      button('Ver checklist', () => select(day.id), 'text-button')),
    ...(state.canEdit ? [lessonForm(day)] : []))));
  if (!cards.length) $('cards-list').append(el('p', 'No hay fichas que coincidan con los filtros.', 'muted'));
  if (state.canEdit) $('cards-list').prepend(box('section', 'card resource-admin',
    el('h2', 'Administrar fichas compartidas'),
    el('p', 'Lo que cargues aquí estará disponible para todas las cuentas. Cada persona conserva su propio checklist.'),
    details('Crear un día nuevo', lessonForm()), checklistFileImport()));
}
$('cards-search').oninput = $('cards-module').onchange = () => state && renderCards();
$('cards-clear').onclick = () => {
  $('cards-search').value = $('cards-module').value = '';
  if (state) renderCards();
};
let focusedHistoryDay;
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
  const visible = records.filter(({ day, note, label }) =>
    (!currentModule || day.module === currentModule) && (!filterStatus || label === filterStatus)
    && searchText(fullName(day) + ' ' + day.title + ' ' + note).includes(query));
  visible.sort((a, b) => (b.previous?.completed || '').localeCompare(a.previous?.completed || ''));
  const totals = visible.reduce((result, { progress }) => ({
    count: result.count + progress.count, total: result.total + progress.total,
  }), { count: 0, total: 0 });
  const summary = [
    ['Días encontrados', visible.length],
    ['Pasos completados', totals.count],
    ['Avance de los días filtrados', progressPercent(totals) + '%'],
  ];
  $('history-summary').replaceChildren(...summary.map(([label, value]) =>
    box('div', 'card', el('strong', value), el('small', label))));
  $('history-count').textContent = visible.length + ' de ' + records.length + ' días';
  const detail = visible.find(row => row.day.id === focusedHistoryDay) || visible[0];
  focusedHistoryDay = detail?.day.id;
  const dateFormat = new Intl.DateTimeFormat('es-CO', { timeZone: state.zone, dateStyle: 'long' });
  $('history-records').replaceChildren(el('h2', 'Días de estudio filtrados'), ...visible.map(({ day, progress, previous, label }) => {
    const selectRecord = button(day.title, () => {
      focusedHistoryDay = day.id;
      renderHistory();
      $('history-detail-title').focus({ preventScroll: !mobileMenu.matches });
    });
    if (day.id === focusedHistoryDay) selectRecord.setAttribute('aria-current', 'true');
    return box('article', 'card history-record',
      box('div', 'row between', el('small', fullName(day)), el('strong', label, 'history-state')),
      box('h3', '', selectRecord),
      ...(progress.total ? [progressBar(progress, 'Avance de ' + fullName(day)), el('small', progress.count + ' de ' + progress.total + ' pasos')] : []),
      ...(previous ? [el('small', previous.completed
        ? 'Primera finalización el ' + dateFormat.format(new Date(previous.completed))
        : 'Primera finalización sin fecha registrada')] : []));
  }));
  $('history-detail').hidden = !detail;
  if (!detail) {
    $('history-records').append(el('p', 'No hay días que coincidan con los filtros.'));
    return;
  }
  const title = el('h2', 'Nota privada del día');
  title.id = 'history-detail-title';
  title.tabIndex = -1;
  if (state.temporaryChat) {
    title.textContent = 'Tu progreso, sin notas personales';
    $('history-detail').replaceChildren(title, el('p', 'Las notas están desactivadas para no guardar texto libre en la base de datos.'), openDay(detail.day.id));
    return;
  }
  const editor = historyNote(detail.day, detail.note);
  editor.open = !detail.note || openNotes.has(detail.day.id);
  $('history-detail').replaceChildren(el('span', 'Solo para ti', 'pill'), title, el('p', detail.day.title, 'muted'),
    ...(detail.note ? [el('p', detail.note, 'history-note-text')] : []), editor,
    box('div', 'row history-actions', openDay(detail.day.id),
      ...(detail.note ? [button('Eliminar nota', () => update('/api/history/note', { id: detail.day.id, note: '' },
        () => historyDrafts.delete(detail.day.id), 'Nota eliminada.'), 'text-button')] : [])));
}
$('history-search').oninput = () => state && renderHistory();
$('history-module').onchange = $('history-status').onchange = () => state && renderHistory();
$('history-clear').onclick = () => {
  $('history-search').value = $('history-module').value = $('history-status').value = '';
  if (state) renderHistory();
};
function renderMessages(history) {
  const list = $('messages');
  const keep = threadHistory.length <= history.length && threadHistory.every((row, index) =>
    row.role === history[index].role && row.content === history[index].content && row.created === history[index].created);
  const start = keep && threadHistory.length ? threadHistory.length : 0;
  if (!start) list.replaceChildren();
  threadHistory = history;
  list.append(...history.slice(start).map(row => box('article', 'card msg ' + row.role,
    el('p', row.role === 'user' ? 'Tú' : 'Asistente Riwi', 'message-role'),
    RiwiChatBlocks.message(row.content, status))));
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
const providerLabels = {
  groq: 'Groq', openai: 'OpenAI API', claude: 'Claude', gemini: 'Gemini',
  'google-cloud': 'Google Cloud', ollama: 'Ollama', agent: 'Agente local',
};
function setConnectionView(open) {
  $('chat-heading').hidden = $('chat-layout').hidden = open;
  $('chat-connection').hidden = !open;
  if (open) $('back-to-chat').focus();
}
function setChatListView(open) {
  $('chat-layout').classList.toggle('chat-list-view', open);
}
$('show-connection').onclick = () => setConnectionView(true);
$('back-to-chat').onclick = $('close-connection').onclick = () => {
  setConnectionView(false);
  $('show-connection').focus();
};
$('show-chat-list').onclick = () => {
  setChatListView(true);
  $('start-chat').focus();
};
$('start-chat').onclick = () => {
  if (state?.temporaryChat) {
    $('new-chat-title').value = 'Conversación temporal';
    $('new-chat-form').requestSubmit();
    return;
  }
  const open = $('new-chat-form').hidden;
  $('new-chat-form').hidden = !open;
  $('start-chat').setAttribute('aria-expanded', String(open));
  if (open) $('new-chat-title').focus();
};
$('show-credential').onclick = () => {
  const visible = $('credential').type === 'password';
  $('credential').type = visible ? 'text' : 'password';
  $('show-credential').textContent = visible ? 'Ocultar' : 'Mostrar';
  $('show-credential').setAttribute('aria-pressed', String(visible));
};
$('provider-menu').replaceChildren(...Object.entries(providerLabels).map(([key, label]) => {
  const item = button(label, () => {
    if ($('connect-model').disabled) return;
    $('provider').value = key;
    updateConnectionForm();
  });
  item.dataset.provider = key;
  return item;
}));
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
  $('provider-heading').textContent = providerLabels[provider];
  Array.from($('provider-menu').children).forEach(item => {
    item.setAttribute('aria-pressed', String(item.dataset.provider === provider));
  });
  $('credential').type = 'password';
  $('show-credential').textContent = 'Mostrar';
  $('show-credential').setAttribute('aria-pressed', 'false');
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
  $('connect-model').textContent = provider === 'google-cloud' ? 'Continuar con Google →' : 'Comprobar conexión →';
}
function chatControls() {
  const ready = Boolean(connection || state?.chatReady);
  $('send').disabled = !ready || threadRevision === undefined || chatPending;
  $('cancel-chat').hidden = !ollamaRequest;
  $('chat-wait').hidden = !chatPending || deletingChat;
  $('show-connection').toggleAttribute('data-connected', ready);
  $('show-connection').textContent = connection ? '●  ' + providerLabels[connection.provider] + ' · ' + connection.model
    : ready ? '●  Ollama del servidor' : 'Conectar un modelo';
  $('delete-chat').hidden = !threadHistory.length && !focus?.chat;
  $('delete-chat').disabled = chatPending;
  $('disconnect-model').hidden = !connection && !googlePending;
  $('active-model').textContent = connection ? `Modelo activo · ${connection.model}`
    : state?.chatReady ? 'Modelo activo · Ollama del servidor' : 'Conecta un modelo para enviar preguntas.';
}
function connect(modelConnection) {
  connection = modelConnection;
  setConnectionView(false);
  $('show-connection').focus();
  status('Modelo conectado · ' + modelConnection.model + '.');
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
  if (provider !== 'ollama' && !state.privacy?.externalAIAllowed) {
    connectionStatus('El modo sin proveedores externos está activo. Puedes autorizar su uso en Mi cuenta → Privacidad y seguridad.', true);
    return;
  }
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
  const { chatTurns, lessonContext } = await import('/chat-context.mjs');
  const { profilePrivateValues, redactAIText } = await import('/ai-privacy.mjs');
  const privateValues = profilePrivateValues(await api('/api/auth/profile'));
  const context = lessonContext(day, { track: state.track, module: moduleName(day.module),
    step: data.step, stepsDone: completed(day).count });
  const prompt = data.guide ? 'Guíame en este paso con un ejemplo y una prueba.' : data.message;
  const { tutorRules } = await import('/tutor-rules.mjs');
  const messages = [{ role: 'system', content: redactAIText(tutorRules, privateValues, { health: false }) },
    ...chatTurns(context, history, prompt, privateValues)];
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
    return redactAIText(answer, privateValues).slice(0, 16000);
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
    const open = button(title, () => void openChat(chat), 'secondary');
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
    return [box('li', 'chat-list-item', box('div', '', open, el('small', metadata)), ...(state.temporaryChat ? [] : [editor]))];
  });
  $('chat-list').replaceChildren(...(rows.length ? rows : [el('li',
    query ? 'No hay conversaciones que coincidan con la búsqueda.' : 'Todavía no hay conversaciones temporales.')]));
  if (!query && !rows.length && mobileMenu.matches) $('chat-list').append(box('li', 'chat-list-item',
    box('div', '', button('Abrir chat del día', () => void openChat({ id: selected, step: '' })))));
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
    form.hidden = true;
    $('start-chat').setAttribute('aria-expanded', 'false');
    await openChat(chat);
    status('Conversación creada.');
  } catch (error) {
    status(error.message, true);
  } finally {
    submit.disabled = false;
  }
};
async function openChat(selection, guide, reveal = true) {
  const day = lesson(selection?.id);
  if (!day) return;
  if (reveal) setChatListView(false);
  const stamp = ++chatLoad;
  focus = selection;
  void refreshChats();
  const [i, j] = focus.step.split('-').map(Number);
  const quest = focus.step && day.quests[i];
  if (!sameChat(selection, lastChat || {})) $('question').value = '';
  lastChat = selection;
  $('chat-title').textContent = selection.title || (quest ? 'Guía paso a paso' : 'Chat Riwi');
  const context = details(quest ? cursorLabel(focus, day) : fullName(day), el('small', state.track),
    el('h3', quest ? cursorLabel(focus, day) : fullName(day)), richText(quest ? quest[1] : day.summary),
    el('p', quest ? quest[2][j] : day.title), el('small', day.technology || 'Tecnología pendiente de verificar.'),
    ...(quest ? [button('Ver o generar guía de IA', () => sendChat({ ...selection, guide: true }), 'secondary'),
      button('Pedir más explicación', () => sendChat({ ...selection, message: 'Explícame este paso con más detalle y otro ejemplo.' }), 'secondary')] : []),
    box('div', 'row', openDay(day.id, focus.step),
      button('Chat general del día', () => openChat({ id: day.id, step: '' }, false), 'secondary'),
      ...(selected !== day.id ? [button('Chat del checklist seleccionado', () => openChat({ id: selected, step: '' }, false), 'secondary')] : [])),
    el('small', 'Puedes usar la guía del tablero o conectar un modelo para generar guías y conversar aquí.'));
  context.classList.add('chat-context-details');
  context.open = Boolean(quest);
  $('chat-context').replaceChildren(context);
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
    if (quest && !selection.chat) {
      if (guide === 'saved') await sendChat({ ...selection, guide: true });
      else if (guide === 'explain') {
        if (!connection && !state.chatReady) setConnectionView(true);
        else await sendChat({ ...selection, message: 'Explícame este paso con más detalle y otro ejemplo.' });
      } else if (guide || !result.history.length) await sendChat({ ...selection, guide: true, basic: true }, false);
    }
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
  try {
    if (!data.guide) {
      const { assertAIQuestionSafe } = await import('/ai-privacy.mjs');
      assertAIQuestionSafe(data.message);
    }
    if (data.guide && useConnection) {
      const saved = await api('/api/chat', { ...data, lookup: true }, controller?.signal);
      if (saved) {
        if (sameChat(focus, data)) renderMessages(saved);
        status('Guía temporal cargada.');
        return;
      }
      if (!active && !state.chatReady) {
        if (sameChat(focus, data)) setConnectionView(true);
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
    status('Conversación temporal. No se guarda en la base de datos.');
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
let deletingChat = false;
const deleteDialog = $('delete-chat-dialog');
$('delete-chat').onclick = () => {
  if (chatPending || (!threadHistory.length && !focus?.chat)) return;
  deleteDialog.returnValue = '';
  deleteDialog.showModal();
};
deleteDialog.onclose = async () => {
  if (deleteDialog.returnValue !== 'delete' || chatPending) return;
  deletingChat = true;
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
    deletingChat = false;
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
    sidebar.replaceChildren(el('strong', 'Avance del día'), el('span', progressPercent(progress) + '%', 'progress-number'), meter, el('small', `${progress.count} de ${progress.total} pasos`));
  }
  $('account-title').textContent = state.profile?.fullName || (state.canEdit ? 'Cuenta titular' : 'Mi cuenta');
  $('clan-label').textContent = state.profile?.clan ? 'Clan ' + state.profile.clan : 'Clan Ritchie';
  $('sidebar-role').textContent = state.canEdit ? 'Cuenta titular · Medellín' : 'Estudiante · Medellín';
  renderSources();
  renderCards();
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
      calendarDate = state.today;
      focus = state.chatFocus;
      show('check');
    }
    if (initial) render();
    else if (!$('inbox').hidden) renderInbox();
    if (initial) status('');
  } catch (error) {
    if (initial) {
      status(error.message, true);
      $('sources').hidden = false;
      $('sources').replaceChildren(button('Volver a cargar', () => refresh(true), 'secondary'));
    }
  }
}
refresh(true);
setInterval(() => {
  for (const card of $('inbox').querySelectorAll('[data-expires]')) {
    if (Number(card.dataset.expires) <= Date.now()) card.remove();
  }
  if (state) $('inbox-toggle').toggleAttribute('data-unread', Boolean($('inbox').querySelector('[data-unread]')));
}, 1000);
setInterval(() => {
  if (state && !document.hidden) refresh(false);
}, 30000);

