// Verificación ejecutada por el mod: run_check (id → argv congelado, sin shell) y diff-scope.
// El modelo solo aporta un identificador; nunca una cadena de comando ni argumentos.
import type { CheckDef, Io, Quest } from '../types'
import { diskMatches } from './persistence'
import { exeName, hash, inside, matchesEntry, normalizeAbs, parseEntry, type PathEntry } from './validation'

export const OUTPUT_LIMIT = 16_000

/** git del mod: sin fsmonitor (que ejecuta un programa configurado por el repositorio) ni paginador. */
export const gitArgv = (args: string[]) => ['git', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...args]

/** Número de tests ejecutados según los formatos habituales; null si la salida no lo dice. */
export function countTests(out: string): number | null {
  const pats: [RegExp, (m: RegExpMatchArray) => number][] = [
    [/^# tests (\d+)/m, m => +m[1]], // node --test (TAP)
    [/ℹ tests (\d+)/, m => +m[1]], // node --test (spec)
    [/Tests:.*?(\d+) total/, m => +m[1]], // jest
    [/Tests\s+.*\((\d+)\)/, m => +m[1]], // vitest
    [/test result: \w+\. (\d+) passed; (\d+) failed/, m => +m[1] + +m[2]], // cargo
    [/(?:(\d+) failed, )?(\d+) passed/, m => +(m[1] ?? 0) + +m[2]], // pytest y similares
    [/\btests: (\d+)/i, m => +m[1]],
  ]
  for (const [re, f] of pats) {
    const m = out.match(re)
    if (m) return f(m)
  }
  return null
}

const firstError = (s: string) =>
  s
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => /error|fail|assert|expected|exception|not ok/i.test(l))
    ?.slice(0, 200) ?? ''

export type RawRun = { exitCode: number | null; stdout: string; stderr: string; error: string | null; timedOut: boolean }
export type Judged = { pass: boolean; tests: number | null; reason: string }

/** Veredicto de una ejecución contra su definición. Un exit 0 sin los tests exigidos falla. */
export function judge(def: CheckDef, r: RawRun): Judged {
  const out = `${r.stdout}\n${r.stderr}`
  const tests = countTests(out)
  if (r.error) return { pass: false, tests, reason: `no se pudo ejecutar: ${r.error}` }
  if (r.timedOut) return { pass: false, tests, reason: `tiempo agotado (${def.timeoutMs} ms)` }
  if (r.exitCode !== def.expectExit) return { pass: false, tests, reason: `código de salida ${r.exitCode} (esperado ${def.expectExit}) ${firstError(out)}`.trim() }
  if (def.minTests > 0 && tests === null) return { pass: false, tests, reason: `la salida no muestra tests ejecutados (mínimo ${def.minTests})` }
  if (def.minTests > 0 && tests !== null && tests < def.minTests) return { pass: false, tests, reason: `${tests} tests ejecutados (mínimo ${def.minTests})` }
  const missing = def.stdoutIncludes.find(s => !r.stdout.includes(s))
  if (missing !== undefined) return { pass: false, tests, reason: `la salida no contiene "${missing}"` }
  return { pass: true, tests, reason: `código ${r.exitCode}${tests !== null ? `, ${tests} tests` : ''}` }
}

/** Ruta real normalizada (resuelve enlaces del ancestro existente más cercano); null si no se puede situar. */
export async function realOf(io: Io, raw: string, cwd: string): Promise<string | null> {
  const norm = normalizeAbs(raw, cwd)
  if (!norm) return null
  const root = norm.slice(0, norm.indexOf('/') + 1)
  let probe = norm
  let rest = ''
  for (let i = 0; i < 64; i++) {
    const st = await io.stat(probe, true).catch(() => undefined)
    if (st) {
      if (!st.realPath) return null
      const base = normalizeAbs(st.realPath, cwd)
      return base ? (rest ? `${base.replace(/\/$/, '')}/${rest}` : base) : null
    }
    const cut = probe.lastIndexOf('/')
    if (cut < 0 || probe.length <= root.length) return null
    rest = rest ? `${probe.slice(cut + 1)}/${rest}` : probe.slice(cut + 1)
    probe = probe.slice(0, cut) || root
    if (probe.endsWith(':')) probe += '/'
  }
  return null
}

