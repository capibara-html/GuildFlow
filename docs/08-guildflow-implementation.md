# 08 — Implementación de GuildFlow (Fase 2)

**Fecha:** 2026-10-11 · **Versión:** plugin `guildflow` 0.2.0 · **Motor probado:** Claude Code Desktop 2.1.295 (API de mods en acceso anticipado)
**Código:** `guildflow/` · **Commits:** `9e1beaf` (núcleo), `363832b` (autonomía y correcciones), `e7b63a8` (estado visible y endurecimiento)

## 1. Qué es

Un único plugin de Claude Code. Sin servicio local, sin app Electron y sin base de datos externa. Tiene tres partes:

| Parte | Archivos | Papel |
|---|---|---|
| Subagentes | `agents/archimago.md`, `artifice.md`, `paladin.md` | Roles con modelo, esfuerzo, herramientas y turnos declarados. **No se confía en el frontmatter**: el mod lo impone en tiempo de ejecución |
| Skill | `skills/guildflow/SKILL.md` | Protocolo de misión que sigue el Maestro (la sesión principal) |
| Mod | `hooks/register.tsx` + `src/*` | Hace cumplir el ciclo en código: guardas, estado, verificación, límites, UI |

El Maestro es la sesión principal. El Escriba no es un modelo: es el código del mod (`src/persistence.ts`) y no gasta tokens.

## 2. Roles

| Rol | Modelo impuesto | Esfuerzo | Herramientas permitidas (lista blanca en `src/policy.ts`) | Fase en que actúa |
|---|---|---|---|---|
| Maestro | **`claude-sonnet-5-5` mientras la misión trabaja** (`maestroModel`; `inherit` = el de la sesión) | **`medium` mientras la misión trabaja** (`maestroEffort`; `inherit` = el de la sesión) | Todas, filtradas por la política del §5 mientras la misión trabaja | Siempre |
| Archimago | `claude-opus-5-5` | `high` (o `xhigh` por `userConfig`) | `Read`, `Grep`, `Glob` | `PLANNING` |
| Artífice | `claude-sonnet-5-5` (u Opus por subtarea) | **por subtarea:** `effort` del plan (`low`…`xhigh`); sin él, `small` → `medium` y `medium`/`large` → `high` (`taskEffort`) | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `NotebookEdit`, `run_check` | `IMPLEMENTING` |
| Paladín | `claude-sonnet-5-5` | `high` siempre: una revisión floja es el fallo más caro | `Read`, `Grep`, `Glob`, `run_check`, `submit_verdict` | `REVIEWING` |

El esfuerzo se impone en cada petición (`turn.step`, `effortFor` en `src/policy.ts`), no solo en el frontmatter, y el diálogo de aprobación muestra el de cada subtarea. Antes de la Fase 4 era `high` fijo para los tres subagentes y el Maestro seguía el de la sesión.

Ningún rol tiene shell ni delegación. Un Artífice cuya subtarea declara `resources` (herramientas MCP o web y skills aprobadas en el plan) se lanza como **variante** `guildflow:artifice-<subtarea>`: el mod la registra con `$.agent.register`, con esas herramientas añadidas y las skills precargadas, y reescribe el tipo en `agent.spawn`. Así el motor solo le ofrece lo aprobado. El modelo se impone en `agent.spawn`.

