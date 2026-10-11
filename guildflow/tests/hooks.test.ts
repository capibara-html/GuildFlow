// Integración: el plugin real cargado por el motor del kit; las guardas se ejercitan con $.tool.call y $.agent.spawn.
import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentSpawned, startTask } from '../src/machine'
import { files } from '../src/persistence'
import { agent, approved, ok, planned, RAW_PLAN, ROOT } from './fixtures'
import { world } from './world'

type R = { deny?: string; result?: unknown; text?: string }
const call = async ($: { tool: { call: (x: never) => Promise<unknown> } }, input: Record<string, unknown>) => (await $.tool.call(input as never)) as R
const denied = (r: R) => r.deny ?? (typeof r.text === 'string' && /GuildFlow/.test(r.text) ? r.text : undefined)

function implementing(): Quest {
  let q = ok(startTask(approved(), 't1', 3))
  q = ok(agentSpawned(q, agent('art', 'artifice', 't1'), 3))
  return { ...q, rev: 3 }
}
const saved = (w: { files: Map<string, string> }) => JSON.parse(w.files.get(files(ROOT).quest)!) as Quest

describe('tool.call (guarda central)', () => {
  test('el Artífice escribe dentro de su ruta: se ejecuta y queda registrado', async ($, on) => {
    const w = world(on, { quest: implementing() })
    const r = await call($, { tool: 'Write', file_path: `${ROOT}/src/math.js`, content: 'x', agentId: 'art' })
    expect(denied(r)).toBeUndefined()
    expect(w.ran).toContain('Write')
    expect(saved(w).filesWritten).toEqual([`${ROOT}/src/math.js`])
  })

  test('escrituras fuera de ruta, con traversal o hacia el estado del gremio se rechazan sin ejecutarse', async ($, on) => {
    const w = world(on, { quest: implementing() })
    for (const p of [`${ROOT}/README.md`, `${ROOT}/src/../test/math.test.js`, 'C:\\Windows\\x.txt', `${ROOT}/.guildflow/quest.json`, '\\\\srv\\share\\x'])
      expect(denied(await call($, { tool: 'Write', file_path: p, content: 'x', agentId: 'art' }))).toBeDefined()
    expect(w.ran).not.toContain('Write')
  })

  test('shell, delegación y MCP con escritura fuera de la lista blanca del Artífice', async ($, on) => {
    const w = world(on, { quest: implementing() })
    for (const tool of ['Bash', 'PowerShell', 'Agent', 'mcp__aseprite__draw_pixels'])
      expect(denied(await call($, { tool, command: 'echo', agentId: 'art' }))).toBeDefined()
    expect(w.ran.length).toBe(0)
  })

  test('agente sin rol del gremio durante la misión → rechazo (fallo en cerrado)', async ($, on) => {
    world(on, { quest: implementing() })
    expect(denied(await call($, { tool: 'Read', file_path: `${ROOT}/src/math.js`, agentId: 'desconocido' }))).toBeDefined()
  })

  test('fallo inesperado de la guarda → rechazo, nunca paso libre', async ($, on) => {
    const w = world(on, { quest: implementing(), agentListFails: true })
    const r = await call($, { tool: 'Write', file_path: `${ROOT}/src/math.js`, content: 'x', agentId: 'otro' })
    expect(denied(r)).toContain('se rechaza por seguridad')
    expect(w.ran.length).toBe(0)
  })

  test('quest.json cambiado por fuera durante la misión → detención por seguridad, sin creer al disco', async ($, on) => {
    const w = world(on, { quest: implementing() })
    expect(denied(await call($, { tool: 'Read', file_path: `${ROOT}/src/math.js`, agentId: 'art' }))).toBeUndefined()
    const forged = { ...saved(w), rev: 99, state: 'DONE' }
    w.files.set(files(ROOT).quest, JSON.stringify(forged))
    await call($, { tool: 'Write', file_path: `${ROOT}/src/math.js`, content: 'x', agentId: 'art' })
    const s = saved(w)
    expect(s.state).toBe('HALTED')
    expect(s.haltKind).toBe('safety')
    expect([...w.files.keys()].some(k => k.includes('quest.corrupt-'))).toBe(true)
    expect(denied(await call($, { tool: 'Write', file_path: `${ROOT}/src/math.js`, content: 'y', agentId: 'art' }))).toBeDefined()
  })

  test('SubagentHandback pasa aunque la misión esté detenida', async ($, on) => {
    const q = implementing()
    q.state = 'HALTED'
    const w = world(on, { quest: q })
    expect(denied(await call($, { tool: 'SubagentHandback', agentId: 'art' }))).toBeUndefined()
    expect(w.ran).toContain('SubagentHandback')
  })

  test('el Maestro no escribe el proyecto ni usa la shell durante la misión, sin preguntar; un MCP ajeno sí pregunta', async ($, on) => {
    const w = world(on, { quest: implementing(), answers: ['Denegar', 'Permitir una vez'] })
    expect(denied(await call($, { tool: 'Edit', file_path: `${ROOT}/src/math.js`, old_string: 'a', new_string: 'b' }))).toBeDefined()
    expect(denied(await call($, { tool: 'Bash', command: 'npm test' }))).toContain('run_check')
    expect(w.asked.length).toBe(0)
    expect(denied(await call($, { tool: 'mcp__aseprite__draw_pixels' }))).toBeDefined()
    expect(denied(await call($, { tool: 'mcp__aseprite__draw_pixels' }))).toBeUndefined()
    expect(w.asked.length).toBe(2)
    expect(w.ran).toEqual(['mcp__aseprite__draw_pixels'])
  })

  test('misión detenida: el Maestro trabaja sin diálogos de GuildFlow', async ($, on) => {
    const q = implementing()
    q.state = 'HALTED'
    q.haltKind = 'safety'
    const w = world(on, { quest: q })
    expect(denied(await call($, { tool: 'Bash', command: 'npm test' }))).toBeUndefined()
    expect(denied(await call($, { tool: 'Edit', file_path: `${ROOT}/src/math.js`, old_string: 'a', new_string: 'b' }))).toBeUndefined()
    expect(w.asked.length).toBe(0)
    expect(w.ran).toEqual(['Bash', 'Edit'])
  })

  test('sin misión activa GuildFlow no interfiere con el Maestro', async ($, on) => {
    const w = world(on, {})
    expect(denied(await call($, { tool: 'Bash', command: 'npm install' }))).toBeUndefined()
    expect(w.ran).toEqual(['Bash'])
  })
})

