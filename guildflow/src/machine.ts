// Máquina de estados de la misión. Pura y determinista: sin $, sin reloj propio, sin E/S.
// Cada operación valida el estado y devuelve una misión NUEVA o un error; nunca muta la de entrada.
import type { AgentRecord, CheckRun, Effort, Evidence, Limits, Plan, Quest, QuestState, Role, TaskProgress, Verdict } from '../types'
import { hash } from './validation'

export type LogEntry = { ev: string; data: Record<string, unknown> }
export type Outcome = { ok: true; quest: Quest; log: LogEntry[]; note?: string } | { ok: false; error: string }

/** Transiciones permitidas. Todo lo que no figura aquí se rechaza. */
export const TRANSITIONS: Readonly<Record<QuestState, readonly QuestState[]>> = {
  INTAKE: ['PLANNING', 'PAUSED', 'HALTED', 'BLOCKED'],
  PLANNING: ['AWAITING_APPROVAL', 'PAUSED', 'HALTED', 'BLOCKED'],
  AWAITING_APPROVAL: ['DISPATCH', 'PLANNING', 'PAUSED', 'HALTED', 'BLOCKED'],
  DISPATCH: ['IMPLEMENTING', 'PAUSED', 'HALTED', 'BLOCKED'],
  IMPLEMENTING: ['VERIFYING', 'DISPATCH', 'FIXING', 'PAUSED', 'HALTED', 'BLOCKED'],
  VERIFYING: ['REVIEWING', 'FIXING', 'PAUSED', 'HALTED', 'BLOCKED'],
  REVIEWING: ['DONE', 'DISPATCH', 'FIXING', 'PAUSED', 'HALTED', 'BLOCKED'],
  FIXING: ['IMPLEMENTING', 'PAUSED', 'HALTED', 'BLOCKED'],
  DONE: ['LOGGED'],
  LOGGED: [],
  PAUSED: ['PLANNING', 'AWAITING_APPROVAL', 'DISPATCH', 'VERIFYING', 'REVIEWING', 'FIXING', 'HALTED', 'BLOCKED'],
  HALTED: ['PLANNING', 'AWAITING_APPROVAL', 'DISPATCH', 'VERIFYING', 'REVIEWING', 'FIXING'],
  BLOCKED: ['PLANNING', 'AWAITING_APPROVAL', 'DISPATCH', 'VERIFYING', 'REVIEWING', 'FIXING', 'HALTED'],
}

const STOPPED: readonly QuestState[] = ['PAUSED', 'HALTED', 'BLOCKED']
const TERMINAL: readonly QuestState[] = ['DONE', 'LOGGED']

/** La misión sigue bajo el control de GuildFlow (las políticas del mod se aplican). */
export const isActive = (q: Quest | null): q is Quest => q !== null && q.state !== 'LOGGED'
export const isStopped = (q: Quest) => STOPPED.includes(q.state)
/** La aprobación humana del plan vigente existe y coincide con su hash. */
export const isApproved = (q: Quest) =>
  q.approval !== null && q.plan !== null && q.planHash !== null && q.approval.planHash === q.planHash && hash(JSON.stringify(q.plan)) === q.planHash

const clone = (q: Quest): Quest => JSON.parse(JSON.stringify(q)) as Quest
const fail = (error: string): Outcome => ({ ok: false, error })

function go(q: Quest, to: QuestState, now: number, log: LogEntry[], reason?: string): Quest {
  if (!TRANSITIONS[q.state].includes(to)) throw new Error(`transición no permitida: ${q.state} → ${to}`)
  const from = q.state
  // el reloj de misión solo corre fuera de pausas y estados finales
  const running = (s: QuestState) => !STOPPED.includes(s) && !TERMINAL.includes(s) && s !== 'AWAITING_APPROVAL'
  if (running(from) && !running(to) && q.activeSince !== null) {
    q.activeMs += Math.max(0, now - q.activeSince)
    q.activeSince = null
  } else if (!running(from) && running(to)) q.activeSince = now
  q.state = to
  q.progressMark += 1
  if (reason !== undefined) q.reason = reason
  else if (!STOPPED.includes(to)) q.reason = null
  log.push({ ev: 'state', data: { from, to, reason: reason ?? null } })
  return q
}

