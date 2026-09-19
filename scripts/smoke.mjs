#!/usr/bin/env node
// Smoke harness for the Electron main process.
//
// There is no unit test suite, and the main process is being decomposed from a
// single 1000-line file into ~20 modules. `npm run typecheck` proves the pieces
// still compile; it proves nothing about whether the app still works. This
// script is the gate that does: it launches the real packaged output, drives
// the real renderers over the Chrome DevTools Protocol, and asserts the things
// a refactor is most likely to silently break — module registration order, the
// toggle round-trip through settings, every manager window opening and closing,
// the overlay HTTP surface, and settings surviving a restart.
//
// Deliberately dependency-free: Node's built-in fetch and WebSocket (Node 22+),
// no devDependency, no test runner. It has to stay cheap enough to run on every
// commit or it won't be run at all.
//
// What it CANNOT cover, which stays manual:
//   - audio and TTS actually producing sound (the playback window is hidden and
//     speechSynthesis needs a real backend)
//   - overlay *rendering* — per CLAUDE.md, Chromium won't run requestAnimationFrame
//     for a window that never composites, so overlays must be eyeballed in a real
//     browser. This asserts the HTTP surface responds, not that anything is drawn.
//   - the Twitch OAuth login/logout path (real third-party login)
//   - anything that needs a working Twitch connection. The throwaway profile has
//     no credentials, so chat-backed modules log "No response from Twitch" and
//     Hype Train's EventSub 401s. Those are expected and handled; what's being
//     verified here is the wiring — registration, IPC, windows, persistence —
//     not chat behavior. A module that reports `running` here has been started,
//     not proven to work against Twitch.
//
// Usage:
//   node scripts/smoke.mjs              # reuse the existing throwaway profile
//   node scripts/smoke.mjs --fresh      # wipe it first, exercising the
//                                       # first-launch path (tile order)
//   node scripts/smoke.mjs --keep-open  # leave the app running for inspection

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const PORT = 9411

// The harness runs the app in a throwaway profile of its own, passed explicitly
// via --user-data-dir, and never reads or writes a real one. Two reasons this
// is not optional:
//
//   1. The real profile holds a live Twitch OAuth token. A smoke run must not
//      be able to touch it, and --fresh must not be one typo away from deleting
//      someone's login.
//   2. The real app's userData is keyed on productName ("multibotlabs"), but
//      launching `electron out/main/index.js` finds no package.json and falls
//      back to the app name "Electron" — a *different* directory. Relying on
//      that implicit path meant the harness was silently testing a profile
//      nobody uses. Being explicit removes the ambiguity entirely.
const PROFILE = join(ROOT, '.smoke', 'profile')
const PROFILE_SETTINGS = join(PROFILE, 'settings.json')
const LOG = join(ROOT, '.smoke', 'app.log')

// Deliberately not the app's default 7474: the smoke app must not fight the
// developer's own running instance for the port. A conflict wouldn't crash
// (overlayServer handles EADDRINUSE) but it would fail the overlay checks for a
// reason that has nothing to do with the code under test.
const OVERLAY_PORT = 7599

// Registration order in botDescriptors/registerModules decides fresh-install HUD
// tile order (via reconcileBotOrder + ModuleManager's insertion-ordered Map).
// A refactor that reorders registration is a real regression, and it is silent
// for anyone whose settings.json already has a bots.order — hence --fresh.
const EXPECTED_MODULE_IDS = [
  'live-studio-audience',
  'text-to-speech',
  'command',
  'emote',
  'at-me',
  'media-gif',
  'celebration',
  'coinks',
  'hype-train'
]

