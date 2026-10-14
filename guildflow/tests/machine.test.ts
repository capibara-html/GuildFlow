import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import {
  account,
  agentFinished,
  agentSpawned,
  approve,
  block,
  canFinish,
  halt,
  limitBreach,
  markLogged,
  pause,
  recordCheck,
  recordVerdict,
  recover,
  rejectPlan,
  resume,
  startReview,
  startTask,
  submitPlan,
  TRANSITIONS,
} from '../src/machine'
import { agent, approved, ok, planned, run, RAW_PLAN, LIMITS } from './fixtures'
import { validatePlan } from '../src/validation'

/** Recorre una ronda completa de t1: implementación, comprobaciones y revisión. */
function round(q: Quest, n: number, a: { unit: boolean; scope: boolean; review: 'PASS' | 'FAIL' | null }): Quest {
  q = ok(startTask(q, 't1', 10 * n))
  if (q.state !== 'IMPLEMENTING') return q
  q = ok(agentSpawned(q, agent(`art${n}`, 'artifice', 't1'), 10 * n))
  q = ok(agentFinished(q, `art${n}`, { reason: 'answer', partial: false }, 10 * n + 1))
  q = ok(recordCheck(q, run('unit', a.unit), a.unit ? 'tests: 1 pass' : 'AssertionError at src/math.js:3', 10 * n + 2))
  q = ok(recordCheck(q, run('diff-scope', a.scope), a.scope ? 'scope ok' : 'fuera de ruta', 10 * n + 3))
  if (q.state !== 'REVIEWING') return q
  q = ok(startReview(q, 10 * n + 4))
  q = ok(agentSpawned(q, agent(`pal${n}`, 'paladin', 't1'), 10 * n + 4))
  if (a.review) q = ok(recordVerdict(q, { agentId: `pal${n}`, criterionId: 'c2', verdict: a.review, evidence: 'src/math.js:2 suma directa' }, 10 * n + 5))
  return ok(agentFinished(q, `pal${n}`, { reason: 'answer', partial: false }, 10 * n + 6))
}

describe('transiciones', () => {
  test('camino feliz: INTAKE → … → DONE → LOGGED', () => {
    let q = approved()
    expect(q.state).toBe('DISPATCH')
    q = round(q, 1, { unit: true, scope: true, review: 'PASS' })
    expect(q.state).toBe('DONE')
    expect(canFinish(q)).toBe(true)
    expect(ok(markLogged(q, 100)).state).toBe('LOGGED')
  })

  test('la tabla no tiene salidas desde LOGGED y DONE solo va a LOGGED', () => {
    expect(TRANSITIONS.LOGGED).toEqual([])
    expect(TRANSITIONS.DONE).toEqual(['LOGGED'])
  })

  test('una transición inválida falla y no cambia la misión', () => {
    const q = planned()
    const before = JSON.stringify(q)
    const r = startTask(q, 't1', 5)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(q)).toBe(before)
    expect(markLogged(q, 5).ok).toBe(false)
  })

  test('sin aprobación humana no se implementa', () => {
    const q = planned()
    const r = approve(q, { by: 'agent', answer: 'Aprobar', baseline: null }, 3)
    expect(r.ok).toBe(false)
    expect(startTask(q, 't1', 3).ok).toBe(false)
  })

  test('un plan alterado tras presentarse no puede aprobarse', () => {
    const q = planned()
    q.plan!.tasks[0]!.paths.push('src/otro.js')
    const r = approve(q, { by: 'human', answer: 'Aprobar', baseline: null }, 3)
    expect(r.ok).toBe(false)
  })

  test('rechazar el plan vuelve a PLANNING', () => {
    const q = ok(rejectPlan(planned(), 'falta un test', 3))
    expect(q.state).toBe('PLANNING')
    expect(q.reason).toContain('falta un test')
  })

  test('cambiar el plan exige nueva aprobación y conserva subtareas terminadas idénticas', () => {
    let q = approved()
    q = round(q, 1, { unit: true, scope: true, review: 'FAIL' })
    q = ok(block(q, 'replanificar', 50))
    const v = validatePlan(RAW_PLAN, LIMITS)
    if (!v.ok) throw new Error('plan')
    const re = ok(submitPlan(q, v.plan, 51))
    expect(re.state).toBe('AWAITING_APPROVAL')
    expect(re.approval).toBeNull()
    expect(startTask(re, 't1', 52).ok).toBe(false)
  })
})

