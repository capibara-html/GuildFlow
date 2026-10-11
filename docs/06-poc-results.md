# 06 — Resultados de la PoC (Fase 1)

**Fecha:** 2026-10-10/11 · **Entorno verificado:** Claude Code Desktop **2.1.295** (`$.session.version()` → `{"version":"2.1.295","builtAt":"2026-10-08T16:50:59Z"}`), sesión principal en `claude-opus-5-5`, modo de permisos `auto`. CLI de terminal 2.1.280 sin sesión iniciada: **no se usó como prueba de nada**.

**Evidencia:** `poc/evidence/events.jsonl` (append-only, escrito por el propio mod a partir de eventos reales del motor). Las citas `L<n>` remiten a líneas de ese archivo. Código: `poc/plugin/` (mod `guildflow-poc`), fixtures en `poc/fixtures/sandbox/`, máquina de estados en `poc/loop/quest-machine.mjs`.

**Método:** mod cargado en Desktop mediante la carpeta de mods de la sesión, con recarga en caliente aceptada por la persona usuaria. Validación estática con el binario 2.1.295 de Desktop (`claude plugin validate`: *passed with warnings*, solo falta `author`). Cada prueba se verificó contra los eventos y los archivos en disco, **no** contra el texto que devolvían los agentes.

## Tabla de resultados

