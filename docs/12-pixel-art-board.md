# 12 — Fase 3: la oficina del gremio en pixel art

**Fecha:** 2026-10-12 · **Rama:** `fase-2-guildflow` · **Estado:** escena, personajes, animación e integración hechos y probados con el kit de pruebas. La persona usuaria revisó la entrega y dio el visto bueno («Todo bien»); no se adjuntaron capturas de Desktop (§10).

Sustituye el tablón anterior, que eran cinco puestos de 32×32 en fila sobre un suelo. Ahora es una sala completa de 200×120 píxeles con los cinco puestos, un tablón de encargos con una nota por subtarea, una placa de estado, el cofre del tesoro y la pila de la crónica. Todo sale de la misión persistida. La máquina de estados, la política, la validación, la persistencia y la verificación no se han tocado.

## 1. Auditoría (antes de diseñar)

| Pieza | Estado encontrado | Decisión |
|---|---|---|
| `src/presentation.tsx` | Panel con cabecera, `Svg` del tablón, botones Detener, Reanudar o Revisar el plan y Animación, progreso, encargos, tesoro y bitácora; banda y textos para terminal | **Se conserva**; se reescribe el panel por dentro y se añade el mapeo único de poses (`poseOf`, `cast`) |
| `src/sprites.ts` | 5 sprites procedurales 32×32, 3 poses (`work`, `rest`, `alert`) | **Se sustituye**: compositor de la oficina |
| `src/theme.ts` | Temas `gremio` y `sobrio`, voces, glosario | Sin cambios |
| `hooks/register.tsx` | `viewA` (copia de la misión), `animA` (persiste en `$.store`), `recentA` (bitácora), botones con los mismos caminos que `/quest-halt` y `/quest-resume` | Se conserva; solo se añade `detailA` (botón «Estado completo») |
| API de Desktop 2.1.295 | `Svg`: hasta 131 072 caracteres; se dibuja como imagen y, con `isInteractive`, en un marco aislado sin scripts donde funciona SMIL. `Client`: módulo en el hilo de dibujo con reloj de fotogramas, pero su tabla de elementos **no incluye `Svg`** | **Un solo `Svg` por escena**. `Client` no sirve para dibujar píxeles (solo `Box`/`Text`) |
| Datos para animar | `q.state`, `q.agents[]` (rol, estado `running/done/lost/…`, `taskId`, `lastTool`), `q.progress[t].status`, `q.usage`, `q.limits`, la bitácora (`recentA`) | Las poses usan solo estos datos (§5) |

**Lo que no había:** recursos de Aseprite. Aseprite 1.3.14 está disponible por su servidor MCP (`mcp__aseprite__*`) y se usa en la canalización (§4); no se instaló nada.

## 2. Dirección artística

Sede de aventureros vista en tres cuartos desde arriba. La pared del fondo es de sillería gris con viga de nogal y zócalo, y el suelo, de tablones. La luz es cálida: fragua, velas y antorchas, más una ventana fría a la izquierda. Las sombras son planas, bajo personajes y muebles. Los cinco puestos comparten escala, contorno de tinta y paleta:

| Puesto | Dónde | Muebles y objetos | Rasgo del personaje |
|---|---|---|---|
| **Maestro** (sesión principal) | Centro, al fondo | Mostrador con molduras doradas, libro de registros, vela, pergaminos; detrás, el **tablón de encargos**; colgada del frente, la **placa de estado** | Jubón dorado y cadena de oficio. Es el único personaje con la cabeza descubierta |
| **Archimago** | Izquierda, al fondo | Estantería con lomos y frascos, ventana, mesa con mapa desplegado, libros y **esfera arcana** (se enciende al trabajar) | Sombrero puntiagudo con estrella, barba larga, vara |
| **Artífice** | Derecha, al fondo | **Fragua** de ladrillo cocido con campana y fuego, yunque sobre tocón, barril de templar | Pañuelo y gafas de forja, delantal de cuero, martillo |
| **Paladín** | Derecha, delante | Tapiz de prácticas, muñeco con diana, atril de normas de piedra, armero | Yelmo cerrado con penacho, escudo con emblema, espada |
| **Escriba** (mecánico) | Izquierda, delante | Atril con el libro de crónicas, tintero, pluma, taburete con **una hoja por evento de la bitácora** | Capucha gris y anteojos |

