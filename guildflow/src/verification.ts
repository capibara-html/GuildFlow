// Verificación ejecutada por el mod: run_check (id → argv congelado, sin shell) y diff-scope.
// El modelo solo aporta un identificador; nunca una cadena de comando ni argumentos.
import type { CheckDef, Io, Quest } from '../types'
import { diskMatches } from './persistence'
import { exeName, hash, inside, matchesEntry, normalizeAbs, parseEntry, pathsOverlap, type PathEntry } from './validation'

export const OUTPUT_LIMIT = 16_000

/** git del mod: sin fsmonitor (que ejecuta un programa configurado por el repositorio) ni paginador. */
export const gitArgv = (args: string[]) => ['git', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...args]

/** Ejecutable de una comprobación (validatePlan exige al menos uno); sin él no se ejecuta ni se protege nada. */
function argv0(def: CheckDef): string {
  const a = def.argv[0]
  if (a === undefined) throw new Error('comprobación sin ejecutable')
  return a
}

/**
 * argv de `docker run` para una comprobación: sin red ni privilegios, usuario nobody, raíz del contenedor y proyecto
 * de solo lectura (el código bajo prueba no puede dejar hooks de git ni ajustes de .claude que luego corran en la
 * máquina de la persona); solo /tmp es escribible. --entrypoint fija el ejecutable: el script de entrada de la imagen
 * no reinterpreta la orden. null si el ejecutable no tiene imagen: nunca se ejecuta fuera.
 */
export function dockerArgv(def: CheckDef, root: string, cwdRel: string, images: Record<string, string>, name: string): string[] | null {
  const exe = exeName(argv0(def))
  const image = images[exe]
  if (!image) return null
  return [
    'docker', 'run', '--rm', '--name', name, '--pull=missing', '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,exec,size=512m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', '65534:65534', '--cpus', '2', '--memory', '2g', '--pids-limit', '512', '--entrypoint', exe,
    '-e', 'HOME=/tmp', '-e', 'CARGO_TARGET_DIR=/tmp/target', '-e', 'GOCACHE=/tmp/go-cache', '-e', 'GOPATH=/tmp/go', '-e', 'PYTHONDONTWRITEBYTECODE=1',
    '--mount', `type=bind,source=${root},target=/work,readonly`, '-w', `/work${cwdRel}`,
    image, ...def.argv.slice(1),
  ]
}

const DOCKER_DOWN = /failed to connect to the docker API|Cannot connect to the Docker daemon|error during connect/i

