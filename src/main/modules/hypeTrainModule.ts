import type { IBotModule, BotModuleStatus } from './types'
import type {
  HypeTrainEventSub,
  HypeTrainContribution,
  HypeTrainBeginEventPayload,
  HypeTrainProgressEventPayload,
  HypeTrainEndEventPayload
} from '../twitch/hypeTrainEventSub'

export interface HypeTrainBeginBattleEvent {
  type: 'hypetrain:begin'
  level: number
  progress: number
  goal: number
}

export interface HypeTrainArcherJoinBattleEvent {
  type: 'hypetrain:archer-join'
  userName: string
}

export interface HypeTrainProgressBattleEvent {
  type: 'hypetrain:progress'
  level: number
  progress: number
  goal: number
}

export interface HypeTrainLevelUpBattleEvent {
  type: 'hypetrain:level-up'
  level: number
}

export interface HypeTrainEndBattleEvent {
  type: 'hypetrain:end'
  won: boolean
}

export type HypeTrainBattleEvent =
  | HypeTrainBeginBattleEvent
  | HypeTrainArcherJoinBattleEvent
  | HypeTrainProgressBattleEvent
  | HypeTrainLevelUpBattleEvent
  | HypeTrainEndBattleEvent

export interface HypeTrainState {
  active: boolean
  level: number
  archerCount: number
}

const SIMULATE_NAMES = ['ArcherAlice', 'ArcherBob', 'ArcherCarol', 'ArcherDan', 'ArcherEve']

/**
 * Turns raw Hype Train EventSub payloads into our own battle-facing events —
 * kept independent of how they're drawn (that's the overlay's job) so this
 * can be exercised without an overlay at all, either by real events or by
 * simulate(), which drives the exact same handlers a real train does. That
 * shared code path is what makes the manager window's Test button (Phase 4)
 * a meaningful rehearsal rather than a separate mock implementation.
 */
export class HypeTrainModule implements IBotModule {
  readonly id = 'hype-train'
  readonly displayName = 'Hype Train'
  readonly description = 'Puts on an archers-vs-troll battle on the overlay when a Hype Train starts.'
  enabled = false

  private _status: BotModuleStatus = 'stopped'
  private active = false
  private level = 1
  private archers = new Map<string, string>() // user_id -> user_name, roster for the current train
  private simulateTimers: ReturnType<typeof setTimeout>[] = []

  private readonly onStatus = (status: string): void => this.handleEventSubStatus(status)
  private readonly onBegin = (payload: HypeTrainBeginEventPayload): void => {
    this.cancelSimulation() // a real train pre-empts anything simulated
    this.handleBegin(payload)
  }
  private readonly onProgress = (payload: HypeTrainProgressEventPayload): void => this.handleProgress(payload)
  private readonly onEnd = (payload: HypeTrainEndEventPayload): void => this.handleEnd(payload)

  constructor(
    private readonly eventSub: HypeTrainEventSub,
    private readonly broadcasterUserId: () => string,
    private readonly accessToken: () => string,
    private readonly onBattleEvent: (event: HypeTrainBattleEvent) => void = () => {}
  ) {}

  get status(): BotModuleStatus {
    return this._status
  }

  state(): HypeTrainState {
    return { active: this.active, level: this.level, archerCount: this.archers.size }
  }

  async start(): Promise<void> {
    if (this._status === 'running') return
    this._status = 'connecting'
    this.eventSub.on('status', this.onStatus)
    this.eventSub.on('begin', this.onBegin)
    this.eventSub.on('progress', this.onProgress)
    this.eventSub.on('end', this.onEnd)
    try {
      await this.eventSub.acquire(this.broadcasterUserId(), this.accessToken())
    } catch {
      this._status = 'error'
      this.detachListeners()
      return
    }
    this._status = 'running'
  }

  async stop(): Promise<void> {
    // Both unconditional and ahead of the status check below: the Test
    // button can start a simulation whether or not the bot tile is enabled,
    // so _status can still read 'stopped' while a battle is active.
    this.cancelSimulation()
    // A battle left active (real or simulated) would never get a
    // hypetrain:end otherwise — the overlay has no way to know to stop
    // animating, and its requestAnimationFrame loop would run for the rest
    // of the stream.
    if (this.active) {
      this.active = false
      this.onBattleEvent({ type: 'hypetrain:end', won: false })
    }
    if (this._status === 'stopped') return
    this.eventSub.release()
    this.detachListeners()
    this._status = 'stopped'
  }