/** Envuelve una operación: trabaja sobre una copia; si lanza, la misión original queda intacta. */
function op(q: Quest, now: number, body: (c: Quest, log: LogEntry[]) => string | void): Outcome {
  const c = clone(q)
  const log: LogEntry[] = []
  try {
    const note = body(c, log)
    c.updatedAt = now
    return { ok: true, quest: c, log, ...(note ? { note } : {}) }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

export function elapsedMs(q: Quest, now: number): number {
  return q.activeMs + (q.activeSince !== null ? Math.max(0, now - q.activeSince) : 0)
}

export function createQuest(a: { id: string; request: string; project: string; sessionId: string; limits: Limits; now: number }): Outcome {
  const q: Quest = {
    schema: 1,
    id: a.id,
    rev: 0,
    project: a.project,
    sessionId: a.sessionId,
    request: a.request,
    state: 'INTAKE',
    pausedFrom: null,
    haltKind: null,
    reason: null,
    createdAt: a.now,
    updatedAt: a.now,
    activeMs: 0,
    activeSince: a.now,
    plan: null,
    planHash: null,
    approval: null,
    baseline: null,
    progress: {},
    activeTask: null,
    slot: null,
    iterations: 0,
    agentsSpawned: 0,
    agents: [],
    usage: { mainTokens: 0, agentTokens: 0, cacheReadTokens: 0, requests: 0, costStartUsd: null, costUsd: 0, ratePercent: null, unavailable: [] },
    limits: a.limits,
    filesWritten: [],
    diffLines: null,
    lastCheck: null,
    progressMark: 0,
    continueMark: 0,
    continuations: 0,
  }
  return op(q, a.now, (c, log) => {
    log.push({ ev: 'quest.created', data: { id: a.id, request: a.request } })
    go(c, 'PLANNING', a.now, log)
  })
}

const newProgress = (): TaskProgress => ({
  status: 'pending',
  attempts: 0,
  round: 0,
  evidence: {},
  failures: {},
  bestPassCount: -1,
  noProgress: 0,
  lastFailure: null,
  bonusAttempts: 0,
})

/** El plan ya validado (validation.ts) pasa a esperar aprobación. Las subtareas terminadas e idénticas se conservan. */
export function submitPlan(q: Quest, plan: Plan, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (!['PLANNING', 'AWAITING_APPROVAL', 'BLOCKED'].includes(c.state)) throw new Error(`no se puede presentar un plan en ${c.state}`)
    const old = c.plan
    const progress: Record<string, TaskProgress> = {}
    for (const t of plan.tasks) {
      const prev = old?.tasks.find(o => o.id === t.id)
      const kept = prev && JSON.stringify(prev) === JSON.stringify(t) && c.progress[t.id]?.status === 'done'
      progress[t.id] = kept ? c.progress[t.id] : newProgress()
    }
    c.plan = plan
    c.planHash = hash(JSON.stringify(plan))
    c.approval = null
    c.progress = progress
    c.activeTask = null
    c.slot = null
    log.push({ ev: 'plan.submitted', data: { planHash: c.planHash, tasks: plan.tasks.map(t => t.id) } })
    if (c.state === 'BLOCKED') go(c, 'AWAITING_APPROVAL', now, log)
    else if (c.state === 'PLANNING') go(c, 'AWAITING_APPROVAL', now, log)
  })
}

export function rejectPlan(q: Quest, feedback: string, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state !== 'AWAITING_APPROVAL') throw new Error(`no hay plan pendiente de aprobación (${c.state})`)
    log.push({ ev: 'plan.rejected', data: { feedback } })
    go(c, 'PLANNING', now, log, `plan rechazado: ${feedback}`)
  })
}

/** Solo una respuesta humana aprueba; el hash del plan aprobado queda congelado. */
export function approve(q: Quest, a: { by: string; answer: string; baseline: Quest['baseline'] }, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state !== 'AWAITING_APPROVAL') throw new Error(`no hay plan pendiente de aprobación (${c.state})`)
    if (a.by !== 'human') throw new Error('solo la persona usuaria puede aprobar')
    if (!c.plan || !c.planHash || hash(JSON.stringify(c.plan)) !== c.planHash) throw new Error('el plan no coincide con su hash')
    c.approval = { by: 'human', at: now, planHash: c.planHash, answer: a.answer }
    c.baseline = a.baseline
    log.push({ ev: 'plan.approved', data: { planHash: c.planHash, answer: a.answer } })
    go(c, 'DISPATCH', now, log)
  })
}

