// Consumo real de una sesión de Claude Code a partir de su transcripción (principal + subagentes).
// node bench/usage.mjs <carpeta de ~/.claude/projects/...> — precios verificados en la PoC (docs/06), USD por millón.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PRICE = {
  opus: { in: 4, out: 20, w5m: 5, w1h: 8, read: 0.2 },
  sonnet: { in: 2, out: 10, w5m: 2.5, w1h: 4, read: 0.2 },
  haiku: { in: 0.1, out: 0.5, w5m: 0.125, w1h: 0.2, read: 0.01 },
}
const family = m => (/opus/.test(m) ? 'opus' : /haiku/.test(m) ? 'haiku' : 'sonnet')

const dir = process.argv[2]
const main = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
const files = main.map(f => ({ path: join(dir, f), who: 'principal' }))
for (const f of main) {
  const sub = join(dir, f.replace(/\.jsonl$/, ''), 'subagents')
  if (existsSync(sub)) for (const s of readdirSync(sub).filter(x => x.endsWith('.jsonl'))) files.push({ path: join(sub, s), who: 'subagente' })
}

const rows = {}
let first = Infinity
let last = 0
let humanTurns = 0
for (const { path, who } of files) {
  const byId = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const t = Date.parse(e.timestamp ?? '')
    if (who === 'principal' && Number.isFinite(t)) { first = Math.min(first, t); last = Math.max(last, t) }
    if (who === 'principal' && e.type === 'user' && !e.isMeta && !e.isSidechain) {
      const c = e.message?.content
      const text = typeof c === 'string' ? c : Array.isArray(c) && c.every(b => b.type === 'text') ? c.map(b => b.text).join('') : null
      if (text && !/^<(local-command|command-name|system-reminder|task-notification)/.test(text.trim())) humanTurns += 1
    }
    const u = e.message?.usage
    if (e.type === 'assistant' && u && e.message.id) byId.set(e.message.id, { u, model: e.message.model ?? '?' })
  }
  for (const { u, model } of byId.values()) {
    if (model === '<synthetic>') continue
    const k = `${who} · ${model}`
    const r = (rows[k] ??= { requests: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 })
    const p = PRICE[family(model)]
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens
    const w5m = u.cache_creation?.ephemeral_5m_input_tokens
    const cw = u.cache_creation_input_tokens ?? 0
    const [a1h, a5m] = w1h !== undefined || w5m !== undefined ? [w1h ?? 0, w5m ?? 0] : who === 'principal' ? [cw, 0] : [0, cw]
    r.requests += 1
    r.input += u.input_tokens ?? 0
    r.output += u.output_tokens ?? 0
    r.cacheWrite += cw
    r.cacheRead += u.cache_read_input_tokens ?? 0
    r.usd += ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + a1h * p.w1h + a5m * p.w5m + (u.cache_read_input_tokens ?? 0) * p.read) / 1e6
  }
}
const total = Object.values(rows).reduce((t, r) => { for (const k in r) t[k] = (t[k] ?? 0) + r[k]; return t }, {})
for (const r of [...Object.values(rows), total]) r.usd = Math.round(r.usd * 100) / 100
console.log(JSON.stringify({ minutes: Math.round((last - first) / 600) / 100, humanTurns, rows, total }, null, 1))