/** Huella de las rutas protegidas (archivos o directorios, hasta 300 archivos): detecta cambios en los scripts de verificación. */
export async function fingerprint(io: Io, root: string, protects: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const p of protects) {
    const e = parseEntry(p)
    if (typeof e === 'string') continue
    const abs = `${root}/${e.rel}`
    const parts: string[] = []
    const walk = async (path: string, depth: number) => {
      if (parts.length > 300 || depth > 8) return
      const st = await io.stat(path, false).catch(() => undefined)
      if (!st) return void parts.push(`${path}:missing`)
      if (st.kind === 'dir') {
        const list = await io.list(path)
        for (const it of [...list].sort((a, b) => a.name.localeCompare(b.name))) if (!it.isLink && it.name !== 'node_modules') await walk(`${path}/${it.name}`, depth + 1)
      } else if (st.kind === 'file') parts.push(`${path.slice(root.length)}:${hash(await io.read(path))}`)
    }
    await walk(abs, 0)
    out[p] = hash(parts.join('\n'))
  }
  return out
}

/** Rutas protegidas añadidas automáticamente: archivos citados en argv y manifiestos que definen scripts. */
export async function autoProtects(io: Io, root: string, def: CheckDef): Promise<string[]> {
  const extra = new Set(def.protects)
  for (const a of def.argv.slice(1)) {
    if (a.startsWith('-')) continue
    const e = parseEntry(a)
    if (typeof e === 'string') continue
    const st = await io.stat(`${root}/${e.rel}`, false).catch(() => undefined)
    if (st?.kind === 'file') extra.add(e.rel)
    else if (st?.kind === 'dir') extra.add(`${e.rel}/`)
  }
  if (['node', 'bun', 'deno'].includes(exeName(def.argv[0]))) {
    if (await io.exists(`${root}/package.json`)) extra.add('package.json')
  }
  return [...extra]
}

export type Execution = RawRun & { argv: string[]; cwd: string; durationMs: number; integrity: string | null; judged: Judged }

/** Ejecuta una comprobación declarada. Toda condición no demostrable termina en fallo, nunca en una vía alternativa. */
export async function execute(io: Io, q: Quest, def: CheckDef): Promise<Execution> {
  const root = q.project
  const base: Omit<Execution, 'judged'> = { argv: def.argv, cwd: def.cwd, exitCode: null, stdout: '', stderr: '', error: null, timedOut: false, durationMs: 0, integrity: null }
  const done = (x: Omit<Execution, 'judged'>): Execution => ({ ...x, judged: judge(def, x) })
  if (!q.limits.allowedExecutables.includes(exeName(def.argv[0]))) return done({ ...base, error: `ejecutable no autorizado: ${def.argv[0]}` })
  const cwd = await realOf(io, def.cwd === '.' ? root : `${root}/${def.cwd}`, root)
  if (!cwd || !inside(cwd, root)) return done({ ...base, error: `directorio de trabajo fuera del proyecto: ${def.cwd}` })
  const expected = q.baseline?.protectedHashes ?? {}
  const now = await fingerprint(io, root, def.protects)
  const changed = def.protects.filter(p => expected[p] !== undefined && expected[p] !== now[p])
  if (changed.length) return done({ ...base, error: null, integrity: `definición de la comprobación modificada tras la aprobación: ${changed.join(', ')}`, exitCode: -1, stderr: `integridad: ${changed.join(', ')}` })
  // El código bajo prueba corre con los permisos del usuario (los mods no tienen sandbox de procesos):
  // se comprueba DESPUÉS de cada ejecución que no tocó las rutas protegidas ni el estado del gremio.
  const after = async (x: Omit<Execution, 'judged'>): Promise<Execution> => {
    const post = await fingerprint(io, root, def.protects)
    const touched = def.protects.filter(p => post[p] !== now[p])
    // quest.json se compara con lo último que escribió el propio mod (no antes/después: el mod escribe durante la ejecución)
    const questOk = await diskMatches(io, root)
    const problems = [...(touched.length ? [`la ejecución modificó rutas protegidas: ${touched.join(', ')}`] : []), ...(questOk === false ? ['quest.json no coincide con lo último que escribió el mod'] : [])]
    return done(problems.length ? { ...x, integrity: problems.join('; ') } : x)
  }
  const t0 = await io.now()
  try {
    const r = await io.run(def.argv, { cwd, timeoutMs: def.timeoutMs })
    return after({ ...base, cwd, exitCode: r.exitCode, stdout: r.stdout.slice(0, OUTPUT_LIMIT), stderr: r.stderr.slice(0, OUTPUT_LIMIT), durationMs: (await io.now()) - t0 })
  } catch (err) {
    const durationMs = (await io.now()) - t0
    const timedOut = durationMs >= def.timeoutMs - 100
    return after({ ...base, cwd, error: timedOut ? null : String(err).slice(0, 300), timedOut, durationMs })
  }
}

