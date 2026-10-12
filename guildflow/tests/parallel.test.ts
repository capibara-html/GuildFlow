import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentFinished, agentSpawned, benchConflict, integrate, nextStep, parallelCandidates, recover, spawnBlocker, startParallel, startTask, submitPlan } from '../src/machine'
import { decide } from '../src/policy'
import { validatePlan } from '../src/validation'
import { agent, approved, LIMITS, ok, RAW_PLAN, ROOT } from './fixtures'

/** Plan con t1 y t2 independientes (rutas disjuntas), t3 que pisa las rutas de t1 y t4 visual. */
function plan() {
  const raw = JSON.parse(JSON.stringify(RAW_PLAN)) as typeof RAW_PLAN & { tasks: Record<string, unknown>[]; preview?: unknown }
  const t1 = raw.tasks[0]!
  raw.tasks = [
    t1,
    { ...t1, id: 't2', paths: ['src/other.js'] },
    { ...t1, id: 't3', paths: ['src/'] },
    { ...t1, id: 't4', paths: ['web/ui.js'], visual: true, criteria: [{ id: 'v1', text: 'se ve bien', check: 'visual' }] },
  ]
  raw.preview = { argv: ['python', '-m', 'http.server', '8000', '--bind', '127.0.0.1'], port: 8000 }
  return raw
}
const BENCH = { dir: '.guildflow/wt/t2-1', seed: { 'src/other.js': 'h0' } }
const parallel = (max = 2): Quest => {
  const q = approved(plan())
  return { ...q, limits: { ...q.limits, maxParallelArtifices: max } }
}

describe('Artífices en paralelo (talleres)', () => {
  test('candidatas: solo con la opción activada, pendientes, sin rutas solapadas y sin trabajo visual', () => {
    expect(parallelCandidates(approved(plan()))).toEqual([]) // maxParallelArtifices 1 = en serie
    let q = parallel()
    expect(parallelCandidates(q)).toEqual(['t1', 't2', 't3'])
    q = ok(startTask(q, 't1', 3))
    expect(parallelCandidates(q)).toEqual(['t2']) // t3 (src/) pisa src/math.js; t4 es visual
  })

  test('el taller corre junto al carril principal y espera su turno para integrarse', () => {
    let q = ok(startTask(parallel(), 't1', 3))
    q = ok(agentSpawned(q, agent('a1', 'artifice', 't1'), 3))
    q = ok(startParallel(q, 't2', BENCH, 4))
    expect(q.slot).toEqual({ role: 'artifice', taskId: 't2', attempt: 1, parallel: true })
    expect(q.state).toBe('IMPLEMENTING')
    expect(q.progress.t2!.status).toBe('parallel')
    expect(spawnBlocker(q, 'artifice')).toBeNull() // aunque ya haya un Artífice en el carril principal
    q = ok(agentSpawned(q, agent('a2', 'artifice', 't2'), 5))
    expect(q.benches!.t2!.agentId).toBe('a2')
    expect(parallelCandidates(q)).toEqual([]) // con 2 Artífices a la vez no caben más talleres
    q = ok(agentFinished(q, 'a2', { reason: 'answer', partial: false }, 6))
    expect(q.progress.t2!.status).toBe('queued')
    expect(q.state).toBe('IMPLEMENTING') // el carril principal no se entera
    expect(integrate(q, 't2', 7).ok).toBe(false) // solo con el carril principal libre
    const free = { ...q, state: 'DISPATCH' as const, activeTask: null }
    expect(nextStep(free)).toContain('integrar el taller de t2')
    const v = ok(integrate(free, 't2', 8))
    expect(v.state).toBe('VERIFYING')
    expect(v.activeTask).toBe('t2')
    expect(v.benches).toEqual({})
  })

  test('sin opción, con plaza abierta o con rutas solapadas no se abre taller; tampoco en serie con plaza en paralelo abierta', () => {
    expect(startParallel(approved(plan()), 't2', BENCH, 3).ok).toBe(false)
    const q = ok(startParallel(parallel(3), 't2', BENCH, 3))
    expect(startParallel(q, 't1', { ...BENCH, dir: '.guildflow/wt/t1-1' }, 4).ok).toBe(false) // plaza de t2 sin lanzar
    expect(startTask(q, 't1', 4).ok).toBe(false)
    const launched = ok(agentSpawned(q, agent('a2', 'artifice', 't2'), 5))
    expect(parallelCandidates(launched)).toEqual(['t1']) // t3 (src/) pisa src/other.js
  })

  test('conflicto o fallo del Artífice: la subtarea vuelve a la cola con el intento gastado', () => {
    let q = ok(agentSpawned(ok(startParallel(parallel(), 't2', BENCH, 3)), agent('a2', 'artifice', 't2'), 4))
    const crashed = ok(agentFinished(q, 'a2', { reason: 'error', partial: false }, 5))
    expect(crashed.progress.t2!.status).toBe('pending')
    expect(crashed.progress.t2!.attempts).toBe(1)
    expect(crashed.benches).toEqual({})
    q = ok(agentFinished(q, 'a2', { reason: 'answer', partial: false }, 5))
    const c = ok(benchConflict(q, 't2', 'src/other.js cambió', 6))
    expect(c.progress.t2!.status).toBe('pending')
    expect(c.progress.t2!.lastFailure).toContain('conflicto al integrar')
  })

  test('reinicio: el taller con su agente perdido vuelve a la cola sin gastar intento; replanificar cierra los talleres', () => {
    const q = ok(agentSpawned(ok(startParallel(parallel(), 't2', BENCH, 3)), agent('a2', 'artifice', 't2'), 4))
    const r = ok(recover(q, 5))
    expect(r.progress.t2!.status).toBe('pending')
    expect(r.progress.t2!.attempts).toBe(0)
    expect(r.benches).toEqual({})
    const v = validatePlan(plan(), LIMITS)
    if (!v.ok) throw new Error(v.errors.join())
    expect(ok(submitPlan({ ...q, state: 'BLOCKED' }, v.plan, 6)).benches).toEqual({})
  })
})

