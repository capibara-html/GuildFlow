# GuildFlow

Misiones de programación con un gremio de agentes dentro de Claude Code:

- **Maestro**: tu sesión. Planifica y coordina.
- **Archimago**: planificador Opus, solo lectura.
- **Artífice**: implementador Sonnet, limitado a las rutas aprobadas.
- **Paladín**: revisor Sonnet, solo lectura.

Un mod hace cumplir el ciclo en código: plan con criterios verificables, aprobación, implementación, verificación ejecutada por el propio mod, revisión independiente, corrección acotada y resumen. Hay límites duros de intentos, tokens, coste, uso de la suscripción y tiempo.

> **Aviso.** Un plugin de Claude Code se ejecuta sin sandbox, con tus permisos. Las comprobaciones ejecutan el código que escribe el Artífice. Úsalo en repositorios de confianza. Detalles en `docs/09-security-review.md`.

## Requisitos

- **Claude Code Desktop o CLI ≥ 2.1.295**, la versión probada. La API de mods está en acceso anticipado y puede cambiar entre versiones.
- El proyecto debe ser un repositorio **git**, porque `diff-scope` compara contra el `HEAD` aprobado.
- Los ejecutables que declaren tus comprobaciones. Por defecto se admiten: `node`, `git`, `tsc`, `python`, `py`, `pytest`, `cargo`, `go`, `dotnet`, `deno` y `bun`.
- Añade `.guildflow/` al `.gitignore` del proyecto. Ahí se guardan el estado, el registro y la evidencia.

## Cargarlo

**Instalarlo desde el marketplace** (recomendado). En una sesión de Claude Code en terminal:

```
/plugin install guildflow --marketplace capibara-html/GuildFlow
```

Responde `y` para añadir el marketplace, elige el ámbito (el de usuario es el primero) y ajusta las opciones en la pantalla que aparece; después puedes cambiarlas con `/plugin configure guildflow@guildflow`. Desde una carpeta local en vez de GitHub: `claude plugin marketplace add <ruta>/GuildFlow` y luego `claude plugin install guildflow@guildflow`. Instalado así, no lo cargues además por `CLAUDE_CODE_PLUGIN_DIRS`: tendrías dos copias.

