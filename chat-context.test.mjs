import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { chatTurns } from './chat-context.mjs';
import { tutorRules } from './tutor-rules.mjs';
import { cloudRequest } from './providers.mjs';

test('el historial enviado reduce consumo sin modificar conversaciones ni cortar código', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}\n` + 'x'.repeat(2400) }));
  const original = structuredClone(history);
  const context = { quest: { context: 'Enunciado completo', requirements: ['Conservar requisitos'] } };
  const turns = chatTurns(context, history, 'Pregunta actual');
  assert.deepEqual(history, original);
  assert.deepEqual(JSON.parse(turns[0].content), context);
  assert.match(turns[1].content, /omitieron/);
  assert.deepEqual(turns.slice(2, -1), history.slice(-4));
  assert.equal(turns.at(-1).content, 'Pregunta actual');
  assert.ok(JSON.stringify(turns).length < JSON.stringify(history).length);
});

test('un mensaje demasiado grande no se envía parcialmente ni deja respuestas huérfanas', () => {
  const history = [{ role: 'user', content: '```js\n' + 'x'.repeat(13000) + '\n```' },
    { role: 'assistant', content: 'Respuesta al código grande' }];
  const turns = chatTurns({}, history, 'Ayuda');
  assert.equal(turns.length, 3);
  assert.match(turns[1].content, /omitieron/);
  assert.equal(turns.at(-1).content, 'Ayuda');
});

test('una conversación corta conserva todos los mensajes sin aviso de omisión', () => {
  const history = [{ role: 'user', content: 'Mi intento' }, { role: 'assistant', content: 'Una pista' }];
  assert.deepEqual(chatTurns({}, history, 'Siguiente').slice(1, -1), history);
});

test('Groq recibe las reglas completas y el navegador puede cargarlas sin contexto privado', () => {
  const request = cloudRequest({ provider: 'groq', model: 'openai/gpt-oss-20b', credential: 'clave-ficticia-de-prueba' }, chatTurns({}, [], 'Ayuda'));
  assert.ok(request.body.messages[0].content.startsWith(tutorRules));
  assert.match(tutorRules, /NUNCA entregues la solución completa/);
  assert.match(tutorRules, /Esta excepción aplica solo a texto, nunca a código/);
  const source = readFileSync(new URL('./tutor-rules.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env/);
  const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  assert.ok(config.functions['api/*.js'].includeFiles.includes('mjs'));
  for (const path of ['/tutor-rules.mjs', '/chat-context.mjs']) {
    assert.ok(config.rewrites.some(rule => rule.source === path));
  }
});
