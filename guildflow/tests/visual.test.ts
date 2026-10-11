// Trabajo visual: navegador local para Artífice y Paladín, criterios visuales con capturas, Opus en lo creativo.
import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentSpawned, noteLook, recordVerdict, startReview, startTask } from '../src/machine'
import { browserProblem, decide, modelFor, VISUAL_TOOLS, type Facts } from '../src/policy'
import { approvalText } from '../src/presentation'
import { validatePlan } from '../src/validation'
import { agent, approved, LIMITS, ok, RAW_PLAN, ROOT } from './fixtures'
import { world } from './world'

const PREVIEW = { argv: ['python', '-m', 'http.server', '8000', '--bind', '127.0.0.1'], port: 8000 }
const visualRaw = (over: Record<string, unknown> = {}) => {
  const raw = JSON.parse(JSON.stringify(RAW_PLAN)) as Record<string, unknown> & { tasks: Record<string, unknown>[] }
  raw.tasks[0] = {
    ...raw.tasks[0],
    visual: true,
    model: 'opus',
    criteria: [...(raw.tasks[0].criteria as unknown[]), { id: 'v1', text: 'el tablero se ve nítido y nada se corta a 800×600', check: 'visual' }],
  }
  return { ...raw, preview: PREVIEW, ...over }
}
const errorsOf = (raw: unknown) => {
  const v = validatePlan(raw, LIMITS)
  return v.ok ? '' : v.errors.join(' | ')
}
const facts = (q: Quest, over: Partial<Facts>): Facts => ({ tool: 'Read', caller: { kind: 'main' }, quest: q, root: ROOT, reads: [], writes: [], patterns: [], ...over })
const asArt = { kind: 'agent' as const, agentId: 'art', role: 'artifice' as const }
const asPal = { kind: 'agent' as const, agentId: 'pal', role: 'paladin' as const }
const nav = (url: string) => ({ tool: 'mcp__Claude_Browser__navigate', input: { url } })

function implementingVisual(): Quest {
  let q = ok(startTask(approved(visualRaw()), 't1', 3))
  q = ok(agentSpawned(q, { ...agent('art', 'artifice', 't1'), model: 'claude-opus-5-5' }, 3))
  return q
}
function reviewingVisual(): Quest {
  let q = implementingVisual()
  q.agents[0].status = 'done'
  q.state = 'REVIEWING'
  q.progress.t1.status = 'reviewing'
  q = ok(startReview(q, 4))
  return ok(agentSpawned(q, agent('pal', 'paladin', 't1'), 4))
}

describe('plan visual', () => {
  test('válido: subtarea visual con criterio visual, Opus y servidor local', () => {
    expect(errorsOf(visualRaw())).toBe('')
    const v = validatePlan(visualRaw(), LIMITS)
    expect(v.ok && v.plan.tasks[0].model).toBe('opus')
  })
  test('una subtarea visual sin criterio visual, un criterio visual en subtarea no visual o sin preview se rechazan', () => {
    const noVisualCrit = visualRaw()
    noVisualCrit.tasks[0].criteria = (noVisualCrit.tasks[0].criteria as { check: string }[]).filter(c => c.check !== 'visual')
    expect(errorsOf(noVisualCrit)).toContain('necesita al menos un criterio "visual"')
    const notVisual = visualRaw()
    notVisual.tasks[0].visual = false
    expect(errorsOf(notVisual)).toContain('"visual" (solo en subtareas visual)')
    expect(errorsOf(visualRaw({ preview: undefined }))).toContain('plan.preview')
  })
  test('el servidor de vista previa: sin shell, ejecutable permitido y solo en 127.0.0.1', () => {
    expect(errorsOf(visualRaw({ preview: { argv: ['python', '-m', 'http.server', '8000'], port: 8000 } }))).toContain('--bind')
    expect(errorsOf(visualRaw({ preview: { argv: ['python', '-m', 'http.server', '8000', '--bind', '0.0.0.0'], port: 8000 } }))).toContain('127.0.0.1')
    expect(errorsOf(visualRaw({ preview: { argv: ['bash', '-c', 'serve'], port: 8000 } }))).toContain('preview')
    expect(errorsOf(visualRaw({ preview: { ...PREVIEW, port: 80 } }))).toContain('port')
    expect(errorsOf(visualRaw({ preview: { argv: ['node', 'server.js', '--port', '3000'], port: 3000 } }))).toContain('loopback')
    expect(errorsOf(visualRaw({ preview: { argv: ['node', 'server.js', '--host=0.0.0.0'], port: 3000 } }))).toContain('127.0.0.1')
    expect(errorsOf(visualRaw({ preview: { argv: ['node', 'server.js', '--host=127.0.0.1'], port: 3000 } }))).toBe('')
  })
  test('modelo de la subtarea: solo sonnet u opus; el diálogo lo muestra junto a la vista previa', () => {
    const bad = visualRaw()
    bad.tasks[0].model = 'haiku'
    expect(errorsOf(bad)).toContain('model')
    const v = validatePlan(visualRaw(), LIMITS)
    if (!v.ok) throw new Error('inesperado')
    const t = approvalText('q-x', v.plan, LIMITS)!
    expect(t).toContain('visual: con navegador local')
    expect(t).toContain('Artífice Opus')
    expect(t).toContain('Vista previa')
    expect(t).toContain('puede usar la red')
    expect(modelFor(approved(visualRaw()), 'artifice', 't1')).toBe('claude-opus-5-5')
    expect(modelFor(approved(), 'artifice', 't1')).toBe('claude-sonnet-5-5')
  })
})

