import type { OverlayEvent } from '../../main/overlay/types'
import { OverlayAudio } from '../assets/overlayAudio'

/*
 * Coinks — ported from the recovered Unity project (CoinGameManager.cs,
 * BeltItemSpawner.cs, CoinManager.cs, BeltItemController.cs).
 *
 * The single most important thing the source revealed: the coin prefab has
 * `m_GravityScale: 0`. The coin does not arc onto the belt — it travels
 * straight up from below it, comes to rest on it, and is then dragged off the
 * right-hand edge (`ConveyorBeltController` moved any rigidbody resting on it).
 * So this is a *timing* game: you send !coin to intercept the tile scrolling
 * past centre. Anything that made the coin fall, or let it fly through the
 * belt, would be a different game.
 *
 * Two deliberate departures from the original, both for feel:
 *  - the lead time between the request and the coin appearing is randomised
 *    rather than a fixed 1.2s, so it can't be reduced to a stopwatch;
 *  - the coin decelerates under friction instead of travelling at a constant
 *    15 units/s until something stops it, so it settles onto the belt rather
 *    than hitting an invisible wall at a fixed height.
 */

// ---------------------------------------------------------------- world model
// Unity world units, preserved so the original's proportions and timings carry
// over exactly; scaled to whatever size OBS gives the browser source.
const WORLD_WIDTH = 20 // x from -10..10, matching the spawner at -10 and cull at +10
const BELT_Y = -4
// Rendered size only — scoring is a centre-point test against the tile under
// the coin, not a box overlap, so there is no separate collider to keep in sync.
const COIN_W = 1.65

const BASE_BELT_SPEED = 3.0 // units/s, ConveyorBeltController.speed
const BASE_SPAWN_INTERVAL = 0.9525 // s, BeltItemSpawner.spawnInterval

// Tile width IS the distance the belt travels between spawns, so tiles sit
// flush against each other and the backing belt never shows through. It stays
// correct at every speed tier because speed-up halves the interval while
// doubling the speed (and vice versa), leaving the product unchanged.
const TILE_W = BASE_BELT_SPEED * BASE_SPAWN_INTERVAL

// The tile art is 190x200 — very slightly taller than wide. Deriving height
// from that aspect rather than picking a number keeps the sprites undistorted;
// an earlier fixed 1.6 stretched every tile to nearly 2:1.
const TILE_ASPECT = 190 / 200
const TILE_H = TILE_W / TILE_ASPECT

// conveyorBelt.png is 1920x200, i.e. a full-screen-width strip.
const BELT_SPRITE_ASPECT = 1920 / 200
const BELT_SPRITE_W = TILE_H * BELT_SPRITE_ASPECT

// The coin slides onto the belt and is stopped by friction rather than by an
// invisible floor: launched from below the belt with a modest speed and a
// constant deceleration, it comes to rest wherever it runs out of momentum.
// Randomised launch speed means coins don't all settle in a line.
const COIN_LAUNCH_MIN = 5.4
const COIN_LAUNCH_MAX = 7.2
const COIN_DECEL = 8.2 // units/s^2
const SPAWN_Y = -7.0 // clearly below the belt band so the slide-on is visible

// Tiles are created and culled a full tile beyond each edge, so they slide in
// and are dragged off rather than popping into existence at the boundary.
const STRIP_EDGE = WORLD_WIDTH / 2 + TILE_W

const COIN_LIFETIME_MS = 10_000
// The original waited a fixed 1.2s between the request and the coin appearing.
// A constant lead makes the timing purely solvable once you've learned it, so
// this version randomises it — you're playing the belt, not a stopwatch.
const COIN_DELAY_MIN_MS = 0
const COIN_DELAY_MAX_MS = 1000
const AUTO_THROW_MS = 20_000 // coinThrowDelay
const END_GRACE_MS = 1500 // DidYouLose()
const END_GRACE_FRENZY_MS = 4000
const GAMEOVER_BANNER_MS = 3000
const GAMEOVER_HOLD_MS = 5000
const GAMEOVER_OUT_MS = 1000
const FRENZY_LEAD_MS = 1000
const FRENZY_COINS = 10

type TileKind =
  | 'p25' | 'p50' | 'p100' | 'm25'
  | 'x2' | 'plus2' | 'frenzy'
  | 'speedup' | 'speeddown'
  | 'mystery' | 'logo' | 'blank'

