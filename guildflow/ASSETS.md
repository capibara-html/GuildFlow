# Activos gráficos y sonoros

| Activo | Dónde | Origen | Licencia |
|---|---|---|---|
| Iconos de las cinco estaciones (mostrador, mesa de mapas, yunque, escudo, pergamino), SVG 16×16 estáticos | `src/presentation.tsx` (`ICON_BODY`) | **Originales**, escritos a mano para GuildFlow (rectángulos y trazos simples) | MIT, como el plugin |
| Oficina del gremio pixel art (200×120): pared, suelo, estantería, ventana, antorchas, tablón de encargos y notas, estandarte, mostrador, libro, vela, pergaminos, mesa, esfera, fragua y fuego, yunque, barril, atril, taburete y hojas, cofre, muñeco, atril de normas, armero, placa e insignias; cinco personajes 18×26 con ocho poses | `src/art.ts` (mapas de píxeles en texto y paletas), compuesto por `src/sprites.ts` | **Originales**, dibujados a mano para GuildFlow como mapas de texto (paleta propia, contorno automático) | MIT, como el plugin |
| Exportaciones del arte: `art/personajes.png`, `art/capturas/*.png`, `art/paleta.gpl` | `art/` | Generadas con `scripts/art.mjs` a partir de `src/art.ts` | MIT, como el plugin |
| Glifos de terminal (⚖ ✶ ⚒ ⛨ ✎ ⏳ ✅ ⚠ ⛔ ⏸ ✋) | `src/presentation.tsx` | Caracteres Unicode estándar; los dibuja la fuente del sistema | — |

**No se incluye** código, sprites, imágenes ni sonidos de los repositorios de referencia (`research/`), ni de claude-mods, Munder Difflin, etc. Cada activo nuevo se registra aquí con su origen y licencia antes de añadirlo.
