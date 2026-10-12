// GuildFlow: tipos del dominio y contrato de $.state. Un solo lugar para las formas que se persisten.

export type QuestState =
  | 'INTAKE'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'DISPATCH'
  | 'IMPLEMENTING'
  | 'VERIFYING'
  | 'REVIEWING'
  | 'FIXING'
  | 'DONE'
  | 'LOGGED'
  | 'PAUSED'
  | 'HALTED'
  | 'BLOCKED'

export type Role = 'archimago' | 'artifice' | 'paladin'
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_RUN'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Comprobación declarada en el plan: congelada al aprobarlo. */
export type CheckDef = {
  id: string
  argv: string[]
  cwd: string
  expectExit: number
  timeoutMs: number
  minTests: number
  stdoutIncludes: string[]
  /** Rutas (relativas a la raíz) que definen la comprobación: el Artífice no puede escribirlas. */
  protects: string[]
}

/** check: 'review' (Paladín leyendo), 'visual' (Paladín mirando el resultado en el navegador), 'diff-scope' (mod) o 'check:<id>' (run_check). */
export type Criterion = { id: string; text: string; check: string }

export type Task = {
  id: string
  title: string
  description: string
  dependsOn: string[]
  role: 'artifice'
  /** Archivos exactos o directorios terminados en '/' (relativos a la raíz). */
  paths: string[]
  criteria: Criterion[]
  maxAttempts: number
  doneWhen: string
  isolation: 'none'
  /** Herramientas MCP o web y skills que el Artífice puede usar en ESTA subtarea, además de las de su rol. */
  resources: { tools: string[]; skills: string[] }
  /** Subtarea de interfaz o arte: Artífice y Paladín ven el resultado en el navegador (solo localhost). */
  visual: boolean
  /** Modelo del Artífice de esta subtarea: sonnet (por defecto) u opus para trabajo creativo o de diseño. */
  model: 'sonnet' | 'opus'
}

/** Servidor local para ver la interfaz (lo arranca el navegador integrado con su launch.json). */
export type Preview = { argv: string[]; port: number }

/**
 * Recurso de terceros propuesto por el plan. plugin/mcp/skill: lo instala el sistema tras la aprobación humana,
 * con el argv exacto aprobado. software: solo se indica a la persona qué descargar (nunca se ejecuta).
 */
export type Install = { kind: 'plugin' | 'mcp' | 'skill' | 'software'; name: string; reason: string; argv: string[]; url: string }

export type Plan = {
  objective: string
  scope: string
  constraints: string[]
  risks: string[]
  complexity: 'small' | 'medium' | 'large'
  checks: CheckDef[]
  tasks: Task[]
  installs: Install[]
  preview: Preview | null
}

export type Evidence = {
  verdict: Verdict
  source: 'run_check' | 'paladin' | 'mod'
  detail: string
  runId: string | null
  round: number
  at: number
}

export type TaskStatus = 'pending' | 'active' | 'verifying' | 'reviewing' | 'fixing' | 'done' | 'blocked'

export type TaskProgress = {
  status: TaskStatus
  attempts: number
  round: number
  evidence: Record<string, Evidence>
  failures: Record<string, number>
  bestPassCount: number
  noProgress: number
  lastFailure: string | null
  bonusAttempts: number
  /** Revisiones repetidas porque el Paladín se quedó sin peticiones antes de juzgar todo (no son fallos del código). */
  reviewRetries?: number
}

export type AgentStatus = 'running' | 'done' | 'aborted' | 'error' | 'lost'

export type AgentRecord = {
  id: string
  role: Role
  taskId: string | null
  status: AgentStatus
  model: string
  effort: Effort | null
  steps: number
  tokens: number
  costUsd: number
  startedAt: number
  endedAt: number | null
  partial: boolean
  lastTool: string | null
  /** Capturas del resultado que hizo en el navegador (un criterio visual exige al menos una). */
  looks?: number
}

