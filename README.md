# Mi tablero Riwi · V1.0 Beta

Tablero personal para Desarrollo de Software, Trayecto 2, clan Ritchie. Organiza las fichas de Moodle, muestra el calendario del clan, guarda las casillas y el historial, genera un aviso diario y abre la guía del paso elegido. También admite fichas de Inglés y Habilidades Socioemocionales (HSE). El punto de partida de una base nueva es Algoritmia 2 · Semana 1 · Día 1 · MiniReto 3 · Paso 1, con las casillas anteriores disponibles para confirmar.

## Ejecutar en Windows

1. Instala [Node.js 24](https://nodejs.org/). No hay paquetes de npm que instalar.
2. En el directorio del proyecto, ejecuta `Copy-Item .env.example .env`. Mantén `RIWI_PASSWORD` con la contraseña anterior si ya tenías un tablero. En una instalación nueva, puedes definir una cadena privada de al menos 16 caracteres para habilitar la edición de fichas y calendario al crear la cuenta titular.
3. Ejecuta `node --env-file=.env server.mjs` y abre [el tablero local](http://127.0.0.1:8765/). Elige **Crear una cuenta**, ingresa tu cédula y crea una contraseña de al menos 12 caracteres. Para vincularte como titular, abre **Recuperar mi avance anterior** antes de enviar el formulario y escribe el valor de `RIWI_PASSWORD`.
4. Para ejecutar las pruebas, usa `node --test`.

La base predeterminada es `riwi.sqlite`. Si vienes de la Beta, detén el servidor anterior, guarda una copia de seguridad y apunta `RIWI_DB_PATH` al archivo existente. El servidor agrega las tablas necesarias y conserva las casillas, fichas importadas, avisos y conversaciones. El historial reconstruido de la Beta indica cuándo no hay fecha de finalización registrada. Para copiar una base en uso usa la API de respaldo de SQLite. Para copiar archivos directamente detén los procesos que la usan y, si existe, conserva también el archivo WAL junto al principal.

## Publicar en Vercel para PC y celular

Usa [Vercel Hobby](https://vercel.com/docs/plans/hobby) para el tablero y [Turso Free](https://turso.tech/pricing) para SQLite en la nube. Cada persona crea su cuenta con cédula y contraseña. Las casillas, el historial, los avisos y las guías guardadas son individuales. Las fichas y el calendario son comunes y solo los edita el titular. La base almacena la cédula como identificador privado y un hash `scrypt` con sal para verificar la contraseña. El tablero no verifica la titularidad de la cédula ante una entidad externa.

1. Crea una base en Turso Free. Si ya tienes casillas o historial local, detén el servidor, haz una copia de SQLite que incluya los cambios del WAL y [crea la base de Turso importando esa copia](https://docs.turso.tech/cli/db/create), por ejemplo con `turso db create tablero-riwi --from-file ./backups/riwi.sqlite`. Si empiezas de cero, crea una base vacía. Obtén su URL `libsql://…` y un token para esa base.
2. Crea o vincula un proyecto personal en Vercel con `npx vercel link`. Usa el preset **Other**. En **Settings → Environment Variables**, configura en **Production** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` y `CRON_SECRET` (una cadena aleatoria de al menos 16 caracteres). Mantén `RIWI_PASSWORD` para vincular el avance de la versión anterior en **Crear una cuenta → Recuperar mi avance anterior**. Una vez vinculado el titular, puedes quitar esa variable al volver a desplegar. Vercel proporciona el dominio HTTPS que usa el servidor al verificar las escrituras.
3. Desde la carpeta del proyecto ejecuta `npx vercel --prod`. Abre la URL de producción en el PC y el celular. Comprueba que pide autenticación y que una casilla actualizada en un dispositivo aparece al recargar el otro. En el panel de Vercel, verifica que el cron de `/api/cron` responda correctamente.

Vercel instala el cliente de Turso al construir. La pantalla de acceso está disponible públicamente y las rutas de datos y el tablero requieren una sesión vigente. Usa una base independiente si habilitas vistas previas. En Vercel se ofrece la guía básica guardada en Turso. **Iniciar sesión en ChatGPT** abre la página oficial para usar la cuenta personal y **Copiar contexto** copia los datos del ejercicio seleccionado al portapapeles para pegarlos allí. El chat de ChatGPT queda en su propio historial. Integrar la conversación y el uso del plan personal en un sitio alojado requiere acceso al programa de [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart).

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

**Pedir guía** abre la conversación del paso con el contexto de su ficha. La guía básica se genera en el servidor y queda disponible desde ambos dispositivos. El Día 1 incluye ejemplos preparados para los siete pasos del MiniReto 3 y para el primer paso de los otros tres minirretos. Los demás pasos ofrecen una guía básica basada en la ficha. El ejemplo adaptado a cualquier paso y las preguntas libres están disponibles al configurar un modelo compatible en [Ollama local](https://github.com/ollama/ollama/blob/main/docs/faq.mdx).

En Ollama habilita `OLLAMA_NO_CLOUD=1` en el proceso que sirve la API, reinícialo y descarga un modelo local compatible con tu equipo. Define en el tablero `RIWI_OLLAMA_MODEL` con el nombre y etiqueta exactos que muestra `ollama list`. El tablero consulta el servicio de loopback de Ollama y comprueba que el modelo esté instalado y sea local. La respuesta recibe el día, el minirreto, el paso y las casillas guardadas. Cada hilo se guarda en SQLite y tiene su propio historial, separado del historial de ChatGPT.

## Costos y límites

| Componente | Condición y comportamiento al alcanzar el límite |
| --- | --- |
| Equipo propio y Tailscale Personal | El alojamiento utiliza equipo, internet y electricidad existentes. Usa el plan Personal gratuito sin habilitar un plan de pago. Si se alcanza la capacidad gratuita, mantén el acceso dentro de los dispositivos y límites disponibles. [Condiciones del plan](https://tailscale.com/docs/account/manage-plans/free-plans-discounts) |
| SQLite | Usa el disco del equipo. Si se llena, SQLite puede rechazar la escritura y el tablero indica error. No hay un proveedor de base de datos con facturación por uso. [Códigos de error de SQLite](https://www.sqlite.org/rescode.html) |
| Avisos | El proceso almacena avisos directamente en SQLite. Si falla una escritura, el proceso reintenta durante el día. No hay API de notificaciones ni cuota de mensajes. |
| Chat | El servidor no usa una API de pago. Ollama local está apagado por defecto, usa una respuesta simultánea y cancela la espera al superar el tiempo máximo. Si falla, la guía básica sigue disponible y el chat libre devuelve un error. [API local de Ollama](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx) |

La publicación en Vercel, una prueba desde un teléfono real, los módulos todavía sin fichas, la sincronización automática de contenidos y la activación de un modelo local requieren configuración o acceso adicional.