export function maxAttempts(q: Quest, taskId: string): number {
  const t = q.plan?.tasks.find(x => x.id === taskId)
  const p = q.progress[taskId]
  return Math.min(t?.maxAttempts ?? q.limits.maxAttemptsPerTask, q.limits.maxAttemptsPerTask) + (p?.bonusAttempts ?? 0)
}

/** Autoriza una ejecución del Artífice para una subtarea: abre la plaza que consumirá agent.spawn. */
export function startTask(q: Quest, taskId: string, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (!isApproved(c)) throw new Error('la misión no tiene un plan aprobado vigente')
    if (c.state !== 'DISPATCH' && c.state !== 'FIXING') throw new Error(`no se puede iniciar una subtarea en ${c.state}`)
    const task = c.plan!.tasks.find(t => t.id === taskId)
    const p = c.progress[taskId]
    if (!task || !p) throw new Error(`subtarea desconocida: ${taskId}`)
    if (c.state === 'FIXING' && c.activeTask !== taskId) throw new Error(`en FIXING solo puede reintentarse ${c.activeTask}`)
    if (c.state === 'DISPATCH') {
      if (p.status !== 'pending') throw new Error(`la subtarea ${taskId} está ${p.status}`)
      const missing = task.dependsOn.filter(d => c.progress[d]?.status !== 'done')
      if (missing.length) throw new Error(`dependencias sin terminar: ${missing.join(', ')}`)
    }
    if (c.iterations >= c.limits.maxQuestIterations) {
      stop(c, 'HALTED', `límite de iteraciones por misión (${c.limits.maxQuestIterations})`, now, log)
      c.haltKind = 'limit'
      return 'límite de iteraciones alcanzado'
    }
    if (p.attempts >= maxAttempts(c, taskId)) {
      p.status = 'blocked'
      stop(c, 'BLOCKED', `subtarea ${taskId}: ${p.attempts} intentos usados (máximo ${maxAttempts(c, taskId)})`, now, log)
      return 'límite de intentos alcanzado'
    }
    p.attempts += 1
    p.round += 1
    p.status = 'active'
    c.iterations += 1
    c.activeTask = taskId
    c.slot = { role: 'artifice', taskId, attempt: p.attempts }
    log.push({ ev: 'task.started', data: { taskId, attempt: p.attempts, round: p.round, iteration: c.iterations } })
    go(c, 'IMPLEMENTING', now, log)
  })
}

/** Abre la plaza del Paladín para la subtarea en revisión. */
export function startReview(q: Quest, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state !== 'REVIEWING' || !c.activeTask) throw new Error(`no hay revisión pendiente (${c.state})`)
    if (c.agents.some(a => a.role === 'paladin' && a.status === 'running')) throw new Error('ya hay un Paladín revisando')
    c.slot = { role: 'paladin', taskId: c.activeTask, attempt: c.progress[c.activeTask].round }
    log.push({ ev: 'review.slot', data: { taskId: c.activeTask } })
  })
}

/** Por qué no puede lanzarse un agente de este rol ahora (null si puede). */
export function spawnBlocker(q: Quest, role: Role): string | null {
  if (isStopped(q)) return `la misión está ${q.state}`
  if (q.agentsSpawned >= q.limits.maxAgentsPerQuest) return `límite de ${q.limits.maxAgentsPerQuest} agentes por misión`
  const running = q.agents.filter(a => a.status === 'running').length
  if (running >= q.limits.maxConcurrentAgents) return `límite de ${q.limits.maxConcurrentAgents} agentes concurrentes`
  if (role === 'archimago') return q.state === 'PLANNING' ? null : `el Archimago solo planifica (estado ${q.state})`
  if (!q.slot || q.slot.role !== role) return `no hay una plaza autorizada para ${role}; usa la herramienta quest (start_task / start_review)`
  if (role === 'artifice' && q.state !== 'IMPLEMENTING') return `el Artífice solo trabaja en IMPLEMENTING (estado ${q.state})`
  if (role === 'paladin' && q.state !== 'REVIEWING') return `el Paladín solo revisa en REVIEWING (estado ${q.state})`
  if (q.agents.some(a => a.status === 'running' && a.role !== 'archimago')) return 'ya hay un agente de ejecución en curso (ejecución secuencial)'
  return null
}