// The original picked tiles through a chain of `else if (Random.Range(...))`,
// so each branch was conditional on the earlier ones failing. These are the
// resulting *effective* rates, restated as a flat table — same feel as what
// players actually experienced, without reproducing the nested accident.
// The original also mixed in blank spacers, but its tiles were narrower than
// their spacing so bare belt showed between every one of them anyway. Here the
// strip is flush, which makes a blank read as a hole rather than as breathing
// room — so its share goes to the logo tile, which was already the filler.
const TILE_WEIGHTS: [TileKind, number][] = [
  ['frenzy', 7.0],
  ['logo', 36.5],
  ['x2', 1.28],
  ['plus2', 1.26],
  // Remaining ~61.66% was a uniform pick from the inspector's itemPrefabs list.
  ['p25', 7.71], ['p50', 7.71], ['p100', 7.71], ['m25', 7.71],
  ['speedup', 7.71], ['speeddown', 7.71], ['mystery', 7.7]
]

const MYSTERY_ROLL: { delta: number; sprite: string; label: string }[] = [
  { delta: 50, sprite: 'mysterPlus50', label: '+50' },
  { delta: 200, sprite: 'mysterPlus200', label: '+200' },
  { delta: -100, sprite: 'mysterMinus100', label: '-100' },
  { delta: -50, sprite: 'mysterMinus50', label: '-50' }
]

// Sound names map to the events CoinGameAudioController defined. Which WAV the
// original bound to each one lived in the Unity inspector, not the source, so
// these pairings are a judgement call from the filenames.
const SOUNDS: Record<string, string> = {
  start: 'startGame',
  drop: 'coinDrop',
  smallScore: 'arcadeSparkle',
  bigScore: 'bigScore',
  error: 'error',
  extraCoins: 'extraCoins',
  frenzy: 'coinFrenzy',
  mystery: 'ui_SoundSplat'
}

const audio = new OverlayAudio()
for (const [name, file] of Object.entries(SOUNDS)) {
  void audio.load(name, `/game/${file}.${file === 'ui_SoundSplat' ? 'mp3' : 'wav'}`)
}

const TILE_SPRITES: Record<TileKind, string> = {
  p25: '25ptsItem', p50: '50ptsItem', p100: '100ptsItem', m25: 'minus25pts',
  x2: '2xItem', plus2: '2coinsPlusItem', frenzy: 'coinFrenzyItem',
  speedup: 'SpeedUpTile', speeddown: 'speedDown',
  mystery: 'mysteryBeltItem', logo: 'coinksBeltItem', blank: 'blankbeltitemhalf'
}

// ------------------------------------------------------------------- elements
const canvas = document.getElementById('field') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
const scoreboard = document.getElementById('scoreboard') as HTMLDivElement
const sbPlayer = document.getElementById('sb-player') as HTMLDivElement
const sbScore = document.getElementById('sb-score') as HTMLSpanElement
const sbCoins = document.getElementById('sb-coins') as HTMLSpanElement
const banner = document.getElementById('banner') as HTMLDivElement

