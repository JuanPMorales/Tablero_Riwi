import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { accountAuth, passwordRules } from './auth.mjs';
import { openStore } from './store.mjs';

test('registro valida perfil, contraseña y confirmación y conserva el acceso anterior', async () => {
  const store = await openStore(':memory:');
  const auth = accountAuth(store.db, { secure: true });
  const payload = { document: '9000000001', password: 'Clave123', confirmation: 'Clave123',
    fullName: 'Persona de prueba', email: 'persona@example.test', phone: '+57 300 000 0000', clan: 'Van Rossum' };
  const request = { headers: {} };
  const response = { setHeader(name, value) { this[name] = value; } };
  try {
    for (const password of ['abc1234', 'a'.repeat(73), '12345678', 'abcdefgh', ' Clave123', 'Clave123 ', 'Clave9000000001']) {
      assert.equal(passwordRules(password, payload.document).every(Boolean), false);
      await assert.rejects(auth.authenticate(request, response, { ...payload, password, confirmation: password }, true, 'test'), { status: 400 });
    }
    for (const invalid of [{ confirmation: 'Distinta123' }, { email: 'sin-correo' }, { phone: 'abc' }, { clan: 'Inventado' }, { fullName: '' }]) {
      await assert.rejects(auth.authenticate(request, response, { ...payload, ...invalid }, true, 'test'), { status: 400 });
    }
    await auth.authenticate(request, response, payload, true, 'test');
    const cookie = response['Set-Cookie'].split(';')[0];
    const id = await auth.session({ headers: { cookie } });
    assert.ok(id);
    assert.equal((await store.forAccount(id).snapshot()).profile.fullName, payload.fullName);
    assert.equal((await store.forAccount(id).snapshot()).profile.clan, 'Van Rossum');
    assert.equal((await store.forAccount('otra').snapshot()).profile, null);
    await auth.authenticate(request, response, { document: payload.document, password: payload.password }, false, 'test');
    assert.ok(response['Set-Cookie']);
    assert.equal(await store.contentOwner(), undefined, 'Registrarse no concede permisos de carga');
  } finally { store.close(); }
});

test('horario y eliminación de avisos persisten por cuenta sin regenerar lo eliminado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riwi-notices-'));
  const path = join(directory, 'test.sqlite');
  let store = await openStore(path);
  try {
    const first = store.forAccount('primera');
    const second = store.forAccount('segunda');
    await first.setNotificationSchedule({ days: [1], time: '09:30' });
    await second.setNotificationSchedule({ days: [2], time: '08:15' });
    assert.equal(await first.makeNotice(new Date('2026-11-23T14:29:00Z')), false);
    assert.equal(await first.makeNotice(new Date('2026-11-23T14:30:00Z')), true);
    assert.equal(await second.makeNotice(new Date('2026-11-23T14:30:00Z')), false);
    await first.dismissNotice('2026-11-23');
    assert.equal((await first.snapshot()).notices.length, 0);
    assert.equal(await first.makeNotice(new Date('2026-11-23T15:30:00Z')), false);
    assert.equal(await second.makeNotice(new Date('2026-11-24T13:15:00Z')), true);
    assert.equal((await second.snapshot()).notices.length, 1);
    store.close(); store = await openStore(path);
    assert.deepEqual((await store.forAccount('primera').snapshot()).notificationSchedule, { days: [1], time: '09:30' });
    assert.equal((await store.forAccount('primera').snapshot()).notices.length, 0);
    assert.equal((await store.forAccount('segunda').snapshot()).notices.length, 1);
    await store.forAccount('primera').setNotificationSchedule({ days: [], time: '00:00' });
    assert.equal(await store.forAccount('primera').makeNotice(new Date('2026-11-30T18:00:00Z')), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('las fichas compartidas se actualizan para todos y las casillas siguen siendo privadas', async () => {
  const store = await openStore(':memory:');
  try {
    const first = store.forAccount('primera');
    const second = store.forAccount('segunda');
    await first.applyTicks(1, { '0-0': true });
    const day = (await first.snapshot()).lessons[0];
    day.summary = 'Resumen compartido actualizado';
    day.quests[0][1] = 'Contexto compartido actualizado';
    await store.saveLesson(day.id, day);
    const other = await second.snapshot();
    assert.equal(other.lessons[0].summary, day.summary);
    assert.equal(other.lessons[0].quests[0][1], day.quests[0][1]);
    assert.equal(other.checked.length, 0);
    assert.equal((await first.snapshot()).checked.length, 1);
  } finally { store.close(); }
});
