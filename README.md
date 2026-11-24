# Tablero Riwi

Aplicación de estudio con fichas compartidas de Moodle, checklist individual, calendario, historial, buzón y tutor de IA. El contenido se guarda en Turso en producción y en SQLite al ejecutar localmente. Una cuenta nueva comienza en el primer paso, sin casillas marcadas.

## Páginas y funciones

| Página | Qué puedes hacer |
|---|---|
| Mi tablero | Elegir módulo, semana y día; leer el contexto de cada minirreto; marcar pasos, actividades o el día completo; pedir una guía. |
| Fichas | Buscar y filtrar días, abrir la fuente oficial de Moodle o consultar su checklist. La cuenta administradora también carga y edita contenido. |
| Calendario | Consultar las sesiones y abrir el checklist vinculado. La cuenta administradora puede agregar, corregir y quitar fechas. |
| Historial | Consultar progreso por día, filtrar por módulo o estado. Las notas personales están desactivadas. |
| Chat Riwi | Guardar el historial de estudio por cuenta, con filtrado de datos personales detectables; continuar después, reutilizar guías y eliminar conversaciones. |
| Buzón | Consultar avisos, pausarlos o reanudarlos, elegir días y hora, marcar como leídos durante la sesión y eliminar avisos del buzón personal. |

Los contextos admiten párrafos, títulos, listas, tablas, código en línea y bloques de código con resaltado. En el panel del paso puedes desplegar el contexto sin repetirlo completo en pantalla. Los requisitos, criterios y entregables se muestran por separado.

## Registro e inicio de sesión

Para crear una cuenta se solicitan nombre completo, correo personal, celular opcional, clan, cédula, contraseña y confirmación. Los clanes disponibles son Gosling, Nakamoto, Ritchie, Tesla, Turing, Ubuntu y Van Rossum.

La contraseña debe cumplir todas estas condiciones, verificadas tanto en el formulario como en el servidor:

- Entre 8 y 72 caracteres.
- Al menos una letra y un número.
- Sin espacios al inicio ni al final.
- No contener la cédula de la cuenta.
- Coincidir con la confirmación.

El formulario indica cuáles condiciones faltan. Solo se permite una cuenta por cédula: la base de datos rechaza duplicados incluso si llegan dos registros simultáneos; un intento repetido no reemplaza la contraseña ni el perfil existente. El formulario también bloquea envíos repetidos mientras procesa la solicitud. Para iniciar sesión solo se necesitan cédula y contraseña. Las cuentas anteriores conservan su contraseña y acceso; no se fuerza un nuevo registro. Se acepta el aviso de privacidad al registrarse. No se verifica la identidad de la cédula ni el celular; el correo se verifica mediante enlace cuando se configura el envío. La recuperación solo usa el correo verificado del perfil.

Las contraseñas se verifican con un hash scrypt y sal aleatoria. Las sesiones utilizan cookies HttpOnly y SameSite y, en producción, Secure. El perfil se guarda en una tabla privada independiente. El nombre y clan mostrados corresponden a la cuenta conectada. En **Mi cuenta → Mi perfil** puedes completar los datos de una cuenta antigua y modificar correo, celular y clan. El nombre completo se guarda una sola vez y después queda bloqueado también en el servidor. La cédula permanece como identificador de acceso y no se puede cambiar desde el perfil.

Cambiar el correo exige confirmar la contraseña actual. La verificación de un correo anterior no sirve para el nuevo; debe verificarse de nuevo antes de recuperar acceso con él. El celular no es obligatorio y puede retirarse sin cambiar el correo ni el progreso.

## Contenido compartido y permisos

Las fichas, sus días, temas, contextos, minirretos, pasos y enlaces pertenecen al catálogo compartido. Al guardar una ficha en Turso, las demás cuentas pueden consultarla al actualizar o volver a abrir la sección. No se necesita un push para cargar contenido.

Las casillas, el punto para retomar, las fechas de finalización, avisos y preferencias son propios de cada cuenta; el historial de estudio filtrado se conserva solo en la cuenta que lo creó. Marcar un paso no lo marca para otra persona. Desmarcar un día permite retomarlo; desmarcar una semana regresa al primer día con actividades de esa semana y módulo, sin borrar el progreso ajeno.

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

La agenda oficial del calendario usa el clan guardado en **Mi cuenta → Mi perfil**. Al guardar otro clan, el enlace, título y agenda incrustada se actualizan sin cerrar sesión; el cambio persiste al recargar. Los enlaces usan el nombre en minúsculas y guiones para los espacios, por ejemplo `clan=nakamoto` y `clan=van-rossum`. Las cuentas antiguas sin clan conservan Ritchie hasta completar su perfil. Las fechas guardadas con un enlace de agenda de otro clan se ocultan en el calendario, sin borrarlas; las actividades generales de Moodle se conservan. La agenda externa no se importa automáticamente al calendario interno.

