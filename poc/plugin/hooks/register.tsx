// GuildFlow Fase 1 — PoC desechable. NO es el núcleo del producto.
// Prueba: imposición de modelo/esfuerzo por rol (P1/P2), veto por rutas (P3), classic.Stop (P4),
// uso (P5), persistencia (P6), panel SVG (P7), $.agent.register (P8) y guardas transversales.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Ctl, UsageSum } from '../types'

type Raw = Record<string, unknown>

// ponytail: rutas fijas de la PoC; el núcleo las tomará de la misión aprobada.
const EVIDENCE = 'C:/Users/RYZEN/Desktop/GuildFlow/poc/evidence/events.jsonl'
const SANDBOX_ABS = 'C:/Users/RYZEN/Desktop/GuildFlow/poc/fixtures/sandbox'
const SANDBOX = SANDBOX_ABS.toLowerCase()

const PANE = 'guildflow-poc'
const RUN_CHECK = 'mcp__guildflow-poc__run_check'
const CONTROL = 'mcp__guildflow-poc__poc_control'

const agentsA = atom({ plugin: 'guildflow-poc', key: 'agents' } as const, [] as AgentRow[])
const usageA = atom({ plugin: 'guildflow-poc', key: 'usage' } as const, { mainTokens: 0, agentTokens: 0, mainTurns: 0, agentTurns: 0 } as UsageSum)
const ctlA = atom({ plugin: 'guildflow-poc', key: 'ctl' } as const, { spawnLimit: 12, spawnCount: 0, p4Armed: false, throwGuard: false, anim: true } as Ctl)

type Role = { model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; tools: string[]; write: string[] }