describe('política del taller', () => {
  const write = (q: Quest, agentId: string, w: string) =>
    decide({ tool: 'Write', caller: { kind: 'agent', agentId, role: 'artifice' }, quest: q, root: ROOT, reads: [], writes: [`${ROOT}/${w}`], patterns: [] })
  const running = () => {
    let q = ok(agentSpawned(ok(startTask(parallel(), 't1', 3)), agent('a1', 'artifice', 't1'), 3))
    q = ok(agentSpawned(ok(startParallel(q, 't2', BENCH, 4)), agent('a2', 'artifice', 't2'), 5))
    return q
  }
  test('el Artífice en paralelo escribe solo en su taller, en sus rutas, aunque el carril principal esté en otra fase', () => {
    const q = { ...running(), state: 'REVIEWING' as const }
    expect(write(q, 'a2', '.guildflow/wt/t2-1/src/other.js').kind).toBe('allow')
    expect(write(q, 'a2', 'src/other.js').kind).toBe('deny') // el árbol principal no: lo integra el mod
    expect(write(q, 'a2', '.guildflow/wt/t2-1/src/math.js').kind).toBe('deny') // ruta de otra subtarea
    expect(write(q, 'a2', '.guildflow/wt/t2-1/test/x.test.js').kind).toBe('deny') // protegida por su comprobación
  })
  test('el carril principal sigue con sus reglas y no puede arrancar una subtarea que pise un taller', () => {
    const q = running()
    expect(write(q, 'a1', 'src/math.js').kind).toBe('allow')
    expect(write(q, 'a1', '.guildflow/wt/t2-1/src/other.js').kind).toBe('deny')
    const free = { ...q, state: 'DISPATCH' as const, activeTask: null, progress: { ...q.progress, t1: { ...q.progress.t1!, status: 'done' as const } } }
    const r = startTask(free, 't3', 6)
    expect(r.ok ? '' : r.error).toContain('pisan el taller en marcha de t2')
  })
})