export type Usage = {
  mainTokens: number
  agentTokens: number
  cacheReadTokens: number
  requests: number
  costStartUsd: number | null
  costUsd: number
  ratePercent: number | null
  unavailable: string[]
}

export type Limits = {
  maxAttemptsPerTask: number
  maxQuestIterations: number
  maxSameFailure: number
  maxNoProgressRounds: number
  maxAgentsPerQuest: number
  maxConcurrentAgents: number
  tokenBudgetPerQuest: number
  costBudgetUsd: number
  rateLimitPercent: number
  wallClockMinutes: number
  maxFilesChanged: number
  maxDiffLines: number
  maxTurns: Record<Role, number>
  archimagoEffort: Effort
  allowedExecutables: string[]
  /** Comprobaciones en Docker: imagen por ejecutable; null = en la máquina de la persona. Ausente en misiones antiguas. */
  sandbox?: Record<string, string> | null
  /** Herramientas de recursos que la persona confía para aprobar planes automáticamente (lista explícita). */
  trustedTools: string[]
  /** Extensiones que puede escribir un plan aprobado automáticamente. Ausente en misiones antiguas (se usa la de serie). */
  autoApproveExtensions?: string[]
  /** Modelo del Maestro mientras la misión trabaja; null = el que elija la persona en la sesión. */
  maestroModel: string | null
}

export type Slot = { role: Role; taskId: string | null; attempt: number }

export type CheckRun = {
  runId: string
  checkId: string
  taskId: string | null
  certifying: boolean
  pass: boolean
  exitCode: number | null
  tests: number | null
  reason: string
  at: number
}

export type Approval = { by: 'human' | 'auto'; at: number; planHash: string; answer: string }

/** Línea base al aprobar: HEAD, archivos ya sucios (relativos a gitRoot) y huellas de las rutas protegidas. */
export type Baseline = { gitRoot: string | null; head: string | null; dirty: string[]; protectedHashes: Record<string, string> }

export type Quest = {
  schema: 1
  id: string
  rev: number
  project: string
  sessionId: string
  request: string
  state: QuestState
  pausedFrom: QuestState | null
  haltKind: 'user' | 'limit' | 'safety' | null
  reason: string | null
  createdAt: number
  updatedAt: number
  activeMs: number
  activeSince: number | null
  plan: Plan | null
  planHash: string | null
  approval: Approval | null
  baseline: Baseline | null
  progress: Record<string, TaskProgress>
  activeTask: string | null
  slot: Slot | null
  iterations: number
  agentsSpawned: number
  agents: AgentRecord[]
  usage: Usage
  limits: Limits
  filesWritten: string[]
  diffLines: number | null
  lastCheck: CheckRun | null
  progressMark: number
  continueMark: number
  continuations: number
}

/**
 * Puerto de E/S: el módulo de hooks lo construye sobre $ (el validador no deja que $ cruce un import).
 * persistence.ts y verification.ts solo hablan con este puerto, así que se prueban con un fs en memoria.
 */
export type Io = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<readonly { name: string; isLink: boolean }[]>
  /** Rechaza si la ruta no existe, como $.fs.stat. */
  stat: (path: string, resolve: boolean) => Promise<{ kind: 'file' | 'dir' | 'other'; realPath?: string }>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  /** Sin shell: argv[0] es el ejecutable. Rechaza si no arranca o supera el tiempo. */
  run: (argv: readonly string[], init: { cwd: string; timeoutMs: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  now: () => Promise<number>
}

declare module 'claude-code' {
  interface PluginState {
    guildflow: {
      /** Copia de la misión para dibujar; la fuente de verdad es .guildflow/quest.json. */
      view: Quest | null
      /** Marca de carga: presente tras una recarga del mod, ausente tras reiniciar Desktop. */
      boot: { sessionId: string; at: number } | null
      /** Animación SMIL del tablón (interruptor del panel); null = aún no leída de $.store. */
      anim: boolean | null
      /** Bitácora del panel: eventos legibles de la misión `quest`, lo más reciente primero. */
      recent: { quest: string | null; items: { at: number; text: string }[] }
    }
  }
}
