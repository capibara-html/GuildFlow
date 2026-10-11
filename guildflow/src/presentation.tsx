// Presentación: texto y árboles de UI derivados SOLO de la misión persistida (sin datos inventados).
// Separada del dominio: el futuro tablón pixel art sustituye esta capa sin tocar machine.ts.
import type { AgentRecord, Limits, Plan, Quest, Role } from '../types'
import { agentBudget, elapsedMs, nextStep, progressSummary } from './machine'

type Station = Role | 'maestro' | 'escriba'

export const STATIONS: Record<Station, { name: string; place: string; glyph: string; color: string }> = {
  maestro: { name: 'Maestro del Gremio', place: 'mostrador de misiones', glyph: '⚖', color: '#d4a72c' },
  archimago: { name: 'Archimago', place: 'mesa de mapas', glyph: '✶', color: '#8e7cf0' },
  artifice: { name: 'Artífice', place: 'forja', glyph: '⚒', color: '#e07a4f' },
  paladin: { name: 'Paladín', place: 'campo de pruebas', glyph: '⛨', color: '#6fa8f5' },
  escriba: { name: 'Escriba', place: 'atril de registros', glyph: '✎', color: '#9aa0a6' },
}

/** Iconos SVG estáticos y originales (16×16): mostrador, mapa, yunque, escudo, pergamino. Sin animación. */
const ICON_BODY: Record<Station, string> = {
  maestro: '<rect x="1" y="9" width="14" height="5" fill="#7a5230"/><rect x="1" y="8" width="14" height="2" fill="#a8743f"/><circle cx="8" cy="5" r="3" fill="#d4a72c"/><rect x="7" y="4" width="2" height="2" fill="#8a6a10"/>',
  archimago: '<rect x="1" y="3" width="14" height="10" fill="#e8dcb5"/><path d="M3 10 L6 6 L9 9 L13 4" stroke="#8e7cf0" stroke-width="1.5" fill="none"/><circle cx="13" cy="4" r="1.5" fill="#c0392b"/>',
  artifice: '<path d="M2 6 H14 L12 9 H9 V12 H11 V14 H5 V12 H7 V9 H4 Z" fill="#5d6d7e"/><rect x="10" y="1" width="2" height="5" fill="#8b5a2b"/><rect x="8" y="1" width="6" height="2" fill="#aab7b8"/><circle cx="3" cy="4" r="1" fill="#e07a4f"/>',
  paladin: '<path d="M8 1 L14 3 V8 C14 12 11 14 8 15 C5 14 2 12 2 8 V3 Z" fill="#6fa8f5"/><path d="M8 3 V13 M4 7 H12" stroke="#f4f6f7" stroke-width="1.5"/>',
  escriba: '<rect x="3" y="2" width="10" height="12" rx="1" fill="#f3e9d2"/><path d="M5 5 H11 M5 8 H11 M5 11 H9" stroke="#9aa0a6"/><path d="M12 9 L15 2" stroke="#2c3e50" stroke-width="1.2"/>',
}
export const icon = (s: Station, px = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}" shape-rendering="crispEdges">${ICON_BODY[s]}</svg>`

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

const STATE_COLOR: Record<string, string> = {
  DONE: '#2ecc71',
  LOGGED: '#2ecc71',
  HALTED: '#e74c3c',
  BLOCKED: '#e67e22',
  PAUSED: '#f1c40f',
  AWAITING_APPROVAL: '#f1c40f',
}
export const stateColor = (s: string) => STATE_COLOR[s] ?? '#6fa8f5'

/** Agentes que se muestran como activos: solo los que el registro tiene en curso (nunca perdidos). */
export const liveAgents = (q: Quest) => q.agents.filter(a => a.status === 'running')

export function agentLine(a: AgentRecord, now: number): string {
  const st = STATIONS[a.role]
  const dur = fmtDur((a.endedAt ?? now) - a.startedAt)
  return `${st.glyph} ${st.name}${a.taskId ? ` ${a.taskId}` : ''} · ${a.model.replace('claude-', '')} · esfuerzo ${a.effort ?? '?'} · ${a.lastTool ?? '—'} · ${dur} · ${a.status}${a.partial ? ' (parcial)' : ''} · ${fmtTokens(a.tokens)} tok`
}