## Notificaciones personalizadas

Desde el buzón puedes seleccionar los días de la semana y una hora en `America/Bogota`. Sin días seleccionados no se generan avisos. Pausar conserva los avisos que aún no hayan vencido y bloquea avisos nuevos; reanudar respeta el horario guardado. Las preferencias persisten al recargar y volver a iniciar sesión.

Hay como máximo un aviso por cuenta y fecha. Incluye la programación disponible y el punto personal para continuar. Eliminar aviso lo retira de tu buzón de forma persistente; no afecta el aviso de otros usuarios y no se regenera durante esa misma fecha. Cada aviso vence exactamente 24 horas después de su fecha y hora de envío (`created`), no al cambiar el día. El buzón lo oculta al vencer; el servidor retira su contenido al consultar los datos o ejecutar la limpieza programada. Los avisos antiguos sin hora se consideran enviados a las 05:00 de Colombia de su fecha. Internamente solo se conserva el identificador de cuenta y fecha del descarte para evitar duplicados; el progreso, las fichas y los mensajes no se borran.

Los avisos son internos: no se envían correos, SMS ni notificaciones push. Con una pestaña visible se comprueba el horario cada 30 segundos. Un servidor local encendido revisa cada 15 segundos. Vercel tiene un cron diario a las 10:00 UTC; los horarios personales posteriores se comprueban al abrir o actualizar la aplicación. El cron diario no garantiza entrega puntual a cualquier hora si la aplicación está cerrada. `RIWI_SCHEDULER=0` desactiva la generación automática en el servidor.

## Guías, conversaciones e IA

Pedir guía genera ayuda básica sin proveedor. Las preguntas y respuestas del chat se guardan por cuenta, día, paso e hilo, con filtrado de datos personales y secretos detectables antes de escribirlas y antes de enviarlas a un modelo. Al recargar o volver a iniciar sesión se recupera la conversación para continuar. Las notas personales están desactivadas; los títulos son genéricos. Los adjuntos se incorporan como texto filtrado del mensaje, no como archivos originales. El modo temporal anterior no dejó copias de mensajes que ya se hayan perdido.

El contexto enviado al tutor incluye el módulo, semana, día, tema, tecnología, resumen del día y **todos los minirretos de ese día**: títulos, contextos completos, pasos en orden, requisitos, criterios y entregables disponibles. Se incluye tanto desde un paso concreto como en el chat general, para relacionar un minirreto con los anteriores. El minirreto y paso seleccionados se identifican por número sin duplicar su texto; también se envía la cantidad de pasos completados por esa cuenta. Los proveedores del servidor y los modelos locales usan el mismo formato. Se envían como máximo seis mensajes recientes del hilo, con un presupuesto conjunto de 12.000 caracteres: se omiten mensajes completos, sin cortar código, y se avisa al tutor si falta historial. Se conserva el historial completo en la cuenta; para ahorrar cuota solo se envía una ventana reciente al modelo. El mensaje actual y el contenido del día no se recortan. Incluir el día completo consume más tokens que enviar un solo minirreto y queda sujeto a los límites del proveedor. El modelo recibe únicamente el día abierto, no otros días ni las cuentas de otros usuarios, y no puede marcar casillas o administrar la base de datos.

Para reducir el tiempo y consumo cuando el día es extenso, el presupuesto del historial se ajusta entre 2.000 y 12.000 caracteres: se calcula como 20.000 menos el tamaño del contexto del día y de la pregunta, respetando esos extremos. Se conservan los mensajes recientes completos y se eliminan respuestas huérfanas si su pregunta ya no cabe. Esta referencia usa caracteres, no tokens, y no garantiza que una ficha extensa quepa en la cuota del proveedor. El día completo y la pregunta actual siempre se conservan. El contexto está ordenado con el contenido del día antes de la selección y del avance, evitando duplicar el minirreto seleccionado.

