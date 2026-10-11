# 11 — Análisis tras la misión Pixel Chess: arranque, recursos, tokens, límites, referentes y temática

**Fecha:** 2026-10-11 · **Base empírica:** misión `q-20261011-183248` (Pixel Chess: 5 subtareas, 26/26 criterios, 11 agentes, ≈$3,54) y las misiones del testbed (`docs/10`).

## 1. Arranque sin "empieza"

**Problema:** `/quest` crea la misión y pide un turno al Maestro con `$.prompt.submit`, pero en Desktop ese turno no se ejecutó: 0 peticiones hasta que la persona escribió. Tampoco ha habido nunca una continuación automática. Desde `bc4383f` el resultado se registra como `prompt.kick`, pero aún no hay datos.

**Causa de fondo:** un comando registrado con `$.command.register` solo devuelve texto (`{ text, context }`) y no abre un turno del modelo. Abrirlo dependía de `$.prompt.submit`, que en este anfitrión no funcionó.

**Solución propuesta:** convertir `/quest` en un **comando Markdown del plugin** (`commands/quest.md`, documentado en el formato oficial de plugins). Un comando Markdown es un prompt para el modelo y abre el turno de forma nativa. El hook `command.run` del mod se mantiene **delante** de ese comando:
1. Crea la misión y valida la petición (estado, archivado, panel).
2. Llama a `next(e)` y el prompt arranca el turno del Maestro.

- **Si la creación falla:** el hook responde sin `next` y no hay turno.
- **Riesgo:** los comandos de plugin pueden quedar con prefijo (`/guildflow:quest`). Hay que comprobar en vivo si `/quest` sigue funcionando sin prefijo.
- **Continuaciones a mitad de misión:** siguen dependiendo de `$.prompt.submit`. En Pixel Chess no hicieron falta, porque el Maestro encadenó toda la misión en un solo turno. Si el registro `prompt.kick` confirma que Desktop no las ejecuta, la alternativa es que el Maestro no termine su turno mientras queden pasos permitidos (regla de la skill) y que la línea de estado avise "⏸ el Maestro espera: escribe *sigue*".

**Meta acordada:** la persona solo interviene para aprobar el plan (si es sensible o grande), para las acciones sensibles y para decidir ante un `BLOCKED` o un `HALTED`.

## 2. El Archimago y los recursos: skills, conectores y MCP

**Hoy:** el Archimago solo tiene `Read`, `Grep` y `Glob`, y no sabe qué skills ni qué MCP hay en la sesión. Los Artífices tienen una lista blanca fija sin MCP.

**Lo que permite la API:** `$.tool.list()` (herramientas built-in y MCP, con descripción), `$.command.list()` (skills y comandos por origen: plugin, usuario, MCP) y `$.mcp` (servidores conectados).

**Propuesta, en tres capas:**

1. **Catálogo en el brief del Archimago.**
   - Cuando el Archimago se lanza, el mod genera un inventario compacto: skills relevantes con su descripción de una línea, servidores MCP con un resumen de sus herramientas, y conectores.
   - Lo hace el código del mod, así que no cuesta tokens de búsqueda.
   - El Archimago decide qué conviene en cada subtarea. Por ejemplo: `context7` para la documentación de una biblioteca, `playwright` para comprobar una interfaz o `aseprite` para sprites.
2. **Recursos declarados en el plan.**
   - Cada subtarea puede incluir `resources: { skills: [...], tools: ["mcp__context7__query-docs", ...] }`.
   - El mod amplía la lista blanca del Artífice **solo para esa subtarea** y solo tras la aprobación.
   - Las herramientas de la lista de confianza `trustedTools`, configurada por la persona (por defecto Context7 y `WebSearch`), pueden aprobarse automáticamente.
   - Las que escriben o tocan sistemas externos (`supabase__execute_sql`, `deploy`…) convierten el plan en sensible, así que la aprobación es humana.
   - El diálogo de aprobación muestra los recursos.
3. **Recursos externos no instalados.**
   - El Archimago puede *recomendar* un MCP o una skill de terceros (por ejemplo, tras buscar en el registro de MCP, si se le concede esa herramienta de solo lectura), pero **nunca instalarlo**: instalar es sensible.
   - La recomendación aparece en el plan como "sugerencia de equipo" para que la persona decida.

