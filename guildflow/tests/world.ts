// Mundo simulado por debajo del plugin para `claude plugin test`: el plugin real corre en el motor del kit y
// sus llamadas a $ (fs, store, process, session, ui.ask…) las responden estos hooks desde memoria.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

import type { Quest } from '../types'
import { files } from '../src/persistence'
import { ROOT } from './fixtures'

export type World = {
  files: Map<string, string>
  runs: (readonly string[])[]
  asked: string[]
  answers: string[]
  toasts: string[]
  prompts: string[]
  agents: { id: string; type: string }[]
  spawned: Record<string, unknown>[]
  ran: string[]
}

export function world(on: On, opts: { quest?: Quest; answers?: string[]; agentListFails?: boolean; proc?: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string } } = {}): World {
  const w: World = { files: new Map(), runs: [], asked: [], answers: [...(opts.answers ?? [])], toasts: [], prompts: [], agents: [], spawned: [], ran: [] }
  if (opts.quest) w.files.set(files(ROOT).quest, JSON.stringify(opts.quest))
  mock.clock(on, { now: 5_000 })
  mock.store(on)
  mock.env(on, {})
  const isDir = (p: string) => p === ROOT || [...w.files.keys()].some(k => k.startsWith(`${p}/`))
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess-test' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as never, rateLimits: [], cost: { usd: 1 } as never } }))
  on('fs.exists', ($, e) => ({ value: w.files.has(norm(e.path)) || isDir(norm(e.path)) }))
  on('fs.read', ($, e) => (w.files.has(norm(e.path)) ? { value: w.files.get(norm(e.path))! } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($, e) => {
    w.files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', ($, e) => {
    const p = norm(e.path)
    const real = /^[a-z]:$/.test(p) ? `${p}/` : p
    if (w.files.has(p)) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: real } : {}) } }
    if (isDir(p) || /^[a-z]:\/?$/.test(p) || /^c:\/repo(\/src)?$/.test(p)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: real } : {}) } }
    return { deny: `ENOENT ${e.path}` }
  })
  on('process.run', ($, e) => {
    w.runs.push(e.argv)
    const r = opts.proc ? opts.proc(e.argv) : { exitCode: 0, stdout: '', stderr: '' }
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => (opts.agentListFails ? { deny: 'agent.list no disponible' } : { value: w.agents.map(a => ({ ...a, description: '', status: 'running' as const })) }))
  on('ui.toast', ($, e) => {
    w.toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.text)
    return { turnId: 't' } as never
  })
  // AskUserQuestion: la "persona" responde con la siguiente respuesta preparada
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = (e as unknown as { questions: { question: string }[] }).questions[0].question
    w.asked.push(q)
    const a = w.answers.shift()
    if (a === undefined) return { deny: 'diálogo cerrado' }
    return { result: { questions: [], answers: { [q]: a } } as never }
  })
  // fondo de cualquier otra herramienta: la "ejecuta" y lo anota
  on('tool.call', ($, e) => {
    w.ran.push(String(e.tool))
    return { result: 'ok' as never }
  })
  on('agent.spawn', ($, e) => {
    w.spawned.push({ ...e })
    return { model: e.model ?? 'inherit', agentId: `agent-${w.spawned.length}` }
  })
  return w
}
