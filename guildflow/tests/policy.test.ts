import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentSpawned, halt, startTask } from '../src/machine'
import { decide, TOOL, type Facts } from '../src/policy'
import { agent, approved, ok, ROOT } from './fixtures'

function implementing(): Quest {
  let q = ok(startTask(approved(), 't1', 3))
  q = ok(agentSpawned(q, agent('art', 'artifice', 't1'), 3))
  return q
}

const facts = (q: Quest | null, over: Partial<Facts>): Facts => ({ tool: 'Read', caller: { kind: 'main' }, quest: q, root: ROOT, reads: [], writes: [], patterns: [], ...over })
const asArt = { kind: 'agent' as const, agentId: 'art', role: 'artifice' as const }

describe('orden de decisión', () => {
  test('SubagentHandback se permite antes de cualquier otra regla, incluso con la misión detenida', () => {
    const q = ok(halt(implementing(), 'user', 'x', 4))
    expect(decide(facts(q, { tool: 'SubagentHandback', caller: { kind: 'agent', agentId: 'zzz', role: null } })).kind).toBe('allow')
  })
  test('herramienta vacía o malformada se rechaza', () => {
    expect(decide(facts(implementing(), { tool: '' })).kind).toBe('deny')
  })
  test('sin misión, el Maestro y los agentes ajenos no cambian; los roles del gremio no actúan', () => {
    expect(decide(facts(null, { tool: 'Bash', command: 'rm -rf /' })).kind).toBe('allow')
    expect(decide(facts(null, { tool: 'Write', caller: { kind: 'agent', agentId: 'x', role: null } })).kind).toBe('allow')
    expect(decide(facts(null, { tool: 'Read', caller: asArt })).kind).toBe('deny')
  })
})

describe('subagentes', () => {
  test('rol desconocido durante la misión se rechaza', () => {
    expect(decide(facts(implementing(), { caller: { kind: 'agent', agentId: 'x', role: null } })).kind).toBe('deny')
  })
  test('lista blanca por rol: sin shell, sin web, sin delegación, sin MCP ajeno', () => {
    for (const tool of ['Bash', 'PowerShell', 'WebFetch', 'Agent', 'mcp__aseprite__draw_pixels', 'mcp__guildflow__quest', 'Workflow'])
      expect(decide(facts(implementing(), { tool, caller: asArt })).kind).toBe('deny')
    expect(decide(facts(implementing(), { tool: 'Write', caller: { kind: 'agent', agentId: 'p', role: 'paladin' } })).kind).toBe('deny')
    expect(decide(facts(implementing(), { tool: 'Edit', caller: { kind: 'agent', agentId: 'm', role: 'archimago' } })).kind).toBe('deny')
  })
  test('escritura dentro de las rutas de la subtarea', () => {
    expect(decide(facts(implementing(), { tool: 'Edit', caller: asArt, writes: [`${ROOT}/src/math.js`] })).kind).toBe('allow')
  })
  test('escrituras fuera de rutas, con traversal ya colapsado, absolutas ajenas o no resolubles', () => {
    const q = implementing()
    for (const w of [`${ROOT}/src/other.js`, `${ROOT}/README.md`, 'c:/windows/x', 'c:/repo2/src/math.js', null])
      expect(decide(facts(q, { tool: 'Write', caller: asArt, writes: [w] })).kind).toBe('deny')
  })
  test('el Artífice no puede tocar el estado del gremio ni el script que lo certifica', () => {
    const q = implementing()
    q.plan!.tasks[0].paths.push('test/')
    for (const w of [`${ROOT}/.guildflow/quest.json`, `${ROOT}/test/math.test.js`, `${ROOT}/.git/config`])
      expect(decide(facts(q, { tool: 'Write', caller: asArt, writes: [w] })).kind).toBe('deny')
  })
  test('lecturas fuera del proyecto y patrones con traversal', () => {
    const q = implementing()
    expect(decide(facts(q, { tool: 'Read', caller: asArt, reads: ['c:/users/x/.ssh/id_rsa'] })).kind).toBe('deny')
    expect(decide(facts(q, { tool: 'Glob', caller: asArt, reads: [ROOT], patterns: ['../../**/*'] })).kind).toBe('deny')
    expect(decide(facts(q, { tool: 'Glob', caller: asArt, reads: [ROOT], patterns: ['C:/Users/**'] })).kind).toBe('deny')
    expect(decide(facts(q, { tool: 'Grep', caller: asArt, reads: [`${ROOT}/src`], patterns: [] })).kind).toBe('allow')
  })
  test('misión detenida: el Artífice ya no puede escribir', () => {
    const q = ok(halt(implementing(), 'user', 'alto', 4))
    expect(decide(facts(q, { tool: 'Write', caller: asArt, writes: [`${ROOT}/src/math.js`] })).kind).toBe('deny')
  })
  test('límite de archivos modificados', () => {
    const q = implementing()
    q.limits.maxFilesChanged = 1
    q.filesWritten = [`${ROOT}/src/x.js`]
    expect(decide(facts(q, { tool: 'Write', caller: asArt, writes: [`${ROOT}/src/math.js`] })).kind).toBe('deny')
  })
  test('herramientas propias: run_check del Artífice pasa al manejador; submit_verdict no', () => {
    expect(decide(facts(implementing(), { tool: TOOL.runCheck, caller: asArt })).kind).toBe('own')
    expect(decide(facts(implementing(), { tool: TOOL.verdict, caller: asArt })).kind).toBe('deny')
  })
})

describe('Maestro durante una misión', () => {
  test('coordinación y lectura sin preguntar', () => {
    for (const tool of ['Read', 'Agent', 'AskUserQuestion', 'Skill']) expect(decide(facts(implementing(), { tool })).kind).toBe('allow')
    expect(decide(facts(implementing(), { tool: TOOL.quest })).kind).toBe('own')
  })
  test('escribir el proyecto se rechaza: lo hace un Artífice', () => {
    expect(decide(facts(implementing(), { tool: 'Edit', writes: [`${ROOT}/src/math.js`] })).kind).toBe('deny')
  })
  test('shell: solo lectura pasa; lo demás pide aprobación humana y marca lo sensible', () => {
    expect(decide(facts(implementing(), { tool: 'Bash', command: 'git status' })).kind).toBe('allow')
    const d = decide(facts(implementing(), { tool: 'Bash', command: 'git push origin main' }))
    expect(d.kind).toBe('ask')
    if (d.kind === 'ask') expect(d.question).toContain('SENSIBLE')
  })
  test('herramienta desconocida (MCP con escritura) pide aprobación, no se hereda', () => {
    expect(decide(facts(implementing(), { tool: 'mcp__aseprite__draw_pixels' })).kind).toBe('ask')
  })
})
