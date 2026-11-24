import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { digest, passwordRules } from './auth.mjs';

export const PRIVACY_VERSION = '2026-11-24.2';
const derive = promisify(scrypt);
const hashOptions = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const services = new WeakMap();
const failure = (status, message) => Object.assign(new Error(message), { status });
export function privacyPolicy() {
  return { version: PRIVACY_VERSION, responsible: process.env.RIWI_PRIVACY_RESPONSIBLE || '',
    contact: process.env.RIWI_PRIVACY_CONTACT || '',
    mailReady: Boolean(process.env.RESEND_API_KEY && process.env.RIWI_MAIL_FROM) };
}

export function accountPrivacy(db, { sendMail = deliverMail, now = () => Date.now() } = {}) {
  if (sendMail === deliverMail && services.has(db)) return services.get(db);
  const ready = db.schema(`
    CREATE TABLE IF NOT EXISTS account_security (
      account TEXT PRIMARY KEY, verified_email TEXT NOT NULL DEFAULT '', external_ai INTEGER NOT NULL DEFAULT 0,
      privacy_version TEXT NOT NULL DEFAULT '', consent_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account_action_tokens (
      digest TEXT PRIMARY KEY, account TEXT NOT NULL, purpose TEXT NOT NULL, email TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS privacy_deletions (account_digest TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
  `);
  const get = async (sql, args) => (await db.execute(sql, args)).rows[0];
  async function profile(account) {
    return get('SELECT a.id,a.document,a.salt,a.hash,p.email FROM accounts a JOIN account_profiles p ON p.account=a.id WHERE a.id=?', [account]);
  }
  async function state(account) {
    await ready;
    await db.execute('DELETE FROM account_action_tokens WHERE expires<=?', [now()]);
    const row = await get('SELECT * FROM account_security WHERE account=?', [account]);
    const current = await profile(account);
    return { version: PRIVACY_VERSION, accepted: row?.privacy_version === PRIVACY_VERSION,
      externalAIAllowed: row?.external_ai === 1 && row?.privacy_version === PRIVACY_VERSION,
      emailVerified: Boolean(current?.email && row?.verified_email === current.email),
      mailReady: privacyPolicy().mailReady, temporaryChat: false };
  }
  async function consent(account, externalAIAllowed, accepted) {
    await ready;
    if (typeof externalAIAllowed !== 'boolean' || accepted !== true) throw failure(400, 'Lee y acepta el aviso de privacidad.');
    await db.transaction(async () => {
      if (!await profile(account)) throw failure(401, 'La cuenta ya no está disponible.');
      await db.execute(`INSERT INTO account_security(account,external_ai,privacy_version,consent_at) VALUES (?,?,?,?)
        ON CONFLICT(account) DO UPDATE SET external_ai=excluded.external_ai,privacy_version=excluded.privacy_version,consent_at=excluded.consent_at`,
      [account, Number(externalAIAllowed), PRIVACY_VERSION, now()]);
    });
    return state(account);
  }
  async function rate(key, maximum = 3) {
    await ready;
    const bucket = 'privacy:' + digest(key).toString('hex');
    await db.transaction(async () => {
      await db.execute('DELETE FROM auth_limits WHERE expires<=?', [now()]);
      const previous = await get('SELECT attempts,expires FROM auth_limits WHERE bucket=?', [bucket]);
      if (previous?.expires > now() && previous.attempts >= maximum) throw failure(429, 'Espera unos minutos antes de volver a intentarlo.');
      await db.execute(`INSERT INTO auth_limits VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET expires=excluded.expires,attempts=excluded.attempts`,
        [bucket, now() + 15 * 60000, previous?.expires > now() ? previous.attempts + 1 : 1]);
    });
  }
  async function issue(current, purpose, origin) {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = digest(raw).toString('hex');
    await db.transaction(async () => {
      const existing = await profile(current.id);
      if (!existing || existing.email !== current.email) throw failure(400, 'La cuenta o el correo cambiaron. Vuelve a intentarlo.');
      await db.execute('DELETE FROM account_action_tokens WHERE expires<=? OR (account=? AND purpose=?)', [now(), current.id, purpose]);
      await db.execute('INSERT INTO account_action_tokens VALUES (?,?,?,?,?)', [tokenHash, current.id, purpose, current.email, now() + 15 * 60000]);
    });
    try { await sendMail(current.email, purpose, `${origin}/access#token=${raw}&purpose=${purpose}`); }
    catch {
      await db.execute('DELETE FROM account_action_tokens WHERE digest=?', [tokenHash]);
      throw failure(503, 'No se pudo enviar el correo. Intenta más tarde.');
    }
  }
  async function requestVerification(account, origin) {
    await ready;
    if (sendMail === deliverMail && !privacyPolicy().mailReady) throw failure(503, 'El envío de correos aún no está configurado.');
    await rate('verify:' + account);
    const current = await profile(account);
    if (!current?.email) throw failure(400, 'Completa el correo del perfil.');
    await issue(current, 'verify', origin);
  }
  async function requestReset(document, email, address, origin) {
    await ready;
    if (sendMail === deliverMail && !privacyPolicy().mailReady) throw failure(503, 'La recuperación por correo aún no está configurada.');
    if (!/^\d{5,12}$/.test(document || '') || typeof email !== 'string' || email.length > 254) throw failure(400, 'Escribe la cédula y el correo del registro.');
    await rate('reset-ip:' + address, 5);
    await rate('reset-account:' + document);
    const current = await get('SELECT a.id,p.email FROM accounts a JOIN account_profiles p ON p.account=a.id JOIN account_security s ON s.account=a.id WHERE a.document=? AND p.email=? AND s.verified_email=p.email', [document, email.trim().toLowerCase()]);
    if (current) await issue(current, 'reset', origin).catch(() => {});
    // Same public response whether or not the identity exists or has verified email.
  }
  async function consume(token, purpose, payload = {}) {
    await ready;
    if (!/^[\w-]{43}$/.test(token || '') || !['verify', 'reset'].includes(purpose)) throw failure(400, 'El enlace no es válido o venció.');
    const tokenHash = digest(token).toString('hex');
    const before = await get('SELECT t.*,a.document,p.email AS current_email FROM account_action_tokens t JOIN accounts a ON a.id=t.account JOIN account_profiles p ON p.account=t.account WHERE t.digest=?', [tokenHash]);
    if (!before || before.expires <= now() || before.purpose !== purpose || before.email !== before.current_email) throw failure(400, 'El enlace no es válido o venció.');
    let salt, hash;
    if (purpose === 'reset') {
      if (payload.password !== payload.confirmation || !passwordRules(payload.password, before.document).every(Boolean)) throw failure(400, 'Revisa la contraseña y su confirmación.');
      salt = randomBytes(16).toString('hex');
      hash = (await derive(payload.password, salt, 64, hashOptions)).toString('hex');
    }
    await db.transaction(async () => {
      const current = await get('SELECT t.*,p.email AS current_email FROM account_action_tokens t JOIN accounts a ON a.id=t.account JOIN account_profiles p ON p.account=t.account WHERE t.digest=?', [tokenHash]);
      if (!current || current.expires <= now() || current.purpose !== purpose || current.email !== current.current_email) throw failure(400, 'El enlace no es válido o venció.');
      if (purpose === 'verify') await db.execute(`INSERT INTO account_security(account,verified_email) VALUES (?,?)
        ON CONFLICT(account) DO UPDATE SET verified_email=excluded.verified_email`, [current.account, current.email]);
      else {
        const security = await get('SELECT verified_email FROM account_security WHERE account=?', [current.account]);
        if (security?.verified_email !== current.email) throw failure(400, 'Verifica el correo antes de recuperar el acceso.');
        await db.execute('UPDATE accounts SET salt=?,hash=? WHERE id=?', [salt, hash, current.account]);
        await db.execute('DELETE FROM logins WHERE account=?', [current.account]);
      }
      await db.execute('DELETE FROM account_action_tokens WHERE account=?', [current.account]);
    });
    return before.account;
  }
  async function erase(account, password, confirmation, owner) {
    await ready;
    await rate('erase:' + account, 5);
    if (account === owner) throw failure(409, 'Antes de eliminar la cuenta administradora debes transferir la administración.');
    if (confirmation !== 'ELIMINAR' || typeof password !== 'string' || password.length > 128) throw failure(400, 'Confirma tu contraseña y escribe ELIMINAR.');
    const current = await profile(account);
    const hash = await derive(password, current?.salt || '', 64, hashOptions);
    if (!current || !timingSafeEqual(hash, Buffer.from(current.hash, 'hex'))) throw failure(401, 'No se pudo confirmar la contraseña.');
    await db.transaction(async () => {
      for (const table of ['account_ticks', 'account_completions', 'account_history_notes', 'account_messages', 'chat_revisions', 'account_threads', 'legacy_thread_titles', 'account_daily', 'account_notice_dismissals', 'logins', 'account_action_tokens', 'account_security', 'account_profiles']) {
        await db.execute(`DELETE FROM ${table} WHERE account=?`, [account]);
      }
      if (await get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_ai_connections'")) await db.execute('DELETE FROM account_ai_connections WHERE account=?', [account]);
      await db.execute('DELETE FROM settings WHERE substr(key,1,?)=?', [account.length + 1, account + ':']);
      await db.execute('DELETE FROM accounts WHERE id=?', [account]);
      await db.execute('INSERT OR REPLACE INTO privacy_deletions VALUES (?,?)', [digest(account).toString('hex'), now()]);
    });
  }
  const service = { state, consent, requestVerification, requestReset, consume, erase };
  if (sendMail === deliverMail) services.set(db, service);
  return service;
}

async function deliverMail(email, purpose, url) {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RIWI_MAIL_FROM, to: [email],
      subject: purpose === 'verify' ? 'Verifica tu correo de Tablero Riwi' : 'Recupera tu acceso a Tablero Riwi',
      text: `Solicitaste ${purpose === 'verify' ? 'verificar tu correo' : 'recuperar tu contraseña'} en Tablero Riwi. El enlace vence en 15 minutos y solo puede usarse una vez.\n\n${url}\n\nSi no lo solicitaste, ignora este mensaje.` }) });
  if (!response.ok) throw new Error('MAIL_DELIVERY_FAILED');
}