**Subtareas visuales** (`visual: true`, tras el benchmark A/B: la versión hecha a ciegas quedó peor estéticamente que la de una sesión que miraba su resultado):
- **Lección en vivo:** un tipo registrado con `$.agent.register` solo se puede lanzar **a partir del turno siguiente** (la misión A2 se bloqueó en t3 por eso, y el kit de pruebas no lo reproducía). Por eso el Artífice y el Paladín base ya declaran en su frontmatter el navegador, la web, Context7 y `Skill`, y la guarda limita por subtarea a lo aprobado. Las variantes se registran al aprobar el plan, se usan solo desde un turno posterior y no se ofrecen al modelo (`agent.offer`).
- Su Artífice y su Paladín se lanzan como variantes, cuando ya son lanzables, con las herramientas del navegador integrado (`VISUAL_TOOLS`: vista previa, navegar, capturas, leer la página; sin `javascript_tool` ni formularios). Toda URL, también dentro de los lotes, debe ser de la máquina local (`browserProblem`).
- El mod escribe `.claude/launch.json` con el servidor `preview` del plan.
- Los criterios `visual` solo admiten veredicto si el Paladín hizo capturas en esa revisión (`noteLook`, contadas por el mod en `tool.call`) y describe lo que vio.
- **Entorno de la vista previa (misión A3).** El puerto 8000 del plan estaba ocupado por el servidor de otra sesión, y la vista previa no arrancaba.
  - **Puerto propio:** cada misión usa uno entre 8100 y 8999, derivado de su id (`effectivePreview`).
  - **Plan B:** el brief indica abrir `http://localhost:<puerto>` directamente si `preview_start` falla.
  - **NOT_RUN no gasta intentos:** un `NOT_RUN` del Paladín (no pudo comprobarlo) repite la revisión como si se hubiera cortado, sin gastar intentos del Artífice.
- **Lección en vivo (misión A3):** la revisión visual consume peticiones en capturas. Las subtareas visuales suman 25 peticiones al Artífice y al Paladín (`turnsFor`). Además, un Paladín cortado por su límite antes de juzgarlo todo ya no cuenta como fallo del código: se repite la revisión, conservando lo ya juzgado, hasta 2 veces (`review.incomplete`). El Paladín emite cada veredicto en cuanto lo tiene.
- Una subtarea puede pedir `model: "opus"` para el trabajo creativo, y el Archimago cierra el trabajo visual con una subtarea de pulido. El esfuerzo se impone en cada petición en `turn.step`, porque la PoC demostró que el `effort` de la invocación anula el del frontmatter.

## 3. Módulos

| Módulo | Pureza | Responsabilidad |
|---|---|---|
| `src/machine.ts` | Pura, determinista | Máquina de estados, límites, contabilidad, criterios y evidencia. Cada operación devuelve una misión **nueva** o un error |
| `src/validation.ts` | Pura | Hash, normalización de rutas (Windows/POSIX, traversal, UNC, ADS), validación del plan, comandos sensibles, rutas sensibles, shell de solo lectura, límites de `userConfig` acotados |
| `src/policy.ts` | Pura | `decide(facts)`: el punto central de decisión de `tool.call` (§5) |
| `src/persistence.ts` | E/S por el puerto `Io` | Único escritor del estado: `quest.json`, `log.jsonl`, `runs/`, archivo y `$.store` |
| `src/verification.ts` | E/S por el puerto `Io` | `run_check`, integridad de rutas protegidas, `diff-scope` |
| `src/presentation.tsx` | Pura | Texto de estado, línea de estado, franja `AbovePrompt`, panel, diálogo de aprobación, resumen |
| `hooks/register.tsx` | Usa `$` | Adaptador `Io`, hooks, herramientas, comandos y UI |

**Restricción del validador:** `$` no puede pasar a través de un `import`. Por eso todo `$.x` vive en `register.tsx` y `src/*` recibe un puerto `Io` (`types/index.d.ts`) construido allí. Así, `src/*` se prueba con un `Io` en memoria (`tests/memio.ts`).

## 4. Máquina de estados

```
INTAKE → PLANNING → AWAITING_APPROVAL → DISPATCH → IMPLEMENTING → VERIFYING → REVIEWING → DONE → LOGGED
                         ↑   │                          ↑    │           │            │
                         └───┘ (rechazo)                └ FIXING ←───────┴────────────┘
Cualquier estado de trabajo → PAUSED | HALTED | BLOCKED
```

