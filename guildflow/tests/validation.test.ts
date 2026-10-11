import { describe, expect, test } from 'claude-code/testing'

import { limitsFrom, normalizeAbs, parseEntry, readOnlyShell, sensitiveCommand, validatePlan } from '../src/validation'
import { LIMITS, RAW_PLAN } from './fixtures'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const errorsOf = (raw: unknown) => {
  const r = validatePlan(raw, LIMITS)
  return r.ok ? [] : r.errors
}

describe('normalización de rutas', () => {
  const cwd = 'C:\\Repo\\Proj'
  test('relativas, absolutas, separadores de Windows y mayúsculas', () => {
    expect(normalizeAbs('src\\A.ts', cwd)).toBe('c:/repo/proj/src/a.ts')
    expect(normalizeAbs('C:/Repo/Proj/./src//a.ts', cwd)).toBe('c:/repo/proj/src/a.ts')
    expect(normalizeAbs('/c/Repo/Proj/src/a.ts', cwd)).toBe('c:/repo/proj/src/a.ts')
  })
  test('traversal se colapsa y no puede subir por encima de la raíz', () => {
    expect(normalizeAbs('src/../../otro/x', cwd)).toBe('c:/repo/otro/x')
    expect(normalizeAbs('../../../../../x', cwd)).toBeNull()
  })
  test('formas que no pueden situarse con seguridad se rechazan', () => {
    for (const bad of ['', '~/x', '\\\\server\\share\\x', '//?/c:/x', 'C:foo', '/raiz-de-unidad', 'src/a.ts:secreto', 'src/a.ts.', 'src/a.ts ', 'a\0b', 'src/*.ts', 42, null])
      expect(normalizeAbs(bad, cwd)).toBeNull()
  })
  test('POSIX conserva mayúsculas', () => {
    expect(normalizeAbs('Src/A.ts', '/home/u/p')).toBe('/home/u/p/Src/A.ts')
  })
  test('entradas del plan: archivo o directorio, sin comodines, sin .., sin rutas reservadas', () => {
    expect(parseEntry('src/auth/**')).toEqual({ rel: 'src/auth', dir: true })
    expect(parseEntry('./src/a.ts')).toEqual({ rel: 'src/a.ts', dir: false })
    for (const bad of ['src/*.ts', '../x', 'src/../x', 'C:/x', '/x', '.guildflow/quest.json', '.git/', '.', '', 'a:b'])
      expect(typeof parseEntry(bad)).toBe('string')
  })
})

describe('validación del plan', () => {
  test('el plan de referencia es válido y añade el criterio de alcance', () => {
    const r = validatePlan(RAW_PLAN, LIMITS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.tasks[0].criteria.map(c => c.check)).toEqual(['check:unit', 'review', 'diff-scope'])
  })
  test('criterio sin método verificable o con comprobación no declarada impide aprobar', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks[0].criteria[0].check = undefined
    expect(errorsOf(a).join()).toContain('sin método verificable')
    const b = clone(RAW_PLAN) as Record<string, any>
    b.tasks[0].criteria[0].check = 'check:nope'
    expect(errorsOf(b).length).toBeGreaterThan(0)
  })
  test('cada subtarea necesita una revisión independiente', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks[0].criteria = [a.tasks[0].criteria[0]]
    expect(errorsOf(a).join()).toContain('review')
  })
  test('el Artífice no puede tener concedidas las rutas que definen su comprobación', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks[0].paths = ['src/math.js', 'test/']
    expect(errorsOf(a).join()).toContain('define la comprobación')
  })
  test('campos desconocidos, ejecutables no autorizados, scripts de shell y comandos sensibles', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.autoApprove = true
    expect(errorsOf(a).join()).toContain('campo inesperado')
    for (const argv of [['powershell', '-c', 'x'], ['test.cmd'], ['git', 'push'], ['node', 'x.js', '&&', 'rm', '-rf', '/']]) {
      const b = clone(RAW_PLAN) as Record<string, any>
      b.checks[0].argv = argv
      expect(errorsOf(b).length).toBeGreaterThan(0)
    }
  })
  test('worktrees y roles distintos del Artífice se rechazan', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks[0].isolation = 'worktree'
    a.tasks[0].role = 'paladin'
    const e = errorsOf(a).join()
    expect(e).toContain('worktrees')
    expect(e).toContain('artifice')
  })
  test('dependencias solo hacia subtareas anteriores (sin ciclos)', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks[0].dependsOn = ['t2']
    a.tasks.push({ ...clone(a.tasks[0]), id: 't2', dependsOn: ['t1'], paths: ['src/b.js'] })
    expect(errorsOf(a).join()).toContain('declarada antes')
  })
  test('rutas solapadas entre subtareas: aviso de ejecución en serie', () => {
    const a = clone(RAW_PLAN) as Record<string, any>
    a.tasks.push({ ...clone(a.tasks[0]), id: 't2', paths: ['src/'] })
    const r = validatePlan(a, LIMITS)
    expect(r.ok && r.warnings.join()).toContain('en serie')
  })
  test('entrada malformada', () => {
    for (const raw of [null, 'plan', [], { tasks: 'x' }]) expect(validatePlan(raw, LIMITS).ok).toBe(false)
  })
})

describe('comandos y límites', () => {
  test('clasificador de comandos sensibles', () => {
    for (const c of ['git push origin main', 'npm install left-pad', 'rm -rf build', 'Remove-Item x', 'curl http://x', 'pnpm publish', 'setx PATH x'])
      expect(sensitiveCommand(c)).not.toBeNull()
    expect(sensitiveCommand('git status')).toBeNull()
  })
  test('shell de solo lectura del Maestro sin metacaracteres', () => {
    expect(readOnlyShell('git status --short')).toBe(true)
    expect(readOnlyShell('git log --oneline -n5')).toBe(true)
    // flags con efectos (escribir archivos, ejecutar drivers externos) y diff/show (textconv) piden permiso
    for (const c of ['git diff --output=x.txt', 'git diff HEAD', 'git show HEAD', 'git log --ext-diff -p', 'git log --format=%x00', 'git status --porcelain --output=x', 'ls --hide-control-chars=x'])
      expect(readOnlyShell(c)).toBe(false)
    for (const c of ['git status; rm -rf x', 'git log | sh', 'echo $(whoami)', 'node x.js', 'git push'])
      expect(readOnlyShell(c)).toBe(false)
  })
  test('userConfig se acota a los topes del plugin', () => {
    const l = limitsFrom({ maxAttemptsPerTask: 999, maxConcurrentAgents: 50, tokenBudgetPerQuest: -1, allowedExecutables: 'node, EVIL.cmd ,git' })
    expect(l.maxAttemptsPerTask).toBe(10)
    expect(l.maxConcurrentAgents).toBe(3)
    expect(l.tokenBudgetPerQuest).toBe(10_000)
    expect(l.allowedExecutables).toEqual(['node', 'git'])
    expect(limitsFrom({}).maxDiffLines).toBe(1500)
  })
})
