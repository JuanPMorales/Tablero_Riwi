import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { chatTurns, lessonContext } from './chat-context.mjs';
import { tutorRules } from './tutor-rules.mjs';
import { cloudRequest } from './providers.mjs';

const fullDay = { title: 'Día de prueba', week: 2, day: 3, technology: 'JavaScript', summary: 'Objetivo común',
  privateField: 'No enviar', quests: Array.from({ length: 4 }, (_, index) => [
    `Minirreto ${index + 1}`, `Contexto completo ${index + 1}`,
    [`Primer paso ${index + 1}`, `Segundo paso ${index + 1}`],
    { requirements: `Requisitos ${index + 1}`, criteria: 'Comprobar resultados', deliverable: 'Bitácora', privateField: 'No enviar' },
  ]) };

test('preguntar desde el minirreto 4 envía contextos y pasos de todo el día sin duplicarlos', () => {
  const context = lessonContext(fullDay, { track: 'Riwi', module: 'Algoritmia', step: '3-1', stepsDone: 2 });
  const request = cloudRequest({ provider: 'groq', model: 'openai/gpt-oss-20b', credential: 'clave-ficticia-de-prueba' },
    chatTurns(context, [], '¿Cómo se relaciona el minirreto 4 con el primero?'));
  const sent = JSON.parse(request.body.messages[1].content);
  assert.deepEqual(sent.selected, { quest: 4, step: 2 });
  assert.equal(sent.day.summary, fullDay.summary);
  assert.equal(sent.stepsDone, 2);
  assert.equal(sent.quests.length, 4);
  for (const [index, quest] of sent.quests.entries()) {
    assert.equal(quest.context, fullDay.quests[index][1]);
    assert.deepEqual(quest.steps, fullDay.quests[index][2]);
    assert.equal(quest.requirements, fullDay.quests[index][3].requirements);
    assert.equal(quest.criteria, 'Comprobar resultados');
    assert.equal(quest.deliverable, 'Bitácora');
  }
  assert.doesNotMatch(JSON.stringify(sent), /privateField|No enviar/);
  assert.equal(request.body.messages[1].content.split('Contexto completo 4').length - 1, 1);
});

test('el chat general también recibe todo el día y no inventa un paso seleccionado', () => {
  const context = lessonContext(fullDay, { track: 'Riwi', module: 'Algoritmia' });
  assert.equal(context.selected, null);
  assert.equal(context.quests.length, 4);
  assert.deepEqual(context.quests[3].steps, fullDay.quests[3][2]);
  const empty = lessonContext({ ...fullDay, quests: [] }, { track: 'Riwi', module: 'Algoritmia', step: '3-1' });
  assert.equal(empty.selected, null);
  assert.deepEqual(empty.quests, []);
});

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

test('un día extenso reduce el historial repetido conservando todo el contexto y la pregunta', () => {
  const context = lessonContext(fullDay, { track: 'Riwi', module: 'Algoritmia', step: '3-0' });
  context.quests[0].context = 'Enunciado extenso: ' + 'x'.repeat(19000);
  const history = Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `${index}:` + 'a'.repeat(800),
  }));
  const original = structuredClone(history);
  const question = 'Revisa cómo el minirreto 4 utiliza el primero';
  const turns = chatTurns(context, history, question);
  assert.deepEqual(JSON.parse(turns[0].content), context);
  assert.deepEqual(turns.slice(2, -1), history.slice(-2));
  assert.match(turns[1].content, /omitieron/);
  assert.equal(turns.at(-1).content, question);
  assert.deepEqual(history, original);
  const sentHistory = turns.slice(2, -1).reduce((total, message) => total + message.content.length, 0);
  assert.ok(sentHistory < history.reduce((total, message) => total + message.content.length, 0) / 2);
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
