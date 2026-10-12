// Tablón del gremio: sprites pixel art 32×32 ORIGINALES y procedurales (rectángulos), sin archivos binarios.
// Cada estación = personaje + su mueble. Dos fotogramas de faena y una pose de reposo. La animación es SMIL discreta
// (validada en la P7); sin animar se dibuja solo un fotograma. Funciones puras: no leen la misión.

export type Station = 'maestro' | 'archimago' | 'artifice' | 'paladin' | 'escriba'
/** work = trabaja (anima), rest = en reposo, alert = necesita a la persona (signo «!»). */
export type Pose = 'work' | 'rest' | 'alert'

type Grid = (string | null)[][]
type Box = (x: number, y: number, w: number, h: number, c: string) => void

const N = 32
const INK = '#1b1b2f'
const P = {
  skin: '#f2c9a0', boot: '#4a2f1d', leg: '#3d3d55', wood: '#7a5230', woodL: '#a8743f', steel: '#aab7b8', steelD: '#5d6d7e',
  gold: '#e8c547', paper: '#efe3c0', red: '#c0392b', ember: '#ff9f43', straw: '#d9b65d', white: '#f4f6f7',
}

/** Figura común: cabeza, cuerpo con túnica, brazo izquierdo, piernas. El brazo derecho y la herramienta van en act(). */
function body(box: Box, robe: string, accent: string) {
  box(7, 8, 6, 6, P.skin)
  box(8, 10, 1, 1, INK)
  box(11, 10, 1, 1, INK)
  box(6, 14, 8, 10, robe)
  box(6, 19, 8, 1, accent)
  box(4, 15, 2, 6, robe)
  box(4, 21, 2, 1, P.skin)
  box(7, 24, 2, 4, P.leg)
  box(11, 24, 2, 4, P.leg)
  box(6, 28, 3, 2, P.boot)
  box(11, 28, 3, 2, P.boot)
}
const armDown = (box: Box, robe: string) => (box(14, 15, 2, 6, robe), box(14, 21, 2, 1, P.skin))
const armUp = (box: Box, robe: string) => (box(14, 11, 2, 5, robe), box(14, 10, 2, 1, P.skin))

type Role = { robe: string; accent: string; hat: (b: Box) => void; prop: (b: Box) => void; act: (b: Box, f: 0 | 1) => void; rest?: (b: Box) => void }
/** act(0) y act(1) son los dos fotogramas de la faena; en reposo se usa rest, o act(0) si el rol no lo define. */
const ROLES: Record<Station, Role> = {
  // Mostrador de misiones: el Maestro sella pergaminos.
  maestro: {
    robe: '#b8860b', accent: '#7a5230',
    hat: b => (b(7, 6, 6, 2, P.gold), b(7, 5, 1, 1, P.gold), b(9, 5, 2, 1, P.gold), b(12, 5, 1, 1, P.gold), b(9, 6, 2, 1, P.red)),
    prop: b => (b(17, 20, 14, 2, P.woodL), b(17, 22, 14, 8, P.wood), b(19, 24, 10, 1, P.woodL), b(20, 18, 7, 2, P.paper)),
    act: (b, f) => {
      const r = ROLES.maestro.robe
      if (f === 0) return (armDown(b, r), b(16, 21, 1, 1, P.red))
      b(14, 15, 2, 3, r), b(16, 15, 3, 2, r), b(19, 15, 2, 1, P.skin), b(19, 16, 3, 2, P.wood), b(19, 18, 3, 1, P.red)
    },
  },
  // Mesa de mapas: el Archimago traza la ruta con la vara.
  archimago: {
    robe: '#6c5ce7', accent: P.gold,
    hat: b => (b(9, 1, 2, 2, '#6c5ce7'), b(8, 3, 4, 2, '#6c5ce7'), b(6, 5, 8, 3, '#6c5ce7'), b(10, 3, 1, 1, P.gold), b(5, 7, 10, 1, '#4b3fb0')),
    prop: b => (b(17, 21, 14, 2, P.wood), b(18, 23, 2, 7, P.wood), b(28, 23, 2, 7, P.wood), b(18, 19, 12, 2, P.paper), b(20, 19, 3, 1, P.red), b(24, 20, 4, 1, '#6c5ce7')),
    act: (b, f) => {
      const r = ROLES.archimago.robe
      if (f === 0) return (armDown(b, r), b(16, 13, 1, 9, P.wood), b(16, 12, 1, 1, P.gold))
      armUp(b, r), b(16, 4, 1, 9, P.wood), b(16, 3, 1, 1, P.gold), b(15, 2, 1, 1, P.white), b(17, 2, 1, 1, P.white), b(16, 1, 1, 1, P.white), b(18, 4, 1, 1, P.gold)
    },
  },
  // Forja: el Artífice golpea el yunque.
  artifice: {
    robe: '#8b5a2b', accent: '#e07a4f',
    hat: b => (b(7, 6, 6, 2, '#e07a4f'), b(13, 7, 1, 2, '#e07a4f')),
    prop: b => (b(18, 20, 11, 3, P.steelD), b(29, 20, 2, 1, P.steelD), b(21, 23, 6, 3, P.steelD), b(19, 26, 10, 4, P.steelD), b(21, 19, 5, 1, P.ember)),
    rest: b => (armDown(b, ROLES.artifice.robe), b(16, 18, 1, 4, P.wood), b(15, 22, 3, 2, P.steel)),
    act: (b, f) => {
      const r = ROLES.artifice.robe
      if (f === 0) return (armUp(b, r), b(15, 4, 1, 6, P.wood), b(14, 2, 4, 3, P.steel))
      b(14, 15, 2, 3, r), b(16, 16, 3, 2, r), b(19, 16, 1, 1, P.skin), b(19, 12, 1, 4, P.wood), b(20, 14, 4, 4, P.steel), b(25, 16, 1, 1, P.gold), b(26, 14, 1, 1, P.ember), b(24, 13, 1, 1, P.gold)
    },
  },
  // Campo de pruebas: el Paladín pone a prueba al muñeco.
  paladin: {
    robe: '#4a7fc9', accent: P.steel,
    hat: b => (b(7, 5, 6, 5, P.steel), b(8, 9, 4, 1, INK), b(9, 3, 2, 2, P.red)),
    prop: b => (b(25, 14, 2, 16, P.wood), b(22, 9, 8, 5, P.straw), b(24, 11, 1, 1, INK), b(27, 11, 1, 1, INK), b(21, 16, 10, 2, P.straw), b(23, 24, 6, 1, P.wood)),
    act: (b, f) => {
      const r = ROLES.paladin.robe
      b(2, 15, 3, 7, P.steelD), b(3, 17, 1, 3, P.white)
      if (f === 0) return (armDown(b, r), b(16, 13, 1, 8, P.white), b(15, 20, 3, 1, P.gold))
      b(14, 15, 2, 2, r), b(16, 15, 2, 2, r), b(18, 15, 1, 2, P.skin), b(19, 15, 6, 1, P.white), b(18, 14, 1, 3, P.gold)
    },
  },
  // Atril de registros: el Escriba anota la crónica.
  escriba: {
    robe: '#7f8c8d', accent: '#566573',
    hat: b => (b(6, 6, 8, 3, '#7f8c8d'), b(6, 9, 1, 5, '#7f8c8d'), b(13, 9, 1, 5, '#7f8c8d')),
    prop: b => (b(18, 17, 11, 3, P.wood), b(22, 20, 3, 10, P.wood), b(19, 27, 9, 3, P.wood), b(19, 15, 9, 2, P.paper), b(20, 15, 3, 1, '#9aa0a6'), b(24, 16, 3, 1, '#9aa0a6')),
    act: (b, f) => {
      const r = ROLES.escriba.robe
      if (f === 0) return armDown(b, r)
      b(14, 15, 2, 2, r), b(16, 14, 2, 2, r), b(18, 14, 1, 1, P.skin), b(19, 10, 1, 4, P.white), b(20, 9, 1, 2, P.white)
    },
  },
}