export function headline(q: Quest, now: number): string {
  const p = progressSummary(q)
  const u = q.usage
  const cost = u.costStartUsd !== null ? ` · ≈$${u.costUsd.toFixed(2)}` : ''
  return `GuildFlow ${q.id} · ${q.state} · criterios ${p.criteriaPassed}/${p.criteriaTotal} · subtareas ${p.tasksDone}/${p.tasksTotal} · ${fmtTokens(u.mainTokens + u.agentTokens)}/${fmtTokens(q.limits.tokenBudgetPerQuest)} tok${cost} · ${fmtDur(elapsedMs(q, now))}`
}

/** Qué está pasando, en una frase para la persona (línea de estado, avisos y franja). */
export function stateLine(q: Quest): string {
  const p = progressSummary(q)
  const crit = `criterios ${p.criteriaPassed}/${p.criteriaTotal}`
  const attempt = q.activeTask ? ` (intento ${q.progress[q.activeTask]?.attempts ?? 1})` : ''
  const phrase: Record<string, string> = {
    INTAKE: '⏳ trabajando · preparando la misión',
    PLANNING: '⏳ trabajando · el Maestro planifica',
    AWAITING_APPROVAL: '✋ esperando tu aprobación del plan',
    DISPATCH: '⏳ trabajando · despachando la siguiente subtarea',
    IMPLEMENTING: `⏳ trabajando · Artífice en ${q.activeTask ?? '?'}${attempt}`,
    VERIFYING: '⏳ trabajando · el mod verifica',
    REVIEWING: `⏳ trabajando · Paladín revisa ${q.activeTask ?? ''}`.trim(),
    FIXING: `⏳ trabajando · corrigiendo ${q.activeTask ?? ''}`.trim(),
    DONE: `✅ completada · ${crit}`,
    LOGGED: `✅ completada · ${crit} · resumen en .guildflow/summary-${q.id}.md`,
    PAUSED: '⏸ en pausa · /quest-resume para seguir',
    HALTED: `⛔ detenida · ${q.reason ?? ''}`,
    BLOCKED: `⚠ bloqueada, necesita tu decisión · ${q.reason ?? ''}`,
  }
  return `GuildFlow ${q.id} · ${phrase[q.state] ?? q.state}`.replace(/ · $/, '').slice(0, 300)
}

/** Texto completo del estado (comando /quest-status y herramienta quest status). */
export function statusText(q: Quest, now: number): string {
  const lines = [headline(q, now), `Petición: ${q.request}`]
  if (q.reason) lines.push(`Motivo: ${q.reason}`)
  for (const t of q.plan?.tasks ?? []) {
    const p = q.progress[t.id]
    lines.push(`• ${t.id} ${t.title} — ${p?.status ?? '?'} · intentos ${p?.attempts ?? 0}/${t.maxAttempts + (p?.bonusAttempts ?? 0)}${p?.lastFailure ? ` · último fallo: ${p.lastFailure}` : ''}`)
    for (const c of t.criteria) {
      const ev = p?.evidence[c.id]
      const cur = ev && ev.round === p.round ? ev.verdict : '—'
      lines.push(`    ${cur.padEnd(12)} ${c.id} [${c.check}] ${c.text}`)
    }
  }
  const live = liveAgents(q)
  lines.push(live.length ? `Agentes activos:\n${live.map(a => `  ${agentLine(a, now)}`).join('\n')}` : 'Agentes activos: ninguno')
  const lost = q.agents.filter(a => a.status === 'lost')
  if (lost.length) lines.push(`Agentes perdidos: ${lost.map(a => `${a.role} ${a.id}`).join(', ')}`)
  if (q.lastCheck) lines.push(`Última verificación: ${q.lastCheck.checkId} ${q.lastCheck.pass ? 'PASS' : 'FAIL'} (${q.lastCheck.reason}) ${q.lastCheck.runId}`)
  const u = q.usage
  lines.push(
    `Consumo: principal ${fmtTokens(u.mainTokens)} · subagentes ${fmtTokens(u.agentTokens)} · lecturas de caché ${fmtTokens(u.cacheReadTokens)} · ${u.requests} peticiones · ` +
      `${u.costStartUsd !== null ? `≈$${u.costUsd.toFixed(2)} equivalentes (precio API, no lo facturado)` : 'coste no disponible'}${u.ratePercent !== null ? ` · suscripción ${u.ratePercent}%` : ''}` +
      `${u.unavailable.length ? ` · sin datos: ${u.unavailable.join(', ')}` : ''}`,
  )
  lines.push(`Iteraciones ${q.iterations}/${q.limits.maxQuestIterations} · agentes ${q.agentsSpawned}/${agentBudget(q)} · archivos ${q.filesWritten.length}/${q.limits.maxFilesChanged}`)
  lines.push(`Siguiente: ${nextStep(q)}`)
  return lines.join('\n')
}

