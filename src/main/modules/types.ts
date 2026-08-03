export type BotModuleStatus = 'stopped' | 'connecting' | 'running' | 'error'

export interface IBotModule {
  readonly id: string
  readonly displayName: string
  readonly description: string
  enabled: boolean
  readonly status: BotModuleStatus
  start(): Promise<void>
  stop(): Promise<void>
}
