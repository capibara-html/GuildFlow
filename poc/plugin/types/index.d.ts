export type AgentState = 'running' | 'done' | 'error' | 'aborted' | 'lost'

export type AgentRow = {
  id: string
  role: string
  state: AgentState
  requestedModel: string | null
  model: string | null
  effort: string | null
  tokens: number
  startedAt: number
  endedAt: number | null
}

export type UsageSum = {
  mainTokens: number
  agentTokens: number
  mainTurns: number
  agentTurns: number
}

export type Ctl = {
  spawnLimit: number
  spawnCount: number
  p4Armed: boolean
  throwGuard: boolean
  anim: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'guildflow-poc': {
      agents: AgentRow[]
      usage: UsageSum
      ctl: Ctl
    }
  }
}