const sprites = new Map<string, HTMLImageElement>()
function sprite(name: string): HTMLImageElement | undefined {
  let image = sprites.get(name)
  if (!image) {
    image = new Image()
    image.src = `/game/${name}.png`
    sprites.set(name, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : undefined
}

// -------------------------------------------------------------------- state
type GameState = 'idle' | 'playing' | 'aboutToEnd' | 'gameOver'

interface Tile {
  id: number
  x: number
  kind: TileKind
  revealedSprite?: string
}

interface Coin {
  id: number
  x: number
  y: number
  vy: number
  vx: number
  bornAt: number
  hit: Set<number>
  /** Friction has taken the last of its upward momentum; now purely belt-driven. */
  landed: boolean
}

let state: GameState = 'idle'
let player = ''
let score = 0
let coinsRemaining = 0
let speedTier = 0
let tiles: Tile[] = []
let coins: Coin[] = []
let frenziesActive = 0
let lastThrowAt = 0
let nextId = 1
let endAt = 0
let forcedTile: TileKind | undefined
let frame = 0
let running = false
let lastTime = 0
let beltScroll = 0

const beltSpeed = (): number => BASE_BELT_SPEED * Math.pow(2, speedTier)

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

// Horizontal mapping is the literal world: 20 units across the full width, so
// belt speed and tile spacing keep the original's rhythm — that rhythm *is* the
// game. Vertically the belt is anchored to a fraction of the canvas instead of
// a fixed world y: deriving it from the same scale assumes a ~16:9 source, and
// on a wider one (OBS lets you size a browser source freely) the belt slides off
// the bottom and the coin spawns off-screen entirely.
const BELT_SCREEN_FRACTION = 0.72

const scale = (): number => viewW / WORLD_WIDTH
const beltScreenY = (): number => viewH * BELT_SCREEN_FRACTION
const screenX = (wx: number): number => viewW / 2 + wx * scale()
const screenY = (wy: number): number => beltScreenY() - (wy - BELT_Y) * scale()

// -------------------------------------------------------------------- scoring
function setScore(next: number): void {
  score = next
  sbScore.textContent = String(score)
}

function setCoins(next: number): void {
  coinsRemaining = next
  sbCoins.textContent = String(coinsRemaining)
}

function showBanner(text: string, ms: number): void {
  banner.textContent = text
  banner.classList.add('show')
  window.setTimeout(() => banner.classList.remove('show'), ms)
}

function applyTile(tile: Tile): void {
  switch (tile.kind) {
    case 'p25': setScore(score + 25); audio.play('smallScore'); break
    case 'p50': setScore(score + 50); audio.play('smallScore'); break
    case 'p100': setScore(score + 100); audio.play('bigScore'); break
    case 'm25': setScore(score - 25); audio.play('error'); break
    case 'x2': setScore(score * 2); audio.play('bigScore'); break
    case 'plus2': setCoins(coinsRemaining + 2); audio.play('extraCoins'); break
    case 'frenzy': startFrenzy(); break
    // Three tiers only (-1, 0, 1), exactly as the original clamped them.
    case 'speedup': speedTier = Math.min(1, speedTier + 1); break
    case 'speeddown': speedTier = Math.max(-1, speedTier - 1); break
    case 'mystery': {
      const roll = MYSTERY_ROLL[Math.floor(Math.random() * MYSTERY_ROLL.length)]
      tile.revealedSprite = roll.sprite
      setScore(score + roll.delta)
      audio.play('mystery')
      audio.play(roll.delta >= 0 ? 'smallScore' : 'error')
      showBanner(roll.label, 1800)
      break
    }
    case 'logo':
    case 'blank':
      break
  }
}

function startFrenzy(): void {
  frenziesActive += 1
  audio.play('frenzy')
  showBanner('COIN FEVER!', 2600)
  window.setTimeout(() => {
    let dropped = 0
    const dropOne = (): void => {
      if (dropped >= FRENZY_COINS) {
        frenziesActive -= 1
        return
      }
      dropped += 1
      spawnCoin()
      window.setTimeout(dropOne, 500 + Math.random() * 700)
    }
    dropOne()
  }, FRENZY_LEAD_MS)
}

// ---------------------------------------------------------------- simulation
function pickTileKind(): TileKind {
  if (forcedTile) {
    const forced = forcedTile
    forcedTile = undefined
    return forced
  }
  const total = TILE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = Math.random() * total
  for (const [kind, weight] of TILE_WEIGHTS) {
    roll -= weight
    if (roll <= 0) return kind
  }
  return 'blank'
}

// Keeps the strip continuous by placing each new tile exactly one tile-width
// left of the last one, rather than spawning on a timer — accumulating dt
// leaves sub-frame drift, and drift is visible as flickering gaps.
function refillStrip(): void {
  while (tiles.length === 0 || tiles[tiles.length - 1].x > -STRIP_EDGE) {
    const x = tiles.length === 0 ? -STRIP_EDGE : tiles[tiles.length - 1].x - TILE_W
    tiles.push({ id: nextId++, x, kind: pickTileKind() })
  }
}

/** Fills the visible belt before play starts, so it never begins bare. */
function seedStrip(): void {
  tiles = []
  for (let x = STRIP_EDGE; x >= -STRIP_EDGE; x -= TILE_W) {
    tiles.push({ id: nextId++, x, kind: pickTileKind() })
  }
}

function spawnCoin(): void {
  audio.play('drop')
  const delay = COIN_DELAY_MIN_MS + Math.random() * (COIN_DELAY_MAX_MS - COIN_DELAY_MIN_MS)
  window.setTimeout(() => {
    coins.push({
      id: nextId++,
      x: 0,
      y: SPAWN_Y,
      vy: COIN_LAUNCH_MIN + Math.random() * (COIN_LAUNCH_MAX - COIN_LAUNCH_MIN),
      vx: 0,
      bornAt: performance.now(),
      hit: new Set(),
      landed: false
    })
    ensureRunning()
  }, delay)
}

function throwCoin(): void {
  if (state !== 'playing' || coinsRemaining <= 0) return
  setCoins(coinsRemaining - 1)
  lastThrowAt = performance.now()
  spawnCoin()
}

// Scores the one tile the coin actually came to rest on.
//
// This used to be an AABB test against the coin's 3-unit Unity collider, which
// gave a half-width of (3 + TILE_W)/2 = 2.93 units — wider than a whole tile,
// so a coin could trigger a tile a full tile away. Tiles are flush and don't
// overlap, so "which tile is the coin's centre over" is both unambiguous and
// exactly what a player expects.
function scoreLanding(coin: Coin): void {
  const tile = tiles.find((candidate) => Math.abs(coin.x - candidate.x) <= TILE_W / 2)
  if (!tile || coin.hit.has(tile.id)) return
  coin.hit.add(tile.id)
  applyTile(tile)
}

function step(dt: number): void {
  frame += 1
  const now = performance.now()

  // Idle players still get their turn spent, so a queue can't stall forever.
  if (state === 'playing' && coinsRemaining > 0 && now - lastThrowAt >= AUTO_THROW_MS) throwCoin()

  const speed = beltSpeed()
  beltScroll += speed * dt
  for (const tile of tiles) tile.x += speed * dt
  tiles = tiles.filter((tile) => tile.x <= STRIP_EDGE)
  if (state === 'playing') refillStrip()

  const beltBottom = BELT_Y - TILE_H / 2
  for (const coin of coins) {
    if (coin.landed) {
      // Carried along by the belt, exactly as ConveyorBeltController did to any
      // rigidbody resting on it.
      coin.x += speed * dt
    } else {
      coin.vy = Math.max(0, coin.vy - COIN_DECEL * dt)
      coin.y += coin.vy * dt

      // Once it's touching the belt it starts getting dragged sideways, easing
      // up to belt speed instead of snapping — so it curves as it slows.
      if (coin.y >= beltBottom) coin.vx += (speed - coin.vx) * Math.min(1, dt * 4)
      coin.x += coin.vx * dt

      // Scoring happens at the moment it stops, not while it's still sliding —
      // otherwise a coin banks every tile it brushes past on the way up.
      if (coin.vy <= 0) {
        coin.landed = true
        coin.vy = 0
        scoreLanding(coin)
      }
    }
  }
  // Dragged off the right-hand edge, or expired if something ever strands one.
  coins = coins.filter((coin) => coin.x <= STRIP_EDGE && now - coin.bornAt < COIN_LIFETIME_MS)

  if (state === 'playing' && coinsRemaining <= 0 && coins.length === 0) {
    state = 'aboutToEnd'
    endAt = now + (frenziesActive > 0 ? END_GRACE_MS + END_GRACE_FRENZY_MS : END_GRACE_MS)
  }

  if (state === 'aboutToEnd' && now >= endAt) {
    if (coinsRemaining > 0 || frenziesActive > 0) state = 'playing'
    else void endGame()
  }
}

// ------------------------------------------------------------------ rendering
function render(): void {
  ctx.clearRect(0, 0, viewW, viewH)
  const s = scale()

  const beltTop = screenY(BELT_Y + TILE_H / 2)
  const beltH = TILE_H * s

  // Solid backing first, so a gap can never show through to the stream even if
  // a sprite is slow to load or has transparent edges.
  ctx.fillStyle = '#2a2d38'
  ctx.fillRect(0, beltTop, viewW, beltH)

  // The belt texture scrolls with the tiles. Drawn as a static backdrop it read
  // as a stationary strip with things sliding over it, which is the opposite of
  // a conveyor. Tiled twice so the seam is always off-screen.
  const beltImage = sprite('conveyorBelt')
  if (beltImage) {
    const tileWidthPx = BELT_SPRITE_W * s
    let offset = (beltScroll % BELT_SPRITE_W) * s
    if (offset > 0) offset -= tileWidthPx
    for (let x = offset; x < viewW; x += tileWidthPx) {
      ctx.drawImage(beltImage, x, beltTop, tileWidthPx, beltH)
    }
  }

  for (const tile of tiles) {
    // 'blank' is genuinely empty belt — the art for it is a narrow spacer that
    // would be stretched several times over, so let the belt itself show.
    if (tile.kind === 'blank' && !tile.revealedSprite) continue
    const image = sprite(tile.revealedSprite ?? TILE_SPRITES[tile.kind])
    const w = TILE_W * s
    const h = TILE_H * s
    const x = screenX(tile.x) - w / 2
    const y = screenY(BELT_Y) - h / 2
    if (image) ctx.drawImage(image, x, y, w, h)
  }

  const coinImage = sprite('coin2')
  for (const coin of coins) {
    const size = COIN_W * s
    const x = screenX(coin.x) - size / 2
    const y = screenY(coin.y) - size / 2
    if (coinImage) {
      ctx.drawImage(coinImage, x, y, size, size)
    } else {
      ctx.fillStyle = '#ffd45e'
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ----------------------------------------------------------------- game loop
function loop(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.05) // clamp so a stalled tab can't teleport the belt
  lastTime = time

  step(dt)
  render()

  // A browser source is open for the whole stream; idling on rAF between games
  // would burn a core for hours.
  if (state === 'idle' && tiles.length === 0 && coins.length === 0) {
    running = false
    ctx.clearRect(0, 0, viewW, viewH)
    return
  }
  requestAnimationFrame(loop)
}

function ensureRunning(): void {
  if (running) return
  running = true
  lastTime = performance.now()
  requestAnimationFrame(loop)
}

// ------------------------------------------------------------------ lifecycle
function startGame(nextPlayer: string, coinCount: number, volume = 0.6): void {
  audio.setVolume(volume)
  audio.play('start')
  player = nextPlayer
  speedTier = 0
  coins = []
  frenziesActive = 0
  seedStrip()
  lastThrowAt = performance.now()
  setScore(0)
  setCoins(coinCount)
  sbPlayer.textContent = nextPlayer
  scoreboard.classList.add('in')
  state = 'playing'
  ensureRunning()
}

async function endGame(): Promise<void> {
  state = 'gameOver'
  const finalPlayer = player
  const finalScore = score

  showBanner('GAME OVER', GAMEOVER_HOLD_MS)
  window.setTimeout(() => {
    scoreboard.classList.remove('in')
    window.setTimeout(() => {
      tiles = []
      coins = []
      state = 'idle'
    }, GAMEOVER_OUT_MS)
  }, GAMEOVER_BANNER_MS + GAMEOVER_HOLD_MS)

  // Reporting the result is also what tells main the turn is over, so it must
  // happen even if the request fails — hence no await on the caller side.
  try {
    await fetch('/coinks/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: finalPlayer, score: finalScore })
    })
  } catch (error) {
    console.error('[coinks] failed to report result:', error)
  }
}

// ----------------------------------------------------------------------- wire
const source = new EventSource('/events?feature=coinks')
source.addEventListener('message', (message) => {
  let event: OverlayEvent
  try {
    event = JSON.parse(message.data) as OverlayEvent
  } catch {
    return
  }

  if (event.type === 'coinks:start') startGame(event.player, event.coins, event.volume)
  else if (event.type === 'coinks:throw') throwCoin()
})

// Exposed for automated verification. Forcing the next tile is the only way to
// assert exact score deltas — otherwise scoring can only be tested by luck.
Object.assign(window, {
  __coinks: {
    state: () => state,
    score: () => score,
    coins: () => coinsRemaining,
    player: () => player,
    speedTier: () => speedTier,
    tileCount: () => tiles.length,
    coinCount: () => coins.length,
    tileWidth: () => TILE_W,
    tileHeight: () => TILE_H,
    debugTiles: () => tiles.map((t) => ({ x: t.x, kind: t.kind })),
    debugCoins: () => coins.map((c) => ({ x: c.x, y: c.y, landed: c.landed })),
    isRunning: () => running,
    frame: () => frame,
    forceNextTile: (kind: TileKind) => {
      forcedTile = kind
    },
    // Applies a tile's effect with no physics involved. A coin intercepts
    // whatever happens to be at centre when it arrives, so driving the belt is
    // the wrong way to assert an exact score delta — this tests the scoring
    // table directly, leaving interception to be checked behaviourally.
    applyTileKind: (kind: TileKind) => applyTile({ id: -1, x: 0, kind }),
    startGame,
    throwCoin
  }
})
