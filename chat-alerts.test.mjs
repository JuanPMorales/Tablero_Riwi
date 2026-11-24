import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const browser = {};
for (const path of ['./node_modules/markdown-it/dist/browser/markdown-it.umd.min.js',
  './node_modules/@highlightjs/cdn-assets/highlight.min.js', './chat-blocks.js']) {
  runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), browser);
}
const { responsePresentation } = browser.RiwiChatBlocks;

test('las restricciones y errores etiquetados se presentan como aviso sin mostrar la etiqueta técnica', () => {
  const restricted = responsePresentation('Respuesta de IA\n\n[RESTRINGIDO] Ese tema no corresponde al ejercicio.');
  assert.equal(restricted.alert, true);
  assert.equal(restricted.label, 'Solicitud restringida');
  assert.equal(restricted.content, 'Ese tema no corresponde al ejercicio.');
  const failure = responsePresentation('[ERROR] No se pudo consultar al proveedor.');
  assert.equal(failure.alert, true);
  assert.equal(failure.label, 'No se pudo completar');
  assert.equal(failure.content, 'No se pudo consultar al proveedor.');
  const hidden = responsePresentation('[contenido de salud omitido]');
  assert.equal(hidden.alert, true);
  assert.match(hidden.content, /proteger información sensible/);
});

test('reconoce rechazos anteriores sin confundir explicaciones normales sobre errores o código', () => {
  assert.equal(responsePresentation('Respuesta de IA\n\nNo puedo ayudarte con esa solicitud. Volvamos al ejercicio.').alert, true);
  assert.equal(responsePresentation('Lo siento, no puedo proporcionar instrucciones para eso.').alert, true);
  for (const text of ['El error ocurre porque la variable no está definida. Revisa su nombre.',
    'No puedo ejecutar tu código aquí, pero puedes probar esta entrada.',
    '```js\nconsole.log("No puedo ayudarte con esa solicitud");\n```',
    'El índice queda fuera del alcance de esta variable.', 'Vamos a revisar tu función con una pista.']) {
    assert.equal(responsePresentation(text).alert, false, text);
    assert.equal(responsePresentation(text).content, text);
  }
});

test('el rechazo de la captura aparece como error aunque no tenga la etiqueta nueva', () => {
  for (const prefix of ['', 'Respuesta de IA\n\n']) {
    const text = prefix + 'Lo siento, pero no puedo ayudar con eso.\nPodemos continuar con tu minirreto.';
    const presentation = responsePresentation(text);
    assert.equal(presentation.alert, true);
    assert.equal(presentation.label, 'Solicitud restringida');
    assert.equal(presentation.content, text);
  }
  assert.equal(responsePresentation('Entiendo tu pregunta, pero no puedo ayudar con eso.').alert, true);
  assert.equal(responsePresentation('El error dice: "Lo siento, pero no puedo ayudar con eso". Revisa el texto que imprime tu función.').alert, false);
});
