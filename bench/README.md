# Benchmark A/B: GuildFlow frente a una sesión tradicional

Misma especificación, mismo punto de partida y misma petición en dos sesiones nuevas. Sirve también como prueba en vivo de lo que se añadió tras Pixel Chess:
- arranque nativo de `/quest`;
- petición sin indicaciones de qué agente hace qué;
- presupuesto de agentes según el plan;
- catálogo de recursos;
- informes compactos.

## Punto de partida

`C:\Users\RYZEN\Desktop\bench\chess-a` y `chess-b` son clones de `pixel-chess@7a4ac0a`: `SPEC.md` y 36 tests de aceptación, sin código.

## Ejecución (la persona usuaria)

Usa el mismo modelo y el mismo esfuerzo en las dos sesiones. Anota la hora de inicio y fin, y cada vez que tengas que intervenir.

| | Sesión A (GuildFlow) | Sesión B (tradicional) |
|---|---|---|
| Carpeta | `C:\Users\RYZEN\Desktop\bench\chess-a` | `C:\Users\RYZEN\Desktop\bench\chess-b` |
| Mensaje | `/quest Construye Pixel Chess según SPEC.md.` | `Construye Pixel Chess según SPEC.md.` |
| Intervenciones esperadas | Aprobar el plan, si es grande o sensible | Lo que pida la sesión |

En B, GuildFlow está cargado, pero sin misión no interviene. Claude Code trabaja como siempre, con sus propios subagentes si quiere.

## Medición (la hace el Maestro al terminar)

- **Consumo de cada sesión:** tokens, coste equivalente y tiempo, con las herramientas de uso de sesiones de Desktop.
- **Puntuación:** `node bench/score.mjs <carpeta>`.
  - Tests visibles (36).
  - **Tests ocultos** (12, en `bench/hidden/`). Ninguna sesión los ve; solo comprueban lo que promete la SPEC, y la versión hecha por GuildFlow en `pixel-chess` los pasa todos.
  - Si se tocaron `test/`, `SPEC.md` o `package.json`.
- **Revisión a ciegas** del código y del juego en el navegador.

## Qué se compara

| Métrica | Hipótesis |
|---|---|
| Coste y tokens | B gasta menos: no tiene Paladines, briefs ni verificación del mod |
| Tiempo | B probablemente más rápido |
| Intervenciones humanas | Similares, o menos en A |
| Tests ocultos | **Lo que decide si el sobrecoste de A compra calidad** |
| Manipulación de tests | Imposible en A (protegidos); posible en B |
| Trazabilidad | A deja plan, evidencia por criterio y crónica; B solo el chat |