// Each manager window, keyed by the module id the HUD opens it with, paired with
// a read-only call on that window's own preload API. Asserting the call returns
// an object proves the window loaded, its preload bridge is attached, and the
// IPC handler behind it is registered — which is most of what the window/IPC
// extraction steps can break.
// `match` is a substring of the window's URL. Command and Emote share the
// library renderer and are distinguished only by the ?kind= query param
// (see loadRenderer in windowManager.ts), so matching on the directory alone
// would confuse the two.
const MANAGER_WINDOWS = [
  { id: 'command', match: 'kind=command', probe: 'window.library.listSounds()' },
  { id: 'emote', match: 'kind=emote', probe: 'window.library.listSounds()' },
  { id: 'text-to-speech', match: '/tts-settings/', probe: 'window.ttsSettings.get()' },
  { id: 'at-me', match: '/atme-queue/', probe: 'window.atMeQueue.getSettings()' },
  { id: 'media-gif', match: '/media/', probe: 'window.mediaLibrary.list()' },
  { id: 'celebration', match: '/celebration/', probe: 'window.celebration.getSettings()' },
  { id: 'coinks', match: '/coinks/', probe: 'window.coinks.getSettings()' },
  { id: 'hype-train', match: '/hypetrain/', probe: 'window.hypeTrain.getSettings()' }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Every abnormal exit must still kill the child, or the run leaves an orphaned
// Electron holding the debug port and (if it crashed) a modal error dialog
// sitting on the developer's desktop. The paths that actually bit during
// development: a `timeout` sending SIGTERM, and SIGPIPE from piping this
// script's output into `head`.
let activeChild = null

function killChildNow() {
  if (activeChild && activeChild.exitCode === null) {
    try {
      activeChild.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
  activeChild = null
}

process.on('SIGINT', () => {
  killChildNow()
  process.exit(130)
})
process.on('SIGTERM', () => {
  killChildNow()
  process.exit(143)
})
process.on('uncaughtException', (error) => {
  console.error(error)
  killChildNow()
  process.exit(1)
})
// Writing to a closed pipe (`node scripts/smoke.mjs | head`) raises EPIPE on
// stdout. Swallow it so cleanup still runs.
process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error
})

let passed = 0
const failures = []

// Everything the main process printed this run. The first version of this
// harness piped the child's stdio and then never read it, so main-process
// exceptions were invisible and the run reported "all passed" while the app was
// throwing. Output is captured, mirrored to .smoke/app.log, and scanned.
let appOutput = ''

// Electron shows a modal error box for an uncaught main-process exception, which
// blocks until someone clicks OK — so an unnoticed throw doesn't just corrupt
// the results, it wedges the run. Anything matching here fails the run outright.
const CRASH_PATTERNS = [
  /Uncaught Exception/i,
  /UnhandledPromiseRejection/i,
  /\bFATAL\b/,
  /A JavaScript error occurred in the main process/i,
  /^\s*at .*\n\s*at /m
]

function recordAppOutput(chunk) {
  const text = chunk.toString()
  appOutput += text
  try {
    appendFileSync(LOG, text)
  } catch {
    // logging is best-effort
  }
}

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// --- CDP -------------------------------------------------------------------

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return res.json()
}

async function waitForTarget(urlPart, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const found = (await targets()).find(
        (t) => t.type === 'page' && t.url.includes(urlPart)
      )
      if (found) return found
    } catch {
      // debug port not up yet
    }
    await sleep(200)
  }
  return undefined
}

// One CDP session per evaluation batch. Kept deliberately small rather than
// wrapped in a client abstraction — the whole point is that this file is
// readable end to end without learning a framework.
async function withSession(target, fn) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    const resolve = pending.get(msg.id)
    if (resolve) {
      pending.delete(msg.id)
      resolve(msg)
    }
  })

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP connect failed')), { once: true })
  })

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  // Awaits promises in the page, so `window.hud.getModules()` comes back resolved
  // rather than as a Promise handle.
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (res.result?.exceptionDetails) {
      throw new Error(
        res.result.exceptionDetails.exception?.description ??
          res.result.exceptionDetails.text
      )
    }
    return res.result?.result?.value
  }

  try {
    return await fn(evaluate)
  } finally {
    ws.close()
  }
}

async function inHud(fn) {
  const hud = await waitForTarget('/hud/')
  if (!hud) throw new Error('HUD target never appeared')
  return withSession(hud, fn)
}

// --- checks ----------------------------------------------------------------

async function checkModules() {
  section('Modules')
  const modules = await inHud((evaluate) => evaluate('window.hud.getModules()'))

  check('getModules returns an array', Array.isArray(modules))
  if (!Array.isArray(modules)) return

  check(
    `registers ${EXPECTED_MODULE_IDS.length} modules`,
    modules.length === EXPECTED_MODULE_IDS.length,
    `got ${modules.length}`
  )

  const ids = modules.map((m) => m.id)
  check(
    'module order matches expected registration order',
    JSON.stringify(ids) === JSON.stringify(EXPECTED_MODULE_IDS),
    `got ${ids.join(', ')}`
  )

  const shaped = modules.every(
    (m) => typeof m.displayName === 'string' && m.displayName.length > 0 && typeof m.status === 'string'
  )
  check('every module has displayName and status', shaped)
}

