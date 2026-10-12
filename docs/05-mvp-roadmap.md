# 05 — Hoja de ruta del MVP

**Fecha:** 2026-10-10 · **Estado:** Fase 1 completada · Fase 2 completada · actualizado 2026-10-11

## Estado a 2026-10-11

| Fase | Estado | Referencia |
|---|---|---|
| 1. PoC | **Completada.** 7 PASS y 1 INCONCLUSIVE (P8, `permissionMode`, que se descarta como control) | `06`, `07` |
| 2. Núcleo del gremio | **Completada.** 125 pruebas automáticas. En vivo: misión de 3 subtareas con dependencias → `LOGGED`, misión de fallo → `BLOCKED`, recuperación tras reinicio de la sesión → `PAUSED` sin relanzar nada. Opcional: reinicio con un agente en curso | `08`, `09`, `10` |
| 3. Tablón pixel art | **En curso.** 3.1 capa temática de rol hecha (textos de dos capas, voces, glosario, opción `theme`). Siguiente: tablón con sprites dibujados en Aseprite | §1, `11` §8 |
| 4. Endurecimiento | No iniciada | §1 |

**Cambios respecto a lo planeado:**
- La misión de fallo termina en **`BLOCKED`**, por repetirse la misma firma de fallo, no en `HALTED`. `HALTED` queda para los límites de presupuesto, tiempo o rondas sin progreso y para la seguridad.
- La autonomía se reforzó a petición de la persona usuaria:
  - Las acciones que no encajan en el protocolo se rechazan con una explicación en lugar de preguntar.
  - El Maestro solo se vigila mientras la misión trabaja.
  - `autoApprovePlan` es opcional y aprueba solo planes no sensibles.
- La UI mínima incluye además una línea de estado fija y avisos, porque sin ellas no se sabía si la misión trabajaba o había terminado.

## 0. Requisitos previos (los tiene que hacer el usuario)

