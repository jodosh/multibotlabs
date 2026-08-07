import type { OverlayEvent } from '../../main/overlay/types'
import { OverlayAudio } from '../assets/overlayAudio'

// Archers vs. troll, rendered from hand-drawn sprite sheets in resources/hype
// (served over /hype/*, see overlayServer.ts's serveResourceAsset — same
// pattern as the coin game's /game/* assets). Twitch never hands us a full
// Hype Train roster, so archers accumulate one at a time as
// `hypetrain:archer-join` events arrive (see hypeTrainModule.ts for how
// those are derived).
//
// Only archer_male.png exists today — archer_female.png was dropped during
// a re-export and will come back later. addArcher() below has a single
// sheet hardcoded; swap in a chooser once there are two to pick from.

const audio = new OverlayAudio()

const canvas = document.getElementById('battlefield') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

// Sized from the canvas's own laid-out box (+ devicePixelRatio), not
// window.innerWidth — OBS injects its own body rules into a browser source,
// so relying on body layout can end up narrower than the actual source.
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

// --------------------------------------------------------------- sprites
//
// NOT a uniform grid — the poses on each sheet are different sizes, placed
// at irregular positions (this was the source of an earlier bug: a fixed
// 352x384-cell grid assumption sliced clean through several poses, since
// their real content straddled where a cell boundary was assumed to be).
// These rects are each pose's exact opaque bounding box, found with
// ImageMagick connected-components against the real (post re-export) files:
//   magick sheet.png -alpha extract -threshold 5% \
//     -define connected-components:area-threshold=200 \
//     -define connected-components:verbose=true -connected-components 8 out.png
// and cross-checked by cropping each rect back out and looking at it.
// Because these are tight bounding boxes (not padded cells), a pose's feet
// are always exactly at the bottom of its rect and its head/hair/quiver-tip
// always exactly at the top — no separate per-pose anchor table needed.

type Pose = 'idle' | 'run' | 'draw' | 'shoot'

interface SpriteRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

const ARCHER_FRAMES: Record<Pose, SpriteRect> = {
  idle: { sx: 88, sy: 35, sw: 370, sh: 341 },
  run: { sx: 668, sy: 52, sw: 377, sh: 324 },
  draw: { sx: 105, sy: 398, sw: 412, sh: 335 },
  shoot: { sx: 692, sy: 404, sw: 371, sh: 329 }
}

const TROLL_FRAMES: Record<Pose, SpriteRect> = {
  idle: { sx: 88, sy: 35, sw: 370, sh: 340 },
  run: { sx: 669, sy: 53, sw: 323, sh: 323 },
  draw: { sx: 106, sy: 399, sw: 410, sh: 334 },
  shoot: { sx: 692, sy: 404, sw: 370, sh: 329 }
}

const images = new Map<string, HTMLImageElement>()
function loadImage(url: string): HTMLImageElement {
  let img = images.get(url)
  if (!img) {
    img = new Image()
    img.src = url
    images.set(url, img)
  }
  return img
}
function imageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0
}

const archerSheet = loadImage('/hype/archer_male.png')
const trollSheet = loadImage('/hype/troll.png')

// Returns the drawn top-left y (dy) and width (dw) so callers can position
// a nametag/HP bar flush with the sprite's actual top edge (= dy, since
// these are tight bounding boxes) without re-deriving it themselves.
function drawSprite(sheet: HTMLImageElement, frames: Record<Pose, SpriteRect>, pose: Pose, dCenterX: number, dh: number, feetWorldY: number): { dy: number; dw: number } {
  const rect = frames[pose]
  const dw = dh * (rect.sw / rect.sh)
  const dy = feetWorldY - dh
  if (imageReady(sheet)) {
    ctx.drawImage(sheet, rect.sx, rect.sy, rect.sw, rect.sh, dCenterX - dw / 2, dy, dw, dh)
  }
  return { dy, dw }
}