async function checkToggleRoundTrip() {
  section('Toggle round-trip')
  // Toggling exercises: moduleManager.setEnabled -> syncSettingsFromModules ->
  // saveSettings -> broadcastModules. syncSettingsFromModules is a hand-written
  // id->settings-key mapping today and becomes descriptor-driven, so a wrong
  // mapping shows up here as a toggle that doesn't stick.
  await inHud(async (evaluate) => {
    for (const id of EXPECTED_MODULE_IDS) {
      const before = (await evaluate('window.hud.getModules()')).find((m) => m.id === id)
      const afterToggle = (await evaluate(`window.hud.toggleModule(${JSON.stringify(id)})`)).find(
        (m) => m.id === id
      )
      const restored = (await evaluate(`window.hud.toggleModule(${JSON.stringify(id)})`)).find(
        (m) => m.id === id
      )

      check(
        `${id}: toggles and restores`,
        afterToggle.enabled === !before.enabled && restored.enabled === before.enabled,
        `${before.enabled} -> ${afterToggle.enabled} -> ${restored.enabled}`
      )
    }
  })
}

async function checkManagerWindows() {
  section('Manager windows')
  for (const { id, match, probe } of MANAGER_WINDOWS) {
    try {
      await inHud((evaluate) => evaluate(`window.hud.openLibrary(${JSON.stringify(id)})`))
      const target = await waitForTarget(match, 6000)
      if (!target) {
        check(`${id}: window opens`, false, `no target matching ${match}`)
        continue
      }

      const value = await withSession(target, (evaluate) => evaluate(probe))
      check(`${id}: opens and its preload API responds`, value !== undefined && value !== null)

      // The same channel the HUD's right-click uses is a *toggle*: invoking it
      // again closes the window. Asserting the target is really gone afterward
      // is what catches a window registry that deletes its entry eagerly instead
      // of on the 'closed' event — that bug shows up as a second window rather
      // than a closed one.
      await inHud((evaluate) => evaluate(`window.hud.openLibrary(${JSON.stringify(id)})`))
      await sleep(700)
      const stillOpen = (await targets()).some((t) => t.type === 'page' && t.url.includes(match))
      check(`${id}: re-toggle closes it`, !stillOpen)
    } catch (error) {
      check(`${id}: window cycle`, false, error.message)
    }
  }
}

async function checkSettingsWindowVerbs() {
  section('Settings window: open focuses, toggle closes')
  // These two channels have near-identical bodies and differ only in what they
  // do to an already-open window — open focuses, toggle closes. That reads like
  // copy-paste begging to be merged, so it needs a test that fails loudly if
  // someone unifies them.
  const countSettings = async () =>
    (await targets()).filter((t) => t.type === 'page' && t.url.includes('/settings/')).length

  try {
    await inHud((evaluate) => evaluate('window.hud.openSettings()'))
    await sleep(900)
    check('open-settings opens the window', (await countSettings()) === 1)

    // The distinguishing case: opening again must focus the existing window,
    // not open a second one and not close it.
    await inHud((evaluate) => evaluate('window.hud.openSettings()'))
    await sleep(900)
    check('open-settings again focuses, leaving exactly one', (await countSettings()) === 1)

    await inHud((evaluate) => evaluate('window.hud.toggleSettings()'))
    await sleep(900)
    check('toggle-settings closes it', (await countSettings()) === 0)
  } catch (error) {
    check('settings window verbs', false, error.message)
  }
}