- La tabla `TRANSITIONS` es exhaustiva: lo que no figura se rechaza.
- **Criterios congelados:** al aprobar se guarda `planHash`. `isApproved` recalcula el hash, así que un plan alterado deja de estar aprobado.
- **DONE es imposible** con un criterio `FAIL`, `INCONCLUSIVE` o `NOT_RUN`, o sin verificar (`canFinish`).
- **Cada criterio tiene método verificable:** `check:<id>`, que ejecuta el mod, o `review`, que da el Paladín con referencia `archivo:línea` o `run-…`. El mod añade a cada subtarea el criterio `scope` (`diff-scope`).
- **Paradas:**
  - `PAUSED`: interrupción o reinicio.
  - `HALTED`: con tipo `user`, `limit` o `safety`.
  - `BLOCKED`: misma firma de fallo o intentos agotados.
- **Reanudación:** solo humana (`/quest-resume`, que confirma en un diálogo).
  - `HALTED/safety` **nunca** se reanuda.
  - `HALTED/limit` solo se reanuda si el límite ya no se supera.
  - `BLOCKED` concede exactamente un intento más.
- **Ronda fallida** (`failRound`), en este orden:
  1. Misma firma de fallo → `BLOCKED`.
  2. Sin progreso → `HALTED/limit`.
  3. Intentos agotados → `BLOCKED`.

## 5. Guarda central `tool.call`

Un solo hook decide toda llamada a herramienta: `decide()` en `src/policy.ts`, cuyo orden fija `tests/policy.test.ts`. El hook resuelve antes las rutas reales con `$.fs.stat`, siguiendo enlaces.

1. **Nombre de herramienta válido.** Si no, se rechaza.
2. **`SubagentHandback`** se permite siempre, porque los subagentes lo necesitan para entregar su informe.
3. **Sin misión activa:** el Maestro y los agentes ajenos no cambian. Las herramientas propias las atiende el mod. Un rol del gremio se rechaza.
4. **Subagente**, en este orden: rol conocido → lista blanca del rol → herramienta propia → estado de misión y plaza → lecturas dentro del proyecto → escrituras dentro de las rutas de la subtarea, fuera de las protegidas, dentro del límite de archivos y, si el plan se aprobó automáticamente, con una extensión de `autoApproveExtensions` y un nombre no sensible (`autoUnwritable`).
5. **Maestro:**
   - Las herramientas propias las atiende el mod.
   - Si la misión no está trabajando (`isWorking` falso: detenida, bloqueada, en pausa, terminada o esperando aprobación), se permite todo. El Maestro vuelve a ser Claude Code normal.
   - Lectura, coordinación y avisos se permiten.
   - Escrituras en el proyecto: **rechazo con explicación**. Fuera del proyecto: se pregunta.
   - Shell: lo de solo lectura (`ls`, `dir`, `pwd`, `Get-ChildItem`, `Get-Location`) se permite. Un comando de instalación **idéntico** al `argv` aprobado en `plan.installs` también se permite sin diálogo. Cualquier otro comando sensible se pregunta. El resto se **rechaza con explicación**.
   - MCP ajeno (sistema externo): se pregunta.
   - Cualquier otra herramienta: **rechazo con explicación**.

**Fallo en cerrado.** El `.catch` del hook rechaza ante cualquier error de la guarda cuando puede haber una misión activa, y también rechaza a los agentes sin rol durante la misión.

**Criterio de autonomía**, revisado con la persona usuaria el 2026-10-11: ante la duda, **rechazar con explicación** en vez de preguntar. El modelo lee el motivo y sigue. Solo lo sensible llega a la persona: push, despliegue, instalaciones, borrados, escrituras fuera del repo y sistemas externos. Antes de este cambio, una misión generó 42 diálogos. Ahora, una misión normal genera 0 (con `autoApprovePlan`) o 1 (la aprobación del plan).

## 6. Protocolo de misión

