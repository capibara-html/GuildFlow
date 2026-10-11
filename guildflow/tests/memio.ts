// Io en memoria para pruebas: un sistema de archivos con directorios implícitos, un $.store y procesos simulados.
import type { Io } from '../types'

export type Proc = (argv: readonly string[], cwd: string) => { exitCode: number; stdout: string; stderr: string } | 'timeout' | 'nostart'

export function memIo(seed: Record<string, string> = {}, proc?: Proc, opts: { failWriteOn?: RegExp; links?: Record<string, string> } = {}) {
  const files = new Map<string, string>(Object.entries(seed))
  const store = new Map<string, unknown>()
  const runs: { argv: readonly string[]; cwd: string }[] = []
  let clock = 1_000
  const isDir = (p: string) => [...files.keys()].some(k => k.startsWith(`${p}/`))
  const real = (p: string) => {
    for (const [from, to] of Object.entries(opts.links ?? {})) if (p === from || p.startsWith(`${from}/`)) return to + p.slice(from.length)
    return p
  }
  const io: Io = {
    exists: async p => files.has(real(p)) || isDir(real(p)),
    read: async p => {
      const v = files.get(real(p))
      if (v === undefined) throw new Error(`ENOENT ${p}`)
      return v
    },
    write: async (p, t) => {
      if (opts.failWriteOn?.test(p)) throw new Error(`EIO ${p}`)
      files.set(real(p), t)
    },
    list: async p => {
      const pre = `${real(p)}/`
      const names = new Set([...files.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('/')[0]))
      return [...names].map(name => ({ name, isLink: false }))
    },
    stat: async (p, resolve) => {
      const r = /^[a-z]:\/?$/i.test(p) ? `${p.slice(0, 2).toLowerCase()}/` : real(p.replace(/\/+$/, ''))
      if (files.has(r)) return { kind: 'file', ...(resolve ? { realPath: r } : {}) }
      if (isDir(r) || /^[a-z]:\/$/.test(r) || r === 'c:/repo') return { kind: 'dir', ...(resolve ? { realPath: r } : {}) }
      throw new Error(`ENOENT ${p}`)
    },
    storeGet: async k => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined),
    storeSet: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    run: async (argv, init) => {
      runs.push({ argv, cwd: init.cwd })
      const r = proc ? proc(argv, init.cwd) : { exitCode: 0, stdout: '', stderr: '' }
      if (r === 'timeout') {
        clock += init.timeoutMs
        throw new Error('timed out')
      }
      if (r === 'nostart') throw new Error('ENOENT spawn')
      clock += 5
      return r
    },
    now: async () => clock,
  }
  return { io, files, store, runs }
}
