# 02 — Decisión de arquitectura (ADR-0001)

**Fecha:** 2026-10-10 · **Estado:** PROPUESTA, pendiente de revisión humana

## 1. Contexto: qué ofrece realmente el entorno

### 1.1 Versiones verificadas

| Componente | Versión | Cómo se verificó |
|---|---|---|
| Motor de Claude Code dentro de **Desktop (Code tab)** | **2.1.295** | Ruta `bundled-skills/2.1.295/…` y cabecera del archivo de tipos: `// Written by Claude Code 2.1.295.` |
| `claude` del PATH (terminal) | **2.1.280** | `claude --version` |
| Autenticación del CLI de terminal | **No iniciada** | `claude -p` responde `Not logged in · Please run /login` |
| Modelo de esta sesión | `claude-opus-5-5` | Contexto del sistema |

**Consecuencia:** los mods funcionan en Desktop desde la 2.1.286 y en terminal desde la 2.1.287 ([Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)). Hoy **funcionarían en Desktop (2.1.295) pero no en la terminal (2.1.280)** mientras no se actualice ese CLI.

### 1.2 Capacidades de un mod (docs oficiales + `types/claude-code.d.ts` de la 2.1.295)

| Capacidad | ¿Disponible en un mod? | Evidencia |
|---|---|---|
| Formato | Plugin con `.claude-plugin/plugin.json` + `hooks/hooks.json` `{ "modules": ["./register.tsx"] }` + módulo `register(on, options)` | reference.md, docs |
| Entorno de ejecución | Módulo ES aislado, **sin DOM ni Node**; todo pasa por `$`; **sin sandbox**: corre con los permisos del usuario | Mods overview, "Mods aren't sandboxed" |
| Desktop | Hooks **sí**; dibujo **sí**, salvo los elementos solo-terminal (`Raster`, `Image`). En sesiones WSL del Desktop **no** hay plugins | Tabla "Where mods run" |
| Dibujo en Desktop | `Box`, `Text`, `Button`, `Input`, `Select`, `Svg` (≤131 072 caracteres; `isInteractive` permite animación SMIL en un marco sin scripts), `Markdown`, `Code`, **`Client`** (módulo de superficie propio con reloj de fotogramas y puntero) | `Elements.desktop`, `SvgProps`, `ClientProps` |
| Lugares donde dibujar | Panel lateral (`$.ui.open` + `ui.render` `Pane`), banda sobre el prompt (`AbovePrompt`), spinner, filas de herramienta, `$.ui.status/toast/notify` | reference.md |
| Definir subagentes | `agents/*.md` del plugin, o `$.agent.register(AgentSpec)` con `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `isolation: 'worktree'`, `background`, `memory`, `skills`… | `AgentSpec` (types:440-530) |
| Lanzar subagentes desde código | `$.agent.spawn({ prompt, subagentType, model, cwd })`, **siempre en segundo plano**; responde con `agentId` | types:100-120, 3168 |
| Imponer modelo por rol | Hook `agent.spawn`: `model` es reescribible. Hook `turn.step`: `model` y `effort` reescribibles por petición, también en subagentes | `AgentSpawnInput`, `TurnStepInput` |
| Seguir el estado de los agentes | `agent.spawn`, `turn.start`, `turn.step` (modelo/esfuerzo resueltos), `turn.complete` (`reason` + `usage` en tokens), `tool.call` con `agentId`, `$.agent.list()` (`pending\|running\|waiting\|idle\|completed\|failed\|killed`), `classic.*` (los 33 eventos de hooks de configuración) | types, claude-mods |
| Puertas / vetos | `tool.call` → `{ deny }`; `classic.Stop` → `block`; `agent.spawn` reescribe o rechaza; `.catch` para fallar en cerrado | reference.md |
| Persistencia | `$.state` (sesión, la guarda el host y sobrevive a recargas del mod), `$.store` (entre sesiones), `$.fs` (archivos), `${CLAUDE_PLUGIN_DATA}` | reference.md, plugins-reference |
| Segundo plano | Timers `$.clock.every/after` iniciados en `session.start`; `$.prompt.submit` despierta una sesión inactiva; subagentes en background; *workflows* | reference.md §Work that outlives a dispatch |
| Coste | `turn.complete.usage` da **tokens**, no dólares. No hay un tope de gasto nativo | `TurnUsage` |
| Herramienta propia para el modelo | `$.tool.register` → `mcp__<plugin>__<name>` (por defecto detrás de ToolSearch; `isDeferred: false` la deja visible) | reference.md |
| Estabilidad de la API | **"EARLY ACCESS: this surface may change between releases without notice."** | Cabecera de tipos |

### 1.3 Subagentes, modelos y esfuerzo (docs oficiales)

- **Alias → modelo** (API de Anthropic): `opus` → Opus 5.5, `sonnet` → Sonnet 5.5, `haiku` → Haiku 5.5, `fable` → Fable 5.1. En Bedrock, Vertex o Foundry los alias apuntan a modelos más antiguos ([model-config](https://code.claude.com/docs/en/model-config)).
- **Esfuerzo:** Opus 5.5, Sonnet 5.5 y Haiku 5.5 admiten `low | medium | high | xhigh | max`; **por defecto `medium`** en los tres. Si un modelo no admite un nivel, se baja al más alto admitido.
- **Precedencia del esfuerzo:** el frontmatter del subagente "overrid[es] the session level but **not the environment variable**" (`CLAUDE_CODE_EFFORT_LEVEL`). `max` no se acepta en las claves de `settings.json` (`effortLevel`, `modelSettings`), pero sí en el frontmatter.
- **Precedencia del modelo:** parámetro `model` de la invocación > `model` de la definición > `CLAUDE_CODE_SUBAGENT_MODEL` > modelo de la sesión. Un hook `agent.spawn` de un mod sustituye al primero.
- **Agentes de plugin (`agents/*.md`):** se ignoran `hooks`, `mcpServers`, `permissionMode` e `initialPrompt` ([sub-agents](https://code.claude.com/docs/en/sub-agents)).
- **Anidamiento:** por defecto un subagente puede lanzar subagentes **hasta 3 niveles** por debajo de la conversación principal (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; `1` lo desactiva).
- **Concurrencia:** con **20** subagentes en marcha, el siguiente falla con `Concurrent subagent limit reached` (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). No hay límite total por sesión.
- **Memoria persistente por agente:** `memory: user | project | local` → `.claude/agent-memory/<agente>/MEMORY.md` (se cargan las primeras 200 líneas o 25 KB).
- **Hook `Stop`:** tope de **8 continuaciones seguidas**; el contador se reinicia con cada llamada a herramienta (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). `stop_hook_active` señala que ya se está continuando.
- **Workflows dinámicos:** script JS con `agent()`, `parallel()`, `pipeline()`; 16 agentes concurrentes por defecto, **1 000 agentes por ejecución**, **sin intervención del usuario a mitad de la ejecución**, reanudables dentro de la sesión. Se distribuyen en plugins (`workflows/`) ([workflows](https://code.claude.com/docs/en/workflows)).
- **Agent teams:** **experimental** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); sin equipos anidados, `/resume` no restaura a los compañeros en proceso, un equipo por sesión ([agent-teams](https://code.claude.com/docs/en/agent-teams)).

### 1.4 Disponibilidad real de modelos en este entorno

| Modelo | Estado |
|---|---|
| Opus 5.5 | **Verificado**: esta sesión corre en `claude-opus-5-5` |
| Sonnet 5.5 / Haiku 5.5 | **No verificado empíricamente.** El CLI de terminal no tiene sesión iniciada, así que no pudo sondear, y no lancé subagentes de prueba porque no me lo pediste. Indicios a favor: la herramienta Agent de esta sesión ofrece `sonnet\|opus\|haiku\|fable`, y `~/.claude/settings.json` no define ninguna `availableModels` ni sustitución de modelo. |

→ Es la **primera comprobación de la PoC** (ver `05-mvp-roadmap.md`).

## 2. Alternativas evaluadas

1. **Plugin/mod integrado** en Claude Code Desktop.
2. **Plugin + servicio local auxiliar** (daemon Node con SQLite o HTTP para coordinación y persistencia).
3. **Aplicación de escritorio independiente** al estilo Munder Difflin (Electron + PTYs + Pixi).

| Criterio | 1. Mod | 2. Mod + servicio | 3. App independiente |
|---|---|---|---|
| Complejidad inicial | **Baja-media.** Un módulo TS + agentes `.md` | Media-alta: dos procesos, protocolo, ciclo de vida del daemon, puertos | **Muy alta**: Electron, node-pty nativo, IPC, empaquetado y firma (Munder: ~23 000 líneas solo en `src/main`) |
| Coste operativo | Ninguno extra; lo instala `/plugin install` | Instalar, arrancar y vigilar un daemon; actualizar ambos a la vez | Builds por SO, auto-updater, firma de código |
| Experiencia de usuario | **Dentro** del Code tab: panel, banda, comandos. Sin cambiar de app | Igual que la 1, más fallos del daemon visibles | App aparte; experiencia rica, pero el usuario abandona Desktop |
| Aislamiento de agentes | Subagentes con contexto propio, `tools` restringidas, `isolation: worktree` nativo | Igual que la 1 | **Máximo**: procesos `claude` separados, cada uno con su sesión |
| Ejecución persistente | Limitada a la vida de la sesión; estado durable en `$.store` y archivos, pero **los agentes no sobreviven al proceso** | **Sí**: el daemon sobrevive a la sesión y puede reanudar o planificar | Sí, mientras la app esté abierta |
| Interfaz pixel art | SVG (con SMIL) y `Client` con reloj de fotogramas en el panel; **resolución y FPS por validar** | Igual que la 1 | Libre (Pixi/WebGL), sin restricciones |
| Mantenimiento | Riesgo: **API early access**, puede romperse entre versiones. Superficie pequeña | Doble superficie + protocolo propio | Grande; depende de flags de CLI y formatos de hooks que también cambian |
| Seguridad | Corre sin sandbox, con permisos del usuario; superficie auditable con `claude plugin validate` | Añade un puerto o socket local que hay que proteger | Añade PTYs, túneles y telemetría (como Munder) |
| Encaje con "Desktop" | **Nativo**, el objetivo declarado | Nativo + extra | No es un mod: contradice el objetivo |

## 3. Decisión recomendada

**Alternativa 1: un único plugin `guildflow` (mod + agentes + skill), sin servicio auxiliar.**

Composición:

```
guildflow/
  .claude-plugin/plugin.json      # userConfig: límites (intentos, tokens, tiempo, archivos)
  agents/archimago.md             # opus · high
  agents/artifice.md              # sonnet · high · isolation opcional
  agents/paladin.md               # sonnet · high · solo lectura + comandos de verificación
  skills/guildflow/SKILL.md       # protocolo de misión para el Maestro (sesión principal)
  hooks/hooks.json
  hooks/register.tsx              # máquina de estados, límites, bitácora, UI
  types/index.d.ts                # contrato de $.state
```

Estado durable **en el proyecto** (`.guildflow/`): `quest.json` (misión, subtareas, criterios, intentos) y `log.jsonl` (append-only). Escribe **solo el mod** (patrón single writer de Munder). `$.store` guarda punteros y preferencias.

### Por qué

1. Desktop 2.1.295 ya ofrece lo que en Munder exigía una app entera: eventos de agente con modelo y esfuerzo, vetos, persistencia y UI dentro del Code tab.
2. claude-mods demuestra en producción el patrón de seguimiento de subagentes **sin coste de tokens**.
3. El modelo, el esfuerzo y las herramientas por rol se imponen de forma nativa (frontmatter + `agent.spawn` + `turn.step`), no por convención.
4. El servicio auxiliar solo resuelve la **ejecución persistente fuera de sesión**, que el MVP no necesita (ver más abajo).

### Funciones aplazadas

| Aplazado | Por qué | Cuándo reconsiderarlo |
|---|---|---|
| Servicio local / daemon | Solo hace falta para trabajo que sobreviva al cierre de la sesión | Si la PoC muestra que las misiones superan con frecuencia la vida de una sesión |
| Oficina pixel art animada con desplazamiento de personajes | Depende de validar `Svg`/`Client` en Desktop | Tras la PoC visual (fase 3) |
| Agent teams y sesiones independientes | Experimental, sin `/resume`, sin anidamiento | Cuando salga de experimental |
| Workflows dinámicos como motor del ciclo | No admiten aprobación humana a mitad de ejecución | Posible para el sub-ciclo "implementar → verificar" de una subtarea ya aprobada |
| Memoria semántica (tipo MemPalace) | La memoria nativa `memory: project` y la bitácora cubren el MVP | Si la bitácora deja de caber en contexto |
| Multi-CLI (Codex, Gemini…) | Fuera de alcance | No previsto |

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La API de mods cambia (early access) | Fijar la versión mínima probada; tests con `claude plugin test`; aislar el acceso a `$` en un solo archivo |
| El mod corre sin sandbox | Mínimo privilegio: sin red; `$.process.run` solo para los comandos de verificación declarados en la misión; `$.fs` limitado a `.guildflow/` |
| `CLAUDE_CODE_EFFORT_LEVEL` en el entorno anula el esfuerzo por rol | Detectarlo en `session.start` y avisar; reforzar en `turn.step` |
| CLI de terminal en 2.1.280 | Documentarlo: GuildFlow es solo para Desktop hasta que se actualice el CLI |
| Los agentes se pierden al reiniciar | Al restaurar, marcar como `lost` y re-encolar (lección de claude-mods) |
| Plugins no disponibles en sesiones WSL de Desktop | Documentar la incompatibilidad |

## 5. Incertidumbres abiertas (las resuelve la PoC)

1. ¿`$.agent.register` respeta `permissionMode`/`hooks` o los ignora como `agents/*.md`?
2. Rendimiento y límites reales de `Svg` animado y de `Client` en el panel de Desktop.
3. Disponibilidad de Sonnet 5.5 y Haiku 5.5 en la cuenta.
4. ¿El hook `classic.Stop` de un mod cuenta para el tope de 8 continuaciones igual que un hook de configuración?
5. Comportamiento de `$.state`/`$.store` tras un reinicio completo de la app Desktop.
