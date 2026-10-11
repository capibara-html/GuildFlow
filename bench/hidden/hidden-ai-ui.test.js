// Tests OCULTOS del benchmark A/B: IA y estado de la interfaz, solo lo que SPEC.md promete.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, legalMoves, makeMove, status, toFen } from '../src/engine/index.js'
import { chooseMove } from '../src/ai/index.js'
import { initialState, reduce } from '../src/ui/state.js'

const run = (s, ...a) => a.reduce(reduce, s)

test('oculto: mate del pastor (blancas) en medio y difícil', () => {
  const g = createGame('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4')
  for (const level of ['medium', 'hard']) {
    const m = chooseMove(g, level, { timeMs: 1000 })
    assert.deepEqual([m.from, m.to], ['h5', 'f7'], level)
  }
})

test('oculto: las negras también encuentran el mate en 1', () => {
  const g = createGame('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2')
  for (const level of ['medium', 'hard']) {
    const m = chooseMove(g, level, { timeMs: 1000 })
    assert.deepEqual([m.from, m.to], ['d8', 'h4'], level)
  }
})

test('oculto: fácil siempre juega legal a lo largo de una partida', () => {
  let g = createGame()
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 40 && status(g).state === 'playing'; i++) {
    const m = chooseMove(g, 'easy', { random })
    assert.ok(legalMoves(g).some(x => x.from === m.from && x.to === m.to && (x.promotion ?? null) === (m.promotion ?? null)), `jugada ilegal en ${toFen(g)}`)
    g = makeMove(g, m)
  }
})

test('oculto: con negras, la persona mueve tras la IA y no antes', () => {
  let s = run(initialState(), { type: 'setColor', value: 'b' }, { type: 'start' })
  assert.equal(s.awaitingAi, true)
  const before = toFen(s.game)
  s = run(s, { type: 'move', move: { from: 'e7', to: 'e5' } })
  assert.equal(toFen(s.game), before, 'no puede mover mientras le toca a la IA')
  s = run(s, { type: 'aiMove', move: { from: 'e2', to: 'e4' } }, { type: 'move', move: { from: 'e7', to: 'e5' } })
  assert.match(toFen(s.game), / w /)
})

test('oculto: seleccionar otra pieza propia cambia la selección; tras el fin no se mueve', () => {
  let s = run(initialState(), { type: 'start' }, { type: 'select', square: 'g1' }, { type: 'select', square: 'b1' })
  assert.equal(s.selected, 'b1')
  assert.deepEqual([...s.targets].sort(), ['a3', 'c3'])
  s = run(initialState(), { type: 'start' }, { type: 'move', move: { from: 'f2', to: 'f3' } }, { type: 'aiMove', move: { from: 'e7', to: 'e5' } }, { type: 'move', move: { from: 'g2', to: 'g4' } }, { type: 'aiMove', move: { from: 'd8', to: 'h4' } })
  assert.equal(s.screen, 'gameover')
  const fen = toFen(s.game)
  assert.equal(toFen(run(s, { type: 'move', move: { from: 'e2', to: 'e4' } }).game), fen)
})
