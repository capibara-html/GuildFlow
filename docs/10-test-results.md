# 10 — Resultados de las pruebas (Fase 2)

**Fecha:** 2026-10-11 · **Commit:** `e7b63a8` · **Motor:** Claude Code Desktop 2.1.295 · **Proyecto de prueba:** `testbed/` (repositorio git aparte, rama `ignore-guildflow-state`)

**Leyenda:**
- **PASS:** verificado con evidencia.
- **FAIL:** no cumple.
- **INCONCLUSIVE:** hay datos, pero no bastan.
- **NOT RUN:** no se ha ejecutado. Una funcionalidad que solo tiene prueba unitaria **no** se da por probada en vivo.

## 1. Validación estática

| Comprobación | Resultado | Cómo |
|---|---|---|
| `claude plugin validate guildflow` | **PASS** ("Validation passed") | Binario 2.1.295 de Desktop |
| Comprobación de tipos (`tsc` 5.9.3, `strict`) | **PASS** (0 errores) | `npx -y -p typescript@5.9.3 tsc -p guildflow --noEmit`: el `tsconfig` del plugin, que extiende el de los tipos del motor (incluye `noUncheckedIndexedAccess`) |

## 2. Pruebas automáticas: `claude plugin test guildflow`

Se ejecutan contra el motor real del kit de pruebas, no contra simulaciones propias del motor. **192 pass, 0 fail** (125 de la Fase 2 + 41 de la Fase 2.5 + 7 de la capa temática de la Fase 3 + 6 del sandbox Docker, 2 de la lista blanca de la aprobación automática y 3 del esfuerzo por rol de la Fase 4, en `verification`, `validation`, `policy` y `hooks.test.ts` + 8 del tablón: poses, escena SVG, bitácora, acciones y colores en `presentation.test.ts`, y el panel montado en Desktop y en terminal con Detener y Reanudar en `hooks.test.ts`; 19 en `visual.test.ts`, 2 de `/quest-resume` como skill, 12 en `autonomy.test.ts` y 8 de integración en `hooks.test.ts`: arranque de `/quest`, `Glob` absoluto dentro del proyecto, `start_task` sin brief, Archimago obligatorio con más de una subtarea, Maestro en Sonnet y `maestroModel`).

| Archivo | Tests | Qué cubre |
|---|---|---|
| `tests/machine.test.ts` | 24 | Transiciones (camino feliz, transiciones inválidas, sin aprobación no se implementa, plan alterado), DONE imposible sin evidencia positiva, criterios congelados, mismo fallo → BLOCKED, intentos agotados, sin progreso → HALTED, iteraciones, tokens, USD, suscripción y tiempo, contabilidad sin duplicar, pausa, halt y reanudación, reinicio (agentes `lost`, sin consumir intento) |
| `tests/policy.test.ts` | 20 | Orden de decisión, lista blanca por rol, rutas, rutas protegidas, misión detenida, límite de archivos, política del Maestro trabajando y sin trabajar, rutas sensibles en misiones aprobadas automáticamente |
| `tests/validation.test.ts` | 20 | Normalización de rutas (Windows y POSIX, traversal, UNC, ADS), validación del plan, comandos sensibles, shell de solo lectura (incluidos `Env:`, `HKLM:` y UNC en mitad del argumento), flags de código en línea, límites acotados, planes sensibles |
| `tests/verification.test.ts` | 18 | Conteo de tests, exit 0 con 0 tests → FAIL, argv congelado sin shell, tiempo agotado, ejecutable no autorizado, script de verificación modificado, código bajo prueba que reescribe su test o `quest.json`, **regresión del falso positivo**, cwd por enlace, `diff-scope` (alcance, `HEAD` movido, diff vacío, líneas, git endurecido) |
| `tests/persistence.test.ts` | 12 | Escritura verificada, archivo malformado, escritura interrumpida, falsificación una revisión por delante, otra misión más reciente, error de escritura (también en `$.store`), control optimista, separación entre proyectos, plan alterado, registro append-only, tachado de secretos |
| `tests/hooks.test.ts` | 36 | Integración con el plugin cargado por el motor: guarda central, fallo en cerrado, falsificación de `quest.json` → HALTED/safety, `SubagentHandback`, Maestro sin diálogos (trabajando y detenida), `run_check`, `agent.spawn` (imposición de modelo, plaza, tipos ajenos), aprobación humana, `autoApprovePlan` desactivado, activado y con plan sensible |
| `tests/autonomy.test.ts` | 12 | Fase 2.5: presupuesto de agentes según el plan (y con intentos extra), especificación ejecutable (dependencia obligatoria, huellas nuevas solo con la subtarea terminada), recursos por subtarea (validación, solo lectura frente a escritura, el Artífice usa solo los de SU subtarea), instalaciones (argv exacto de `claude`, software solo con url, aprobación humana, el Maestro solo ejecuta el comando aprobado) |
| `tests/visual.test.ts` | 19 | Plan visual (criterio visual obligatorio, `preview` solo en 127.0.0.1, modelo por subtarea), navegador solo local (también en lotes; sin JavaScript ni formularios), el Paladín no puede juzgar lo visual sin capturas, variante registrada con Opus y navegador, y vuelta al tipo base si falla el registro |
| `tests/presentation.test.ts` | 5 | Diálogo de aprobación completo o rechazado, agentes perdidos no aparecen como activos, línea de estado, progreso solo a partir de evidencia |

