import type { OverlayEvent } from '../../main/overlay/types'
import { OverlayAudio } from '../assets/overlayAudio'

// Synthesised, not sampled — the original's launch/explosion sounds were part
// of the licensed Hovl pack, so like the visuals they're rebuilt from scratch.
const audio = new OverlayAudio()

// Procedural fireworks. The original app used a commercial Unity particle pack
// (Hovl Studio) whose assets can't be redistributed, so this is re-authored
// from scratch — which also means the overlay needs no art assets at all.
// Shell types mirror that pack's vocabulary at a coarser grain.

const canvas = document.getElementById('sky') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

const GRAVITY = 0.045
const DRAG = 0.992
const TRAIL_FADE = 0.14 // alpha removed per frame; higher = shorter trails

type ShellType = 'peony' | 'chrysanthemum' | 'willow' | 'palm' | 'crossette' | 'ring'
const SHELL_TYPES: ShellType[] = ['peony', 'chrysanthemum', 'willow', 'palm', 'crossette', 'ring']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  hue: number
  size: number
  /** Rocket climbing to its burst point; stars are the burst debris. */
  rocket: boolean
  shell?: ShellType
  /** Rockets only: y to burst at, so shells stay on screen at any canvas size. */
  burstY?: number
  /** Crossette stars split once into a small secondary burst. */
  splits: number
}

let particles: Particle[] = []
let pending: number[] = [] // scheduled burst timestamps for staggered launches
let frame = 0

// Sized from the canvas's own laid-out box, pinned to the viewport by CSS —
// not from `window.innerWidth`, and not relying on `width: 100%` resolving
// against <body>. OBS injects its own body rules into a browser source, so a
// canvas that depends on body layout can end up narrower than the source
// (observed as a belt floating at ~75% width). Buffer is scaled by
// devicePixelRatio and the context transformed to match, so all drawing below
// stays in CSS pixels while staying crisp on HiDPI.
let viewW = 0
let viewH = 0