Lo resume `skills/guildflow/SKILL.md`. Lo que impone el mod:

1. **`/quest <petición>`** es la skill `quest` del plugin (`skills/quest/SKILL.md`): un comando Markdown es un prompt para el modelo y abre el turno del Maestro de forma nativa.
   - El hook `command.run` del mod va **delante** de la skill: crea la misión en `PLANNING`, abre el panel y deja pasar al prompt.
   - Si no puede crear la misión (petición vacía, otra misión trabajando), responde sin abrir turno.
   - Se invoca como `/quest` o `/guildflow:quest`.
2. **El Maestro decide quién planifica**. El mod exige que un plan de **más de una subtarea** venga de un Archimago (Opus) terminado en la misión, así que la planificación difícil nunca queda en el Maestro (Sonnet). La regla de la skill:
   - Si es un cambio acotado, planifica él.
   - Si son varios módulos, más de 2 subtareas, arquitectura nueva, una petición sin forma de verificarse o recursos útiles, lanza al Archimago.
   - El Archimago recibe un **inventario de recursos** de la sesión, generado por el código (`$.tool.list`, `$.command.list`). El esquema del plan, con `resources` e `installs`, está en `agents/archimago.md`.
3. **`quest submit_plan`:**
   - Se valida estrictamente: campos conocidos, ids, rutas sin comodines ni `..`, comprobaciones con ejecutable de la lista blanca, sin código en línea (`-e`, `--eval`…), sin comandos sensibles.
   - Se calculan los `protects` automáticos y se comprueban los solapes.
   - Una subtarea no puede tener concedidas las rutas que la certifican.
4. **Aprobación:**
   - Por defecto, un diálogo `$.ui.ask` muestra el plan **completo**. Si no cabe en 3000 caracteres, el plan se rechaza: no se presenta recortado. Un "sí" en el chat no vale.
   - Con `autoApprovePlan` activado, el mod aprueba solo planes de complejidad distinta de `large` cuyas rutas pasan `sensitivePlan`. Fase 4: dos capas. Primero, una **lista blanca de extensiones** (`autoApproveExtensions`; sin `json`, `yaml`, `toml` ni archivos sin extensión). Después, la lista negra de nombres sensibles, que se mantiene porque `CLAUDE.md` o `setup.py` tienen extensión permitida. Un archivo del plan se comprueba al aprobar; un directorio, archivo a archivo al escribir. La aprobación queda registrada como `by: 'auto'`.
   - Al aprobar se toma la línea base: `HEAD`, archivos ya sucios y huellas de las rutas protegidas.
5. **Instalaciones de terceros** (`plan.installs`). Siempre exigen aprobación humana.
   - **`plugin`, `mcp`, `skill`:** `argv` exacto de `claude mcp add|add-json` o `claude plugin install|marketplace add`, sin shell. Tras la aprobación, el Maestro las ejecuta tal cual y la guarda las permite sin otro diálogo.
   - **`software`:** solo `url`. Se le indica a la persona qué descargar; nunca se ejecuta.
6. **Especificación ejecutable.**
   - Una subtarea puede escribir los tests que certifican a otras, siempre que esas otras dependan de ella (lo exige `checkOverlaps`).
   - Cuando termina revisada, el mod recalcula las huellas de esas rutas (`rebaseProtected`) y quedan congeladas para el resto.
7. **`quest start_task`** abre la plaza de **un** Artífice. Para no inflar el contexto del Maestro, devuelve un resumen y no el brief: el brief completo lo inyecta el mod al lanzar el agente. La ejecución es secuencial: solo se admite `isolation: none`.
8. **`agent.spawn`** impone modelo, primer plano y un brief generado del plan aprobado. Rechaza la delegación anidada, los tipos ajenos y los lanzamientos sin plaza.
9. **Al terminar el Artífice**, el mod ejecuta él mismo las comprobaciones (`verifyPending`) y `diff-scope`. Lo que diga el agente no cuenta como evidencia.
10. **`quest start_review`:** el Paladín emite `submit_verdict` por cada criterio `review`.
11. **Fallo → `FIXING`:** el siguiente Artífice recibe la evidencia y la firma del fallo.
12. **`DONE`:** el mod escribe `.guildflow/summary-<id>.md` y pasa a `LOGGED`.

