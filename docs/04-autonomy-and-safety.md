# 04 — Ciclo autónomo y protecciones

**Fecha:** 2026-10-10 · **Estado:** propuesta

## 1. Principios

1. **El modelo propone; el mod decide si se puede seguir.** Los límites viven en código (hooks), no en el prompt. Un prompt se puede ignorar; un `{ deny }` no.
2. **Un éxito se demuestra, no se declara.** Ni "el Artífice dice que terminó" ni "no hubo errores en la salida" cuentan como éxito.
3. **Fallar en cerrado.** Si un hook de guarda falla, su `.catch` rechaza (patrón documentado en reference.md: `next.called ? next(e) : { deny }`).
4. **Un solo escritor del estado del gremio.** Solo el mod escribe `.guildflow/quest.json` y `log.jsonl` (patrón de Munder Difflin).
5. **Escalar antes que matar.** Avisar → restringir → detener, un nivel por evento (patrón del breaker de Munder, con `hardStop` desactivado por defecto).

## 2. Modelo de datos de una misión

```jsonc
// .guildflow/quest.json  (lo escribe solo el mod)
{
  "id": "q-2026-10-10-001",
  "request": "texto original del usuario",
  "state": "PLANNING",               // ver §3
  "approval": { "required": true, "grantedAt": null },
  "verify": [                        // comandos permitidos al Paladín (lista blanca por argv)
    { "id": "tests", "argv": ["npm", "test"], "expectExit": 0, "minTests": 1 },
    { "id": "types", "argv": ["npx", "tsc", "--noEmit"], "expectExit": 0 }
  ],
  "tasks": [
    {
      "id": "t1",
      "title": "Validar email en registro",
      "paths": ["src/auth/**", "test/auth/**"],     // concesión de escritura
      "criteria": [
        { "id": "c1", "text": "Rechaza emails sin @", "check": "verify:tests", "evidence": null },
        { "id": "c2", "text": "Sin cambios fuera de src/auth", "check": "diff-scope", "evidence": null }
      ],
      "attempts": 0,
      "failureSignatures": [],
      "status": "pending"            // pending|active|review|fixing|done|blocked|abandoned
    }
  ],
  "budget": { "tokensUsed": 0, "agentsSpawned": 0, "startedAt": 0, "filesChanged": 0 }
}
```

Cada criterio de aceptación **debe** tener un `check` verificable: un comando de `verify`, `diff-scope` (lo calcula el mod), o `review` (juicio del Paladín con cita de archivo y línea). Un criterio sin `check` impide aprobar el plan.

## 3. Máquina de estados

```
INTAKE ──► PLANNING ──► AWAITING_APPROVAL ──► DISPATCH ──► IMPLEMENTING ──► VERIFYING ──► REVIEWING
              ▲                │ (rechazo/cambios)           ▲                                 │
              └────────────────┘                             │        ┌── criterios OK ────────┼──► DONE ──► LOGGED
                                                             └────────┤                        │
                                                       FIXING ◄───────┴── criterios KO ◄───────┘
                                                         │
                                cualquier estado ──► HALTED (límite) ──► LOGGED
```

| # | Paso pedido | Estado | Quién | Qué hace el mod |
|---|---|---|---|---|
| 1 | Analizar la petición | `INTAKE` | Maestro | Crea `quest.json` y abre una entrada en el log |
| 2 | Plan con subtareas y criterios | `PLANNING` | Maestro o Archimago | Valida el esquema: cada criterio con `check`, cada subtarea con `paths`, sin solapes de `paths` entre subtareas paralelas |
| 3 | Aprobación | `AWAITING_APPROVAL` | **Usuario** | Bloquea `Edit`/`Write`/`Bash` de escritura hasta la aprobación (vía `AskUserQuestion` o `ExitPlanMode`). Se puede omitir con `userConfig.autoApproveSmall` en misiones de 1 subtarea con ≤3 archivos |
| 4 | Asignar | `DISPATCH` | Maestro | `agent.spawn`: comprueba presupuesto, concurrencia y que el tipo sea un `guildflow:*` permitido; impone el modelo del rol |
| 5 | Implementar y probar | `IMPLEMENTING` | Artífice | `tool.call`: veta ediciones fuera de `paths`; cuenta archivos y líneas cambiados |
| 6 | Revisar | `VERIFYING` → `REVIEWING` | Mod + Paladín | El **mod** ejecuta los `verify` (exit code y número de tests); el **Paladín** juzga los criterios `review` con evidencia |
| 7 | Corregir y repetir | `FIXING` | Artífice (nueva invocación) | Recibe solo los criterios fallidos y su evidencia; `attempts += 1`; calcula la firma del fallo |
| 8 | Parar | `DONE` / `HALTED` | Mod | `DONE` solo si **todos** los criterios tienen evidencia positiva. `HALTED` al tocar cualquier límite |
| 9 | Registrar | `LOGGED` | Escriba (código) | Resumen, coste, criterios, siguiente paso recomendado; opcionalmente lo redacta Haiku |

## 4. Qué cuenta como éxito

Una subtarea pasa a `done` solo si se cumplen **todas** estas condiciones:

1. Cada comando `verify` asociado termina con el `expectExit` declarado, **ejecutado por el mod o por el Paladín**, no citado por el Artífice.
2. Si se declaró `minTests`, la salida demuestra ese número de tests ejecutados (evita el "0 tests, exit 0").
3. `diff-scope`: el diff real (git) solo toca rutas de `paths` y no está vacío cuando la subtarea exige cambios.
4. Cada criterio `review` tiene un veredicto del Paladín con **cita concreta** (archivo:línea o salida de comando). Un veredicto sin evidencia cuenta como fallo.
5. Ningún archivo de test o de configuración de verificación se modificó para pasar (diff sobre `verify` y tests preexistentes → revisión obligatoria).