Las reglas completas del tutor están en `tutor-rules.mjs` y se comparten entre los proveedores del servidor y los modelos locales del navegador: guiar al coder sin entregar soluciones finales de código, revisar sus intentos y permitir ayuda con contenido escrito. `tutor-policy.mjs` permite añadir instrucciones privadas del servidor mediante `RIWI_TUTOR_CONTEXT` y `RIWI_TUTOR_SKILLS`; estas no se publican al navegador. No existe un editor de perfil personal de instrucciones del tutor. El prompt completo es más largo que la versión anterior: el ahorro depende del historial omitido y del contexto redundante eliminado, no se garantiza un porcentaje fijo de tokens. Estas reglas orientan al modelo; no garantizan que nunca se equivoque. Las guías básicas no consultan proveedores y las guías guardadas pueden reutilizarse sin volver a consultar al modelo.

En Conectar un modelo se admiten Groq, Gemini, Google Cloud/Vertex AI, OpenAI, Claude, Ollama y un agente local compatible. El proveedor requiere su propia credencial o servicio local. El costo y acceso dependen de ese proveedor; una suscripción a ChatGPT no equivale a una clave de API.

Antes de consultar un modelo, `ai-privacy.mjs` filtra el contexto del día, la pregunta y el historial enviado. El perfil completo, cédula, correo, celular e identificador de cuenta no forman parte del contexto. Los datos conocidos del perfil de la cuenta conectada se usan localmente para sustituir coincidencias por marcadores; también se detectan patrones de correos, números de identificación/teléfono, credenciales, cookies y cadenas de conexión. El servidor aplica el filtro aunque se omita la interfaz; los modelos locales usan el mismo filtro. Se filtran además las preguntas y respuestas nuevas antes de guardarlas en el historial privado. Los perfiles no se reescriben. Las conversaciones históricas también se filtran al leerlas y antes de reenviarlas. Los registros antiguos no se reescriben automáticamente: pueden eliminarse desde Privacidad sin perder el progreso. Los secretos conocidos del entorno del servidor tampoco deben aparecer en el cuerpo de una consulta.

El proveedor recibe su clave únicamente como credencial de autenticación, nunca como contenido de la conversación. El filtrado automático reduce el riesgo, pero no es una garantía de anonimización: nombres de terceros, direcciones o datos disfrazados en texto libre pueden no detectarse, y algunos números de ejercicios pueden ocultarse por precaución. Usa datos ficticios en los ejercicios; para material que no deba salir del equipo, usa las guías sin IA o un modelo local sin servicios externos. Este filtro no cambia las políticas de conservación del proveedor ni elimina datos que ya se le hayan enviado.

El chat informa que el historial filtrado se guarda en la cuenta para continuar después. Los perfiles y conversaciones de otras cuentas no se incorporan al contexto. Las notas siguen desactivadas. Se bloquean preguntas con indicadores de salud antes de consultar al modelo. La detección no es infalible: nombres de terceros o datos disfrazados pueden no detectarse; usa datos ficticios. Estas medidas no certifican por sí solas el cumplimiento de la Ley 1581 de 2012.

Las claves personales de los modelos solo viven en memoria de la pestaña y se descartan al desconectar, recargar o cerrar sesión. No se guardan en Turso. El historial se guarda filtrado por cuenta, pero no debe contener secretos ni datos reales de personas. Google requiere configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y la redirección HTTPS `/google-callback`. Los modelos locales requieren estar instalados y permitir el origen del tablero.

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

El aviso público está en `/privacy` y los controles en **Mi cuenta → Privacidad y seguridad**. Configura `RIWI_PRIVACY_RESPONSIBLE` y `RIWI_PRIVACY_CONTACT` con la identidad y contacto públicos del responsable. Si faltan, el aviso indica expresamente que están pendientes: no debe presentarse como una política legal completa. El celular es opcional y puede retirarse del perfil; no se usa para recuperar acceso.

El modo sin proveedores externos está activo por defecto en cuentas nuevas y anteriores. La decisión se guarda por cuenta con versión y fecha del consentimiento en `account_security`. Autorizar una clave no habilita por sí solo este permiso: debe cambiarse en Privacidad. Revocarlo bloquea nuevas solicitudes en el servidor. Solo Ollama local verificado y guías básicas están disponibles sin habilitar proveedores externos; el agente compatible necesita permiso porque podría reenviar consultas. El filtro previo de datos sigue aplicándose en todos los modos.

El aviso se actualizó a la revisión `2026-11-24.2` al volver a conservar conversaciones. Las cuentas con una aceptación anterior deben renovarla en Privacidad antes de crear o añadir mensajes a un chat. La lectura y eliminación del historial siguen disponibles; el cambio no borra el progreso ni las conversaciones existentes.

