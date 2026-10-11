// Validación de entradas no confiables (plan del modelo, argumentos de herramientas, rutas) y utilidades puras.
// Todo lo que no se puede demostrar válido se rechaza.
import type { CheckDef, Criterion, Effort, Limits, Plan, Task } from '../types'

/** Hash no criptográfico (2×FNV-1a 32): detecta cambios accidentales, no adversarios. */
export function hash(s: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

// ---------- rutas ----------

const isWinCwd = (cwd: string) => /^[a-zA-Z]:[\\/]/.test(cwd)

/**
 * Ruta absoluta normalizada ('/' como separador, sin '.', '..' ni barra final; en Windows en minúsculas,
 * porque NTFS no distingue mayúsculas). null si la ruta no puede situarse con seguridad.
 */
export function normalizeAbs(raw: unknown, cwd: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null
  if (raw.includes('\0') || raw.startsWith('~')) return null
  const win = isWinCwd(cwd)
  let s = raw.replace(/\\/g, '/')
  if (/^\/\//.test(s)) return null // UNC, \\?\ y dispositivos
  if (win) {
    const gitBash = /^\/([a-zA-Z])(\/.*)?$/.exec(s)
    if (gitBash) s = `${gitBash[1]}:${gitBash[2] ?? '/'}`
    if (/^[a-zA-Z]:(?!\/)/.test(s)) return null // relativa a unidad: C:foo
    if (s.startsWith('/')) return null // relativa a la raíz de la unidad actual
  }
  const absolute = win ? /^[a-zA-Z]:\//.test(s) : s.startsWith('/')
  if (!absolute) s = `${cwd.replace(/\\/g, '/').replace(/\/+$/, '')}/${s}`
  const segs = s.split('/')
  const head = segs[0] // 'c:' o '' en POSIX
  const out: string[] = []
  for (const seg of segs.slice(1)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null // por encima de la raíz
      out.pop()
      continue
    }
    if (win && (/[:*?"<>|]/.test(seg) || /[. ]$/.test(seg))) return null // flujos alternativos, comodines, alias con punto/espacio final
    out.push(seg)
  }
  const joined = `${head}/${out.join('/')}`
  return win ? joined.toLowerCase() : joined
}

export const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`)

export type PathEntry = { rel: string; dir: boolean }

const RESERVED = /^(\.guildflow|\.git|\.claude)(\/|$)/i

/** Entrada relativa de un plan: archivo exacto o directorio ('x/' o 'x/**'). Sin '..', sin comodines intermedios. */
export function parseEntry(raw: unknown): PathEntry | string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) return 'ruta vacía o demasiado larga'
  let s = raw.trim().replace(/\\/g, '/')
  if (/^[a-zA-Z]:|^\/|^~/.test(s)) return `ruta absoluta no permitida: ${raw}`
  let dir = false
  if (s.endsWith('/**')) {
    s = s.slice(0, -3)
    dir = true
  } else if (s.endsWith('/')) dir = true
  s = s.replace(/^\.\//, '').replace(/\/+$/, '')
  if (s === '' || s === '.') return `la raíz completa no es una concesión válida: ${raw}`
  if (/[*?[\]{}]/.test(s)) return `comodines no admitidos (usa archivo o directorio/): ${raw}`
  if (s.split('/').some(x => x === '..' || x === '.' || x === '' || /[:"<>|]/.test(x) || /[. ]$/.test(x))) return `ruta no normalizable: ${raw}`
  if (RESERVED.test(s)) return `ruta reservada: ${raw}`
  return { rel: s, dir }
}

/** Absoluta normalizada de una entrada relativa a la raíz (ya normalizada). */
export const entryAbs = (root: string, e: PathEntry) => normalizeAbs(e.rel, root)

export function matchesEntry(abs: string, root: string, e: PathEntry): boolean {
  const base = entryAbs(root, e)
  if (!base) return false
  return e.dir ? inside(abs, base) && abs !== base : abs === base
}

const overlaps = (a: PathEntry, b: PathEntry) => {
  const x = a.rel.toLowerCase()
  const y = b.rel.toLowerCase()
  if (x === y) return true
  if (a.dir && inside(y, x)) return true
  if (b.dir && inside(x, y)) return true
  return false
}

// ---------- comandos ----------

const SENSITIVE: [RegExp, string][] = [
  [/\bgit\s+(push|reset\s+--hard|clean|filter-branch|update-ref|rebase|checkout\s+--|branch\s+-D|config\s+--global)\b/i, 'git destructivo o remoto'],
  [/\b(npm|pnpm|yarn|bun|pip3?|cargo|dotnet|gem|composer|choco|winget|scoop|brew|apt(-get)?)\s+(install|i|add|remove|rm|uninstall|publish|ci|update|upgrade|get)\b/i, 'instalación o publicación de dependencias'],
  [/\bgo\s+(install|get)\b/i, 'instalación de dependencias'],
  [/(^|[\s;&|(])(rm|del|rmdir|rd|erase|Remove-Item|format|mkfs|shred)\b/i, 'borrado'],
  [/\b(deploy|publish|release)\b/i, 'despliegue o publicación'],
  [/\b(terraform\s+apply|kubectl|helm|docker\s+(push|rm|system))\b/i, 'sistemas externos'],
  [/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|scp|ssh|ftp)\b/i, 'red'],
  [/\b(setx|reg\s+(add|delete)|Set-ItemProperty|Set-ExecutionPolicy|sudo|chmod\s+-R|chown)\b/i, 'configuración del sistema'],
  [/(\.claude[\\/]|settings\.json|\.gitconfig|\.npmrc)/i, 'configuración global'],
  [/\b(migrate\s+(reset|down)|db\s+(reset|drop)|drop\s+(table|database))\b/i, 'migración destructiva'],
]

/** Motivo por el que un comando es sensible, o null. Lista de patrones: mejor esfuerzo, se combina con preguntar. */
export function sensitiveCommand(cmd: string): string | null {
  for (const [re, why] of SENSITIVE) if (re.test(cmd)) return why
  return null
}

// Flags admitidos sin preguntar. Lista blanca: `--output`, `--ext-diff`, `--textconv`, `-c`, `--exec`… quedan fuera.
const SAFE_FLAGS = /^(--short|-s|-b|--branch|--porcelain(=v[12])?|--oneline|--stat|--name-only|--name-status|--graph|--decorate|--all|--no-color|--cached|--staged|--show-toplevel|--show-prefix|--abbrev-ref|--verify|-n\d{1,4}|-\d{1,4}|--max-count=\d{1,4}|-v|-a|-l|-la|-Force|-Recurse|-Name|--)$/i

/**
 * Comando de shell de solo lectura que el Maestro puede ejecutar sin preguntar durante una misión.
 * `git diff`/`git show` no entran: pueden ejecutar drivers externos (diff.external, textconv) del repositorio.
 */
export function readOnlyShell(cmd: string): boolean {
  const c = cmd.trim()
  if (!c || c.length > 300 || /[;&|<>`$(){}\r\n'"]/.test(c)) return false
  if (sensitiveCommand(c)) return false
  const m = /^(git\s+(?:status|log|rev-parse|ls-files|remote\s+-v)|ls|dir|pwd|Get-ChildItem|Get-Location)(\s+.*)?$/i.exec(c)
  if (!m) return false
  const args = (m[2] ?? '').trim().split(/\s+/).filter(Boolean)
  if (/^git\s+log/i.test(m[1]) && args.some(a => /^(-p|-u|--patch|--format|--pretty)/i.test(a))) return false
  return args.every(a => !a.startsWith('-') || SAFE_FLAGS.test(a))
}

export const exeName = (argv0: string) =>
  argv0
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')

// ---------- límites ----------

const HARD: Record<string, [number, number]> = {
  maxAttemptsPerTask: [1, 10],
  maxQuestIterations: [1, 30],
  maxSameFailure: [1, 5],
  maxNoProgressRounds: [1, 5],
  maxAgentsPerQuest: [1, 20],
  maxConcurrentAgents: [1, 3],
  tokenBudgetPerQuest: [10_000, 20_000_000],
  costBudgetUsd: [0.1, 500],
  rateLimitPercent: [1, 100],
  wallClockMinutes: [1, 480],
  maxFilesChanged: [1, 200],
  maxDiffLines: [1, 20_000],
  maxTurnsArchimago: [1, 60],
  maxTurnsArtifice: [1, 80],
  maxTurnsPaladin: [1, 60],
}
const DEFAULTS: Record<string, number> = {
  maxAttemptsPerTask: 3,
  maxQuestIterations: 8,
  maxSameFailure: 2,
  maxNoProgressRounds: 2,
  maxAgentsPerQuest: 12,
  maxConcurrentAgents: 3,
  tokenBudgetPerQuest: 2_000_000,
  costBudgetUsd: 25,
  rateLimitPercent: 90,
  wallClockMinutes: 60,
  maxFilesChanged: 25,
  maxDiffLines: 1500,
  maxTurnsArchimago: 25,
  maxTurnsArtifice: 40,
  maxTurnsPaladin: 25,
}
const DEFAULT_EXES = 'node,git,tsc,python,py,pytest,cargo,go,dotnet,deno,bun'

/** Límites efectivos: los valores de userConfig acotados a los topes del plugin (no se pueden desactivar). */
export function limitsFrom(options: Readonly<Record<string, unknown>>): Limits {
  const n = (k: string) => {
    const v = Number(options[k])
    const [lo, hi] = HARD[k]
    const x = Number.isFinite(v) ? v : DEFAULTS[k]
    const clamped = Math.min(hi, Math.max(lo, x))
    return k === 'costBudgetUsd' ? clamped : Math.floor(clamped)
  }
  const effort: Effort = options.archimagoEffort === 'xhigh' ? 'xhigh' : 'high'
  const exes = String(options.allowedExecutables ?? DEFAULT_EXES)
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(x => /^[a-z0-9._-]{1,32}$/.test(x) && !/\.(cmd|bat|ps1|sh)$/.test(x))
  return {
    maxAttemptsPerTask: n('maxAttemptsPerTask'),
    maxQuestIterations: n('maxQuestIterations'),
    maxSameFailure: n('maxSameFailure'),
    maxNoProgressRounds: n('maxNoProgressRounds'),
    maxAgentsPerQuest: n('maxAgentsPerQuest'),
    maxConcurrentAgents: n('maxConcurrentAgents'),
    tokenBudgetPerQuest: n('tokenBudgetPerQuest'),
    costBudgetUsd: n('costBudgetUsd'),
    rateLimitPercent: n('rateLimitPercent'),
    wallClockMinutes: n('wallClockMinutes'),
    maxFilesChanged: n('maxFilesChanged'),
    maxDiffLines: n('maxDiffLines'),
    maxTurns: { archimago: n('maxTurnsArchimago'), artifice: n('maxTurnsArtifice'), paladin: n('maxTurnsPaladin') },
    archimagoEffort: effort,
    allowedExecutables: exes,
  }
}

// ---------- plan ----------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const ID = /^[a-z][a-z0-9_-]{0,23}$/
const CHECK_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/

function str(o: Obj, k: string, max: number, errs: string[], where: string, required = true): string {
  const v = o[k]
  if (v === undefined && !required) return ''
  if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) {
    errs.push(`${where}.${k}: texto obligatorio de hasta ${max} caracteres`)
    return ''
  }
  return v.trim()
}
function int(o: Obj, k: string, def: number, lo: number, hi: number, errs: string[], where: string): number {
  const v = o[k] ?? def
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
    errs.push(`${where}.${k}: entero entre ${lo} y ${hi}`)
    return def
  }
  return v
}
function strList(o: Obj, k: string, maxItems: number, maxLen: number, errs: string[], where: string): string[] {
  const v = o[k] ?? []
  if (!Array.isArray(v) || v.length > maxItems || v.some(x => typeof x !== 'string' || x.length > maxLen)) {
    errs.push(`${where}.${k}: lista de hasta ${maxItems} textos de ${maxLen} caracteres`)
    return []
  }
  return v as string[]
}
function onlyKeys(o: Obj, keys: string[], errs: string[], where: string) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) errs.push(`${where}: campo inesperado "${k}"`)
}

