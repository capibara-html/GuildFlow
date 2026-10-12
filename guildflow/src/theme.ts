// Capa temática (gremio de rol). Solo viste lo que lee la PERSONA: diálogos, línea de estado, franja, panel,
// avisos y crónica. Cada texto lleva el dato llano detrás de la cabecera temática; nunca lo sustituye.
// Lo que leen los modelos (briefs, respuestas de herramientas) se queda neutro: sin coste de tokens ni de precisión.
import type { Quest } from '../types'
import { hash } from './validation'

export type Theme = 'gremio' | 'sobrio'
export const themeOf = (options: Readonly<Record<string, unknown>>): Theme => (options.theme === 'sobrio' ? 'sobrio' : 'gremio')

/** Etiquetas de los diálogos (la respuesta se compara con la del tema vigente). */
export const LABELS: Record<Theme, { approve: string; reject: string; resume: string; cancel: string; header: string }> = {
  gremio: { approve: 'Sellar el pergamino', reject: 'Rechazar', resume: 'Levantar el campamento', cancel: 'Seguir acampados', header: 'Gremio · GuildFlow' },
  sobrio: { approve: 'Aprobar', reject: 'Rechazar', resume: 'Reanudar', cancel: 'Cancelar', header: 'GuildFlow' },
}

type Voice = 'maestro' | 'archimago' | 'artifice' | 'paladin' | 'escriba'
const NAME: Record<Voice, string> = { maestro: 'el Maestro', archimago: 'el Archimago', artifice: 'el Artífice', paladin: 'el Paladín', escriba: 'el Escriba' }

/** Repertorio por evento: voz del rol y frases breves (sobrio, organizador · sabio · práctico · estricto · cronista). */
const LINES: Record<string, { who: Voice; say: string[] }> = {
  'quest.open': { who: 'maestro', say: ['Recibido el encargo. El gremio se pone en marcha.', 'Abro el libro de misiones; manos a la obra.'] },
  'plan.archimago': { who: 'archimago', say: ['He trazado la ruta; cada encargo tiene su prueba.', 'El mapa está completo. Con tu sello, el gremio parte.', 'Los caminos convergen aquí: este es el plan.'] },
  'plan.maestro': { who: 'maestro', say: ['He preparado el pergamino; nada se forja sin tu sello.', 'Un encargo claro y sus pruebas. ¿Lo sellamos?'] },
  'plan.sealed': { who: 'maestro', say: ['Pergamino sellado. A la forja.', 'Sello puesto; el gremio parte.'] },
  'task.delivered': { who: 'artifice', say: ['Hecho y templado.', 'La pieza sale de la forja.', 'Golpe a golpe, lista para la prueba.'] },
  'verify.fail': { who: 'maestro', say: ['La prueba de fuego no perdona: vuelta a la forja.', 'No resiste el fuego; se repite el encargo.'] },
  'review.pass': { who: 'paladin', say: ['Pasa mi juicio. Con honor.', 'Sin tacha. Adelante.'] },
  'review.fail': { who: 'paladin', say: ['No pasa mi juicio.', 'Hay una grieta en la armadura; que vuelva a la forja.'] },
  blocked: { who: 'maestro', say: ['Hemos llegado a una encrucijada; la decisión es tuya.', 'El camino se cierra en el mismo punto. Te necesito.'] },
  halted: { who: 'maestro', say: ['El gremio se retira para no arriesgar más.', 'Alto. Guardamos lo hecho y nos retiramos.'] },
  paused: { who: 'maestro', say: ['Acampamos. Cuando quieras, levantamos el campamento.'] },
  done: { who: 'escriba', say: ['Queda escrito en la crónica.', 'Misión cumplida; la tinta ya se seca.'] },
}

/** «Frase» — el Rol, elegida sin azar (estable por misión y evento). Vacío con el tema sobrio o evento desconocido. */
export function voice(theme: Theme, event: string, seed: string): string {
  const l = LINES[event]
  if (theme === 'sobrio' || !l) return ''
  const say = l.say[parseInt(hash(`${seed}|${event}`).slice(0, 8), 16) % l.say.length]
  return `«${say}» — ${NAME[l.who]}`
}

/** Cabecera temática de cada estado (la línea llana va detrás). */
export function stateTitle(theme: Theme, q: Quest): string {
  if (theme === 'sobrio') return ''
  const t = q.activeTask ? q.plan?.tasks.find(x => x.id === q.activeTask) : undefined
  const task = t ? `${t.id} «${t.title}»` : (q.activeTask ?? '')
  const p = q.activeTask ? q.progress[q.activeTask] : undefined
  const attempt = p && t ? ` (intento ${p.attempts}/${t.maxAttempts + (p.bonusAttempts ?? 0)})` : ''
  const planner = q.agents.some(a => a.role === 'archimago' && a.status === 'running')
  const titles: Record<string, string> = {
    INTAKE: '📖 El gremio abre el libro de misiones',
    PLANNING: planner ? '🗺️ El Archimago traza la ruta' : '🗺️ El Maestro estudia el encargo',
    AWAITING_APPROVAL: '📜 El pergamino espera tu sello',
    DISPATCH: '🏛️ El Maestro reparte el siguiente encargo',
    IMPLEMENTING: `⚒️ La forja trabaja · Artífice en ${task}${attempt}`,
    VERIFYING: '🔥 Prueba de fuego',
    REVIEWING: `🛡️ Juicio del Paladín · ${task}`,
    FIXING: `⚒️ De vuelta a la forja · ${task}`,
    DONE: '🏆 Misión cumplida',
    LOGGED: '🏆 Misión cumplida',
    PAUSED: '🏕️ Campamento',
    HALTED: '⛔ El gremio se retira',
    BLOCKED: '⚔️ Encrucijada',
  }
  return titles[q.state] ?? q.state
}

/** Evento temático de un cambio de estado (para el aviso con voz), o null si no merece aviso. */
export function transitionEvent(from: string | null, to: string): string | null {
  if (to === 'DONE' || to === 'LOGGED') return from === 'DONE' && to === 'LOGGED' ? null : 'done'
  if (to === 'BLOCKED') return 'blocked'
  if (to === 'HALTED') return 'halted'
  if (to === 'PAUSED') return 'paused'
  if (to === 'AWAITING_APPROVAL') return 'awaiting'
  if (from === 'AWAITING_APPROVAL' && to === 'DISPATCH') return 'plan.sealed'
  if (from === 'IMPLEMENTING' && to === 'VERIFYING') return 'task.delivered'
  if (from === 'VERIFYING' && to === 'FIXING') return 'verify.fail'
  if (from === 'REVIEWING' && to === 'FIXING') return 'review.fail'
  if (from === 'REVIEWING' && to === 'DISPATCH') return 'review.pass'
  return null
}

/** Glosario fijo (README y docs): término temático → significado llano. */
export const GLOSSARY: readonly [string, string][] = [
  ['Pergamino de misión', 'plan'],
  ['Sello', 'aprobación'],
  ['Encargo', 'subtarea'],
  ['Forja', 'implementación'],
  ['Prueba de fuego', 'comprobación automática (tests)'],
  ['Juicio del Paladín', 'revisión'],
  ['Encrucijada', 'bloqueada: necesita tu decisión'],
  ['Campamento', 'en pausa'],
  ['El gremio se retira', 'detenida'],
  ['Bitácora / Crónica', 'registro / resumen final'],
  ['Tesoro gastado', 'coste'],
]