describe('criterios y evidencia', () => {
  test('DONE es imposible con un criterio fallido, inconcluso o sin ejecutar', () => {
    for (const review of ['FAIL', null] as const) {
      const q = round(approved(), 1, { unit: true, scope: true, review })
      expect(q.state).not.toBe('DONE')
      expect(canFinish(q)).toBe(false)
    }
  })

  test('un test fallido lleva a FIXING sin pasar por la revisión', () => {
    const q = round(approved(), 1, { unit: false, scope: true, review: null })
    expect(q.state).toBe('FIXING')
    expect(q.progress.t1!.lastFailure).toContain('c1')
  })

  test('el Paladín no puede aprobar un criterio automático ni aprobar sin referencia', () => {
    let q = approved()
    q = ok(startTask(q, 't1', 1))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 1))
    q = ok(agentFinished(q, 'a', { reason: 'answer', partial: false }, 2))
    q = ok(recordCheck(q, run('unit', true), 'ok', 3))
    q = ok(recordCheck(q, run('diff-scope', true), 'ok', 3))
    q = ok(startReview(q, 4))
    q = ok(agentSpawned(q, agent('p', 'paladin', 't1'), 4))
    expect(recordVerdict(q, { agentId: 'p', criterionId: 'c1', verdict: 'PASS', evidence: 'src/math.js:1' }, 5).ok).toBe(false)
    expect(recordVerdict(q, { agentId: 'p', criterionId: 'c2', verdict: 'PASS', evidence: 'parece bien' }, 5).ok).toBe(false)
    expect(recordVerdict(q, { agentId: 'a', criterionId: 'c2', verdict: 'PASS', evidence: 'src/math.js:1' }, 5).ok).toBe(false)
  })

  test('los criterios aprobados están congelados: el hash del plan no cambia sin nueva aprobación', () => {
    const q = approved()
    expect(q.approval?.planHash).toBe(q.planHash)
    const tampered = JSON.parse(JSON.stringify(q)) as Quest
    tampered.plan!.tasks[0]!.criteria[0]!.check = 'review'
    expect(startTask(tampered, 't1', 3).ok).toBe(false)
  })
})

describe('límites del ciclo', () => {
  test('mismo fallo dos veces → BLOCKED y no se reintenta solo', () => {
    let q = round(approved(), 1, { unit: false, scope: true, review: null })
    q = round(q, 2, { unit: false, scope: true, review: null })
    expect(q.state).toBe('BLOCKED')
    expect(q.reason).toContain('mismo fallo')
    expect(startTask(q, 't1', 99).ok).toBe(false)
  })

  test('fallos distintos agotan los intentos → BLOCKED', () => {
    let q = approved()
    q = round(q, 1, { unit: false, scope: true, review: null })
    q = round(q, 2, { unit: true, scope: false, review: null })
    q = round(q, 3, { unit: true, scope: true, review: 'FAIL' })
    expect(q.state).toBe('BLOCKED')
    expect(q.reason).toContain('intentos')
  })

  test('rondas sin progreso → HALTED por límite', () => {
    let q = approved()
    q = { ...q, limits: { ...q.limits, maxNoProgressRounds: 1 } }
    q = round(q, 1, { unit: true, scope: false, review: null })
    q = round(q, 2, { unit: false, scope: true, review: null })
    expect(q.state).toBe('HALTED')
    expect(q.haltKind).toBe('limit')
    expect(q.reason).toContain('sin progreso')
  })

  test('sin tope de iteraciones: mientras queden intentos, la subtarea sigue', () => {
    const q = ok(startTask({ ...approved(), iterations: 999 }, 't1', 30))
    expect(q.state).toBe('IMPLEMENTING')
  })

  test('cortada por la suscripción, el intento en curso no cuenta', () => {
    const q = ok(halt(ok(startTask(approved(), 't1', 30)), 'limit', 'uso de la suscripción 95% ≥ 90%', 31))
    expect(q.state).toBe('HALTED')
    expect(q.progress.t1!.attempts).toBe(0)
  })

  test('solo la suscripción detiene: tokens, USD y tiempo son informativos', () => {
    let q = approved()
    q = ok(account(q, { agentId: null, tokens: 2_500_000, cacheRead: 9, costUsd: 400, ratePercent: 10, unavailable: [] }, 3))
    expect(limitBreach(q, 3)).toBeNull()
    expect(limitBreach(approved(), 24 * 60 * 60_000)).toBeNull()
    q = approved()
    q = ok(account(q, { agentId: null, tokens: 1, cacheRead: 0, costUsd: 10, ratePercent: 95, unavailable: [] }, 3))
    expect(limitBreach(q, 3)).toContain('suscripción')
    // la ventana de 5 h se reinicia: la lectura guardada caduca sin esperar otra respuesta
    q = ok(account(q, { agentId: null, tokens: 1, cacheRead: 0, costUsd: 10, ratePercent: 95, rateResetsAt: 100, unavailable: [] }, 3))
    expect(limitBreach(q, 99)).toContain('suscripción')
    expect(limitBreach(q, 100)).toBeNull()
  })

  test('sin cost.usd disponible el presupuesto USD no se aplica (y queda registrado)', () => {
    const q = ok(account(approved(), { agentId: null, tokens: 1, cacheRead: 0, costUsd: null, ratePercent: null, unavailable: ['cost.usd', 'rateLimits'] }, 3))
    expect(limitBreach(q, 3)).toBeNull()
    expect(q.usage.unavailable).toEqual(['cost.usd', 'rateLimits'])
  })

  test('la contabilidad separa sesión principal y subagentes sin duplicar', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(account(q, { agentId: null, tokens: 100, cacheRead: 1000, costUsd: 1, ratePercent: 5, unavailable: [] }, 4))
    q = ok(account(q, { agentId: 'a', tokens: 50, cacheRead: 10, costUsd: 1.5, ratePercent: 5, unavailable: [] }, 5))
    expect(q.usage.mainTokens).toBe(100)
    expect(q.usage.agentTokens).toBe(50)
    expect(q.usage.cacheReadTokens).toBe(1010)
    expect(q.agents[0]!.tokens).toBe(50)
    expect(Math.abs(q.usage.costUsd - 0.5) < 1e-9).toBe(true)
  })
})