**Continuación autónoma acotada:** `maybeContinue` envía `$.prompt.submit` solo con una misión aprobada que haya progresado desde la última continuación, y como mucho `2 × maxQuestIterations` veces. `classic.Stop` no se usa como motor.

## 7. `run_check`

- Recibe un identificador del plan y lo convierte en una definición congelada: `argv` exacto, `cwd`, `expectExit`, `timeoutMs`, `minTests`, `stdoutIncludes` y `protects`. Se ejecuta con `$.process.run` **sin shell**, y no admite argumentos del modelo.
- **Juicio de la ejecución:** el código de salida debe ser el esperado. Si `minTests ≥ 1`, la salida debe mostrar al menos esos tests: un **exit 0 con 0 tests es FAIL**. Un tiempo agotado o un fallo de arranque también son FAIL.
- **Integridad antes y después de ejecutar.** Las huellas de las rutas protegidas deben coincidir con la línea base, y `quest.json` debe coincidir con lo último que escribió el mod. Si algo cambió, la misión se detiene por seguridad (`HALTED/safety`).
- **`diff-scope`:**
  - `HEAD` no puede haberse movido desde la aprobación.
  - Todo cambio debe estar dentro de las rutas de la subtarea y el diff no puede estar vacío.
  - Se respetan los límites de archivos y líneas.
  - Lo que ya estaba sucio antes de aprobar no cuenta.
  - git se ejecuta con `core.fsmonitor=false`, `--no-ext-diff` y `--no-textconv`.

## 8. Persistencia y recuperación

| Dónde | Qué | Sobrevive |
|---|---|---|
| `$.state` (`guildflow.view`, `guildflow.boot`) | Instantánea para la UI | Recargas del mod, no reinicios |
| `$.store` (`quest:<hash(root)>`) | Copia autoritativa de la misión | Reinicios |
| `.guildflow/quest.json` (+ `.tmp`) | Copia legible de la misión | Reinicios |
| `.guildflow/log.jsonl` | Registro de eventos, rotado a 2 MiB | Reinicios |
| `.guildflow/runs/run-*.json` | Evidencia de cada comprobación (secretos tachados) | Reinicios |
| `.guildflow/quests/<id>.json` | Misiones archivadas | Reinicios |
| `.guildflow/summary-<id>.md` | Resumen final | Reinicios |

- **Un solo escritor.** Las escrituras pasan por una cola serializada, y las mutaciones por un cerrojo con control optimista por `rev`.
- **Orden de escritura:** `tmp` → relectura y validación → **`$.store`** → `quest.json`. Si el archivo falla, se restaura la copia anterior de `$.store`. Así, `quest.json` nunca puede ir legítimamente por delante de `$.store`, y cualquier diferencia que no sea "por detrás" se trata como posible manipulación.
- **Recuperación al arrancar** (`session.start`): los agentes en curso pasan a `lost`, sin consumir intento. La misión pasa a `PAUSED`. **No se relanza nada automáticamente.** Una manipulación o un plan alterado provocan `HALTED/safety`.

## 9. Límites (`userConfig`, acotados a topes del plugin)