## 3. Pruebas en vivo (Desktop 2.1.295)

Evidencia en `testbed/.guildflow/`: `log.jsonl`, `runs/`, `quests/` y `summary-*.md`. No está en git.

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| V1 | El mod carga, registra herramientas y comandos y se recarga en caliente | **PASS** | `session.start` en `log.jsonl`; `mcp__guildflow__*` disponibles |
| V2 | **Misión de éxito** `q-20261011-172458` (corregir `sum`): plan → aprobación automática → Artífice → verificación del mod → Paladín → DONE → LOGGED | **PASS** | Estados INTAKE→…→LOGGED, 30 s desde la aprobación hasta LOGGED; `run-1791740270505-unit` (exit 0, 1 test); `run-1791740270848-diff-scope` (solo `src/math.js`, 2 líneas); veredicto del Paladín c2 con `src/math.js:2-4`; `summary-q-20261011-172458.md`; **0 diálogos** |
| V3 | **Misión de fallo** `q-20261011-174017` (test contradictorio `answer() === 41 && 42`) | **PASS** | Ronda 1 FAIL (`run-1791740572841-oracle`, exit 1; `diff-scope`: diff vacío) → FIXING. Ronda 2 con la misma firma `0dbd175a961b0a89` → **BLOCKED** sin tercer intento. El Artífice se negó a manipular la evaluación. 0 diálogos |
| V4 | Imposición del modelo al lanzar (el Maestro pidió `haiku`) | **PASS** | `agent.spawn.result` `requestedModel:"haiku"` → `model:"claude-sonnet-5-5"` (misión `q-20261011-025758`) |
| V5 | Imposición del esfuerzo en `turn.step` | **INCONCLUSIVE en Fase 2** | 0 eventos `turn.step.enforced`: los agentes ya llegaban con el modelo y el esfuerzo del rol, así que no hubo nada que reescribir. La reescritura en sí está probada en la PoC (P2b) |
| V6 | Aprobación humana por diálogo (`$.ui.ask`) | **PASS** | La persona aprobó el plan de `q-20261011-025758` en el diálogo del mod; un "aprobar" escrito en el chat **no** contó |
| V7 | Rechazo del plan en el diálogo | **NOT RUN** en vivo | Solo prueba automática |
| V8 | Interruptor por uso de la suscripción | **PASS** | `q-20261011-025758`: `HALTED` "uso de la suscripción 90% ≥ 90%"; reanudada después con `/quest-resume` |
| V9 | `HALTED/safety` por integridad | **PASS** (con falso positivo) | La detención funcionó, pero su causa fue un falso positivo del propio mod. Se corrigió y tiene prueba de regresión (`docs/09` #4). Tras la corrección, V2 y V3 pasaron sin detenciones espurias |
| V10 | Detención sintética de un subagente cuando la misión está detenida | **PASS** | Respuesta sintética de `turn.step` "este agente se detiene" (misión `q-20261011-025758`) |
| V11 | Guarda del Maestro: rechazo con explicación, sin diálogo | **PASS** | En V3, un Bash del Maestro se rechazó con el motivo y sin preguntar |
| V12 | Misión detenida: el Maestro sin diálogos | **PASS** | Edición y Bash sobre `guildflow/` con `q-20261011-174017` en BLOCKED, sin diálogos |
| V13 | Línea de estado y franja visibles | **PASS** | Confirmado por la persona usuaria: "⚠ bloqueada, necesita tu decisión…" |
| V14 | Aviso o notificación al terminar o bloquearse | **NOT RUN** en vivo | Implementado después de V2 y V3 |
| V15 | Ruta protegida: el Artífice intenta editar su test | **NOT RUN** en vivo | El Artífice no lo intentó. Cubierto por `policy.test.ts` y `hooks.test.ts`, y en vivo por la PoC (P3) |
| V16a | **Reinicio de la sesión de Desktop** con una misión abierta, sin agentes en curso | **PASS** | `q-20261011-181054` en `PLANNING` → `session.start {restarted:true, source:"store"}` → `PAUSED` "sesión reiniciada…", sin ningún relanzamiento automático → `/quest-resume` (humano) → `PLANNING`, y la misión terminó en `LOGGED` (log, 18:11:47–18:12:15) |
| V16b | Reinicio **con un Artífice en curso** (agente marcado `lost`, intento devuelto) | **NOT RUN** en vivo | Cada Artífice duró unos 11 s y no coincidió con un reinicio. Cubierto por `machine.test.ts` ("reinicio: agentes en curso → lost, sin consumir intento") y en vivo por la PoC (P6, fila sintética) |
| V17 | **Misión de 3 subtareas con dependencias** `q-20261011-181054` (t1 `slugify`, t2 `titleCase`, t3 `headline` ← t1, t2) | **PASS** | Aprobación automática; 3 Artífices y 3 Paladines en serie; 9/9 criterios con evidencia (`run-…-slug`, `-title`, `-headline`: 2 tests cada uno; `diff-scope` por subtarea); `summary-q-20261011-181054.md`; 3m43s activos, ≈$1,36; **0 diálogos**. Los 6 tests vuelven a pasar fuera del mod (`node --test`) |
| V18 | Archimago (planificación delegada) | **PASS** | `q-20261011-183248`: `agent.spawn.result` rol `archimago` → `claude-opus-5-5`; su plan de 5 subtareas y 26 criterios se aprobó y se ejecutó sin cambios |
| V20 | **Misión realista desde cero: Pixel Chess** (`C:\Users\RYZEN\Desktop\pixel-chess`, sesión nueva con el plugin cargado por `CLAUDE_CODE_PLUGIN_DIRS`) | **PASS** | 5/5 subtareas (engine → ai, art, anim → ui) y **26/26 criterios**, cada subtarea al primer intento. 36 tests de aceptación escritos antes de la misión, incluidos perft 8902 y Kiwipete 2039. 11 agentes, 21m23s activos, 146k + 339k tokens, ≈$3,54. **1 diálogo** (aprobación del plan, `approval.needs_human: complejidad large`) y **1 rechazo**: un `Glob` del Paladín con patrón absoluto dentro del proyecto, falso positivo menor. El juego se probó a mano y la persona usuaria lo da por bueno |
| V21 | **Sandbox Docker** (Docker Desktop 29.6.1, `node:22-alpine`, el mismo argv que `dockerArgv` sobre `testbed/`) | **PASS** | `node --test test-multi/cap.test.js` dentro del contenedor: 3 tests, código 0, con la ruta `c:/users/...` del mod montada. Una sonda dentro del contenedor: escribir en el proyecto, en `.git/hooks` y en la raíz → `EROFS`; `/tmp` sí; DNS → `EAI_AGAIN`; el host quedó limpio. Un ejecutable que no está en la imagen → 127. Sin servicio, el CLI sale con **1** (no 125): se detecta por su mensaje. Hallazgo corregido: el punto de entrada de la imagen `node` pasaba un ejecutable desconocido a `node` como script → `--entrypoint` fijo |
| V22 | **Instalación desde el marketplace** (`.claude-plugin/marketplace.json` en la raíz, `source: ./guildflow`) | **PASS** | `claude plugin validate .` → "Validation passed". Con `CLAUDE_CONFIG_DIR` aislado: `plugin marketplace add <carpeta>` → `plugin install guildflow@guildflow` (ámbito user) → `plugin list`: activo, leído de `GuildFlow\guildflow`. Pendiente: instalarlo desde GitHub (`/plugin install guildflow --marketplace capibara-html/GuildFlow`), que necesita la rama publicada en `main` |
| V19 | `/quest-halt` durante un turno | **NOT RUN** en vivo | Prueba automática en `machine.test.ts` |

## 4. Consumo observado

| Misión | Tokens (principal + subagentes) | USD equivalente | Nota |
|---|---|---|---|
| `q-20261011-172458` (éxito) | 10k + 31k | ≈ 0,45 | Además, 1,51 M de lecturas de caché, que no cuentan contra el presupuesto |
| `q-20261011-183248` (Pixel Chess, 5 subtareas) | 146k + 339k | ≈ 3,54 | 11 agentes, unas 1 050 líneas de código; 4,45 M de lecturas de caché |
| `q-20261011-181054` (3 subtareas) | 30k + 70k | ≈ 1,36 | 6 agentes; 4,99 M de lecturas de caché |
| `q-20261011-174017` (fallo) | 18k + 21k al bloquearse | ≈ 0,61 | El contador siguió sumando trabajo de desarrollo mientras estaba bloqueada; corregido en `e7b63a8` |
| `q-20261011-025758` (detenida) | 1,26 M | ≈ 18 | Inflada por el mismo error de contabilidad y por el contexto de unos 500 k de la sesión de desarrollo |

**Hallazgo de V17:** el Paladín de t3 señaló que `diff-scope` informaba de "30 líneas" para un archivo de 7. La cifra era correcta, pero era la de **toda la misión** (11 → 22 → 30 acumuladas, coherente con un límite `maxDiffLines` por misión), y el mensaje la presentaba como de la subtarea. Se corrigió la redacción del mensaje; la lógica no cambia.

## 5. Pendiente

La Fase 2 cumple su criterio de fin: la misión de varias subtareas llega a `DONE` y la misión de fallo se detiene por el límite correcto (`BLOCKED`).

Queda opcional en vivo: V16b (reinicio con un agente en curso), V7, V14, V15 y V19.

**Abiertos tras V20:**
- `$.prompt.submit` no arrancó el turno del Maestro tras `/quest` en Desktop (0 peticiones hasta que la persona escribió). Desde `bc4383f` el resultado se registra como `prompt.kick`. V20 corrió con la versión anterior del mod, así que la causa sigue sin confirmar.
- La guarda rechaza patrones de `Glob` absolutos aunque apunten dentro del proyecto. Es un falso positivo menor: el Paladín siguió con rutas relativas.
