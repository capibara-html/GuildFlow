// Presentación: texto y árboles de UI derivados SOLO de la misión persistida (sin datos inventados).
// Separada del dominio: el tablón pixel art (src/sprites.ts) se dibuja aquí sin tocar machine.ts.
import type { AgentRecord, Limits, Plan, Quest, TaskStatus } from '../types'
import { agentBudget, elapsedMs, isActive, isStopped, nextStep, progressSummary } from './machine'
import { scene, type Pose, type Station } from './sprites'
import { LABELS, stateTitle, voice, type Theme } from './theme'

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

/** Pose de cada puesto del tablón, solo con datos reales: un rol trabaja si tiene un agente en curso. */
export function poseOf(q: Quest, s: Station): Pose {
  if (s === 'maestro') return ['AWAITING_APPROVAL', 'BLOCKED'].includes(q.state) ? 'alert' : ['INTAKE', 'PLANNING', 'DISPATCH', 'VERIFYING', 'FIXING'].includes(q.state) && !liveAgents(q).length ? 'work' : 'rest'
  if (s === 'escriba') return q.state === 'DONE' ? 'work' : 'rest'
  return liveAgents(q).some(a => a.role === s) ? 'work' : 'rest'
}
const POSE_TEXT: Record<Pose, string> = { work: 'en faena', rest: 'en reposo', alert: 'te necesita' }

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