**Cuidado:** cada herramienta MCP visible añade su definición al contexto. El catálogo debe ser un resumen, no las definiciones completas.

## 3. Gasto de tokens: dónde va y cómo optimizar

**Datos de Pixel Chess** (`usage.request` por rol). `tokens` = entrada + salida + escritura de caché; las lecturas de caché van aparte:

| Rol | Peticiones | Tokens | Lecturas de caché | Contexto máximo | Coste estimado* |
|---|---|---|---|---|---|
| Maestro (Opus) | 31 | 145,6k | 3,45 M | 142k | ≈ $1,9–2,2 (55–60 %) |
| Archimago (Opus) | 4 | 43,1k | 52k | 39k | ≈ $0,3 |
| Artífices (Sonnet) | 27 | 181,2k | 558k | 56k | ≈ $0,6 |
| Paladines (Sonnet) | 24 | 115,1k | 392k | 43k | ≈ $0,4 |
| **Total** | 86 | 485k | 4,45 M | | **≈ $3,54** (dato del mod) |

\* El registro guarda `cost.usd` como acumulado de la sesión, no por petición. El reparto por rol es una estimación con los precios verificados en la PoC.

**Hallazgos:**
- **El Maestro es más de la mitad del coste**, y casi todo es *contexto*, no texto escrito. Su primera petición ya cargaba 74,5k tokens de base: prompt del sistema, definiciones de herramientas, skills y archivos de instrucciones del usuario. Después creció hasta 142k con los informes de los agentes y los briefs.
- **Briefs duplicados:** `start_task` y `start_review` devuelven al Maestro el brief completo, pero el mod ya lo inyecta en el prompt del agente al lanzarlo. Cada brief queda dos veces en el contexto, una de ellas en el del Maestro para el resto de la misión.
- **El texto de los mensajes** (salida) es una parte pequeña. El registro no separa entrada y salida, así que no se puede afirmar con precisión.
- **Instrucciones ajenas:** `C:\Users\RYZEN\AGENTS.md` (la constitución de MAIA) se carga en **todas** las sesiones bajo tu carpeta de usuario, incluido Pixel Chess. Son tokens en cada sesión y una posible influencia sobre el comportamiento.

**Optimizaciones, por impacto:**

| # | Medida | Ahorro esperado | Coste |
|---|---|---|---|
| T1 | Maestro en **Sonnet** dentro de las sesiones de misión, con Archimago en Opus, igual que el patrón arquitecto/editor de Aider | Aproximadamente la mitad del coste del Maestro (≈ 25–30 % del total) | Cambiar el modelo de la sesión, o un ajuste recomendado |
| T2 | `start_task` y `start_review` devuelven un resumen corto, no el brief | Varios k tokens por subtarea en el contexto del Maestro | Pequeño |
| T3 | Informes de los agentes con formato compacto (lista fija de campos, sin prosa) | Menos contexto acumulado en el Maestro | Instrucciones en los agentes |
| T4 | Registrar `input`, `output` y `cache_write` por separado y el coste por petición (delta) | Medición precisa, sin ahorro directo | Pequeño |
| T5 | Mover `AGENTS.md` de MAIA a la carpeta de ese proyecto | Su tamaño en cada sesión ajena a MAIA | Lo decides tú |

## 4. Comparativa: mod frente a agentes tradicionales

No se puede afirmar una ventaja sin un contrafactual. **Propuesta de benchmark A/B:**
- **Mismo punto de partida:** `pixel-chess@7a4ac0a`, con la SPEC y los tests, en una copia limpia.
- **Misma petición, en dos sesiones nuevas:**
  - **A, GuildFlow:** `/quest` con la petición en lenguaje normal.
  - **B, tradicional:** la misma petición sin misión. GuildFlow no interviene si no hay misión; Claude Code puede usar sus subagentes libremente.
