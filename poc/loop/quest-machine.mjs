// GuildFlow PoC — diseño exploratorio del ciclo de misión. Función pura, NO conectada al mod.
// Ejecuta `node poc/loop/quest-machine.mjs` para correr su comprobación.
//
// INTAKE → PLANNING → AWAITING_APPROVAL → IMPLEMENTING → VERIFYING → REVIEWING → DONE
// + PAUSED (interrupción del usuario) y HALTED (límite, fallo repetido, rechazo final).
// Las operaciones destructivas/globales no pasan por aquí: las vetan los hooks tool.call (probado en P3).

export const DEFAULT_LIMITS = { maxIterations: 3, maxSameFailure: 2, tokenBudget: 2_000_000, wallClockMs: 60 * 60_000 }

export function start(request, limits = DEFAULT_LIMITS, now = 0) {
  return { state: 'INTAKE', request, limits, criteria: null, approved: false, iteration: 0, failures: {}, tokens: 0, startedAt: now, pausedFrom: null, reason: null }
}

const halt = (q, reason) => ({ ...q, state: 'HALTED', reason })

export function step(q, ev) {
  if (q.state === 'DONE' || q.state === 'HALTED') return q // terminal: nada vuelve a correr solo

  // Contabilidad y límites globales: se evalúan en cada evento, antes de cualquier transición
  const tokens = q.tokens + (ev.tokens ?? 0)
  q = { ...q, tokens }
  if (tokens > q.limits.tokenBudget) return halt(q, `presupuesto de tokens superado (${tokens})`)
  if (ev.now !== undefined && ev.now - q.startedAt > q.limits.wallClockMs) return halt(q, 'tiempo máximo superado')

  if (ev.type === 'user_interrupt') return { ...q, state: 'PAUSED', pausedFrom: q.state }
  if (q.state === 'PAUSED') return ev.type === 'resume' ? { ...q, state: q.pausedFrom, pausedFrom: null } : q

  switch (q.state) {
    case 'INTAKE':
      return ev.type === 'analyzed' ? { ...q, state: 'PLANNING' } : q
    case 'PLANNING':
      if (ev.type !== 'plan_ready') return q
      if (!ev.criteria?.length || ev.criteria.some(c => !c.check)) return { ...q, reason: 'cada criterio necesita un check verificable' }
      return { ...q, state: 'AWAITING_APPROVAL', criteria: Object.freeze([...ev.criteria]) }
    case 'AWAITING_APPROVAL':
      if (ev.type === 'approve' && ev.by === 'human') return { ...q, state: 'IMPLEMENTING', approved: true, iteration: 1 }
      if (ev.type === 'reject') return { ...q, state: 'PLANNING', criteria: null }
      return q // una "aprobación" que no venga de la persona no avanza
    case 'IMPLEMENTING':
      if (ev.type === 'change_criteria') return { ...q, state: 'AWAITING_APPROVAL', approved: false, criteria: Object.freeze([...ev.criteria]) }
      return ev.type === 'impl_done' ? { ...q, state: 'VERIFYING' } : q
    case 'VERIFYING':
    case 'REVIEWING': {
      const kind = q.state === 'VERIFYING' ? 'verify_result' : 'review_result'
      if (ev.type !== kind) return q
      if (ev.pass) return q.state === 'VERIFYING' ? { ...q, state: 'REVIEWING' } : { ...q, state: 'DONE', reason: 'criterios cumplidos con evidencia' }
      const sig = ev.signature ?? 'sin-firma'
      const seen = (q.failures[sig] ?? 0) + 1
      const failures = { ...q.failures, [sig]: seen }
      if (seen >= q.limits.maxSameFailure) return halt({ ...q, failures }, `mismo fallo repetido ${seen} veces: ${sig} (requiere intervención humana)`)
      if (q.iteration >= q.limits.maxIterations) return halt({ ...q, failures }, `máximo de ${q.limits.maxIterations} iteraciones`)
      return { ...q, failures, state: 'IMPLEMENTING', iteration: q.iteration + 1 }
    }
  }
  return q
}

const run = (q, events) => events.reduce(step, q)

// ---------- comprobación ----------
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('quest-machine.mjs')) {
  const assert = (await import('node:assert/strict')).default
  const crit = [{ id: 'c1', check: 'verify:tests' }]
  const toImpl = [{ type: 'analyzed' }, { type: 'plan_ready', criteria: crit }, { type: 'approve', by: 'human' }]

  // camino feliz
  assert.equal(run(start('x'), [...toImpl, { type: 'impl_done' }, { type: 'verify_result', pass: true }, { type: 'review_result', pass: true }]).state, 'DONE')
  // sin aprobación humana no se implementa
  assert.equal(run(start('x'), [{ type: 'analyzed' }, { type: 'plan_ready', criteria: crit }, { type: 'approve', by: 'agent' }]).state, 'AWAITING_APPROVAL')
  // criterio sin check no se acepta
  assert.equal(run(start('x'), [{ type: 'analyzed' }, { type: 'plan_ready', criteria: [{ id: 'c1' }] }]).state, 'PLANNING')
  // fallo repetido → detención con intervención humana
  const rep = run(start('x'), [...toImpl, { type: 'impl_done' }, { type: 'verify_result', pass: false, signature: 'T1' }, { type: 'impl_done' }, { type: 'verify_result', pass: false, signature: 'T1' }])
  assert.equal(rep.state, 'HALTED')
  assert.match(rep.reason, /mismo fallo/)
  // fallos distintos → límite de iteraciones
  const it = run(start('x'), [...toImpl, ...['A', 'B', 'C'].flatMap(s => [{ type: 'impl_done' }, { type: 'verify_result', pass: false, signature: s }])])
  assert.equal(it.state, 'HALTED')
  assert.match(it.reason, /iteraciones/)
  // presupuesto de tokens y tiempo
  assert.equal(step(run(start('x'), toImpl), { type: 'impl_done', tokens: 3_000_000 }).state, 'HALTED')
  assert.equal(step(run(start('x'), toImpl), { type: 'impl_done', now: 61 * 60_000 }).state, 'HALTED')
  // interrupción pausa y se reanuda donde estaba
  const p = step(run(start('x'), toImpl), { type: 'user_interrupt' })
  assert.equal(p.state, 'PAUSED')
  assert.equal(step(p, { type: 'impl_done' }).state, 'PAUSED')
  assert.equal(step(p, { type: 'resume' }).state, 'IMPLEMENTING')
  // cambiar un criterio aprobado exige nueva aprobación; los criterios están congelados
  const cc = step(run(start('x'), toImpl), { type: 'change_criteria', criteria: [{ id: 'c1', check: 'review' }] })
  assert.equal(cc.state, 'AWAITING_APPROVAL')
  assert.equal(cc.approved, false)
  assert.throws(() => { 'use strict'; cc.criteria.push({}) })
  // los estados terminales no vuelven a correr
  assert.equal(step(halt(start('x'), 't'), { type: 'resume' }).state, 'HALTED')
  console.log('quest-machine: todas las comprobaciones pasan')
}