/** Número de tests ejecutados según los formatos habituales; null si la salida no lo dice. */
export function countTests(out: string): number | null {
  const pats: [RegExp, (m: RegExpMatchArray) => number][] = [
    [/^# tests (\d+)/m, m => +m[1]!], // node --test (TAP)
    [/ℹ tests (\d+)/, m => +m[1]!], // node --test (spec)
    [/Tests:.*?(\d+) total/, m => +m[1]!], // jest
    [/Tests\s+.*\((\d+)\)/, m => +m[1]!], // vitest
    [/test result: \w+\. (\d+) passed; (\d+) failed/, m => +m[1]! + +m[2]!], // cargo
    [/(?:(\d+) failed, )?(\d+) passed/, m => +(m[1] ?? 0) + +m[2]!], // pytest y similares
    [/\btests: (\d+)/i, m => +m[1]!],
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

/** Archivos bajo una ruta del plan (archivo o directorio, hasta 300, sin enlaces ni node_modules): [ruta relativa, contenido | null si falta]. */
async function filesUnder(io: Io, root: string, entry: string): Promise<[string, string | null][]> {
  const e = parseEntry(entry)
  if (typeof e === 'string') return []
  const out: [string, string | null][] = []
  const walk = async (path: string, depth: number) => {
    if (out.length > 300 || depth > 8) return
    const st = await io.stat(path, false).catch(() => undefined)
    if (!st) return void out.push([path.slice(root.length + 1), null])
    if (st.kind === 'dir') {
      const list = await io.list(path)
      for (const it of [...list].sort((a, b) => a.name.localeCompare(b.name))) if (!it.isLink && it.name !== 'node_modules') await walk(`${path}/${it.name}`, depth + 1)
    } else if (st.kind === 'file') out.push([path.slice(root.length + 1), await io.read(path)])
  }
  await walk(`${root}/${e.rel}`, 0)
  return out
}

/** Huella de las rutas protegidas (archivos o directorios, hasta 300 archivos): detecta cambios en los scripts de verificación. */
export async function fingerprint(io: Io, root: string, protects: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const p of protects) {
    const files = await filesUnder(io, root, p)
    // mismo formato que antes de compartir el recorrido: las huellas guardadas en misiones en curso siguen valiendo
    out[p] = hash(files.map(([rel, text]) => (text === null ? `${root}/${rel}:missing` : `/${rel}:${hash(text)}`)).join('\n'))
  }
  return out
}

/**
 * Copia los archivos de unas rutas del plan de una raíz a otra (árbol principal → taller al abrirlo, taller →
 * árbol principal al integrar). Devuelve las rutas relativas copiadas. ponytail: texto (io.read); un binario
 * en las rutas de una subtarea en paralelo se corrompería: si hace falta, copiar con $.fs en bruto.
 */
export async function copyEntries(io: Io, from: string, to: string, paths: string[]): Promise<string[]> {
  const copied: string[] = []
  for (const p of paths)
    for (const [rel, text] of await filesUnder(io, from, p)) {
      if (text === null) continue
      await io.write(`${to}/${rel}`, text)
      copied.push(rel)
    }
  return copied
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
  if (['node', 'bun', 'deno'].includes(exeName(argv0(def)))) {
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
  if (!q.limits.allowedExecutables.includes(exeName(argv0(def)))) return done({ ...base, error: `ejecutable no autorizado: ${def.argv[0]}` })
  const cwd = await realOf(io, def.cwd === '.' ? root : `${root}/${def.cwd}`, root)
  if (!cwd || !inside(cwd, root)) return done({ ...base, error: `directorio de trabajo fuera del proyecto: ${def.cwd}` })
  const expected = q.baseline?.protectedHashes ?? {}
  const now = await fingerprint(io, root, def.protects)
  // La subtarea activa que escribe estas rutas (especificación ejecutable) aún no terminó: cambiarlas es su trabajo,
  // no una manipulación. Sus huellas pasan a ser la referencia al quedar revisada (rebaseProtected).
  const writer = q.plan?.tasks.find(t => t.id === q.activeTask)
  const own = (p: string) => !!writer && q.progress[writer.id]?.status !== 'done' && writer.paths.some(w => pathsOverlap(w, p))
  const changed = def.protects.filter(p => !own(p) && expected[p] !== undefined && expected[p] !== now[p])
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
  const images = q.limits.sandbox ?? null
  let argv = def.argv
  let timeoutMs = def.timeoutMs
  const name = `guildflow-${hash(`${root}|${def.id}|${t0}`).slice(0, 12)}`
  if (images) {
    if (/[,"]/.test(root)) return done({ ...base, error: 'sandbox: la ruta del proyecto contiene comas o comillas y no se puede montar' })
    const d = dockerArgv(def, root, cwd.slice(root.length), images, name)
    if (!d) return done({ ...base, error: `sandbox: sin imagen Docker para ${exeName(argv0(def))} (opción sandboxImages); no se ejecuta fuera del contenedor` })
    argv = d
    timeoutMs += 60_000 // ponytail: margen para arrancar el contenedor (y bajar la imagen la primera vez); prebajar las imágenes lo evita
  }
  try {
    const r = await io.run(argv, { cwd, timeoutMs })
    const out = { ...base, argv, cwd, exitCode: r.exitCode, stdout: r.stdout.slice(0, OUTPUT_LIMIT), stderr: r.stderr.slice(0, OUTPUT_LIMIT), durationMs: (await io.now()) - t0 }
    // 125: docker no pudo arrancar el contenedor (imagen, opciones); 126/127: el ejecutable no está en la imagen;
    // sin servicio, el CLI sale con 1 y este mensaje: no es un fallo del código bajo prueba
    if (images && ([125, 126, 127].includes(r.exitCode) || DOCKER_DOWN.test(r.stderr))) return after({ ...out, error: `sandbox Docker (código ${r.exitCode}): ${r.stderr.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? ''}` })
    return after(out)
  } catch (err) {
    const durationMs = (await io.now()) - t0
    const timedOut = durationMs >= timeoutMs - 100
    // el CLI muerto por tiempo no para el contenedor: se elimina por su nombre
    if (images) await io.run(['docker', 'rm', '-f', name], { cwd, timeoutMs: 30_000 }).catch(() => undefined)
    return after({ ...base, argv, cwd, error: timedOut ? null : String(err).slice(0, 300), timedOut, durationMs })
  }
}

/** Entradas de `git status --porcelain=v1 -z -uall`: [estado, ruta]. */
export function parsePorcelain(z: string): [string, string][] {
  const out: [string, string][] = []
  const parts = z.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
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
        if (abs === `${root}/.claude/launch.json`) continue // la escribe el mod para el navegador de las subtareas visuales (los agentes no pueden)
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
  if (diffLines !== null && diffLines > q.limits.maxDiffLines) problems.push(`${diffLines} líneas de diff en la misión (> ${q.limits.maxDiffLines})`)
  const reason = problems.length ? problems.join('; ') : `alcance correcto: ${touched.join(', ')}; ${diffLines ?? '?'} líneas de diff en toda la misión${gitNote}`
  return { pass: problems.length === 0, reason: `${reason}${problems.length ? gitNote : ''}`, outOfScope, touched, diffLines, files: list.length }
}