export const SCOPE_CRITERION: Criterion = { id: 'scope', text: 'Solo se modificaron rutas autorizadas, el diff no está vacío y respeta los límites de archivos y líneas', check: 'diff-scope' }

function parseCheck(raw: unknown, i: number, limits: Limits, errs: string[]): CheckDef | null {
  const w = `checks[${i}]`
  if (!isObj(raw)) {
    errs.push(`${w}: debe ser un objeto`)
    return null
  }
  onlyKeys(raw, ['id', 'argv', 'cwd', 'expectExit', 'timeoutMs', 'minTests', 'stdoutIncludes', 'protects'], errs, w)
  const id = typeof raw.id === 'string' && CHECK_ID.test(raw.id) && raw.id !== 'diff-scope' ? raw.id : null
  if (!id) errs.push(`${w}.id: identificador [a-z0-9_-] (y no "diff-scope")`)
  const argv = raw.argv
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 32 || argv.some(a => typeof a !== 'string' || !a || a.length > 512 || /[\0\r\n]/.test(a))) {
    errs.push(`${w}.argv: lista de 1 a 32 argumentos sin saltos de línea`)
    return null
  }
  const exe = exeName(argv[0])
  if (/\.(cmd|bat|ps1|sh)$/.test(exe)) errs.push(`${w}.argv[0]: ${argv[0]} necesita un shell; declara el intérprete (por ejemplo node) y el script`)
  else if (!limits.allowedExecutables.includes(exe)) errs.push(`${w}.argv[0]: ejecutable no autorizado "${exe}" (permitidos: ${limits.allowedExecutables.join(', ')})`)
  const why = sensitiveCommand(argv.join(' '))
  if (why) errs.push(`${w}.argv: comando sensible (${why}); no puede ser una comprobación`)
  const cwdRaw = raw.cwd ?? '.'
  let cwd = '.'
  if (cwdRaw !== '.' && cwdRaw !== './') {
    const e = parseEntry(cwdRaw)
    if (typeof e === 'string') errs.push(`${w}.cwd: ${e}`)
    else cwd = e.rel
  }
  const protects: string[] = []
  for (const p of strList(raw, 'protects', 50, 300, errs, w)) {
    const e = parseEntry(p)
    if (typeof e === 'string') errs.push(`${w}.protects: ${e}`)
    else protects.push(e.dir ? `${e.rel}/` : e.rel)
  }
  return {
    id: id ?? 'invalid',
    argv: argv as string[],
    cwd,
    expectExit: int(raw, 'expectExit', 0, 0, 255, errs, w),
    timeoutMs: int(raw, 'timeoutMs', 120_000, 1_000, 600_000, errs, w),
    minTests: int(raw, 'minTests', 0, 0, 100_000, errs, w),
    stdoutIncludes: strList(raw, 'stdoutIncludes', 5, 200, errs, w),
    protects,
  }
}

