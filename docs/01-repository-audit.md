# 01 — Auditoría de los repositorios de referencia

**Fecha:** 2026-10-10 · **Fase:** 0 (solo análisis) · **Estado:** borrador para revisión

## 0. Método y alcance

- Clonado superficial (`git clone --depth 1`) en `research/`. No se instalaron dependencias, no se ejecutó ningún script y no se modificó ningún archivo de los repositorios.
- Lectura directa del código fuente, manifiestos, licencias y documentos de diseño. Las afirmaciones llevan referencia a archivo; lo que no se pudo comprobar se marca como **[no verificado]**.

| Repo | Remoto clonado | Commit (HEAD) | Fecha del commit | Archivos |
|---|---|---|---|---|
| Munder Difflin | `github.com/HarnessMD/munder-difflin` | `7f32815` | 2026-10-09 | 2 838 |
| claude-mods | `github.com/zycck/claude-mods` | `3539d02` | 2026-10-08 | 29 |

> Nota: el `package.json` de Munder Difflin declara como repositorio `chaitanyagiri/munder-difflin` y su catálogo remoto de modelos se descarga de esa ruta (`src/main/modelCatalog.ts`). El repo `HarnessMD/...` parece ser una transferencia o fork. **[no verificado]** cuál es el canónico.

---

## 1. Munder Difflin

### 1.1 Qué es

Una **aplicación de escritorio Electron independiente** que envuelve CLIs de agentes reales (`claude`, `codex`, `gemini`, `qwen`… hasta 12 motores; `README.md` §Supported agents) como procesos en pseudo-terminales, y los representa como avatares en una oficina pixel art. Encima añade una capa multiagente llamada **Hive**.

No es un plugin de Claude Code: **Claude Code es su runtime**, y la app es visor + controlador + coordinador (`SPEC.md` §1).

### 1.2 Stack y dependencias (`package.json`, v0.4.6)

| Capa | Tecnología |
|---|---|
| Shell | Electron 32, electron-vite, electron-builder |
| UI | React 18 + TypeScript, zustand, i18next |
| Escena | **Pixi.js 8** (oficina 2D, sprites, pathfinding A*: `scene/office/pathfinding.ts`) |
| Terminal | xterm.js + **node-pty** (nativo; parches en `postinstall`) |
| Persistencia | **better-sqlite3** (nativo, WAL), archivos markdown/JSON, repo git propio |
| Extras | Monaco/CodeMirror (IDE), OpenAI Realtime (voz), Slack, webhooks, túneles (`localtunnel`, `tunnelmole`), telemetría PostHog |

Incoherencias detectadas: `package.json` dice 0.4.6, el README afirma "Shipped through v0.5.3". `SPEC.md` describe tmux como plano de terminal, pero el código usa node-pty (`src/main/pty.ts`); el SPEC está desactualizado respecto al código.

### 1.3 Arquitectura: dos planos de datos (`SPEC.md` §2, `README.md` §Architecture)