## 5. Límites configurables (`userConfig` del plugin)

| Límite | Clave | Defecto | Dónde se impone | Al superarlo |
|---|---|---|---|---|
| Intentos por subtarea | `maxAttemptsPerTask` | 3 | `agent.spawn` del Artífice para una tarea en `fixing` | Subtarea `blocked`, se pregunta al usuario |
| Iteraciones por misión | `maxQuestIterations` | 8 | Transición `FIXING` | `HALTED` |
| Mismo fallo repetido | `maxSameFailure` | 2 | Firma = hash(tests fallidos normalizados + 1.ª línea de error) | `blocked` (no se reintenta lo mismo) |
| Rondas sin progreso | `maxNoProgressRounds` | 2 | Nº de criterios OK no aumenta entre rondas | `HALTED` |
| Agentes por misión | `maxAgentsPerQuest` | 12 | `agent.spawn` | `{ deny }` |
| Agentes concurrentes | `maxConcurrentAgents` | 3 | `agent.spawn` + `$.agent.list()` (muy por debajo del tope de 20 de la plataforma) | Se encola |
| Presupuesto de tokens | `tokenBudgetPerQuest` | 2 000 000 | Suma de `turn.complete.usage` (principal + subagentes) | Al 80 % avisa; al 100 % `HALTED` |
| Tiempo total | `wallClockMinutes` | 60 | `$.clock.every` | `HALTED` |
| Archivos cambiados | `maxFilesChanged` | 25 | `tool.call` (Edit/Write) + diff | `{ deny }` + pregunta |
| Líneas de diff | `maxDiffLines` | 1 500 | Diff tras cada subtarea | Revisión obligatoria |
| Turnos por subagente | `maxTurns` (frontmatter) | 25-40 | Motor | Resultado marcado como parcial |
| Continuaciones por `Stop` | — | 1 por puerta | `classic.Stop` respeta `stop_hook_active`; además la plataforma corta a las 8 | Termina el turno |

> El coste en **dólares** no lo da la API de mods (solo tokens). Si se quiere un límite en USD, habrá que mantener una tabla de precios propia (riesgo de quedar desactualizada). Para el MVP, el presupuesto se mide en tokens.

## 6. Protecciones por riesgo

| Riesgo | Protección |
|---|---|
| **Loop infinito** | Tope de iteraciones y de agentes; `classic.Stop` bloquea **una vez** por puerta y nunca con `stop_hook_active`; respaldo del tope de 8 de la plataforma. **No** usamos `Stop` para encadenar trabajo (la lección de Munder: forzar continuaciones salta la seguridad HITL y gasta crédito) |
| **Errores repetidos** | Firma de fallo; a la 2.ª repetición la subtarea pasa a `blocked`. El reintento recibe la evidencia previa y la instrucción de cambiar de enfoque |
| **Consumo excesivo** | Presupuesto de tokens y tiempo; concurrencia baja; Archimago solo en misiones grandes; Escriba sin LLM |
| **Modificaciones simultáneas en conflicto** | Concesiones de escritura por subtarea (`paths` sin solape, comprobado al aprobar el plan); veto en `tool.call` por `agentId`; `isolation: worktree` para Artífices en paralelo; la integración de worktrees la hace el Maestro **en serie**, nunca dos a la vez |
| **Criterios que nunca se cumplen** | `maxNoProgressRounds` + `maxSameFailure` → `blocked` con diagnóstico; el Maestro propone relajar o dividir el criterio, **pero solo el usuario puede cambiarlo** (los criterios aprobados son inmutables sin nueva aprobación) |
| **"Hacer trampa" para pasar** | Diff sobre tests y config de verificación → revisión obligatoria del Paladín y aviso al usuario |
| **Subagente intenta delegar** | `Agent` en `disallowedTools` + veto en `agent.spawn` cuando `parentAgentId` existe |
| **Acciones irreversibles** | Siempre requieren aprobación humana: `git push`, borrados masivos, instalar dependencias, editar configuración global (`~/.claude/*`), migraciones destructivas. Lista negra por prefijo de argv en `tool.call` |
| **Inyección de prompt** desde archivos o web | El contenido leído es dato; el Paladín no acepta instrucciones de los archivos revisados; los criterios solo vienen de `quest.json` aprobado |
| **El propio mod como riesgo** (sin sandbox) | Sin red; `$.process.run` solo para argv de `verify`; `$.fs` solo en `.guildflow/`; auditable con `claude plugin validate` |

## 7. Recuperación

- **Reinicio de la app o recarga del mod:** el estado se reconstruye desde `.guildflow/quest.json` + `$.store`. Los agentes que figuraban `running` pasan a `lost` (no sobreviven al proceso, como en claude-mods) y su subtarea vuelve a `pending` **sin** consumir un intento.
- **Interrupción del usuario (Esc):** `turn.complete.reason = 'aborted'` → la misión pasa a `paused`, no a `failed`.
- **Error de API:** `reason = 'error'` → reintento con *backoff* fuera del contador de intentos, hasta 2 veces; después `blocked`.
- **Worktree con trabajo sin integrar:** se conserva y se registra en el log (patrón de Munder); nunca se borra automáticamente.

## 8. Lo que el ciclo **no** hará en el MVP

- Trabajar con la sesión cerrada (necesitaría el servicio auxiliar).
- Despertarse solo con `$.prompt.submit` para iniciar misiones nuevas: solo continúa la aprobada, y solo si el usuario activa `autoContinue`.
- Modificar sus propios límites o criterios.
