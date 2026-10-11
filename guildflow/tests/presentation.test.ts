import { describe, expect, test } from 'claude-code/testing'

import { agentSpawned, recover, startTask } from '../src/machine'
import { APPROVAL_MAX, approvalText, liveAgents, statusText } from '../src/presentation'
import { agent, approved, LIMITS, ok, planned } from './fixtures'

describe('diálogo de aprobación', () => {
  test('muestra todas las rutas y el argv completo', () => {
    const q = planned()
    const t = approvalText(q.id, q.plan!, LIMITS)!
    expect(t).toContain('src/math.js')
    expect(t).toContain('["node","--test","test/"]')
  })
  test('un plan que no cabe completo no se presenta recortado: se rechaza', () => {
    const q = planned()
    const plan = { ...q.plan!, tasks: [{ ...q.plan!.tasks[0], paths: Array.from({ length: 30 }, (_, i) => `src/modulo-con-nombre-largo-${i}/`) }], checks: [{ ...q.plan!.checks[0], argv: ['node', 'x'.repeat(APPROVAL_MAX)] }] }
    expect(approvalText(q.id, plan, LIMITS)).toBeNull()
  })
})

describe('estado mostrado', () => {
  test('sin agentes fantasma: los perdidos no aparecen como activos', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    expect(liveAgents(q).length).toBe(1)
    q = ok(recover(q, 4))
    expect(liveAgents(q).length).toBe(0)
    const s = statusText(q, 5)
    expect(s).toContain('Agentes activos: ninguno')
    expect(s).toContain('Agentes perdidos: artifice a')
  })
  test('el progreso sale de la evidencia, no de estimaciones', () => {
    expect(statusText(approved(), 5)).toContain('criterios 0/3')
  })
})