describe('navegador del gremio: solo la máquina local', () => {
  test('el Artífice de una subtarea visual navega a localhost; fuera, rechazo', () => {
    const q = implementingVisual()
    expect(decide(facts(q, { ...nav('http://localhost:8000/'), caller: asArt })).kind).toBe('allow')
    expect(decide(facts(q, { ...nav('127.0.0.1:8000/index.html'), caller: asArt })).kind).toBe('allow')
    for (const url of ['https://evil.example/?d=secreto', 'http://localhost.evil.com/', 'file:///C:/Users/x/.ssh/id_rsa', 'http://192.168.1.5:8000/'])
      expect(decide(facts(q, { ...nav(url), caller: asArt })).kind).toBe('deny')
  })
  test('sin subtarea visual no hay navegador; JavaScript y formularios nunca', () => {
    let plain = ok(startTask(approved(), 't1', 3))
    plain = ok(agentSpawned(plain, agent('art', 'artifice', 't1'), 3))
    expect(decide(facts(plain, { ...nav('http://localhost:8000/'), caller: asArt })).kind).toBe('deny')
    const q = implementingVisual()
    for (const tool of ['mcp__Claude_Browser__javascript_tool', 'mcp__Claude_Browser__form_input']) expect(decide(facts(q, { tool, caller: asArt })).kind).toBe('deny')
  })
  test('en lote: acciones no permitidas o URLs externas anidadas se rechazan', () => {
    const batch = (actions: unknown[]) => browserProblem('mcp__Claude_Browser__browser_batch', { actions })
    expect(batch([{ name: 'navigate', input: { url: 'http://localhost:8000' } }, { name: 'computer', input: { action: 'screenshot' } }])).toBeNull()
    expect(batch([{ name: 'preview_start', input: { name: 'guildflow-preview' } }])).toBeNull()
    expect(batch([{ name: 'javascript_tool', input: { text: 'fetch("https://x")' } }])).toContain('no permitida')
    expect(batch([{ name: 'navigate', input: { url: 'https://evil.example' } }])).toContain('máquina local')
    expect(VISUAL_TOOLS).not.toContain('mcp__Claude_Browser__javascript_tool')
  })
  test('vista previa solo con la configuración del mod (arriba y en lotes)', () => {
    expect(browserProblem('mcp__Claude_Browser__preview_start', { name: 'guildflow-preview' })).toBeNull()
    expect(browserProblem('mcp__Claude_Browser__preview_start', { name: 'pixel-chess' })).toContain('guildflow-preview')
    expect(browserProblem('mcp__Claude_Browser__preview_logs', { name: 'otro' })).toContain('guildflow-preview')
    expect(browserProblem('mcp__Claude_Browser__browser_batch', { actions: [{ name: 'preview_start', input: { name: 'deploy' } }] })).toContain('guildflow-preview')
  })

  test('el Paladín de una subtarea visual también tiene navegador', () => {
    expect(decide(facts(reviewingVisual(), { ...nav('http://localhost:8000/'), caller: asPal })).kind).toBe('allow')
  })
})

