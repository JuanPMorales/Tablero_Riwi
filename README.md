# Mi tablero Riwi · V1.0 Beta

Tablero personal para Desarrollo de Software, Trayecto 2, clan Ritchie. Organiza las fichas de Moodle, muestra el calendario del clan, guarda las casillas y el historial, genera un aviso diario y abre la guía del paso elegido. También admite fichas de Inglés y Habilidades Socioemocionales (HSE). El punto de partida de una base nueva es Algoritmia 2 · Semana 1 · Día 1 · MiniReto 3 · Paso 1, con las casillas anteriores disponibles para confirmar.

## Ejecutar en Windows

1. Instala [Node.js 24](https://nodejs.org/). No hay paquetes de npm que instalar.
2. En el directorio del proyecto, ejecuta `Copy-Item .env.example .env`.
3. Ejecuta `node --env-file=.env server.mjs` y abre [el tablero local](http://127.0.0.1:8765/). Crea una cuenta con tu cédula y una contraseña de al menos 12 caracteres.
4. Para ejecutar las pruebas, usa `node --test`.

La base predeterminada es `riwi.sqlite`. Si vienes de la Beta, detén el servidor anterior, guarda una copia de seguridad y apunta `RIWI_DB_PATH` al archivo existente. El servidor agrega las tablas necesarias y conserva las casillas, fichas importadas, avisos y conversaciones. El historial reconstruido de la Beta indica cuándo no hay fecha de finalización registrada. Para copiar una base en uso usa la API de respaldo de SQLite. Para copiar archivos directamente detén los procesos que la usan y, si existe, conserva también el archivo WAL junto al principal.

## Publicar en Vercel para PC y celular

Usa [Vercel Hobby](https://vercel.com/docs/plans/hobby) para el tablero y [Turso Free](https://turso.tech/pricing) para SQLite en la nube. Cada persona crea su cuenta con cédula y contraseña. Las casillas, el historial, los avisos y las guías guardadas son individuales. Las fichas y el calendario son comunes y solo los edita el titular. La base almacena la cédula como identificador privado y un hash `scrypt` con sal para verificar la contraseña. El tablero no verifica la titularidad de la cédula ante una entidad externa.

1. Crea una base en Turso Free. Si ya tienes casillas o historial local, detén el servidor, haz una copia de SQLite que incluya los cambios del WAL y [crea la base de Turso importando esa copia](https://docs.turso.tech/cli/db/create), por ejemplo con `turso db create tablero-riwi --from-file ./backups/riwi.sqlite`. Si empiezas de cero, crea una base vacía. Obtén su URL `libsql://…` y un token para esa base.
2. Crea o vincula un proyecto personal en Vercel con `npx vercel link`. Usa el preset **Other**. En **Settings → Environment Variables**, configura en **Production** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` y `CRON_SECRET` (una cadena aleatoria de al menos 16 caracteres).
3. Desde la carpeta del proyecto ejecuta `npx vercel --prod`. Abre la URL de producción en el PC y el celular. Comprueba que pide autenticación y que una casilla actualizada en un dispositivo aparece al recargar el otro. En el panel de Vercel, verifica que el cron de `/api/cron` responda correctamente.

Vercel instala el cliente de Turso al construir. La pantalla de acceso está disponible públicamente y las rutas de datos y el tablero requieren una sesión vigente. Usa una base independiente si habilitas vistas previas. Las cuentas titulares existentes conservan su acceso. En una instalación nueva, después del registro del titular, busca el ID interno de su cuenta en la tabla `accounts` y configúralo en `RIWI_OWNER_ACCOUNT_ID`.

En Cron Jobs del plan Hobby, el aviso diario se programa a las **5:00 a. m. de Colombia** (10:00 UTC) y Vercel puede ejecutarlo hasta las **5:59 a. m.** Si abres el tablero después de las 5:00 y falta el aviso, lo genera al cargar. Turso evita duplicados aunque coincidan dos ejecuciones. Mantén ambos servicios en sus planes gratuitos. Al alcanzar sus límites, el servicio afectado puede rechazar peticiones hasta que vuelva a haber cuota. El tablero muestra un error si falla la base y conserva los datos previamente guardados. [Horario y límites del cron](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) · [Precios de Turso](https://turso.tech/pricing)

## Acceso privado con servidor propio

La configuración prevista usa un equipo propio encendido, SQLite local y [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) con el [plan Personal](https://tailscale.com/docs/account/manage-plans/free-plans-discounts). El 14 de noviembre de 2026 la documentación de ese plan listaba hasta seis usuarios gratuitos. Usa la misma cuenta del tablero desde ambos dispositivos para ver el mismo avance.

1. Instala Tailscale en el servidor y en el teléfono, conéctalos a tu red privada y habilita los certificados HTTPS. Limita el acceso a tus dispositivos mediante las reglas de esa red.
2. Ejecuta `tailscale serve --bg http://127.0.0.1:8765`. Guarda la URL HTTPS devuelta en `RIWI_ORIGIN`, sin barra final, y establece `NODE_ENV=production`.
3. Inicia Node con el comando anterior. Abre la misma URL HTTPS desde ambos dispositivos e inicia sesión con tu cédula y contraseña. Usa Serve para que la URL solo esté disponible en tu red privada.
4. Para recibir avisos con el navegador cerrado, deja el proceso de Node activo y el equipo encendido. En Windows puedes configurar el Programador de tareas para iniciar Node al arrancar con los argumentos `--env-file=.env server.mjs` y el directorio de trabajo del proyecto. Tailscale ofrece [modo desatendido en Windows](https://tailscale.com/docs/how-to/run-unattended) para que la red privada siga disponible al cerrar sesión.

En un equipo que ya tenga Docker puedes ejecutar `docker compose up -d --build` después de configurar el origen HTTPS. El puerto solo se publica en loopback y el volumen `riwi_data` conserva SQLite. La opción de chat local está deshabilitada en la configuración Docker incluida. Para habilitarla con esta entrega, ejecuta Node y Ollama directamente en el mismo equipo. Si migras una base anterior a Docker, colócala en el volumen antes del primer arranque, con permisos de lectura y escritura para el usuario del contenedor.

GitHub reportaba el repositorio original como público al preparar esta entrega. Cambia a **Private** en Settings antes de subir los cambios. Mantén `.env`, bases de datos, copias de seguridad y cookies fuera de Git.

## Moodle y calendario Ritchie

- [Curso Desarrollo de Software y Trayecto 2](https://moodle.riwi.io/course/view.php?id=137) y [Algoritmia 2](https://moodle.riwi.io/mod/page/view.php?id=7614).
- [Área personal de Moodle](https://moodle.riwi.io/my/), [Mis cursos de Moodle para Inglés y HSE](https://moodle.riwi.io/my/courses.php), [Genially oficial](https://view.genially.com/66da105683d3400c85f30f74) y [agenda de Ritchie enlazada en Genially](https://teamlead.up.railway.app/agenda?clan=ritchie).

El Día 1 de Algoritmia 2 se contrastó el 14 de noviembre de 2026 en sus cuatro fichas de Reto. La ficha de Café Origen pide JavaScript y Node.js. Los demás días de Algoritmia 2 conservan los temas de la Beta y muestran las instrucciones pendientes. IA Dev Tools, Análisis de Datos, Inglés y HSE están disponibles para incorporar sus fichas. La agenda de Ritchie confirma los bloques de primera hora que se muestran para las semanas del 9 y 16 de noviembre. El tablero usa «Desarrollo» para identificar Algoritmia 2 y «HSE» para Habilidades Socioemocionales. La fecha, semana y día del curso se vinculan al verificar la ficha correspondiente. En **Calendario Ritchie → Ver agenda oficial de Ritchie** se carga el horario incrustado y hay un enlace directo por si el navegador o la fuente bloquean el marco.

Para cargar una ficha, abre el módulo en Moodle, entra en **Semana → Día → Reto → Tus MiniRetos de hoy** y expande cada tarjeta. En el tablero abre **Cargar checklist** y registra tema, resumen, tecnología, enlaces, contexto, pasos, requisitos, criterios y entregable. Respeta la posición y el texto de las casillas que ya tengan historial. En **Calendario Ritchie** usa **Agregar fecha** o **Editar fecha o vincular checklist** para vincular la sesión con el día confirmado. Puedes corregir o quitar la sesión desde el mismo formulario. El progreso se guarda por día del curso y queda asociado al mismo día cuando cambia su fecha.

La consulta manual usa la sesión de tu navegador en Moodle. Si vence, pulsa **Reconectar Moodle** e inicia sesión en la página oficial. Regresa al tablero y registra la consulta o continúa cargando el checklist. El formulario del tablero solicita la contraseña del tablero únicamente mediante el diálogo de autenticación del navegador.

Si Riwi habilita servicios web y proporciona un token de solo lectura con permiso para `core_webservice_get_site_info`, puedes activarlo mediante `RIWI_MOODLE_TOKEN`. El tablero comprueba el token y marca sesión vencida si el servicio lo rechaza como inválido o expirado. Después de renovar el token, reinicia el proceso y pulsa **Comprobar conexión**. Esta comprobación valida acceso al servicio. Las instrucciones dentro de las fichas y la programación de Genially se cargan manualmente hasta contar con un acceso oficial que entregue esos datos estructurados.

## Avisos a las 5:00 a. m.

El servidor usa `America/Bogota` y guarda un aviso por fecha de Colombia. En un servidor propio se revisa el reloj cada 15 segundos. Si el proceso arranca después de las 5:00 a. m., crea el aviso del día en curso. En Vercel, Cron Jobs hace la llamada diaria. El aviso conserva una copia de la programación, el punto de avance y las fichas disponibles cuando se generó. El enlace abre el checklist vigente. `RIWI_SCHEDULER=0` desactiva la generación para mantenimiento o pruebas.

El destino es exclusivamente el buzón de la aplicación. La búsqueda de automatizaciones no encontró una ejecución existente que pudiera conectar con ese buzón.

## Guía y chat

**Pedir guía** abre el hilo del paso. La primera guía usa una plantilla y, donde están disponibles, ejemplos escritos para el Día 1. **Ver o generar guía de IA** reutiliza la guía que ya está guardada para esa cuenta y ese paso, incluso si se desconectó el modelo. La primera generación, **Pedir más explicación** y las preguntas libres consultan el modelo conectado. Las guías y conversaciones se guardan por cuenta en el tablero.

En **Chat Riwi → Conectar un modelo**, escoge el proveedor y escribe el identificador exacto del modelo:

| Conexión | Qué necesita |
|---|---|
| Gemini | Clave personal de [Google AI Studio](https://aistudio.google.com/apikey). |
| Google Cloud | Inicio de sesión con Google e ID de un proyecto con la API de Vertex AI habilitada y permisos para generar contenido. |
| OpenAI | Una clave de la [plataforma API](https://platform.openai.com/api-keys). El [inicio de sesión con el plan de ChatGPT](https://developers.openai.com/siwc/quickstart) requiere habilitación de OpenAI para una app alojada. |
| Claude | Clave de [Claude Console](https://platform.claude.com/settings/keys) con acceso a un workspace. |
| Ollama | Modelo descargado y en ejecución local. |
| Agente local | API compatible con `/v1/chat/completions` en `127.0.0.1`, con el puerto y modelo que usa el agente. |

Para activar Google, crea un cliente OAuth de tipo **Aplicación web** en Google Cloud, configura su pantalla de consentimiento, registra la URL exacta `https://TU-DOMINIO/google-callback` como URI de redirección y configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en el servidor. Si la aplicación OAuth está en modo de pruebas, agrega las cuentas de prueba en Google. El permiso de Google Cloud vincula la cuenta que tiene acceso al proyecto elegido. Las credenciales de cada persona viven en memoria de la pestaña y se usan solo por solicitud en el servidor. Se descartan al desconectar, recargar o cerrar sesión y no se guardan en Turso ni en el almacenamiento del navegador. La aplicación guarda los mensajes, así que pega claves únicamente en el campo de conexión.

Para Ollama, mantén el servicio en loopback, activa `OLLAMA_NO_CLOUD=1`, configura `OLLAMA_ORIGINS` con el origen exacto del tablero y reinicia Ollama. En un agente compatible configura CORS para ese mismo origen. Si el navegador solicita permiso de red local, concédelo al conectar. La conexión llega al servicio instalado en el dispositivo que tiene abierto el navegador. Puedes mantener el modo anterior `RIWI_OLLAMA_MODEL` si ejecutas Node y Ollama directamente en el mismo equipo.

## Costos y límites

| Componente | Condición y comportamiento al alcanzar el límite |
| --- | --- |
| Equipo propio y Tailscale Personal | El alojamiento utiliza equipo, internet y electricidad existentes. Usa el plan Personal gratuito sin habilitar un plan de pago. Si se alcanza la capacidad gratuita, mantén el acceso dentro de los dispositivos y límites disponibles. [Condiciones del plan](https://tailscale.com/docs/account/manage-plans/free-plans-discounts) |
| SQLite | Usa el disco del equipo. Si se llena, SQLite puede rechazar la escritura y el tablero indica error. No hay un proveedor de base de datos con facturación por uso. [Códigos de error de SQLite](https://www.sqlite.org/rescode.html) |
| Avisos | El proceso almacena avisos directamente en SQLite. Si falla una escritura, el proceso reintenta durante el día. No hay API de notificaciones ni cuota de mensajes. |
| Chat | El tablero funciona con guías sin credenciales. Las conexiones de nube son opcionales, usan la cuota o el saldo personal y pueden generar cargos. Al alcanzar el límite del proveedor, la aplicación muestra el error sin reintentar automáticamente. Ollama local usa los recursos del dispositivo. |

La publicación en Vercel, una prueba desde un teléfono real, los módulos todavía sin fichas, la sincronización automática de contenidos y la activación de un modelo local requieren configuración o acceso adicional.