describe('paradas y recuperación', () => {
  test('interrupción del Artífice → PAUSED; reanudar vuelve a FIXING', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(agentFinished(q, 'a', { reason: 'aborted', partial: false }, 4))
    expect(q.state).toBe('PAUSED')
    expect(resume(q, { by: 'agent', breach: null }, 5).ok).toBe(false)
    q = ok(resume(q, { by: 'human', breach: null }, 5))
    expect(q.state).toBe('FIXING')
  })

  test('HALTED por seguridad no se reanuda; por límite solo si el límite ya no se supera', () => {
    const s = ok(halt(approved(), 'safety', 'hash del plan alterado', 3))
    expect(resume(s, { by: 'human', breach: null }, 4).ok).toBe(false)
    const l = ok(halt(approved(), 'limit', 'tokens', 3))
    expect(resume(l, { by: 'human', breach: 'tokens' }, 4).ok).toBe(false)
    expect(ok(resume(l, { by: 'human', breach: null }, 4)).state).toBe('DISPATCH')
  })

  test('/quest-halt mientras el Artífice trabaja: el agente que termina después no reactiva la misión', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(halt(q, 'user', 'detenida por la persona', 4))
    q = ok(agentFinished(q, 'a', { reason: 'answer', partial: false }, 5))
    expect(q.state).toBe('HALTED')
    expect(q.agents[0]!.status).toBe('done')
    expect(q.pausedFrom).toBe('FIXING')
  })

  test('reinicio: agentes en curso → lost, sin consumir intento, misión en PAUSED', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(recover(q, 9))
    expect(q.agents[0]!.status).toBe('lost')
    expect(q.state).toBe('PAUSED')
    expect(q.progress.t1!.attempts).toBe(0)
    expect(q.pausedFrom).toBe('DISPATCH')
    expect(q.reason).toContain('perdidos')
  })

  test('BLOCKED → /quest-resume concede exactamente un intento más', () => {
    let q = round(approved(), 1, { unit: false, scope: true, review: null })
    q = round(q, 2, { unit: false, scope: true, review: null })
    expect(q.state).toBe('BLOCKED')
    q = ok(resume(q, { by: 'human', breach: null }, 50))
    expect(q.state).toBe('FIXING')
    q = round(q, 3, { unit: false, scope: true, review: null })
    expect(q.state).toBe('BLOCKED')
  })

  test('pausa durante la espera de aprobación y reanudación', () => {
    const q = ok(pause(planned(), 'sesión cerrada', 3))
    expect(q.state).toBe('PAUSED')
    expect(ok(resume(q, { by: 'human', breach: null }, 4)).state).toBe('AWAITING_APPROVAL')
  })
})