function parseTask(raw: unknown, i: number, seen: string[], checks: CheckDef[], limits: Limits, errs: string[]): Task | null {
  const w = `tasks[${i}]`
  if (!isObj(raw)) {
    errs.push(`${w}: debe ser un objeto`)
    return null
  }
  onlyKeys(raw, ['id', 'title', 'description', 'dependsOn', 'role', 'paths', 'criteria', 'maxAttempts', 'doneWhen', 'isolation'], errs, w)
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null
  if (!id) errs.push(`${w}.id: identificador [a-z][a-z0-9_-]`)
  else if (seen.includes(id)) errs.push(`${w}.id: duplicado "${id}"`)
  if ((raw.role ?? 'artifice') !== 'artifice') errs.push(`${w}.role: solo "artifice" implementa subtareas`)
  if ((raw.isolation ?? 'none') !== 'none') errs.push(`${w}.isolation: solo "none"; los worktrees no están validados en esta versión y la ejecución es secuencial`)
  const dependsOn = strList(raw, 'dependsOn', 10, 24, errs, w)
  for (const d of dependsOn) if (!seen.includes(d)) errs.push(`${w}.dependsOn: "${d}" debe ser una subtarea declarada antes`)
  const paths: string[] = []
  const rawPaths = raw.paths
  if (!Array.isArray(rawPaths) || rawPaths.length < 1 || rawPaths.length > 30) errs.push(`${w}.paths: de 1 a 30 rutas autorizadas`)
  else
    for (const p of rawPaths) {
      const e = parseEntry(p)
      if (typeof e === 'string') errs.push(`${w}.paths: ${e}`)
      else paths.push(e.dir ? `${e.rel}/` : e.rel)
    }
  const criteria: Criterion[] = []
  const rawCrit = raw.criteria
  if (!Array.isArray(rawCrit) || rawCrit.length < 1 || rawCrit.length > 20) errs.push(`${w}.criteria: de 1 a 20 criterios`)
  else
    rawCrit.forEach((c, j) => {
      const cw = `${w}.criteria[${j}]`
      if (!isObj(c)) return void errs.push(`${cw}: debe ser un objeto`)
      onlyKeys(c, ['id', 'text', 'check'], errs, cw)
      const cid = typeof c.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,23}$/.test(c.id) && c.id !== 'scope' ? c.id : null
      if (!cid) errs.push(`${cw}.id: identificador (y no "scope", reservado)`)
      else if (criteria.some(x => x.id === cid)) errs.push(`${cw}.id: duplicado "${cid}"`)
      const text = str(c, 'text', 500, errs, cw)
      const check = c.check
      const ok = check === 'review' || (typeof check === 'string' && check.startsWith('check:') && checks.some(k => `check:${k.id}` === check))
      if (!ok) errs.push(`${cw}.check: "review" o "check:<id declarado>"; un criterio sin método verificable impide aprobar`)
      if (cid && ok) criteria.push({ id: cid, text, check: check as string })
    })
  if (Array.isArray(rawCrit) && !criteria.some(c => c.check === 'review')) errs.push(`${w}.criteria: hace falta al menos un criterio "review" (revisión independiente del Paladín)`)
  const task: Task = {
    id: id ?? 'invalid',
    title: str(raw, 'title', 120, errs, w),
    description: str(raw, 'description', 4000, errs, w),
    dependsOn,
    role: 'artifice',
    paths,
    criteria: [...criteria, SCOPE_CRITERION],
    maxAttempts: int(raw, 'maxAttempts', limits.maxAttemptsPerTask, 1, limits.maxAttemptsPerTask, errs, w),
    doneWhen: str(raw, 'doneWhen', 500, errs, w),
    isolation: 'none',
  }
  if (id) seen.push(id)
  return task
}

