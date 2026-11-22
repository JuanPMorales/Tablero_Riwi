# Tablero Riwi

Aplicación de estudio con fichas compartidas de Moodle, checklist individual, calendario, historial, buzón y tutor de IA. El contenido se guarda en Turso en producción y en SQLite al ejecutar localmente. Una cuenta nueva comienza en el primer paso, sin casillas marcadas.

## Páginas y funciones

| Página | Qué puedes hacer |
|---|---|
| Mi tablero | Elegir módulo, semana y día; leer el contexto de cada minirreto; marcar pasos, actividades o el día completo; pedir una guía. |
| Fichas | Buscar y filtrar días, abrir la fuente oficial de Moodle o consultar su checklist. La cuenta administradora también carga y edita contenido. |
| Calendario | Consultar las sesiones y abrir el checklist vinculado. La cuenta administradora puede agregar, corregir y quitar fechas. |
| Historial | Consultar progreso por día, filtrar por módulo o estado y escribir notas privadas. |
| Chat Riwi | Pedir guías, conversar con un modelo conectado, crear y renombrar conversaciones, reutilizar guías guardadas y eliminar hilos. |
| Buzón | Consultar avisos, pausarlos o reanudarlos, elegir días y hora, marcar como leídos durante la sesión y eliminar avisos del buzón personal. |

Los contextos admiten párrafos, títulos, listas, tablas, código en línea y bloques de código con resaltado. En el panel del paso puedes desplegar el contexto sin repetirlo completo en pantalla. Los requisitos, criterios y entregables se muestran por separado.

## Registro e inicio de sesión

Para crear una cuenta se solicitan nombre completo, correo personal, celular, clan, cédula, contraseña y confirmación. Los clanes disponibles son Gosling, Nakamoto, Ritchie, Tesla, Turing, Ubuntu y Van Rossum.

La contraseña debe cumplir todas estas condiciones, verificadas tanto en el formulario como en el servidor:

- Entre 8 y 72 caracteres.
- Al menos una letra y un número.
- Sin espacios al inicio ni al final.
- No contener la cédula de la cuenta.
- Coincidir con la confirmación.

El formulario indica cuáles condiciones faltan. Para iniciar sesión solo se necesitan cédula y contraseña. Las cuentas anteriores conservan su contraseña y acceso; no se fuerza un nuevo registro. El sistema no verifica la identidad de la cédula, la propiedad del correo ni el celular mediante códigos.

Las contraseñas se verifican con un hash scrypt y sal aleatoria. Las sesiones utilizan cookies HttpOnly y SameSite y, en producción, Secure. El perfil se guarda en una tabla privada independiente. El nombre y clan mostrados corresponden a la cuenta conectada.

## Contenido compartido y permisos

Las fichas, sus días, temas, contextos, minirretos, pasos y enlaces pertenecen al catálogo compartido. Al guardar una ficha en Turso, las demás cuentas pueden consultarla al actualizar o volver a abrir la sección. No se necesita un push para cargar contenido.

Las casillas, el punto para retomar, las fechas de finalización, notas, avisos, preferencias y conversaciones son propios de cada cuenta. Marcar un paso no lo marca para otra persona. Desmarcar un día permite retomarlo; desmarcar una semana regresa al primer día con actividades de esa semana y módulo, sin borrar el progreso ajeno.

Solo la cuenta administradora configurada puede cargar o modificar fichas y calendario. Esta restricción también se aplica en la API: ocultar un botón no concede acceso al servidor. Registrarse no convierte a nadie en administrador.

La cuenta autorizada se configura de forma privada con la clave `content-owner-account` de la tabla `settings`, cuyo valor es el ID interno de la cuenta en `accounts`. Esta configuración tiene prioridad sobre `RIWI_OWNER_ACCOUNT_ID`, usado como alternativa para una instalación nueva. No escribas cédulas reales ni IDs privados en este README o en archivos versionados.

Mi tablero no muestra formularios para editar ni añadir fichas a ninguna cuenta. La administración se realiza exclusivamente en Fichas. Los estudiantes solo ven las opciones de Moodle y checklist.

## Cargar un día desde Fichas

Con la cuenta administradora:

1. Abre Fichas y despliega Administrar fichas compartidas.
2. En Crear un día nuevo, completa módulo, semana, día, tema, tecnología, enlace oficial y resumen.
3. Añade los minirretos. Cada uno tiene título, contexto, pasos, requisitos, criterios y entregable.
4. Escribe un paso por línea y pulsa Guardar checklist.

También puedes elegir un archivo JSON en Importar fichas desde archivo. La importación comienza al seleccionar el archivo. Debe contener una lista de entre 1 y 50 días y ocupar menos de 1 MB. Ejemplo ilustrativo, que debes reemplazar por la ficha oficial correspondiente:

```json
[
  {
    "module": "algoritmia",
    "week": 5,
    "day": 1,
    "title": "Tema del día",
    "technology": "JavaScript y Node.js",
    "url": "https://moodle.riwi.io/mod/page/view.php?id=7614",
    "summary": "Qué se aprenderá durante el día.",
    "quests": [
      [
        "Título del minirreto",
        "## Contexto\n\nSituación que debe resolverse.\n\n```javascript\nconst total = 10;\nconsole.log(total);\n```",
        ["Crea el archivo.", "Implementa la solución.", "Comprueba el resultado."],
        {
          "requirements": "Requisitos del ejercicio.",
          "criteria": "Cómo comprobar la solución.",
          "deliverable": "Qué se debe entregar."
        }
      ]
    ]
  }
]
```