1. **Plano de terminal:** cada agente es un proceso real en un PTY; la app muestra los bytes tal cual (xterm.js) y escribe en él.
2. **Plano de eventos:** cada agente se lanza con `--settings <archivo>` que conecta sus **hooks de configuración** (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`/`PostCompact`…) a un *shim* que reenvía el JSON a un **socket de dominio Unix** propiedad del proceso principal (`src/main/hooks.ts`, `hive.ts:996-1004`). Tamaño máximo de trama: 256 KB (`hooks.ts:25`).

Los avatares se mueven a "estaciones" según la herramienta en uso (Read/Edit → estantería, Bash → terminal, WebFetch → portal, `mcp__*` → rincón MCP, Notification → buzón). Máquina de estados: `idle → alert → thinking → working → success/blocked/ghost` (`SPEC.md` §4).

### 1.4 Orquestación y coordinación: el Hive (`HIVE.md`, `src/main/hive.ts`, 3 669 líneas)

| Mecanismo | Implementación | Patrón |
|---|---|---|
| Estado compartido | Carpeta `hive/` que es un repo git; **solo el proceso principal hace commit** (evita `index.lock`) | Single committer |
| Escritura | Cada agente escribe solo en `agents/<id>/`; nunca dos procesos sobre un archivo | Single writer per file |
| Mensajería | `outbox/` → *router* → `inbox/` de destino; un JSON por mensaje, escritura atómica (temp + `rename`) | Mailbox / actor |
| Esquema de mensaje | `act: request\|inform\|propose\|query\|agree\|refuse\|done`, `hops` incrementa por respuesta y tiene tope | FIPA-lite, anti-livelock |
| Plan compartido | `board.md`, editado solo por el agente "dios" | Blackboard con un único escriba |
| Ledger | `tasks.json` con estados `todo\|doing\|blocked\|done` (`hive.ts:124`), `log.jsonl` append-only | Task ledger + event log |
| Coordinador | Agente "dios" (Michael), proceso `claude` normal con prompt de escalado; el mecanismo (git, sockets, routing) está en el proceso principal | Supervisor |
| Delegación | El dios escribe `spawn-requests/<id>.json`; la app lanza `worker-<id>` con `isolate: true` por defecto = **worktree git propio** (`hive.ts:1583`) | Worker efímero |
| Worktrees | Al destruir un worker, su worktree se **conserva** si tiene trabajo no integrado y un GC lo limpia después (`index.ts:361-421`) | Aislamiento + recuperación |

**Lección importante (`hooks.ts:490-500`):** la Fase 1 usaba el hook `Stop` con `decision: block` para que el agente siguiera drenando su buzón. Lo **retiraron**: "That old path bypassed terminal-draft/HITL safety and could spend credits while a user was answering a question". Ahora el buzón se entrega solo cuando el agente está en reposo, por una cola con guardas. Es un antecedente directo para nuestro ciclo autónomo: forzar continuaciones con `Stop` es frágil.

### 1.5 Memoria y persistencia

- `agents/<id>/memory.md` por agente + `board.md` compartido; índice semántico opcional con la CLI **MemPalace** (`src/main/memory.ts`), degradación a no-op si no está instalada.
- SQLite (`src/main/db.ts`): migraciones solo por *append* vía `PRAGMA user_version`; hoy guarda `kv` y `command_history`. El resto del estado del renderer sigue en `localStorage`.
- Reanudación de sesión y "durable persistence" declaradas en el README **[no verificado en ejecución]**.

### 1.6 Errores, progreso y recuperación: el *circuit breaker* (`src/main/breaker.ts`)

Política pura (sin efectos) con escalera **steer → constrain → stop**:

- Disparadores: llamadas idénticas repetidas (`repeatedToolLimit: 8`), tormenta de errores de API (`errorStormLimit: 5`), velocidad de tokens de salida (`60 000/min`), y **ausencia de progreso** medida por mtime de archivos de coordinación, del directorio de trabajo, herramientas distintas recientes y prompts humanos recientes (2 latidos seguidos).
- Sube **un nivel por latido**, baja uno por latido sano, y `hardStop` está **desactivado por defecto** (sin él nunca mata).
- Exención durante la compactación de contexto (`PreCompact`/`PostCompact`).
- El comentario de cabecera lo dice claro: "Claude Code exposes `--max-turns` but NO dollar ceiling, so we enforce one ourselves".
- Puerta HITL: `PreToolUse` devuelve `permissionDecision: deny` si el agente está pausado o la herramienta está bloqueada (`hooks.ts:502-520`).

### 1.7 Licencias

| Elemento | Licencia | ¿Reutilizable por GuildFlow? |
|---|---|---|
| Código fuente | **MIT** © 2026 Chaitanya Giri (`LICENSE`) | Sí, conservando el aviso de copyright |
| Tilesets `assets/tilesets/*.png` | **LimeZu "Modern Interiors" Complete Version** (`LICENSE-ASSETS`, `LIMEZUASSETS-LICENSE.txt`): "YOU CAN'T RESELL OR DISTRIBUTE THE ASSET TO OTHERS" | **No.** La licencia es del comprador; redistribuirlos desde nuestro repo la violaría. Hace falta comprar nuestra propia licencia o usar otro arte. |
| Mapas `maps/*.tmj` | Construidos sobre los tilesets LimeZu; vendorizados de `shahar061/the-office` (código ISC) | No (dependen del arte LimeZu) |
| Personajes (`portraitArt.ts`, `cast.ts`) | Procedurales, MIT | Técnicamente sí, pero representan al reparto de *The Office* (parodia declarada). **Riesgo de imagen o marca.** No los reutilizamos; sí la *técnica* de generación procedural. |
| Fuentes (Press Start 2P, Inter, JetBrains Mono) | SIL OFL 1.1 | Sí, con el aviso OFL |

Observación: `portraitArt.ts` (líneas 6-7) aún dice que los sprites andantes usan el recoloreado de LimeZu, mientras que `cast.ts` y `ATTRIBUTION.md` dicen que ya son procedurales. El código (`cast.ts:10` importa de `portraitArt`) confirma la segunda versión; el comentario está obsoleto.

### 1.8 Qué sirve como concepto y qué depende de una app independiente

| Reutilizable conceptualmente (sin copiar código) | Ligado a la app independiente |
|---|---|
| Mapeo evento de herramienta → estación/animación del avatar | Gestión de PTYs (node-pty), plano de terminal |
| Escalera steer → constrain → stop, sin matar por defecto | Escena Pixi.js, cámara, pathfinding |
| Detección de no-progreso por varias señales | IPC Electron main ↔ renderer |
| `hops` con tope contra ping-pong entre agentes | SQLite nativo, auto-updater, empaquetado |
| Un solo escritor por archivo y un solo escriba del plan | Multi-CLI (Codex, Gemini…), voz, Slack, túneles |
| Worktree por worker; conservar si hay trabajo sin integrar | Lanzar `claude` con `--settings` desde fuera |
| Ledger de tareas + log append-only | Agente "dios" como proceso permanente aparte |
| No forzar continuaciones con `Stop` | |

---

## 2. claude-mods (`plan-progress`)

### 2.1 Qué es

Un **mod** (plugin con *function hooks*) para Claude Code, v0.8.2, MIT © 2026 Kirill Serditov. Dibuja barras de progreso de plan sobre el campo de entrada, con una fila por subagente (nombre, modelo, esfuerzo, herramienta actual, duración). Funciona en terminal y en Desktop. **Requiere Claude Code ≥ 2.1.286** (`README.md`, `SKILL.md`).

Estructura (marketplace `zycck-mods`):

```
.claude-plugin/marketplace.json
plugins/plan-progress/
  .claude-plugin/plugin.json      # userConfig: doneBarSeconds; "types": "./types/index.d.ts"
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # ~2 100 líneas, todo el mod
  skills/plan-progress/SKILL.md   # referencia para el modelo
  types/index.d.ts                # contrato de $.state (PluginState)
  sounds/*.wav                    # decision / error / done
  tests/                          # motor stub + regress (debe imprimir "all passed") + 32 escenarios
```

### 2.2 API de mods que usa (verificado en `register.tsx`)

| Necesidad | API / evento | Línea aprox. |
|---|---|---|
| Estado de sesión que redibuja | `atom`, `read`, `update` de `'claude-code'` | 1, 7 |
| Persistencia entre sesiones | `$.store.get/set/delete/keys`, clave `plans:<sessionId>`, conserva 20 sesiones | 1425-1450 |
| Herramienta propia para el modelo | `$.tool.register({ name: 'plan_progress', inputSchema })` → `mcp__plan-progress__plan_progress` | 1654-1690 |
| Comandos `/progress…` | `$.command.register` + `on('command.run', { command })` | 1700-1810 |
| Reglas en el system prompt | `on('prompt.compose')` añade una sección `scope: 'session'` | 1711 |
| Contexto por prompt | `on('prompt.submit')` añade una línea con las barras abiertas | 1559 |
| Puerta de trabajo | `on('tool.call')`: rechaza **una vez** la 4.ª edición sin plan; recuerda actualizar tras 6 ediciones | 1411-1414, 1579 |
| Cierre de turno | `on('classic.Stop')`: bloquea **una sola vez** si quedan barras abiertas sin explicar; respeta `stop_hook_active` y tareas en segundo plano | 1623 |
| Seguimiento de subagentes | `agent.spawn` (alta), `turn.step` (modelo y esfuerzo resueltos), `turn.complete` (`reason: answer\|aborted\|refusal\|error`), `classic.PermissionRequest/Denied` | 2009-2120 |
| Plan Mode | `on('tool.call', { tool: 'ExitPlanMode' })` convierte el plan aprobado en barra | 1759 |
| Dibujo | `ui.render` en `AbovePrompt` y `SessionMode`; **SVG en Desktop**, `Raster` de caracteres en terminal | 1814, 1834 |
| Temporizadores | `$.clock.every(1000)` para guardar, plegar y limpiar | 1690 |
| Sonido | `$.audio.play`; en Windows, `$.process.run(['powershell', …SoundPlayer])` | 1198-1215 |

Detalle de diseño valioso: las filas de agentes **"cost no tokens"**: salen de eventos del motor, no de llamadas al modelo. Lo mismo vale para nuestra bitácora.

Otro detalle: los agentes no sobreviven al proceso. Al restaurar, las barras vuelven sin filas de agente (`restorePlans`, líneas 1444-1451). Cualquier diseño de reanudación tiene que tratar "agente en curso" como "perdido".

### 2.3 Licencias

- Código y sonidos: **MIT** (`LICENSE`, `plugin.json: "license": "MIT"`). Se puede copiar o adaptar conservando el aviso. Los `.wav` no tienen una licencia aparte; asumimos MIT por el `LICENSE` raíz **[no verificado su origen]**.
- `media/*.gif|mp4`: demos, no se necesitan.

### 2.4 Reutilización

| Reutilizable | Observaciones |
|---|---|
| Patrón "plan como estado + operaciones cortas" (`{id, next:true}`, `{done:[…]}`) validado contra títulos conocidos | Encaja con nuestras misiones y subtareas |
| Filas de subagente desde `agent.spawn`/`turn.step`/`turn.complete` | Base directa del "tablón del gremio" |
| Puertas `tool.call` y `classic.Stop` que bloquean **una vez** | Plantilla para nuestros límites |
| Banco de pruebas con motor stub | Referencia; hoy existe además `claude plugin test` oficial |
| **Instalarlo como dependencia** en vez de copiarlo | Opción a valorar: `dependencies` en `plugin.json`. Riesgo: acoplarnos a un tercero. |

---

## 3. Limitaciones de esta auditoría

1. No se ejecutó ninguno de los dos proyectos, así que el comportamiento en vivo (avatares, barras) se infiere del código y de los README.
2. El historial de commits no está disponible (clon superficial).
3. No se auditó `register.tsx` línea a línea (113 KB) ni `hive.ts`/`index.ts` completos; se leyeron las secciones de orquestación, estado, hooks y seguridad.
4. Las afirmaciones del README de Munder Difflin sobre rendimiento de memoria ("fastest memory layer in the world") son publicitarias y no se evaluaron.

## 4. Conclusiones para GuildFlow

1. **Munder Difflin** aporta los *patrones* de coordinación y seguridad (single writer, ledger, breaker, worktrees, `hops`), pero su forma, una app Electron que controla CLIs desde fuera, es justo lo que una arquitectura basada en mod puede evitar.
2. **claude-mods** demuestra que un mod puede, **dentro** de Claude Code Desktop, seguir subagentes con modelo y esfuerzo, persistir estado por sesión, imponer puertas y dibujar UI. Es la referencia técnica más cercana a lo que necesitamos.
3. **No copiamos ningún recurso gráfico.** El arte de Munder Difflin no es redistribuible y sus personajes plantean riesgo de marca. El pixel art de GuildFlow debe ser propio (procedural o dibujado) o tener una licencia comprada por nosotros.
