# Resultados del benchmark A/B (2026-10-11, una ejecución por variante)

**Mismo punto de partida y misma petición.** `pixel-chess@7a4ac0a` y "Construye Pixel Chess según SPEC.md.", con el mismo modelo en el selector (Opus 5.5).

| | **A · GuildFlow** (`chess-a`) | **B · tradicional** (`chess-b`) |
|---|---|---|
| Tests de aceptación (visibles) | **36/36** | **36/36** |
| Tests ocultos | **12/12** | **12/12** |
| Tocó `test/`, `SPEC.md` o `package.json` | No (protegidos) | No |
| Intervenciones humanas tras la petición | **0** (plan aprobado solo: no sensible, no `large`) | **0** |
| Tiempo (primer a último mensaje) | **11,1 min** | 12,4 min |
| Coste estimado* | **≈ $2,65** | ≈ $3,92 |
| Peticiones al modelo | 78 (30 principal + 48 subagentes) | 46 (todas principal) |
| Tokens de salida | 33k | 66k |
| Lecturas de caché | 3,46 M | 6,34 M |
| Modelos | Maestro Sonnet (26) · Archimago Opus (3) · Artífices y Paladines Sonnet (45) · Opus fuera de la misión (4) | Opus (46), sin subagentes |
| Código | 988 líneas, 8 archivos | 1 076 líneas, 10 archivos (IA en un *Web Worker*) |
| Trazabilidad | Plan aprobado, 19/19 criterios con evidencia (runId o archivo:línea), 5 subtareas al primer intento, crónica en `.guildflow/` | El chat |

\* `bench/usage.mjs` aplica a las dos transcripciones los precios verificados en la PoC. Es una estimación de precio API, no lo facturado.
- **Diferencia con el registro del mod:** para A, el registro de GuildFlow (`costDelta`, calculado por el motor) da $2,16. La diferencia con $2,65 sale de los supuestos de precio de la escritura de caché.
- **Peticiones con Opus fuera de la misión:** las 4 de la sesión principal de A ocurren al arrancar la sesión y en el informe final, cuando la misión ya no trabaja. Cuestan $0,67 de los $2,65.

## Lectura

1. **La hipótesis previa era errónea.** GuildFlow no fue más caro: costó **un 32 % menos** y tardó algo menos, con la misma calidad medible.
   - La causa es el reparto de modelos: en A, casi todo el trabajo lo hace Sonnet y Opus solo planifica.
   - B usó Opus para todo: el doble de tokens de salida, a precio Opus, y casi el doble de lecturas de caché, porque una sola conversación acumula todo el contexto.
2. **Calidad medible empatada.** Las dos pasan los 48 tests. La diferencia, si la hay, estará en lo que no miden los tests: el juego en el navegador, que se revisa a mano.
3. **Qué aporta GuildFlow además del coste:**
   - verificación independiente con evidencia por criterio;
   - tests protegidos;
   - límites;
   - un registro auditable.

   B no deja nada de eso. En esta prueba ninguna de las dos intentó manipular los tests, así que esa protección no se puso a prueba.
4. **Validado en vivo** (fase 2.5):
   - arranque nativo de `/quest`: el Maestro empezó 6 s después, sin "empieza";
   - petición sin indicaciones: el Maestro llamó solo al Archimago;
   - Maestro en Sonnet: las 25 peticiones durante la misión;
   - Archimago en Opus;
   - aprobación automática de un plan no sensible;
   - informes compactos: el Maestro escribió solo 3k tokens de salida en toda la misión.

**Límites del experimento:** es una sola ejecución por variante, con una tarea especificada de antemano y con tests. Con una petición ambigua o un repositorio grande, el resultado puede cambiar. Para afirmarlo con más fuerza harían falta varias ejecuciones y tareas de otro tipo.

## Segunda ronda: A3, GuildFlow con ojos (2026-10-12)

Después de A se añadieron al mod:
- subtareas visuales con navegador local;
- criterios visuales que exigen capturas;
- Opus para el diseño;
- una subtarea final de pulido.

Se repitió A sobre otro clon (`chess-a3`).

| | A (sin ojos) | **A3 (con ojos)** | B (tradicional) |
|---|---|---|---|
| Tests visibles / ocultos | 36/36 · 12/12 | **36/36 · 12/12** | 36/36 · 12/12 |
| Calidad visual (valoración de la persona) | La peor | **La mejor** ("mucho mejor que B") | Buena |
| Subtareas | 5 | 7 (con pulido visual) | — |
| Coste (registro del mod; B: estimación) | $2,16 | $6,32 | ≈ $3,92 |
| Tiempo | 11 min | ~57 min (bloqueo y reanudación incluidos) | 12 min |

**Lectura.** Mirar el resultado es lo que eleva la estética: con los tests, A y A3 son iguales. El coste y el tiempo de A3 están inflados por fallos del entorno y del propio mod, no del trabajo:
- **t6 necesitó 4 intentos:** el Paladín se quedaba sin peticiones haciendo capturas, y el puerto 8000 estaba ocupado por el servidor de otra sesión.
- **Correcciones posteriores** (`a66a2f2` y la siguiente):
  - más peticiones en las subtareas visuales;
  - revisión repetida sin gastar intentos;
  - puerto propio por misión;
  - plan B de la vista previa;
  - `NOT_RUN` por entorno.

**Estimación, sin medir:** sin esos fallos, A3 rondaría $4–4,5 y 25–30 min. Hace falta una ejecución limpia (A4) para confirmarlo.
