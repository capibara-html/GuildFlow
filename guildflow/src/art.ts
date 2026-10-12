// Arte ORIGINAL de la oficina del gremio: mapas de píxeles en texto (la fuente editable) y paletas. Sin lógica de misión.
// Cada letra es un color; '.' es transparente. El contorno de personajes y objetos sueltos lo pone el compositor
// (src/sprites.ts). Para editar: cambia los mapas o las paletas y regenera vistas previas, hoja de personajes y
// paleta de Aseprite con `node scripts/art.mjs art`. Ver docs/12-pixel-art-board.md.

/** Paleta común (pergamino, nogal, piedra, oro viejo, fuego, violeta arcano, azul acero). */
export const INK = '#1e1620'
export const PAL: Record<string, string> = {
  // piedra
  st: '#5d5664', sd: '#47404f', sl: '#736b78', mo: '#3a3341',
  // nogal
  w0: '#3b2419', w1: '#5a3826', w2: '#774b31', w3: '#94613f', w4: '#b07a51',
  // suelo
  f0: '#4a3022', f1: '#5e3e2b', f2: '#6a4631', f3: '#77503a',
  // pergamino
  p0: '#bfa577', p1: '#dcc79a', p2: '#efe2bf',
  // oro viejo
  g0: '#7d5d1e', g1: '#b88d32', g2: '#e2c063',
  // fuego
  e0: '#8e2f1f', e1: '#c9512b', e2: '#f08a35', e3: '#ffc85a', e4: '#fff1b8',
  // violeta arcano
  v0: '#3f2c78', v1: '#6a52c2', v2: '#a593ef', v3: '#e2dbff',
  // azul acero y metal
  b0: '#2f4a78', b1: '#4f7cc0', b2: '#8db2e6', m0: '#4d5560', m1: '#7e8894', m2: '#b9c3cc', m3: '#e7edf1',
  // estados
  ok0: '#2f6b35', ok1: '#58a95a', ok2: '#9ad88a', no0: '#7d231d', no1: '#c8402f', no2: '#f07a5d',
  // tela y vidrio
  c0: '#5a1f2a', c1: '#83303c', c2: '#a84a50', gl0: '#41556a', gl1: '#6f8ba3', gl2: '#a9c2d4',
  // paja y sombra
  y0: '#8a6a32', y1: '#b8924a', y2: '#dcbc6e', sh: '#3a261b',
  ink: INK, wh: '#f4efe4',
}

/** Mapa de píxeles: una letra por píxel; key traduce letras a claves de PAL. */
export type Sprite = { rows: string[]; key: Record<string, string> }

// ---------------- personajes (18×26, una familia: cabeza grande, cuerpo de 8, piernas cortas) ----------------

/** Colores de cada rol: R prenda, r sombra, Q luz, A acento, a acento oscuro, H pelo, S piel, s piel en sombra, L piernas, B botas. */
export const ROLE_COLORS: Record<string, Record<string, string>> = {
  maestro: { R: '#a8782a', r: '#7a5520', Q: '#cf9f45', A: '#5a1f2a', a: '#3d141c', H: '#241816', S: '#a8714a', s: '#83532f', L: '#3b2a24', B: '#2a1b14' },
  archimago: { R: '#6a52c2', r: '#45358f', Q: '#8f7ae0', A: '#e2c063', a: '#b88d32', H: '#f1ece2', S: '#f0cfae', s: '#d2a684', L: '#3f2c78', B: '#2b1f3f' },
  artifice: { R: '#cf6a32', r: '#9a4a22', Q: '#ec8f50', A: '#6b4128', a: '#4a2b1a', H: '#7a3b1c', S: '#d79a6c', s: '#b07650', L: '#3d3640', B: '#2a1b14' },
  paladin: { R: '#4f7cc0', r: '#2f4a78', Q: '#8db2e6', A: '#f4efe4', a: '#c9c2b4', H: '#e9e2d4', S: '#efc39b', s: '#cf9f78', L: '#4d5560', B: '#2f3540' },
  escriba: { R: '#7a8290', r: '#575e6b', Q: '#9ca4b1', A: '#3d4350', a: '#2b303a', H: '#575e6b', S: '#f2cdb0', s: '#d6a98a', L: '#3d4350', B: '#2a2530' },
}
/** Perdido: el mismo personaje en gris azulado y apagado (nunca trabajando). */
export const LOST_COLORS: Record<string, string> = { R: '#6c7280', r: '#555a66', Q: '#808694', A: '#5f6470', a: '#4a4e58', H: '#7a7f8a', S: '#9da1aa', s: '#868a94', L: '#4a4e58', B: '#3c3f48' }
/** Letras fijas de los personajes (iguales para todos los roles). */
export const FIXED: Record<string, string> = { E: 'ink', K: 'ink', G: 'g2', g: 'g1', M: 'm2', N: 'm1', n: 'm0', W: 'wh', P: 'p2', p: 'p1', F: 'e3', f: 'e2', V: 'v2', v: 'v3', T: 'w2', t: 'w1', X: 'no1', b: 'b0' }

