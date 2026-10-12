// Herramienta de arte (solo desarrollo; usa FIXTURES, nunca estado real): node scripts/art.mjs [carpeta]
// Escribe en art/: preview.html (SVG reales, animados), capturas/*.png, personajes.png y paleta.gpl, e imprime el
// tamaño de cada SVG (el motor admite hasta 131 072 caracteres).
import { registerHooks } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

// src/ importa sin extensión (como lo resuelve el motor de mods); aquí se añade .ts
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (err) {
      if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) return next(`${spec}.ts`, ctx)
      throw err
    }
  },
  load: (url, ctx, next) => next(url, url.endsWith('.ts') ? { ...ctx, format: 'module-typescript' } : ctx),
})
const S = await import('../src/sprites.ts')
const A = await import('../src/art.ts')

const idle = { maestro: 'idle', archimago: 'idle', artifice: 'idle', paladin: 'idle', escriba: 'idle' }
const note = (state, current = false) => ({ state, current })
/** FIXTURES de revisión visual: las nueve situaciones de docs/12 (no son datos de una misión). */
export const FIXTURES = {
  '1 · sin misión / inactiva': { poses: idle, notes: [], plaque: 'none', sheets: 0, treasure: 0 },
  '2 · Maestro preparando': { poses: { ...idle, maestro: 'thinking' }, notes: [], plaque: 'working', sheets: 1, treasure: 1 },
  '2b · Archimago planifica (lee)': { poses: { ...idle, archimago: 'working' }, notes: [], plaque: 'working', sheets: 2, treasure: 1 },
  '3 · aprobación pendiente': { poses: { ...idle, maestro: 'awaiting' }, notes: [note('pending'), note('pending'), note('pending')], plaque: 'awaiting', sheets: 3, treasure: 1 },
  '4 · Artífice implementando': { poses: { ...idle, artifice: 'working' }, notes: [note('active', true), note('pending'), note('pending')], plaque: 'working', sheets: 4, treasure: 2 },
  '4b · Artífice ejecuta run_check': { poses: { ...idle, artifice: 'reviewing' }, notes: [note('active', true), note('pending')], plaque: 'working', sheets: 4, treasure: 2 },
  '5 · Paladín revisando': { poses: { ...idle, paladin: 'reviewing' }, notes: [note('done'), note('review', true), note('pending')], plaque: 'working', sheets: 5, treasure: 2 },
  '5b · Paladín ejecuta run_check': { poses: { ...idle, paladin: 'working' }, notes: [note('done'), note('review', true)], plaque: 'working', sheets: 5, treasure: 3 },
  '6 · varios estados (paralelo)': { poses: { ...idle, artifice: 'working', paladin: 'reviewing', archimago: 'lost' }, notes: [note('done'), note('review', true), note('active'), note('queued'), note('checking'), note('pending')], plaque: 'working', sheets: 6, treasure: 3 },
  '7 · misión bloqueada': { poses: { ...idle, maestro: 'blocked', artifice: 'blocked' }, notes: [note('done'), note('blocked', true), note('pending')], plaque: 'blocked', sheets: 6, treasure: 3 },
  '7b · en pausa': { poses: idle, notes: [note('done'), note('active', true)], plaque: 'paused', sheets: 6, treasure: 2 },
  '7c · detenida': { poses: idle, notes: [note('done'), note('active', true)], plaque: 'halted', sheets: 6, treasure: 4 },
  '8 · misión completada': { poses: { maestro: 'success', archimago: 'success', artifice: 'success', paladin: 'success', escriba: 'working' }, notes: [note('done'), note('done'), note('done')], plaque: 'done', sheets: 6, treasure: 2 },
  '9 · restaurada tras reiniciar (agente perdido)': { poses: { ...idle, artifice: 'lost' }, notes: [note('active', true), note('pending')], plaque: 'paused', sheets: 6, treasure: 2 },
}

