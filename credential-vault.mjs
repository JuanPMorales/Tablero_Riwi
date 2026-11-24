import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const providers = new Set(['groq', 'openai', 'claude', 'gemini']);
const fault = (status, message) => Object.assign(new Error(message), { status });
const services = new WeakMap();
function key() {
  const value = Buffer.from(process.env.RIWI_CREDENTIAL_KEY || '', 'base64');
  if (value.length !== 32) throw fault(503, 'El guardado seguro de claves aún no está configurado. Puedes conectar solo durante esta sesión.');
  return value;
}
export function credentialVault(db) {
  if (services.has(db)) return services.get(db);
  const ready = db.schema(`CREATE TABLE IF NOT EXISTS account_ai_connections (
    account TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
    nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, tag TEXT NOT NULL, updated INTEGER NOT NULL
  )`);
  const get = async account => (await db.execute('SELECT * FROM account_ai_connections WHERE account=?', [account])).rows[0];
  const aad = (account, provider, model) => Buffer.from(JSON.stringify(['riwi-credential-v1', account, provider, model]));
  async function metadata(account) {
    await ready;
    let configured = false; try { key(); configured = true; } catch { /* Never downgrade to plaintext storage. */ }
    const row = await get(account);
    return { configured, saved: Boolean(row), ...(row ? { provider: row.provider, model: row.model } : {}) };
  }
  async function save(account, connection) {
    await ready;
    const { provider, model, credential } = connection;
    if (!providers.has(provider) || typeof model !== 'string' || model.length > 120 || !/^[\w.:-]+(?:\/[\w.:-]+)?$/.test(model)
      || typeof credential !== 'string' || !/^[\x21-\x7e]{12,4096}$/.test(credential)) throw fault(400, 'Revisa el proveedor, modelo y clave. Solo se guardan claves de API, no sesiones OAuth.');
    if (model === credential || /^(?:gsk_|sk-|eyJ)/.test(model)) throw fault(400, 'Escribe el identificador público del modelo, no una clave.');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), nonce);
    cipher.setAAD(aad(account, provider, model));
    const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
    await db.transaction(async () => {
      if (!(await db.execute('SELECT id FROM accounts WHERE id=?', [account])).rows.length) throw fault(401, 'La cuenta ya no está disponible.');
      await db.execute(`INSERT INTO account_ai_connections VALUES (?,?,?,?,?,?,?) ON CONFLICT(account) DO UPDATE SET
        provider=excluded.provider,model=excluded.model,nonce=excluded.nonce,ciphertext=excluded.ciphertext,tag=excluded.tag,updated=excluded.updated`,
      [account, provider, model, nonce.toString('base64'), ciphertext.toString('base64'), cipher.getAuthTag().toString('base64'), Date.now()]);
    });
    return metadata(account);
  }
  async function load(account) {
    await ready;
    const row = await get(account);
    if (!row) throw fault(404, 'No tienes una clave guardada. Conecta un proveedor primero.');
    const master = key();
    try {
      const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(row.nonce, 'base64'));
      decipher.setAAD(aad(account, row.provider, row.model));
      decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
      const credential = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
      return { provider: row.provider, model: row.model, credential, allowCharges: true };
    } catch { throw fault(503, 'No se pudo abrir la clave guardada. Revisa la configuración de cifrado o vuelve a conectar.'); }
  }
  async function forget(account) { await ready; await db.execute('DELETE FROM account_ai_connections WHERE account=?', [account]); return metadata(account); }
  const service = { ready, metadata, save, load, forget };
  services.set(db, service); return service;
}
