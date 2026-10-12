# 03 — Matriz de roles de agentes

**Fecha:** 2026-10-10 · **Estado:** propuesta

## 1. Tres tipos de "agente" que no hay que confundir

| Tipo | Qué es en Claude Code | Contexto | Puede hablar con el usuario | Coste |
|---|---|---|---|---|
| **Rol lógico** | Un nombre y una responsabilidad del flujo. No tiene por qué ser un proceso ni un LLM | n/a | n/a | 0 |
| **Subagente real** | Definición `agents/<rol>.md` del plugin (`guildflow:<rol>`), lanzada con la herramienta Agent o con `$.agent.spawn` | Propio, nuevo en cada llamada; devuelve un resultado al llamante | **No.** Su `AskUserQuestion` llega a Claude, no a la persona (lo confirma claude-mods, `register.tsx:1748`) | Tokens propios |
| **Sesión independiente** | Otro proceso `claude` (agent teams, otra pestaña del Code tab, app externa tipo Munder) | Totalmente aparte; sobrevive al turno | Sí, en su propia sesión | El más alto |

**Regla de diseño:** un rol lógico solo pasa a ser subagente real si gana algo concreto, es decir, **contexto limpio, modelo o esfuerzo distinto, herramientas restringidas o independencia de juicio**. Si no gana nada de eso, es código del mod o una instrucción para la sesión principal.

## 2. Evaluación de la propuesta provisional

| Rol propuesto | Veredicto | Motivo |
|---|---|---|
| **Maestro del Gremio** | **Sesión principal, no subagente** | Es el único que puede pedir aprobación al usuario, el único que ve toda la conversación y el único que coordina (los subagentes no se coordinan entre sí). Hacerlo subagente añadiría un salto sin beneficio. Su política de delegación vive en la skill `guildflow` y el mod la impone. |
| **Archimago** | **Subagente, condicional** | Si el Maestro ya corre en Opus 5.5, planificar en otro Opus **duplica la función**. Gana en dos casos: (a) misiones grandes en las que conviene un contexto limpio que no arrastre la conversación, (b) cuando el Maestro corre en Sonnet para ahorrar. Para misiones pequeñas, el Maestro planifica directamente (o en Plan Mode). |
| **Artífice** | **Subagente** | Contexto acotado a su subtarea, modelo más barato, puede ir en worktree aislado. Es el que más justifica existir. |
| **Paladín** | **Subagente obligatorio** | La independencia es todo su valor: contexto distinto al del Artífice, sin herramientas de edición, juzga contra los criterios y no contra las afirmaciones del Artífice. Revisión, seguridad y pruebas van en **un solo** rol: dividirlo en tres sería duplicar. |
| **Escriba** | **Mayormente código del mod; LLM opcional** | La bitácora, el estado y el progreso salen de eventos (`agent.spawn`, `turn.complete`, `tool.call`) **sin coste de tokens**, como demuestra claude-mods. Un LLM solo aporta la redacción del resumen final para humanos; eso puede hacerlo Haiku de forma puntual, o el propio Maestro en una línea. |

Resultado: **5 roles lógicos → 1 sesión principal + 3 subagentes reales (Archimago, Artífice, Paladín) + 1 rol mecánico (Escriba-código) con un subagente Haiku opcional.** Ninguna sesión independiente en el MVP.

## 3. Matriz definitiva

Identificadores verificados para la versión instalada (2.1.295): alias `opus | sonnet | haiku` (→ 5.5 en la API de Anthropic) o IDs completos `claude-opus-5-5 | claude-sonnet-5-5 | claude-haiku-5-5`; esfuerzo `low | medium | high | xhigh | max`; campos de frontmatter `name, description, tools, disallowedTools, model, effort, maxTurns, memory, background, isolation, skills, color` (docs de sub-agents).

**Recomendación:** fijar los **IDs completos** en las definiciones para que los resultados sean reproducibles (los alias cambian con cada lanzamiento de modelo) y exponerlos en `userConfig` para poder cambiarlos sin tocar código.

