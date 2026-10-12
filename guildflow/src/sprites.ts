// Oficina del gremio en pixel art: compone el arte de src/art.ts en una cuadrícula de 200×120 y la codifica como
// SVG (un <path> por color, tramos horizontales). Funciones puras: reciben una SceneView ya derivada de la misión
// (src/presentation.tsx) y no leen la misión. La animación es SMIL discreta de dos fotogramas y solo dibuja lo que
// cambia entre ellos; sin animar se dibuja un único fotograma.
import * as A from './art'

export type Station = 'maestro' | 'archimago' | 'artifice' | 'paladin' | 'escriba'
/** Pose de un puesto. awaiting solo la usa el Maestro (espera la aprobación de la persona). */
export type Pose = 'idle' | 'working' | 'thinking' | 'reviewing' | 'success' | 'blocked' | 'lost' | 'awaiting'
/** Estado de una nota del tablón de encargos (una por subtarea). */
export type NoteState = 'pending' | 'active' | 'checking' | 'review' | 'queued' | 'done' | 'blocked'
/** Icono de la placa del mostrador: resumen global de la misión. */
export type Plaque = 'none' | 'working' | 'awaiting' | 'blocked' | 'paused' | 'halted' | 'done'
/**
 * Lo que dibuja la escena; todo sale de datos reales. sheets: hojas apiladas junto al Escriba (eventos de la
 * bitácora); treasure: nivel de monedas del cofre (0 vacío … 4 cerca del límite del presupuesto).
 */
export type SceneView = { poses: Record<Station, Pose>; notes: { state: NoteState; current: boolean }[]; plaque: Plaque; sheets: number; treasure: 0 | 1 | 2 | 3 | 4 }

export const SCENE_W = 200
export const SCENE_H = 120
const WALL = 44 // filas de pared; debajo, el suelo

type Grid = (string | null)[]
const hex = (k: string) => A.PAL[k] ?? k
const grid = (): Grid => Array<string | null>(SCENE_W * SCENE_H).fill(null)
const put = (g: Grid, x: number, y: number, c: string | null | undefined) => {
  if (c && x >= 0 && y >= 0 && x < SCENE_W && y < SCENE_H) g[y * SCENE_W + x] = c
}
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(g, i, j, hex(c))
}
/** Huella fija por coordenada (variación de ladrillos y tablones sin azar). */
const noise = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0

/** Pega un mapa; con contorno, cada hueco vecino del dibujo (4 direcciones) pasa a tinta. */
function blit(g: Grid, rows: readonly string[], color: (ch: string, x: number, y: number) => string | null, x0: number, y0: number, outline = false) {
  const at = (i: number, j: number) => {
    const ch = rows[j]?.[i]
    return ch && ch !== '.' ? ch : null
  }
  const w = Math.max(...rows.map(r => r.length))
  if (outline)
    for (let j = -1; j <= rows.length; j++)
      for (let i = -1; i <= w; i++)
        if (!at(i, j) && (at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1))) put(g, x0 + i, y0 + j, A.INK)
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) {
      const ch = r[i]!
      if (ch !== '.') put(g, x0 + i, y0 + j, color(ch, x0 + i, y0 + j))
    }
  })
}
const sprite = (g: Grid, s: A.Sprite, x: number, y: number, outline = false) => blit(g, s.rows, ch => hex(s.key[ch] ?? ch), x, y, outline)

/** Ladrillo cocido de la fragua: piezas de 6×3, más cálido que la pared para que el hogar destaque. */
function brick(x: number, y: number): string {
  const row = Math.floor(y / 3)
  const off = row % 2 ? 3 : 0
  if (y % 3 === 2 || (x + off) % 6 === 5) return '#4a2c25'
  return noise(Math.floor((x + off) / 6), row) % 5 === 0 ? '#6e3f31' : y % 3 === 0 ? '#9a6049' : '#83503d'
}

/** Sillería: ladrillos de 10×5 a tresbolillo, juntas oscuras y alguna pieza más oscura o con luz arriba. */
function stone(x: number, y: number): string {
  const row = Math.floor(y / 5)
  const off = row % 2 ? 5 : 0
  const bx = Math.floor((x + off) / 10)
  if (y % 5 === 4 || (x + off) % 10 === 9) return hex('mo')
  const n = noise(bx, row) % 7
  if (y % 5 === 0 && n > 1) return hex('sl')
  return hex(n === 0 ? 'sd' : 'st')
}