| # | Objetivo | Procedimiento | Resultado | Evidencia | Decisión |
|---|---|---|---|---|---|
| **P1** | Sonnet 5.5 y Haiku 5.5 se ejecutan; modelo y esfuerzo reales | Agentes `escriba` (frontmatter `claude-haiku-5-5`, `low`) y `artifice` (`claude-sonnet-5-5`, `high`) con una lectura trivial y sin pasar `model` | **PASS** | `agent.spawn.result` → `resolvedModel` `claude-haiku-5-5` / `claude-sonnet-5-5`; `turn.step` → `seenEffort` `low` / `high`; `turn.complete.usage.model` (lo reporta la API) coincide (L6-L23) | Los dos modelos están disponibles en la cuenta. Se usan IDs completos |
| **P2a** | Imponer el **modelo** del rol aunque el Maestro pida otro | Artífice lanzado con `model: haiku` | **PASS** | `agent.spawn.request.requestedModel: "haiku"` → hook reescribe → `resolvedModel: "claude-sonnet-5-5"` → `usage.model: "claude-sonnet-5-5"` (L28-L34) | El hook `agent.spawn` es el mecanismo de imposición del modelo |
| **P2b** | Imponer el **esfuerzo** del rol | El mismo lanzamiento con `effort: low` | **PASS con reserva** | `turn.step.seenEffort: "low"` en **cada** petición (el `effort` de la invocación anula el `high` del frontmatter) → el hook reescribe a `high` (`rewritten: true`) (L30, L32). La API no devuelve el esfuerzo aplicado, así que la confirmación llega solo hasta la petición que sale del hook | **El frontmatter no garantiza el esfuerzo.** Imposición obligatoria en `turn.step`. `CLAUDE_CODE_EFFORT_LEVEL` no está definida en el motor (L1), así que no interfiere |
| **P3** | Veto por rutas en el hook, robusto y en cerrado | Artífice (con `Write` y `PowerShell` en su frontmatter) intenta: escribir en `forbidden/control.txt`, escribir con *traversal* `allowed/../forbidden/control.txt`, `Set-Content` por PowerShell y escribir en `allowed/target.txt`. Después, guarda con fallo inyectado y escritura que normalmente estaría permitida | **PASS** | 3 rechazos con motivo legible y 1 permitida (L40-L43). SHA-256 de `control.txt` intacto (`sha256sum -c` OK). Con el fallo inyectado: `tool.call.guard-failed` (L51) y la escritura **no** ocurre (`target.txt` sigue en `OK-ARTIFICE`). Prueba automática: un agente cuyo rol no se puede resolver se rechaza | Veto = lista blanca de herramientas por rol + rutas reales normalizadas + `.catch` que rechaza. Shell libre vetado a los roles con restricción de rutas |
| **P4** | `classic.Stop` bloquea una sola vez | `arm_stop` y fin de turno | **PASS** (parcial: `stop_hook_active` no observado) | `p4.stop {action:"block-once"}` y un único `turn.complete` 9 s después, sin cadena (L92-L93). El segundo Stop no se bloqueó porque el contador desarmó la puerta antes de que llegara a mirarse `stop_hook_active` | Sirve como puerta puntual. **No** se usa como motor de autonomía |
| **P5** | Contabilidad: principal frente a subagentes, sin duplicar; `cost.usd` | Registro en `turn.step` del `usage` exacto de cada petición y de `cost.usd` antes y después; `turn.complete` por bucle | **PASS** | **11/11 peticiones** concilian con un error máximo de 8·10⁻¹⁶ USD. Precios verificados: Opus 5.5 $4/$20, lectura de caché $0,20, **escritura de caché $8 (TTL 1 h) en la sesión principal**; Sonnet 5.5 $2/$10, escritura $2,50 (5 min) y lectura $0,20; Haiku 5.5 $0,10/$0,50, escritura $0,125 y lectura $0,01. `turn.complete` de un agente = suma exacta de sus peticiones; las peticiones principales no incluyen las del subagente; `cost.usd` cubre toda la sesión, subagentes incluidos | Presupuesto por petición en **tokens y en USD equivalente** es fiable. En suscripción `cost.usd` es **equivalente a precio de API, no lo que se cobra**: el límite real es `rateLimits.percentUsed` |
| **P6** | Persistencia y agentes perdidos | Fila sintética `running` (marcada como simulada) y **reinicio completo de Desktop** por la persona usuaria | **PASS** | Recargas del mod: `restoreSource: "state"` (L25, L87, L96). Tras el reinicio: `restoreSource: "store"`, `boots` 4→5, `lostAgents: ["synthetic-…"]` (L111 inyección, L116 recuperación); 0 `agent.spawn` automáticos después | `$.state` sobrevive a recargas del mod pero **no** a un reinicio; `$.store` sí. Los contadores de límites deben vivir en `$.store` o en archivo |
| **P7** | Pixel art 32×32 en el panel de Desktop, animación y alternativa estática | Panel `Pane` + banda `AbovePrompt` con `Svg` (sprite procedural original, 2 fotogramas SMIL `calcMode=discrete`, 0,25 s = 8 fps teóricos) e indicador de estado; botón para pasar a estático | **PASS** (fps: INCONCLUSIVE) | La persona usuaria confirma: panel visible, animación activa, banda funcional, modo estático correcto y sin lentitud perceptible. No existe API para medir los fotogramas reales del SVG en el marco aislado, así que **no hay cifra de fps** | Viable para el tablón del gremio. Medición de rendimiento real pendiente (posible con `Client` y su reloj de fotogramas) |
| **P8** | `$.agent.register` y `permissionMode` | Registro dinámico `reg-probe` con `permissionMode: 'plan'` e intento de `Write` dentro del sandbox | **INCONCLUSIVE** | Esquema: aceptado (`{agent:"guildflow-poc:reg-probe"}`, L2); lanzamiento y escritura L80-L86. Presencia: el tipo aparece y se lanza. Comportamiento: la escritura **se ejecutó** (`p8.txt`). La documentación dice que con la sesión principal en `auto` el `permissionMode` del subagente se ignora, y que los agentes de plugin lo ignoran siempre. No se puede separar una causa de la otra sin cambiar el modo de la sesión, cosa que no hice | **No confiar en `permissionMode`.** Las restricciones van en los hooks |

## Seguridad transversal