- [ ] Confirmar con `/status` en el Code tab que el motor es ≥ 2.1.286 (hoy: 2.1.295).
- [ ] Decidir si se actualiza e inicia sesión en el CLI de terminal (hoy 2.1.280, sin sesión). No bloquea el desarrollo en Desktop, pero `claude plugin validate` y `claude plugin test` se ejecutan desde la terminal.
- [ ] Decidir si `GuildFlow/` pasa a ser un repo git propio. Hoy la carpeta está dentro de un repo en `C:\` con propietario dudoso (`git` lo rechaza). `research/` debería ir en `.gitignore`.

## 1. Fases

### Fase 1: PoC de capacidades (validar, no construir producto)

Un mod desechable que responde a las incertidumbres de `02-architecture-decision.md` §5. Cada punto pasa o falla con evidencia.

| # | Prueba | Criterio de éxito |
|---|---|---|
| P1 | Lanzar `guildflow:artifice` (Sonnet) y `guildflow:escriba` (Haiku) con una tarea trivial | `turn.step` informa de `claude-sonnet-5-5` / `claude-haiku-5-5` y del esfuerzo esperado; sin errores de modelo no disponible |
| P2 | `agent.spawn` reescribe `model`; `turn.step` reescribe `effort` | El modelo/esfuerzo efectivo coincide con el rol aunque el Maestro pase otro |
| P3 | Veto por `paths` en `tool.call` con `agentId` | Un `Edit` fuera de las rutas asignadas se rechaza con mensaje claro |
| P4 | `classic.Stop` de un mod: un bloqueo, respeto de `stop_hook_active` | El turno continúa una vez y no se encadena |
| P5 | Contabilidad de `turn.complete.usage` (principal + subagentes) | La suma de tokens cuadra con `/cost` o `/status` (±5 %) |
| P6 | Persistencia: recargar el mod y reiniciar Desktop | `quest.json` + `$.store` restauran el estado; agentes `running` → `lost` |
| P7 | Panel `Pane` con `Svg` animado (SMIL, `isInteractive`) y con `Client` | Un sprite de 32×32 animado a ≥8 fps sin bloquear la UI; medir el tamaño máximo útil (límite de 131 072 caracteres por SVG) |
| P8 | `$.agent.register` con `permissionMode` | Documentar si se respeta o se ignora |

**Salida:** `docs/06-poc-results.md` con el resultado de cada prueba. Si P1 o P7 fallan, se vuelve a revisar la arquitectura antes de seguir.

### Fase 2: Núcleo del gremio (sin pixel art)

- Plugin `guildflow` con `agents/archimago.md`, `artifice.md`, `paladin.md` según `03-agent-role-matrix.md`.
- Skill `guildflow` con el protocolo de misión para el Maestro.
- Mod: máquina de estados, `quest.json`/`log.jsonl`, límites de `userConfig`, vetos (`paths`, lista negra, delegación anidada), verificación ejecutada por el mod, firma de fallos.
- Comandos: `/quest <petición>`, `/quest-status`, `/quest-halt`, `/quest-resume`.
- UI mínima: banda `AbovePrompt` con estado de misión y una fila por agente (patrón de claude-mods).
- Tests con `claude plugin test`: transiciones de estado, cada límite, cada veto, recuperación.

**Criterio de fin:** una misión real de 2-3 subtareas en un repo de prueba completa el ciclo `INTAKE → DONE` y una misión diseñada para fallar termina en `HALTED` por el límite correcto.

### Fase 3: Tablón del gremio (pixel art)

- Panel lateral con el tablón: mostrador, mesa de mapas, forja y campo de pruebas, con los personajes cambiando de estado según los eventos.
- Activos propios. Decidir entre generación procedural (como `portraitArt.ts`, pero con diseños nuestros) y sprites dibujados (Aseprite está disponible en este entorno como MCP).
- Créditos y licencias en `ASSETS.md`.

**Estado (2026-10-12):** 3.1, la capa temática, está hecha. El tablón también: sprites procedurales en `src/sprites.ts`, SMIL de 2 fotogramas con interruptor y licencias en `ASSETS.md`. El panel muestra la sala, las acciones, el progreso, los encargos, el tesoro y la bitácora. Falta verlo en vivo en Desktop y medir los fps con `Client` antes de pensar en animación continua.

**Antes de la Fase 3** (recomendado tras la Fase 2):
- Opcional: V16b de `10-test-results.md` (reinicio con un Artífice en curso).
- Hacer una misión real en un repositorio propio, no en el testbed, para medir el coste y los diálogos en un caso de uso real.

**Para el tablón:**
- Leer la vista desde `guildflow.view` (`$.state`), que ya existe; no hace falta tocar `machine.ts`.
- Seguir con SVG estático o SMIL, validado en P7. Medir el rendimiento con `Client` antes de añadir animación continua.

### Fase 4: Endurecimiento

- ~~Sandbox opcional: ejecutar `run_check` dentro de un contenedor o máquina virtual configurable.~~ **Hecho (2026-10-12):** opción `sandbox: docker` (ver `09` §1 y `10` V21).
- ~~Lista blanca de extensiones de código para `autoApprovePlan`.~~ **Hecho (2026-10-12):** `autoApproveExtensions`, comprobada al aprobar y al escribir, más la lista negra de nombres sensibles.
- ~~Worktrees para Artífices en paralelo + integración en serie.~~ **Hecho (2026-10-12):** talleres en lugar de worktrees de git (`08` §9), opción `maxParallelArtifices`.
- ~~Escriba-LLM opcional (Haiku) para resúmenes.~~ **Hecho (2026-10-12):** opción `escriba: haiku`, una llamada `$.model.complete` sin herramientas después de cerrar la misión.
- ~~Empaquetado como marketplace (`.claude-plugin/marketplace.json`) y guía de instalación.~~ **Hecho (2026-10-12):** marketplace `guildflow` en la raíz del repositorio (`source: ./guildflow`), versión 0.3.0. Instalación probada desde la carpeta en una configuración aislada (`10` V22); desde GitHub, cuando la rama esté en `main`.

### Aplazado (sin fecha)

Servicio local auxiliar, agent teams, workflows como motor del ciclo, memoria semántica, oficina con desplazamiento libre de personajes. Motivos en `02-architecture-decision.md` §3.

## 2. Recomendación final

**Qué construir primero:** el **núcleo del gremio sin gráficos** (fase 2): tres subagentes con modelo, esfuerzo y herramientas fijados, más un mod que haga cumplir el ciclo y sus límites. Es donde está el valor real: delegación controlada con verificación objetiva. Hoy no existe nada que lo haga por ti, y no depende de ninguna incertidumbre visual.

**Qué validar con una prueba de concepto:** antes de la fase 2, las pruebas **P1 (Sonnet/Haiku disponibles), P2 (imposición de modelo y esfuerzo), P3 (veto por rutas) y P5 (contabilidad de tokens)**. Son las cuatro sobre las que descansa el diseño de seguridad. La **P7 (pixel art en `Svg`/`Client`)** se puede validar en paralelo, porque decide si la fase 3 es viable dentro de Desktop o hay que replantearla.

**Qué no merece la pena todavía:**

- El **servicio local auxiliar** y la **app independiente**: resuelven trabajo fuera de sesión, que nadie ha pedido aún, a costa de duplicar la complejidad.
- **Agent teams**: experimental, sin reanudación, sin anidamiento.
- Un **Archimago siempre activo** y un **Escriba LLM** fijo: duplican al Maestro (si corre en Opus) y a la bitácora mecánica, respectivamente.
- La **oficina animada** con desplazamiento y pathfinding: es lo más vistoso y lo menos útil. Primero un tablón con estados.
- Límites en **dólares**: la API solo da tokens; una tabla de precios propia se queda obsoleta.

## 3. Incertidumbres que siguen abiertas

| # | Incertidumbre | Se resuelve en |
|---|---|---|
| U1 | Disponibilidad de Sonnet 5.5 / Haiku 5.5 en la cuenta | P1 |
| U2 | `$.agent.register` y `permissionMode`/`hooks` | P8 |
| U3 | Rendimiento de `Svg`/`Client` en el panel de Desktop | P7 |
| U4 | Interacción del `classic.Stop` de un mod con el tope de 8 continuaciones | P4 |
| U5 | Estabilidad de la API de mods entre versiones (early access) | Seguimiento continuo; fijar la versión mínima probada |
| U6 | Origen y licencia exacta de los `.wav` de claude-mods (si se reutilizaran) | Preguntar al autor o no reutilizarlos |
| U7 | Repo canónico de Munder Difflin (`HarnessMD` frente a `chaitanyagiri`) | Irrelevante mientras no copiemos código |

**Resueltas:**
- U1: Sonnet y Haiku están disponibles (P1).
- U2: `permissionMode` no es fiable como control (P8).
- U3: el SVG en el panel es viable (P7, sin cifra de fps).
- U4: `classic.Stop` no se usa como motor de autonomía (P4).
- U6 y U7: no se reutiliza nada de esos repositorios (ver `guildflow/ASSETS.md`).

**Sigue abierta:** U5, la estabilidad de la API de mods. La versión mínima probada es la 2.1.295.