// ---------------- personajes ----------------

/** Capas de un personaje en una pose y fotograma: cuerpo, cara, cabeza, brazos y accesorio. */
function figure(s: Station, pose: Pose, f: 0 | 1): string[] {
  const props = A.PROPS[s] ?? {}
  const pick = (a: string, b?: string) => (f === 1 && b && props[b] ? props[b] : props[a])
  let arms = 'idle'
  let prop: string[] | undefined = props.idle
  switch (pose) {
    case 'working':
      if (s === 'archimago') (arms = 'front'), (prop = pick('workA', 'workB'))
      else (arms = f ? 'reach' : 'raise'), (prop = pick('workA', 'workB'))
      break
    case 'thinking':
      arms = 'think'
      prop = f ? props.thinkB : undefined
      break
    case 'reviewing':
      arms = 'front'
      prop = pick('reviewA', 'reviewB')
      break
    case 'success':
      arms = 'cheer'
      prop = undefined
      break
    case 'blocked':
      arms = 'stuck'
      prop = s === 'artifice' ? undefined : props.idle
      break
    case 'awaiting':
      arms = 'raise'
      prop = props.awaiting
      break
    case 'lost':
      prop = undefined
  }
  if (s === 'paladin' && pose !== 'success' && pose !== 'reviewing' && pose !== 'lost') prop = [...(pose === 'working' ? mergeRows(props.idle!, prop!) : props.idle!)]
  const layers = [s === 'archimago' || s === 'escriba' ? A.ROBE : A.TUNIC, A.FACE, A.HEADS[s]!, A.ARMS[arms]!, ...(prop ? [prop] : [])]
  return layers.reduce((acc, l) => mergeRows(acc, l))
}
const mergeRows = (a: readonly string[], b: readonly string[]) => a.map((r, j) => [...r].map((c, i) => (b[j]?.[i] && b[j]![i] !== '.' ? b[j]![i] : c)).join(''))

/** Dibuja un personaje con su sombra en el suelo y, si toca, su insignia. */
function character(g: Grid, s: Station, pose: Pose, f: 0 | 1, x: number, y: number, shadow = true) {
  if (shadow) rect(g, x + 4, y + 24, 10, 2, 'sh'), rect(g, x + 3, y + 25, 12, 1, 'sh')
  const role = pose === 'lost' ? A.LOST_COLORS : A.ROLE_COLORS[s]!
  blit(g, figure(s, pose, f), ch => role[ch] ?? hex(A.FIXED[ch] ?? 'ink'), x, y, true)
  const badge = pose === 'awaiting' ? 'awaiting' : pose === 'blocked' ? 'blocked' : pose === 'lost' ? 'lost' : pose === 'success' && s === 'maestro' ? 'success' : null
  if (badge) sprite(g, A.BADGES[badge]!, x, y - 2, true)
}

// ---------------- la sala ----------------

/** Pared de sillería con viga y zócalo; suelo de tablones; piedra de la fragua; alfombra y tapiz de prácticas. */
function room(g: Grid) {
  for (let y = 0; y < SCENE_H; y++)
    for (let x = 0; x < SCENE_W; x++) {
      let c: string
      if (y < 3) c = hex(y === 2 ? 'w0' : 'w1')
      else if (y < WALL - 2) c = stone(x, y)
      else if (y < WALL) c = hex(y === WALL - 2 ? 'w2' : 'w0')
      else {
        const p = Math.floor((y - WALL) / 6)
        const seam = (x + ((p * 17) % 37)) % 37 === 0
        c = hex((y - WALL) % 6 === 5 || seam ? 'f0' : (y - WALL) % 6 === 0 ? 'f3' : noise(Math.floor((x + p * 17) / 37), p) % 3 ? 'f2' : 'f1')
      }
      put(g, x, y, c)
    }
  // alfombra del mostrador
  rect(g, 72, 76, 56, 18, 'c0')
  rect(g, 73, 77, 54, 16, 'g0')
  rect(g, 75, 78, 50, 14, 'c1')
  for (let x = 79; x < 123; x += 6) rect(g, x, 84, 2, 2, 'g1'), rect(g, x + 3, 81, 1, 1, 'c2'), rect(g, x + 3, 88, 1, 1, 'c2')
  // tapiz de prácticas del Paladín
  rect(g, 110, 90, 90, 30, 'w1')
  rect(g, 111, 91, 89, 29, 'y0')
  for (let y = 92; y < SCENE_H; y++) for (let x = 112; x < SCENE_W; x++) if ((x + y) % 2 === 0 && noise(x, y) % 3) put(g, x, y, hex('y1'))
}