export function agentSpawned(q: Quest, rec: AgentRecord, now: number): Outcome {
  return op(q, now, (c, log) => {
    const blocker = spawnBlocker(c, rec.role)
    if (blocker) throw new Error(blocker)
    c.agents.push(rec)
    c.agentsSpawned += 1
    if (rec.role !== 'archimago') c.slot = null
    c.progressMark += 1
    log.push({ ev: 'agent.spawned', data: { agentId: rec.id, role: rec.role, taskId: rec.taskId, model: rec.model } })
  })
}

/** Lleva una subtarea interrumpida al punto desde el que puede relanzarse. */
function rewind(c: Quest, refund: boolean): QuestState {
  const id = c.activeTask
  if (c.state === 'IMPLEMENTING' && id) {
    const p = c.progress[id]
    if (refund) {
      p.attempts = Math.max(0, p.attempts - 1)
      p.round = Math.max(0, p.round - 1)
      c.iterations = Math.max(0, c.iterations - 1)
    }
    p.status = p.attempts > 0 ? 'fixing' : 'pending'
    c.slot = null
    return p.status === 'fixing' ? 'FIXING' : 'DISPATCH'
  }
  if (c.state === 'REVIEWING' && id) {
    const p = c.progress[id]
    for (const [cid, ev] of Object.entries(p.evidence)) if (ev.source === 'paladin' && ev.round === p.round) delete p.evidence[cid]
    c.slot = null
    return 'REVIEWING'
  }
  if (c.state === 'INTAKE') return 'PLANNING'
  return c.state
}

function stop(c: Quest, to: 'PAUSED' | 'HALTED' | 'BLOCKED', reason: string, now: number, log: LogEntry[], refund = false) {
  if (TERMINAL.includes(c.state)) throw new Error(`la misión ya terminó (${c.state})`)
  if (c.state === to) {
    c.reason = reason
    return
  }
  if (c.state === 'HALTED') throw new Error('una misión detenida solo sale con /quest-resume')
  if (!STOPPED.includes(c.state)) c.pausedFrom = rewind(c, refund)
  go(c, to, now, log, reason)
}

export function pause(q: Quest, reason: string, now: number): Outcome {
  return op(q, now, (c, log) => stop(c, 'PAUSED', reason, now, log))
}

export function halt(q: Quest, kind: 'user' | 'limit' | 'safety', reason: string, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state === 'HALTED' && c.haltKind === 'safety') return // la causa de seguridad no se rebaja
    stop(c, 'HALTED', reason, now, log)
    c.haltKind = kind
  })
}

export function block(q: Quest, reason: string, now: number): Outcome {
  return op(q, now, (c, log) => stop(c, 'BLOCKED', reason, now, log))
}

/**
 * Reanudación explícita de la persona. HALTED por seguridad nunca se reanuda; HALTED por límite solo si
 * `breach` (calculado por el llamante con la configuración vigente) es null. BLOCKED concede un intento más.
 */
export function resume(q: Quest, a: { by: string; breach: string | null }, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (a.by !== 'human') throw new Error('solo la persona usuaria puede reanudar')
    if (!STOPPED.includes(c.state)) throw new Error(`la misión no está detenida (${c.state})`)
    if (c.state === 'HALTED' && c.haltKind === 'safety') throw new Error(`detenida por seguridad: ${c.reason}. Abre una misión nueva.`)
    if (c.state === 'HALTED' && c.haltKind === 'limit' && a.breach) throw new Error(`el límite sigue superado: ${a.breach}`)
    const target = c.pausedFrom ?? 'PLANNING'
    if (c.state === 'BLOCKED' && c.activeTask) {
      const p = c.progress[c.activeTask]
      if (p.status === 'blocked') {
        p.bonusAttempts += 1
        p.status = p.attempts > 0 ? 'fixing' : 'pending'
      }
    }
    const to: QuestState = target
    c.haltKind = null
    c.pausedFrom = null
    log.push({ ev: 'quest.resumed', data: { to } })
    go(c, to, now, log)
  })
}