/** Entradas de `git status --porcelain=v1 -z -uall`: [estado, ruta]. */
export function parsePorcelain(z: string): [string, string][] {
  const out: [string, string][] = []
  const parts = z.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const st = p.slice(0, 2)
    out.push([st, p.slice(3)])
    if (st[0] === 'R' || st[0] === 'C') i++ // el origen del renombrado viene a continuación
  }
  return out
}

export type Scope = { pass: boolean; reason: string; outOfScope: string[]; touched: string[]; diffLines: number | null; files: number }

/**
 * Alcance real: cambios de git desde la línea base (sin lo que ya estaba sucio) ∪ escrituras registradas por el mod.
 * Pasa si todo cae en rutas de subtareas aprobadas, la subtarea activa tocó algo y se respetan los límites.
 */
export async function diffScope(io: Io, q: Quest): Promise<Scope> {
  const root = q.project
  const task = q.plan?.tasks.find(t => t.id === q.activeTask)
  if (!task) return { pass: false, reason: 'no hay subtarea activa', outOfScope: [], touched: [], diffLines: null, files: 0 }
  const allowed: PathEntry[] = q.plan!.tasks.filter(t => t.id === task.id || q.progress[t.id]?.status === 'done').flatMap(t => t.paths.map(p => parseEntry(p) as PathEntry))
  const own = task.paths.map(p => parseEntry(p) as PathEntry)
  const changed = new Set<string>(q.filesWritten)
  const untracked = new Set<string>()
  let gitNote = ''
  let headMoved = false
  const gitRoot = q.baseline?.gitRoot ?? null
  if (gitRoot) {
    const head = await io.run(gitArgv(['rev-parse', 'HEAD']), { cwd: gitRoot, timeoutMs: 30_000 }).catch(() => null)
    headMoved = !!q.baseline?.head && (!head || head.exitCode !== 0 || head.stdout.trim() !== q.baseline.head)
    const st = await io.run(gitArgv(['status', '--porcelain=v1', '-z', '-uall']), { cwd: gitRoot, timeoutMs: 30_000 }).catch(() => null)
    if (!st || st.exitCode !== 0) gitNote = ' (git status no disponible: solo escrituras registradas)'
    else {
      const dirty = new Set(q.baseline!.dirty)
      for (const [code, rel] of parsePorcelain(st.stdout)) {
        if (dirty.has(rel)) continue
        const abs = normalizeAbs(rel, gitRoot)
        if (!abs || !inside(abs, root)) continue
        if (inside(abs, `${root}/.guildflow`)) continue
        changed.add(abs)
        if (code === '??') untracked.add(abs)
      }
    }
  } else gitNote = ' (sin git: solo escrituras registradas)'
  const list = [...changed]
  const outOfScope = list.filter(a => !allowed.some(e => matchesEntry(a, root, e))).map(a => a.slice(root.length + 1))
  const touched = list.filter(a => own.some(e => matchesEntry(a, root, e))).map(a => a.slice(root.length + 1))
  let diffLines: number | null = null
  if (gitRoot && q.baseline?.head && list.length) {
    const rels = list.filter(a => !untracked.has(a)).map(a => a.slice(gitRoot.length + 1))
    let lines = 0
    if (rels.length) {
      const ns = await io.run(gitArgv(['diff', '--no-ext-diff', '--no-textconv', '--numstat', q.baseline.head, '--', ...rels]), { cwd: gitRoot, timeoutMs: 30_000 }).catch(() => null)
      if (ns && ns.exitCode === 0) for (const l of ns.stdout.split('\n')) {
        const [a, d] = l.split('\t')
        lines += (Number(a) || 0) + (Number(d) || 0)
      }
    }
    for (const u of untracked) lines += (await io.read(u).catch(() => '')).split('\n').length
    diffLines = lines
  }
  const problems: string[] = []
  if (headMoved) problems.push('HEAD cambió desde la aprobación (commits o reset durante la misión)')
  if (outOfScope.length) problems.push(`fuera de alcance: ${outOfScope.join(', ')}`)
  if (!touched.length) problems.push(`la subtarea ${task.id} no modificó ninguna de sus rutas`)
  if (list.length > q.limits.maxFilesChanged) problems.push(`${list.length} archivos (> ${q.limits.maxFilesChanged})`)
  if (diffLines !== null && diffLines > q.limits.maxDiffLines) problems.push(`${diffLines} líneas de diff (> ${q.limits.maxDiffLines})`)
  const reason = problems.length ? problems.join('; ') : `alcance correcto: ${touched.join(', ')}; ${diffLines ?? '?'} líneas${gitNote}`
  return { pass: problems.length === 0, reason: `${reason}${problems.length ? gitNote : ''}`, outOfScope, touched, diffLines, files: list.length }
}
