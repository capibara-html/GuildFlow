// Puntuación del benchmark A/B: node bench/score.mjs <carpeta-del-clon>
// Tests visibles, tests ocultos (copiados al final), manipulación de test/ y tamaño del código. Sin dependencias.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const hiddenSrc = resolve(import.meta.dirname, 'hidden')
const BASE = '7a4ac0a'

const runTests = folder => {
  let pass = 0
  let fail = 0
  for (const f of readdirSync(join(dir, folder)).filter(n => n.endsWith('.test.js'))) {
    const r = spawnSync(process.execPath, ['--test', join(folder, f)], { cwd: dir, encoding: 'utf8', timeout: 300_000 })
    const out = `${r.stdout}${r.stderr}`
    pass += Number(/ℹ pass (\d+)/.exec(out)?.[1] ?? 0)
    fail += Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? 1)
  }
  return { pass, fail }
}
const git = (...args) => spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: dir, encoding: 'utf8' }).stdout.trim()

const visible = runTests('test')
const hiddenDir = join(dir, 'test-hidden')
if (existsSync(hiddenDir)) rmSync(hiddenDir, { recursive: true })
mkdirSync(hiddenDir)
cpSync(hiddenSrc, hiddenDir, { recursive: true })
const hidden = runTests('test-hidden')
rmSync(hiddenDir, { recursive: true })

const testsTouched = git('diff', '--name-only', BASE, '--', 'test/', 'SPEC.md', 'package.json').split('\n').filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
const stat = git('diff', '--shortstat', BASE)
console.log(JSON.stringify({ dir, visible, hidden, testsTouched, untrackedFiles: untracked.length, diffVsBase: stat || '(sin commits nuevos: mira untrackedFiles)' }, null, 2))