| Límite | Por defecto | Tope |
|---|---|---|
| Intentos por subtarea | 3 | 10 |
| Iteraciones por misión | 8 | 30 |
| Repeticiones del mismo fallo | 2 | 5 |
| Rondas sin progreso | 2 | 5 |
| Agentes por misión: **presupuesto derivado del plan** (Archimagos lanzados + 2 por intento y subtarea, incluidos los intentos extra al reanudar), acotado por el techo | techo 40 | 60 |
| Agentes concurrentes | 3 | 3 |
| Tokens por misión (entrada + salida + escritura de caché) | 2 000 000 | 20 000 000 |
| USD equivalente a API | 25 | 500 |
| Uso de la suscripción (`rateLimits.percentUsed`) | 90 % | 100 % |
| Tiempo activo | 60 min | 480 min |
| Archivos modificados / líneas de diff | 25 / 1500 | 200 / 20 000 |
| Turnos Archimago / Artífice / Paladín | 25 / 40 / 25 | 60 / 80 / 60 |

- **Contabilidad:** se registra cada petición en `turn.step`, con el desglose `input`, `output` y `cacheWrite` y su coste propio (`costDelta`). La sesión principal solo cuenta **mientras la misión trabaja**. Los agentes del gremio cuentan siempre. Las lecturas de caché se contabilizan aparte y no cuentan contra el presupuesto de tokens.
- **Interruptor de circuito:** cada 30 s y después de cada petición.
- **Artífices en paralelo (Fase 4, `maxParallelArtifices`, por defecto 1):** solo la implementación va en paralelo; la integración, la verificación y la revisión siguen en serie en el árbol principal, con el mismo núcleo de seguridad.
  - **Talleres, no worktrees de git.** Las misiones no hacen commits: un worktree desde el `HEAD` aprobado no tendría el trabajo de las subtareas ya terminadas, e integrar con `git merge` puede ejecutar hooks del repositorio. El taller es una copia de las rutas de la subtarea en `.guildflow/wt/<id>-<intento>-<t>`.
  - `quest start_parallel {taskId}` (`parallelCandidates`): la subtarea está pendiente, con sus dependencias terminadas, sin `visual` y con rutas disjuntas de la del carril principal y de los otros talleres. Se guarda la huella de sus rutas en el árbol principal (`Bench.seed`) y se abre una plaza `parallel`.
  - El Artífice se lanza en segundo plano con su subtarea como la activa (brief, recursos, modelo y esfuerzo). La política (`decideBench`) solo le deja escribir en su taller, dentro de sus rutas y fuera de las protegidas, sin depender de la fase del carril principal. No tiene `run_check`.
  - Al terminar queda `queued`. Con el carril principal en `DISPATCH`, `integrateReady` compara la huella: si coincide, copia el taller, registra las escrituras y pasa a `VERIFYING` (`integrate`); si no, `benchConflict` y la subtarea vuelve a `pending` con el intento gastado. Un fallo de verificación o de revisión se corrige en serie (`FIXING`).
  - El carril principal no puede arrancar una subtarea que pise un taller en marcha (`benchClash`). Tras un reinicio, un taller con su agente perdido vuelve a la cola sin gastar intento.
- **Escriba con modelo (Fase 4):** opción `escriba` (`none` por defecto o `haiku`). Al cerrar, `finalize` escribe la crónica mecánica y pasa a `LOGGED`; solo entonces pide a Haiku (`$.model.complete`, sin herramientas, esfuerzo `low`, 600 tokens, 20 s) un resumen de 3-5 frases, que `withEscriba` inserta arriba marcado como generado. Si falla, queda la crónica mecánica y el registro dice `escriba.failed`.
- **Sandbox (Fase 4):** `sandbox` (`none` por defecto o `docker`) y `sandboxImages` (`ejecutable=imagen`). Con `docker`, `execute` envuelve cada comprobación con `dockerArgv`, y `validatePlan` rechaza los ejecutables sin imagen. La opción queda congelada en los límites de la misión. Detalle y garantías en `09` §1.
- **Otras opciones:** `archimagoEffort` (`high`/`xhigh`), `allowedExecutables`, `autoApprovePlan` (desactivado por defecto) y `trustedTools`, las herramientas de recursos que no impiden la aprobación automática; por defecto Context7 y `WebSearch`.