Cada minirreto usa el orden `[título, contexto, pasos, metadatos]`. En JSON, `\n` representa un salto de línea. Para código utiliza tres acentos graves, el lenguaje y el código, cerrando con otros tres acentos graves. Los módulos aceptados son `algoritmia`, `ia`, `datos`, `ingles` y `hse`.

Si ya existe el mismo módulo, semana y día, la importación intenta actualizarlo. Se rechazan cambios incompatibles con pasos que ya tengan progreso o conversaciones. La importación de varias fichas es secuencial: un error no deshace las fichas anteriores; el mensaje indica cuántas se guardaron.

El tablero no descarga automáticamente las fichas privadas. En Moodle recorre Semana → Día → Reto → Tus MiniRetos de hoy y consulta cada tarjeta. Conserva los enlaces oficiales. Los materiales cargados se guardan en la base privada, fuera de GitHub. La base de producción puede contener más contenido que el catálogo inicial incluido en el código.

## Notificaciones personalizadas

Desde el buzón puedes seleccionar los días de la semana y una hora en `America/Bogota`. Sin días seleccionados no se generan avisos. Pausar conserva el historial y bloquea avisos nuevos; reanudar respeta el horario guardado. Las preferencias persisten al recargar y volver a iniciar sesión.

Hay como máximo un aviso por cuenta y fecha. Incluye la programación disponible y el punto personal para continuar. Eliminar aviso lo retira de tu buzón de forma persistente; no afecta el aviso de otros usuarios y no se regenera durante esa misma fecha. Internamente se conserva un registro de descarte para evitar duplicados.

Los avisos son internos: no se envían correos, SMS ni notificaciones push. Con una pestaña visible se comprueba el horario cada 30 segundos. Un servidor local encendido revisa cada 15 segundos. Vercel tiene un cron diario a las 10:00 UTC; los horarios personales posteriores se comprueban al abrir o actualizar la aplicación. El cron diario no garantiza entrega puntual a cualquier hora si la aplicación está cerrada. `RIWI_SCHEDULER=0` desactiva la generación automática en el servidor.

## Guías, conversaciones e IA

Pedir guía genera ayuda básica del tablero sin necesitar un proveedor. Ver o generar guía de IA reutiliza la guía guardada del hilo; generar una nueva, ampliar la explicación o hacer preguntas necesita un modelo conectado. Cada cuenta conserva sus propios mensajes y conversaciones.

El contexto enviado al tutor incluye el módulo, semana, día, tema, resumen, tecnología, el minirreto y su contexto, el paso seleccionado, los requisitos disponibles, el avance de esa cuenta y hasta los diez mensajes recientes del hilo. El chat general del día usa el contexto del día. El modelo no recibe las cuentas de otros usuarios ni puede marcar casillas o administrar la base de datos.

Las reglas del tutor están en `tutor-policy.mjs`. El administrador puede añadir instrucciones privadas con `RIWI_TUTOR_CONTEXT` y `RIWI_TUTOR_SKILLS`; no existe un editor de perfil personal de instrucciones del tutor. La conexión directa del navegador a un modelo local usa instrucciones y contexto más breves que los proveedores atendidos por el servidor.

En Conectar un modelo se admiten Groq, Gemini, Google Cloud/Vertex AI, OpenAI, Claude, Ollama y un agente local compatible. El proveedor requiere su propia credencial o servicio local. El costo y acceso dependen de ese proveedor; una suscripción a ChatGPT no equivale a una clave de API.

Las claves personales de los modelos solo viven en memoria de la pestaña y se descartan al desconectar, recargar o cerrar sesión. No se guardan en Turso. Los mensajes sí se guardan, por lo que no deben contener secretos. Google requiere configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y la redirección HTTPS `/google-callback`. Los modelos locales requieren estar instalados y permitir el origen del tablero.

El chat presenta Markdown y código, permite copiarlo y probar JavaScript o Python en un entorno aislado, y previsualizar HTML/CSS. Estas pruebas no ejecutan acciones sobre la base de producción. Eliminar un hilo conserva el checklist y los demás hilos.

## Ejecutar y probar

1. Instala Node.js 24 y ejecuta `npm ci`.
2. Copia `.env.example` a `.env` y configura la base local y el origen.
3. Ejecuta `npm start` y abre `http://127.0.0.1:8765`.
4. Ejecuta `npm test` y `git diff --check` antes de publicar.

La base local predeterminada es `riwi.sqlite`; `RIWI_DB_PATH` permite cambiarla. Las tablas nuevas se crean automáticamente sin borrar los datos existentes. Respalda una base antes de cambiarla; si la copias mientras está en uso, emplea una copia consistente que incluya el WAL.

## Vercel y Turso

El proyecto usa `vercel.json`, Node.js 24 y Turso mediante `@libsql/client`. Configura `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` y `CRON_SECRET` en las variables privadas de Production. Configura la cuenta administradora mediante `content-owner-account` o `RIWI_OWNER_ACCOUNT_ID`. Tras cambiar variables de Vercel hace falta un nuevo despliegue.

En un servidor propio utiliza `RIWI_ORIGIN` con el origen exacto; para acceso remoto usa HTTPS y `NODE_ENV=production`. No publiques SQLite como archivo estático.

Para iniciar otra instalación desde cero, crea una base independiente y cambia la conexión; respalda antes la anterior. Reiniciar progreso no debe borrar fichas ni cuentas. Cambiar el código no reinicia automáticamente las casillas existentes.

## Datos privados

No subas credenciales, cookies, tokens, cédulas reales, perfiles, exportaciones de Moodle, SQL con datos ni copias de bases a GitHub. `.gitignore` excluye `.env`, `data/`, `backups/` y bases SQLite. Guarda el material del curso y los perfiles solo en los servicios privados previstos para la aplicación.