/** Resumen mecánico final (Escriba sin modelo). */
export function summaryMarkdown(q: Quest, runs: string[], now: number): string {
  const p = progressSummary(q)
  const out = [
    `# Misión ${q.id}`,
    '',
    `- **Resultado:** ${q.state}${q.reason ? ` (${q.reason})` : ''}`,
    `- **Petición:** ${q.request}`,
    `- **Aprobada:** ${q.approval ? new Date(q.approval.at).toISOString() : 'no'} · plan ${q.planHash ?? '—'}`,
    `- **Criterios:** ${p.criteriaPassed}/${p.criteriaTotal} · **subtareas:** ${p.tasksDone}/${p.tasksTotal}`,
    `- **Duración activa:** ${fmtDur(elapsedMs(q, now))} · **iteraciones:** ${q.iterations} · **agentes:** ${q.agentsSpawned}`,
    `- **Consumo:** ${fmtTokens(q.usage.mainTokens)} principal + ${fmtTokens(q.usage.agentTokens)} subagentes (+${fmtTokens(q.usage.cacheReadTokens)} lecturas de caché) · ${q.usage.costStartUsd !== null ? `≈$${q.usage.costUsd.toFixed(2)} equivalente a API` : 'coste no disponible'}`,
    '',
    '## Subtareas',
  ]
  for (const t of q.plan?.tasks ?? []) {
    const pr = q.progress[t.id]
    out.push(`### ${t.id} · ${t.title} — ${pr?.status} (${pr?.attempts} intentos)`)
    for (const c of t.criteria) {
      const ev = pr?.evidence[c.id]
      out.push(`- ${ev?.verdict ?? 'NOT_RUN'} · ${c.id} · ${c.text} — ${ev?.source ?? '—'}: ${(ev?.detail ?? '').split('\n')[0].slice(0, 200)}${ev?.runId ? ` (${ev.runId})` : ''}`)
    }
    const failed = Object.entries(pr?.failures ?? {})
    if (failed.length) out.push(`- Fallos corregidos o repetidos: ${failed.map(([s, n]) => `${s}×${n}`).join(', ')}`)
  }
  out.push('', '## Archivos modificados', ...(q.filesWritten.length ? q.filesWritten.map(f => `- ${f.slice(q.project.length + 1)}`) : ['- (ninguno registrado)']))
  out.push('', '## Verificaciones', ...(runs.length ? runs.map(r => `- ${r}`) : ['- (ninguna)']))
  out.push('', '## Pendiente y siguiente paso', `- ${q.state === 'DONE' || q.state === 'LOGGED' ? 'Nada pendiente: misión completada' : nextStep(q)}`)
  return `${out.join('\n')}\n`
}

type El = Record<string, (props: Record<string, unknown>) => unknown>

/** Banda sobre el prompt: estado, progreso y una fila por agente activo. */
export function band(el: El, q: Quest, now: number, desktop: boolean) {
  const { Box, Text, Svg } = el as Record<string, any>
  const live = liveAgents(q)
  const finished = q.state === 'LOGGED' || q.state === 'DONE'
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {desktop ? <Svg source={icon('maestro', 14)} alt="Mostrador del gremio" width={14} height={14} /> : <Text>{STATIONS.maestro.glyph}</Text>}
        <Text color={stateColor(q.state)} bold>
          {stateLine(q).replace(`GuildFlow ${q.id} · `, '')}
        </Text>
      </Box>
      <Text dimColor>{`  ${headline(q, now).replace(`GuildFlow ${q.id} · ${q.state} · `, `${q.id} · `)}`}</Text>
      {live.map(a => (
        <Text key={a.id} color={STATIONS[a.role].color}>
          {`  ${agentLine(a, now)}`}
        </Text>
      ))}
      {finished ? <Text dimColor>{'  /quest <petición> abre otra misión · /quest-status para el detalle'}</Text> : <Text dimColor>{`  siguiente: ${nextStep(q)}`}</Text>}
    </Box>
  )
}