export function agentFinished(q: Quest, agentId: string, a: { reason: string; partial: boolean }, now: number): Outcome {
  return op(q, now, (c, log) => {
    const rec = c.agents.find(x => x.id === agentId)
    if (!rec) throw new Error(`agente desconocido: ${agentId}`)
    if (rec.status !== 'running') return
    rec.status = a.reason === 'answer' ? 'done' : a.reason === 'aborted' ? 'aborted' : 'error'
    rec.endedAt = now
    rec.partial = a.partial
    log.push({ ev: 'agent.finished', data: { agentId, role: rec.role, reason: a.reason, partial: a.partial } })
    if (rec.role === 'archimago' || rec.taskId !== c.activeTask || STOPPED.includes(c.state)) return
    if (a.reason === 'aborted') return void stop(c, 'PAUSED', `${rec.role} interrumpido por la persona`, now, log)
    if (a.reason !== 'answer') return void stop(c, 'BLOCKED', `${rec.role} terminó con ${a.reason}`, now, log)
    if (rec.role === 'artifice' && c.state === 'IMPLEMENTING') {
      c.progress[rec.taskId!].status = 'verifying'
      go(c, 'VERIFYING', now, log)
    } else if (rec.role === 'paladin' && c.state === 'REVIEWING') {
      settleReview(c, now, log)
    }
  })
}

/** Agentes que figuraban en curso y no pueden confirmarse (reinicio): perdidos, sin consumir intento. */
export function recover(q: Quest, now: number): Outcome {
  return op(q, now, (c, log) => {
    const lost = c.agents.filter(a => a.status === 'running')
    for (const a of lost) {
      a.status = 'lost'
      a.endedAt = now
      log.push({ ev: 'agent.lost', data: { agentId: a.id, role: a.role, taskId: a.taskId } })
    }
    if (TERMINAL.includes(c.state)) return
    const lostText = lost.length ? `; agentes perdidos: ${lost.map(a => `${a.role} ${a.id}`).join(', ')}` : ''
    if (!STOPPED.includes(c.state)) stop(c, 'PAUSED', `sesión reiniciada: revisa el estado y usa /quest-resume${lostText}`, now, log, lost.some(a => a.role === 'artifice'))
    else if (lostText) c.reason = `${c.reason ?? ''}${lostText}`
  })
}

/** Criterios de la subtarea con la comprobación automática que les corresponde. */
export const automated = (check: string) => check === 'diff-scope' || check.startsWith('check:')

const currentEvidence = (p: TaskProgress, cid: string): Evidence | null => {
  const ev = p.evidence[cid]
  return ev && ev.round === p.round ? ev : null
}

/** Registra una comprobación certificadora (solo en VERIFYING, solo de la subtarea activa). */
export function recordCheck(q: Quest, run: CheckRun, detail: string, now: number): Outcome {
  return op(q, now, (c, log) => {
    c.lastCheck = run
    log.push({ ev: 'check.recorded', data: { ...run } })
    if (!run.certifying) return
    if (c.state !== 'VERIFYING' || run.taskId !== c.activeTask || !c.activeTask) throw new Error(`comprobación certificadora fuera de VERIFYING (${c.state})`)
    const task = c.plan!.tasks.find(t => t.id === c.activeTask)!
    const p = c.progress[task.id]
    const key = run.checkId === 'diff-scope' ? 'diff-scope' : `check:${run.checkId}`
    for (const cr of task.criteria.filter(x => x.check === key)) {
      p.evidence[cr.id] = { verdict: run.pass ? 'PASS' : 'FAIL', source: 'run_check', detail, runId: run.runId, round: p.round, at: now }
    }
    c.progressMark += 1
    const pending = task.criteria.filter(x => automated(x.check) && !currentEvidence(p, x.id))
    if (pending.length) return
    const failed = task.criteria.filter(x => automated(x.check) && currentEvidence(p, x.id)?.verdict !== 'PASS')
    if (failed.length) return void failRound(c, now, log)
    p.status = 'reviewing'
    go(c, 'REVIEWING', now, log)
  })
}