## 10. Comandos y UI

| Comando | Efecto |
|---|---|
| `/quest <petición>` (skill del plugin) | Abre una misión (archiva una detenida, bloqueada o en pausa), abre el panel y arranca el turno del Maestro |
| `/quest-status` | Estado completo y abre el panel |
| `/quest-halt` | Detiene la misión (`HALTED/user`) y aborta el turno del Maestro (`immediate`) |
| `/quest-resume` (skill del plugin) | Reanuda tras confirmación humana en un diálogo y arranca el turno del Maestro; antes requería escribir "continua" |

- **Línea de estado** (`$.ui.status`): siempre dice qué pasa, por ejemplo "⏳ trabajando · Artífice en t1 (intento 2)", "✅ completada…" o "⚠ bloqueada, necesita tu decisión…".
- **Aviso y notificación** al pasar a `DONE`, `BLOCKED`, `HALTED`, `PAUSED` o `AWAITING_APPROVAL`.
- **Franja `AbovePrompt`:** estado, agentes en curso y siguiente paso. Se mantiene tras terminar.
- **Panel lateral (oficina del gremio, Fase 3; detalle en `docs/12`):** elementos nativos + SVG, en este orden:
  - Cabecera: `Pergamino de misión · <objetivo>`, línea temática, `Estado real: <ESTADO> · Subtarea · Intento · id` y petición.
  - **La oficina:** un solo SVG de 200×120 (`scene` en `src/sprites.ts`, arte en `src/art.ts`) con los cinco puestos, el tablón de encargos (una nota por subtarea), la placa de estado, el cofre y la crónica. Las poses salen de un único mapeo (`poseOf`/`cast` en `src/presentation.tsx`): nadie trabaja sin un agente en curso, los perdidos se ven en gris con «?» y nunca trabajan, y con la misión parada nadie trabaja. SMIL de 2 fotogramas solo en lo que trabaja. Debajo, una línea de texto por puesto ocupado, con su significado técnico.
  - **Acciones** (`actions`): «Detener misión» pide confirmación y sigue el camino de `/quest-halt`; «Reanudar» o «Revisar el plan» sigue el de `/quest-resume`, con su diálogo, y después arranca el turno del Maestro; «Estado completo» despliega el texto de `/quest-status`; «Animación» se guarda en `$.store` (`boardAnim`). Aprobar sigue siendo solo por el diálogo.
  - **Progreso** (subtareas terminadas y en curso; criterios aprobados, fallidos y pendientes; intentos; siguiente paso), **Encargos** (estado, agente asignado, intentos, veredicto por criterio ✔ ✘ ? ·, último veredicto y motivo del bloqueo) y **Tesoro** (tokens, coste equivalente no facturado, suscripción frente a su umbral, tiempo, agentes, iteraciones, archivos y líneas de diff; cifra, porcentaje, color y etiqueta «elevado» o «cerca del límite»).
  - **Bitácora:** los 8 últimos eventos legibles de la misión (`chronicle`), sin `tool.call` ni consumo, sembrados desde `log.jsonl` al cargar.
  - En la terminal, las barras son texto (█░) y no hay sprites. Cada SVG lleva `alt` con su dato. **Solo datos reales.**
- **Capa temática** (`src/theme.ts`, opción `theme`: `gremio` por defecto o `sobrio`; Fase 3.1).
  - Cabecera de rol + dato llano en la línea de estado, la franja, el panel, los diálogos ("Sellar el pergamino", "Levantar el campamento"), los avisos con la voz de cada rol, la salida de `/quest`, `/quest-status` y `/quest-halt`, y la crónica final.
  - Lo que leen los modelos (briefs y respuestas de herramientas) sigue neutro.
  - Las voces salen de repertorios por evento, elegidas de forma estable por misión, sin azar.

## 11. Fuera de alcance en esta fase