En el centro, delante, está el **cofre del tesoro**: más monedas a mayor consumo real del presupuesto.

**Paleta** (`PAL` en `src/art.ts`, 99 colores con los de rol, exportada a `art/paleta.gpl`): pergamino `#efe2bf/#dcc79a/#bfa577`, nogal `#3b2419…#b07a51`, piedra `#47404f/#5d5664/#736b78`, oro viejo `#7d5d1e/#b88d32/#e2c063`, fuego `#8e2f1f…#fff1b8`, violeta arcano `#3f2c78…#e2dbff`, azul acero `#2f4a78/#4f7cc0/#8db2e6` y tinta `#1e1620` para el contorno. Los colores de rol coinciden con la capa temática: Maestro oro, Archimago violeta, Artífice naranja, Paladín azul y Escriba gris. El agente perdido usa un gris azulado apagado. El texto del panel no es pixelado: lo dibuja el motor con su tipografía.

**Dimensiones.** Escena de 200×120 píxeles lógicos, dibujada a 2× (400×240 CSS px) y estrechada por el motor si el panel es más pequeño (sin `width` en `Svg`). Los personajes miden 18×26, con 4 columnas más de alcance para armas y herramientas. Las insignias son de 7×7, las notas del tablón de 8×9 y la placa de 12×8.

## 3. Personajes y poses

Una sola familia: cabeza grande de 10 columnas, cuerpo de 8, piernas cortas y contorno de tinta automático. Cada personaje es una pila de capas de texto (`src/art.ts`): cuerpo (túnica o hábito), cara, cabeza propia del rol, brazos comunes y accesorio del rol. Los brazos y las caras son los mismos para todos, así que las poses de los cinco son coherentes; cambian la silueta (sombrero, yelmo, capucha, pelo) y los colores (`ROLE_COLORS`).

| Pose | Brazos | Qué cambia por rol | Fotogramas |
|---|---|---|---|
| `idle` | a los lados | vara, escudo y espada, martillo, pluma | 1 |
| `working` | golpe arriba / golpe abajo (el Archimago sostiene un libro) | sello sobre el libro; lee (pasa página); martillo y chispas; estocada al muñeco; pluma sobre el atril | 2 |
| `thinking` | mano a la barbilla | el Archimago tiene una chispa de idea en el 2.º fotograma | 1 (2 el Archimago) |
| `reviewing` | las dos al frente | Artífice: tenazas con la pieza al rojo; Paladín: pergamino de normas | 2 |
| `success` | en alto | el Maestro lleva insignia ✓ verde | 1 |
| `blocked` | mano a la cabeza | insignia «!» roja | 1 |
| `lost` | a los lados | todo en gris azulado e insignia «?» | 1, nunca animada |
| `awaiting` (solo el Maestro) | brazo alzado con el pergamino sellado | insignia «!» dorada | 1, nunca animada |

La hoja completa está en `art/personajes.png`: una fila por rol y una columna por pose y fotograma.

## 4. Fuentes y canalización

