/**
 * Audio for the OBS overlay pages.
 *
 * Web Audio rather than <audio> elements for two reasons: overlapping
 * one-shots (several coins landing at once, fifteen shells bursting) need many
 * simultaneous voices of the same sound, which a single element can't do; and
 * the fireworks have no sample to play at all — their sounds are synthesised,
 * because the originals were part of a licensed Unity pack.
 *
 * Autoplay: an AudioContext starts suspended until a user gesture in a normal
 * browser tab. OBS browser sources permit it, so this resumes opportunistically
 * and reports when it can't, rather than failing silently.
 */
export class OverlayAudio {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private readonly buffers = new Map<string, AudioBuffer>()
  private volume = 0.6
  private warned = false

  private context(): AudioContext | undefined {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return undefined
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined)
      if (this.ctx.state === 'suspended' && !this.warned) {
        this.warned = true
        console.warn('[overlay-audio] AudioContext suspended — a browser tab needs a click before sound plays. OBS allows it.')
      }
    }
    return this.ctx
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value))
    if (this.master) this.master.gain.value = this.volume
  }

  /** Fetches and decodes a sample. Safe to call repeatedly; decodes once. */
  async load(name: string, url: string): Promise<void> {
    if (this.buffers.has(name)) return
    const ctx = this.context()
    if (!ctx) return
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      this.buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()))
    } catch (error) {
      console.error(`[overlay-audio] could not load ${name}:`, error)
    }
  }

  play(name: string, gain = 1): void {
    const ctx = this.context()
    const buffer = this.buffers.get(name)
    if (!ctx || !buffer || !this.master) return

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const level = ctx.createGain()
    level.gain.value = gain
    source.connect(level).connect(this.master)
    source.start()
  }

  private noiseBuffer(seconds: number): AudioBuffer | undefined {
    const ctx = this.context()
    if (!ctx) return undefined
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** Rising whoosh as a shell climbs. */
  fireworkLaunch(gain = 0.35): void {
    const ctx = this.context()
    const noise = this.noiseBuffer(0.5)
    if (!ctx || !noise || !this.master) return

    const source = ctx.createBufferSource()
    source.buffer = noise
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 6
    band.frequency.setValueAtTime(420, ctx.currentTime)
    band.frequency.exponentialRampToValueAtTime(1700, ctx.currentTime + 0.45)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, ctx.currentTime)
    envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.12)
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)

    source.connect(band).connect(envelope).connect(this.master)
    source.start()
    source.stop(ctx.currentTime + 0.5)
  }

  /** Low boom plus a scatter of crackle, roughly a shell bursting. */
  fireworkBurst(gain = 0.9): void {
    const ctx = this.context()
    const noise = this.noiseBuffer(1.6)
    if (!ctx || !noise || !this.master) return

    const now = ctx.currentTime
    const boom = ctx.createBufferSource()
    boom.buffer = noise

    // Lowpass sweeping down gives the body of the report; the fast attack and
    // long exponential tail are what make it read as a distant boom.
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.setValueAtTime(900, now)
    low.frequency.exponentialRampToValueAtTime(110, now + 0.7)

    const boomEnv = ctx.createGain()
    boomEnv.gain.setValueAtTime(0.0001, now)
    boomEnv.gain.exponentialRampToValueAtTime(gain, now + 0.015)
    boomEnv.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)

    boom.connect(low).connect(boomEnv).connect(this.master)
    boom.start(now)
    boom.stop(now + 1.2)

    const crackle = ctx.createBufferSource()
    crackle.buffer = noise
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 2200

    const crackleEnv = ctx.createGain()
    crackleEnv.gain.setValueAtTime(0.0001, now + 0.05)
    crackleEnv.gain.exponentialRampToValueAtTime(gain * 0.32, now + 0.12)
    crackleEnv.gain.exponentialRampToValueAtTime(0.0001, now + 1.0)

    crackle.connect(high).connect(crackleEnv).connect(this.master)
    crackle.start(now + 0.05)
    crackle.stop(now + 1.1)
  }

  /** Quick plucked twang — an archer loosing an arrow. */
  archerShot(gain = 0.3): void {
    const ctx = this.context()
    if (!ctx || !this.master) return
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(900, now)
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.09)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(gain, now)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)

    osc.connect(envelope).connect(this.master)
    osc.start(now)
    osc.stop(now + 0.12)
  }

  /** Short percussive thud — an arrow landing on the troll. */
  trollHit(gain = 0.25): void {
    const ctx = this.context()
    const noise = this.noiseBuffer(0.2)
    if (!ctx || !noise || !this.master) return
    const now = ctx.currentTime

    const source = ctx.createBufferSource()
    source.buffer = noise
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.setValueAtTime(500, now)
    low.frequency.exponentialRampToValueAtTime(120, now + 0.15)

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(gain, now)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)

    source.connect(low).connect(envelope).connect(this.master)
    source.start(now)
    source.stop(now + 0.2)
  }

  /** Rising four-note fanfare — a Hype Train level-up. */
  levelUp(gain = 0.6): void {
    const ctx = this.context()
    const master = this.master
    if (!ctx || !master) return
    const now = ctx.currentTime

    const notes = [440, 554, 659, 880]
    notes.forEach((freq, i) => {
      const start = now + i * 0.08
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq, start)

      const envelope = ctx.createGain()
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(gain * 0.5, start + 0.02)
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.25)

      osc.connect(envelope).connect(master)
      osc.start(start)
      osc.stop(start + 0.28)
    })
  }

  /** Descending groan plus a low rumble — the troll is defeated. */
  trollDefeated(gain = 0.7): void {
    const ctx = this.context()
    const noise = this.noiseBuffer(1.2)
    if (!ctx || !noise || !this.master) return
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.exponentialRampToValueAtTime(60, now + 1.0)

    const oscEnvelope = ctx.createGain()
    oscEnvelope.gain.setValueAtTime(gain * 0.6, now)
    oscEnvelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)

    osc.connect(oscEnvelope).connect(this.master)
    osc.start(now)
    osc.stop(now + 1.1)

    const rumble = ctx.createBufferSource()
    rumble.buffer = noise
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 200

    const rumbleEnvelope = ctx.createGain()
    rumbleEnvelope.gain.setValueAtTime(gain * 0.4, now)
    rumbleEnvelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)

    rumble.connect(low).connect(rumbleEnvelope).connect(this.master)
    rumble.start(now)
    rumble.stop(now + 1.2)
  }
}
