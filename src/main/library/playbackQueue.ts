const COOLDOWN_MS = 20_000

// Shared between Command and Emote (both trigger library sounds): only one
// sound plays at a time, and each trigger has its own 20s cooldown. Matches
// the old app's behavior. In-memory only — cooldowns reset on restart.
export class PlaybackQueue {
  private playing = false
  private readonly cooldownUntil = new Map<string, number>()

  tryAcquire(triggerId: string): boolean {
    const cooldown = this.cooldownUntil.get(triggerId) ?? 0
    if (this.playing || Date.now() < cooldown) return false

    this.playing = true
    this.cooldownUntil.set(triggerId, Date.now() + COOLDOWN_MS)
    return true
  }

  release(): void {
    this.playing = false
  }
}