/** Una celda vacía junto a otra rellena pasa a tinta: contorno legible sobre fondo claro u oscuro. */
function outline(g: Grid): Grid {
  const filled = (i: number, j: number) => j >= 0 && j < N && i >= 0 && i < N && g[j]![i] !== null && g[j]![i] !== INK
  return g.map((row, j) => row.map((c, i) => (c === null && (filled(i - 1, j) || filled(i + 1, j) || filled(i, j - 1) || filled(i, j + 1)) ? INK : c)))
}

/** Rectángulos por tramos horizontales del mismo color (mucho menos texto que un rect por píxel). */
function rects(g: Grid): string {
  let s = ''
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; ) {
      const c = g[y]![x]
      let w = 1
      while (c && x + w < N && g[y]![x + w] === c) w++
      if (c) s += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`
      x += w
    }
  return s
}

function frame(s: Station, f: 0 | 1 | 'rest', alert = false): string {
  const g: Grid = Array.from({ length: N }, () => Array<string | null>(N).fill(null))
  const box: Box = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < N && i >= 0 && i < N) g[j]![i] = c
  }
  const r = ROLES[s]
  r.prop(box)
  body(box, r.robe, r.accent)
  r.hat(box)
  if (f === 'rest' && r.rest) r.rest(box)
  else r.act(box, f === 'rest' ? 0 : f)
  if (alert) box(1, 1, 2, 5, P.red), box(1, 7, 2, 2, P.red)
  return rects(outline(g))
}

const STATIONS: Station[] = ['maestro', 'archimago', 'artifice', 'paladin', 'escriba']
const GAP = 2
const W = STATIONS.length * N + (STATIONS.length - 1) * GAP
const swap = (from: string) => `<animate attributeName="opacity" values="${from}" dur="0.6s" calcMode="discrete" repeatCount="indefinite"/>`

/** Un puesto: en faena y animado alterna los dos fotogramas; si no, un solo fotograma (en reposo, atenuado). */
function post(s: Station, pose: Pose, animate: boolean): string {
  if (pose === 'work') return animate ? `<g>${frame(s, 0)}${swap('1;0')}</g><g opacity="0">${frame(s, 1)}${swap('0;1')}</g>` : frame(s, 1)
  return `<g${pose === 'rest' ? ' opacity="0.6"' : ''}>${frame(s, 'rest', pose === 'alert')}</g>`
}

const cache = new Map<string, string>()
/** La sala del gremio: los cinco puestos en fila sobre un suelo de tablones, a 2× por defecto. */
export function scene(poses: Record<Station, Pose>, animate: boolean, scale = 2): string {
  const key = `${STATIONS.map(s => poses[s]).join(',')}|${animate}|${scale}`
  const hit = cache.get(key)
  if (hit) return hit
  const floor = `<rect x="0" y="${N}" width="${W}" height="2" fill="${P.wood}"/><rect x="0" y="${N + 2}" width="${W}" height="2" fill="${P.woodL}"/>`
  const posts = STATIONS.map((s, i) => `<g transform="translate(${i * (N + GAP)} 0)">${post(s, poses[s], animate)}</g>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${N + 4}" width="${W * scale}" height="${(N + 4) * scale}" shape-rendering="crispEdges">${floor}${posts}</svg>`
  cache.set(key, svg)
  return svg
}
