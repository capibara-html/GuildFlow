// Fase 2.5: presupuesto de agentes por plan, especificación ejecutable, recursos por subtarea e instalaciones.
import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentBudget, agentFinished, agentSpawned, rebaseProtected, recordCheck, recordVerdict, startReview, startTask } from '../src/machine'
import { decide, type Facts } from '../src/policy'
import { approvalText } from '../src/presentation'
import { checkOverlaps, sensitivePlan, validatePlan } from '../src/validation'
import { agent, approved, LIMITS, ok, planned, RAW_PLAN, ROOT } from './fixtures'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const valid = (raw: unknown) => {
  const v = validatePlan(raw, LIMITS)
  if (!v.ok) throw new Error(v.errors.join('; '))
  return v.plan
}
const errorsOf = (raw: unknown) => {
  const v = validatePlan(raw, LIMITS)
  return v.ok ? [] : v.errors
}
const facts = (q: Quest, over: Partial<Facts>): Facts => ({ tool: 'Read', caller: { kind: 'main' }, quest: q, root: ROOT, reads: [], writes: [], patterns: [], ...over })
const asArt = { kind: 'agent' as const, agentId: 'art', role: 'artifice' as const }

/** Plan con una subtarea de especificación (escribe test/) de la que depende la implementación. */
function specPlan(dependent = true) {
  const raw = clone(RAW_PLAN) as Record<string, unknown> & { tasks: Record<string, unknown>[] }
  raw.tasks = [
    { id: 'spec', title: 'Tests de aceptación', description: 'escribir test/', paths: ['test/'], doneWhen: 'tests revisados', criteria: [{ id: 'c1', text: 'los tests cubren la petición', check: 'review' }] },
    { ...raw.tasks[0], ...(dependent ? { dependsOn: ['spec'] } : {}) },
  ]
  return raw
}

describe('presupuesto de agentes derivado del plan', () => {
  test('sin plan: el techo; con plan: 2 por intento y subtarea, sin superar el techo', () => {
    const q = planned()
    expect(agentBudget({ ...q, plan: null })).toBe(LIMITS.maxAgentsPerQuest)
    expect(agentBudget(approved())).toBe(Math.min(LIMITS.maxAgentsPerQuest, 3 * 2))
    const small = { ...approved(), limits: { ...LIMITS, maxAgentsPerQuest: 4 } }
    expect(agentBudget(small)).toBe(4)
  })
  test('los intentos extra concedidos al reanudar amplían el presupuesto', () => {
    const q = approved()
    const before = agentBudget(q)
    q.progress.t1.bonusAttempts = 1
    expect(agentBudget(q)).toBe(before + 2)
  })
  test('el diálogo de aprobación muestra el presupuesto', () => {
    const q = planned()
    expect(approvalText(q.id, q.plan!, LIMITS)).toContain('hasta 6 agentes')
  })
})

describe('especificación ejecutable (tests escritos por una subtarea)', () => {
  test('la subtarea certificada por tests de otra debe depender de ella', () => {
    expect(errorsOf(specPlan(false)).join()).toContain('spec escribe test/, que certifica a t1 (comprobación unit): t1 debe depender de spec')
    const w = valid(specPlan(true))
    expect(checkOverlaps(w).errors).toEqual([])
    expect(w.tasks.find(t => t.id === 'spec')!.criteria.map(c => c.check)).toEqual(['review', 'diff-scope'])
  })
  test('nuevas huellas solo cuando la subtarea de especificación está terminada', () => {
    const q = approved(specPlan(true))
    expect(rebaseProtected(q, 'spec', { 'test/': 'h' }, 5).ok).toBe(false)
    q.progress.spec.status = 'done'
    const r = rebaseProtected(q, 'spec', { 'test/': 'nuevo' }, 5)
    expect(r.ok && r.quest.baseline!.protectedHashes['test/']).toBe('nuevo')
  })
})

