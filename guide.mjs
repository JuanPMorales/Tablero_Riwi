const examples = [
  ['Crea dos ventas pequeñas y ejecuta el archivo de exploración antes de cargar la muestra completa.',
    "const ventas = [{ producto: 'Huila' }, { producto: 'Nariño' }];\nconsole.table(ventas);",
    'Comprueba que haya dos filas y que ventas[0].producto sea Huila. Después compara los 12 registros con la tabla de Moodle.'],
  ['Traza el acumulador con dos ventas. Escribe el valor antes y después de cada vuelta.',
    "let total = 0;\nfor (const venta of [{ cantidad: 2, precio: 3 }]) {\n  total += venta.cantidad * venta.precio;\n}",
    'Con la venta de ejemplo el acumulador debe quedar en 6. Prueba también el arreglo vacío y documenta el resultado.'],
  ['Usa reduce para sumar y filter para conservar las ventas de una ciudad. Normaliza cada ciudad con trim().toLowerCase() antes de comparar.',
    "const ventas = [{ cantidad: 2, precio: 3 }, { cantidad: 1, precio: 4 }];\nconst valorVenta = v => v.cantidad * v.precio;\nconst totalVendidoM = ventas.reduce((total, v) => total + valorVenta(v), 0);",
    'El total debe ser 10. Compara cada versión por método con la versión por ciclo usando la misma entrada. Con [] la suma debe ser 0.'],
  ['Integra una sección a la vez. Empieza con un día que no tenga registros y revisa el ticket promedio.',
    "const ticket = cantidadValidas > 0 ? total / cantidadValidas : 0;\nconsole.log(ticket.toLocaleString('es-CO'));",
    'Ejecuta node src/reporte.js para un día con ventas y otro sin ventas. Revisa las cuatro secciones y la ausencia de NaN y undefined.'],
];
const rankings = [
  examples[2],
  ['Usa los mismos datos para ambas funciones y muestra una línea por cada comparación.',
    "const iguales = totalVendido(datos) === totalVendidoM(datos);\nconsole.log('Total:', iguales ? 'OK' : 'DIFERENTE');",
    'Prueba con la muestra, una venta y un arreglo vacío. Cambia temporalmente uno de los resultados para verificar que tu script detecta una diferencia.'],
  ['Normaliza la ciudad antes de usarla como clave. Acumula el valor de la venta que corresponde a esa clave.',
    "const clave = venta.ciudad.trim().toLowerCase();\ntotales[clave] = (totales[clave] ?? 0) + valorVenta(venta);",
    'Prueba Bogotá y Bogotá con un espacio al final. Deben producir una sola clave. Con la muestra de Moodle deben salir cuatro ciudades.'],
  ['Usa el nombre del producto como clave y la cantidad de la venta como aporte a ese producto.',
    "unidades[venta.producto] = (unidades[venta.producto] ?? 0) + venta.cantidad;",
    'Dos ventas del mismo café con cantidades 2 y 3 deben dejar 5 unidades en una sola clave.'],
  ['Suma ingresos por producto, ordena los pares de mayor a menor y selecciona los primeros k.',
    "const pares = Object.entries({ Huila: 12, Nariño: 20 });\nconst top = [...pares].sort((a, b) => b[1] - a[1]).slice(0, 1);",
    'Para k = 1 el ejemplo conserva Nariño. Verifica que cambiar k cambie el tamaño y que el arreglo original de ventas mantenga su orden.'],
  ['Escribe en la bitácora una línea por cada operación que usa la función y deja una traza de dos ventas.',
    'Para totalPorCiudad recorro ventas, normalizo la ciudad y acumulo el importe en la clave de esa ciudad.',
    'Lee tu explicación siguiendo una venta a la vez y comprueba que la traza coincide con el resultado obtenido.'],
  ['Ejecuta el script de verificación, revisa los cambios de Git y crea el commit del minirreto.',
    'node src/verificar.js\ngit status',
    'Comprueba que todas las comparaciones muestren OK y que el commit aparezca en el repositorio del ejercicio.'],
];
export function offlineGuide(lesson, step) {
  const [i, j] = step.split('-').map(Number);
  const quest = lesson.quests[i];
  const task = quest[2][j];
  let sample;
  if (lesson.id === 1 && lesson.technology === 'JavaScript y Node.js') {
    sample = i === 2 ? rankings[j] : j === 0 ? examples[i] : null;
  }
  return [
    'Qué debes hacer\n' + task,
    'Acciones\n1. Lee el paso y ubica la entrada o el archivo que pide.\n2. ' + (sample?.[0] || 'Separa las partes de este paso y completa primero la que puedas comprobar con una entrada pequeña.') + '\n3. Aplica el resultado a los datos del minirreto.',
    'Ejemplo sencillo\n' + (sample?.[1] || 'Prepara un caso mínimo con una sola entrada. Escribe primero su resultado esperado y conserva ese caso para repetir la prueba.'),
    'Cómo comprobarlo\n' + (sample?.[2] || quest[3]?.criteria || 'Compara tu salida con la esperada para el caso mínimo y contrástala con la ficha de Moodle.'),
  ].join('\n\n');
}

export async function localAnswer(model, turns, tutor, isGuide = false, signal) {
  const base = 'http://127.0.0.1:11434';
  const response = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok || !(await response.json()).models?.some(item => item.name === model && !item.remote_model && !item.remote_host)) {
    throw new Error('El modelo local configurado no está disponible.');
  }
  const result = await fetch(base + '/api/chat', {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false, options: { num_predict: isGuide ? 600 : 320, num_ctx: 8192 },
      messages: [{ role: 'system', content: tutor }, ...turns],
    }),
  });
  if (!result.ok) throw new Error('Ollama no pudo responder.');
  const answer = (await result.json()).message?.content?.trim();
  if (!answer) throw new Error('El modelo local devolvió una respuesta vacía.');
  return answer;
}

