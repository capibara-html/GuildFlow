import { describe, expect, test } from 'claude-code/testing'

import type { CheckDef, Quest } from '../types'
import { agentSpawned, startTask } from '../src/machine'
import { saveQuest } from '../src/persistence'
import { countTests, diffScope, execute, fingerprint, judge, parsePorcelain, realOf } from '../src/verification'
import { agent, approved, ok, ROOT } from './fixtures'
import { memIo } from './memio'

const DEF: CheckDef = { id: 'unit', argv: ['node', '--test', 'test/'], cwd: '.', expectExit: 0, timeoutMs: 5000, minTests: 1, stdoutIncludes: [], protects: ['test/'] }
const raw = (over: Partial<Parameters<typeof judge>[1]>) => ({ exitCode: 0, stdout: '', stderr: '', error: null, timedOut: false, ...over })

function implementing(): Quest {
  let q = ok(startTask(approved(), 't1', 3))
  q = ok(agentSpawned(q, agent('a', 'artifice', 't1'), 3))
  return q
}

describe('juicio de una ejecución', () => {
  test('conteo de tests en formatos habituales', () => {
    expect(countTests('# tests 4\n# pass 4')).toBe(4)
    expect(countTests('ℹ tests 2')).toBe(2)
    expect(countTests('Tests:       1 failed, 3 passed, 4 total')).toBe(4)
    expect(countTests('==== 1 failed, 2 passed in 0.1s')).toBe(3)
    expect(countTests('nada')).toBeNull()
  })
  test('exit 0 sin tests cuando se exigía al menos uno → FAIL', () => {
    const j = judge(DEF, raw({ stdout: 'ok' }))
    expect(j.pass).toBe(false)
    expect(j.reason).toContain('no muestra tests')
    expect(judge(DEF, raw({ stdout: '# tests 0' })).pass).toBe(false)
  })
  test('código de salida incorrecto, tiempo agotado y fallo de arranque', () => {
    expect(judge(DEF, raw({ exitCode: 1, stdout: '# tests 3\nnot ok 1 - suma' })).reason).toContain('código de salida 1')
    expect(judge(DEF, raw({ timedOut: true })).pass).toBe(false)
    expect(judge(DEF, raw({ error: 'ENOENT' })).pass).toBe(false)
    expect(judge(DEF, raw({ stdout: '# tests 3' })).pass).toBe(true)
  })
})

describe('ejecución controlada', () => {
  const seed = { [`${ROOT}/test/math.test.js`]: 'test()', [`${ROOT}/src/math.js`]: 'x' }

  test('ejecuta exactamente el argv congelado, sin shell, en la raíz', async () => {
    const m = memIo(seed, () => ({ exitCode: 0, stdout: '# tests 1', stderr: '' }))
    const q = implementing()
    q.plan!.checks[0]!.protects = ['test/']
    const x = await execute(m.io, q, q.plan!.checks[0]!)
    expect(x.judged.pass).toBe(true)
    expect(m.runs).toEqual([{ argv: ['node', '--test', 'test/'], cwd: ROOT }])
  })

  test('tiempo agotado → FAIL sin vía alternativa', async () => {
    const m = memIo(seed, () => 'timeout')
    const q = implementing()
    const x = await execute(m.io, q, { ...q.plan!.checks[0]!, timeoutMs: 1000 })
    expect(x.timedOut).toBe(true)
    expect(x.judged.pass).toBe(false)
    expect(m.runs.length).toBe(1)
  })

  test('ejecutable no autorizado no llega a ejecutarse', async () => {
    const m = memIo(seed)
    const x = await execute(m.io, implementing(), { ...DEF, argv: ['powershell', '-c', 'rm -r .'] })
    expect(x.judged.pass).toBe(false)
    expect(m.runs.length).toBe(0)
  })

  test('un script de verificación modificado tras la aprobación invalida la comprobación', async () => {
    const m = memIo(seed, () => ({ exitCode: 0, stdout: '# tests 1', stderr: '' }))
    const q = implementing()
    q.baseline!.protectedHashes = await fingerprint(m.io, ROOT, ['test/'])
    m.files.set(`${ROOT}/test/math.test.js`, 'test.skip()')
    const x = await execute(m.io, q, DEF)
    expect(x.integrity).toContain('modificada')
    expect(m.runs.length).toBe(0)
  })

  test('el código bajo prueba que reescribe su test o quest.json durante la ejecución invalida el resultado', async () => {
    for (const victim of [`${ROOT}/test/math.test.js`, `${ROOT}/.guildflow/quest.json`]) {
      const box: { files?: Map<string, string> } = {}
      const m = memIo(seed, () => {
        box.files!.set(victim, 'manipulado')
        return { exitCode: 0, stdout: '# tests 1', stderr: '' }
      })
      box.files = m.files
      const q = await saveQuest(m.io, implementing())
      q.baseline!.protectedHashes = await fingerprint(m.io, ROOT, ['test/'])
      const x = await execute(m.io, q, DEF)
      expect(x.integrity).toMatch(/modificó rutas protegidas|no coincide con lo último/)
      expect(x.judged.pass).toBe(true) // el juez de salida no basta: register.tsx combina judged.pass && !integrity
    }
  })

  test('regresión: el propio mod guardando quest.json durante la ejecución NO es manipulación', async () => {
    const box: { io?: Parameters<typeof execute>[0]; q?: Quest } = {}
    const m = memIo(seed, () => {
      void saveQuest(box.io!, { ...box.q!, iterations: 2 }) // escritura concurrente legítima (contabilidad)
      return { exitCode: 0, stdout: '# tests 1', stderr: '' }
    })
    box.io = m.io
    box.q = await saveQuest(m.io, implementing())
    const x = await execute(m.io, box.q, DEF)
    expect(x.integrity).toBeNull()
    expect(x.judged.pass).toBe(true)
  })

  test('directorio de trabajo que escapa del proyecto por un enlace', async () => {
    const m = memIo({ ...seed, 'c:/fuera/x': '1' }, undefined, { links: { [`${ROOT}/link`]: 'c:/fuera' } })
    const x = await execute(m.io, implementing(), { ...DEF, cwd: 'link' })
    expect(x.error).toContain('fuera del proyecto')
    expect(m.runs.length).toBe(0)
  })
})