/** Estantería con lomos de libros fijos y algún frasco. */
function shelf(g: Grid, x0: number, y0: number) {
  const { w, h, shelves } = A.SHELF
  rect(g, x0, y0, w, h, 'w1')
  rect(g, x0 + 2, y0 + 2, w - 4, h - 3, 'w0')
  const spines = ['v1', 'c1', 'b1', 'ok0', 'g1', 'w3', 'c2', 'b0', 'v0', 'y1']
  for (const [k, sy] of shelves.entries()) {
    rect(g, x0 + 1, y0 + sy, w - 2, 2, 'w3')
    rect(g, x0 + 1, y0 + sy + 1, w - 2, 1, 'w2')
    if (k === shelves.length - 1) break
    let x = x0 + 3
    let n = k * 5
    while (x < x0 + w - 4) {
      const bw = 2 + (noise(n, k) % 2)
      const bh = 5 + (noise(n, k + 9) % 3)
      if (noise(n, k + 3) % 9 === 0) {
        // frasco
        rect(g, x, y0 + sy + 8 - 3, 3, 3, n % 2 ? 'ok1' : 'v2'), put(g, x + 1, y0 + sy + 8 - 4, hex('m2'))
        x += 4
      } else {
        rect(g, x, y0 + sy + 9 - bh, bw, bh, spines[noise(n, k + 5) % spines.length]!)
        put(g, x, y0 + sy + 9 - bh + 1, hex('g2'))
        x += bw + (noise(n, k + 7) % 4 === 0 ? 1 : 0)
      }
      n++
    }
  }
  rect(g, x0, y0 + h, w, 1, 'sh')
}

/** Tablón de encargos con una nota por subtarea (color del estado; marco dorado en la activa). */
const NOTE_COLOR: Record<NoteState, [string, string | null]> = {
  pending: ['m1', null],
  active: ['e2', 'e2'],
  checking: ['e1', 'e3'],
  review: ['b1', 'b1'],
  queued: ['g1', 'g2'],
  done: ['ok1', 'ok1'],
  blocked: ['no1', 'no1'],
}
function board(g: Grid, x0: number, y0: number, notes: SceneView['notes']) {
  const { w, h } = A.BOARD_FRAME
  rect(g, x0, y0, w, h, 'w1')
  rect(g, x0 + 1, y0 + 1, w - 2, h - 2, 'w3')
  rect(g, x0 + 2, y0 + 6, w - 4, h - 8, 'y0')
  for (let y = y0 + 6; y < y0 + h - 2; y++) for (let x = x0 + 2; x < x0 + w - 2; x++) if (noise(x, y) % 11 === 0) put(g, x, y, hex('w2'))
  rect(g, x0 + 14, y0 + 1, 18, 4, 'g1')
  rect(g, x0 + 15, y0 + 2, 16, 2, 'g2')
  put(g, x0 + 15, y0 + 2, hex('g0')), put(g, x0 + 30, y0 + 2, hex('g0'))
  notes.slice(0, 8).forEach((n, i) => {
    const x = x0 + 4 + (i % 4) * 10
    const y = y0 + 7 + Math.floor(i / 4) * 11
    const [pin, seal] = NOTE_COLOR[n.state]
    if (n.current) rect(g, x - 1, y, 10, 11, 'g2')
    blit(g, A.NOTE, ch => (ch === 'n' ? hex(pin) : ch === 'S' ? hex(seal ?? 'p2') : ch === 'k' ? hex('p0') : hex(ch === 'P' ? 'p2' : 'p1')), x, y)
  })
  rect(g, x0, y0 + h, w, 1, 'sh')
}