La opción **Eliminar historial de chats** exige escribir `BORRAR`, elimina mensajes, notas y títulos anteriores de esa cuenta y conserva las casillas. **Eliminar mi cuenta** exige contraseña actual y escribir `ELIMINAR`; elimina perfil, progreso, preferencias, tokens y sesiones de la cuenta sin afectar otras cuentas ni fichas. La cuenta administradora no puede eliminarse hasta transferir su función. Queda un identificador técnico derivado del ID y la fecha en `privacy_deletions` para impedir que una restauración vuelva a crear cuentas ya eliminadas. No contiene nombres ni mensajes.

## Verificación y recuperación por correo

Se implementa con Resend, sin nuevas dependencias. Hace falta crear una cuenta del servicio, verificar un dominio remitente y configurar **en Vercel**, sin subir valores al repositorio:

- `RESEND_API_KEY`: credencial de envío.
- `RIWI_MAIL_FROM`: remitente del dominio verificado.
- `RIWI_PUBLIC_URL`: origen HTTPS canónico del tablero; no debe incluir rutas ni parámetros.

Sin esta configuración, la interfaz indica que la verificación y la recuperación no están disponibles y la API devuelve 503. No existe un reinicio por cédula sin verificar el correo. Desde Privacidad se solicita verificar el correo actual del perfil. `/access` permite recuperar la contraseña usando cédula y ese correo verificado; la respuesta no revela si existe una cuenta. Los enlaces usan un token aleatorio de un solo uso que vence a los 15 minutos: la base guarda únicamente su hash. El token va en el fragmento del enlace y la página lo retira de la dirección antes de confirmar la operación. Cambiar el correo invalida los enlaces para el correo anterior. Cambiar la contraseña revoca todas las sesiones. Hay límites de solicitudes para evitar abuso. Los correos solo incluyen destinatario, finalidad y enlace; no incluyen cédula, celular, contraseña ni progreso.

## Respaldos privados y prueba de restauración

`scripts/private-backup.mjs` genera respaldos AES-256-GCM con una clave base64 de 32 bytes en `RIWI_BACKUP_KEY`. Guarda esa clave separada del respaldo, en un gestor de secretos; perderla impide recuperar la copia. No se genera ni publica ninguna clave por defecto. La herramienta usa Turso si tiene las variables privadas de conexión; de lo contrario usa el archivo local existente indicado por `RIWI_DB_PATH`.

Con la conexión y la clave ya cargadas en un entorno privado:

```powershell
node --env-file-if-exists=.env scripts/private-backup.mjs create
node --env-file-if-exists=.env scripts/private-backup.mjs verify backups/archivo.enc
node --env-file-if-exists=.env scripts/private-backup.mjs restore backups/archivo.enc data/base-restaurada.sqlite
```

Cada creación descifra la copia en memoria y prueba su restauración e integridad antes de escribir el archivo cifrado en `backups/`. Las copias incluyen chats por cuenta con filtrado previo y títulos genéricos; excluyen notas personales, chats legados sin cuenta, sesiones de acceso y enlaces de recuperación. Al restaurar, la IA externa vuelve a quedar desactivada y se exige nuevo consentimiento. La restauración solo admite un destino nuevo: no sobrescribe producción. Consulta el registro actual de eliminaciones de la base origen y lo aplica para no reactivar cuentas eliminadas después de la copia. Verifica los conteos, perfiles y progreso restaurados en un entorno aislado antes de cambiar la conexión de producción.

La configuración de la clave, custodia externa, programación de copias y rotación de hasta 30 días son tareas operativas del responsable; este código no activa un servicio de respaldo externo ni borra copias antiguas automáticamente. Las pruebas automáticas usan datos ficticios y prueban autenticidad del cifrado, rechazo de claves incorrectas/archivos alterados, restauración de progreso y respeto a eliminaciones. Los scripts y utilidades de respaldo quedan excluidos del paquete de Vercel. Los datos de producción no se reinician al publicar.

No subas credenciales, cookies, tokens, cédulas reales, perfiles, exportaciones de Moodle, SQL con datos ni copias de bases a GitHub. `.gitignore` excluye `.env`, `data/`, `backups/` y bases SQLite. Guarda el material del curso y los perfiles solo en los servicios privados previstos para la aplicación.

## Paleta de la aplicación

Los controles y estados usan exclusivamente la paleta definida en `ui.css`: principal `#382CCE`, destacado `#440885`, selección `#8660E7`, menú `#271044`, progreso `#43CADB`, fondo `#F6F5FA`, tarjetas `#FFFFFF`, etiquetas `#F0EBFC`, texto `#24133E`, texto secundario `#777189`, texto del menú `#C9B8E1`, bordes `#E8E3F0`, confirmación `#E4F7F8` con texto `#17636E`, y errores o eliminación `#B33856` sobre `#FFF0F3`.