- **Métricas:**
  - Tokens y coste (`/cost` y el registro).
  - Tiempo hasta terminar e intervenciones humanas.
  - Tests de aceptación que pasan.
  - Tests **ocultos** adicionales, que ninguna de las dos ve y que yo escribiría después.
  - Si alguna modificó los tests, y calidad del código revisada a ciegas.

**Hipótesis honesta:**
- **Lo previsible:** B probablemente gasta menos, porque no tiene Paladines, briefs ni verificación del mod.
- **Lo que ofrece GuildFlow:**
  - Evidencia independiente por criterio.
  - Protección frente a la manipulación de los tests.
  - Límites de gasto y alcance.
  - Registro auditable.
  - Menos intervención humana en misiones largas.
- **Lo que mide el benchmark:** si esa diferencia de coste compra algo medible, sobre todo en tests ocultos.

**Para cada misión** el mod ya podría mostrar en el resumen el coste por rol y el "sobrecoste de verificación" (Paladines + `run_check`).

## 5. Entender la petición sin indicar qué agente hace qué

**Hoy:** el prompt de Pixel Chess decía "planifícala con el Archimago, una subtarea por módulo…". En uso normal solo estaría la petición.

**Propuesta:**
1. **Heurística explícita en la skill.**
   - Usar el Archimago si la petición afecta a más de un módulo, necesita más de 2 subtareas, introduce arquitectura nueva o tiene requisitos no verificables tal cual.
   - El Maestro planifica solo los cambios acotados.
2. **Fase de aclaración.** Si faltan datos esenciales, el Maestro pregunta una vez, como en el paso 1 de Spec Kit o BMAD.
3. **Hueco funcional importante: los tests.** En Pixel Chess los tests de aceptación los escribí yo antes de la misión. Con una petición normal no existen.
   - **Propuesta:** una subtarea inicial "Especificación ejecutable": un Artífice escribe los tests, el Paladín los revisa contra la petición, y quedan **congelados y protegidos** para el resto de subtareas.
   - **Requisito técnico:** el mod debe volver a calcular las huellas de las rutas protegidas cuando termina esa subtarea, en lugar de usar solo las de la aprobación. Hoy esa subtarea provocaría una detención por integridad.

## 6. Límite de 12 agentes

**Origen:** es el valor por defecto que fijaba la especificación de la Fase 2 ("agentes 12, concurrentes 3"), con un tope configurable de 20. Su función es acotar el gasto ante bucles.

**Problema real que destapa Pixel Chess:** la misión usó 11 de 12 (1 Archimago + 5 Artífices + 5 Paladines). **Una sola ronda de corrección** (+1 Artífice y +1 Paladín) la habría detenido por límite antes de terminar. El límite fijo no escala con el tamaño del plan.

**Propuesta:**
- **Presupuesto de agentes derivado del plan** y aprobado con él: `1 (Archimago) + Σ subtareas (intentos × 2)`, acotado por un tope duro mayor (por ejemplo, 60).
- **Visible en el diálogo:** "hasta 31 agentes, presupuesto 3M tokens".
- **`userConfig`** pasa a ser el techo, no el valor fijo.

**Proyectos más ambiciosos:**
1. **Campañas:** una épica se divide en varias misiones encadenadas, cada una con su plan, aprobación y presupuesto. El Escriba arrastra un resumen entre ellas.
2. **Paralelismo con worktrees** (ya previsto en la Fase 4): oleadas de Artífices en paralelo sobre subtareas sin solapes, con integración en serie.

El límite de concurrencia (3) solo importa cuando haya paralelismo.

## 7. Referentes para robustecer el mod

Para estos referentes se toman **ideas, no código**. Reutilizar código requeriría revisar su licencia primero.