- **Fuente editable:** `guildflow/src/art.ts`. Son mapas de píxeles en texto, con una letra por píxel y `.` transparente, más las paletas. Se pueden editar en cualquier editor y revisar en un diff, y no hay binarios que regenerar para que el mod funcione.
- **Compositor:** `guildflow/src/sprites.ts`. Compone la sala en una cuadrícula de 200×120, añade el contorno y codifica **un `<path>` por color** con tramos horizontales y movimientos relativos (`M x y.5hW m dx dy hW…`). Ocupa entre 41 y 45 KB por escena; el máximo medido es 44 893 caracteres, con el tablón lleno y varios puestos animados, de los 131 072 permitidos.
- **Herramienta de arte:** `node guildflow/scripts/art.mjs` (Node ≥ 22.6; ejecuta el TypeScript de `src/` sin compilar). Escribe:
  - `art/preview.html`: los SVG reales, animados, de cada fixture. Se sirve en local (`python -m http.server --directory guildflow/art`) y no se versiona.
  - `art/capturas/*.png`: el primer fotograma de cada fixture a 3×.
  - `art/personajes.png`: la hoja de personajes a 4×.
  - `art/paleta.gpl`: la paleta para Aseprite (*Palette → Load*).
  - Además imprime el tamaño de cada SVG.
- **Aseprite (MCP):** se usó para comprobar las exportaciones. Abre `personajes.png` (1056×600, 61 colores con el fondo) y carga `paleta.gpl` (99 colores). Para dibujar un sprite nuevo en Aseprite: carga la paleta, dibuja a 1× en una celda de 22×26 y transcribe los píxeles a letras en `art.ts`. Aseprite no forma parte del arranque del mod.
- **Fixtures:** `FIXTURES` en `scripts/art.mjs` son vistas inventadas para revisar el arte. **Nunca son estado de producción**: el panel solo llama a `cast(quest)`.

## 5. Mapeo de eventos a estados visuales

Hay un único mapeo, `poseOf(q, puesto)` en `src/presentation.tsx`, más `cast(q, hojas)`, que construye la escena entera. Nada aparece trabajando sin un agente con `status: 'running'` en el registro. Con la misión parada (`PAUSED`, `HALTED` o `BLOCKED`) nadie trabaja, aunque un agente siga cerrando su turno.

| Situación real (motor) | Maestro | Archimago | Artífice | Paladín | Escriba | Tablón / placa |
|---|---|---|---|---|---|---|
| Sin misión | idle | idle | idle | idle | idle | vacío / sin placa |
| `INTAKE`, `PLANNING` sin agentes | thinking | idle | idle | idle | idle | ⏳ |
| Archimago en curso | idle | thinking (`working` si su última herramienta es `Read`) | | | | ⏳ |
| `AWAITING_APPROVAL` | **awaiting** | | | | | notas pendientes / «!» |
| `DISPATCH`, `VERIFYING`, `FIXING` sin agentes en curso | working (coordina) | | | | | nota activa con marco dorado |
| Artífice en curso | idle | | working (`reviewing` tras `run_check`) | | | nota naranja |
| Paladín en curso | idle | | | reviewing (`working` tras `run_check`) | | nota azul |
| Agente `lost` (reinicio) | | lost | lost | lost | | — |
| `BLOCKED` | blocked | | blocked si fue el último en la subtarea | ídem | | nota roja / ✕ |
| `HALTED` por límite o seguridad | blocked | | | | | ■ roja |
| `HALTED` por la persona, `PAUSED` | idle | | | | | ■ / ‖ |
| `DONE` | success | success si participó | ídem | ídem | working (escribe la crónica) | ✓ |
| `LOGGED` | success | ídem | ídem | ídem | success | ✓ |

**Otros datos reales en la escena:**

- **Notas:** una por subtarea del plan aprobado, con el color de `progress[t].status` (pendiente, en la forja, verificación, revisión, cola, hecha o bloqueada). El marco dorado marca `activeTask`. Caben 8; la lista de encargos del panel las enumera todas.
- **Hojas de la crónica:** número de entradas de la bitácora del panel, hasta 6.
- **Cofre:** `budgetRatio` = el mayor de tokens/presupuesto, coste/presupuesto (si el motor da coste) y suscripción/umbral (si da `rateLimits`). Va de 0 (vacío) a 4: <0,3; <0,7; <0,9; ≥0,9, que rebosa. Son los mismos cortes que los colores de los medidores.
- **Fragua y esfera:** el fuego está vivo solo si el Artífice trabaja o prueba la pieza; si no, quedan brasas. La esfera se enciende solo con el Archimago trabajando o pensando.