const blank = () => Array.from({ length: 26 }, () => '......................')
/** Capa de 22×26 (18 de figura y 4 de alcance para armas y herramientas) con rows a partir de la fila y (las '.' no tapan). */
export function at(y: number, rows: string[]): string[] {
  const out = blank()
  rows.forEach((r, i) => (out[y + i] = r.padEnd(22, '.')))
  return out
}

export const FACE = at(5, [
  '......SSSSSS',
  '.....SSSSSSSS',
  '....SSSSSSSSSS',
  '....SSSSSSSSSS',
  '....SSESSSSESS',
  '....SSESSSSESS',
  '....sSSSSSSSSs',
  '.....sSSSSSSs',
])

export const TUNIC = at(13, [
  '.....RRRRRRRR',
  '.....RQRRRRRR',
  '.....RQRRRRRr',
  '.....rRRRRRRr',
  '.....AAAAAAAA',
  '.....rRRRRRRr',
  '.....rRRRRRRr',
  '.....rrrrrrrr',
  '......LL..LL',
  '......LL..LL',
  '.....BBB..BBB',
  '.....BBB..BBB',
])

export const ROBE = at(13, [
  '.....RRRRRRRR',
  '.....RQRRRRRR',
  '.....RQRRRRRr',
  '.....rRRRRRRr',
  '.....AAAAAAAA',
  '.....rRQRRRRr',
  '....rRRQRRRRRr',
  '....rRRQRRRRRr',
  '....rRRRRRRRRr',
  '...rrRRRRRRRRrr',
  '...rrrrrrrrrrrr',
  '.....BB....BB',
])

/** Brazos comunes a todos los roles (manga R/r, mano S). */
export const ARMS: Record<string, string[]> = {
  idle: at(13, ['....R........R', '...RR........RR', '...RR........RR', '...Rr........rR', '...Rr........rR', '...rr........rr', '...SS........SS']),
  // mano a la barbilla (piensa)
  think: at(12, ['............SS', '....R.......RR', '...RR........RR', '...RR........rr', '...Rr', '...Rr', '...rr', '...SS']),
  // las dos manos al frente (sostiene algo)
  front: at(13, ['....R........R', '...RR........RR', '...Rr........rR', '....rr......rr', '.....SS....SS']),
  // brazos en alto (éxito)
  cheer: at(6, ['SS..............SS', 'RR..............RR', '.RR............RR', '..R............R', '..RR..........RR', '...RR........RR', '....RR......RR', '.....R......R']),
  // mano a la cabeza (bloqueado)
  stuck: at(7, ['.............SS', '.............RR', '.............RR', '.............Rr', '.............rR', '............rR', '....R.......R', '...RR', '...RR', '...Rr', '...Rr', '...rr', '...SS']),
  // brazo alzado (golpe arriba)
  raise: at(4, ['..............SS', '..............RR', '..............RR', '.............RR', '.............Rr', '.............rR', '.............R', '', '', '....R', '...RR', '...RR', '...Rr', '...Rr', '...rr', '...SS']),
  // brazo extendido a un lado (golpe abajo, escribe)
  reach: at(13, ['....R........R', '...RR........RRR', '...RR.........rRR', '...Rr..........SS', '...Rr', '...rr', '...SS']),
}

