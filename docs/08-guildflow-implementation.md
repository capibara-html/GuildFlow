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
| Maestro | **`claude-sonnet-5-5` mientras la misión trabaja** (`maestroModel`; `inherit` = el de la sesión) | el de la sesión | Todas, filtradas por la política del §5 mientras la misión trabaja | Siempre |
| Archimago | `claude-opus-5-5` | `high` (o `xhigh` por `userConfig`) | `Read`, `Grep`, `Glob` | `PLANNING` |
| Artífice | `claude-sonnet-5-5` | `high` | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `NotebookEdit`, `run_check` | `IMPLEMENTING` |
| Paladín | `claude-sonnet-5-5` | `high` | `Read`, `Grep`, `Glob`, `run_check`, `submit_verdict` | `REVIEWING` |

Ningún rol tiene shell ni delegación. Un Artífice cuya subtarea declara `resources` (herramientas MCP o web y skills aprobadas en el plan) se lanza como **variante** `guildflow:artifice-<subtarea>`: el mod la registra con `$.agent.register`, con esas herramientas añadidas y las skills precargadas, y reescribe el tipo en `agent.spawn`. Así el motor solo le ofrece lo aprobado. El modelo se impone en `agent.spawn`.

**Subtareas visuales** (`visual: true`, tras el benchmark A/B: la versión hecha a ciegas quedó peor estéticamente que la de una sesión que miraba su resultado):
- Su Artífice y su Paladín se lanzan como variantes con las herramientas del navegador integrado (`VISUAL_TOOLS`: vista previa, navegar, capturas, leer la página; sin `javascript_tool` ni formularios). Toda URL, también dentro de los lotes, debe ser de la máquina local (`browserProblem`).
- El mod escribe `.claude/launch.json` con el servidor `preview` del plan.
- Los criterios `visual` solo admiten veredicto si el Paladín hizo capturas en esa revisión (`noteLook`, contadas por el mod en `tool.call`) y describe lo que vio.
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
4. **Subagente**, en este orden: rol conocido → lista blanca del rol → herramienta propia → estado de misión y plaza → lecturas dentro del proyecto → escrituras dentro de las rutas de la subtarea, fuera de las protegidas, dentro del límite de archivos y, si el plan se aprobó automáticamente, fuera de las rutas sensibles.
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
   - Con `autoApprovePlan` activado, el mod aprueba solo planes sin rutas sensibles (`sensitivePlan`) y de complejidad distinta de `large`. La aprobación queda registrada como `by: 'auto'`.
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
- **Otras opciones:** `archimagoEffort` (`high`/`xhigh`), `allowedExecutables`, `autoApprovePlan` (desactivado por defecto) y `trustedTools`, las herramientas de recursos que no impiden la aprobación automática; por defecto Context7 y `WebSearch`.

## 10. Comandos y UI

| Comando | Efecto |
|---|---|
| `/quest <petición>` (skill del plugin) | Abre una misión (archiva una detenida, bloqueada o en pausa), abre el panel y arranca el turno del Maestro |
| `/quest-status` | Estado completo y abre el panel |
| `/quest-halt` | Detiene la misión (`HALTED/user`) y aborta el turno del Maestro (`immediate`) |
| `/quest-resume` | Reanuda tras confirmación humana en un diálogo |

- **Línea de estado** (`$.ui.status`): siempre dice qué pasa, por ejemplo "⏳ trabajando · Artífice en t1 (intento 2)", "✅ completada…" o "⚠ bloqueada, necesita tu decisión…".
- **Aviso y notificación** al pasar a `DONE`, `BLOCKED`, `HALTED`, `PAUSED` o `AWAITING_APPROVAL`.
- **Franja `AbovePrompt`:** estado, agentes en curso y siguiente paso. Se mantiene tras terminar.
- **Panel lateral:** las cinco estaciones con iconos SVG estáticos y el estado completo. **Solo datos reales**, sin estimaciones.

## 11. Fuera de alcance en esta fase

- Worktrees y Artífices en paralelo: solo se admite `isolation: none`, en secuencial.
- Escriba con modelo.
- Tablón pixel art animado.
- Empaquetado como marketplace.