/** Un personaje suelto en una cuadrícula de escena (esquina en 1,3): para la hoja de personajes y Aseprite. */
export function portrait(s: Station, pose: Pose, f: 0 | 1): Grid {
  const g = grid()
  character(g, s, pose, f, 1, 3, false)
  return g
}

/** Dónde está cada puesto (esquina superior izquierda del personaje). */
export const POSTS: Record<Station, { x: number; y: number }> = {
  archimago: { x: 8, y: 45 },
  maestro: { x: 90, y: 40 },
  artifice: { x: 121, y: 45 },
  escriba: { x: 6, y: 84 },
  paladin: { x: 140, y: 84 },
}
const fireLit = (p: Pose) => p === 'working' || p === 'reviewing'
const arcane = (p: Pose) => p === 'working' || p === 'thinking'

/** Un fotograma completo de la oficina (colores por píxel; null = nada). También lo usan las herramientas de arte. */
export function compose(v: SceneView, f: 0 | 1): Grid {
  const g = grid()
  const P = v.poses
  room(g)
  // pared del fondo
  shelf(g, 4, 3)
  sprite(g, A.WINDOW, 36, 9)
  sprite(g, A.SCONCE, 62, 14), sprite(g, A.SCONCE, 144, 14)
  board(g, 76, 4, v.notes)
  sprite(g, A.BANNER, 128, 8)
  // fragua: hogar de sillería, fuego vivo solo con el Artífice trabajando o probando la pieza
  blit(g, A.FORGE.rows, (ch, x, y) => (ch === '#' ? brick(x, y) : hex(A.FORGE.key[ch] ?? ch)), 158, 0, true)
  const lit = fireLit(P.artifice)
  blit(g, lit ? (f ? A.FLAME_B : A.FLAME_A) : A.EMBERS, ch => hex(A.FIRE_KEY[ch] ?? 'e0'), 169, 33)
  // fila del fondo: Archimago y su mesa, Maestro tras el mostrador, Artífice con yunque y barril
  character(g, 'archimago', P.archimago, f, POSTS.archimago.x, POSTS.archimago.y)
  rect(g, 28, 70, 34, 1, 'sh')
  sprite(g, A.DESK, 28, 57, true)
  sprite(g, A.BOOKSTACK, 50, 55, true)
  sprite(g, arcane(P.archimago) ? A.ORB_ON : A.ORB_OFF, 40, 51, true)
  if (arcane(P.archimago)) for (const [dx, dy] of [[-2, 1], [8, 2], [3, -2]] as const) put(g, 40 + dx + (f ? 1 : 0), 51 + dy, hex('v3'))
  character(g, 'maestro', P.maestro, f, POSTS.maestro.x, POSTS.maestro.y, false)
  rect(g, 76, 72, 46, 2, 'sh')
  sprite(g, A.COUNTER, 76, 56, true)
  sprite(g, A.CANDLE, 78, 47, true)
  sprite(g, A.SCROLLS, 81, 51, true)
  sprite(g, A.LEDGER, 107, 51, true)
  if (v.plaque !== 'none') {
    sprite(g, A.PLAQUE, 93, 62, true)
    sprite(g, A.PLAQUE_ICON[v.plaque]!, 97, 65)
  }
  character(g, 'artifice', P.artifice, f, POSTS.artifice.x, POSTS.artifice.y)
  rect(g, 141, 70, 16, 1, 'sh')
  sprite(g, A.ANVIL, 140, 60, true)
  if (P.artifice === 'working' && f) blit(g, A.SPARKS, ch => hex(A.FIRE_KEY[ch]!), 142, 53)
  rect(g, 185, 71, 12, 1, 'sh')
  sprite(g, A.BARREL, 185, 58, true)
  // fila de delante: Escriba con atril y crónica, cofre del tesoro, campo de pruebas del Paladín
  character(g, 'escriba', P.escriba, f, POSTS.escriba.x, POSTS.escriba.y)
  rect(g, 24, 110, 16, 1, 'sh')
  sprite(g, A.LECTERN, 23, 92, true)
  rect(g, 46, 109, 14, 1, 'sh')
  sprite(g, A.STOOL, 46, 102, true)
  for (let i = 0; i < Math.min(6, v.sheets); i++) sprite(g, A.SHEET, 48 + (i % 2), 100 - i * 2, true)
  rect(g, 90, 110, 20, 1, 'sh')
  sprite(g, A.CHEST, 90, 98, true)
  coins(g, 90, 98, v.treasure)
  rect(g, 114, 108, 14, 1, 'sh')
  sprite(g, A.RULEBOOK, 114, 94, true)
  character(g, 'paladin', P.paladin, f, POSTS.paladin.x, POSTS.paladin.y)
  rect(g, 162, 108, 12, 1, 'sh')
  sprite(g, A.DUMMY, P.paladin === 'working' && f ? 161 : 160, 84, true)
  rect(g, 182, 107, 14, 1, 'sh')
  sprite(g, A.RACK, 182, 86, true)
  return g
}

