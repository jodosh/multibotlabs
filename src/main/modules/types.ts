export type BotModuleStatus = 'stopped' | 'connecting' | 'running' | 'error'

export interface IBotModule {
  readonly id: string
  readonly displayName: string
  readonly description: string
  enabled: boolean
  readonly status: BotModuleStatus
  // Why the module last failed, when status is 'error'. Retained rather than
  // discarded so a red HUD tile can say what went wrong and a problem report
  // has something actionable in it — the reason used to be thrown away by a
  // bare `catch {}` at the exact moment it was known.
  //
  // Optional: a module that cannot fail need not set it. Cleared on a
  // successful start and on stop, so a stale reason never outlives the failure.
  readonly lastError?: string
  start(): Promise<void>
  stop(): Promise<void>
}