/** Pelo, sombrero, casco y adornos del cuerpo de cada rol. */
export const HEADS: Record<string, string[]> = {
  maestro: at(3, ['......HHHHHH', '.....HHHHHHHH', '....HHHHHHHHHH', '....HHHSSSSHHH', '....HSSSSSSSSH', '', '', '', '....HSSSSSSSSH', '.....HHHHHHHH', '......HHHHHH', '......G....G', '.......GGGG', '........GG']),
  archimago: at(0, ['..........vV', '.........RRR', '........RRRRr', '.......RRGRRRr', '......RRRRRRRRr', '..rrrrrrrrrrrrrr', '', '', '', '', '....HSSHHHHSSH', '....HHHHHHHHHH', '.....HHHHHHHH', '.....HHHHHHHH', '......HHHHHH', '.......HHHH', '........HH']),
  artifice: at(4, ['......AAAAAA', '.....AAAAAAAA', '....AAAAAAAAAAa', '....nMMnnnnMMn.aa', '', '', '', '....HSSSSSSSSH', '.....HHHHHHHH', '', '.....tttttttt', '.....tTTTTTTt', '.....tTTTTTTt', '.....tTTTTTTt', '.....tTTTTTTt', '.....tTTTTTTt']),
  paladin: at(0, ['.........WW', '........WWW', '.......WWW', '......MMMMMM', '.....MMMMMMMM', '....MMMMMMMMMN', '....MMMMMMMMMN', '....MMMMMMMMMN', '....MMMMMMMMMN', '....MKKKKKKKKN', '....MKMKKKKMKN', '....NMMMMMMMNN', '.....NNNNNNNN', '.....RAAAAAAR', '.....RAAAAAAR', '.....RAAGGAAR', '.....rAAGGAAr']),
  escriba: at(2, ['.......RRRR', '.....RRRRRRRR', '....RRRRRRRRRR', '...RRrrrrrrrrRR', '...RrSSSSSSSSrR', '...RrSSSSSSSSrR', '...RrgEgSSgEgrR', '...RrSSSSSSSSrR', '...RRsSSSSSSsRR', '....RRRsssssRRR', '.....RRRRRRRR']),
}

/** Accesorios por rol y pose (encima de los brazos). workA/workB, thinkB, reviewA/reviewB: fotogramas. */
export const PROPS: Record<string, Record<string, string[]>> = {
  maestro: {
    workA: at(1, ['..............MM', '..............MM', '.............tttt']),
    workB: at(15, ['.............tttt', '.............MMMM']),
    awaiting: at(0, ['...........pPPPPp', '...........PPPPPP', '...........PPXXPP', '...........PPPPPP', '...........pPPPPp']),
  },
  archimago: {
    idle: at(3, ['..V', '.vVv', ...Array.from({ length: 21 }, () => '..T')]),
    workA: at(15, ['....pPPPPPPPPp', '....pPPPPtPPPp', '....pPPPPtPPPp']),
    workB: at(15, ['....pPPPPPPPPp', '....pPPPtPPPPp', '....pPPPPtPPpp']),
    thinkB: at(0, ['', '..............v', '.............vVv', '..............v']),
  },
  artifice: {
    idle: at(18, ['..............TT', '..............TT', '.............NMMN', '.............NMMN']),
    workA: at(0, ['.............NMMMN', '.............NMMMN', '...............T', '...............T']),
    workB: at(15, ['................T', '................T', '...............NMM', '...............NMM']),
    reviewA: at(12, ['........FF', '........ff', '........NN', '........NN']),
    reviewB: at(12, ['........ff', '........FF', '........NN', '........NN']),
  },
  paladin: {
    idle: at(13, ['.bbbb', 'bMMMMb', 'bMGGMb', 'bMGGMb', 'bMMMMb', '.bMMb', '..bb.......nN', '...........nN', '...........nN']),
    reviewA: at(14, ['......pPPPPPp', '......pPttPPp', '......pPPPPPp']),
    reviewB: at(14, ['......pPPPPPp', '......pPPttPp', '......pPPPPPp']),
    workA: at(0, ['...............M', '...............M', '...............M', '...............M', '..............GGG']),
    workB: at(15, ['................GMMMMM', '................G']),
  },
  escriba: {
    idle: at(17, ['..............W', '.............W', '............W']),
    workA: at(12, ['................W', '...............W', '..............W']),
    workB: at(13, ['.................W', '................W', '...............W']),
  },
}