describe('run_check', () => {
  const tool = 'mcp__guildflow__run_check'
  test('entrada malformada, argumentos extra, comandos encadenados e ids desconocidos', async ($, on) => {
    const w = world(on, { quest: implementing() })
    for (const input of [{}, { check: 'unit; del x' }, { check: 'unit', args: ['--x'] }, { check: 'unit', argv: ['rm'] }, { check: 'nope' }, { check: '../x' }, { check: 42 }])
      expect(denied(await call($, { tool, ...input }))).toBeDefined()
    expect(w.runs.length).toBe(0)
  })

  test('un id válido ejecuta exactamente el argv aprobado; desde el Artífice es informativo', async ($, on) => {
    const w = world(on, { quest: implementing(), proc: () => ({ exitCode: 0, stdout: '# tests 2', stderr: '' }) })
    const r = await call($, { tool, check: 'unit', agentId: 'art' })
    expect(denied(r)).toBeUndefined()
    expect(w.runs).toContainEqual(['node', '--test', 'test/'])
    expect(String(r.result)).toContain('informativa')
    const runFile = [...w.files.keys()].find(k => k.includes('/.guildflow/runs/'))
    expect(runFile).toBeDefined()
  })

  test('el Paladín no puede usar run_check fuera de REVIEWING ni emitir veredictos sin ser Paladín', async ($, on) => {
    const q = implementing()
    q.agents.push({ ...agent('pal', 'paladin', 't1') })
    const w = world(on, { quest: q })
    expect(denied(await call($, { tool: 'mcp__guildflow__submit_verdict', criterionId: 'c2', verdict: 'PASS', evidence: 'src/math.js:1', agentId: 'art' }))).toBeDefined()
    expect(denied(await call($, { tool: 'Read', file_path: `${ROOT}/src/math.js`, agentId: 'pal' }))).toBeDefined()
    expect(w.ran.length).toBe(0)
  })
})

describe('agent.spawn', () => {
  test('fuera de misión, los roles del gremio no arrancan', async ($, on) => {
    const w = world(on, {})
    const r = await $.agent.spawn({ prompt: 'x', subagentType: 'guildflow:artifice' } as never)
    expect(r.deny).toContain('misión')
    expect(w.spawned.length).toBe(0)
  })

  test('sin plaza autorizada (start_task) el Artífice no arranca', async ($, on) => {
    const w = world(on, { quest: { ...approved(), rev: 2 } })
    const r = await $.agent.spawn({ prompt: 'x', subagentType: 'guildflow:artifice' } as never)
    expect(r.deny).toBeDefined()
    expect(w.spawned.length).toBe(0)
  })

  test('con plaza: modelo del rol impuesto, primer plano y brief del plan aprobado', async ($, on) => {
    const q = { ...ok(startTask(approved(), 't1', 3)), rev: 3 }
    const w = world(on, { quest: q })
    const r = await $.agent.spawn({ prompt: 'hazlo', subagentType: 'guildflow:artifice', model: 'haiku' } as never)
    expect(r.agentId).toBe('agent-1')
    const s = w.spawned[0] as { model: string; background: boolean; prompt: string }
    expect(s.model).toBe('claude-sonnet-5-5')
    expect(s.background).toBe(false)
    expect(s.prompt).toContain('Rutas que PUEDES modificar (y ninguna otra): src/math.js')
    expect(saved(w).agents.map(a => a.role)).toEqual(['artifice'])
    const again = await $.agent.spawn({ prompt: 'otro', subagentType: 'guildflow:artifice' } as never)
    expect(again.deny).toBeDefined()
  })

  test('tipos ajenos al gremio durante la misión se rechazan', async ($, on) => {
    const w = world(on, { quest: implementing() })
    expect((await $.agent.spawn({ prompt: 'x', subagentType: 'general-purpose' } as never)).deny).toBeDefined()
    expect(w.spawned.length).toBe(0)
  })
})