/** Criterios automáticos todavía sin evidencia en esta ronda (lo que el mod debe ejecutar). */
export function pendingChecks(q: Quest): string[] {
  const id = q.activeTask
  if (!id || !q.plan) return []
  const p = q.progress[id]
  const task = q.plan.tasks.find(t => t.id === id)!
  const ids = task.criteria.filter(x => automated(x.check) && !currentEvidence(p, x.id)).map(x => (x.check === 'diff-scope' ? 'diff-scope' : x.check.slice(6)))
  return [...new Set(ids)]
}

const REF = /([\w./\\-]+:\d+)|(run-[\w-]+)/

/** Veredicto del Paladín: solo para criterios de revisión y con referencia concreta cuando afirma o niega. */
export function recordVerdict(q: Quest, a: { agentId: string; criterionId: string; verdict: Verdict; evidence: string }, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state !== 'REVIEWING' || !c.activeTask) throw new Error(`no hay revisión en curso (${c.state})`)
    const rec = c.agents.find(x => x.id === a.agentId)
    if (!rec || rec.role !== 'paladin' || rec.status !== 'running' || rec.taskId !== c.activeTask) throw new Error('solo el Paladín en curso emite veredictos')
    const task = c.plan!.tasks.find(t => t.id === c.activeTask)!
    const cr = task.criteria.find(x => x.id === a.criterionId)
    if (!cr) throw new Error(`criterio desconocido: ${a.criterionId}`)
    if (cr.check !== 'review') throw new Error(`el criterio ${cr.id} se certifica con ${cr.check}, no con la revisión`)
    if ((a.verdict === 'PASS' || a.verdict === 'FAIL') && !REF.test(a.evidence)) throw new Error('PASS/FAIL exige evidencia con archivo:línea o un runId')
    const p = c.progress[task.id]
    p.evidence[cr.id] = { verdict: a.verdict, source: 'paladin', detail: a.evidence.slice(0, 2000), runId: null, round: p.round, at: now }
    c.progressMark += 1
    log.push({ ev: 'review.verdict', data: { taskId: task.id, criterionId: cr.id, verdict: a.verdict } })
  })
}

function settleReview(c: Quest, now: number, log: LogEntry[]) {
  const task = c.plan!.tasks.find(t => t.id === c.activeTask)!
  const p = c.progress[task.id]
  for (const cr of task.criteria) {
    if (!currentEvidence(p, cr.id)) p.evidence[cr.id] = { verdict: 'NOT_RUN', source: 'mod', detail: 'sin veredicto en esta ronda', runId: null, round: p.round, at: now }
  }
  if (task.criteria.some(cr => currentEvidence(p, cr.id)?.verdict !== 'PASS')) return failRound(c, now, log)
  p.status = 'done'
  c.activeTask = null
  log.push({ ev: 'task.done', data: { taskId: task.id, attempts: p.attempts } })
  if (canFinish(c)) {
    go(c, 'DONE', now, log)
  } else go(c, 'DISPATCH', now, log)
}

/** Firma estable del fallo de una ronda: criterios no aprobados + primera línea normalizada de su evidencia. */
export function failureSignature(c: Quest): string {
  const task = c.plan!.tasks.find(t => t.id === c.activeTask)!
  const p = c.progress[task.id]
  const parts = task.criteria
    .map(cr => ({ cr, ev: currentEvidence(p, cr.id) }))
    .filter(x => x.ev?.verdict !== 'PASS')
    .map(x => `${x.cr.id}:${x.ev?.verdict ?? 'NOT_RUN'}:${(x.ev?.detail ?? '').split('\n')[0].replace(/\d+/g, '#').slice(0, 160)}`)
    .sort()
  return hash(parts.join('|'))
}

