import { describe, expect, test } from 'claude-code/testing'

import type { Quest } from '../types'
import { agentFinished, agentSpawned, block, halt, pause, recover, startTask } from '../src/machine'
import { TOOL } from '../src/policy'
import { actions, APPROVAL_MAX, budgetRatio, cast, doing, withEscriba, approvalDialog, approvalText, chronicle, limitColor, limitLabel, liveAgents, personStatus, stateLine, statusText, summaryMarkdown } from '../src/presentation'
import { animates, scene, type Pose, type SceneView, type Station } from '../src/sprites'
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
    const plan = { ...q.plan!, tasks: [{ ...q.plan!.tasks[0]!, paths: Array.from({ length: 30 }, (_, i) => `src/modulo-con-nombre-largo-${i}/`) }], checks: [{ ...q.plan!.checks[0]!, argv: ['node', 'x'.repeat(APPROVAL_MAX)] }] }
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

describe('oficina pixel art: poses con datos reales', () => {
  const withTool = (q: Quest, id: string, tool: string): Quest => ({ ...q, agents: q.agents.map(a => (a.id === id ? { ...a, lastTool: tool } : a)) })
  const poses = (q: Quest | null) => cast(q, 0).poses
  test('sin misión todo el gremio en reposo y nada se anima', () => {
    const v = cast(null, 5)
    expect(Object.values(v.poses).every(p => p === 'idle')).toBe(true)
    expect(v).toMatchObject({ notes: [], plaque: 'none', sheets: 0, treasure: 0 })
    expect(animates(v)).toBe(false)
  })
  test('planificación: el Maestro estudia; con el Archimago en curso, piensa él (o lee, si su última herramienta es Read)', () => {
    const p = { ...planned(), state: 'PLANNING' as const, plan: null }
    expect(poses(p).maestro).toBe('thinking')
    const a = ok(agentSpawned(p, agent('m', 'archimago', null), 1))
    expect(poses(a)).toMatchObject({ maestro: 'idle', archimago: 'thinking' })
    expect(poses(withTool(a, 'm', 'Read')).archimago).toBe('working')
  })
  test('aprobación pendiente: el Maestro te espera; los demás no trabajan', () => {
    expect(poses(planned())).toMatchObject({ maestro: 'awaiting', artifice: 'idle', paladin: 'idle' })
    expect(cast(planned(), 0).plaque).toBe('awaiting')
  })
  test('Artífice: forja con su agente en curso, prueba la pieza tras run_check; el Maestro espera', () => {
    let q = ok(startTask(approved(), 't1', 3))
    expect(poses(q).artifice).toBe('idle') // sin agente lanzado no trabaja nadie
    expect(poses(q).maestro).toBe('working')
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    expect(poses(q)).toMatchObject({ artifice: 'working', maestro: 'idle', paladin: 'idle' })
    expect(poses(withTool(q, 'a', TOOL.runCheck)).artifice).toBe('reviewing')
  })
  test('Paladín: revisa con su agente en curso; con run_check pone a prueba', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = { ...q, state: 'REVIEWING', progress: { ...q.progress, t1: { ...q.progress.t1!, status: 'reviewing' } }, agents: [agent('p', 'paladin', 't1')] }
    expect(poses(q).paladin).toBe('reviewing')
    expect(poses(withTool(q, 'p', TOOL.runCheck)).paladin).toBe('working')
    expect(cast(q, 0).notes).toEqual([{ state: 'review', current: true }])
  })
  test('un agente perdido tras reiniciar nunca aparece trabajando ni anima la escena', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(recover(q, 4))
    const v = cast(q, 0)
    expect(v.poses.artifice).toBe('lost')
    expect(animates(v)).toBe(false)
    expect(doing('artifice', 'lost')).toContain('no trabaja')
  })
  test('bloqueo: el Maestro y el puesto del último agente de la subtarea lo muestran; la placa también', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(agentFinished(q, 'a', { reason: 'answer', partial: false }, 4))
    const b = ok(block(q, 'el mismo fallo se repitió', 5))
    expect(poses(b)).toMatchObject({ maestro: 'blocked', artifice: 'blocked', paladin: 'idle' })
    expect(cast(b, 0).plaque).toBe('blocked')
  })
  test('pausa y detención: nadie trabaja aunque un agente siga cerrando', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    const h = ok(halt(q, 'user', 'detenida por la persona', 4))
    expect(poses(h)).toMatchObject({ maestro: 'idle', artifice: 'idle' })
    expect(cast(h, 0).plaque).toBe('halted')
    expect(poses(ok(halt(q, 'limit', 'tokens', 4))).maestro).toBe('blocked')
    expect(cast(ok(pause(q, 'turno interrumpido', 4)), 0).plaque).toBe('paused')
  })
  test('misión cumplida: celebran quienes participaron; el Escriba escribe la crónica y luego la cierra', () => {
    let q = ok(startTask(approved(), 't1', 3))
    q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
    q = ok(agentFinished(q, 'a', { reason: 'answer', partial: false }, 4))
    const done = { ...q, state: 'DONE' as const }
    expect(poses(done)).toMatchObject({ maestro: 'success', artifice: 'success', archimago: 'idle', escriba: 'working' })
    expect(poses({ ...done, state: 'LOGGED' }).escriba).toBe('success')
    expect(cast(done, 0).plaque).toBe('done')
  })
  test('tablón, crónica y cofre: una nota por subtarea, una hoja por evento (hasta 6), monedas por consumo real', () => {
    const q = ok(startTask(approved(), 't1', 3))
    expect(cast(q, 0).notes).toEqual([{ state: 'active', current: true }])
    expect(cast(q, 9).sheets).toBe(6)
    expect(cast(q, 0).treasure).toBe(0)
    const spend = (t: number) => ({ ...q, usage: { ...q.usage, agentTokens: t } })
    const B = q.limits.tokenBudgetPerQuest
    expect([0.1, 0.5, 0.75, 0.95].map(r => cast(spend(B * r), 0).treasure)).toEqual([1, 2, 3, 4])
    expect(budgetRatio({ ...q, usage: { ...q.usage, costStartUsd: 0, costUsd: q.limits.costBudgetUsd } })).toBe(1)
  })
})