describe('herramienta quest y aprobación humana', () => {
  test('un plan inválido devuelve errores y no pide aprobación', async ($, on) => {
    const q = planned()
    q.state = 'PLANNING'
    const w = world(on, { quest: { ...q, plan: null, planHash: null, rev: 1 } })
    const r = await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: { tasks: [] } })
    expect(String(r.result)).toContain('errors')
    expect(w.asked.length).toBe(0)
  })

  test('aprobación solo por el diálogo de la persona: "Aprobar" → DISPATCH', async ($, on) => {
    const q = planned()
    const w = world(on, { quest: { ...q, state: 'PLANNING', plan: null, planHash: null, rev: 1 }, answers: ['Aprobar'] })
    const r = await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: RAW_PLAN })
    expect(String(r.result)).toContain('APROBADO')
    expect(w.asked.length).toBe(1)
    const s = saved(w)
    expect(s.state).toBe('DISPATCH')
    expect(s.approval?.by).toBe('human')
  })

  test('rechazo o diálogo cerrado: no se aprueba', async ($, on) => {
    const q = planned()
    const w = world(on, { quest: { ...q, state: 'PLANNING', plan: null, planHash: null, rev: 1 }, answers: ['Rechazar'] })
    await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: RAW_PLAN })
    expect(saved(w).state).toBe('PLANNING')
  })

  test('sin misión, las herramientas propias responden (no caen al motor)', async ($, on) => {
    const w = world(on, {})
    const r = await call($, { tool: 'mcp__guildflow__quest', action: 'status' })
    expect(String(r.result)).toContain('No hay misión activa')
    expect(denied(await call($, { tool: 'mcp__guildflow__run_check', check: 'unit' }))).toContain('plan aprobado')
    expect(w.ran.length).toBe(0)
  })

  test('autoApprovePlan desactivado (por defecto): sigue preguntando a la persona', async ($, on) => {
    const q = planned()
    const w = world(on, { quest: { ...q, state: 'PLANNING', plan: null, planHash: null, rev: 1 }, answers: ['Aprobar'] })
    await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: RAW_PLAN })
    expect(w.asked.length).toBe(1)
    expect(saved(w).approval?.by).toBe('human')
  })

  test('autoApprovePlan activado y plan sin rutas sensibles: se aprueba sin diálogo', { options: { autoApprovePlan: true } }, async ($, on) => {
    const q = planned()
    const w = world(on, { quest: { ...q, state: 'PLANNING', plan: null, planHash: null, rev: 1 } })
    const r = await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: RAW_PLAN })
    expect(String(r.result)).toContain('automáticamente')
    expect(w.asked.length).toBe(0)
    const s = saved(w)
    expect(s.state).toBe('DISPATCH')
    expect(s.approval?.by).toBe('auto')
  })

  test('autoApprovePlan activado pero el plan toca dependencias: decide la persona', { options: { autoApprovePlan: true } }, async ($, on) => {
    const q = planned()
    const w = world(on, { quest: { ...q, state: 'PLANNING', plan: null, planHash: null, rev: 1 }, answers: ['Rechazar'] })
    const raw = JSON.parse(JSON.stringify(RAW_PLAN)) as typeof RAW_PLAN
    raw.tasks[0].paths = ['src/math.js', 'package.json']
    await call($, { tool: 'mcp__guildflow__quest', action: 'submit_plan', plan: raw })
    expect(w.asked.length).toBe(1)
    expect(saved(w).state).toBe('PLANNING')
  })

  test('un subagente no puede usar la herramienta quest', async ($, on) => {
    world(on, { quest: implementing() })
    expect(denied(await call($, { tool: 'mcp__guildflow__quest', action: 'status', agentId: 'art' }))).toBeDefined()
  })

  test('acciones desconocidas o con argumentos extra se rechazan', async ($, on) => {
    world(on, { quest: implementing() })
    expect(denied(await call($, { tool: 'mcp__guildflow__quest', action: 'approve' }))).toBeDefined()
    expect(denied(await call($, { tool: 'mcp__guildflow__quest', action: 'status', force: true }))).toBeDefined()
  })
})