describe('rutas reales', () => {
  test('un archivo nuevo dentro de un enlace se sitúa en el destino real', async () => {
    const m = memIo({ 'c:/fuera/a': '1', [`${ROOT}/src/math.js`]: 'x' }, undefined, { links: { [`${ROOT}/src/link`]: 'c:/fuera' } })
    expect(await realOf(m.io, `${ROOT}/src/link/nuevo.ts`, ROOT)).toBe('c:/fuera/nuevo.ts')
    expect(await realOf(m.io, 'src/nuevo/dir/x.ts', ROOT)).toBe(`${ROOT}/src/nuevo/dir/x.ts`)
    expect(await realOf(m.io, '..\\x', ROOT)).toBe('c:/x')
    expect(await realOf(m.io, '..\\..\\x', ROOT)).toBeNull()
    expect(await realOf(m.io, '\\\\server\\share', ROOT)).toBeNull()
  })
})

describe('diff-scope', () => {
  const git = (status: string) => (argv: readonly string[]) =>
    argv.includes('status')
      ? { exitCode: 0, stdout: status, stderr: '' }
      : argv.includes('diff')
        ? { exitCode: 0, stdout: '3\t1\tsrc/math.js\n', stderr: '' }
        : argv.includes('rev-parse')
          ? { exitCode: 0, stdout: 'abc\n', stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' }
  const withGit = (q: Quest) => {
    q.baseline = { gitRoot: ROOT, head: 'abc', dirty: ['notes.txt'], protectedHashes: {} }
    return q
  }
  test('porcelain -z con renombrados', () => {
    expect(parsePorcelain(' M a.js\0R  new.js\0old.js\0?? b.js\0')).toEqual([[' M', 'a.js'], ['R ', 'new.js'], ['??', 'b.js']])
  })
  test('cambios dentro de la ruta de la subtarea → PASS; lo sucio de antes no cuenta', async () => {
    const m = memIo({}, git(' M src/math.js\0 M notes.txt\0?? .guildflow/quest.json\0'))
    const s = await diffScope(m.io, withGit(implementing()))
    expect(s.pass).toBe(true)
    expect(s.diffLines).toBe(4)
  })
  test('un archivo fuera de alcance → FAIL', async () => {
    const m = memIo({}, git(' M src/math.js\0 M README.md\0'))
    const s = await diffScope(m.io, withGit(implementing()))
    expect(s.pass).toBe(false)
    expect(s.outOfScope).toEqual(['readme.md']) // NTFS: rutas normalizadas en minúsculas
  })
  test('HEAD movido desde la aprobación (commit que esconde el diff) → FAIL', async () => {
    const m = memIo({}, (argv: readonly string[]) => (argv.includes('rev-parse') ? { exitCode: 0, stdout: 'otro\n', stderr: '' } : git(' M src/math.js\0')(argv)))
    const s = await diffScope(m.io, withGit(implementing()))
    expect(s.reason).toContain('HEAD cambió')
  })
  test('git del mod sin fsmonitor ni drivers externos', async () => {
    const m = memIo({}, git(' M src/math.js\0'))
    await diffScope(m.io, withGit(implementing()))
    for (const r of m.runs) expect(r.argv.slice(0, 3)).toEqual(['git', '-c', 'core.fsmonitor=false'])
    expect(m.runs.find(r => r.argv.includes('diff'))?.argv).toContain('--no-textconv')
  })
  test('diff vacío → FAIL (la subtarea no hizo nada)', async () => {
    const m = memIo({}, git(''))
    expect((await diffScope(m.io, withGit(implementing()))).reason).toContain('no modificó')
  })
  test('exceso de líneas → FAIL', async () => {
    const m = memIo({}, git(' M src/math.js\0'))
    const q = withGit(implementing())
    q.limits.maxDiffLines = 2
    expect((await diffScope(m.io, q)).pass).toBe(false)
  })
})