// Vertical layout is anchored to canvas.height fractions rather than a fixed
// world-space y derived from width — OBS lets a browser source be any shape,
// and a width-derived ground line runs off the bottom on a taller source.
const GROUND_FRACTION = 0.8
const TROLL_X_FRACTION = 0.82
const ARCHER_RENDER_H_FRACTION = 0.22
const TROLL_RENDER_H_FRACTION = 0.34
const MAX_VISIBLE_ARCHERS = 60 // rendering cap only — the real roster (main process) is uncapped
const ARCHER_COLUMNS = 10
const DRAW_POSE_MS = 260
const SHOOT_POSE_MS = 160

function groundY(): number {
  return viewH * GROUND_FRACTION
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// --------------------------------------------------------------- entities

interface Archer {
  name: string
  slot: number // formation position, assigns (x, row) below
  x: number // current x, eases toward its slot's x on join
  targetX: number
  pose: 'idle' | 'draw' | 'shoot' // 'run' is rendered transiently while sliding in, not stored
  stageUntil: number // when to auto-advance out of draw/shoot
  pendingBigShot: boolean
  nextShotAt: number
  celebrateUntil: number
}

interface Arrow {
  x: number
  y: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  bornAt: number
  durationMs: number
  big: boolean // level-up volley arrows draw larger and always land
  hostile: boolean // the troll's own parting shot at the archers — different color
}

interface FloatingText {
  text: string
  x: number
  y: number
  bornAt: number
  size: number
}

let archers: Archer[] = []
let arrows: Arrow[] = []
let texts: FloatingText[] = []

let battleActive = false
let level = 1
let hp = 1 // animated 0-1, eases toward hpTarget
let hpTarget = 1
let shakeUntil = 0
let ending: 'over' | undefined
let endingAt = 0
let trollX = 0
let trollScale = 1 // shrink-on-death, between levels
let trollOpacity = 1
let trollPose: 'idle' | 'draw' | 'shoot' = 'idle'
let trollStageUntil = 0
let trollDeathAt: number | undefined // level-up: old troll shrinks/fades, then a fresh one takes its place
let pendingLevel: number | undefined // the level to switch to once the death animation above completes

function archerRenderWidth(): number {
  // Idle's aspect ratio as a stand-in for "typical" width — poses vary
  // slightly (run/draw are wider), but slot spacing doesn't need to be
  // pixel-precise, just roughly proportional to the sprite's real size.
  const idle = ARCHER_FRAMES.idle
  return viewH * ARCHER_RENDER_H_FRACTION * (idle.sw / idle.sh)
}

function archerSlotPosition(slot: number): { x: number; y: number } {
  const col = slot % ARCHER_COLUMNS
  const row = Math.floor(slot / ARCHER_COLUMNS)
  // Capped by both the sprite's own width (so archers don't overlap when
  // there's room) and the space available for ARCHER_COLUMNS across the
  // canvas (so a huge hype train's roster compresses instead of running off
  // the right edge).
  const spacing = Math.min(archerRenderWidth() * 0.8, (viewW * 0.55) / ARCHER_COLUMNS)
  const x = viewW * 0.06 + col * spacing
  const y = groundY() - row * spacing * 0.9
  return { x, y }
}

function addArcher(name: string): void {
  if (archers.some((archer) => archer.name === name)) return
  const slot = archers.length
  if (slot >= MAX_VISIBLE_ARCHERS) return // still a real archer, just off-screen — roster lives in the main process
  const { x } = archerSlotPosition(slot)
  archers.push({
    name,
    slot,
    x: x - 40,
    targetX: x,
    pose: 'idle',
    stageUntil: 0,
    pendingBigShot: false,
    nextShotAt: performance.now() + random(400, 2000),
    celebrateUntil: 0
  })
}

function trollBasePosition(): { x: number; y: number } {
  return { x: viewW * TROLL_X_FRACTION, y: groundY() }
}

function fireArrow(archer: Archer, big = false): void {
  const { y } = archerSlotPosition(archer.slot)
  const dh = viewH * ARCHER_RENDER_H_FRACTION
  const ax = archer.x
  const ay = y - dh * 0.45 // roughly bow-hand height, not feet
  const troll = trollBasePosition()
  arrows.push({
    x: ax,
    y: ay,
    fromX: ax,
    fromY: ay,
    toX: troll.x + trollX + random(-18, 18),
    toY: troll.y - viewH * TROLL_RENDER_H_FRACTION * random(0.35, 0.55),
    bornAt: performance.now(),
    durationMs: big ? 260 : 420,
    big,
    hostile: false
  })
  audio.archerShot(big ? 0.5 : 0.28)
}

// The troll's parting shot when the Hype Train ends — aimed at a random
// archer rather than a fixed point, so it reads as actually targeting
// someone rather than firing blindly downrange.
function fireTrollArrow(): void {
  const troll = trollBasePosition()
  const dh = viewH * TROLL_RENDER_H_FRACTION
  const fx = troll.x + trollX
  const fy = troll.y - dh * 0.45
  const target = archers[Math.floor(Math.random() * archers.length)]
  const targetDh = viewH * ARCHER_RENDER_H_FRACTION
  const toX = target ? target.x : viewW * 0.15
  const toY = target ? archerSlotPosition(target.slot).y - targetDh * 0.45 : groundY() - viewH * 0.1
  arrows.push({
    x: fx,
    y: fy,
    fromX: fx,
    fromY: fy,
    toX,
    toY,
    bornAt: performance.now(),
    durationMs: 420,
    big: true,
    hostile: true
  })
  audio.archerShot(0.5)
}

function addFloatingText(text: string, size = 28, yOffsetFraction = 0): void {
  const troll = trollBasePosition()
  texts.push({ text, x: troll.x, y: groundY() - viewH * (0.42 + yOffsetFraction), bornAt: performance.now(), size })
}

// ------------------------------------------------------------------ battle

function beginBattle(startLevel: number, progress: number, goal: number): void {
  archers = []
  arrows = []
  texts = []
  battleActive = true
  ending = undefined
  level = startLevel
  hp = 1
  hpTarget = clampHp(progress, goal)
  trollX = 0
  trollScale = 1
  trollOpacity = 1
  trollPose = 'idle'
  trollStageUntil = 0
  trollDeathAt = undefined
  pendingLevel = undefined
  ensureRunning()
}

function clampHp(progress: number, goal: number): number {
  if (goal <= 0) return 1
  return Math.max(0, Math.min(1, 1 - progress / goal))
}

function progressBattle(progress: number, goal: number): void {
  hpTarget = clampHp(progress, goal)
}

// A level-up means the archers just finished off the current troll: show the
// win, let it die, and stand a fresh one up in its place for the next level
// (rather than the previous behaviour of just resetting the same troll's HP).
function levelUpBattle(newLevel: number): void {
  addFloatingText('VICTORY!', 40)
  audio.trollDefeated(0.6)
  shakeUntil = performance.now() + 300
  pendingLevel = newLevel
  trollDeathAt = performance.now()

  // Everyone draws and looses at once for the finishing volley — interrupts
  // whatever shot state an archer was already in, which is fine for a
  // dramatic beat.
  const now = performance.now()
  for (const archer of archers) {
    archer.pose = 'draw'
    archer.stageUntil = now + DRAW_POSE_MS * 0.6
    archer.pendingBigShot = true
    archer.nextShotAt = now + random(2200, 3600)
  }
}

// The Hype Train itself ending (not a level-up) — the troll gets one parting
// shot at the archers rather than dying or fleeing, since level-ups are now
// what "defeats" a troll.
function endBattle(): void {
  battleActive = false
  ending = 'over'
  endingAt = performance.now()
  addFloatingText('Hype Train Over', 34)
  trollPose = 'draw'
  trollStageUntil = performance.now() + DRAW_POSE_MS
  for (const archer of archers) archer.celebrateUntil = performance.now() + 3000
}

function ensureRunning(): void {
  if (!running) {
    running = true
    lastTime = performance.now()
    requestAnimationFrame(loop)
  }
}

// -------------------------------------------------------------------- step

function step(now: number, dt: number): void {
  hp += (hpTarget - hp) * Math.min(1, dt * 4)

  for (const archer of archers) {
    archer.x += (archer.targetX - archer.x) * Math.min(1, dt * 6)

    if (archer.pose === 'draw' && now >= archer.stageUntil) {
      archer.pose = 'shoot'
      archer.stageUntil = now + SHOOT_POSE_MS
      fireArrow(archer, archer.pendingBigShot)
    } else if (archer.pose === 'shoot' && now >= archer.stageUntil) {
      archer.pose = 'idle'
    } else if (archer.pose === 'idle' && battleActive && now >= archer.nextShotAt) {
      archer.pose = 'draw'
      archer.stageUntil = now + DRAW_POSE_MS
      archer.pendingBigShot = false
      archer.nextShotAt = now + random(1800, 3400)
    }
  }

  if (trollPose === 'draw' && now >= trollStageUntil) {
    trollPose = 'shoot'
    trollStageUntil = now + SHOOT_POSE_MS
    fireTrollArrow()
  } else if (trollPose === 'shoot' && now >= trollStageUntil) {
    trollPose = 'idle'
  }

  for (const arrow of arrows) {
    const t = Math.min(1, (now - arrow.bornAt) / arrow.durationMs)
    arrow.x = arrow.fromX + (arrow.toX - arrow.fromX) * t
    arrow.y = arrow.fromY + (arrow.toY - arrow.fromY) * t - Math.sin(t * Math.PI) * 40
  }
  const before = arrows.length
  arrows = arrows.filter((arrow) => now - arrow.bornAt < arrow.durationMs)
  if (arrows.length < before && battleActive) audio.trollHit(0.18)

  texts = texts.filter((text) => now - text.bornAt < 1800)

  // Old troll shrinks/fades away after a level-up, then a fresh one takes
  // its place — level/HP switch over the instant the animation finishes.
  if (trollDeathAt !== undefined) {
    const t = Math.min(1, (now - trollDeathAt) / 900)
    trollScale = 1 - t
    trollOpacity = 1 - t
    if (t >= 1) {
      trollDeathAt = undefined
      if (pendingLevel !== undefined) level = pendingLevel
      pendingLevel = undefined
      trollScale = 1
      trollOpacity = 1
      hp = 1
      hpTarget = 1 // corrected momentarily by the progress event a level-up is always followed by
      // The small LEVEL N label near the HP bar is easy to miss at the exact
      // moment a new troll pops in — call it out directly too. Offset higher
      // than VICTORY!'s spot since that text (1800ms life) can still be
      // fading out this soon after the death animation (900ms) started it.
      addFloatingText(`LEVEL ${level} TROLL!`, 30, 0.12)
    }
  }
}

// ----------------------------------------------------------------- drawing

function drawArcher(archer: Archer, now: number): void {
  const { y } = archerSlotPosition(archer.slot)
  const x = archer.x
  const arriving = Math.abs(archer.targetX - archer.x) > 1
  const pose: Pose = arriving ? 'run' : archer.pose
  const celebrating = now < archer.celebrateUntil
  const bob = celebrating ? Math.abs(Math.sin(now / 120 + archer.slot)) * 10 : Math.sin(now / 500 + archer.slot) * 2

  const dh = viewH * ARCHER_RENDER_H_FRACTION
  // dy is the sprite's exact top edge (tight bounding box, see ARCHER_FRAMES) —
  // usable directly as the "above the character's head" reference.
  const { dy } = drawSprite(archerSheet, ARCHER_FRAMES, pose, x, dh, y - bob)

  // nametag — stroked before filled so it stays legible over any background video
  ctx.font = '13px "Space Mono", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.strokeText(archer.name, x, dy - 8)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(archer.name, x, dy - 8)
}

function drawTroll(now: number): void {
  if (!battleActive && !ending) return
  const base = trollBasePosition()
  const x = base.x + trollX
  const y = base.y
  const shake = now < shakeUntil ? random(-6, 6) : 0
  const dh = viewH * TROLL_RENDER_H_FRACTION * trollScale

  ctx.save()
  ctx.globalAlpha = trollOpacity
  ctx.translate(x + shake, 0)
  // The sheet faces right, but the troll stands on the right side of the
  // battlefield facing the archers on its left — mirror horizontally.
  ctx.scale(-1, 1)
  const { dy, dw } = drawSprite(trollSheet, TROLL_FRAMES, trollPose, 0, dh, y)
  ctx.restore()

  // HP bar/level label fade along with the death animation (trollOpacity) —
  // still under battleActive's guard since neither means anything once the
  // Hype Train itself has ended, only between levels.
  if (battleActive) {
    const barW = dw * 0.9
    const barX = x - barW / 2
    const barY = dy - 16
    ctx.globalAlpha = trollOpacity
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(barX, barY, barW, 10)
    ctx.fillStyle = hp > 0.3 ? '#4caf50' : '#e04b4b'
    ctx.fillRect(barX, barY, barW * Math.max(0, hp), 10)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(barX, barY, barW, 10)
    ctx.font = 'bold 12px "Space Mono", ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(`LEVEL ${level}`, x, barY - 6)
  }
  ctx.globalAlpha = 1
}

function drawArrow(arrow: Arrow): void {
  ctx.save()
  const angle = Math.atan2(arrow.toY - arrow.fromY, arrow.toX - arrow.fromX)
  ctx.translate(arrow.x, arrow.y)
  ctx.rotate(angle)
  ctx.strokeStyle = arrow.hostile ? '#ff6b4a' : arrow.big ? '#ffd24d' : '#d8d8d8'
  ctx.lineWidth = arrow.big ? 3 : 2
  ctx.beginPath()
  ctx.moveTo(-(arrow.big ? 22 : 14), 0)
  ctx.lineTo(0, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-5, -4)
  ctx.lineTo(-5, 4)
  ctx.closePath()
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
  ctx.restore()
}

function drawTexts(now: number): void {
  for (const text of texts) {
    const t = (now - text.bornAt) / 1800
    ctx.save()
    ctx.globalAlpha = Math.max(0, 1 - t)
    ctx.font = `bold ${text.size}px "Space Mono", ui-monospace, monospace`
    ctx.textAlign = 'center'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.strokeText(text.text, text.x, text.y - t * 30)
    ctx.fillStyle = '#ffe066'
    ctx.fillText(text.text, text.x, text.y - t * 30)
    ctx.restore()
  }
}

function render(now: number): void {
  ctx.clearRect(0, 0, viewW, viewH)
  for (const archer of archers) drawArcher(archer, now)
  drawTroll(now)
  for (const arrow of arrows) drawArrow(arrow)
  drawTexts(now)
}

// ------------------------------------------------------------------- loop

let running = false
let lastTime = 0
let frame = 0

function loop(time: number): void {
  frame += 1
  const dt = Math.min((time - lastTime) / 1000, 0.05)
  lastTime = time

  step(time, dt)

  // Drop the roster once the post-battle grace period elapses, independent
  // of whether the loop is about to stop — archers.length must be able to
  // reach 0 for the idle check below to ever pass.
  if (ending !== undefined && performance.now() - endingAt > 3200) {
    archers = []
    ending = undefined
  }

  render(time)

  // A browser source stays open for the whole stream — stop rAF once there's
  // nothing left to animate rather than idling on it for hours.
  if (!battleActive && ending === undefined && archers.length === 0 && arrows.length === 0 && texts.length === 0) {
    running = false
    ctx.clearRect(0, 0, viewW, viewH)
    return
  }
  requestAnimationFrame(loop)
}

// ------------------------------------------------------------------- wire

const source = new EventSource('/events?feature=hype-train')
source.addEventListener('message', (message) => {
  let event: OverlayEvent
  try {
    event = JSON.parse(message.data) as OverlayEvent
  } catch {
    return
  }

  switch (event.type) {
    case 'hypetrain:begin':
      audio.setVolume(event.volume)
      beginBattle(event.level, event.progress, event.goal)
      break
    case 'hypetrain:archer-join':
      addArcher(event.userName)
      ensureRunning()
      break
    case 'hypetrain:progress':
      progressBattle(event.progress, event.goal)
      break
    case 'hypetrain:level-up':
      levelUpBattle(event.level)
      break
    case 'hypetrain:end':
      endBattle()
      break
    default:
      break
  }
})

// Exposed for automated verification — asserting the loop actually stops
// when the battle settles is otherwise impossible from outside the page.
Object.assign(window, {
  __hypetrain: {
    isRunning: () => running,
    frame: () => frame,
    archerCount: () => archers.length,
    hp: () => hp,
    level: () => level,
    ending: () => ending,
    beginBattle,
    addArcher,
    progressBattle,
    levelUpBattle,
    endBattle
  }
})
