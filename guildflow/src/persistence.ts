// Escriba (persistencia). ÚNICO módulo que escribe el estado del gremio: .guildflow/ del proyecto y $.store.
// Sin rename ni delete en $.fs: la escritura segura es tmp → releer y validar → definitivo → copia en $.store,
// con control optimista por `rev`. Todas las escrituras pasan por una cola serializada.
import type { Io, Quest, QuestState } from '../types'
import { hash } from './validation'

export const DIR = '.guildflow'
const LOG_ROTATE_BYTES = 2 * 1024 * 1024
const STATES: readonly QuestState[] = ['INTAKE', 'PLANNING', 'AWAITING_APPROVAL', 'DISPATCH', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'FIXING', 'DONE', 'LOGGED', 'PAUSED', 'HALTED', 'BLOCKED']

export const files = (root: string) => ({
  quest: `${root}/${DIR}/quest.json`,
  tmp: `${root}/${DIR}/quest.json.tmp`,
  log: `${root}/${DIR}/log.jsonl`,
  runs: `${root}/${DIR}/runs`,
  archive: `${root}/${DIR}/quests`,
})

/** Clave de $.store por proyecto: nunca se mezclan misiones de proyectos distintos. */
export const storeKey = (root: string) => `quest:${hash(root)}`

let chain: Promise<unknown> = Promise.resolve()
/** Serializa toda escritura del módulo (un solo escritor). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => undefined)
  return p
}

/** Hash del último quest.json que este módulo escribió o leyó, por proyecto. */
const lastText = new Map<string, string>()

/**
 * ¿quest.json en disco es exactamente lo último que escribió (o cargó) el mod? Va por la cola serializada, así
 * que ninguna escritura propia queda a medias: una diferencia solo puede venir de fuera. null = sin referencia.
 */
export function diskMatches(io: Io, root: string): Promise<boolean | null> {
  return serial(async () => {
    const known = lastText.get(root)
    if (known === undefined) return null
    return hash(await io.read(files(root).quest).catch(() => '')) === known
  })
}

/** Comprobación estructural de una misión leída de disco (los datos de disco no son confiables). */
export function isQuest(x: unknown): x is Quest {
  if (typeof x !== 'object' || x === null) return false
  const q = x as Record<string, unknown>
  const num = (k: string) => typeof q[k] === 'number' && Number.isFinite(q[k] as number)
  return (
    q.schema === 1 &&
    typeof q.id === 'string' &&
    /^q-[\w-]+$/.test(q.id) &&
    num('rev') &&
    typeof q.project === 'string' &&
    typeof q.request === 'string' &&
    STATES.includes(q.state as QuestState) &&
    num('createdAt') &&
    num('iterations') &&
    num('agentsSpawned') &&
    Array.isArray(q.agents) &&
    Array.isArray(q.filesWritten) &&
    typeof q.progress === 'object' &&
    q.progress !== null &&
    typeof q.usage === 'object' &&
    q.usage !== null &&
    typeof q.limits === 'object' &&
    q.limits !== null &&
    (q.plan === null || (typeof q.plan === 'object' && Array.isArray((q.plan as { tasks?: unknown }).tasks)))
  )
}

const parse = (text: string): Quest | null => {
  try {
    const v: unknown = JSON.parse(text)
    return isQuest(v) ? v : null
  } catch {
    return null
  }
}

export type Loaded = { quest: Quest | null; source: 'file' | 'tmp' | 'store' | 'none'; problems: string[] }

/** Lee la misión del proyecto: archivo → temporal → copia en $.store. Valida estructura, proyecto e integridad del plan. */
export async function loadQuest(io: Io, root: string): Promise<Loaded> {
  const f = files(root)
  const problems: string[] = []
  let fileText: string | null = null
  const candidates: [Loaded['source'], () => Promise<Quest | null>][] = [
    ['file', async () => {
      if (!(await io.exists(f.quest))) return null
      fileText = await io.read(f.quest)
      return parse(fileText)
    }],
    ['tmp', async () => ((await io.exists(f.tmp)) ? parse(await io.read(f.tmp)) : null)],
    ['store', async () => {
      const v = await io.storeGet(storeKey(root))
      return isQuest(v) ? v : null
    }],
  ]
  let fileExists = false
  try {
    fileExists = await io.exists(f.quest)
  } catch {
    problems.push('no se pudo comprobar quest.json')
  }
  const valid: { q: Quest; source: Loaded['source'] }[] = []
  for (const [source, get] of candidates) {
    let q: Quest | null = null
    try {
      q = await get()
    } catch (err) {
      problems.push(`${source}: ${String(err)}`)
    }
    if (!q) {
      if (source === 'file' && fileExists) problems.push('quest.json existe pero no es válido')
      continue
    }
    if (q.project !== root) {
      problems.push(`${source}: la misión pertenece a otro proyecto (${q.project})`)
      continue
    }
    valid.push({ q, source })
  }
  if (!valid.length) return { quest: null, source: 'none', problems }
  // $.store vive fuera del proyecto: el código del proyecto no lo escribe por accidente. Un archivo que va más
  // de una revisión por delante (una escritura interrumpida solo deja una) o que difiere en la misma revisión
  // no lo escribió este mod: se usa la copia de $.store y se avisa.
  const store = valid.find(v => v.source === 'store')
  const disk = valid.filter(v => v.source !== 'store').sort((a, b) => b.q.rev - a.q.rev)[0]
  if (store && disk && disk.q.id === store.q.id) {
    const ahead = disk.q.rev - store.q.rev
    if (ahead > 1 || (ahead === 0 && JSON.stringify(disk.q) !== JSON.stringify(store.q))) {
      problems.push(`posible manipulación: ${disk.source} (rev ${disk.q.rev}) no coincide con la copia del mod (rev ${store.q.rev})`)
      return { quest: store.q, source: 'store', problems }
    }
    if (ahead < 0) return { quest: store.q, source: 'store', problems }
    if (disk.source === 'file' && fileText !== null) lastText.set(root, hash(fileText))
    return { quest: disk.q, source: disk.source, problems }
  }
  const best = [disk, store].filter(v => v !== undefined).sort((a, b) => b!.q.rev - a!.q.rev)[0]!
  if (best.source === 'file' && fileText !== null) lastText.set(root, hash(fileText))
  return { quest: best.q, source: best.source, problems }
}

