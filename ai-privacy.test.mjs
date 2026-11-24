import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profilePrivateValues, redactAIText, assertAIQuestionSafe } from './ai-privacy.mjs';
import { chatTurns, lessonContext } from './chat-context.mjs';
import { cloudRequest } from './providers.mjs';

const profile = { fullName: 'Mariela Ficticia', document: '9876543210', phone: '+57 300 123 4567',
  email: 'mariela@example.test', clan: 'Ubuntu', account: 'not-for-provider' };
const secrets = profilePrivateValues(profile);

test('mensajes de salud se bloquean antes del envío y contenido antiguo se omite por completo', () => {
  for (const text of ['Mi diagnóstico es una enfermedad', 'Paciente: Persona de prueba', 'Tengo diabetes', 'Información de salud']) {
    assert.throws(() => assertAIQuestionSafe(text), { status: 400 });
    assert.equal(redactAIText(text), '[contenido de salud omitido]');
    assert.throws(() => chatTurns({}, [], text), { status: 400 });
  }
  assert.doesNotThrow(() => assertAIQuestionSafe('Diagnosticar la complejidad de una función con ventas'));
  assert.doesNotThrow(() => assertAIQuestionSafe('Documenta síntoma, entrada, hipótesis y prueba para depurar'));
  const turns = chatTurns({}, [{ role: 'user', content: 'Mi historia clínica es privada' },
    { role: 'assistant', content: 'Entendido' }], 'Ayúdame con el ciclo');
  assert.ok(!JSON.stringify(turns).includes('historia clínica'));
});

test('datos del perfil y patrones sensibles se sustituyen sin enviar el perfil como contexto', () => {
  const values = [profile.fullName, 'Mariela', profile.document, profile.phone, profile.email,
    'tercero@example.test', '311-222-3344', '1234567890123456',
    'gsk_' + 'x'.repeat(40), 'postgres://usuario:clave@db.example.test/base',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcnVlYmEifQ.signature123',
    'api_key="valor-secreto-de-prueba"', 'password: clavePrivada123',
    '__Host-riwi_session=cookieFicticia123', 'Nombre completo: Otra Persona',
    'Dirección: Calle ficticia de prueba', 'Me llamo Otro Nombre'];
  for (const value of values) {
    const clean = redactAIText(value, secrets);
    assert.notEqual(clean, value, value);
    assert.match(clean, /omitid/);
  }
  const text = 'const ventas = [2, 3];\nconsole.log(ventas.reduce((a, b) => a + b, 0));';
  assert.equal(redactAIText(text, secrets), text);
});

test('contexto, pregunta e historial antiguo se filtran sin modificar los originales', () => {
  const day = { title: 'Bucles', week: 1, day: 1, technology: 'JavaScript', summary: profile.email,
    quests: [['Ejercicio', `Hola ${profile.fullName}`, [`Llama al ${profile.phone}`], { requirements: profile.document }]] };
  const history = [{ role: 'user', content: `Soy ${profile.fullName}, ${profile.email}` },
    { role: 'assistant', content: `Tu documento es ${profile.document}` }];
  const original = structuredClone({ day, history });
  const context = lessonContext(day, { track: 'Riwi', module: 'Algoritmia', step: '0-0' });
  const turns = chatTurns(context, history, `Ayuda ${profile.phone}`, secrets);
  const serialized = JSON.stringify(turns);
  for (const value of [profile.fullName, profile.email, profile.document, profile.phone]) assert.ok(!serialized.includes(value));
  assert.deepEqual({ day, history }, original);
  assert.equal(JSON.parse(turns[0].content).quests.length, 1);
});

test('todos los proveedores filtran el cuerpo y dejan la clave solo en autenticación', () => {
  const credential = 'clave-api-ficticia-123';
  const turns = [{ role: 'user', content: `Me ayudas, ${profile.fullName}; ${profile.email}; ${profile.document}; ${credential}` }];
  for (const provider of ['groq', 'openai', 'claude', 'gemini', 'google-cloud']) {
    const request = cloudRequest({ provider, credential, model: 'modelo-prueba', project: 'proyecto-prueba' }, turns, secrets);
    const serialized = JSON.stringify(request.body);
    for (const value of [profile.fullName, profile.email, profile.document, credential]) assert.ok(!serialized.includes(value), provider);
    assert.ok(JSON.stringify(request.headers).includes(credential), 'El proveedor necesita la clave para autenticar la consulta');
    assert.ok(!serialized.includes(profile.account));
  }
});

test('el filtrado es idempotente y no vuelve a revelar secretos en el segundo paso', () => {
  const first = redactAIText(`Correo ${profile.email}; teléfono ${profile.phone}; ${profile.fullName}`, secrets);
  assert.equal(redactAIText(first, secrets), first);
  assert.equal(redactAIText('x'.repeat(200000)), 'x'.repeat(200000));
});
