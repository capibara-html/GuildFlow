import { describe, expect, test } from 'claude-code/testing'

import { appendLog, Conflict, files, loadQuest, redact, saveQuest, storeKey, tampered, writeRun } from '../src/persistence'
import { approved, ROOT } from './fixtures'
import { memIo } from './memio'

const F = files(ROOT)

describe('quest.json', () => {
  test('creación, escritura verificada, lectura y copia en $.store', async () => {
    const m = memIo()
    const saved = await saveQuest(m.io, approved())
    expect(saved.rev).toBe(1)
    expect(JSON.parse(m.files.get(F.quest)!).rev).toBe(1)
    expect((m.store.get(storeKey(ROOT)) as { rev: number }).rev).toBe(1)
    const l = await loadQuest(m.io, ROOT)
    expect(l.source).toBe('store') // $.store manda; el archivo coincide, sin incidencias
    expect(l.problems).toEqual([])
    expect(l.quest?.id).toBe('q-test')
  })

  test('archivo malformado: se recupera de la última copia válida y se informa', async () => {
    const m = memIo()
    await saveQuest(m.io, approved())
    m.files.set(F.quest, '{ roto')
    m.files.delete(F.tmp)
    const l = await loadQuest(m.io, ROOT)
    expect(l.quest?.rev).toBe(1)
    expect(l.source).toBe('store')
    expect(l.problems.join()).toContain('no es válido')
  })

  test('escritura interrumpida (archivo por detrás de $.store): manda $.store y no es manipulación', async () => {
    const m = memIo()
    const q1 = await saveQuest(m.io, approved())
    m.store.set(storeKey(ROOT), { ...q1, rev: 2, state: 'IMPLEMENTING' })
    const l = await loadQuest(m.io, ROOT)
    expect(l.quest?.rev).toBe(2)
    expect(l.problems).toEqual([])
  })

  test('un quest.json o temporal una sola revisión por delante tampoco se cree (lo escribe el mod después de $.store)', async () => {
    for (const path of [F.quest, F.tmp]) {
      const m = memIo()
      const q1 = await saveQuest(m.io, approved())
      m.files.set(path, JSON.stringify({ ...q1, rev: 2, state: 'DONE' }))
      const l = await loadQuest(m.io, ROOT)
      expect(l.quest?.state).toBe('DISPATCH')
      expect(l.problems.join()).toContain('posible manipulación')
    }
  })

  test('otra misión más reciente en disco que la de $.store se trata como manipulación', async () => {
    const m = memIo()
    const q1 = await saveQuest(m.io, approved())
    m.files.set(F.quest, JSON.stringify({ ...q1, id: 'q-falsa', createdAt: q1.createdAt + 1 }))
    expect((await loadQuest(m.io, ROOT)).problems.join()).toContain('posible manipulación')
  })

  test('un error de escritura conserva el estado válido anterior, también en $.store', async () => {
    const m = memIo()
    const q1 = await saveQuest(m.io, approved())
    const bad = memIo({}, undefined, { failWriteOn: /quest\.json$/ })
    for (const [k, v] of m.files) bad.files.set(k, v)
    for (const [k, v] of m.store) bad.store.set(k, v)
    await expect(saveQuest(bad.io, { ...q1, state: 'HALTED' })).rejects.toThrow('EIO')
    const l = await loadQuest(bad.io, ROOT)
    expect(l.quest?.state).toBe('DISPATCH')
    expect(JSON.parse(bad.files.get(F.quest)!).state).toBe('DISPATCH')
  })

  test('un quest.json escrito por otro (más de una revisión por delante o distinto) no se cree: manda $.store', async () => {
    const m = memIo()
    const q1 = await saveQuest(m.io, approved())
    m.files.set(F.quest, JSON.stringify({ ...q1, rev: 9, state: 'DONE' }))
    m.files.delete(F.tmp)
    const l = await loadQuest(m.io, ROOT)
    expect(l.source).toBe('store')
    expect(l.quest?.state).toBe('DISPATCH')
    expect(l.problems.join()).toContain('posible manipulación')
    m.files.set(F.quest, JSON.stringify({ ...q1, state: 'DONE' }))
    expect((await loadQuest(m.io, ROOT)).problems.join()).toContain('posible manipulación')
  })

  test('control optimista: un escritor con revisión antigua se rechaza', async () => {
    const m = memIo()
    const q0 = approved()
    await saveQuest(m.io, q0)
    await expect(saveQuest(m.io, q0)).rejects.toBeInstanceOf(Conflict)
  })

  test('separación entre proyectos: una misión de otro proyecto no se carga', async () => {
    const m = memIo()
    await saveQuest(m.io, { ...approved(), project: 'c:/otro' })
    m.files.set(F.quest, m.files.get('c:/otro/.guildflow/quest.json')!)
    const l = await loadQuest(m.io, ROOT)
    expect(l.quest).toBeNull()
    expect(l.problems.join()).toContain('otro proyecto')
    expect(storeKey('c:/a')).not.toBe(storeKey('c:/b'))
  })

  test('plan alterado fuera del mod tras la aprobación se detecta', () => {
    const q = approved()
    expect(tampered(q)).toBe(false)
    q.plan!.tasks[0].criteria[0].text = 'otro criterio'
    expect(tampered(q)).toBe(true)
  })
})

describe('log.jsonl y runs/', () => {
  test('append-only: las entradas anteriores se conservan en orden', async () => {
    const m = memIo()
    await appendLog(m.io, ROOT, [{ ev: 'a', data: { n: 1 } }], { questId: 'q-test', at: 1 })
    await appendLog(m.io, ROOT, [{ ev: 'b', data: { n: 2 } }, { ev: 'c', data: {} }], { questId: 'q-test', at: 2 })
    const lines = m.files.get(F.log)!.trim().split('\n').map(l => JSON.parse(l) as { ev: string })
    expect(lines.map(l => l.ev)).toEqual(['a', 'b', 'c'])
  })

  test('las evidencias no guardan secretos conocidos', async () => {
    const m = memIo()
    await writeRun(m.io, ROOT, 'run-1-x', { stdout: 'token=abc123 ok sk-ABCDEFGHIJKLMNOPQRSTUV ghp_abcdefghijklmnopqrstuvwxyz0123' })
    const text = m.files.get(`${F.runs}/run-1-x.json`)!
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('sk-ABCDEF')
    expect(text).not.toContain('ghp_')
    expect(redact('password: hunter2')).toBe('password: [REDACTADO]')
  })
})
