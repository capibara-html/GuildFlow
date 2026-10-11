// Tests OCULTOS del benchmark A/B: solo comportamiento que SPEC.md promete. Se copian a test-hidden/ al final.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGame, legalMoves, makeMove, perft, status, toFen } from '../src/engine/index.js'

const play = (game, ...uci) => uci.reduce((g, m) => makeMove(g, { from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) }), game)

test('oculto: perft Kiwipete profundidad 3', () => {
  assert.equal(perft(createGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 3), 97862)
})

test('oculto: perft posición 4 (promociones y enroques con jaque) 1-3', () => {
  const g = createGame('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1')
  assert.deepEqual([1, 2, 3].map(d => perft(g, d)), [6, 264, 9467])
})

test('oculto: perft posición 5 1-3', () => {
  const g = createGame('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8')
  assert.deepEqual([1, 2, 3].map(d => perft(g, d)), [44, 1486, 62379])
})

test('oculto: FEN de ida y vuelta', () => {
  for (const fen of ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'])
    assert.equal(toFen(createGame(fen)), fen)
})

test('oculto: capturar una torre quita el enroque de ese lado al rival', () => {
  const g = play(createGame('r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1'), 'g2a8') // el alfil en a8 no da jaque
  assert.ok(!legalMoves(g).some(m => m.from === 'e8' && m.to === 'c8'), 'las negras no deberían poder enrocar largo')
  assert.ok(legalMoves(g).some(m => m.from === 'e8' && m.to === 'g8'), 'el enroque corto sigue disponible')
})

test('oculto: la captura al paso solo vale en el movimiento inmediato', () => {
  let g = play(createGame('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1'), 'd7d5')
  assert.ok(legalMoves(g).some(m => m.from === 'e5' && m.to === 'd6'))
  g = play(g, 'e1e2', 'e8e7')
  assert.ok(!legalMoves(g).some(m => m.from === 'e5' && m.to === 'd6'), 'la captura al paso caducó')
})

test('oculto: mate gana a la regla de los 50 movimientos en la misma jugada', () => {
  const g = play(createGame('7k/8/6K1/8/8/8/8/R7 w - - 99 80'), 'a1a8')
  assert.equal(status(g).state, 'checkmate')
})