async function checkOverlay() {
  section('Overlay server')
  const base = `http://127.0.0.1:${OVERLAY_PORT}`

  try {
    const page = await fetch(`${base}/overlay/`)
    check('GET /overlay/ responds 200', page.status === 200, `got ${page.status}`)
  } catch (error) {
    check('GET /overlay/ responds 200', false, error.message)
  }

  // SSE: assert the headers and that the stream opens, then abort. Without the
  // abort this hangs forever by design.
  try {
    const controller = new AbortController()
    const res = await fetch(`${base}/events?feature=media`, { signal: controller.signal })
    const type = res.headers.get('content-type') ?? ''
    check('GET /events serves an SSE stream', res.status === 200 && type.includes('text/event-stream'), `${res.status} ${type}`)
    controller.abort()
  } catch (error) {
    check('GET /events serves an SSE stream', false, error.message)
  }

  // The coin game's one inbound route. Posting a result is safe and idempotent
  // by design (see CLAUDE.md) — it records a score for a player that doesn't
  // exist, which the leaderboard tolerates.
  try {
    const res = await fetch(`${base}/coinks/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player: '__smoke_test__', score: 0 })
    })
    // 204 No Content today; assert the class, not the exact code — this route
    // is fire-and-forget and its status is not part of any contract.
    check('POST /coinks/result accepts a result', res.ok, `got ${res.status}`)
  } catch (error) {
    check('POST /coinks/result accepts a result', false, error.message)
  }
}

async function checkPersistence(launch) {
  section('Settings persistence across restart')
  // Catches syncSettingsFromModules regressions that a same-session toggle
  // round-trip would miss: the value has to reach disk and come back.
  const target = 'live-studio-audience'

  const before = await inHud(async (evaluate) => {
    const mods = await evaluate('window.hud.getModules()')
    return mods.find((m) => m.id === target).enabled
  })

  await inHud((evaluate) => evaluate(`window.hud.toggleModule(${JSON.stringify(target)})`))
  await sleep(500)

  await launch.restart()

  const after = await inHud(async (evaluate) => {
    const mods = await evaluate('window.hud.getModules()')
    return mods.find((m) => m.id === target).enabled
  })

  check(`${target}: toggle survives restart`, after === !before, `${before} -> ${after}`)

  // Leave it as we found it.
  await inHud((evaluate) => evaluate(`window.hud.toggleModule(${JSON.stringify(target)})`))
  await sleep(400)
}

// --- app lifecycle ---------------------------------------------------------

function launchApp() {
  let child

  const start = async () => {
    child = spawn(
      ELECTRON,
      [MAIN, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        // The shell this runs from may have ELECTRON_RUN_AS_NODE set, which
        // makes the binary behave as plain Node and never start the app.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
      }
    )
    activeChild = child
    child.stdout.on('data', recordAppOutput)
    child.stderr.on('data', recordAppOutput)

    const hud = await waitForTarget('/hud/', 20000)
    if (!hud) {
      throw new Error(
        `app did not start (no HUD target within 20s). Output:\n${appOutput.slice(-2000)}`
      )
    }
    await sleep(800)
  }

  const stop = async () => {
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    const deadline = Date.now() + 5000
    while (child.exitCode === null && Date.now() < deadline) await sleep(100)
    if (child.exitCode === null) child.kill('SIGKILL')
    await sleep(500)
    activeChild = null
  }

  return {
    start,
    stop,
    restart: async () => {
      await stop()
      await start()
    },
    isAlive: () => Boolean(child) && child.exitCode === null
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  const fresh = process.argv.includes('--fresh')
  const keepOpen = process.argv.includes('--keep-open')

  if (!existsSync(ELECTRON)) {
    console.error(`Electron binary missing at ${ELECTRON}\nRun: node node_modules/electron/install.js`)
    process.exit(1)
  }
  if (!existsSync(MAIN)) {
    console.error(`No build output at ${MAIN}\nRun: npm run build`)
    process.exit(1)
  }

  // --fresh wipes the harness's own throwaway profile so registerModules and
  // reconcileBotOrder run the first-launch path. It cannot reach a real profile.
  if (fresh) {
    rmSync(PROFILE, { recursive: true, force: true })
    console.log('--fresh: smoke profile wiped (first-launch path)')
  }

  mkdirSync(PROFILE, { recursive: true })
  rmSync(LOG, { force: true })

  // Seed only the overlay port, and only when there's no settings file yet:
  // writing a partial settings.json exercises SettingsStore.load()'s
  // merge-over-defaults path, which is what a real upgrade does too.
  if (!existsSync(PROFILE_SETTINGS)) {
    writeFileSync(
      PROFILE_SETTINGS,
      JSON.stringify({ modules: { mediaGif: { overlayPort: OVERLAY_PORT } } }, null, 2)
    )
  }

  const launch = launchApp()

  try {
    await launch.start()
    await checkModules()
    await checkToggleRoundTrip()
    await checkManagerWindows()
    await checkSettingsWindowVerbs()
    await checkOverlay()
    await checkPersistence(launch)

    section('Main process health')
    // The assertions above all run through the renderer, so every one of them
    // can pass while the main process is throwing behind a modal error box.
    // These two checks are what make the rest trustworthy.
    check('app process still running', launch.isAlive())

    const crashes = CRASH_PATTERNS.flatMap((pattern) => {
      const found = appOutput.match(pattern)
      return found ? [found[0].split('\n')[0].trim()] : []
    })
    check(
      'no crashes or uncaught exceptions in main process output',
      crashes.length === 0,
      crashes.join(' | ')
    )
  } catch (error) {
    failures.push(`harness error: ${error.message}`)
    console.error(`\nharness error: ${error.stack}`)
  } finally {
    if (!keepOpen) await launch.stop()
    killChildNow()
  }

  if (appOutput.trim()) {
    console.log(`\nMain process output captured to ${LOG} (${appOutput.split('\n').length} lines)`)
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main()
