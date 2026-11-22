export const MOODLE = 'https://moodle.riwi.io';
export const COURSE = MOODLE + '/course/view.php?id=137';
export const MY_COURSES = MOODLE + '/my/courses.php';
export const GENIALLY = 'https://view.genially.com/66da105683d3400c85f30f74';
export const AGENDA = 'https://teamlead.up.railway.app/agenda?clan=ritchie';
export const TRAYECTO = 'Trayecto 2: Algoritmia Avanzada, Análisis de Datos & Simulación';
export const ZONE = 'America/Bogota';
export const VERIFIED = '2026-11-14';
export const MODULES = [
  { id: 'algoritmia', name: 'Algoritmia 2', url: MOODLE + '/mod/page/view.php?id=7614' },
  { id: 'ia', name: 'IA Dev Tools', url: MOODLE + '/mod/page/view.php?id=7727' },
  { id: 'datos', name: 'Análisis de Datos', url: MOODLE + '/mod/page/view.php?id=7906' },
  { id: 'ingles', name: 'Inglés', url: MY_COURSES },
  { id: 'hse', name: 'Habilidades Socioemocionales (HSE)', url: MY_COURSES },
];

const agendaModules = new Map([
  ['desarrollo', 'algoritmia'], ['algoritmia', 'algoritmia'], ['algoritmia 2', 'algoritmia'],
  ['ingles', 'ingles'], ['hse', 'hse'], ['habilidades socioemocionales', 'hse'],
  ['ia', 'ia'], ['ia dev tools', 'ia'],
]);

export function agendaModule(label) {
  const key = label.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return MODULES.find(module => module.id === agendaModules.get(key));
}

const dayOne = [
  {
    requirements: 'Node.js LTS, Git/GitHub, arreglos de objetos, índices y length, módulos CommonJS y console.table.',
    criteria: 'El repositorio del ejercicio contiene los cinco archivos iniciales. El script funciona con los 12 registros originales. La bitácora documenta el diccionario y al menos tres casos borde, y hay un commit descriptivo.',
    deliverable: 'Enlace al repositorio del ejercicio con los datos, el script de exploración y la bitácora.',
  },
  {
    requirements: 'Funciones con parámetros y retorno, ciclos for...of, condicionales, trim(), toLowerCase() y module.exports. Usa ciclos manuales en este reto.',
    criteria: 'Las funciones reciben sus entradas por parámetro. Verifica el total esperado de 985.000 con la muestra y la normalización de «medellín ». Prueba el arreglo vacío sin NaN y registra al menos dos trazas.',
    deliverable: 'src/analitica.js con los indicadores hechos con ciclos y bitácora con pseudocódigo, trazas y casos borde.',
  },
  {
    requirements: 'map, filter, reduce con valor inicial, sort con comparador, slice, Object.entries y copia con propagación (...).',
    criteria: 'Cada par ciclo/método muestra OK. Hay exactamente cuatro ciudades normalizadas. El top 3 está ordenado por ingresos, ventas mantiene su orden y la bitácora explica las cinco operaciones con colecciones.',
    deliverable: 'Funciones de agrupación y ranking en analitica.js y verificar.js con todos los resultados en OK.',
  },
  {
    requirements: 'CommonJS, funciones puras, plantillas de texto, toLocaleString, console.log, console.table y depuración.',
    criteria: 'node src/reporte.js imprime cuatro secciones y maneja el día vacío. La bitácora documenta los dos errores con evidencia, el README explica la ejecución y hay un commit por minirreto.',
    deliverable: 'Enlace al repositorio del ejercicio v0.1 con datos.js, analitica.js, explorar.js, verificar.js, reporte.js, README y bitácora.',
  },
];

export function seedLesson(lesson, index) {
  if (index !== 0) return { ...lesson, module: 'algoritmia' };
  return { ...lesson, module: 'algoritmia', technology: 'JavaScript y Node.js', consulted: VERIFIED,
    quests: lesson.quests.map(([title, context, steps], i) => {
      const instructions = [...steps];
      if (i === 0) instructions[0] = 'Inicializa Git en cafe-origen-analitica y vincula el repositorio público del ejercicio en GitHub.';
      if (i === 1) instructions[2] = 'Implementa totalVendido, unidadesVendidas y ventaMayor con for...of. ventaMayor devuelve el registro completo.';
      if (i === 3) instructions[3] = 'Documenta síntoma, entrada, hipótesis, prueba, causa y corrección para cada error. Si ya lo evitaste, demuéstralo con una prueba.';
      return [title, context, instructions, dayOne[i]];
    }) };
}

export const RITCHIE_AGENDA = [
  ['2026-11-09', 'Desarrollo'], ['2026-11-10', 'IA'], ['2026-11-11', 'Desarrollo'],
  ['2026-11-12', 'Road to semi-senior'], ['2026-11-13', 'Desarrollo'],
  ['2026-11-16', 'Festivo', '06:00–14:00'], ['2026-11-17', 'Desarrollo'],
  ['2026-11-18', 'Desarrollo'], ['2026-11-19', 'IA + Road to semisenior'], ['2026-11-20', 'Desarrollo'],
];