/** Panel lateral: las cinco estaciones del gremio y el tablón de criterios. */
export function pane(el: El, q: Quest | null, now: number, desktop: boolean) {
  const { Box, Text, Svg } = el as Record<string, any>
  if (!q) return <Text dimColor>Sin misión. Escribe /quest &lt;petición&gt; para abrir una.</Text>
  const occupied = (s: Station) =>
    s === 'maestro' ? q.state : s === 'escriba' ? `${q.progressMark} eventos` : (liveAgents(q).find(a => a.role === s) ? 'trabajando' : 'libre')
  const stations = (Object.keys(STATIONS) as Station[]).map(s => (
    <Box key={s} flexDirection="row" gap={1}>
      {desktop ? <Svg source={icon(s, 20)} alt={STATIONS[s].place} width={20} height={20} /> : <Text color={STATIONS[s].color}>{STATIONS[s].glyph}</Text>}
      <Text color={STATIONS[s].color} bold>
        {STATIONS[s].name}
      </Text>
      <Text dimColor>{`${STATIONS[s].place} · ${occupied(s)}`}</Text>
    </Box>
  ))
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={stateColor(q.state)}>{`Tablón de misiones · ${q.id} · ${q.state}`}</Text>
      <Box flexDirection="column">{stations}</Box>
      <Text>{statusText(q, now)}</Text>
    </Box>
  )
}

/** Tope del texto del diálogo de aprobación: un plan que no cabe completo no se aprueba en un diálogo. */
export const APPROVAL_MAX = 3000

/**
 * Texto del diálogo de aprobación: TODAS las rutas y TODOS los argv completos, sin recortes. null si no cabe
 * (el plan se rechaza y hay que dividirlo): nunca se aprueba algo que la persona no pudo leer entero.
 */
export function approvalText(id: string, plan: Plan, limits: Limits): string | null {
  const tasks = plan.tasks
    .map(t => {
      const r = [...t.resources.tools, ...t.resources.skills.map(x => `skill ${x}`)]
      const tags = [t.visual ? 'visual: con navegador local' : '', t.model === 'opus' ? 'Artífice Opus' : ''].filter(Boolean)
      return `${t.id}${tags.length ? ` (${tags.join(', ')})` : ''} escribe en [${t.paths.join(', ')}]${r.length ? ` usando ${r.join(', ')}` : ''}`
    })
    .join('; ')
  const checks = plan.checks.map(k => `${k.id} = ${JSON.stringify(k.argv)} en ${k.cwd} (protege ${k.protects.join(', ') || '—'})`).join('; ') || 'ninguna'
  const installs = plan.installs.length
    ? ` — Recursos de terceros: ${plan.installs.map(i => (i.kind === 'software' ? `DESCARGAR TÚ ${i.name} (${i.url})` : `INSTALAR ${i.kind} ${i.name}: ${i.argv.join(' ')}`)).join('; ')}`
    : ''
  const preview = plan.preview
    ? ` — Vista previa: ${JSON.stringify(plan.preview.argv)} en el puerto ${plan.preview.port} (el navegador ejecuta el código del proyecto, que puede usar la red)`
    : ''
  const agents = Math.min(limits.maxAgentsPerQuest, plan.tasks.reduce((n, t) => n + Math.min(t.maxAttempts, limits.maxAttemptsPerTask) * 2, 0))
  const text =
    `GuildFlow ${id}: ${plan.objective} — ${plan.tasks.length} subtareas: ${tasks} — ${plan.checks.length} comprobaciones: ${checks}${installs}${preview} — ` +
    `Límites: hasta ${agents} agentes, ${limits.maxAttemptsPerTask} intentos/subtarea, ${limits.maxQuestIterations} iteraciones, ${fmtTokens(limits.tokenBudgetPerQuest)} tokens, $${limits.costBudgetUsd} equiv., ${limits.wallClockMinutes} min. ¿Apruebas el plan?`
  return text.length > APPROVAL_MAX ? null : text
}