export type PlanResult = { ok: true; plan: Plan; warnings: string[] } | { ok: false; errors: string[] }

/** Valida un plan del modelo. Rechaza campos desconocidos, criterios sin método y comprobaciones peligrosas. */
export function validatePlan(raw: unknown, limits: Limits): PlanResult {
  const errs: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['el plan debe ser un objeto JSON'] }
  onlyKeys(raw, ['objective', 'scope', 'constraints', 'risks', 'complexity', 'checks', 'tasks'], errs, 'plan')
  const complexity = raw.complexity ?? 'small'
  if (!['small', 'medium', 'large'].includes(complexity as string)) errs.push('plan.complexity: small | medium | large')
  const rawChecks = raw.checks ?? []
  const checks: CheckDef[] = []
  if (!Array.isArray(rawChecks) || rawChecks.length > 20) errs.push('plan.checks: lista de hasta 20 comprobaciones')
  else
    rawChecks.forEach((c, i) => {
      const k = parseCheck(c, i, limits, errs)
      if (k && checks.some(x => x.id === k.id)) errs.push(`checks[${i}].id: duplicado "${k.id}"`)
      else if (k) checks.push(k)
    })
  const rawTasks = raw.tasks
  const tasks: Task[] = []
  const seen: string[] = []
  if (!Array.isArray(rawTasks) || rawTasks.length < 1 || rawTasks.length > 10) errs.push('plan.tasks: de 1 a 10 subtareas')
  else
    rawTasks.forEach((t, i) => {
      const k = parseTask(t, i, seen, checks, limits, errs)
      if (k) tasks.push(k)
    })
  const plan: Plan = {
    objective: str(raw, 'objective', 1000, errs, 'plan'),
    scope: str(raw, 'scope', 2000, errs, 'plan'),
    constraints: strList(raw, 'constraints', 20, 300, errs, 'plan'),
    risks: strList(raw, 'risks', 20, 300, errs, 'plan'),
    complexity: complexity as Plan['complexity'],
    checks,
    tasks,
  }
  if (errs.length) return { ok: false, errors: errs }
  const overlap = checkOverlaps(plan)
  if (overlap.errors.length) return { ok: false, errors: overlap.errors }
  return { ok: true, plan, warnings: overlap.warnings }
}

