# 09 — Revisión de seguridad de GuildFlow (Fase 2)

**Fecha:** 2026-10-11 · **Alcance:** `guildflow/` en el commit `e7b63a8` · **Método:** diseño revisado contra el modelo de amenazas, tres revisiones automáticas de seguridad sobre commits (hallazgos corregidos más abajo), pruebas automáticas (`tests/policy`, `validation`, `verification`, `persistence`, `hooks`) y misiones en vivo en `testbed/`.

## 1. Lo primero: el código del plugin es privilegiado y no hay sandbox

- Un mod de Claude Code se ejecuta **sin sandbox del sistema operativo**, con los permisos de la persona usuaria. GuildFlow no añade aislamiento de procesos.
- **`run_check` ejecuta código del proyecto.** Una comprobación como `node --test test/x.test.js` carga el código que el Artífice acaba de escribir. Por tanto, **un Artífice puede, en la práctica, ejecutar código arbitrario con tus permisos** a través de una comprobación aprobada. El mod lo acota (argv congelado, sin shell, ejecutables en lista blanca, cwd dentro del proyecto, tiempo límite, integridad antes y después), pero **no lo impide**.
- **Mitigaciones reales:** el Artífice es un modelo con instrucciones explícitas, y en las dos misiones en vivo se negó a manipular la evaluación. También hay aprobación del plan (humana o automática restringida), rutas de escritura mínimas, verificación de integridad y revisión del Paladín.
- **Recomendación:** usar GuildFlow en repositorios de confianza. Para código no confiable, ejecutar Claude Code dentro de un contenedor o máquina virtual. Esta es la **limitación residual principal** y no se puede resolver desde un plugin.

## 2. Modelo de amenazas

| Actor o vector | Qué podría intentar | Control |
|---|---|---|
| Subagente que se desvía (error o inyección de prompt en archivos) | Escribir fuera de sus rutas, tocar sus tests, usar shell o web, delegar | Lista blanca por rol, rutas reales normalizadas, rutas protegidas, rechazo de delegación, fallo en cerrado |
| Código del proyecto ejecutado por `run_check` | Reescribir el test, `quest.json` o el registro para fingir éxito | Huellas de las rutas protegidas antes y después; `quest.json` comparado con lo último que escribió el mod; `$.store` autoritativo fuera del proyecto; integridad rota → `HALTED/safety` |
| Maestro (sesión principal) | Saltarse el protocolo: escribir el proyecto, ejecutar comandos o auto-aprobarse | Política del Maestro (§3); la aprobación solo sale de `$.ui.ask` o de `autoApprovePlan` en el código del mod, nunca de una herramienta |
| Plan malicioso o descuidado | Comprobaciones con código en línea, comandos sensibles, rutas que conceden el propio test | `validatePlan` estricto, `INLINE_CODE`, `sensitiveCommand`, `checkOverlaps`, `protects` automáticos |
| Edición externa del estado | Forjar `quest.json` como `DONE` | `$.store` manda; diferencias → aviso, cuarentena y `HALTED/safety` |
| Bucles sin fin o coste | Reintentos infinitos, agotar la suscripción | Límites con topes no desactivables, firma de fallo, rondas sin progreso, interruptor por tokens, USD, `rateLimits` y tiempo |

## 3. Controles y dónde están

