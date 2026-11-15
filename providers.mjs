import { tutorPolicy } from './tutor-policy.mjs';

export function chatTurns(context, history, prompt) {
  return [
    { role: 'user', content: JSON.stringify(context) },
    ...history.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
    { role: 'user', content: prompt },
  ];
}

export function providerFault(status, message) {
  return Object.assign(new Error(message), { status });
}

export function cloudRequest(connection, turns) {
  const tutor = tutorPolicy;
  const { provider, model, project, credential } = connection;
  if (typeof credential !== 'string' || !/^[\x21-\x7e]{12,4096}$/.test(credential)
    || typeof model !== 'string' || model.length > 120 || !/^[\w.:-]+(?:\/[\w.:-]+)?$/.test(model)) {
    throw providerFault(400, 'Revisa el modelo y la credencial del proveedor.');
  }
  const bearer = { Authorization: `Bearer ${credential}` };
  if (provider === 'groq') return {
    url: 'https://api.groq.com/openai/v1/chat/completions', headers: bearer,
    body: { model, max_completion_tokens: 1200, messages: [{ role: 'system', content: tutor }, ...turns] },
    read: data => data.choices?.[0]?.message?.content,
  };
  if (provider === 'openai') return {
    url: 'https://api.openai.com/v1/responses', headers: bearer,
    body: { model, store: false, max_output_tokens: 1800, instructions: tutor, input: turns },
    read: data => data.output?.flatMap(item => (item.content || []).filter(part => part.type === 'output_text').map(part => part.text)).join('\n'),
  };
  if (provider === 'claude') return {
    url: 'https://api.anthropic.com/v1/messages', headers: { ...bearer, 'anthropic-version': '2023-06-01' },
    body: { model, max_tokens: 1200, system: tutor, messages: turns },
    read: data => data.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'),
  };
  if (provider !== 'gemini' && provider !== 'google-cloud') throw providerFault(400, 'Selecciona un proveedor compatible.');
  const cloud = provider === 'google-cloud';
  if (cloud && (typeof project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project))) {
    throw providerFault(400, 'Escribe el ID de tu proyecto de Google Cloud.');
  }
  const url = cloud ? `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/`
    : 'https://generativelanguage.googleapis.com/v1beta/models/';
  return {
    url: `${url}${encodeURIComponent(model)}:generateContent`, headers: cloud ? bearer : { 'x-goog-api-key': credential },
    body: { systemInstruction: { parts: [{ text: tutor }] }, generationConfig: { maxOutputTokens: 1600 },
      contents: turns.map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] })) },
    read: data => data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('\n'),
  };
}

export async function cloudAnswer(connection, turns) {
  const { url, headers, body, read } = cloudRequest(connection, turns);
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(24000),
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const message = {
        400: 'El proveedor rechazó la solicitud. Revisa el modelo y la configuración.',
        401: 'El proveedor rechazó la credencial o esta venció. Vuelve a conectar.',
        403: 'La cuenta no tiene acceso al modelo o al proyecto seleccionado.',
        404: 'El modelo o proyecto no está disponible para esta cuenta.',
        429: 'El proveedor alcanzó la cuota o el límite de solicitudes.',
      }[response.status] || 'El proveedor no respondió correctamente. Intenta de nuevo.';
      throw providerFault(502, message);
    }
    const answer = read(await response.json())?.trim();
    if (!answer) throw providerFault(502, 'El modelo devolvió una respuesta vacía.');
    return answer.replaceAll(connection.credential, '[credencial omitida]').slice(0, 16000);
  } catch (error) {
    if (error.status === 502) throw error;
    throw providerFault(502, 'No se pudo consultar al proveedor a tiempo. Intenta de nuevo.');
  }
}
