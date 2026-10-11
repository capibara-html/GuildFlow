# 07 — Limitaciones de la PoC, decisiones que cambian y riesgos

**Fecha:** 2026-10-11 · Complementa `06-poc-results.md`.

## 1. Limitaciones del entorno

| Limitación | Efecto | Cómo se trató |
|---|---|---|
| CLI de terminal 2.1.280 sin sesión iniciada | No sirve para probar mods ni para conciliar modelos. Su validador rechaza `read($, …)`, un patrón que la 2.1.295 acepta | Se usó el binario de Desktop `…/Claude/claude-code/2.1.295/…/claude.exe` solo para `plugin validate` y `plugin test`, que son estáticos u offline. Todas las pruebas funcionales se hicieron en la sesión de Desktop |
| API de mods en acceso anticipado | Cualquier resultado vale solo para la **2.1.295** | Fijar la versión mínima probada en la Fase 2 y repetir la PoC tras cada actualización (los eventos de `poc/evidence` sirven de referencia) |
| Los mods no tienen sandbox | Un error del mod actúa con los permisos del usuario | El mod de la PoC no usa red (`$.http` ausente según el validador) y solo escribe en `poc/evidence/`. El único proceso que lanza es `node` con argv fijo |
| La sesión principal está en modo **auto** | Anula el `permissionMode` de los subagentes (P8 queda INCONCLUSIVE) | No se cambió el modo de la sesión (lo prohíbe el encargo) |
| Sin API para medir los fps de un `Svg` en el marco aislado de Desktop | No hay cifra de rendimiento de la animación | Se usó la observación de la persona usuaria; sigue pendiente medir con un `Client` y su reloj de fotogramas |
| La API no devuelve el esfuerzo aplicado | La imposición del esfuerzo solo se confirma hasta la petición que sale del hook | Documentado como "PASS con reserva" |
| `$.agent.list()` no lista agentes terminados y no está implementado en `plugin test` | La resolución de rol depende de un mapa propio. En las pruebas, la guarda falla en cerrado | Se mantiene un mapa `agentId→rol` alimentado en `agent.spawn` y reconstruido desde `$.state` |
| Solo una cuenta y una suscripción | `cost.usd` es equivalente a precio de API; el límite real es `rateLimits` | Documentado; el presupuesto debe poder expresarse en `% de rateLimits` |
| No se probaron `isolation: worktree`, `background: true`, el Archimago (Opus como subagente) ni la integración con `AskUserQuestion`/`ExitPlanMode` | Siguen como propuesta | Pasan a la Fase 2 con criterios propios |

## 2. Decisiones de diseño que cambian (respecto a los documentos 02-04)

| Documento | Decisión anterior | Cambio que exige la evidencia |
|---|---|---|
| 02 §1.2 | "Coste: `turn.complete.usage` da tokens, no dólares; no hay tope de gasto nativo" | **Incorrecto en parte.** `$.session.usage().cost.usd` existe y concilia al céntimo por petición. Además `turn.step` devuelve el `usage` exacto de cada petición. Sigue sin haber un tope *nativo*, pero el mod puede imponer uno fiable |
| 02 §1.3 y 03 §4 | El esfuerzo se fija en el frontmatter y `turn.step` refuerza | El `effort` que pasa quien invoca **anula** el frontmatter. La imposición en `turn.step` es **obligatoria**, no un refuerzo |
| 03 §3 (Paladín) | Paladín con `Bash` y veto por prefijo de argv | El Paladín **no** tiene Bash. Verifica con una herramienta del mod (`run_check`): identificador → argv fijo, `$.process.run` sin shell. Los scripts de verificación viven **fuera** de las rutas que el Artífice puede escribir |
| 03 §3 (Artífice) | Artífice con `Bash`/`PowerShell` | Con veto de rutas activo, el shell libre es incompatible: un comando puede escribir donde quiera. El Artífice queda sin shell; sus comandos de build o test pasan por `run_check` |
| 03 §4 y 04 | Lista blanca de herramientas por rol | Hay que permitir siempre las herramientas de infraestructura del motor (`SubagentHandback`) y evaluarlas **antes** de cualquier lógica que pueda fallar. Si no, el subagente no puede entregar su informe o entra en bucle hasta `maxTurns` |
| 04 §5 | Límites en `userConfig` y contadores en el estado del mod | Los contadores (lanzamientos, iteraciones, tokens) deben persistir en `$.store` o en `.guildflow/`. `$.state` **se pierde al reiniciar Desktop** y reiniciaría los límites |
| 04 §5 | Presupuesto en tokens (los dólares se descartaban) | Presupuesto por petición en tokens **y** en USD equivalente (fiable), más un umbral sobre `rateLimits.percentUsed` para suscripciones |
| 04 §6 | Validación de entradas | El motor no aplica el `enum` del `inputSchema` de las herramientas de un plugin: toda entrada se valida en código |
| 02 §5 (P8) | `permissionMode` como capa adicional | Se descarta como control: los hooks son la única capa en la que confiar |
| 04 §3 | `classic.Stop` como puerta de cierre | Confirmado solo como puerta puntual, armada por la misión y de un solo uso. No es motor de autonomía |

## 3. Cambios recomendados para la Fase 2

1. Un único punto de decisión por llamada: **herramientas del motor → lista blanca del rol → rutas reales → otras reglas**, con `.catch` que rechaza.
2. Contadores y presupuestos persistidos (`$.store` + `.guildflow/quest.json`), restaurados en `session.start`; los agentes en curso se marcan como `lost` (ya probado).
3. Contabilidad en `turn.step` (por petición) en vez de solo en `turn.complete`. Así se puede cortar a mitad de turno.
4. `run_check` como la única vía de ejecución de comandos para los subagentes, con una tabla de comprobaciones declarada en la misión aprobada.
5. Conectar `poc/loop/quest-machine.mjs` (o su sucesor) al mod: las transiciones las provocan eventos reales y la aprobación sale del Maestro, nunca de un subagente.

## 4. Riesgos pendientes

| Riesgo | Gravedad | Mitigación propuesta |
|---|---|---|
| Cambios en la API de mods entre versiones | Alta | Fijar la versión; pruebas con `claude plugin test` y repetir la PoC al actualizar |
| Otras herramientas internas del motor que la lista blanca no conoce (además de `SubagentHandback`) | Media | Registrar toda herramienta rechazada; revisar la lista en cada versión |
| MCP con capacidad de escribir (Aseprite, Playwright y otros servidores conectados en la sesión) | Media | La lista blanca por rol ya los excluye; mantenerla por nombre exacto |
| La sesión principal (Maestro) no tiene restricciones de rutas en esta PoC | Media | En la Fase 2, las operaciones irreversibles del Maestro (push, borrado, configuración global) pasan por aprobación explícita y se vetan en `tool.call` |
| Coste de contexto de la sesión principal: en la PoC dominó el gasto (lecturas de caché de ~480 k tokens por petición) | Media | Mantener corto el contexto del Maestro; delegar la lectura extensa a subagentes baratos; presupuesto por petición |
| `permissionMode` sin resolver para agentes registrados dinámicamente | Baja (no se usa) | Probar con la sesión en modo `default` solo si alguna vez se necesita |
| Rendimiento de la animación no medido | Baja | Medir con `Client` antes de construir el tablón animado completo |
| Restos de la PoC cargados en la sesión (carpeta de mods con recarga en caliente) | Baja | Al cerrar la revisión, eliminar `~/.claude/dev-mods/<sesión>/guildflow-poc` o rechazar la recarga en una sesión nueva |