function failRound(c: Quest, now: number, log: LogEntry[]) {
  const id = c.activeTask!
  const task = c.plan!.tasks.find(t => t.id === id)!
  const p = c.progress[id]
  const sig = failureSignature(c)
  p.failures[sig] = (p.failures[sig] ?? 0) + 1
  const passed = task.criteria.filter(cr => currentEvidence(p, cr.id)?.verdict === 'PASS').length
  if (passed > p.bestPassCount) {
    p.bestPassCount = passed
    p.noProgress = 0
  } else p.noProgress += 1
  const failing = task.criteria.filter(cr => currentEvidence(p, cr.id)?.verdict !== 'PASS').map(cr => cr.id)
  p.lastFailure = `ronda ${p.round}: ${failing.join(', ')} (firma ${sig})`
  log.push({ ev: 'round.failed', data: { taskId: id, round: p.round, signature: sig, seen: p.failures[sig], failing, passed } })
  p.status = 'fixing'
  go(c, 'FIXING', now, log)
  if (p.failures[sig] >= c.limits.maxSameFailure) {
    p.status = 'blocked'
    stop(c, 'BLOCKED', `subtarea ${id}: el mismo fallo se repitió ${p.failures[sig]} veces (${failing.join(', ')}); hace falta otra estrategia o una decisión`, now, log)
  } else if (p.noProgress >= c.limits.maxNoProgressRounds) {
    stop(c, 'HALTED', `subtarea ${id}: ${p.noProgress} rondas sin progreso`, now, log)
    c.haltKind = 'limit'
  } else if (p.attempts >= maxAttempts(c, id)) {
    p.status = 'blocked'
    stop(c, 'BLOCKED', `subtarea ${id}: ${p.attempts} intentos usados (máximo ${maxAttempts(c, id)})`, now, log)
  }
}

/** DONE solo con todas las subtareas terminadas y cada criterio con evidencia positiva de su última ronda. */
export function canFinish(q: Quest): boolean {
  if (!q.plan || !isApproved(q)) return false
  return q.plan.tasks.every(t => {
    const p = q.progress[t.id]
    return p?.status === 'done' && t.criteria.every(cr => currentEvidence(p, cr.id)?.verdict === 'PASS')
  })
}

export function markLogged(q: Quest, now: number): Outcome {
  return op(q, now, (c, log) => {
    if (c.state !== 'DONE') throw new Error(`solo se registra una misión DONE (${c.state})`)
    if (!canFinish(c)) throw new Error('hay criterios sin evidencia positiva')
    go(c, 'LOGGED', now, log)
  })
}

/** Límites globales con la configuración dada; null si ninguno está superado. */
export function limitBreach(q: Quest, now: number, limits: Limits = q.limits): string | null {
  const u = q.usage
  if (u.mainTokens + u.agentTokens > limits.tokenBudgetPerQuest) return `presupuesto de tokens (${u.mainTokens + u.agentTokens} > ${limits.tokenBudgetPerQuest})`
  if (u.costStartUsd !== null && u.costUsd > limits.costBudgetUsd) return `presupuesto USD equivalente (${u.costUsd.toFixed(2)} > ${limits.costBudgetUsd})`
  if (u.ratePercent !== null && u.ratePercent >= limits.rateLimitPercent) return `uso de la suscripción ${u.ratePercent}% ≥ ${limits.rateLimitPercent}%`
  if (elapsedMs(q, now) > limits.wallClockMinutes * 60_000) return `tiempo máximo de misión (${limits.wallClockMinutes} min)`
  if (q.filesWritten.length > limits.maxFilesChanged) return `archivos modificados (${q.filesWritten.length} > ${limits.maxFilesChanged})`
  if (q.diffLines !== null && q.diffLines > limits.maxDiffLines) return `líneas de diff (${q.diffLines} > ${limits.maxDiffLines})`
  return null
}