| Proyecto | Idea útil para GuildFlow |
|---|---|
| **GitHub Spec Kit** | Fases con puerta (especificar → planificar → tareas → implementar) y artefactos persistentes en el repo. GuildFlow podría guardar `spec.md` y `plan.md` legibles por misión |
| **BMAD-METHOD** | Roles con artefactos de traspaso (PRD, arquitectura, *story files* por tarea con su contexto). Las personalidades de rol encajan con el §8 |
| **Task Master AI** | Grafo de tareas a partir de un documento de requisitos y análisis de complejidad por tarea, que podría calcular el presupuesto de agentes del §6 |
| **Roo Code (modo Orchestrator / Boomerang)** | El orquestador no lee ni escribe: recibe **resúmenes** de las subtareas y cada modo tiene un "cuándo usarme". Coincide con el §3 (T2/T3) y el §5 |
| **Aider (arquitecto/editor)** | Un modelo planifica y otro edita, a menor coste. Respalda Opus para planificar y Sonnet para ejecutar, y T1 |
| **OpenHands** | Agentes dentro de **contenedores Docker**: la respuesta al riesgo principal de `docs/09` (sin sandbox) |
| **Plugins planner/generator/reviewer y wmux-orchestrator** | El mismo patrón que GuildFlow (lo valida) y oleadas de agentes en paralelo con revisión automática al final, para la Fase 4 |
| **claude-flow / Ruflo** | Enjambre y memoria persistente. Sus afirmaciones de ahorro no tienen datos verificables; como idea, una **memoria de lecciones** entre misiones (qué falló y por qué) |

## 8. Temática de rol (D&D) y personalidades

**Principio:** el tema viste el mensaje, no lo sustituye. Cada mensaje temático tiene **dos capas**:
- Una cabecera de rol.
- Una línea llana con el dato exacto.

**Ejemplo, el diálogo de aprobación:**

> 📜 **Pergamino de misión · q-…** — *El Archimago ha trazado la ruta.*
> **Plan:** 5 subtareas · rutas: `src/engine/`, … · comprobaciones: `node --test …`
> **Límites:** 12 iteraciones · 3M tokens · 120 min. ¿Sellas el pergamino? **[Aprobar] [Rechazar]**

- **Dónde va el tema:** en la **capa de presentación del mod** (el Escriba): diálogos, franja, panel, resúmenes y tablón. Ahí cuesta **0 tokens** y no afecta a la precisión.
- **Personalidades:** mejor como *voz* del texto que genera el mod que como instrucciones de los modelos. En los modelos, la personalidad añade tokens de salida y puede restar claridad. Como mucho, una firma breve en el informe del agente ("— Paladín, campo de pruebas").
- **Glosario fijo**, para que se entienda siempre:

| Término temático | Significado |
|---|---|
| misión | quest |
| pergamino | plan |
| sello | aprobación |
| forja | implementación |
| juicio del Paladín | revisión |
| prueba de fuego | test |
| bitácora | log |
| crónica | resumen |
| maldición | bloqueo |
| tesoro gastado | coste |

- **Accesibilidad:** se mantiene la información sin depender del color ni del icono, y la línea llana siempre presente.

## 9. Orden recomendado

| Prioridad | Trabajo | Por qué |
|---|---|---|
| 1 | §1: arranque nativo de `/quest` | Lo que pediste explícitamente: cero "empieza" |
| 2 | §6: presupuesto de agentes derivado del plan | Pixel Chess quedó a un agente de detenerse |
| 3 | §5: subtarea de especificación ejecutable + nuevo cálculo de huellas + heurística | Sin esto, una petición normal sin tests queda poco verificada |
| 4 | §3 T2–T4: optimización y medición de tokens | Barato y mide lo que el §4 necesita |
| 5 | §2: catálogo de recursos y recursos por subtarea | Más capacidad; necesita la clasificación de herramientas MCP |
| 6 | §4: benchmark A/B | Mejor con el §3 T4 ya registrando bien |
| 7 | §8 dentro de la Fase 3 (tablón) | La estética vive en la misma capa de presentación |

## 10. Estado de implementación (2026-10-11, aprobado por la persona usuaria)

**Decisión de la persona sobre recursos de terceros.** Los plugins, servidores MCP y skills que proponga el plan, una vez aprobados, **los instala el sistema**: nunca se pide a la persona que los instale. Solo el software descargable se le indica para que lo descargue. GuildFlow es de uso personal y la persona asume el riesgo.

