// Punto central de decisión de herramientas. Puro: el hook resuelve las rutas reales ($.fs.stat) y esta
// función decide con hechos ya resueltos. El orden de las comprobaciones está documentado en
// docs/09-security-review.md y fijado por tests/policy.test.ts.
import type { Effort, Quest, Role } from '../types'
import { isStopped } from './machine'
import { inside, matchesEntry, parseEntry, readOnlyShell, sensitiveCommand, type PathEntry } from './validation'

export const PLUGIN = 'guildflow'
export const TOOL = {
  quest: `mcp__${PLUGIN}__quest`,
  runCheck: `mcp__${PLUGIN}__run_check`,
  verdict: `mcp__${PLUGIN}__submit_verdict`,
} as const
export const OWN_TOOLS: readonly string[] = Object.values(TOOL)

/** Herramientas internas del motor que un subagente necesita para entregar su informe. */
export const ENGINE_TOOLS: readonly string[] = ['SubagentHandback']

export const ROLES: Record<Role, { type: string; model: string; effort: Effort; tools: readonly string[] }> = {
  archimago: { type: `${PLUGIN}:archimago`, model: 'claude-opus-5-5', effort: 'high', tools: ['Read', 'Grep', 'Glob'] },
  artifice: { type: `${PLUGIN}:artifice`, model: 'claude-sonnet-5-5', effort: 'high', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', TOOL.runCheck] },
  paladin: { type: `${PLUGIN}:paladin`, model: 'claude-sonnet-5-5', effort: 'high', tools: ['Read', 'Grep', 'Glob', TOOL.runCheck, TOOL.verdict] },
}

export const roleOfType = (type: string): Role | null => (Object.keys(ROLES) as Role[]).find(r => ROLES[r].type === type) ?? null

const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const READ_TOOLS = ['Read', 'Grep', 'Glob']
const SHELL_TOOLS = ['Bash', 'PowerShell']
/** Lo que el Maestro usa sin preguntar durante una misión: lectura, coordinación y las herramientas del gremio. */
const MAIN_SAFE = ['Read', 'Grep', 'Glob', 'AskUserQuestion', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'Skill', 'ToolSearch', 'Agent', 'WebFetch', 'WebSearch']

/** Rutas que lee o escribe una llamada, según la herramienta. undefined = forma desconocida (se rechaza). */
export function pathArgs(tool: string, input: Record<string, unknown>): { reads: string[]; writes: string[]; patterns: string[] } | undefined {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  switch (tool) {
    case 'Read':
      return s('file_path') ? { reads: [s('file_path')!], writes: [], patterns: [] } : undefined
    case 'Grep':
      return { reads: [s('path') ?? '.'], writes: [], patterns: s('glob') ? [s('glob')!] : [] }
    case 'Glob':
      return typeof input.pattern === 'string' ? { reads: [s('path') ?? '.'], writes: [], patterns: [input.pattern] } : undefined
    case 'Edit':
    case 'Write':
      return s('file_path') ? { reads: [], writes: [s('file_path')!], patterns: [] } : undefined
    case 'NotebookEdit':
      return s('notebook_path') ? { reads: [], writes: [s('notebook_path')!], patterns: [] } : undefined
    default:
      return { reads: [], writes: [], patterns: [] }
  }
}

export type Caller = { kind: 'main' } | { kind: 'agent'; agentId: string; role: Role | null }

export type Facts = {
  tool: string
  caller: Caller
  quest: Quest | null
  /** Raíz del proyecto, ruta real normalizada. */
  root: string
  /** Rutas reales normalizadas; null = no se pudo situar. */
  reads: (string | null)[]
  writes: (string | null)[]
  patterns: string[]
  /** Texto del comando para Bash/PowerShell. */
  command?: string
}

export type Decision = { kind: 'allow'; step: string } | { kind: 'own'; step: string } | { kind: 'deny'; step: string; reason: string } | { kind: 'ask'; step: string; question: string }

const deny = (step: string, reason: string): Decision => ({ kind: 'deny', step, reason })

const badPattern = (p: string) => /(^|[\\/])\.\.([\\/]|$)/.test(p) || /^([a-zA-Z]:|[\\/]|~)/.test(p)

/** Rutas protegidas para la subtarea activa: estado del gremio, VCS y lo que define sus comprobaciones. */
export function protectedEntries(q: Quest): PathEntry[] {
  const out: PathEntry[] = [
    { rel: '.guildflow', dir: true },
    { rel: '.git', dir: true },
    { rel: '.claude', dir: true },
  ]
  const task = q.plan?.tasks.find(t => t.id === q.activeTask)
  if (!task || !q.plan) return out
  const used = task.criteria.filter(c => c.check.startsWith('check:')).map(c => c.check.slice(6))
  for (const k of q.plan.checks.filter(x => used.includes(x.id))) for (const p of k.protects) out.push(parseEntry(p) as PathEntry)
  return out
}

/**
 * Orden de decisión:
 *  1. nombre de herramienta válido
 *  2. herramientas internas del motor (SubagentHandback) → permitir
 *  3. sin misión activa: el Maestro y agentes ajenos siguen igual (las herramientas propias las atiende el
 *     mod); un rol del gremio se rechaza
 *  4. subagente: rol conocido → lista blanca del rol → herramienta propia → estado de misión y plaza
 *     → lecturas dentro del proyecto → escrituras dentro de las rutas de la subtarea, fuera de las
 *     protegidas y dentro del límite de archivos
 *  5. Maestro: herramientas propias → lectura y coordinación → escrituras (dentro del proyecto se
 *     rechazan; fuera se pregunta) → shell (solo lectura sin preguntar) → cualquier otra se pregunta
 */
export function decide(f: Facts): Decision {
  if (typeof f.tool !== 'string' || !f.tool) return deny('1-tool', 'llamada sin herramienta reconocible')
  if (ENGINE_TOOLS.includes(f.tool)) return { kind: 'allow', step: '2-engine' }
  const q = f.quest && f.quest.state !== 'LOGGED' ? f.quest : null

  if (f.caller.kind === 'agent') {
    const { role, agentId } = f.caller
    if (!q) {
      if (role) return deny('3-no-quest', `el rol ${role} solo actúa dentro de una misión activa`)
      return OWN_TOOLS.includes(f.tool) ? { kind: 'own', step: '3-own' } : { kind: 'allow', step: '3-no-quest' }
    }
    if (!role) return deny('4-role', `agente ${agentId} sin rol del gremio durante la misión ${q.id}; se rechaza`)
    if (!ROLES[role].tools.includes(f.tool)) return deny('4-whitelist', `el rol ${role} no puede usar ${f.tool}`)
    if (OWN_TOOLS.includes(f.tool)) return { kind: 'own', step: '4-own' }
    if (isStopped(q)) return deny('4-state', `la misión está ${q.state}: ${q.reason ?? ''}`.trim())
    const rec = q.agents.find(a => a.id === agentId)
    if (!rec || rec.status !== 'running') return deny('4-state', `el agente ${agentId} no figura en curso`)
    const phase: Record<Role, string> = { archimago: 'PLANNING', artifice: 'IMPLEMENTING', paladin: 'REVIEWING' }
    if (q.state !== phase[role]) return deny('4-state', `el ${role} solo actúa en ${phase[role]} (estado ${q.state})`)
    if (role !== 'archimago' && rec.taskId !== q.activeTask) return deny('4-state', `el agente trabaja en ${rec.taskId}, no en la subtarea activa ${q.activeTask}`)
    for (const p of f.patterns) if (badPattern(p)) return deny('4-read', `patrón fuera del proyecto: ${p}`)
    for (const r of f.reads) if (r === null || !inside(r, f.root)) return deny('4-read', 'lectura fuera del proyecto o ruta no resoluble')
    if (WRITE_TOOLS.includes(f.tool)) {
      const task = q.plan?.tasks.find(t => t.id === q.activeTask)
      if (!task) return deny('4-write', 'no hay subtarea activa')
      const prot = protectedEntries(q)
      let fresh = 0
      for (const w of f.writes) {
        if (w === null) return deny('4-write', 'ruta de escritura no resoluble con seguridad')
        if (!inside(w, f.root)) return deny('4-write', 'escritura fuera del proyecto')
        if (prot.some(e => matchesEntry(w, f.root, e) || (e.dir && w === `${f.root}/${e.rel.toLowerCase()}`)))
          return deny('4-write', `ruta protegida (estado del gremio o definición de una comprobación): ${w.slice(f.root.length + 1)}`)
        const entries = task.paths.map(p => parseEntry(p) as PathEntry)
        if (!entries.some(e => matchesEntry(w, f.root, e))) return deny('4-write', `${task.id} solo puede escribir en ${task.paths.join(', ')}; rechazado: ${w.slice(f.root.length + 1)}`)
        if (!q.filesWritten.includes(w)) fresh += 1
      }
      if (q.filesWritten.length + fresh > q.limits.maxFilesChanged) return deny('4-limit', `límite de ${q.limits.maxFilesChanged} archivos modificados por misión`)
    }
    return { kind: 'allow', step: '4-allow' }
  }

  if (OWN_TOOLS.includes(f.tool)) return { kind: 'own', step: '5-own' }
  if (!q) return { kind: 'allow', step: '3-no-quest' }
  if (MAIN_SAFE.includes(f.tool)) return { kind: 'allow', step: '5-safe' }
  if (WRITE_TOOLS.includes(f.tool)) {
    if (f.writes.some(w => w === null || inside(w, f.root))) return deny('5-write', `durante la misión ${q.id} los archivos del proyecto los escribe un Artífice (o la ruta no es resoluble)`)
    return { kind: 'ask', step: '5-write', question: `El Maestro quiere escribir fuera del proyecto (${f.writes.join(', ')}) durante la misión ${q.id}. ¿Permitir esta vez?` }
  }
  if (SHELL_TOOLS.includes(f.tool)) {
    const cmd = f.command ?? ''
    if (readOnlyShell(cmd)) return { kind: 'allow', step: '5-shell' }
    const why = sensitiveCommand(cmd)
    return { kind: 'ask', step: '5-shell', question: `Misión ${q.id}: el Maestro quiere ejecutar ${f.tool}${why ? ` (SENSIBLE: ${why})` : ''}: ${cmd.slice(0, 300)} ¿Permitir esta vez?` }
  }
  return { kind: 'ask', step: '5-unknown', question: `Misión ${q.id}: el Maestro quiere usar ${f.tool}, que GuildFlow no clasifica. ¿Permitir esta vez?` }
}

export const READ_ONLY_TOOLS = READ_TOOLS
export const WRITES = WRITE_TOOLS
export const SHELLS = SHELL_TOOLS