| Rol | Tipo | `model` | `effort` | `tools` | `disallowedTools` | `maxTurns` | Otros |
|---|---|---|---|---|---|---|---|
| **Maestro del Gremio** | Sesión principal | Lo elige el usuario; recomendado `claude-opus-5-5` | `medium` (por defecto de 5.5); `high` en misiones grandes | Todas | — | — | Skill `guildflow`; el mod impone límites |
| **Archimago** `guildflow:archimago` | Subagente | `claude-opus-5-5` | `high` (`xhigh` por `userConfig` en misiones de arquitectura) | `Read, Grep, Glob, WebFetch, WebSearch` | `Edit, Write, Bash, PowerShell, Agent` | 25 | Devuelve el plan en JSON estructurado; **no escribe archivos**: los persiste el mod |
| **Artífice** `guildflow:artifice` | Subagente | `claude-sonnet-5-5` | `high` | `Read, Grep, Glob, Edit, Write, Bash` (o `PowerShell` en Windows) | `Agent, WebFetch, WebSearch` | 40 | `isolation: worktree` cuando hay Artífices en paralelo; edita solo las rutas que su subtarea tenga asignadas (lo impone el mod en `tool.call`) |
| **Paladín** `guildflow:paladin` | Subagente | `claude-sonnet-5-5` | `high` | `Read, Grep, Glob, Bash` | `Edit, Write, NotebookEdit, Agent` | 25 | Ejecuta los comandos de verificación de la misión; devuelve un veredicto por criterio con evidencia. **Nunca** es la misma invocación que el Artífice |
| **Escriba** | Código del mod | — | — | — | — | — | `log.jsonl` + panel; 0 tokens |
| Escriba con modelo (opcional, `escriba: haiku`) | **Llamada del mod** (`$.model.complete`), no subagente | `claude-haiku-5-5` | `low` | **ninguna** | — | 1 llamada, 600 tokens de salida, 20 s | Fase 4: al cerrar, resume en 3-5 frases la crónica mecánica y va arriba, marcado como generado; los datos no cambian. Sin herramientas, no puede leer, escribir ni delegar |

**Sobre los niveles pedidos:**

- Archimago: Opus 5.5, `high` por defecto. Dejar `xhigh` opcional, porque su coste solo compensa en diseño grande.
- Artífice: Sonnet 5.5 `high`, conforme a la propuesta.
- Paladín: la propuesta no fijaba esfuerzo. Recomiendo `high`, porque una revisión superficial es el fallo más caro del ciclo.
- Escriba: Haiku 5.5 `low`; `medium` no aporta nada para resumir.
- `max`: no se usa en ningún rol por defecto. Coste alto y rendimiento decreciente.

## 4. Cómo se impone (no solo se sugiere)

1. **Frontmatter**: establece modelo, esfuerzo, herramientas y `maxTurns`.
2. **Hook `agent.spawn`**: si se lanza un `guildflow:*`, reescribe `model` con el del rol aunque el Maestro haya pasado otro, y rechaza el lanzamiento si se superan los límites (ver `04-autonomy-and-safety.md`).
3. **Hook `turn.step`**: si llega un `effort` distinto del que corresponde, lo corrige. Desde la Fase 4: Artífice según la subtarea (`effort` del plan o complejidad), Paladín `high`, Archimago `archimagoEffort` y Maestro `maestroEffort` (`medium`) mientras la misión trabaja; ver `08` §2. Matiz: `CLAUDE_CODE_EFFORT_LEVEL` en el entorno tiene prioridad sobre el frontmatter según la documentación; el mod lo **detecta y avisa** en `session.start`.
4. **Hook `tool.call` con `agentId`**: bloquea ediciones fuera de las rutas asignadas, y cualquier `Edit`/`Write` del Paladín aunque la lista de herramientas falle.
5. **Anidamiento**: los tres subagentes llevan `Agent` en `disallowedTools`. Toda delegación pasa por el Maestro, lo que deja **un nivel** de profundidad, aunque la plataforma admita tres.

> Limitación conocida: el Paladín tiene `Bash`, y Bash puede escribir archivos. El veto real es el hook `tool.call`, que solo permite los comandos de verificación declarados (lista blanca por prefijo de argv). Eso queda pendiente de validar en la PoC.

## 5. Personajes pixel art (solo diseño)

| Rol | Clase D&D | Estación en el tablón | Estados visuales |
|---|---|---|---|
| Maestro | Maestro del gremio (tras el mostrador) | Mostrador de misiones | esperando · asignando · pidiendo aprobación |
| Archimago | Mago | Mesa de mapas | leyendo (Read/Grep) · consultando el oráculo (Web) · trazando plan |
| Artífice | Artífice/herrero | Forja | forjando (Edit/Write) · probando (Bash) · atascado |
| Paladín | Paladín | Puerta / campo de pruebas | inspeccionando · ejecutando pruebas · veredicto ✓/✗ |
| Escriba | Escriba | Atril con pergamino | anotando (cada evento) |

Activos propios (procedurales o dibujados por nosotros) o con licencia comprada. **Nada del arte de Munder Difflin** (ver `01-repository-audit.md` §1.7). El estado de cada personaje sale de `agent.spawn`/`tool.call`/`turn.complete` (mismo mapeo herramienta → estación que en Munder, implementación propia).
