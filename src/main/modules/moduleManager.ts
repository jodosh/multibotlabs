import type { IBotModule } from './types'

export class ModuleManager {
  private readonly modules = new Map<string, IBotModule>()

  private statusListener?: () => void
  private lastSeen = new Map<string, string>()
  private pollTimer?: ReturnType<typeof setInterval>

  // Notifies when any module's status changes.
  //
  // Polled rather than event-driven, deliberately. `status` is a plain getter
  // backed by a private field that ten modules assign independently; adding an
  // emit to each would be ten edits, and a module that forgot one would be
  // silently stale — which is exactly the bug this fixes. Polling catches every
  // transition regardless of how it was made, including ones that happen long
  // after start() resolves (a dropped connection, an EventSub reconnect).
  //
  // The cost is comparing nine strings a second, and the callback only fires
  // when something actually changed, so an idle app broadcasts nothing.
  watchStatus(onChange: () => void, intervalMs = 1000): void {
    this.statusListener = onChange
    this.captureStatuses()
    this.pollTimer = setInterval(() => this.notifyIfStatusChanged(), intervalMs)
    // Must not keep the process alive on its own.
    this.pollTimer.unref?.()
  }

  stopWatching(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.statusListener = undefined
  }

  private captureStatuses(): boolean {
    let changed = false
    for (const module of this.modules.values()) {
      if (this.lastSeen.get(module.id) !== module.status) {
        this.lastSeen.set(module.id, module.status)
        changed = true
      }
    }
    return changed
  }

  private notifyIfStatusChanged(): void {
    if (this.captureStatuses()) this.statusListener?.()
  }

  register(module: IBotModule): void {
    if (!this.modules.has(module.id)) {
      this.modules.set(module.id, module)
    }
  }

  list(): IBotModule[] {
    return [...this.modules.values()]
  }

  get(id: string): IBotModule | undefined {
    return this.modules.get(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const module = this.modules.get(id)
    if (!module) return

    module.enabled = enabled
    if (enabled) {
      await module.start()
    } else {
      await module.stop()
    }

    // Report the settled status immediately rather than waiting up to a full
    // poll interval — this is the transition a user is actually watching for,
    // since they just clicked the tile.
    this.notifyIfStatusChanged()
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.list().map((module) => module.stop()))
  }
}