| § | Estado | Dónde |
|---|---|---|
| 1. Arranque nativo | **Implementado.** `skills/quest/SKILL.md` + hook `command.run` delante (crea la misión o responde sin abrir turno). En vivo: pendiente del benchmark (sesión A) | `register.tsx` `cmdQuest` |
| 2. Recursos | **Implementado.** Aprobación automática solo con herramientas de la lista de confianza `trustedTools`, no por heurística de nombre. Catálogo en el brief del Archimago, `tasks[].resources` con variante registrada del Artífice (herramientas y skills precargadas), `plan.installs` (lo instala el sistema tras la aprobación; el software se indica a la persona) y comandos de instalación aprobados permitidos al Maestro | `catalog`, `artificeTypeFor`, `installSteps`, `policy.ts` |
| 3. Tokens | **T1–T4 implementados.** T1, por decisión de la persona: Maestro en Sonnet mientras la misión trabaja y Archimago obligatorio para planes de más de una subtarea (`maestroModel`). T2–T4: sin brief de vuelta al Maestro, informes compactos y desglose `input`/`output`/`cacheWrite`/`costDelta`. T5 (`AGENTS.md` de MAIA): ya no se carga | `register.tsx`, `machine.ts` `account` |
| 4. Benchmark A/B | **Preparado:** `bench/README.md`, `bench/score.mjs`, 12 tests ocultos validados y clones en `Desktop/bench/`. Falta ejecutarlo (dos sesiones de la persona) | `bench/` |
| 5. Petición sin indicaciones | **Implementado.** Regla de cuándo usar al Archimago en la skill, especificación ejecutable (dependencia obligatoria y `rebaseProtected` al terminar) | `SKILL.md`, `checkOverlaps`, `rebaseSpec` |
| 6. Presupuesto de agentes | **Implementado.** `agentBudget` derivado del plan, techo 40 y tope 60, visible en el diálogo y en el estado | `machine.ts` |
| 7. Referentes | Ideas incorporadas en 1, 3, 5 y 6. Sandbox (OpenHands) y memoria de lecciones quedan para la Fase 4 | — |
| 8. Temática D&D | Pendiente: Fase 3, en la capa de presentación | — |

Además se corrigió el falso positivo del `Glob` con patrón absoluto dentro del proyecto.

## 11. Calidad visual (tras el benchmark A/B)

**Causa:** en A nadie vio la interfaz. Los criterios visuales eran una lista que se verificaba leyendo código. La interfaz y el arte los hizo Sonnet con pocas peticiones y en subtareas separadas. B (Opus, una sola sesión) usó el navegador 25 veces y corrigió lo que vio.

**Implementado:**
- subtareas `visual` con navegador solo local para el Artífice y el Paladín;
- criterios `visual` que exigen capturas;
- `preview` del plan convertido en `launch.json`;
- `model: "opus"` por subtarea;
- reglas del Archimago para lo visual: skill de diseño y subtarea final de pulido.

**Pendiente:** repetir la sesión A sobre un clon limpio y comparar con B.

## Fuentes

- Comandos y estructura de plugins de Claude Code: <https://code.claude.com/docs/en/plugins/manifest-reference>, <https://code.claude.com/docs/en/agent-sdk/plugins>, <https://code.claude.com/docs/en/skills>
- Spec Kit, BMAD y similares (resúmenes secundarios): <https://ssojet.com/blog/best-spec-driven-development-tools>, <https://medium.com/@visrow/spec-driven-development-is-eating-software-engineering-a-map-of-30-agentic-coding-frameworks-6ac0b5e2b484>, <https://medium.com/@visrow/a-tale-of-two-frameworks-bmad-method-vs-github-spec-kit-c021ab0ad037>
- Roo Code Boomerang: <https://docs.roocode.com/features/boomerang-tasks>, <https://docs.roocode.com/update-notes/v3.15.2>
- OpenHands: <https://arxiv.org/html/2407.16741v3>, <https://github.com/OpenHands/software-agent-sdk>
- Aider arquitecto/editor: <https://www.promptlayer.com/glossary/aider-architect-mode>
- Plugins de orquestación: <https://www.claudepluginhub.com/plugins/artmin96-agents-plugins-agents>, <https://github.com/amirlehmam/wmux-orchestrator>
- claude-flow: <https://github.com/bitdynamo/claude-flow>
