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
    assert.equal((await second.snapshot(new Date('2026-11-24T13:15:00Z'))).notices.length, 1);
    store.close(); store = await openStore(path);
    assert.deepEqual((await store.forAccount('primera').snapshot()).notificationSchedule, { days: [1], time: '09:30' });
    assert.equal((await store.forAccount('primera').snapshot()).notices.length, 0);
    assert.equal((await store.forAccount('segunda').snapshot(new Date('2026-11-24T13:15:00Z'))).notices.length, 1);
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

test('avisos vencen exactamente a las 24 horas y se retira su contenido sin regenerarlos', async () => {
  const store = await openStore(':memory:');
  try {
    const first = store.forAccount('primera');
    const second = store.forAccount('segunda');
    const sent = new Date('2026-11-22T23:45:00Z');
    await first.makeNotice(sent);
    await second.makeNotice(new Date('2026-11-23T00:15:00Z'));
    await first.applyTicks(1, { '0-0': true });
    assert.equal((await first.snapshot(new Date('2026-11-23T23:44:59.999Z'))).notices.length, 1);
    const expired = await first.snapshot(new Date('2026-11-23T23:45:00Z'));
    assert.equal(expired.notices.length, 0);
    assert.equal(expired.checked.length, 1);
    assert.equal((await second.snapshot(new Date('2026-11-23T23:45:00Z'))).notices.length, 1);
    assert.equal((await store.db.execute('SELECT count(*) n FROM account_daily WHERE account=?', ['primera'])).rows[0].n, 0);
    assert.equal(await first.hasNotice('2026-11-22'), true);
    assert.equal(await first.makeNotice(sent), false);
  } finally { store.close(); }
});

test('cuenta antigua completa el nombre una sola vez y solo modifica su propio contacto', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'riwi-profile-'));
  const path = join(directory, 'test.sqlite');
  let store = await openStore(path);
  try {
    await store.db.execute('INSERT INTO accounts VALUES (?,?,?,?)', ['antigua', '9900000001', 'fixture', 'fixture']);
    await store.db.execute('INSERT INTO accounts VALUES (?,?,?,?)', ['otra', '9900000002', 'fixture', 'fixture']);
    const account = store.forAccount('antigua');
    assert.equal((await account.readProfile()).nameLocked, false);
    const profile = { fullName: 'Persona Ejemplo', email: 'ejemplo@example.test', phone: '3000000000', clan: 'Turing' };
    const race = await Promise.allSettled([account.saveProfile(profile), account.saveProfile({ ...profile, fullName: 'Otro Nombre' })]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(race.find(result => result.status === 'rejected').reason.status, 409);
    assert.equal((await account.saveProfile({ ...profile, phone: '3000000010', clan: 'Ubuntu', account: 'otra' })).phone, '3000000010');
    await assert.rejects(account.saveProfile({ ...profile, fullName: '' }), { status: 400 });
    assert.equal((await store.forAccount('otra').readProfile()).fullName, '');
    store.close(); store = await openStore(path);
    const saved = await store.forAccount('antigua').readProfile();
    assert.equal(saved.nameLocked, true);
    assert.equal(saved.fullName, profile.fullName);
    assert.equal(saved.phone, '3000000010');
    await assert.rejects(store.forAccount('antigua').saveProfile({ ...profile, fullName: 'Reemplazo' }), { status: 409 });
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