/** Insignias sobre la cabeza (7×7): espera a la persona, bloqueo, perdido, hecho. */
export const BADGES: Record<string, Sprite> = {
  awaiting: { rows: ['.GGGGG.', 'GGgKgGG', 'GGgKgGG', 'GGgKgGG', 'GGGGGGG', 'GGgKgGG', '.GGGGG.'], key: { G: 'g2', g: 'g1', K: 'ink' } },
  blocked: { rows: ['.XXXXX.', 'XXwKwXX', 'XXwKwXX', 'XXwKwXX', 'XXXXXXX', 'XXwKwXX', '.XXXXX.'], key: { X: 'no1', w: 'no2', K: 'wh' } },
  lost: { rows: ['.mmmmm.', 'mmKKKmm', 'mmmmKmm', 'mmmKKmm', 'mmmKmmm', 'mmmmmmm', '.mmKmm.'], key: { m: 'm1', K: 'm3' } },
  success: { rows: ['.ooooo.', 'oooooKo', 'ooooKKo', 'oKoKKoo', 'oKKKooo', 'ooKoooo', '.ooooo.'], key: { o: 'ok1', K: 'wh' } },
}

// ---------------- objetos de la oficina ----------------

/** Mostrador del Maestro (46×16): tablero claro, frente con paneles y moldura dorada. */
export const COUNTER: Sprite = {
  rows: [
    '4444444444444444444444444444444444444444444444',
    '3333333333333333333333333333333333333333333333',
    '2222222222222222222222222222222222222222222222',
    '1111111111111111111111111111111111111111111111',
    'gggggggggggggggggggggggggggggggggggggggggggggg',
    '2333333333331233333333333312333333333333312222',
    '2322222222221232222222222212322222222222212222',
    '2321111111121232111111111212321111111111212222',
    '2321111111121232111111111212321111111111212222',
    '2321111111121232111111111212321111111111212222',
    '2321111111121232111111111212321111111111212222',
    '2321111111121232111111111212321111111111212222',
    '2322222222221232222222222212322222222222212222',
    '2111111111111211111111111112111111111111112222',
    '1111111111111111111111111111111111111111111111',
    '0000000000000000000000000000000000000000000000',
  ],
  key: { '0': 'w0', '1': 'w1', '2': 'w2', '3': 'w3', '4': 'w4', g: 'g1' },
}
/** Libro de registros abierto (14×6), vela (4×9) y pergaminos (10×5) sobre el mostrador. */
export const LEDGER: Sprite = { rows: ['.pppppp.pppppp', 'pPPPPPPkPPPPPP', 'pPkkkPPkPkkkPP', 'pPPPPPPkPPPPPP', 'pPkkPPPkPkkPPP', 'cccccccccccccc'], key: { p: 'p1', P: 'p2', k: 'p0', c: 'c1' } }
export const CANDLE: Sprite = { rows: ['.f..', '.ff.', 'fFFf', '.FF.', '.ww.', '.ww.', '.ww.', 'gggg', '.gg.'], key: { f: 'e3', F: 'e4', w: 'wh', g: 'g1' } }
export const SCROLLS: Sprite = { rows: ['..pPPPp...', '.pPPPPPp..', 'pPPPPPPPpc', 'cpPPPPPpcc', '.cpppppc..'], key: { p: 'p1', P: 'p2', c: 'c1' } }