/** Suma el uso de una petición al agente o a la sesión principal (nunca a ambos). */
export function account(
  q: Quest,
  a: { agentId: string | null; tokens: number; cacheRead: number; costUsd: number | null; ratePercent: number | null; unavailable: string[]; model?: string; effort?: Effort | null },
  now: number,
): Outcome {
  return op(q, now, (c, log) => {
    const u = c.usage
    u.requests += 1
    u.cacheReadTokens += a.cacheRead
    const rec = a.agentId ? c.agents.find(x => x.id === a.agentId) : undefined
    if (rec) {
      u.agentTokens += a.tokens
      rec.tokens += a.tokens
      rec.steps += 1
      if (a.model) rec.model = a.model
      if (a.effort !== undefined) rec.effort = a.effort
    } else u.mainTokens += a.tokens
    if (a.costUsd !== null) {
      if (u.costStartUsd === null) u.costStartUsd = a.costUsd
      const total = Math.max(0, a.costUsd - u.costStartUsd)
      if (rec) rec.costUsd += Math.max(0, total - u.costUsd)
      u.costUsd = total
    }
    u.ratePercent = a.ratePercent
    for (const m of a.unavailable) if (!u.unavailable.includes(m)) u.unavailable.push(m)
    log.push({ ev: 'usage.request', data: { agentId: a.agentId, role: rec?.role ?? 'maestro', model: a.model ?? null, effort: a.effort ?? null, tokens: a.tokens, cacheRead: a.cacheRead, costUsd: u.costUsd, ratePercent: a.ratePercent } })
  })
}

/** Archivos que la misión escribió de verdad (tras una escritura permitida y realizada). */
export function noteWrites(q: Quest, paths: string[], now: number): Outcome {
  return op(q, now, (c, log) => {
    const fresh = paths.filter(p => !c.filesWritten.includes(p))
    if (!fresh.length) return
    c.filesWritten.push(...fresh)
    log.push({ ev: 'files.written', data: { paths: fresh, total: c.filesWritten.length } })
  })
}

export function progressSummary(q: Quest) {
  const tasks = q.plan?.tasks ?? []
  let passed = 0
  let total = 0
  for (const t of tasks) {
    const p = q.progress[t.id]
    for (const cr of t.criteria) {
      total += 1
      if (p && currentEvidence(p, cr.id)?.verdict === 'PASS') passed += 1
    }
  }
  return { tasksDone: tasks.filter(t => q.progress[t.id]?.status === 'done').length, tasksTotal: tasks.length, criteriaPassed: passed, criteriaTotal: total }
}

/** Siguiente paso permitido, derivado del estado (lo leen la interfaz y el Maestro). */
export function nextStep(q: Quest): string {
  switch (q.state) {
    case 'INTAKE':
    case 'PLANNING':
      return 'Maestro: preparar el plan (o invocar al Archimago) y enviarlo con quest submit_plan'
    case 'AWAITING_APPROVAL':
      return 'Persona: aprobar o rechazar el plan en el diálogo (o /quest-resume para volver a preguntar)'
    case 'DISPATCH': {
      const ready = q.plan?.tasks.find(t => q.progress[t.id]?.status === 'pending' && t.dependsOn.every(d => q.progress[d]?.status === 'done'))
      return ready ? `Maestro: quest start_task ${ready.id} y lanzar guildflow:artifice` : 'Maestro: no hay subtareas listas'
    }
    case 'IMPLEMENTING':
      return q.slot ? `Maestro: lanzar guildflow:artifice para ${q.slot.taskId}` : `Artífice trabajando en ${q.activeTask}`
    case 'VERIFYING':
      return `Mod: ejecutar comprobaciones de ${q.activeTask} (${pendingChecks(q).join(', ') || 'ninguna pendiente'})`
    case 'REVIEWING':
      return q.slot ? `Maestro: lanzar guildflow:paladin para ${q.activeTask}` : q.agents.some(a => a.role === 'paladin' && a.status === 'running') ? `Paladín revisando ${q.activeTask}` : `Maestro: quest start_review para ${q.activeTask}`
    case 'FIXING':
      return `Maestro: quest start_task ${q.activeTask} con la evidencia del fallo`
    case 'DONE':
      return 'Escriba: registrar el resumen'
    case 'LOGGED':
      return 'Misión cerrada; /quest para una nueva'
    case 'PAUSED':
      return 'Persona: /quest-resume para continuar o /quest-halt para detener'
    case 'BLOCKED':
      return 'Persona: /quest-resume (un intento más), replanificar con nueva aprobación o /quest-halt'
    case 'HALTED':
      return q.haltKind === 'safety' ? 'Detenida por seguridad: abrir una misión nueva' : 'Persona: /quest-resume si la causa está resuelta'
  }
}