| Comprobación | Resultado | Evidencia |
|---|---|---|
| El Paladín no tiene herramientas de edición ni Bash | **PASS** | El Paladín declaró no tener `Write`/`Bash`; no hay ningún `tool.call` de esas herramientas en el registro |
| Verificación sin Bash libre | **PASS** | `run_check` = identificador → argv fijo, `$.process.run` **sin shell**, sin argumentos del modelo. `"fixture-test; del control.txt"` rechazado (una sola ejecución real, la legítima, L67, exit 0, "tests: 1, passed: 1"). Prueba automática pasa |
| El motor no aplica el `enum` del `inputSchema` de un plugin | **Hallazgo** | La cadena maliciosa llegó al hook: la validación tiene que estar en código |
| Ningún agente delega | **PASS** | Un `general-purpose` intentó lanzar `guildflow-poc:escriba` → `agent.spawn.deny {reason:"delegation"}` por `parentAgentId` (L73-L74) |
| Fallos de la guarda → rechazo | **PASS** | Fallo inyectado en vivo (P3) + prueba automática (rol no resoluble) |
| Permisos y confirmaciones humanas intactos | **PASS** | El mod no lee ni escribe ajustes ni permisos (`claude plugin validate`: sin escritura de entorno, sin `$.http`); la sesión siguió en su modo |
| Ningún bucle sigue tras su límite | **PASS** | Tope de lanzamientos 6/6 → el 7.º rechazado antes de arrancar (L77-L78); `maxTurns: 6` cortó al agente bloqueado en P3b |
| Herramienta interna `SubagentHandback` | **Hallazgo** | Una lista blanca estricta la bloqueó y los subagentes no pudieron entregar su informe. Debe permitirse explícitamente |

## Pruebas automáticas

`claude plugin test poc/plugin` (binario 2.1.295): **2 pass, 0 fail**: rechazo de identificadores en `run_check` y fallo en cerrado con rol no resoluble. `node poc/loop/quest-machine.mjs`: todas las comprobaciones pasan.

## Ciclo autónomo: probado frente a propuesto

| Capacidad | Estado |
|---|---|
| Imposición por rol (modelo, esfuerzo, herramientas, rutas), no delegación, límite de lanzamientos, fallo en cerrado | **Probado en vivo** |
| Contabilidad por petición y por bucle; lectura de `cost.usd` y `rateLimits` | **Probado en vivo** |
| Persistencia y marcado de agentes perdidos sin re-ejecución | **Probado en vivo** |
| Bloqueo único de `classic.Stop` | **Probado en vivo** (sin observar `stop_hook_active=true`) |
| Máquina de estados `INTAKE→…→DONE` con `PAUSED`/`HALTED`, aprobación solo humana, criterios congelados, fallo repetido, tokens y tiempo | **Propuesta con comprobación ejecutable** (`poc/loop/quest-machine.mjs`); **no conectada** al mod |
| Aprobación vía `AskUserQuestion`/`ExitPlanMode`, firmas de fallo reales a partir de la salida de tests, integración de worktrees | **Propuesta** (sin probar) |

## Coste de la PoC

Agentes: 9 ejecuciones, **0,28 USD equivalentes** (Sonnet 0,266; Haiku 0,015). La sesión principal (Opus 5.5 con ~400-500 k tokens de contexto en caché) domina el coste: `cost.usd` pasó de 8,66 a 14,50 USD equivalentes durante la PoC, casi todo en lecturas de caché de la conversación principal. Límite de 5 h de la cuenta: 21 % → 35 %.

## Recomendación

**Avanzar a la Fase 2 con cambios en la arquitectura** (detallados en `07-poc-limitations.md` §3). Las cinco pruebas prioritarias tienen resultado y ninguna ha fallado. La arquitectura de un solo plugin se sostiene, pero hay que incorporar estos ajustes:

1. Imponer el esfuerzo en `turn.step`, nunca solo por frontmatter.
2. Guardar contadores y presupuestos en `$.store` o en archivo.
3. Permitir explícitamente las herramientas del motor (`SubagentHandback`).
4. Validar las entradas de las herramientas propias en código.
5. Medir el presupuesto con `turn.step` y `rateLimits`.
6. Descartar `permissionMode` como control.

**Descartar por ahora:** usar `classic.Stop` como motor de autonomía, y medir fps del SVG como requisito.
