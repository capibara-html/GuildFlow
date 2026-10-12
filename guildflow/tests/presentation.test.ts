import { describe, expect, test } from 'claude-code/testing'

import { agentSpawned, block, recover, startTask } from '../src/machine'
import { actions, APPROVAL_MAX, approvalDialog, approvalText, chronicle, limitColor, liveAgents, personStatus, poseOf, stateLine, statusText, summaryMarkdown } from '../src/presentation'
import { scene, type Pose, type Station } from '../src/sprites'
import { transitionEvent, voice } from '../src/theme'
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
  test('línea de estado: dice si trabaja, si terminó o si necesita a la persona', () => {
    let q = ok(startTask(approved(), 't1', 3))
    expect(stateLine(q, 'sobrio')).toContain('trabajando · Artífice en t1')
    expect(stateLine(q)).toContain('⚒️ La forja trabaja · Artífice en t1 «Corregir sum» (intento 1/3)')
    q = ok(block(q, 'el mismo fallo se repitió', 4))
    expect(stateLine(q, 'sobrio')).toContain('necesita tu decisión · el mismo fallo se repitió')
    expect(stateLine(q)).toContain('⚔️ Encrucijada — necesita tu decisión · el mismo fallo se repitió')
    expect(stateLine({ ...q, state: 'LOGGED' }, 'sobrio')).toContain('completada')
    expect(stateLine({ ...q, state: 'LOGGED' })).toContain('🏆 Misión cumplida')
  })
  test('el progreso sale de la evidencia, no de estimaciones', () => {
    expect(statusText(approved(), 5)).toContain('criterios 0/3')
  })
})

describe('capa temática', () => {
  test('voces: estables por misión y evento, vacías con el tema sobrio', () => {
    expect(voice('gremio', 'review.fail', 'q-1')).toBe(voice('gremio', 'review.fail', 'q-1'))
    expect(voice('gremio', 'review.fail', 'q-1')).toMatch(/^«.+» — el Paladín$/)
    expect(voice('sobrio', 'review.fail', 'q-1')).toBe('')
    expect(voice('gremio', 'inexistente', 'q-1')).toBe('')
  })
  test('cambios de estado que merecen aviso y con qué voz', () => {
    expect(transitionEvent('IMPLEMENTING', 'VERIFYING')).toBe('task.delivered')
    expect(transitionEvent('REVIEWING', 'FIXING')).toBe('review.fail')
    expect(transitionEvent('FIXING', 'BLOCKED')).toBe('blocked')
    expect(transitionEvent('DONE', 'LOGGED')).toBeNull()
    expect(transitionEvent('DISPATCH', 'IMPLEMENTING')).toBeNull()
  })
  test('crónica temática con los datos intactos; sobrio igual que antes', () => {
    const q = approved()
    const g = summaryMarkdown(q, ['run-1-unit.json'], 10)
    expect(g).toContain('# 📜 Crónica de la misión q-test')
    expect(g).toContain('— el Escriba')
    expect(g).toContain('## ⚒️ Encargos (subtareas)')
    expect(g).toContain('run-1-unit.json')
    const plain = summaryMarkdown(q, ['run-1-unit.json'], 10, 'sobrio')
    expect(plain).toContain('# Misión q-test')
    expect(plain).not.toContain('Crónica')
  })
  test('el diálogo temático no recorta el plan: contiene el texto llano entero', () => {
    const q = planned()
    const plain = approvalText(q.id, q.plan!, LIMITS)!
    const d = approvalDialog('gremio', q, plain)
    expect(d).toContain(plain.replace(/¿Apruebas el plan\?$/, ''))
    expect(d).toContain('Sellar el pergamino')
    expect(approvalDialog('sobrio', q, plain)).toBe(plain)
  })
  test('/quest-status para la persona: cabecera temática + el mismo estado llano que lee el Maestro', () => {
    const q = approved()
    expect(personStatus('gremio', q, 5)).toContain(statusText(q, 5))
    expect(personStatus('gremio', q, 5).split('\n')[0]).toContain('🏛️')
    expect(personStatus('sobrio', q, 5)).toBe(statusText(q, 5))
  })
})

describe('tablón pixel art', () => {
  test('pose de cada puesto según datos reales: agente en curso, espera a la persona, reposo', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    expect(poseOf(q, 'artifice')).toBe('work')
    expect(poseOf(q, 'paladin')).toBe('rest')
    expect(poseOf(q, 'maestro')).toBe('rest')
    expect(poseOf(ok(recover(q, 4)), 'artifice')).toBe('rest')
    expect(poseOf(planned(), 'maestro')).toBe('alert')
    expect(poseOf(ok(block(q, 'x', 4)), 'maestro')).toBe('alert')
  })
  test('escena: SVG acotado aun con todo el gremio animado, sin script; SMIL solo con faena animada', () => {
    const all = (p: Pose) => ({ maestro: p, archimago: p, artifice: p, paladin: p, escriba: p }) as Record<Station, Pose>
    for (const p of ['work', 'rest', 'alert'] as Pose[])
      for (const a of [true, false]) {
        const svg = scene(all(p), a)
        expect(svg.length).toBeLessThan(131072)
        expect(svg).not.toMatch(/script|on[a-z]+=/i)
        expect(svg.includes('<animate')).toBe(p === 'work' && a)
      }
    expect(scene({ ...all('rest'), maestro: 'alert' }, true)).not.toBe(scene(all('rest'), true))
  })
})

describe('panel', () => {
  test('bitácora: solo eventos que cuentan algo a la persona', () => {
    expect(chronicle('check.recorded', { checkId: 'unit', pass: false }, 1)).toEqual({ at: 1, text: 'Comprobación unit: FAIL' })
    expect(chronicle('agent.spawned', { role: 'paladin', taskId: 't1' }, 2)?.text).toBe('Paladín entra en t1')
    expect(chronicle('state', { to: 'BLOCKED', reason: 'mismo fallo' }, 3)?.text).toBe('BLOCKED: mismo fallo')
    expect(chronicle('state', { to: 'REVIEWING' }, 3)).toBeNull()
    expect(chronicle('usage.request', {}, 4)).toBeNull()
    expect(chronicle('tool.call', {}, 4)).toBeNull()
  })
  test('acciones: los mismos caminos que los comandos', () => {
    const q = ok(startTask(approved(), 't1', 3))
    expect(actions(q)).toEqual({ halt: true, resume: null })
    expect(actions(planned())).toEqual({ halt: true, resume: 'approve' })
    expect(actions(ok(block(q, 'x', 4)))).toEqual({ halt: true, resume: 'resume' })
    expect(actions({ ...q, state: 'HALTED', haltKind: 'safety' })).toEqual({ halt: false, resume: null })
    expect(actions({ ...q, state: 'LOGGED' })).toEqual({ halt: false, resume: null })
    expect(actions(null)).toEqual({ halt: false, resume: null })
  })
  test('medidores de límites: azul, ámbar desde 70 %, rojo desde 90 %', () => {
    expect(limitColor(0.5)).toBe('#6fa8f5')
    expect(limitColor(0.7)).toBe('#e67e22')
    expect(limitColor(0.95)).toBe('#e74c3c')
  })
})