`lastTool` lo actualiza la guarda `tool.call` y llega a la vista con el siguiente cambio guardado (cada petición del agente se contabiliza en `turn.step`). Por eso «tras `run_check`» significa *la última herramienta observada*, no «ejecutándose ahora mismo».

## 6. Animación

- Hay dos fotogramas y **solo se anima lo que cambia**. Se compone el fotograma A completo y el B, y el SVG lleva A entero más un grupo con los píxeles que difieren en B. Ese grupo alterna con SMIL discreto (`opacity 0;1`, 1,2 s). En una escena típica, la capa B añade unos 2–4 KB.
- Animan `working`, `reviewing` y el `thinking` del Archimago (más el fuego y las chispas que van con ellos). **No animan** `idle`, `blocked`, `lost`, `awaiting` ni `success`: la escena no aparenta actividad sin agentes y no depende del movimiento para comunicar nada importante, porque las insignias y la placa son estáticas.
- `isInteractive` (marco aislado necesario para SMIL) solo se pide cuando hay algo que animar y la animación está activa. En otro caso, el SVG se dibuja como imagen.
- **Modo estático:** el botón «Animación: desactivar» (persiste en `$.store.boardAnim`) dibuja un único fotograma, sin `<animate>`.
- **Sin desplazamientos** entre puestos: en el MVP mandan las poses.
- **Caché:** `scene()` guarda las últimas 48 escenas por vista. Un evento que no cambia la vista (por ejemplo, consumo dentro del mismo nivel del cofre) reutiliza el SVG sin recomponer.
- **Rendimiento:** no hay cifra de fps; el marco aislado no ofrece forma de medirla (igual que en la P7, `docs/06`).

## 7. El panel

Sigue este orden en Desktop:

1. **Cabecera**: `📜 Pergamino de misión · <objetivo>`, la línea temática de estado, `Estado real: <ESTADO> · Subtarea: tN · Intento: a/m · <id>` y la petición.
2. **La oficina** (`Svg`).
3. **Quién hace qué**, en texto: una línea por puesto que no está en reposo, con el significado técnico; por ejemplo, «Artífice: forja (agente en curso) · t1» o «perdido tras un reinicio (no trabaja; no se relanza solo)».
4. **Controles**: Detener misión (con confirmación, igual que `/quest-halt`); Reanudar o Revisar el plan (`cmdResume`, que reabre el diálogo de aprobación); **Estado completo** (despliega el mismo texto que `/quest-status`); Animación.
5. **Progreso**: subtareas terminadas y en curso, criterios aprobados, fallidos y pendientes de la ronda vigente, intentos usados y siguiente paso.
6. **Encargos**: una línea por subtarea con id, título, estado, agente asignado (y si está en curso o perdido) e intentos. Debajo, las marcas de los criterios, el último veredicto y el motivo del bloqueo o el último fallo.
7. **Tesoro**: tokens, coste *equivalente API, no facturado*, suscripción frente a su umbral, tiempo, agentes lanzados, iteraciones, archivos y líneas de diff (cuando hay dato). Cada medidor lleva cifra, porcentaje y, a partir del 70 %, la etiqueta «elevado» o «cerca del límite» además del color.
8. **Bitácora**.

En **terminal** no hay `Svg`: el panel es texto con barras `█░`, y conserva el estado, el quién hace qué, los controles, los encargos, el tesoro y la bitácora. El tema `sobrio` quita la ambientación de los títulos y deja la escena igual.

## 8. Limitaciones de Desktop