/** Qué está pasando, en una frase para la persona (línea de estado, avisos y franja). Tema: cabecera + dato llano. */
export function stateLine(q: Quest, theme: Theme = 'gremio'): string {
  const p = progressSummary(q)
  const crit = `criterios ${p.criteriaPassed}/${p.criteriaTotal}`
  if (theme === 'gremio') {
    const detail: Record<string, string> = {
      AWAITING_APPROVAL: 'aprueba o rechaza el plan en el diálogo',
      VERIFYING: `el mod ejecuta las comprobaciones de ${q.activeTask ?? ''}`.trim(),
      REVIEWING: `${crit}`,
      DONE: `${crit} superados`,
      LOGGED: `${crit} superados · crónica en .guildflow/summary-${q.id}.md`,
      PAUSED: 'en pausa · /quest-resume para seguir',
      HALTED: `detenida · ${q.reason ?? ''}`,
      BLOCKED: `necesita tu decisión · ${q.reason ?? ''}`,
    }
    const d = detail[q.state]
    return `GuildFlow ${q.id} · ${stateTitle(theme, q)}${d ? ` — ${d}` : ''}`.replace(/ · $| — $/, '').slice(0, 300)
  }
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
export function summaryMarkdown(q: Quest, runs: string[], now: number, theme: Theme = 'gremio'): string {
  const p = progressSummary(q)
  const g = theme === 'gremio'
  const out = [
    g ? `# 📜 Crónica de la misión ${q.id}` : `# Misión ${q.id}`,
    '',
    ...(g ? [`> ${voice(theme, 'done', q.id)}`, ''] : []),
    `- **Resultado:** ${q.state}${q.reason ? ` (${q.reason})` : ''}`,
    `- **Petición:** ${q.request}`,
    `- **Aprobada:** ${q.approval ? new Date(q.approval.at).toISOString() : 'no'} · plan ${q.planHash ?? '—'}`,
    `- **Criterios:** ${p.criteriaPassed}/${p.criteriaTotal} · **subtareas:** ${p.tasksDone}/${p.tasksTotal}`,
    `- **Duración activa:** ${fmtDur(elapsedMs(q, now))} · **iteraciones:** ${q.iterations} · **agentes:** ${q.agentsSpawned}`,
    `- **${g ? 'Tesoro gastado (consumo)' : 'Consumo'}:** ${fmtTokens(q.usage.mainTokens)} principal + ${fmtTokens(q.usage.agentTokens)} subagentes (+${fmtTokens(q.usage.cacheReadTokens)} lecturas de caché) · ${q.usage.costStartUsd !== null ? `≈$${q.usage.costUsd.toFixed(2)} equivalente a API` : 'coste no disponible'}`,
    '',
    g ? '## ⚒️ Encargos (subtareas)' : '## Subtareas',
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
  out.push('', g ? '## 🧰 Archivos forjados (modificados)' : '## Archivos modificados', ...(q.filesWritten.length ? q.filesWritten.map(f => `- ${f.slice(q.project.length + 1)}`) : ['- (ninguno registrado)']))
  out.push('', g ? '## 🔥 Pruebas de fuego (verificaciones)' : '## Verificaciones', ...(runs.length ? runs.map(r => `- ${r}`) : ['- (ninguna)']))
  out.push('', g ? '## 🧭 Pendiente y siguiente paso' : '## Pendiente y siguiente paso', `- ${q.state === 'DONE' || q.state === 'LOGGED' ? 'Nada pendiente: misión completada' : nextStep(q)}`)
  return `${out.join('\n')}\n`
}

type El = Record<string, (props: Record<string, unknown>) => unknown>

/** Banda sobre el prompt: estado, progreso y una fila por agente activo. */
export function band(el: El, q: Quest, now: number, desktop: boolean, theme: Theme = 'gremio') {
  const { Box, Text, Svg } = el as Record<string, any>
  const live = liveAgents(q)
  const finished = q.state === 'LOGGED' || q.state === 'DONE'
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {desktop ? <Svg source={icon('maestro', 14)} alt="Mostrador del gremio" width={14} height={14} /> : <Text>{STATIONS.maestro.glyph}</Text>}
        <Text color={stateColor(q.state)} bold>
          {stateLine(q, theme).replace(`GuildFlow ${q.id} · `, '')}
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

/** Una línea de la bitácora del panel. */
export type Entry = { at: number; text: string }

/** Bitácora para la persona: solo los eventos de la máquina que cuentan algo (sin tool.call ni consumo). */
export function chronicle(ev: string, d: Record<string, any>, at: number): Entry | null {
  const who = (r: unknown) => STATIONS[r as Station]?.name ?? String(r)
  const text: Record<string, () => string | null> = {
    'quest.created': () => 'Misión abierta',
    'plan.submitted': () => `Plan presentado (${(d.tasks ?? []).length} subtareas)`,
    'plan.approved': () => `Plan aprobado${d.by === 'auto' ? ' automáticamente' : ''}`,
    'plan.rejected': () => 'Plan rechazado',
    'task.started': () => `${d.taskId}: intento ${d.attempt}`,
    'agent.spawned': () => `${who(d.role)} entra${d.taskId ? ` en ${d.taskId}` : ''}`,
    'agent.finished': () => `${who(d.role)} termina${d.partial ? ' (parcial)' : ''}`,
    'agent.lost': () => `${who(d.role)} perdido${d.taskId ? ` en ${d.taskId}` : ''}`,
    'check.recorded': () => `Comprobación ${d.checkId}: ${d.pass ? 'PASS' : 'FAIL'}`,
    'review.verdict': () => `Paladín: ${d.criterionId} ${d.verdict}`,
    'round.failed': () => `${d.taskId}: ronda fallida`,
    'task.done': () => `${d.taskId} completada`,
    'quest.resumed': () => `Reanudada en ${d.to}`,
    state: () => (['AWAITING_APPROVAL', 'BLOCKED', 'HALTED', 'PAUSED', 'DONE'].includes(d.to) ? `${d.to}${d.reason ? `: ${d.reason}` : ''}` : null),
  }
  const t = text[ev]?.()
  return t ? { at, text: t.slice(0, 160) } : null
}

/** Qué botones ofrece el panel: los mismos caminos que /quest-halt y /quest-resume. */
export function actions(q: Quest | null): { halt: boolean; resume: 'approve' | 'resume' | null } {
  if (!q || !isActive(q)) return { halt: false, resume: null }
  const resume = q.state === 'AWAITING_APPROVAL' ? 'approve' : isStopped(q) && !(q.state === 'HALTED' && q.haltKind === 'safety') ? 'resume' : null
  return { halt: q.state !== 'HALTED' && q.state !== 'DONE', resume }
}

const clamp = (r: number) => (Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0)
const BAR = 120
const bar = (r: number, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR} 8" width="${BAR}" height="8" shape-rendering="crispEdges"><rect width="${BAR}" height="8" fill="#8080803a"/><rect width="${Math.round(clamp(r) * BAR)}" height="8" fill="${color}"/></svg>`
const textBar = (r: number) => '█'.repeat(Math.round(clamp(r) * 12)).padEnd(12, '░')
/** Límites: azul con holgura, ámbar desde el 70 %, rojo desde el 90 %. */
export const limitColor = (r: number) => (r >= 0.9 ? '#e74c3c' : r >= 0.7 ? '#e67e22' : '#6fa8f5')
const VERDICT: Record<string, string> = { PASS: '✔', FAIL: '✘', INCONCLUSIVE: '?', NOT_RUN: '·' }
const TASK: Record<TaskStatus, { glyph: string; color?: string }> = {
  pending: { glyph: '○' },
  active: { glyph: '⚒', color: STATIONS.artifice.color },
  fixing: { glyph: '⚒', color: STATIONS.artifice.color },
  verifying: { glyph: '⚖', color: STATIONS.maestro.color },
  reviewing: { glyph: '⛨', color: STATIONS.paladin.color },
  done: { glyph: '✔', color: '#2ecc71' },
  blocked: { glyph: '⚠', color: '#e74c3c' },
}
const SECTION: Record<Theme, Record<'progress' | 'tasks' | 'treasure' | 'log', string>> = {
  gremio: { progress: '🧭 Progreso', tasks: '⚒️ Encargos', treasure: '💰 Tesoro', log: '🪶 Bitácora' },
  sobrio: { progress: 'Progreso', tasks: 'Subtareas', treasure: 'Consumo y límites', log: 'Registro reciente' },
}

/** Lo que el panel necesita además de la misión: preferencia de animación, bitácora y acciones. */
export type Board = { anim: boolean; recent: Entry[]; onToggleAnim?: () => void; onHalt?: () => void; onResume?: () => void }

/** Panel lateral: la sala del gremio, acciones, progreso, encargos, tesoro y bitácora. Solo datos reales. */
export function pane(el: El, q: Quest | null, now: number, desktop: boolean, theme: Theme = 'gremio', board: Board = { anim: true, recent: [] }) {
  const { Box, Text, Svg, Button } = el as Record<string, any>
  if (!q) return <Text dimColor>{theme === 'gremio' ? 'El tablón está vacío. Escribe /quest <petición> para abrir una misión.' : 'Sin misión. Escribe /quest <petición> para abrir una.'}</Text>
  const g = theme === 'gremio'
  const sec = SECTION[theme]
  const stations = Object.keys(STATIONS) as Station[]
  const poses = Object.fromEntries(stations.map(s => [s, poseOf(q, s)])) as Record<Station, Pose>
  const busy = stations.filter(s => poses[s] !== 'rest')
  const taskOf = (s: Station) => liveAgents(q).find(a => a.role === s)?.taskId
  const who = busy.length
    ? busy.map(s => `${STATIONS[s].glyph} ${STATIONS[s].name} ${POSE_TEXT[poses[s]]}${taskOf(s) ? ` · ${taskOf(s)}` : ''}`).join('   ')
    : g
      ? 'Todo el gremio en reposo'
      : 'Sin agentes en curso'
  const meter = (label: string, r: number, value: string, color: string) => (
    <Box key={label} flexDirection="row" gap={1} alignItems="center">
      <Text>{label.padEnd(12)}</Text>
      {desktop ? <Svg source={bar(r, color)} alt={`${label}: ${value}`} width={BAR} height={8} /> : <Text color={color}>{textBar(r)}</Text>}
      <Text dimColor>{value}</Text>
    </Box>
  )
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)
  const limit = (label: string, a: number, b: number, value: string) => meter(label, ratio(a, b), value, limitColor(ratio(a, b)))
  const p = progressSummary(q)
  const u = q.usage
  const L = q.limits
  const spent = u.mainTokens + u.agentTokens
  const act = actions(q)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color={stateColor(q.state)}>{`Tablón de misiones · ${q.id} · ${q.state}`}</Text>
        <Text color={stateColor(q.state)}>{stateLine(q, theme).replace(`GuildFlow ${q.id} · `, '')}</Text>
        <Text dimColor>{q.request.slice(0, 200)}</Text>
      </Box>
      {desktop ? (
        <Svg
          source={scene(poses, board.anim)}
          alt={`Sala del gremio: ${stations.map(s => `${STATIONS[s].name} ${POSE_TEXT[poses[s]]}`).join(', ')}`}
          isInteractive={board.anim && busy.some(s => poses[s] === 'work') ? true : undefined}
        />
      ) : null}
      <Text>{who}</Text>
      <Box flexDirection="row" gap={1}>
        {act.halt && board.onHalt ? <Button key="halt" label={g ? '⛔ Detener misión' : 'Detener misión'} onPress={board.onHalt} /> : null}
        {act.resume && board.onResume ? <Button key="resume" label={act.resume === 'approve' ? (g ? '📜 Revisar el plan' : 'Revisar el plan') : g ? '🏕️ Reanudar' : 'Reanudar'} onPress={board.onResume} /> : null}
        {desktop && board.onToggleAnim ? <Button key="anim" label={board.anim ? 'Animación: desactivar' : 'Animación: activar'} onPress={board.onToggleAnim} /> : null}
      </Box>
      <Box flexDirection="column">
        <Text bold>{sec.progress}</Text>
        {meter('Criterios', ratio(p.criteriaPassed, p.criteriaTotal), `${p.criteriaPassed}/${p.criteriaTotal}`, '#2ecc71')}
        {meter('Subtareas', ratio(p.tasksDone, p.tasksTotal), `${p.tasksDone}/${p.tasksTotal}`, '#2ecc71')}
        <Text dimColor>{`Siguiente: ${nextStep(q)}`}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold>{sec.tasks}</Text>
        {q.plan?.tasks.length ? (
          q.plan.tasks.map(t => {
            const pr = q.progress[t.id]
            const st = TASK[pr?.status ?? 'pending']
            const marks = t.criteria.map(c => {
              const ev = pr?.evidence[c.id]
              return ev && ev.round === pr.round ? (VERDICT[ev.verdict] ?? '·') : '·'
            })
            return (
              <Box key={t.id} flexDirection="column">
                <Text color={st.color} dimColor={!st.color} bold={t.id === q.activeTask}>
                  {`${st.glyph} ${t.id} ${t.title}  ${marks.join('')}  · intento ${pr?.attempts ?? 0}/${t.maxAttempts + (pr?.bonusAttempts ?? 0)}`}
                </Text>
                {pr?.lastFailure && pr.status !== 'done' ? <Text dimColor>{`   último fallo: ${pr.lastFailure.slice(0, 160)}`}</Text> : null}
              </Box>
            )
          })
        ) : (
          <Text dimColor>{g ? 'El pergamino aún no tiene encargos.' : 'Sin plan todavía.'}</Text>
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>{sec.treasure}</Text>
        {limit('Tokens', spent, L.tokenBudgetPerQuest, `${fmtTokens(spent)} / ${fmtTokens(L.tokenBudgetPerQuest)}`)}
        {u.costStartUsd !== null ? limit('Coste', u.costUsd, L.costBudgetUsd, `≈$${u.costUsd.toFixed(2)} / $${L.costBudgetUsd}`) : <Text dimColor>{'Coste        no disponible'}</Text>}
        {limit('Tiempo', elapsedMs(q, now), L.wallClockMinutes * 60_000, `${fmtDur(elapsedMs(q, now))} / ${L.wallClockMinutes} min`)}
        {limit('Agentes', q.agentsSpawned, agentBudget(q), `${q.agentsSpawned} / ${agentBudget(q)}`)}
        {limit('Iteraciones', q.iterations, L.maxQuestIterations, `${q.iterations} / ${L.maxQuestIterations}`)}
        {limit('Archivos', q.filesWritten.length, L.maxFilesChanged, `${q.filesWritten.length} / ${L.maxFilesChanged}`)}
        {u.ratePercent !== null ? limit('Suscripción', u.ratePercent, L.rateLimitPercent, `${u.ratePercent}% / ${L.rateLimitPercent}%`) : null}
      </Box>
      <Box flexDirection="column">
        <Text bold>{sec.log}</Text>
        {board.recent.length ? (
          board.recent.map((r, i) => (
            <Text key={`${r.at}-${i}`} dimColor={i > 0}>
              {`${fmtDur(now - r.at).padStart(6)} · ${r.text}`}
            </Text>
          ))
        ) : (
          <Text dimColor>(sin eventos todavía)</Text>
        )}
      </Box>
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

/** Diálogo de aprobación para la persona: cabecera y voz del tema + el plan completo (approvalText) sin tocar. */
export function approvalDialog(theme: Theme, q: Quest, text: string): string {
  if (theme === 'sobrio') return text
  const planner = q.agents.some(a => a.role === 'archimago' && a.status === 'done') ? 'plan.archimago' : 'plan.maestro'
  return `📜 Pergamino de misión · ${q.id}\n${voice(theme, planner, q.id)}\n\n${text.replace(/¿Apruebas el plan\?$/, `¿Sellas el pergamino? («${LABELS.gremio.approve}» = aprobar)`)}`
}

/** /quest-status para la persona: cabecera temática + el estado completo (el mismo texto llano que lee el Maestro). */
export function personStatus(theme: Theme, q: Quest, now: number): string {
  return theme === 'gremio' ? `${stateLine(q, theme)}\n\n${statusText(q, now)}` : statusText(q, now)
}