/** Mesa del Archimago (36×14) con mapa desplegado; libros y esfera van aparte (la esfera se enciende al trabajar). */
export const DESK: Sprite = {
  rows: [
    '...pPPPPPPPPPPPPPPPp',
    '..pPPkPPPPvPPPPPPPPPp',
    '..pPkPkPPvPvPPPkkPPPp',
    '4444444444444444444444444444444444',
    '3333333333333333333333333333333333',
    '2222222222222222222222222222222222',
    '1111111111111111111111111111111111',
    '.11..........................11',
    '.11..........................11',
    '.11..........................11',
    '.11..........................11',
    '.11..........................11',
    '.00..........................00',
  ],
  key: { '0': 'w0', '1': 'w1', '2': 'w2', '3': 'w3', '4': 'w4', p: 'p1', P: 'p2', k: 'p0', v: 'c1' },
}
export const BOOKSTACK: Sprite = { rows: ['.vvvvv', 'VVVVVV', 'cccccc', 'CCCCC.', 'bbbbbb'], key: { v: 'v0', V: 'v1', c: 'c0', C: 'c2', b: 'b1' } }
/** Esfera arcana (7×9): apagada / encendida. */
export const ORB_OFF: Sprite = { rows: ['..vvv..', '.vVVVv.', 'vVVVVVv', 'vVVVVVv', '.vVVVv.', '..vvv..', '.ggggg.', '..ggg..', '.ggggg.'], key: { v: 'v0', V: 'v1', g: 'g0' } }
export const ORB_ON: Sprite = { rows: ['..VVV..', '.VLLLV.', 'VLWWLLV', 'VLWLLLV', '.VLLLV.', '..VVV..', '.ggggg.', '..ggg..', '.ggggg.'], key: { V: 'v1', L: 'v2', W: 'v3', g: 'g1' } }

/** Yunque (18×10) sobre su tocón. */
export const ANVIL: Sprite = {
  rows: [
    'nnMMMMMMMMMMMMMn',
    '.nnMMMMMMMMMMMNnnn',
    '...nNNNNNNNNNNn',
    '.....nNNNNNNn',
    '.....nNNNNNNn',
    '....nnNNNNNNnn',
    '...nNNNNNNNNNNn',
    '...tTTTTTTTTTTt',
    '...tTTTTTTTTTTt',
    '...tttttttttttt',
  ],
  key: { n: 'm0', N: 'm1', M: 'm2', t: 'w1', T: 'w2' },
}
/** Barril de templar (12×13). */
export const BARREL: Sprite = {
  rows: ['.gggggggggg.', 'gGGGGGGGGGGg', 'g1111111111g', 'nnnnnnnnnnnn', '322332233223', '322332233223', '322332233223', 'nnnnnnnnnnnn', '322332233223', '322332233223', '322332233223', 'nnnnnnnnnnnn', '.2222222222.'],
  key: { g: 'gl0', G: 'gl1', '1': 'gl2', n: 'm0', '2': 'w2', '3': 'w3' },
}

/** Atril del Escriba (18×21) con libro de crónicas abierto, tintero y pluma. */
export const LECTERN: Sprite = {
  rows: [
    '..pppppppppp.kk',
    '.pPPPPkPPPPPpkk',
    'pPkkPPkPkkPPPp',
    'pPPPPPkPPPPPPp',
    'pPkkPPkPPkkPPp',
    '33333333333333',
    '.222222222222',
    '.....2222',
    '.....2112',
    '.....2112',
    '.....2112',
    '.....2112',
    '.....2112',
    '.....2112',
    '.....2112',
    '...3322112233',
    '..222222222222',
    '..111111111111',
  ],
  key: { p: 'p1', P: 'p2', k: 'ink', '1': 'w1', '2': 'w2', '3': 'w3' },
}
/** Taburete de la crónica (14×7); el compositor apila encima una hoja por evento registrado. */
export const STOOL: Sprite = { rows: ['33333333333333', '22222222222222', '.1..........1', '.1..........1', '.1..........1', '.1..........1', '.0..........0'], key: { '0': 'w0', '1': 'w1', '2': 'w2', '3': 'w3' } }
export const SHEET: Sprite = { rows: ['pPPPPPPPPp', 'kkkkkkkkkk'], key: { p: 'p1', P: 'p2', k: 'p0' } }

