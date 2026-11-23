import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agendaForClan, calendarSessionsForClan } from './catalog.mjs';
import { CLANS, accountAuth } from './auth.mjs';
import { openStore } from './store.mjs';

test('cada clan usa su agenda oficial y los perfiles anteriores conservan el enlace de Ritchie', () => {
  const slugs = ['gosling', 'nakamoto', 'ritchie', 'tesla', 'turing', 'ubuntu', 'van-rossum'];
  CLANS.forEach((clan, index) => assert.equal(agendaForClan(clan),
    'https://teamlead.up.railway.app/agenda?clan=' + slugs[index]));
  assert.equal(agendaForClan(undefined), agendaForClan('Ritchie'));
  assert.equal(agendaForClan('https://example.invalid'), agendaForClan('Ritchie'));
});

test('las fechas de otro clan no se muestran ni se borran y las actividades generales se conservan', () => {
  const sessions = [
    { id: 1, source: agendaForClan('Ritchie') },
    { id: 2, source: agendaForClan('Nakamoto') },
    { id: 3, source: 'https://moodle.riwi.io/my/' },
  ];
  assert.deepEqual(calendarSessionsForClan(sessions, 'Nakamoto').map(item => item.id), [2, 3]);
  assert.deepEqual(calendarSessionsForClan(sessions, 'Ritchie').map(item => item.id), [1, 3]);
  assert.equal(sessions.length, 3);
});

test('cambiar clan persiste tras iniciar sesión y no cambia el perfil de otra cuenta', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  const base = { password: 'PruebaClan123!', confirmation: 'PruebaClan123!', fullName: 'Persona de Prueba',
    email: 'clan@example.test', phone: '3000000000', clan: 'Ritchie' };
  const response = () => ({ setHeader(name, value) { this[name] = value; } });
  const request = cookie => ({ headers: cookie ? { cookie } : {} });
  try {
    const first = response(), second = response();
    await auth.authenticate(request(), first, { ...base, document: '9000000201' }, true, 'clan-first');
    await auth.authenticate(request(), second, { ...base, document: '9000000202' }, true, 'clan-second');
    const id = await auth.session(request(first['Set-Cookie'].split(';')[0]));
    const other = await auth.session(request(second['Set-Cookie'].split(';')[0]));
    await store.forAccount(id).saveProfile({ ...base, clan: 'Nakamoto' });
    await auth.logout(request(first['Set-Cookie'].split(';')[0]), first);
    await auth.authenticate(request(), first, { ...base, document: '9000000201' }, false, 'clan-first');
    const relogged = await auth.session(request(first['Set-Cookie'].split(';')[0]));
    assert.equal((await store.forAccount(relogged).readProfile()).clan, 'Nakamoto');
    assert.equal((await store.forAccount(other).readProfile()).clan, 'Ritchie');
  } finally { store.close(); }
});