| Control | Código | Prueba |
|---|---|---|
| Decisión central, con el orden documentado en `docs/08` §5 | `src/policy.ts` `decide` | `tests/policy.test.ts` (20) |
| Fallo en cerrado ante errores de la guarda | `hooks/register.tsx`, `.catch` de `tool.call` y `agent.spawn` | `hooks.test.ts`: "fallo inesperado de la guarda → rechazo" |
| Normalización de rutas (relativas y absolutas, `\`/`/`, mayúsculas en NTFS, traversal, UNC, rutas relativas a unidad, ADS, puntos o espacios finales, enlaces) | `src/validation.ts` `normalizeAbs`, `src/verification.ts` `realOf` | `validation.test.ts`, `verification.test.ts` |
| Rutas reservadas (`.guildflow`, `.git`, `.claude`) y protegidas por comprobación | `protectedEntries`, `parseEntry` | `policy.test.ts`, `hooks.test.ts` |
| `run_check` sin shell, argv congelado, ejecutables en lista blanca, sin `-e`, `--eval`, `-c`, `--require`…, sin `deno eval`, sin `.cmd`, `.bat`, `.ps1` ni `.sh` | `validatePlan` `parseCheck`, `execute` | `validation.test.ts`, `verification.test.ts`, `hooks.test.ts` |
| Exit 0 con 0 tests → FAIL | `judge` | `verification.test.ts` |
| git del mod sin `fsmonitor`, sin `ext-diff`, sin `textconv` | `gitArgv`, `diffScope` | `verification.test.ts` |
| `HEAD` movido tras la aprobación → FAIL | `diffScope` | `verification.test.ts` |
| Plan congelado por hash; aprobación con `by` `human` o `auto` | `machine.ts` `approve`, `isApproved` | `machine.test.ts` |
| Diálogo de aprobación completo o ninguno (≤ 3000 caracteres, sin recortes) | `approvalText` | `presentation.test.ts` |
| Aprobación automática solo sin rutas sensibles, y el Artífice no escribe rutas sensibles en esas misiones | `sensitivePlan`, `sensitivePath`, `decide` paso 4 | `validation.test.ts`, `policy.test.ts`, `hooks.test.ts` |
| Comandos sensibles del Maestro → diálogo humano | `sensitiveCommand` | `policy.test.ts` |
| Tachado de secretos con patrones conocidos en `runs/` y `log.jsonl` | `redact` | `persistence.test.ts` |
| Separación entre proyectos (`$.store` por hash de raíz y comprobación de `project`) | `storeKey`, `loadQuest` | `persistence.test.ts` |
| Sin relanzamiento automático tras un reinicio | `machine.ts` `recover` | `machine.test.ts` (reinicio en vivo: pendiente, ver `10` §3) |

**Lo que GuildFlow no hace:**
- No modifica permisos ni el `permissionMode` de Claude Code. Las confirmaciones del motor siguen intactas, y no depende de `permissionMode`, que la PoC demostró ineficaz.
- No escribe configuración global.
- No lee variables de entorno, salvo `CLAUDE_CODE_EFFORT_LEVEL`, que solo detecta para avisar.
- No usa red.

## 4. Hallazgos y correcciones

| # | Origen | Hallazgo | Gravedad | Corrección | Estado |
|---|---|---|---|---|---|
| 1 | Revisión automática (núcleo) | El shell de "solo lectura" del Maestro permitía `git` con flags que ejecutan programas del repo (`fsmonitor`, `textconv`, `diff.external`) | Alta | `git` sale de la lista de solo lectura; el git del propio mod se endurece con `gitArgv` | Corregido (`363832b`) |
| 2 | Revisión automática (núcleo) | El diálogo de aprobación podía recortar el plan y la persona aprobaría algo que no leyó entero | Media | `approvalText` devuelve `null` si no cabe, y el plan se rechaza | Corregido (`363832b`) |
| 3 | Revisiones automáticas y pruebas (núcleo) | Formas de saltarse las comprobaciones: flags que ejecutan código o configuración en línea en intérpretes y git, y la unión de rutas en la raíz de una unidad (`c://x`) | Media | `INLINE_CODE` ampliado (`--import`, `--loader`, `--config-env`, `--upload-pack`…), `realOf` corregido y pruebas añadidas | Corregido (`363832b`) |
| 4 | Misión en vivo | **Falso positivo:** la comprobación de integridad comparaba `quest.json` antes y después de ejecutar, y las escrituras legítimas del propio mod (contabilidad) detenían la misión por seguridad | Funcional (disponibilidad) | Comparar con lo último que escribió o cargó el mod, dentro de la cola serializada (`diskMatches`); prueba de regresión | Corregido (`363832b`) |
| 5 | Revisión automática (`363832b`) | Un `quest.json` falsificado **una revisión por delante** de `$.store` se aceptaba al cargar | Media | `$.store` se escribe antes que el archivo y siempre manda; una copia en disco por delante o de otra misión más reciente → posible manipulación; restauración de `$.store` si el archivo falla | Corregido (`e7b63a8`) |
| 6 | Revisión automática (`363832b`) | La aprobación automática no consideraba sensibles `CLAUDE.md`, `AGENTS.md`, `.claude/` anidados, `.mcp.json`, `.devcontainer`, `.envrc`, `Makefile` ni los hooks de pre-commit, que cambian lo que ejecutan otras herramientas o agentes | Media | Añadidos a `SENSITIVE_PATHS`; el Artífice tampoco los escribe dentro de un directorio concedido en misiones aprobadas automáticamente | Corregido (`e7b63a8`) |
| 7 | Revisión automática (`363832b`) | Diferencia de interpretación en el shell de solo lectura: `Get-ChildItem Env:` (variables de entorno, posibles secretos), `HKLM:` o `x\\host\share` pasaban porque solo se miraba el prefijo | Media | Se rechaza cualquier argumento con `:`, `\` o `//` | Corregido (`e7b63a8`) |
| 8 | Uso real | Exceso de diálogos (42 en una misión) que empujaba a aprobar sin leer | Usabilidad con efecto en la seguridad | Rechazo con explicación en lugar de preguntar; guarda del Maestro solo mientras la misión trabaja; ver `08` §5 | Corregido (`363832b`) |

## 5. Riesgos residuales (aceptados y documentados)

1. **Sin sandbox del sistema operativo** (§1). Es el riesgo principal.
2. **El hash no es criptográfico** (FNV-1a doble). Detecta cambios accidentales o ingenuos, no a un adversario que fabrique colisiones. Un adversario con acceso a tu usuario puede además escribir `$.store` directamente: GuildFlow no defiende contra procesos locales con tus permisos.
3. **Los patrones de comandos y rutas sensibles son de mejor esfuerzo.** Una lista de patrones no es completa: un comando ofuscado puede no reconocerse como sensible. Mitigación: lo no reconocido del Maestro **se rechaza** (no se permite), y los subagentes no tienen shell.
4. **Aprobación automática.**
   - `autoApprovePlan` está desactivado por defecto. Activarlo cambia el control humano por un filtro de rutas: un plan de código "normal" se ejecuta sin que nadie lo lea.
   - La alternativa más estricta (lista blanca de extensiones de código fuente) queda como mejora posible.
   - Hoy la opción está activada en `~/.claude/settings.json` de esta máquina, a petición de la persona usuaria.
5. **Inyección de prompt** desde el contenido del repositorio. Los briefs la declaran como dato, pero un modelo puede ser influido. El daño posible queda acotado por las guardas anteriores, no por el modelo.
6. **El tachado de secretos** reconoce solo patrones conocidos. Un secreto con otro formato puede quedar en `runs/*.json`. `.guildflow/` debe estar en `.gitignore`, como en el testbed.
7. **El Maestro puede escribir fuera del proyecto con aprobación humana** (`5-write` → diálogo). Es intencionado: está en la lista de acciones sensibles.
8. **API de mods en acceso anticipado.** Un cambio del motor puede alterar la semántica de los eventos. Versión mínima probada: 2.1.295.

## 6. Conclusión

No quedan hallazgos críticos ni altos abiertos. Los controles de la Fase 2 cumplen el objetivo de **verificación objetiva y límites duros**. No son una frontera de seguridad frente a código hostil: esa frontera tendría que ser un contenedor o una máquina virtual, fuera del alcance de un plugin.