/** Muñeco de prácticas (16×24) con diana. */
export const DUMMY: Sprite = {
  rows: [
    '.....yYYYy',
    '....yYYYYYy',
    '....yYKYKYy',
    '....yYYYYYy',
    '.....yYYYy',
    '.......t',
    '.yyyyyyyyyyyyy',
    'yYYYYYYYYYYYYYy',
    '.yyyyyyyyyyyyy',
    '....yYYYYYy',
    '....yYXXXYy',
    '....yYXWXYy',
    '....yYXXXYy',
    '....yYYYYYy',
    '....yyYYYyy',
    '.......t',
    '.......t',
    '.......t',
    '.......t',
    '.......t',
    '.......t',
    '.......t',
    '.....ttttt',
    '....tTTTTTt',
  ],
  key: { y: 'y0', Y: 'y1', K: 'ink', X: 'no1', W: 'wh', t: 'w1', T: 'w2' },
}
/** Atril de normas (14×14): pedestal de piedra con libro azul. */
export const RULEBOOK: Sprite = {
  rows: ['..bbbbbbbbbb', '.bBBBBGBBBBBb', 'bBBBBBGBBBBBBb', 'bbbbbbbbbbbbbb', '..llllllllll', '...ssssssss', '....ssllss', '....ssllss', '....ssllss', '....ssllss', '....ssllss', '...ssssssss', '..llllllllll', '..ssssssssss'],
  key: { b: 'b0', B: 'b1', G: 'g2', l: 'sl', s: 'st' },
}
/** Armero (14×21): espadas en su soporte. */
export const RACK: Sprite = {
  rows: ['..M...M...M', '..M...M...M', '.MMM.MMM.MMM', '..M...M...M', '..M...M...M', '..M...M...M', '22222222222222', '11111111111111', '..M...M...M', '..M...M...M', '..M...M...M', '.GGG.GGG.GGG', '..t...t...t', '..t...t...t', '22222222222222', '11111111111111', '.1..........1', '.1..........1', '.1..........1', '.1..........1', '.0..........0'],
  key: { M: 'm2', G: 'g1', t: 'w1', '0': 'w0', '1': 'w1', '2': 'w2' },
}

/** Cofre del tesoro (20×12) abierto; el compositor pone encima el montón de monedas según el consumo real. */
export const CHEST: Sprite = {
  rows: [
    '.gggggggggggggggggg.',
    'g222222222222222222g',
    'g111111111111111111g',
    'gggggggggggggggggggg',
    'k000000000000000000k',
    'gggggggggggggggggggg',
    'g2222222gGGg2222222g',
    'g1111111gKKg1111111g',
    'g1111111gGGg1111111g',
    'g111111111111111111g',
    'g000000000000000000g',
    '.gggggggggggggggggg.',
  ],
  key: { g: 'g0', G: 'g2', K: 'ink', k: 'w0', '0': 'w0', '1': 'w1', '2': 'w2' },
}

/** Fragua (40×49): chimenea y hogar de piedra ('#' = sillería), viga de nogal y boca en arco ('k' interior). */
export const FORGE: Sprite = {
  rows: [
    ...Array.from({ length: 14 }, () => '............################'),
    '..........####################',
    '........########################',
    '......############################',
    '....################################',
    '..####################################',
    '.TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    '.tttttttttttttttttttttttttttttttttttttt',
    '..####################################',
    '..####################################',
    '..####################################',
    '..###########LLLLLLLLLLLLLL###########',
    '..#########LLkkkkkkkkkkkkkkLL#########',
    '..########LkkkkkkkkkkkkkkkkkkL########',
    ...Array.from({ length: 15 }, () => '..#######LkkkkkkkkkkkkkkkkkkkkL#######'),
    '..#######LLLLLLLLLLLLLLLLLLLLLL#######',
    '..####################################',
    'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL',
    '########################################',
    '########################################',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
  ],
  key: { T: 'w3', t: 'w1', L: 'sl', k: 'w0', D: 'mo' },
}
/** Fuego de la fragua (16×10), dos fotogramas, y brasas (apagada). Dígitos: 1 rojo oscuro … 5 blanco. */
export const FLAME_A = ['......3.....3', '.....343...34', '....3443..3443', '...344443.34443', '..3445443344443', '..3455544445543', '.234555554555432', '.234455555554432', '1223444444444321', '1122233333332211']
export const FLAME_B = ['..3.......3', '..34.....343', '.3443...34443', '.34443.3445443', '.3444433445543', '.34555444555443', '2345555545555432', '2344555555554432', '1223444444444321', '1122233333332211']
export const EMBERS = ['', '', '', '', '', '', '', '', '..1.2..1.2.1.2', '1121211212112121']
export const FIRE_KEY: Record<string, string> = { '1': 'e0', '2': 'e1', '3': 'e2', '4': 'e3', '5': 'e4' }
/** Chispas sobre el yunque (fotograma del golpe). */
export const SPARKS = ['..4...4', '4...3..', '..3.4..3', '.4..'] as const