// Política por rol: lista blanca de herramientas + rutas de escritura. Todo lo no listado se rechaza.
const ROLES: Record<string, Role> = {
  'guildflow-poc:artifice': { model: 'claude-sonnet-5-5', effort: 'high', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit'], write: [`${SANDBOX}/allowed`] },
  'guildflow-poc:paladin': { model: 'claude-sonnet-5-5', effort: 'high', tools: ['Read', 'Glob', 'Grep', RUN_CHECK], write: [] },
  'guildflow-poc:escriba': { model: 'claude-haiku-5-5', effort: 'low', tools: ['Read', 'Glob', 'Grep'], write: [] },
  // P8: sin veto de rutas propio dentro del sandbox, para observar solo el efecto de permissionMode.
  'guildflow-poc:reg-probe': { model: 'claude-haiku-5-5', effort: 'low', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'], write: [SANDBOX] },
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
// Herramientas de infraestructura del motor que todo subagente necesita (descubierto en P1:
// sin SubagentHandback el subagente no puede entregar su informe al Maestro).
const ENGINE_TOOLS = new Set(['SubagentHandback'])

// Comprobaciones permitidas al Paladín: identificador → argv fijo. Sin shell, sin argumentos del modelo.
const CHECKS: Record<string, readonly string[]> = {
  'fixture-test': ['node', `${SANDBOX_ABS}/test/check.mjs`],
  'node-version': ['node', '--version'],
}

const roleOf = new Map<string, string>()

// ---------- Escriba (código): evidencia append-only, serializada ----------
let chain: Promise<void> = Promise.resolve()
function log($: EngineInterface, ev: string, data: Raw): Promise<void> {
  const run = async () => {
    const t = await $.clock.now()
    let cur = ''
    try {
      cur = await $.fs.read(EVIDENCE)
    } catch {
      cur = ''
    }
    await $.fs.write(EVIDENCE, `${cur}${JSON.stringify({ t, iso: new Date(t).toISOString(), ev, ...data })}\n`)
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return chain // registrar nunca rompe una guarda
}

// ---------- rutas ----------
function norm(p: string, cwd: string): string {
  let s = p.replace(/\\/g, '/')
  const gitBash = /^\/([a-zA-Z])\/(.*)$/.exec(s)
  if (gitBash) s = `${gitBash[1]}:/${gitBash[2]}`
  if (!/^[a-zA-Z]:\//.test(s)) s = `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${s}`
  const segs = s.split('/')
  const out = [segs[0]]
  for (const seg of segs.slice(1)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 1) out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/').toLowerCase()
}

// la ruta real (enlaces resueltos) del ancestro existente más cercano + el resto
async function real($: EngineInterface, p: string): Promise<string> {
  try {
    const st = await $.fs.stat(p, { resolve: true })
    if (st.realPath) return norm(st.realPath, '')
  } catch {
    // no existe todavía: subir un nivel
  }
  const i = p.lastIndexOf('/')
  if (i <= 2) return p
  return `${await real($, p.slice(0, i))}${p.slice(i)}`
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

async function roleFor($: EngineInterface, agentId: string): Promise<string | null> {
  const known = roleOf.get(agentId)
  if (known) return known
  // lanza si no puede consultarse: la guarda lo convierte en rechazo
  const info = (await $.agent.list()).find(a => a.id === agentId)
  if (info && ROLES[info.type]) {
    roleOf.set(agentId, info.type)
    return info.type
  }
  return null
}

async function judge($: EngineInterface, type: string, role: Role, raw: Raw): Promise<{ verdict: string | null; target: string | null }> {
  const tool = String(raw.tool)
  const short = type.replace('guildflow-poc:', '')
  if (ENGINE_TOOLS.has(tool)) return { verdict: null, target: null }
  if (!role.tools.includes(tool)) return { verdict: `el rol ${short} no puede usar la herramienta ${tool}.`, target: null }
  if (!WRITE_TOOLS.has(tool)) return { verdict: null, target: null }
  const target = [raw.file_path, raw.notebook_path, raw.path].find(v => typeof v === 'string') as string | undefined
  if (!target) return { verdict: `${tool} sin ruta de destino reconocible.`, target: null }
  const cwd = await $.session.cwd()
  const normalized = norm(target, cwd)
  if (normalized.slice(2).includes(':')) return { verdict: `ruta con ":" fuera de la unidad (posible flujo alternativo): ${target}`, target }
  const resolved = await real($, normalized)
  if (!role.write.some(dir => inside(resolved, dir))) {
    return { verdict: `${short} solo puede escribir en ${role.write.join(', ') || '(ninguna ruta)'}; ruta rechazada: ${target}`, target }
  }
  return { verdict: null, target }
}

// ---------- persistencia ----------
async function saveAgents($: EngineInterface, list: AgentRow[]) {
  await $.store.set('agents', list)
}
async function editAgent($: EngineInterface, id: string, change: (a: AgentRow) => AgentRow) {
  await update($, agentsA, list => list.map(a => (a.id === id ? change(a) : a)))
  await saveAgents($, await read($, agentsA))
}

// ---------- pixel art original (procedural, desechable) ----------
type Grid = (string | null)[][]
const C = { k: '#1b1b2f', s: '#f2c9a0', A: '#c5d0dc', a: '#8a9bb0', r: '#b33a3a', g: '#e8c547', b: '#4a2f1d', e: '#1b1b2f', w: '#dfe6ee' }

function sprite(frame: 0 | 1): Grid {
  const g: Grid = Array.from({ length: 32 }, () => Array<string | null>(32).fill(null))
  const box = (x: number, y: number, w: number, h: number, c: string, dy = 0) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j + dy >= 0 && j + dy < 32) g[j + dy][i] = c
  }
  const bob = frame === 1 ? -1 : 0
  box(9, 15, 14, 12, C.r, bob) // capa
  box(15, 1, 2, 3, C.r, bob) // penacho
  box(11, 4, 10, 4, C.A, bob) // yelmo
  box(12, 7, 8, 7, C.s, bob) // cara
  box(14, 10, 1, 1, frame === 1 ? C.s : C.e, bob) // ojos (parpadeo en el fotograma 2)
  box(17, 10, 1, 1, frame === 1 ? C.s : C.e, bob)
  box(10, 14, 12, 8, C.a, bob) // armadura
  box(11, 15, 2, 5, C.A, bob)
  box(10, 21, 12, 1, C.g, bob) // cinturón
  box(8, 15, 2, 7, C.a, bob) // brazos
  box(22, 15, 2, 7, C.a, bob)
  box(8, 22, 2, 1, C.s, bob)
  box(22, 22, 2, 1, C.s, bob)
  box(25, 8, 1, 12, C.w, bob) // espada
  box(24, 20, 3, 1, C.g, bob)
  box(12, 23, 3, 5, C.a) // piernas (no se mueven)
  box(17, 23, 3, 5, C.a)
  box(11, 28, 4, 2, C.b) // botas
  box(17, 28, 4, 2, C.b)
  // contorno: cada vacío junto a un relleno pasa a tinta
  const filled = (i: number, j: number) => j >= 0 && j < 32 && i >= 0 && i < 32 && g[j][i] !== null && g[j][i] !== C.k
  const out = g.map(row => [...row])
  for (let j = 0; j < 32; j++)
    for (let i = 0; i < 32; i++)
      if (g[j][i] === null && (filled(i - 1, j) || filled(i + 1, j) || filled(i, j - 1) || filled(i, j + 1))) out[j][i] = C.k
  return out
}

function rects(g: Grid): string {
  let s = ''
  for (let y = 0; y < 32; y++) {
    let x = 0
    while (x < 32) {
      const c = g[y][x]
      if (!c) {
        x++
        continue
      }
      let w = 1
      while (x + w < 32 && g[y][x + w] === c) w++
      s += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`
      x += w
    }
  }
  return s
}

const FRAME_A = rects(sprite(0))
const FRAME_B = rects(sprite(1))
const STATE_COLOR: Record<string, string> = { idle: '#7f8c8d', running: '#f1c40f', done: '#2ecc71', error: '#e74c3c', aborted: '#e67e22', lost: '#9b59b6' }

// 2 fotogramas en 0.25 s con calcMode discreto = 8 fps
function svgDoc(state: string, isAnimated: boolean, px: number): string {
  const bar = `<rect x="2" y="33" width="28" height="2" fill="${STATE_COLOR[state] ?? STATE_COLOR.idle}"/>`
  const a = isAnimated ? '<animate attributeName="opacity" values="1;0" dur="0.25s" calcMode="discrete" repeatCount="indefinite"/>' : ''
  const b = isAnimated ? `<g opacity="0">${FRAME_B}<animate attributeName="opacity" values="0;1" dur="0.25s" calcMode="discrete" repeatCount="indefinite"/></g>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36" width="${px}" height="${Math.round((px * 36) / 32)}" shape-rendering="crispEdges"><g>${FRAME_A}${a}</g>${b}${bar}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const version = await $.session.version().catch(() => null)
    const env = {
      CLAUDE_CODE_EFFORT_LEVEL: (await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')) ?? null,
      CLAUDE_CODE_SUBAGENT_MODEL: (await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL')) ?? null,
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: (await $.env.get('CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH')) ?? null,
    }

    // P6: el estado del host sobrevive a una recarga del mod; $.store, a un reinicio.
    const boots = (Number(await $.store.get('boots')) || 0) + 1
    await $.store.set('boots', boots)
    const inState = await read($, agentsA)
    let source = 'state'
    let lost: string[] = []
    if (inState.length > 0) {
      for (const a of inState) roleOf.set(a.id, a.role) // recarga: los agentes del proceso siguen vivos
    } else {
      const saved = ((await $.store.get('agents')) as AgentRow[] | undefined) ?? []
      source = saved.length > 0 ? 'store' : 'empty'
      const restored = saved.map(a => (a.state === 'running' ? { ...a, state: 'lost' as const } : a))
      lost = saved.filter(a => a.state === 'running').map(a => a.id)
      if (restored.length > 0) {
        await update($, agentsA, () => restored)
        await saveAgents($, restored)
      }
    }
    await log($, 'session.start', { sessionId: await $.session.id(), version, env, boots, restoreSource: source, lostAgents: lost })

    await $.tool.register({
      name: 'run_check',
      description: 'GuildFlow PoC: ejecuta una comprobación permitida por identificador (sin shell, argv fijo). Solo para el Paladín y el Maestro.',
      inputSchema: { type: 'object', required: ['check'], properties: { check: { enum: Object.keys(CHECKS) } }, additionalProperties: false },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'poc_control',
      description: 'GuildFlow PoC: control de pruebas para el Maestro (status, set_limit, arm_stop, throw_guard, open_panel, anim, note, simulate_running).',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { enum: ['status', 'set_limit', 'arm_stop', 'throw_guard', 'open_panel', 'anim', 'note', 'simulate_running'] },
          value: { type: ['number', 'boolean', 'string'] },
        },
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'poc-panel', description: 'GuildFlow PoC: abre el panel de prueba' })

    // P8: registro dinámico con permissionMode más restrictivo (plan)
    try {
      const r = await $.agent.register({
        name: 'reg-probe',
        description: 'GuildFlow PoC P8: sonda de registro dinámico; solo PoC.',
        prompt: 'Eres una sonda de prueba. Ejecuta exactamente la operación pedida una vez e informa literalmente del resultado o del rechazo.',
        tools: ['Read', 'Glob', 'Write', 'Edit'],
        model: 'claude-haiku-5-5',
        effort: 'low',
        permissionMode: 'plan',
        maxTurns: 3,
      })
      await log($, 'p8.agent.register', { ok: true, result: r as unknown as Raw })
    } catch (err) {
      await log($, 'p8.agent.register', { ok: false, error: String(err) })
    }

    return next(e)
  })

  on('command.run', { command: 'poc-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: 'GuildFlow PoC' })
    return { text: 'Panel de la PoC abierto.' }
  })

  // P1/P2 + no delegación + límite de lanzamientos
  on('agent.spawn', async ($, e, next) => {
    const role = ROLES[e.subagentType]
    await log($, 'agent.spawn.request', {
      subagentType: e.subagentType,
      requestedModel: e.model ?? null,
      parentModel: e.parentModel,
      parentAgentId: e.parentAgentId ?? null,
      background: e.background,
      permissionMode: e.permissionMode ?? null,
    })
    if (e.parentAgentId) {
      await log($, 'agent.spawn.deny', { reason: 'delegation', parentAgentId: e.parentAgentId })
      return { deny: 'GuildFlow PoC: un subagente no puede delegar; solo el Maestro asigna agentes.' }
    }
    if (role) {
      const ctl = await read($, ctlA)
      if (ctl.spawnCount >= ctl.spawnLimit) {
        await log($, 'agent.spawn.deny', { reason: 'limit', spawnCount: ctl.spawnCount, spawnLimit: ctl.spawnLimit })
        return { deny: `GuildFlow PoC: límite de ${ctl.spawnLimit} agentes alcanzado; no se lanzan más.` }
      }
      await update($, ctlA, c => ({ ...c, spawnCount: c.spawnCount + 1 }))
    }
    const started = await next(role ? { ...e, model: role.model } : e)
    await log($, 'agent.spawn.result', {
      subagentType: e.subagentType,
      enforcedModel: role?.model ?? null,
      resolvedModel: started.model ?? null,
      agentId: started.agentId ?? null,
      deny: started.deny ?? null,
    })
    if (role && started.agentId) {
      roleOf.set(started.agentId, e.subagentType)
      const row: AgentRow = {
        id: started.agentId,
        role: e.subagentType,
        state: 'running',
        requestedModel: e.model ?? null,
        model: started.model ?? null,
        effort: null,
        tokens: 0,
        startedAt: await $.clock.now(),
        endedAt: null,
      }
      await update($, agentsA, list => [...list, row].slice(-30))
      await saveAgents($, await read($, agentsA))
    }
    return started
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'GuildFlow PoC: la guarda de lanzamiento falló; se rechaza por seguridad.' }))

  // P2: el esfuerzo y el modelo que viajan en cada petición del subagente
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const type = id ? (roleOf.get(id) ?? null) : null
    const role = type ? ROLES[type] : undefined
    if (!id && e.index === 0) await log($, 'turn.step.main', { model: e.model, effort: e.effort ?? null })
    let sent = e
    if (id && role) {
      const isRewritten = !e.model.startsWith(role.model) || e.effort !== role.effort
      await log($, 'turn.step', {
        agentId: id,
        role: type,
        index: e.index,
        seenModel: e.model,
        seenEffort: e.effort ?? null,
        sentModel: isRewritten ? role.model : e.model,
        sentEffort: role.effort,
        rewritten: isRewritten,
      })
      if (e.index === 0) await editAgent($, id, a => ({ ...a, model: isRewritten ? role.model : e.model, effort: role.effort }))
      if (isRewritten) sent = { ...e, model: role.model, effort: role.effort }
    }
    // P5: uso exacto de cada petición y cost.usd de la sesión antes y después
    const costNow = async () => (await $.session.usage().catch(() => null))?.cost?.usd ?? null
    const before = await costNow()
    const r = yield* next(sent)
    const after = await costNow()
    await log($, 'p5.request', {
      agentId: id ?? null,
      index: e.index,
      model: r.usage?.model ?? null,
      usage: (r.usage as unknown as Raw) ?? null,
      costBefore: before,
      costAfter: after,
      delta: before !== null && after !== null ? after - before : null,
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    await log($, 'turn.start', { turnId: e.turnId })
    return next(e)
  })

  // P5 + estado de los agentes
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    const tokens = u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : 0
    const id = e.agentId
    const type = id ? (roleOf.get(id) ?? null) : null
    await log($, 'turn.complete', { agentId: id ?? null, role: type, reason: e.reason, usage: (u as unknown as Raw) ?? null, tokens })
    await update($, usageA, s =>
      id ? { ...s, agentTokens: s.agentTokens + tokens, agentTurns: s.agentTurns + 1 } : { ...s, mainTokens: s.mainTokens + tokens, mainTurns: s.mainTurns + 1 },
    )
    if (id && type) {
      const state = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'aborted' : 'error'
      const now = await $.clock.now()
      await editAgent($, id, a => ({ ...a, state, tokens: a.tokens + tokens, endedAt: now }))
    }
    return next(e)
  })

  // P3 + guardas transversales: lista blanca de herramientas por rol y veto de rutas, en el hook
  on('tool.call', async ($, e, next) => {
    const raw = e as unknown as Raw
    if (!e.agentId) return next(e) // el Maestro (sesión principal) no está restringido por esta PoC
    const type = await roleFor($, e.agentId)
    if (type === null) return next(e) // agentes ajenos al gremio
    if ((await read($, ctlA)).throwGuard) throw new Error('P3: fallo inyectado en la guarda')
    const { verdict, target } = await judge($, type, ROLES[type], raw)
    await log($, 'tool.call', { agentId: e.agentId, role: type, tool: e.tool, target, verdict, decision: verdict ? 'deny' : 'allow' })
    if (verdict) {
      $.ui.toast(`GuildFlow PoC: rechazado ${e.tool} de ${type.replace('guildflow-poc:', '')}`)
      return { deny: `GuildFlow PoC: ${verdict}` }
    }
    return next(e)
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    try {
      await log($, 'tool.call.guard-failed', { agentId: e.agentId ?? null, tool: e.tool, error: String(next.error?.kind ?? 'error') })
    } catch {
      // el rechazo no depende del registro
    }
    return { deny: 'GuildFlow PoC: la guarda de rutas falló; la operación se rechaza por seguridad.' }
  })

  on('tool.call', { tool: RUN_CHECK }, async ($, e) => {
    const raw = e as unknown as Raw
    if (e.agentId && roleOf.get(e.agentId) !== 'guildflow-poc:paladin') return { deny: 'GuildFlow PoC: run_check es solo del Paladín.' }
    const id = String(raw.check)
    const argv = CHECKS[id]
    if (!argv) return { deny: `GuildFlow PoC: comprobación desconocida "${id}"; permitidas: ${Object.keys(CHECKS).join(', ')}` }
    const r = await $.process.run(argv, { cwd: SANDBOX_ABS, timeoutMs: 20_000 })
    await log($, 'run_check', { agentId: e.agentId ?? null, check: id, argv, exitCode: r.exitCode, stdout: r.stdout.slice(0, 500) })
    return { result: JSON.stringify({ check: id, argv, exitCode: r.exitCode, stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) }) }
  }).catch(() => ({ deny: 'GuildFlow PoC: run_check falló; sin resultado.' }))

  on('tool.call', { tool: CONTROL }, async ($, e) => {
    if (e.agentId) return { deny: 'GuildFlow PoC: poc_control es solo del Maestro.' }
    const raw = e as unknown as Raw
    const action = String(raw.action)
    const value = raw.value
    if (action === 'set_limit') await update($, ctlA, c => ({ ...c, spawnLimit: Number(value) }))
    if (action === 'arm_stop') await update($, ctlA, c => ({ ...c, p4Armed: true }))
    if (action === 'throw_guard') await update($, ctlA, c => ({ ...c, throwGuard: value === true }))
    if (action === 'anim') await update($, ctlA, c => ({ ...c, anim: value === true }))
    if (action === 'open_panel') await $.ui.open({ id: PANE, title: 'GuildFlow PoC' })
    if (action === 'note') await log($, 'note', { text: String(value) })
    // P6: fila sintética "running" (declarada como simulada) para comprobar la recuperación tras reiniciar Desktop
    if (action === 'simulate_running') {
      const row: AgentRow = { id: `synthetic-${await $.clock.now()}`, role: 'guildflow-poc:artifice', state: 'running', requestedModel: null, model: 'synthetic', effort: null, tokens: 0, startedAt: await $.clock.now(), endedAt: null }
      await update($, agentsA, list => [...list, row])
      await saveAgents($, await read($, agentsA))
      await log($, 'p6.simulate_running', { id: row.id })
    }
    const usage = await $.session.usage().catch(err => ({ error: String(err) }))
    const status = {
      ctl: await read($, ctlA),
      usage: await read($, usageA),
      sessionUsage: usage,
      agents: await read($, agentsA),
      roleMap: [...roleOf.entries()],
      agentList: await $.agent.list().catch(err => String(err)),
    }
    if (action !== 'status') await log($, 'poc_control', { action, value: value ?? null })
    return { result: JSON.stringify(status) }
  })

  // P4: bloquea una sola vez y solo si se armó; respeta stop_hook_active
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const ctl = await read($, ctlA)
    if (!ctl.p4Armed) return result
    if (e.stop_hook_active) {
      await log($, 'p4.stop', { stop_hook_active: true, action: 'pass' })
      return result
    }
    await update($, ctlA, c => ({ ...c, p4Armed: false }))
    await log($, 'p4.stop', { stop_hook_active: false, action: 'block-once' })
    return { ...result, block: 'GuildFlow PoC P4: bloqueo único de prueba. Responde solo "P4 recibido" y termina.' }
  })

  // P7: panel y banda
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ctl = await read($, ctlA)
    const agents = await read($, agentsA)
    const usage = await read($, usageA)
    const last = agents[agents.length - 1]
    const state = last?.state ?? 'idle'
    const label = last ? `${last.role.replace('guildflow-poc:', '')} · ${state} · ${last.model ?? '?'} · ${last.effort ?? '?'}` : 'sin agentes'
    if (e.surface !== 'desktop') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text>GuildFlow PoC (superficie sin SVG): {label}</Text>
        </Box>
      )
    }
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>GuildFlow PoC — Fase 1</Text>
        <Svg source={svgDoc(state, ctl.anim, 128)} alt={`Aventurero pixel art, estado ${state}`} width={128} height={144} isInteractive={ctl.anim ? true : undefined} />
        <Text>{label}</Text>
        <Text dimColor>{`tokens · principal ${usage.mainTokens} (${usage.mainTurns} turnos) · subagentes ${usage.agentTokens} (${usage.agentTurns})`}</Text>
        <Text dimColor>{`lanzamientos ${ctl.spawnCount}/${ctl.spawnLimit} · animación ${ctl.anim ? 'SMIL 8 fps' : 'estática'}`}</Text>
        {agents.slice(-6).map(a => (
          <Text key={a.id} dimColor>{`${a.role.replace('guildflow-poc:', '')} ${a.state} ${a.model ?? '?'} ${a.effort ?? '?'} ${a.tokens} tok`}</Text>
        ))}
        <Button label={ctl.anim ? 'Animación: desactivar' : 'Animación: activar'} onPress={() => update($, ctlA, c => ({ ...c, anim: !c.anim }))} />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const agents = await read($, agentsA)
    const ctl = await read($, ctlA)
    const last = agents[agents.length - 1]
    if (!last) return next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Svg source={svgDoc(last.state, ctl.anim, 32)} alt={`Agente ${last.state}`} width={32} height={36} isInteractive={ctl.anim ? true : undefined} />
        <Text>{`GuildFlow PoC · ${last.role.replace('guildflow-poc:', '')} · ${last.state}`}</Text>
      </Box>
    )
  })
}