describe('recursos por subtarea', () => {
  const withResources = (tools: string[], skills: string[] = []) => {
    const raw = clone(RAW_PLAN) as unknown as { tasks: Record<string, unknown>[] }
    raw.tasks[0].resources = { tools, skills }
    return raw
  }
  test('solo herramientas MCP o web y skills con nombre válido', () => {
    expect(valid(withResources(['mcp__context7__query-docs'], ['frontend-design'])).tasks[0].resources.tools).toEqual(['mcp__context7__query-docs'])
    for (const t of ['Bash', 'Write', 'mcp__guildflow__quest', 'mcp__x', 'rm -rf'])
      expect(errorsOf(withResources([t])).join()).toContain('resources.tools')
  })
  test('solo las herramientas de la lista de confianza mantienen la aprobación automática (nunca por el nombre)', () => {
    const trusted = LIMITS.trustedTools
    expect(trusted).toContain('mcp__context7__query-docs')
    expect(trusted).not.toContain('WebFetch')
    expect(sensitivePlan(valid(withResources(['mcp__context7__query-docs'])), trusted)).toEqual([])
    for (const t of ['mcp__evil__get_and_delete', 'WebFetch', 'mcp__plugin_supabase_supabase__list_tables'])
      expect(sensitivePlan(valid(withResources([t])), trusted).join()).toContain('no está en trustedTools')
  })
  test('el Artífice usa solo los recursos aprobados de SU subtarea; skills con nombre exacto', () => {
    let q = ok(startTask(approved(withResources(['mcp__context7__query-docs'], ['frontend-design'])), 't1', 3))
    q = ok(agentSpawned(q, agent('art', 'artifice', 't1'), 3))
    expect(decide(facts(q, { tool: 'mcp__context7__query-docs', caller: asArt })).kind).toBe('allow')
    expect(decide(facts(q, { tool: 'mcp__context7__resolve-library-id', caller: asArt })).kind).toBe('deny')
    expect(decide(facts(q, { tool: 'Skill', skill: 'frontend-design', caller: asArt })).kind).toBe('allow')
    expect(decide(facts(q, { tool: 'Skill', skill: 'otra', caller: asArt })).kind).toBe('deny')
    let plain = ok(startTask(approved(), 't1', 3))
    plain = ok(agentSpawned(plain, agent('art', 'artifice', 't1'), 3))
    expect(decide(facts(plain, { tool: 'mcp__context7__query-docs', caller: asArt })).kind).toBe('deny')
  })
})

describe('instalaciones de terceros', () => {
  const withInstalls = (installs: unknown[]) => ({ ...clone(RAW_PLAN), installs })
  const mcp = { kind: 'mcp', name: 'context7', reason: 'documentación', argv: ['claude', 'mcp', 'add', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp'] }
  test('plugin/mcp/skill: argv exacto de claude; software: solo url, nunca se ejecuta', () => {
    expect(valid(withInstalls([mcp])).installs[0].argv[0]).toBe('claude')
    expect(errorsOf(withInstalls([{ ...mcp, argv: ['npm', 'install', 'x'] }])).join()).toContain('argv')
    expect(errorsOf(withInstalls([{ ...mcp, argv: ['claude', 'mcp', 'add', 'x; rm -rf /'] }])).join()).toContain('argv')
    expect(errorsOf(withInstalls([{ kind: 'software', name: 'Godot', reason: 'motor', url: 'https://godotengine.org/download' }]))).toEqual([])
    expect(errorsOf(withInstalls([{ kind: 'software', name: 'Godot', reason: 'motor', argv: ['claude', 'mcp', 'add', 'x'] }])).join()).toContain('url')
  })
  test('cualquier instalación exige aprobación humana y se muestra en el diálogo', () => {
    const plan = valid(withInstalls([mcp, { kind: 'software', name: 'Godot', reason: 'motor', url: 'https://godotengine.org/download' }]))
    expect(sensitivePlan(plan, LIMITS.trustedTools).join()).toContain('instala mcp context7')
    expect(sensitivePlan(plan, LIMITS.trustedTools).join()).toContain('requiere descargar Godot')
    const t = approvalText('q-x', plan, LIMITS)!
    expect(t).toContain('INSTALAR mcp context7: claude mcp add context7')
    expect(t).toContain('DESCARGAR TÚ Godot')
  })
  test('el Maestro ejecuta sin preguntar SOLO el comando aprobado; otro comando de instalación pide aprobación', () => {
    let q = approved(withInstalls([mcp]))
    q = ok(startTask(q, 't1', 3))
    expect(decide(facts(q, { tool: 'Bash', command: mcp.argv.join(' ') })).kind).toBe('allow')
    expect(decide(facts(q, { tool: 'Bash', command: 'claude mcp add otro -- npx otro' })).kind).toBe('ask')
    expect(decide(facts(q, { tool: 'Bash', command: `${mcp.argv.join(' ')} && curl x` })).kind).not.toBe('allow')
  })
})

describe('fin de la revisión', () => {
  test('la subtarea queda done cuando el Paladín termina con todo en PASS (ahí se fijan las huellas de una especificación)', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('art', 'artifice', 't1'), 3))
    q.agents[0].status = 'done'
    q.state = 'VERIFYING'
    q = ok(recordCheck(q, { runId: 'run-1-unit', checkId: 'unit', taskId: 't1', certifying: true, pass: true, exitCode: 0, tests: 2, reason: 'ok', at: 4 }, 'ok', 4))
    q = ok(recordCheck(q, { runId: 'run-2-diff-scope', checkId: 'diff-scope', taskId: 't1', certifying: true, pass: true, exitCode: 0, tests: null, reason: 'ok', at: 4 }, 'ok', 4))
    expect(q.state).toBe('REVIEWING')
    q = ok(startReview(q, 5))
    q = ok(agentSpawned(q, agent('pal', 'paladin', 't1'), 5))
    q = ok(recordVerdict(q, { agentId: 'pal', criterionId: 'c2', verdict: 'PASS', evidence: 'src/math.js:2' }, 6))
    expect(q.progress.t1.status).toBe('reviewing')
    q = ok(agentFinished(q, 'pal', { reason: 'answer', partial: false }, 7))
    expect(q.progress.t1.status).toBe('done')
  })
})