describe('oficina pixel art: SVG', () => {
  const all = (p: Pose) => ({ maestro: p, archimago: p, artifice: p, paladin: p, escriba: p }) as Record<Station, Pose>
  const states = ['pending', 'active', 'checking', 'review', 'queued', 'done', 'blocked', 'done'] as const
  const view = (p: Pose): SceneView => ({ poses: all(p), notes: states.map((state, i) => ({ state, current: i === 1 })), plaque: 'working', sheets: 6, treasure: 4 })
  test('acotado aun con todo el gremio animado y el tablón lleno; sin script; SMIL solo si algo trabaja', () => {
    for (const p of ['idle', 'working', 'thinking', 'reviewing', 'success', 'blocked', 'lost', 'awaiting'] as Pose[])
      for (const a of [true, false]) {
        const svg = scene(view(p), a)
        expect(svg.length).toBeLessThan(131072)
        expect(svg).not.toMatch(/script|on[a-z]+=|href/i)
        expect(svg.includes('<animate')).toBe(a && animates(view(p)))
      }
    expect(animates(view('idle'))).toBe(false)
    expect(animates(view('blocked'))).toBe(false)
    expect(animates(view('working'))).toBe(true)
  })
  test('cada estado cambia el dibujo; la misma vista se reutiliza sin recomponer', () => {
    const base = view('idle')
    const svg = scene(base, true)
    expect(scene({ ...base }, true)).toBe(svg)
    for (const p of ['working', 'thinking', 'reviewing', 'success', 'blocked', 'lost'] as Pose[]) expect(scene({ ...base, poses: { ...base.poses, artifice: p } }, false)).not.toBe(scene(base, false))
    expect(scene({ ...base, poses: { ...base.poses, maestro: 'awaiting' } }, false)).not.toBe(scene(base, false))
    expect(scene({ ...base, plaque: 'blocked' }, false)).not.toBe(scene(base, false))
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
    expect([0.5, 0.7, 0.95].map(limitLabel)).toEqual(['', ' · elevado', ' · cerca del límite'])
  })
})

describe('Escriba con modelo', () => {
  test('el resumen va arriba, marcado como generado, y los datos de la crónica no cambian', () => {
    const md = summaryMarkdown(approved(), ['run-1-unit.json'], 10)
    const out = withEscriba(md, '# Título falso\nSe corrigió sum y pasan los tests.', 1234)
    expect(out).toContain('## 🪶 Resumen del Escriba')
    expect(out).toContain('Redactado por Haiku')
    expect(out).toContain('1k tokens')
    expect(out).not.toContain('# Título falso') // sin encabezados inyectados
    expect(out.indexOf('Resumen del Escriba')).toBeLessThan(out.indexOf('- **Resultado:**'))
    expect(out.replace(/\n## 🪶 Resumen del Escriba[\s\S]*?mandan los datos\._\n/, '')).toBe(md)
    expect(withEscriba(md, '   ', 5)).toBe(md)
  })
})