  /** Used by the manager window's Test Hype Train button (Phase 4). */
  simulate(): void {
    if (this.active) return // a train (real or already-simulated) is running

    const now = new Date().toISOString()
    const contribution = (name: string, total: number): HypeTrainContribution => ({
      user_id: `sim-${name}`,
      user_login: name.toLowerCase(),
      user_name: name,
      type: 'bits',
      total
    })
    const schedule = (delayMs: number, run: () => void): void => {
      this.simulateTimers.push(setTimeout(run, delayMs))
    }

    schedule(0, () =>
      this.handleBegin({
        id: 'simulated',
        broadcaster_user_id: '',
        broadcaster_user_login: '',
        broadcaster_user_name: '',
        level: 1,
        total: 300,
        progress: 300,
        goal: 1000,
        top_contributions: [contribution(SIMULATE_NAMES[0], 300)],
        last_contribution: contribution(SIMULATE_NAMES[0], 300),
        started_at: now,
        expires_at: now
      })
    )
    schedule(3_000, () =>
      this.handleProgress({
        id: 'simulated',
        broadcaster_user_id: '',
        broadcaster_user_login: '',
        broadcaster_user_name: '',
        level: 1,
        total: 900,
        progress: 900,
        goal: 1000,
        top_contributions: [contribution(SIMULATE_NAMES[0], 300), contribution(SIMULATE_NAMES[1], 600)],
        last_contribution: contribution(SIMULATE_NAMES[1], 600),
        started_at: now,
        expires_at: now
      })
    )
    schedule(7_000, () =>
      this.handleProgress({
        id: 'simulated',
        broadcaster_user_id: '',
        broadcaster_user_login: '',
        broadcaster_user_name: '',
        level: 2, // crosses the level-1 goal — this is the level-up
        total: 1200,
        progress: 200,
        goal: 1200,
        top_contributions: [contribution(SIMULATE_NAMES[0], 300), contribution(SIMULATE_NAMES[1], 600), contribution(SIMULATE_NAMES[2], 500)],
        last_contribution: contribution(SIMULATE_NAMES[2], 500),
        started_at: now,
        expires_at: now
      })
    )
    schedule(12_000, () =>
      this.handleProgress({
        id: 'simulated',
        broadcaster_user_id: '',
        broadcaster_user_login: '',
        broadcaster_user_name: '',
        level: 2,
        total: 1600,
        progress: 900,
        goal: 1200,
        top_contributions: [
          contribution(SIMULATE_NAMES[0], 300),
          contribution(SIMULATE_NAMES[1], 600),
          contribution(SIMULATE_NAMES[2], 500),
          contribution(SIMULATE_NAMES[3], 400)
        ],
        last_contribution: contribution(SIMULATE_NAMES[3], 400),
        started_at: now,
        expires_at: now
      })
    )
    schedule(17_000, () =>
      this.handleEnd({
        id: 'simulated',
        broadcaster_user_id: '',
        broadcaster_user_login: '',
        broadcaster_user_name: '',
        level: 2,
        total: 1600,
        top_contributions: [
          contribution(SIMULATE_NAMES[0], 300),
          contribution(SIMULATE_NAMES[1], 600),
          contribution(SIMULATE_NAMES[2], 500),
          contribution(SIMULATE_NAMES[3], 400)
        ],
        started_at: now,
        ended_at: now,
        cooldown_ends_at: now
      })
    )
  }

  private cancelSimulation(): void {
    for (const timer of this.simulateTimers) clearTimeout(timer)
    this.simulateTimers = []
  }

  private detachListeners(): void {
    this.eventSub.off('status', this.onStatus)
    this.eventSub.off('begin', this.onBegin)
    this.eventSub.off('progress', this.onProgress)
    this.eventSub.off('end', this.onEnd)
  }

  // Mirrors the EventSub connection's own status once running — a keepalive
  // timeout or failed reconnect should show up on the HUD tile, not just the
  // console.
  private handleEventSubStatus(status: string): void {
    if (status === 'error' && this._status !== 'stopped') this._status = 'error'
  }

  private handleBegin(payload: HypeTrainBeginEventPayload): void {
    this.active = true
    this.level = payload.level
    this.archers = new Map()
    this.onBattleEvent({ type: 'hypetrain:begin', level: payload.level, progress: payload.progress, goal: payload.goal })
    this.addContributors(payload)
  }

  private handleProgress(payload: HypeTrainProgressEventPayload): void {
    if (payload.level > this.level) {
      this.level = payload.level
      this.onBattleEvent({ type: 'hypetrain:level-up', level: payload.level })
    }
    this.addContributors(payload)
    this.onBattleEvent({ type: 'hypetrain:progress', level: payload.level, progress: payload.progress, goal: payload.goal })
  }

  private handleEnd(payload: HypeTrainEndEventPayload): void {
    this.active = false
    // Trains always start at level 1, so reaching a higher level before
    // ending means at least one level-up landed — that's the win condition
    // agreed on for the archers-vs-troll mechanic.
    this.onBattleEvent({ type: 'hypetrain:end', won: payload.level > 1 })
  }

  // Twitch never hands us a full participant roster — each event only carries
  // who just contributed (last_contribution) plus the current top
  // contributors. Folding both through here, deduped by user_id, is how the
  // archer roster grows incrementally over the train's life without missing
  // anyone top_contributions would otherwise catch that last_contribution
  // alone might not (e.g. two contributions landing between polls).
  private addContributors(payload: HypeTrainBeginEventPayload | HypeTrainProgressEventPayload): void {
    this.addContributor(payload.last_contribution)
    for (const contribution of payload.top_contributions) this.addContributor(contribution)
  }

  private addContributor(contribution: HypeTrainContribution | undefined): void {
    if (!contribution || this.archers.has(contribution.user_id)) return
    this.archers.set(contribution.user_id, contribution.user_name)
    this.onBattleEvent({ type: 'hypetrain:archer-join', userName: contribution.user_name })
  }
}