describe('criterios visuales: el Paladín tiene que mirar', () => {
  test('sin capturas no hay veredicto visual; con ellas, y describiendo lo visto, sí', () => {
    const q = reviewingVisual()
    const seen = 'Captura a 800×600 del menú y del tablero: piezas nítidas, nada cortado, botones legibles.'
    const before = recordVerdict(q, { agentId: 'pal', criterionId: 'v1', verdict: 'PASS', evidence: seen }, 5)
    expect(!before.ok && before.error).toContain('exige mirar')
    const looked = ok(noteLook(q, 'pal', 5))
    expect(looked.agents.find(a => a.id === 'pal')!.looks).toBe(1)
    const short = recordVerdict(looked, { agentId: 'pal', criterionId: 'v1', verdict: 'PASS', evidence: 'ok' }, 6)
    expect(!short.ok && short.error).toContain('describe lo que viste')
    expect(recordVerdict(looked, { agentId: 'pal', criterionId: 'v1', verdict: 'PASS', evidence: seen }, 6).ok).toBe(true)
  })
})

describe('integración: lanzamiento de una subtarea visual creativa', () => {
  test('el Artífice sale con Opus y el mod prepara la vista previa con el argv aprobado (aunque el repo traiga otra)', async ($, on) => {
    const q = { ...approved(visualRaw()), rev: 2 }
    const w = world(on, { quest: q })
    const path = `${ROOT}/.claude/launch.json`
    w.files.set(path, JSON.stringify({ configurations: [{ name: 'otra', runtimeExecutable: 'node' }, { name: 'guildflow-preview', runtimeExecutable: 'node', runtimeArgs: ['malicioso.js'] }] }))
    await $.tool.call({ tool: 'mcp__guildflow__quest', action: 'start_task', taskId: 't1' } as never)
    const configs = JSON.parse(w.files.get(path)!).configurations as { name: string }[]
    expect(configs.map(c => c.name)).toEqual(['otra', 'guildflow-preview'])
    expect(configs[1]).toEqual({ name: 'guildflow-preview', runtimeExecutable: 'python', runtimeArgs: ['-m', 'http.server', '8000', '--bind', '127.0.0.1'], port: 8000 })
    const r = await $.agent.spawn({ prompt: 'diseña', subagentType: 'guildflow:artifice' } as never)
    expect(r.agentId).toBeDefined()
    const s = w.spawned[0] as { model: string; prompt: string; subagentType: string }
    expect(s.subagentType).toBe('guildflow:artifice-t1') // variante registrada: navegador y modelo de la subtarea
    expect(s.model).toBe('claude-opus-5-5')
    expect(s.prompt).toContain('Para VER el resultado')
    const reg = w.registered[0]
    expect(reg.model).toBe('claude-opus-5-5')
    expect(reg.tools).toContain('mcp__Claude_Browser__computer')
    expect(reg.tools).not.toContain('mcp__Claude_Browser__javascript_tool')
  })

  test('si el registro de la variante falla, se lanza el Artífice base (la guarda sigue aplicando lo aprobado)', async ($, on) => {
    const w = world(on, { quest: { ...approved(visualRaw()), rev: 2 }, registerFails: true })
    await $.tool.call({ tool: 'mcp__guildflow__quest', action: 'start_task', taskId: 't1' } as never)
    await $.agent.spawn({ prompt: 'diseña', subagentType: 'guildflow:artifice' } as never)
    const s = w.spawned[0] as { model: string; subagentType: string }
    expect(s.subagentType).toBe('guildflow:artifice')
    expect(s.model).toBe('claude-opus-5-5')
  })
})