/** Una subtarea no puede escribir lo que certifica su propio trabajo; los solapes entre subtareas obligan a ir en serie. */
export function checkOverlaps(plan: Plan): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const entry = (s: string) => parseEntry(s) as PathEntry
  for (const t of plan.tasks) {
    const used = t.criteria.filter(c => c.check.startsWith('check:')).map(c => c.check.slice(6))
    for (const k of plan.checks.filter(x => used.includes(x.id)))
      for (const p of k.protects)
        for (const w of t.paths) if (overlaps(entry(w), entry(p))) errors.push(`la subtarea ${t.id} podría modificar ${p}, que define la comprobación ${k.id}`)
  }
  for (let i = 0; i < plan.tasks.length; i++)
    for (let j = i + 1; j < plan.tasks.length; j++) {
      const a = plan.tasks[i]
      const b = plan.tasks[j]
      if (a.paths.some(x => b.paths.some(y => overlaps(entry(x), entry(y))))) warnings.push(`${a.id} y ${b.id} comparten rutas: se ejecutarán en serie`)
    }
  return { errors, warnings }
}

// ---------- argumentos de herramientas ----------

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Objeto con exactamente las claves dadas (las opcionales pueden faltar); cualquier otra se rechaza. */
export function exactArgs(input: Obj, required: string[], optional: string[] = []): string | null {
  const reserved = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']
  for (const k of Object.keys(input)) if (!reserved.includes(k) && !required.includes(k) && !optional.includes(k)) return `argumento inesperado "${k}"`
  for (const k of required) if (input[k] === undefined) return `falta el argumento "${k}"`
  return null
}

export const isCheckId = (v: unknown): v is string => typeof v === 'string' && (v === 'diff-scope' || CHECK_ID.test(v))
export const isTaskId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
