// Runs locally in the browser or server. Never serialize privateValues to a provider.
export function profilePrivateValues(profile) {
  if (!profile) return [];
  return [profile.document, profile.email, profile.phone, profile.fullName,
    ...(profile.fullName || '').split(/\s+/u).filter(part => part.length >= 3)]
    .filter(value => typeof value === 'string' && value.trim());
}

export function redactAIText(value, privateValues = []) {
  let text = String(value ?? '');
  for (const secret of [...new Set(privateValues)].filter(value => typeof value === 'string' && value.trim())
    .sort((a, b) => b.length - a.length)) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'), '[dato privado omitido]');
  }
  return text
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g, '[clave privada omitida]')
    .replace(/\b(?:gsk_|sk-proj-|sk-ant-|sk-)[A-Za-z0-9_-]{16,}\b/g, '[credencial omitida]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token omitido]')
    .replace(/\b(?:libsql|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`<>]+/gi, '[conexión privada omitida]')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [credencial omitida]')
    .replace(/(?<![\w.-])((?:["']?)[\w.-]{0,64}(?:password|passwd|contrase[ñn]a|api[_-]?key|auth[_-]?token|secret|sesskey|cookie|session)[\w.-]{0,64}(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}\n]+)/gi, '$1[dato privado omitido]')
    .replace(/(?<![A-Z0-9.!#$%&'*+/=?^_`{|}~-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi, '[correo omitido]')
    .replace(/(?:\+?\d[\d ().-]{3,}\d)/g, number => {
      const digits = number.replace(/\D/g, '').length;
      return digits >= 5 && digits <= 24 ? '[número privado omitido]' : number;
    })
    .replace(/((?:nombre(?: completo)?|mi nombre es|me llamo|direcci[oó]n|domicilio|documento|c[eé]dula|tel[eé]fono|celular|cuenta bancaria)\s*[:=]\s*)[^\n;]+/gi, '$1[dato personal omitido]')
    .replace(/\b(?:me llamo|mi nombre es)\s+[\p{L}][\p{L} .'-]{2,100}/giu, '[presentación personal omitida]');
}

export function redactAIValue(value, privateValues = []) {
  if (typeof value === 'string') return redactAIText(value, privateValues);
  if (Array.isArray(value)) return value.map(item => redactAIValue(item, privateValues));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, redactAIValue(item, privateValues)]));
  return value;
}