/** Montón de monedas: 0 vacío, 1–3 creciente, 4 rebosa (cerca del límite). */
function coins(g: Grid, x0: number, y0: number, level: SceneView['treasure']) {
  if (!level) return
  const top = y0 + 4 - [0, 1, 2, 4, 6][level]!
  for (let y = top; y <= y0 + 4; y++)
    for (let x = x0 + 1; x < x0 + 19; x++) {
      const d = Math.abs(x - (x0 + 9.5)) / 9.5
      if (y >= top + Math.floor(d * d * (y0 + 4 - top + 1))) put(g, x, y, hex((x + y) % 3 ? 'g1' : 'g2'))
    }
  if (level === 4) for (const [dx, dy] of [[-3, 11], [-1, 12], [21, 11], [23, 12]] as const) put(g, x0 + dx, y0 + dy, hex('g2'))
}

// ---------------- codificación SVG ----------------

/** Un <path> por color: tramos horizontales con movimientos relativos (mucho menos texto que un rect por píxel). */
function encode(g: Grid): string {
  const runs = new Map<string, number[]>()
  for (let y = 0; y < SCENE_H; y++)
    for (let x = 0; x < SCENE_W; ) {
      const c = g[y * SCENE_W + x]
      let w = 1
      while (c && x + w < SCENE_W && g[y * SCENE_W + x + w] === c) w++
      if (c) {
        let r = runs.get(c)
        if (!r) runs.set(c, (r = []))
        r.push(x, y, w)
      }
      x += w
    }
  let out = ''
  for (const [c, r] of runs) {
    let d = ''
    let px = 0
    let py = 0
    for (let i = 0; i < r.length; i += 3) {
      const [x, y, w] = [r[i]!, r[i + 1]!, r[i + 2]!]
      d += i === 0 ? `M${x} ${y + 0.5}h${w}` : `m${x - px} ${y - py}h${w}`
      px = x + w
      py = y
    }
    out += `<path stroke="${c}" d="${d}"/>`
  }
  return out
}

/** ¿Hay algo que animar? (faena, reflexión del Archimago o pieza al rojo). Sin esto, la escena es una imagen. */
export const animates = (v: SceneView) => Object.values(v.poses).some(p => p === 'working' || p === 'reviewing') || v.poses.archimago === 'thinking'

const cache = new Map<string, string>()
/** La oficina del gremio como SVG. Animada: el fotograma B solo lleva los píxeles que cambian. */
export function scene(v: SceneView, animate: boolean, scale = 2): string {
  const anim = animate && animates(v)
  const key = `${JSON.stringify(v)}|${anim}|${scale}`
  const hit = cache.get(key)
  if (hit) return hit
  const a = compose(v, 0)
  let overlay = ''
  if (anim) {
    const b = compose(v, 1)
    const diff = b.map((c, i) => (c !== a[i] ? c : null))
    overlay = `<g opacity="0">${encode(diff)}<animate attributeName="opacity" values="0;1" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/></g>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_W} ${SCENE_H}" width="${SCENE_W * scale}" height="${SCENE_H * scale}" shape-rendering="crispEdges" fill="none">${encode(a)}${overlay}</svg>`
  if (cache.size > 48) cache.clear()
  cache.set(key, svg)
  return svg
}
