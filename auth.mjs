import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const digest = value => createHash('sha256').update(value).digest();
const derive = promisify(scrypt);
const options = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const lifetime = 60 * 60 * 24 * 14;
const windowMs = 15 * 60 * 1000;
export const CLANS = ['Gosling', 'Nakamoto', 'Ritchie', 'Tesla', 'Turing', 'Ubuntu', 'Van Rossum'];
export function validateProfile(payload) {
  const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  if (fullName.length < 3 || fullName.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || (phone && (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) || !CLANS.includes(payload.clan)) {
    throw Object.assign(new Error('Completa tu nombre, correo y clan. Si incluyes celular, debe ser válido.'), { status: 400 });
  }
  return { fullName, email, phone, clan: payload.clan };
}
export function passwordRules(password, document) {
  return [typeof password === 'string' && password.length >= 8 && password.length <= 72,
    /\p{L}/u.test(password || ''), /[0-9]/.test(password || ''),
    typeof password === 'string' && password === password.trim(), typeof password === 'string' && Boolean(document) && !password.includes(document)];
}

export function accountAuth(db, { secure }) {
  const { execute, transaction } = db;
  const cookie = secure ? '__Host-riwi_session' : 'riwi_session';
  const get = async (sql, args) => (await execute(sql, args)).rows[0];
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const token = req => (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(cookie + '='))?.slice(cookie.length + 1);
  const setCookie = (res, value, age) => res.setHeader('Set-Cookie',
    `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  async function session(req) {
    const value = token(req);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) return null;
    const row = await get('SELECT account FROM logins WHERE token=? AND expires>?', [digest(value).toString('hex'), Date.now()]);
    return row?.account ?? null;
  }
  async function logout(req, res) {
    const value = token(req);
    if (value) await execute('DELETE FROM logins WHERE token=?', [digest(value).toString('hex')]);
    setCookie(res, '', 0);
  }
  async function limit(buckets) {
    const now = Date.now();
    const allowed = await transaction(async () => {
      for (const [key, max] of buckets) {
        const row = await get('SELECT attempts FROM auth_limits WHERE bucket=? AND expires>?', [key, now]);
        if (row?.attempts >= max) return false;
      }
      await execute('DELETE FROM auth_limits WHERE expires<=?', [now]);
      for (const [key] of buckets) {
        await execute(`INSERT INTO auth_limits VALUES (?,?,1)
          ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1`, [key, now + windowMs]);
      }
      return true;
    });
    if (!allowed) fail(429, 'Demasiados intentos. Espera unos minutos y vuelve a intentar.');
  }
  async function authenticate(req, res, payload, register, address) {
    const document = typeof payload.document === 'string' ? payload.document.trim() : '';
    const { password } = payload;
    if (!/^\d{5,12}$/.test(document) || typeof password !== 'string' || password.length > 128
      || password.length < 1) {
      fail(400, 'Ingresa una cédula de 5 a 12 dígitos y una contraseña válida.');
    }
    let profile;
    if (register) {
      if (!passwordRules(password, document).every(Boolean)) fail(400, 'La contraseña debe tener entre 8 y 72 caracteres, una letra, un número, no contener tu cédula ni espacios al inicio o al final.');
      if (payload.confirmation !== password) fail(400, 'Las contraseñas no coinciden.');
      const values = validateProfile(payload);
      profile = [values.fullName, values.email, values.phone, values.clan];
    }
    const addressKey = digest(address).toString('hex');
    const documentKey = digest(document).toString('hex');
    const buckets = register ? [[`register:${addressKey}`, 6]]
      : [[`login:${addressKey}`, 24], [`document:${documentKey}`, 8]];
    await limit(buckets);
    let id;
    let credentials;
    if (register) {
      id = randomUUID();
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64, options)).toString('hex');
      credentials = [id, document, salt, hash];
    } else {
      const account = await get('SELECT id,salt,hash FROM accounts WHERE document=?', [document]);
      const hash = await derive(password, account?.salt ?? '00000000000000000000000000000000', 64, options);
      if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) fail(401, 'Cédula o contraseña incorrecta.');
      id = account.id;
    }
    const value = randomBytes(32).toString('base64url');
    const now = Date.now();
    const previousToken = token(req);
    await transaction(async () => {
      if (credentials) {
        const result = await execute('INSERT OR IGNORE INTO accounts VALUES (?,?,?,?)', credentials);
        if (!result.changes) fail(409, 'Ya existe una cuenta con esa cédula.');
        await execute('INSERT INTO account_profiles VALUES (?,?,?,?,?)', [id, ...profile]);
      }
      await execute('DELETE FROM logins WHERE expires<=?', [now]);
      if (previousToken) await execute('DELETE FROM logins WHERE token=?', [digest(previousToken).toString('hex')]);
      await execute('INSERT INTO logins VALUES (?,?,?)', [digest(value).toString('hex'), id, now + lifetime * 1000]);
    });
    setCookie(res, value, lifetime);
  }
  async function confirmPassword(account, password) {
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) fail(401, 'Confirma tu contraseña actual para cambiar el correo.');
    await limit([[`sensitive:${digest(account).toString('hex')}`, 8]]);
    const row = await get('SELECT salt,hash FROM accounts WHERE id=?', [account]);
    const hash = await derive(password, row?.salt || '', 64, options);
    if (!row || !timingSafeEqual(hash, Buffer.from(row.hash, 'hex'))) fail(401, 'No se pudo confirmar la contraseña.');
  }
  return { session, logout, authenticate, confirmPassword };
}
