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

**Desktop (Code tab) o CLI, cualquier sesión.** Añade la carpeta del plugin a `CLAUDE_CODE_PLUGIN_DIRS` en el bloque `env` de `~/.claude/settings.json`, con la ruta absoluta y sin comillas extra:

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
| `autoApprovePlan` | `false` | Aprueba sin diálogo **solo** los planes que no tocan dependencias, CI o despliegue, migraciones, secretos, configuración del repo o del editor, ni instrucciones de agentes (`CLAUDE.md`, `.claude/`, `.mcp.json`…), y que no son `large` |
| `maxAttemptsPerTask` · `maxQuestIterations` · `maxSameFailure` · `maxNoProgressRounds` | 3 · 8 · 2 · 2 | Topes 10 · 30 · 5 · 5 |
| `maxAgentsPerQuest` · `maxConcurrentAgents` | 12 · 3 | Topes 20 · 3 (hoy la ejecución es secuencial) |
| `tokenBudgetPerQuest` · `costBudgetUsd` · `rateLimitPercent` · `wallClockMinutes` | 2M · 25 · 90 · 60 | El USD es equivalente a precio de API, no lo facturado |
| `maxFilesChanged` · `maxDiffLines` | 25 · 1500 | |
| `maxTurnsArchimago` · `maxTurnsArtifice` · `maxTurnsPaladin` | 25 · 40 · 25 | |
| `archimagoEffort` | `high` | `xhigh` para misiones arquitectónicas |
| `allowedExecutables` | ver arriba | Lista separada por comas; nunca `.cmd`, `.bat`, `.ps1` ni `.sh` |

Los valores fuera de rango se acotan a los topes: un límite no se puede desactivar.

## Uso

```
/quest Corrige la función sum de src/math.js para que devuelva a+b. Comprobación: node --test test/math.test.js (mínimo 1 test).
```

1. El Maestro prepara un plan: subtareas, rutas que puede escribir cada una, comprobaciones con argv exacto y criterios.
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

**Qué te pide GuildFlow:**
- La aprobación del plan, salvo con `autoApprovePlan`.
- Las acciones sensibles del Maestro durante una misión: push, despliegue, instalación de dependencias, borrados, escrituras fuera del repo y MCP de sistemas externos.

Lo demás que no encaja en el protocolo se rechaza con una explicación, sin interrumpirte. Con la misión detenida o terminada, GuildFlow no interviene.

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

- Ejecución secuencial: no hay worktrees ni Artífices en paralelo.
- Sin sandbox del sistema operativo (ver el aviso).
- El esfuerzo aplicado no se puede confirmar desde la API: se impone en cada petición, pero la respuesta no lo devuelve.
- El reinicio completo de Desktop con una misión a medias no se ha probado en vivo en esta fase (sí en la PoC).

## Licencia

MIT. Los iconos son originales: ver `ASSETS.md`.