const cards = Object.entries(FIXTURES).map(([name, v]) => {
  const anim = S.scene(v, true)
  const still = S.scene(v, false)
  const uri = s => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`
  return `<figure><figcaption>${name} <small>${still.length} car. estático · ${anim.length} animado</small></figcaption><img src="${uri(anim)}" width="400" height="240"></figure>`
})
const html = `<!doctype html><meta charset="utf-8"><title>Oficina del gremio · vistas previas</title>
<style>body{background:#202124;color:#ddd;font:13px system-ui;margin:16px}main{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0}small{color:#999}img{image-rendering:pixelated;display:block;border:1px solid #444}</style>
<h1>Oficina del gremio — fixtures de revisión (no son datos reales)</h1><main>${cards.join('')}</main>`
writeFileSync(new URL('../art/preview.html', import.meta.url), html)
for (const [name, v] of Object.entries(FIXTURES)) console.log(String(S.scene(v, true).length).padStart(7), name)

/** PNG sin dependencias (RGBA, filtro 0), a escala entera: para revisar y documentar. */
function png(grid, w, h, k) {
  const raw = Buffer.alloc((w * k * 4 + 1) * h * k)
  let o = 0
  for (let y = 0; y < h * k; y++) {
    raw[o++] = 0
    for (let x = 0; x < w * k; x++) {
      const c = grid[Math.floor(y / k) * w + Math.floor(x / k)]
      if (c) raw.write(c.slice(1) + 'ff', o, 'hex')
      o += 4
    }
  }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(t), d])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w * k, 0)
  ihdr.writeUInt32BE(h * k, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
/** Hoja de personajes: una fila por rol, una columna por pose y fotograma (celdas de 24×30). */
const POSES = [['idle', 0], ['working', 0], ['working', 1], ['thinking', 0], ['thinking', 1], ['reviewing', 0], ['reviewing', 1], ['success', 0], ['blocked', 0], ['lost', 0], ['awaiting', 0]]
const ROLES = ['maestro', 'archimago', 'artifice', 'paladin', 'escriba']
function sheet() {
  const CW = 24
  const CH = 30
  const W = CW * POSES.length
  const g = Array(W * CH * ROLES.length).fill(null)
  ROLES.forEach((r, j) =>
    POSES.forEach(([p, f], i) => {
      const pic = S.portrait(r, p, f)
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) g[(j * CH + y) * W + i * CW + x] = pic[y * S.SCENE_W + x] ?? '#2a2430'
    }),
  )
  return { g, W, H: CH * ROLES.length }
}
// Salida: art/ por defecto (vistas previas, hoja de personajes, paleta de Aseprite y capturas de revisión)
const out = process.argv[2] ?? new URL('../art', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(`${out}/capturas`, { recursive: true })
Object.entries(FIXTURES).forEach(([name, v], i) => {
  const slug = `${String(i).padStart(2, '0')}-${name.split(' · ')[1].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').toLowerCase()}`
  writeFileSync(`${out}/capturas/${slug}.png`, png(S.compose(v, 0), S.SCENE_W, S.SCENE_H, 3))
})
const sh = sheet()
writeFileSync(`${out}/personajes.png`, png(sh.g, sh.W, sh.H, 4))
// Paleta GIMP (.gpl): Aseprite la carga para dibujar con los colores exactos del gremio
const roleHex = Object.values(A.ROLE_COLORS).flatMap(r => Object.values(r))
const colors = [...new Set([...Object.values(A.PAL), ...roleHex, ...Object.values(A.LOST_COLORS)])]
const gpl = colors.map(c => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)} ${c}`)
writeFileSync(`${out}/paleta.gpl`, ['GIMP Palette', 'Name: GuildFlow', 'Columns: 8', '#', ...gpl, ''].join('\n'))

// ---------------- ilustraciones de la documentación (docs/img) ----------------
const raw = (grid, w, h, k) => {
  const buf = Buffer.alloc((w * k * 4 + 1) * h * k)
  let o = 0
  for (let y = 0; y < h * k; y++) {
    buf[o++] = 0
    for (let x = 0; x < w * k; x++) {
      const c = grid[Math.floor(y / k) * w + Math.floor(x / k)]
      if (c) buf.write(c.slice(1) + 'ff', o, 'hex')
      o += 4
    }
  }
  return deflateSync(buf)
}
const chunk = (t, d) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(d.length)
  const td = Buffer.concat([Buffer.from(t), d])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** PNG animado (APNG) de varios fotogramas a la misma escala; se repite sin fin. */
function apng(frames, w, h, k, delayMs) {
  const u32 = (...n) => Buffer.concat(n.map(v => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b }))
  const ihdr = Buffer.concat([u32(w * k, h * k), Buffer.from([8, 6, 0, 0, 0])])
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', u32(frames.length, 0))]
  let seq = 0
  frames.forEach((g, i) => {
    const fc = Buffer.concat([u32(seq++, w * k, h * k, 0, 0), Buffer.from([delayMs >> 8, delayMs & 255, 3, 232, 0, 0])])
    parts.push(chunk('fcTL', fc))
    const data = raw(g, w, h, k)
    parts.push(i === 0 ? chunk('IDAT', data) : chunk('fdAT', Buffer.concat([u32(seq++), data])))
  })
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

const img = new URL('../../docs/img/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(img, { recursive: true })
// Cabecera: la oficina en plena misión (ilustración, no captura de una misión real)
const hero = { poses: { ...idle, artifice: 'working', paladin: 'reviewing' }, notes: [note('done'), note('review'), note('active', true), note('pending'), note('pending')], plaque: 'working', sheets: 5, treasure: 2 }
writeFileSync(`${img}/oficina.png`, apng([S.compose(hero, 0), S.compose(hero, 1)], S.SCENE_W, S.SCENE_H, 4, 600))
// Lámina de cuatro estados (2×2, a 2×)
{
  const picks = ['3 · aprobación pendiente', '4 · Artífice implementando', '7 · misión bloqueada', '8 · misión completada'].map(n => S.compose(FIXTURES[n], 0))
  const G = 4
  const W = S.SCENE_W * 2 + G
  const H = S.SCENE_H * 2 + G
  const g = Array(W * H).fill('#1e1620')
  picks.forEach((p, i) => {
    const ox = (i % 2) * (S.SCENE_W + G)
    const oy = Math.floor(i / 2) * (S.SCENE_H + G)
    for (let y = 0; y < S.SCENE_H; y++) for (let x = 0; x < S.SCENE_W; x++) g[(oy + y) * W + ox + x] = p[y * S.SCENE_W + x]
  })
  writeFileSync(`${img}/estados.png`, png(g, W, H, 2))
}
// Elenco: cada rol en reposo y trabajando, con su nombre y su papel
{
  const cast = [
    ['maestro', 'Maestro', 'tu sesión: coordina'],
    ['archimago', 'Archimago', 'planifica (Opus, solo lectura)'],
    ['artifice', 'Artífice', 'implementa en rutas aprobadas'],
    ['paladin', 'Paladín', 'revisa con evidencia'],
    ['escriba', 'Escriba', 'el mod: registra la crónica'],
  ]
  const K = 3
  const CW = 24
  const CH = 30
  const cell = 180
  let body = ''
  cast.forEach(([r, name, role], i) => {
    ;[['idle', 0], [r === 'archimago' ? 'thinking' : r === 'paladin' ? 'reviewing' : 'working', r === 'archimago' ? 1 : 0]].forEach(([pose, f], j) => {
      const pic = S.portrait(r, pose, f)
      const ox = i * cell + 12 + j * 84
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; ) {
          const c = pic[y * S.SCENE_W + x]
          let w = 1
          while (c && x + w < CW && pic[y * S.SCENE_W + x + w] === c) w++
          if (c) body += `<rect x="${ox + x * K}" y="${4 + y * K}" width="${w * K}" height="${K}" fill="${c}"/>`
          x += w
        }
    })
    body += `<text x="${i * cell + 90}" y="112" text-anchor="middle" font-size="16" font-weight="700" fill="${A.ROLE_COLORS[r].Q}">${name}</text>`
    body += `<text x="${i * cell + 90}" y="132" text-anchor="middle" font-size="12" fill="#cfc6b8">${role}</text>`
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cell * 5} 148" width="${cell * 5}" height="148" shape-rendering="crispEdges" font-family="system-ui, -apple-system, Segoe UI, sans-serif"><rect width="100%" height="100%" rx="10" fill="#1e1620"/>${body}</svg>`
  writeFileSync(`${img}/elenco.svg`, svg)
}