- Un `Svg` no puede llevar más de 131 072 caracteres; con 200×120 caben de sobra (≈45 KB), pero una escena el doble de grande o más detallada no cabría sin cambiar de técnica.
- `Client` no dibuja `Svg` ni imágenes en Desktop, así que no sirve para sprites. Su reloj de fotogramas solo moverá texto y cajas.
- No se usan imágenes rasterizadas (`<image href="data:…">`). Sería más compacto, pero no está probado que el filtro del motor las deje pasar; los `path` sí están probados desde la P7.
- La escala depende del ancho del panel: a menos de 400 px el motor encoge el SVG y los píxeles dejan de ser enteros. `crispEdges` mantiene bordes nítidos, aunque desiguales.

## 9. Pruebas automáticas

`claude plugin test guildflow` (2.1.295): **213 pass, 0 fail**. `tsc` sin errores y `claude plugin validate guildflow` superada; no hay llamadas de red nuevas (los únicos `$.*` añadidos son lecturas y escrituras de `$.state`).

- `presentation.test.ts` · **oficina: poses con datos reales** (10): sin misión; planificación con y sin Archimago (y `Read` → lee); aprobación pendiente; Artífice sin agente, con agente y tras `run_check`; Paladín revisando y probando; agente perdido tras `recover` (nunca trabaja, no anima); bloqueo marcado en el Maestro y en el último puesto de la subtarea; pausa y detención por la persona y por límite; misión cumplida y crónica (`DONE` → `LOGGED`, solo celebran quienes participaron); notas, hojas y niveles del cofre con consumo real.
- `presentation.test.ts` · **oficina: SVG** (2): todas las poses, con y sin animación y con el tablón lleno, por debajo de 131 072 caracteres, sin `script`, manejadores ni `href`; SMIL solo cuando `animates()`. Cada pose, insignia y placa cambia el dibujo, y la misma vista reutiliza el SVG de la caché.
- `hooks.test.ts` · panel montado en Desktop y en terminal: secciones, `Estado real: IMPLEMENTING · Subtarea: t1`, «Estado completo» despliega el texto de `/quest-status`, y Detener y Reanudar siguen sus diálogos.
- La prueba de `LOGGED` destapó un fallo durante el desarrollo: con la misión cerrada, la escena se vaciaba (`isActive` excluye `LOGGED`). Quedó corregido antes de terminar.

## 10. Revisión visual

**Hecha, sobre las capturas de fixtures** (`art/capturas/`, rasterizadas desde la misma cuadrícula que el SVG): cada situación de la lista de la Fase E, más la ejecución de `run_check` por el Artífice y por el Paladín, la pausa, la detención y el estado con varios puestos a la vez. Ajustes que salieron de mirarlas:

- el libro tapaba la cara del Maestro y se pasó a la derecha del mostrador;
- la fragua se confundía con la pared y ahora es de ladrillo cocido y con contorno;
- se quitó una losa gris que parecía pared;
- se quitó un resplandor en diagonales;
- el icono «en curso» de la placa parecía una cruz médica y pasó a ser un reloj de arena;
- las insignias tapaban el pergamino del Maestro y se movieron a la izquierda de la cabeza;
- la estocada del Paladín no se veía y se alargó la espada;
- los brazos de la pose de éxito parecían orejas y se abrieron hacia fuera.

**Revisión de la persona usuaria (2026-10-12):** tras la entrega respondió «Todo bien» y pidió publicar el repositorio. No se recibieron capturas del panel en Desktop, así que aquí no queda constancia de cada una de las nueve situaciones en vivo. Si una sesión real muestra un problema de escala o de contraste, se anotará en esta sección con su captura.

## 11. Pendiente

- Capturas del panel en Desktop con una misión real, para documentar la revisión en vivo (§10).
- Si la revisión lo pide: escena a 3× en paneles anchos, o un aprendiz junto a la fragua cuando hay Artífices en paralelo (ahora el paralelo se ve en las notas y en el texto, con un solo Artífice dibujado).
- Medir fps: no hay API para hacerlo en el marco aislado.