/** Ventana con parteluz (18×19) y estandarte del gremio (12×16). */
export const WINDOW: Sprite = {
  rows: [
    '......000000',
    '....0011111100',
    '...012222222210',
    '..01222322222210',
    '..01223322222210',
    '.0122222122222210',
    '.0122222122222210',
    '.0111111111111110',
    '.0122222122222210',
    '.0122222122222210',
    '.0122222122222210',
    '.0122222122222210',
    '.0111111111111110',
    '.0122222122222210',
    '.0122222122222210',
    '.0122222122222210',
    '.0122222122222210',
    'wwwwwwwwwwwwwwwwww',
    'WWWWWWWWWWWWWWWWWW',
  ],
  key: { '0': 'w1', '1': 'w0', '2': 'gl1', '3': 'gl2', w: 'w3', W: 'w2' },
}
export const BANNER: Sprite = {
  rows: ['gggggggggggg', '.VVVVVVVVVV.', '.VVVVVVVVVV.', '.VVVvvvvVVV.', '.VVvGGGGvVV.', '.VVvGvvGvVV.', '.VVvGGGGvVV.', '.VVVvGGvVVV.', '.VVVVvvVVVV.', '.VVVVVVVVVV.', '.VVVVVVVVVV.', '.VVVVVVVVVV.', '.VVVVVVVVVV.', '.VVVV..VVVV.', '.VVV....VVV.', '.VV......VV.'],
  key: { g: 'g1', V: 'v1', v: 'v0', G: 'g2' },
}
/** Antorcha de pared (4×8), siempre encendida: luz ambiente, no actividad. */
export const SCONCE: Sprite = { rows: ['.ff.', 'fFFf', 'fFFf', '.ee.', '.tt.', 'nnnn', '.t..', '.t..'], key: { f: 'e2', F: 'e3', e: 'e1', t: 'w1', n: 'm1' } }
/** Tablón de encargos (46×30): marco, corcho y cabecera dorada; las notas las pone el compositor. */
export const BOARD_FRAME = { w: 46, h: 30 }
/** Estantería (26×38) del Archimago; los lomos los reparte el compositor de forma fija. */
export const SHELF = { w: 26, h: 38, shelves: [9, 18, 27, 36] }

/** Nota del tablón de encargos (8×9): una por subtarea; 'S' sello y 'n' chincheta toman el color de su estado. */
export const NOTE = ['...nn', '.pPnnPp', 'pPPPPPPp', 'pPkkkkPp', 'pPPPPPPp', 'pPkkkPPp', 'pPPPSSSp', 'pPPPSSSp', '.pppppp']
/** Placa de estado (12×8) colgada del mostrador; el icono (4×4) lo elige el compositor. */
export const PLAQUE: Sprite = { rows: ['....t..t', '...t....t', '.gggggggggg', 'g2222222222g', 'g2222222222g', 'g2222222222g', 'g2222222222g', '.gggggggggg'], key: { t: 'm1', g: 'g0', '2': 'p1' } }
export const PLAQUE_ICON: Record<string, Sprite> = {
  working: { rows: ['KKKK', '.KK.', '.KK.', 'KKKK'], key: { K: 'w1' } },
  awaiting: { rows: ['.KK.', '.KK.', '....', '.KK.'], key: { K: 'g0' } },
  blocked: { rows: ['K..K', '.KK.', '.KK.', 'K..K'], key: { K: 'no1' } },
  paused: { rows: ['K..K', 'K..K', 'K..K', 'K..K'], key: { K: 'b0' } },
  halted: { rows: ['KKKK', 'KKKK', 'KKKK', 'KKKK'], key: { K: 'no0' } },
  done: { rows: ['...K', '..K.', 'K.K.', '.K..'], key: { K: 'ok0' } },
}