function resize(): void {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  viewW = Math.max(1, Math.round(rect.width))
  viewH = Math.max(1, Math.round(rect.height))
  canvas.width = Math.round(viewW * dpr)
  canvas.height = Math.round(viewH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resize()
window.addEventListener('resize', resize)

function random(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function launchShell(): void {
  audio.fireworkLaunch(0.22 + Math.random() * 0.16)
  const shell = SHELL_TYPES[Math.floor(Math.random() * SHELL_TYPES.length)]
  // Aim for a burst height in the upper-middle of whatever canvas we're given,
  // then derive the launch speed from it (v = sqrt(2·g·d), with a little extra
  // so the shell is still rising when it bursts). Picking a fixed velocity
  // instead makes the apex depend on gravity alone, which sends shells far
  // above a short canvas — and OBS sources get resized freely.
  const burstY = random(viewH * 0.16, viewH * 0.44)
  const climb = viewH - burstY

  particles.push({
    x: random(viewW * 0.15, viewW * 0.85),
    y: viewH,
    vx: random(-0.6, 0.6),
    vy: -Math.sqrt(2 * GRAVITY * climb) * random(1.02, 1.1),
    life: 1,
    maxLife: 1,
    hue: Math.random() < 0.15 ? -1 : Math.random() * 360, // -1 marks a multicolour shell
    size: 2.5,
    rocket: true,
    shell,
    burstY,
    splits: 0
  })
}

function starCount(shell: ShellType): number {
  if (shell === 'palm') return 14
  if (shell === 'crossette') return 20
  if (shell === 'ring') return 46
  return 70
}

function burst(source: Particle): void {
  // Vary each report a little so fifteen shells don't sound like one sample
  // retriggered; bigger shells get a heavier boom.
  const shell = source.shell ?? 'peony'
  const count = starCount(shell)
  audio.fireworkBurst(0.5 + (count / 70) * 0.45 * (0.8 + Math.random() * 0.4))

  for (let i = 0; i < count; i += 1) {
    // A ring needs its stars evenly spaced on the circle; everything else
    // reads better with jitter so it doesn't look mechanical.
    const angle = shell === 'ring' ? (i / count) * Math.PI * 2 : Math.random() * Math.PI * 2
    let speed = random(2, 5.5)
    let maxLife = random(55, 85)
    let size = 2

    if (shell === 'willow') {
      speed = random(1.5, 3.5)
      maxLife = random(110, 150) // long, slow droop
      size = 2.2
    } else if (shell === 'palm') {
      speed = random(4, 7)
      maxLife = random(80, 110)
      size = 3.2 // few, thick arcs
    } else if (shell === 'ring') {
      speed = 4.4
      maxLife = random(60, 80)
    } else if (shell === 'chrysanthemum') {
      maxLife = random(70, 100)
    }

    particles.push({
      x: source.x,
      y: source.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: maxLife,
      maxLife,
      hue: source.hue < 0 ? Math.random() * 360 : source.hue + random(-12, 12),
      size,
      rocket: false,
      shell,
      splits: shell === 'crossette' ? 1 : 0
    })
  }
}

function splitStar(source: Particle): void {
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2
    const maxLife = random(22, 34)
    particles.push({
      x: source.x,
      y: source.y,
      vx: Math.cos(angle) * 1.8,
      vy: Math.sin(angle) * 1.8,
      life: maxLife,
      maxLife,
      hue: source.hue,
      size: 1.8,
      rocket: false,
      splits: 0
    })
  }
}

function step(): void {
  frame += 1

  // Fade the previous frame by *subtracting* alpha. The usual trick — painting
  // a low-alpha black rect — would lay a dark haze over the stream, since this
  // canvas is composited over live video rather than sitting on a black page.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`
  ctx.fillRect(0, 0, viewW, viewH)

  // Additive blending so overlapping stars bloom instead of flatly stacking.
  ctx.globalCompositeOperation = 'lighter'

  const next: Particle[] = []
  for (const p of particles) {
    p.vy += GRAVITY
    p.vx *= DRAG
    p.vy *= DRAG
    p.x += p.vx
    p.y += p.vy

    if (p.rocket) {
      // Burst on reaching the target height, with apex as a fallback so a
      // rocket can never stall and hang around forever.
      if (p.y <= (p.burstY ?? 0) || p.vy >= -0.4) {
        burst(p)
        continue
      }
      ctx.fillStyle = `hsl(${p.hue < 0 ? 45 : p.hue}, 100%, 85%)`
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
      next.push(p)
      continue
    }

    p.life -= 1
    if (p.life <= 0) {
      if (p.splits > 0) splitStar(p)
      continue
    }

    const fade = p.life / p.maxLife
    // Cubic so the white-hot flash is brief and the star spends most of its
    // life at its actual colour. A linear ramp here washes everything out to
    // near-white, especially under 'lighter' where overlaps stack toward white.
    ctx.fillStyle = `hsla(${p.hue}, 100%, ${60 + fade * fade * fade * 32}%, ${Math.min(1, fade * 1.6)})`
    const s = p.size * (0.5 + fade * 0.5)
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
    next.push(p)
  }
  particles = next

  // Fire any shells whose staggered launch time has arrived.
  if (pending.length > 0) {
    const now = performance.now()
    pending = pending.filter((at) => {
      if (at > now) return true
      launchShell()
      return false
    })
  }
}

let running = false

function loop(): void {
  step()

  // Stop once the sky is empty. A browser source runs for the whole stream, so
  // idling on requestAnimationFrame would burn a core between celebrations.
  if (particles.length === 0 && pending.length === 0) {
    running = false
    ctx.clearRect(0, 0, viewW, viewH)
    return
  }
  requestAnimationFrame(loop)
}

function startShow(shells: number, volume = 0.6): void {
  audio.setVolume(volume)
  const now = performance.now()
  const count = Math.max(1, Math.min(shells, 60))
  for (let i = 0; i < count; i += 1) {
    // Staggered rather than the original's simultaneous spawn — it reads as a
    // show instead of one flash.
    pending.push(now + i * random(140, 320))
  }

  if (!running) {
    running = true
    requestAnimationFrame(loop)
  }
}

const source = new EventSource('/events?feature=fireworks')
source.addEventListener('message', (message) => {
  let event: OverlayEvent
  try {
    event = JSON.parse(message.data) as OverlayEvent
  } catch {
    return
  }
  if (event.type === 'celebration:fireworks') startShow(event.shells, event.volume)
})

// Exposed for automated verification: asserting that the loop actually stops
// when the sky empties is otherwise impossible from outside the page.
Object.assign(window, {
  __fireworks: {
    particleCount: () => particles.length,
    pendingCount: () => pending.length,
    isRunning: () => running,
    frame: () => frame,
    startShow
  }
})
