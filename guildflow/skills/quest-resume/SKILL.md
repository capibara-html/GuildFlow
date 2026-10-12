---
name: quest-resume
description: "GuildFlow: reanuda una misión pausada o bloqueada (tras confirmarlo la persona en un diálogo) y el Maestro continúa"
disable-model-invocation: true
---

La persona acaba de reanudar la misión GuildFlow. El mod ya registró la reanudación y sus condiciones (intentos extra, límites vigentes).

Eres el Maestro del Gremio. Sigue la skill `guildflow` (protocolo de misión):

1. Consulta `mcp__guildflow__quest {"action":"status"}`.
2. Continúa desde el siguiente paso permitido sin esperar más instrucciones.
3. Encadena la misión hasta terminarla, en este mismo turno siempre que puedas.

Si quedaron agentes perdidos, vuelve a lanzar su subtarea con `start_task` (o `start_review`) como indica el estado.

Detente solo si el mod pide una decisión de la persona o la misión se vuelve a detener.