/** Una misión con aprobación cuyo plan ya no coincide con el hash aprobado ha sido alterada fuera del mod. */
export const tampered = (q: Quest) => q.approval !== null && (!q.plan || hash(JSON.stringify(q.plan)) !== q.approval.planHash)

export class Conflict extends Error {}

/**
 * Guarda la misión (rev + 1). Rechaza si el archivo en disco tiene otra revisión (otro escritor o edición
 * externa): el llamante no confía en el disco y detiene la misión por seguridad. `force` solo para registrar
 * esa detención. Devuelve la misión guardada.
 */
export function saveQuest(io: Io, q: Quest, opts: { force?: boolean } = {}): Promise<Quest> {
  return serial(async () => {
    const f = files(q.project)
    if (!opts.force && (await io.exists(f.quest))) {
      const disk = parse(await io.read(f.quest))
      if (disk && disk.id === q.id && disk.rev > q.rev) throw new Conflict(`quest.json cambió en disco (rev ${disk.rev}, en memoria ${q.rev})`)
    }
    const next: Quest = { ...q, rev: q.rev + 1 }
    const text = `${JSON.stringify(next, null, 2)}\n`
    await io.write(f.tmp, text)
    const back = parse(await io.read(f.tmp))
    if (!back || back.rev !== next.rev) throw new Error('la copia temporal de quest.json no se pudo verificar')
    await io.write(f.quest, text)
    lastText.set(q.project, hash(text))
    await io.storeSet(storeKey(q.project), next)
    return next
  })
}

/** Registro append-only. Sin API de añadido: se relee y reescribe; se rota al pasar de 2 MiB. */
export function appendLog(io: Io, root: string, entries: { ev: string; data: Record<string, unknown> }[], meta: { questId: string | null; at: number }): Promise<void> {
  if (!entries.length) return Promise.resolve()
  return serial(async () => {
    const f = files(root)
    let cur = ''
    if (await io.exists(f.log)) cur = await io.read(f.log)
    if (cur.length > LOG_ROTATE_BYTES) {
      await io.write(`${root}/${DIR}/log.${meta.at}.jsonl`, cur)
      cur = ''
    }
    const lines = entries.map(e => JSON.stringify({ at: meta.at, iso: new Date(meta.at).toISOString(), quest: meta.questId, ev: e.ev, ...redactObj(e.data) })).join('\n')
    await io.write(f.log, `${cur}${lines}\n`)
  })
}

export function writeRun(io: Io, root: string, runId: string, data: Record<string, unknown>): Promise<string> {
  return serial(async () => {
    const path = `${files(root).runs}/${runId}.json`
    await io.write(path, `${JSON.stringify(redactObj(data), null, 2)}\n`)
    return path
  })
}

/** Archiva una misión cerrada antes de abrir otra (el historial no se pierde). */
export function archiveQuest(io: Io, q: Quest): Promise<void> {
  return serial(async () => {
    await io.write(`${files(q.project).archive}/${q.id}.json`, `${JSON.stringify(q, null, 2)}\n`)
  })
}

/** Conserva un quest.json ilegible para inspección antes de sustituirlo. */
export function quarantine(io: Io, root: string, at: number): Promise<void> {
  return serial(async () => {
    const f = files(root)
    if (await io.exists(f.quest)) await io.write(`${root}/${DIR}/quest.corrupt-${at}.json`, await io.read(f.quest))
  })
}

const SECRET = /((?:api[_-]?key|token|secret|password|passwd|authorization|bearer)\s*[:=]\s*)\S+|\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/gi

/** Tachado de secretos con patrones conocidos (mejor esfuerzo) antes de guardar salidas de comandos. */
export const redact = (s: string) => s.replace(SECRET, (_m, key: string | undefined) => (key ? `${key}[REDACTADO]` : '[REDACTADO]'))

function redactObj<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as T
  if (Array.isArray(v)) return v.map(redactObj) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactObj(x)])) as T
  return v
}