**Para desarrollarlo: Desktop (Code tab) o CLI, cualquier sesión.** Añade la carpeta del plugin a `CLAUDE_CODE_PLUGIN_DIRS` en el bloque `env` de `~/.claude/settings.json`, con la ruta absoluta y sin comillas extra:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<tú>\\Desktop\\GuildFlow\\guildflow" } }
```

Inicia una sesión nueva en el proyecto. Una sesión interactiva de terminal vigila la carpeta y recarga el mod al guardar. Una sesión de Desktop solo lo hace si además defines `"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"` en el mismo bloque `env`; si no, el cambio se aplica en la siguiente sesión.

**CLI, una sola sesión:**

```bash
claude --plugin-dir /ruta/a/GuildFlow/guildflow
```

**Desarrollo en una sesión concreta de Desktop:** copia la carpeta en `~/.claude/dev-mods/<id-de-sesión>/guildflow/` y acepta "Enable hot reloading for this session".

Comprobar que está cargado: escribe `/quest-status`. Debe responder "Sin misión…".

## Configuración

Las opciones van en `~/.claude/settings.json`, en `pluginConfigs.guildflow.options`. Se probó que el `settings.local.json` del proyecto **no** las aplica.

```json
{ "pluginConfigs": { "guildflow": { "options": { "autoApprovePlan": true, "tokenBudgetPerQuest": 1000000 } } } }
```

| Opción | Por defecto | Notas |
|---|---|---|
| `autoApprovePlan` | `false` | Aprueba sin diálogo **solo** los planes que no son `large` y cuyos archivos tienen una extensión de `autoApproveExtensions` y un nombre no sensible: nada de dependencias, CI o despliegue, migraciones, secretos, configuración del repo, del editor o de herramientas que ejecutan código (`*.config.js`, `.algorc`), ni instrucciones de agentes (`CLAUDE.md`, `.claude/`, `.mcp.json`…). Dentro de un directorio concedido, cada archivo se comprueba al escribirlo |
| `autoApproveExtensions` | código, tests, estilos, HTML, Markdown, SVG | Lista blanca de extensiones para la aprobación automática. Por defecto sin `json`, `yaml` ni `toml` (configuración) ni archivos sin extensión |
| `maxAttemptsPerTask` · `maxQuestIterations` · `maxSameFailure` · `maxNoProgressRounds` | 3 · 8 · 2 · 2 | Topes 10 · 30 · 5 · 5 |
| `maxAgentsPerQuest` · `maxConcurrentAgents` | 40 · 3 | Techo; el presupuesto real se calcula del plan (2 por intento y subtarea). Topes 60 · 3 |
| `maxParallelArtifices` | 1 | Artífices a la vez contando el del carril principal (tope 3). Con 2 o 3, las subtareas listas, sin trabajo visual y con rutas disjuntas se implementan en talleres (`.guildflow/wt/`) mientras el carril principal sigue; la integración, la verificación y la revisión siguen en serie. Si el árbol principal cambió en las rutas de un taller, no se integra y la subtarea vuelve a la cola |
| `tokenBudgetPerQuest` · `costBudgetUsd` · `rateLimitPercent` · `wallClockMinutes` | 2M · 25 · 90 · 60 | El USD es equivalente a precio de API, no lo facturado |
| `maxFilesChanged` · `maxDiffLines` | 25 · 1500 | |
| `maxTurnsArchimago` · `maxTurnsArtifice` · `maxTurnsPaladin` | 25 · 40 · 25 | |
| `escriba` | `none` | `haiku`: al cerrar, Haiku redacta un resumen breve en lenguaje llano al principio de la crónica, a partir de sus datos y sin herramientas. Cuesta una llamada pequeña por misión |
| `theme` | `gremio` | Textos con temática de rol: cabecera temática + dato llano y voces de los roles. `sobrio` deja solo el dato |
| `maestroEffort` | `medium` | Esfuerzo del Maestro mientras la misión trabaja (solo coordina). `inherit` usa el de la sesión. El de cada Artífice lo pone el plan por subtarea (`effort`) o, si falta, la complejidad del plan (`small` → `medium`, el resto → `high`); el Paladín revisa siempre en `high` |
| `maestroModel` | `claude-sonnet-5-5` | Modelo del Maestro mientras la misión trabaja. Todo plan de más de una subtarea lo traza el Archimago (Opus). `inherit` usa el modelo que tengas en la sesión |
| `trustedTools` | Context7 + `WebSearch` | Herramientas de recursos que no impiden la aprobación automática |
| `archimagoEffort` | `high` | `xhigh` para misiones arquitectónicas |
| `allowedExecutables` | ver arriba | Lista separada por comas; nunca `.cmd`, `.bat`, `.ps1` ni `.sh` |
| `sandbox` | `none` | `docker`: cada comprobación corre en un contenedor sin red, con el proyecto de solo lectura (solo `/tmp` escribible). Si Docker no responde, la comprobación falla: nunca se ejecuta fuera. Requiere Docker funcionando; conviene descargar antes las imágenes (`docker pull node:22-alpine`). Las dependencias nativas compiladas para Windows (`node_modules`) no cargan en Linux |
| `sandboxImages` | node, python, go, cargo, deno, bun (Alpine) | `ejecutable=imagen` separados por comas. Un ejecutable sin imagen no se acepta en las comprobaciones con `sandbox: docker` |

Los valores fuera de rango se acotan a los topes: un límite no se puede desactivar.

## Uso

```
/quest Corrige la función sum de src/math.js para que devuelva a+b. Comprobación: node --test test/math.test.js (mínimo 1 test).
```

1. El Maestro arranca solo y decide cómo planificar: él mismo si el cambio es acotado, o el Archimago, que además recibe el inventario de MCP y skills de la sesión. El plan define subtareas, rutas que puede escribir cada una, comprobaciones con argv exacto, criterios y los recursos que necesita. Si no hay tests, la primera subtarea los escribe y quedan congelados.
2. Aprobación. Sin `autoApprovePlan`, aparece un diálogo con el plan completo, y solo vale ese diálogo, no un "sí" en el chat. Con `autoApprovePlan`, el plan se aprueba solo si no es sensible.
3. El Artífice implementa, el mod ejecuta las comprobaciones y el Paladín revisa. Si algo falla, se reintenta con la evidencia. Si el mismo fallo se repite, la misión se **bloquea** y te pide decisión.
4. Al terminar: `.guildflow/summary-<id>.md`.

| Comando | Qué hace |
|---|---|
| `/quest <petición>` | Abre una misión (archiva la anterior si estaba detenida, bloqueada o en pausa) |
| `/quest-status` | Estado completo y panel lateral |
| `/quest-halt` | Detiene la misión ya |
| `/quest-resume` | Reanuda tras confirmar (bloqueada: un intento más) |

**Dónde ver el estado:**
- La línea de estado bajo el cuadro de texto: trabajando, completada, bloqueada o esperando tu aprobación.
- La franja encima del cuadro de texto.
- El panel "Gremio · GuildFlow".

**Recursos de terceros:** si el plan propone instalar un plugin, servidor MCP o skill, lo ves en el diálogo de aprobación y, si apruebas, **GuildFlow lo instala** (`claude mcp add …`, `claude plugin install …`). Si hace falta software descargable, te indica qué descargar y de dónde. Un recurso recién instalado puede no estar disponible hasta la próxima sesión.

**Qué te pide GuildFlow:**
- La aprobación del plan, salvo con `autoApprovePlan`.
- Las acciones sensibles del Maestro durante una misión: push, despliegue, instalación de dependencias, borrados, escrituras fuera del repo y MCP de sistemas externos.

Lo demás que no encaja en el protocolo se rechaza con una explicación, sin interrumpirte. Con la misión detenida o terminada, GuildFlow no interviene.

## Glosario del gremio (tema `gremio`)

Cada mensaje temático lleva el dato exacto detrás, y la temática nunca lo sustituye. Las instrucciones a los agentes son neutras, así que el tema no gasta tokens.

| Término | Significa |
|---|---|
| Pergamino de misión | Plan |
| Sello · «Sellar el pergamino» | Aprobación · aprobar |
| Encargo | Subtarea |
| Forja | Implementación |
| Prueba de fuego | Comprobación automática (tests) |
| Juicio del Paladín | Revisión |
| Encrucijada | Bloqueada: necesita tu decisión |
| Campamento · «Levantar el campamento» | En pausa · reanudar |
| El gremio se retira | Detenida |
| Bitácora / Crónica | Registro / resumen final (`.guildflow/summary-*.md`) |
| Tesoro gastado | Coste |

Voces de los roles:
- **Maestro:** sobrio y organizador.
- **Archimago:** sabio y solemne.
- **Artífice:** práctico.
- **Paladín:** estricto y honorable.
- **Escriba:** cronista.

## Desarrollo

Usa un `claude` ≥ 2.1.295. En Windows, si el CLI de terminal es más antiguo, sirve el binario de Desktop: `%APPDATA%\Claude\claude-code\<versión>\<hash>\claude.exe`.

```bash
claude plugin validate guildflow
```

```bash
claude plugin test guildflow
```

Estructura y diseño: `docs/08-guildflow-implementation.md`. Resultados: `docs/10-test-results.md`.

## Limitaciones conocidas

- Guía completa, con las limitaciones por tipo de proyecto (JVM en Windows, servicios externos, binarios, apps nativas…): `docs/guia-guildflow.html`.
- En paralelo solo va la implementación (`maxParallelArtifices`); la integración, la verificación y la revisión siguen en serie, y las subtareas visuales no entran.
- Sin sandbox por defecto: `sandbox: docker` aísla las comprobaciones, pero no el servidor de vista previa (ver el aviso).
- El repositorio es privado: la instalación desde GitHub requiere acceso.
- El esfuerzo aplicado no se puede confirmar desde la API: se impone en cada petición, pero la respuesta no lo devuelve.
- El reinicio completo de Desktop con una misión a medias no se ha probado en vivo en esta fase (sí en la PoC).

## Licencia

MIT. Los iconos son originales: ver `ASSETS.md`.
