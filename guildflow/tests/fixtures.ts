// Fixtures compartidas por las pruebas: un plan válido y una misión llevada hasta un estado dado.
import type { Quest } from '../types'
import { approve, createQuest, submitPlan, type Outcome } from '../src/machine'
import { limitsFrom, validatePlan } from '../src/validation'

export const LIMITS = limitsFrom({})
export const ROOT = 'c:/repo'

export const RAW_PLAN = {
  objective: 'Arreglar suma',
  scope: 'src/math.js',
  complexity: 'small',
  checks: [{ id: 'unit', argv: ['node', '--test', 'test/'], minTests: 1, protects: ['test/'] }],
  tasks: [
    {
      id: 't1',
      title: 'Corregir sum',
      description: 'sum(a,b) debe devolver a+b',
      paths: ['src/math.js'],
      doneWhen: 'tests en verde y revisión aprobada',
      criteria: [
        { id: 'c1', text: 'Los tests unitarios pasan', check: 'check:unit' },
        { id: 'c2', text: 'El código es claro y sin efectos laterales', check: 'review' },
      ],
    },
  ],
}

export function ok(o: Outcome): Quest {
  if (!o.ok) throw new Error(`se esperaba ok: ${o.error}`)
  return o.quest
}

export function planned(raw: unknown = RAW_PLAN): Quest {
  const v = validatePlan(raw, LIMITS)
  if (!v.ok) throw new Error(v.errors.join('; '))
  const q = ok(createQuest({ id: 'q-test', request: 'arregla la suma', project: ROOT, sessionId: 's1', limits: LIMITS, now: 0 }))
  return ok(submitPlan(q, v.plan, 1))
}

export function approved(raw: unknown = RAW_PLAN): Quest {
  return ok(approve(planned(raw), { by: 'human', answer: 'Aprobar', baseline: { gitRoot: null, head: null, dirty: [], protectedHashes: {} } }, 2))
}

export const agent = (id: string, role: 'archimago' | 'artifice' | 'paladin', taskId: string | null) => ({
  id,
  role,
  taskId,
  status: 'running' as const,
  model: 'm',
  effort: null,
  steps: 0,
  tokens: 0,
  costUsd: 0,
  startedAt: 0,
  endedAt: null,
  partial: false,
  lastTool: null,
})

export const run = (checkId: string, pass: boolean, taskId = 't1') => ({
  runId: `run-${checkId}-${pass}`,
  checkId,
  taskId,
  certifying: true,
  pass,
  exitCode: pass ? 0 : 1,
  tests: 1,
  reason: pass ? 'ok' : 'exit 1',
  at: 0,
})
