# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-platform (Windows + Linux + macOS/Apple Silicon) desktop Twitch bot toolkit — a small always-visible
HUD bar that toggles independent bot modules on/off (sound commands, emote-triggered
sounds, text-to-speech, chat reaction sounds). It's an Electron/TypeScript rewrite of an
older Windows-only .NET WPF app. Two things shaped the architecture directly:

- **Security**: This app authenticates via Twitch's **implicit grant flow**
  specifically so no client secret is ever needed — see `src/main/auth/`. Nothing
  under `src/` should ever contain real credentials; runtime settings live in
  Electron's userData directory (`SettingsStore`, see below), never in the repo.
- **Legacy data compatibility**: existing users have hundreds of hand-created sound
  commands in the old app's data files. `src/main/library/legacyImport.ts` reads
  those directly (`%APPDATA%\MultiBot\commands.json` etc. on Windows) so upgrading
  doesn't mean starting over.

## Commands

Run from `app/`:

- `npm run dev` — start in development (electron-vite, hot reload). This serves
  renderer pages from a Vite dev server (`http://localhost:5173`), **not** `file://`
  — see the data: URL note below, it matters.
- `npm run build` — production build to `out/`.
- `npm start` — build and preview the production output (`electron-vite preview`).
- `npm run typecheck` — type-checks main/preload (`tsconfig.node.json`) and renderer
  (`tsconfig.web.json`) separately; run this after any change, it's the fastest signal.
- `node scripts/smoke.mjs` — smoke harness. Launches the built app (`npm run build`
  first) and drives the real renderers over the Chrome DevTools Protocol, asserting
  module registration order, the toggle round-trip through settings, every manager
  window opening and closing, the `open`-focuses/`toggle`-closes distinction, the
  overlay HTTP surface, settings surviving a restart, and that the main process
  didn't crash. `--fresh` wipes its profile first to exercise the first-launch path.

  It runs in a throwaway profile via an explicit `--user-data-dir` and on a
  non-default overlay port, so it can't touch your real settings or fight your own
  running instance.

  What it does **not** cover, and therefore still needs a human: audio and TTS
  actually making sound, overlay *rendering* (see the browser-source note below),
  and the Twitch OAuth login/logout path. Its profile has no credentials, so
  chat-backed modules log "No response from Twitch" during a run — expected. A
  module reporting `running` there has been started, not proven to work.

There is no unit test suite or linter configured, but `noUnusedLocals` and
`noUnusedParameters` are on in both tsconfigs, so `npm run typecheck` fails on
dead code — an orphaned function left behind by a refactor is caught rather than
accumulating silently. Genuinely-unused function parameters need a leading
underscore (`_event`), which is the convention already used throughout the IPC
handlers.

## Dependencies

**Never use npm `overrides` to force a transitive dependency to a version its
parent doesn't declare support for** — resolve vulnerabilities and version
conflicts by bumping the actual direct dependency instead, even if that means
a bigger jump or waiting on an upstream fix. This bit us concretely: a Snyk
scan flagged `nanoid@3.3.16` (pulled in transitively via `vite`'s `postcss`
dependency), and forcing an override to the fixed `nanoid@5.1.16` would have
broken every CSS build in the app — `postcss` does a plain CJS
`require('nanoid/non-secure')`, and `nanoid@5.1.16` ships **no CJS entry at
all** (ESM-only, no `require` export condition), so it would fail with
`ERR_REQUIRE_ESM` the instant PostCSS parsed any stylesheet. An override
would have installed silently and only surfaced the breakage at
build/runtime, well past the point where the version choice was made. If a
transitive vulnerability has no fix reachable by bumping the direct
dependency, it stays open — tracked as a GitHub issue rather than forced.

That nanoid case has since resolved itself, which is the point of waiting:
upstream backported the fix to `3.3.17`, inside the `^3.3.16` range `postcss`
already declares, so a plain `npm update nanoid` cleared it with no override
and no build change. Updating within a range a parent already allows is not
an override — that is always fair game, and worth re-checking periodically
on any advisory parked in an open issue.

## Architecture

### Main-process layout

`src/main/index.ts` is 72 lines and contains only three things: the pre-ready
Chromium switches, the `app.whenReady()` sequence, and the two lifecycle handlers.
Everything else lives in a focused module:

- `app/` — `paths.ts` (resource roots), `services.ts` (the process-wide singletons),
  `settingsState.ts` (see below).
- `ipc/` — one module per channel namespace, each exporting a `register*Ipc()`, all
  called from `ipc/index.ts`. `ipcMain` keys handlers by channel name, so
  registration order is irrelevant and a duplicate channel throws loudly at startup.
- `windows/windowRegistry.ts` — which windows are open, and the verbs to open them.
- `modules/` — `botDescriptors.ts` (the bot list), `moduleRegistry.ts` (registration
  and HUD summaries), `moduleRefs.ts` (see below).
- `overlay/overlayService.ts`, `audio/playbackBridge.ts`, `updates/updateService.ts`,
  `diagnostics/collectDiagnostics.ts`.

**Keep the `whenReady()` body in `index.ts`, and keep it in order.** It reads:
load settings → load libraries → register IPC → register modules → reconcile bot
order → save → start overlay → create playback window → create HUD → check for
updates. That order is load-bearing — IPC handlers are registered *before* modules
exist and *before* any window exists, which is why handlers must reach both lazily
(`moduleRefs.<x>?.`, `windows.getHud()`) and never capture a value at registration
time. Keeping the sequence visible in one place is what makes that invariant
maintainable.

**`modules/moduleRefs.ts`** is three optional fields and no logic, and it exists to
keep the dependency graph acyclic: `overlayService` needs to call
`coinksModule.finishGame()`, while module registration needs `overlayService`'s
broadcast callbacks. Routing that one reference through a module nobody else depends
on breaks a cycle that would otherwise run through the entry point.

**`overlay/overlayService.ts` owns both the `OverlayServer` instance and the
broadcast helpers, and they must not be separated.** The helpers read
`overlayServer.status`/`.clientCount()`/`.broadcast()` while the server's own
constructor callbacks call the helpers — a genuine mutual dependency. Splitting them
puts an import cycle through whichever file constructs the server, and when that file
is the entry point the cycle resolves with empty exports and fails at runtime rather
than at build time.

### Settings live-binding

`src/main/app/settingsState.ts` is the single owner of the live `AppSettings` object,
and the rule it enforces is the most load-bearing invariant in the main process:

> The settings object has **one owner**, **one assignment** (inside `loadSettings()`),
> and is reached **only** through `getSettings()` called at the point of use.

Mutating it in place is correct and intended — that's how the bot modules' lazy
config closures see changes. Replacing it, copying it, or caching a reference to it
is not. Spreading a *sub-object* is fine and appears throughout
(`getSettings().modules.atMe = { ...getSettings().modules.atMe, ...patch }`);
spreading the root is not.

`getSettings()` is a function rather than an exported binding on purpose: a function
survives destructuring, whereas a destructured value would snapshot `undefined`
forever — and with no linter here, nothing else would catch that. `saveSettings()`
takes no argument for the same class of reason: every call site saves the live
object, so a parameter would only create the opportunity to persist a stale copy.

It deliberately has no null check and no `?? defaultSettings` fallback. A fallback
would mask an ordering bug by quietly handing back defaults instead of failing.

Two greps verify it holds:

```bash
grep -rn "= getSettings()$" src/main          # zero — no stored reference
grep -rn '\.\.\.getSettings()[^.]' src/main  # zero — no root-object copy
```

The `[^.]` in the second is load-bearing: without it the pattern also matches the
legitimate sub-object spreads and reports false positives.

### Diagnostics and problem reports

The Settings window's Help & Feedback tab builds a GitHub-ready report from
`src/main/diagnostics/collectDiagnostics.ts`, reached via `diagnostics:get`.

**It adds no network request, and must not.** The report is generated locally,
shown in an editable textarea, and copied to the clipboard for the user to paste.
`docs/PRIVACY.md` documents exactly this; a submit endpoint would falsify it, and
that document has already gone stale once on this repo when a feature was built
after the doc said it did not exist.

Two rules govern what the collector reads, and they are not interchangeable:

- **Secrets are never collected, not collected-then-stripped.** The access token,
  login and user id are never read into the report — auth is two booleans. No
  absolute path goes in either, since sound/media paths and the userData
  directory all contain the OS username. Counts, never contents.
- **Error text is scrubbed of the channel name, and only error text.** Those
  strings come from tmi.js and Twitch, which embed it. An earlier version scrubbed
  the whole report and mangled it for anyone whose login is an ordinary word — a
  user called `celebration` got `<channel>` in place of the module id, its
  display name and its config key. Everything outside error text is built field
  by field and provably never reads the login.

The access token additionally gets a global backstop pass, which is safe only
because a token is high-entropy and cannot collide with real content.
`scripts/smoke.mjs` seeds a fake token and asserts it never appears in the
serialized report — that assertion is what catches a future field that reads
`getSettings()` too broadly.

### Process/window layout

Standard Electron main/preload/renderer split via `electron-vite`. Every new
window needs four things wired together, or it silently won't build/load:
1. A `create*Window()` function in `src/main/windowManager.ts`.
2. A dedicated preload script in `src/preload/` exposing one namespaced API object
   via `contextBridge` (e.g. `window.library`, `window.hud`) — never expose raw
   `ipcRenderer`.
3. Entries for both the preload and the renderer HTML in `electron.vite.config.ts`'s
   `rollupOptions.input` (two separate lists — easy to add one and forget the other).
4. A `WindowKey` and factory entry in `src/main/windows/windowRegistry.ts`, which
   owns which windows are currently open. `windowManager.ts` still owns how each is
   *built*; the registry owns its lifecycle.

Two things about the registry are load-bearing and look like cleanup opportunities:

- **`open` and `toggle` are not duplicates.** They differ only in what they do to an
  already-open window: `open` focuses it, `toggle` closes it. Manager windows are
  toggled from the tile that opened them (right-click twice to close); the update
  badge uses `open`, where closing on a second click would be surprising. The smoke
  harness asserts this, so merging them fails the gate.
- **Registry entries are deleted by the window's own `'closed'` event, never eagerly
  on `close()`.** `close()` is asynchronous, so deleting up front lets a fast
  re-toggle open a *second* window while the first is still closing.

The HUD and playback windows deliberately sit outside that keyspace — they're created
once at startup, never closed, and their factories take no `onClose`.

Windows, all opened through the registry:
- **HUD** — the only window visible during normal use. Frameless, transparent,
  always-on-top, draggable via `-webkit-app-region: drag`. Renders one tile per
  registered bot module; left-click toggles enabled/disabled, right-click opens that
  module's manager window if it has one (driven by `hasManagerWindow` on each
  entry in the `hud:get-modules` payload, derived from `botDescriptors` — the
  renderer keeps no list of its own).
- **Settings** — Integrations (Twitch login/logout) and Available Bots (per-bot
  show/hide + drag-to-reorder, persisted and reflected in HUD tile order).
- **Library** — shared by Command and Emote (`?kind=command|emote` query param
  distinguishes them at runtime); add/edit/remove sound triggers and text replies.
- **TTS settings**, opened the same right-click way as Library.
- **Playback** — never shown. Exists purely because `<audio>` and `speechSynthesis`
  require a real DOM/renderer context; main process sends it what to play over IPC.
- **Auth** — transient, shows Twitch's real login page for the OAuth flow; no preload,
  the main process intercepts the redirect via `webContents` navigation events instead
  of renderer JS.

All non-HUD windows are frameless with a hand-drawn titlebar (`assets/titlebar.css`)
and a ✕ button wired to a shared `window:close` IPC channel
(`BrowserWindow.fromWebContents(event.sender)?.close()`), since there's no OS chrome.
`windowManager.ts`'s `positionAboveHud()` opens them centered above the HUD rather than
wherever the OS defaults to.

### Bot module system

Every bot implements `IBotModule` (`src/main/modules/types.ts`): `id`, `displayName`,
`status` (`stopped | connecting | running | error`), `enabled`, `start()`/`stop()`.
`ModuleManager` is just a registry + `setEnabled()` that calls start/stop. Modules
read their config via injected closures (`() => getSettings().twitch.login`, etc.)
rather than owning settings directly, so `src/main/modules/botDescriptors.ts` stays
the single place that knows how settings map to module behavior. No bot module
imports `settingsStore` or `electron`.

`botDescriptors` is one array with an entry per bot — `{ id, settingsKey,
managerWindow?, construct }` — and it drives construction, registration order, the
startup enable pass, settings write-back, and HUD right-click routing. `settingsKey`
is typed `keyof AppSettings['modules']`, so a kebab-case id paired with the wrong
camelCase key is a compile error. Two properties of that array are behavior, not
style:

- **Its order is the fresh-install HUD tile order.** `reconcileBotOrder()` appends
  ids unknown to a saved `bots.order` in `ModuleManager`'s registration order, and
  `ModuleManager` is backed by an insertion-ordered `Map`.
- **The startup enable pass is a sequential `for…of` with `await`, never
  `Promise.all`.** Each `start()` may `acquire()` the ref-counted shared chat
  connection, and starting them concurrently changes how it's established.

**Status reaches the HUD by polling, not events.** `ModuleManager.watchStatus()`
compares each module's `status` once a second and fires only when one actually
changed; `setEnabled()` also reports immediately so a clicked tile doesn't wait for
the next tick. Polling is deliberate: `status` is a plain getter backed by a private
field that ten modules assign independently, so an emit-per-module scheme would be
ten edits with a silent staleness bug waiting on the one that forgot. Polling
catches every transition however it was made, including ones long after `start()`
resolves — a dropped connection, an EventSub reconnect.

`broadcastModules()` is still called explicitly from the three user-initiated
operations (tile toggle, bot reorder, bot show/hide), since those change `enabled`
and visibility rather than status.

**A failed module records why.** `IBotModule.lastError` holds the reason, set
wherever `status` becomes `'error'` and cleared when a new start begins and on
stop, so a stale reason never outlives its failure. It reaches the HUD tile's
tooltip and the problem report. Before this existed every module swallowed the
error with a bare `catch {}` — the reason was destroyed at the moment it was
known, which is what made a red tile unexplainable. `TwitchChatClient`,
`HypeTrainEventSub` and `OverlayServer` each expose a `lastError` of the same
shape.

**A chat module with no Twitch login reports `error`, not `running`.**
`TwitchChatClient.acquire()` refuses an empty channel name. Without that guard
tmi.js opens an anonymous read-only connection to no channel, reports success, and
every module sets `running` — so the HUD shows bots as connected and working while
no message can ever arrive. Throwing routes into the `catch` each module already has
around `acquire()`, so the tile turns red without touching all nine.

All chat-driven modules share one `TwitchChatClient` (`src/main/modules/
twitchChatClient.ts`) instead of opening their own IRC connection — `acquire()`/
`release()` are ref-counted, so the connection stays open as long as at least one
module needs it and tears down when the last one stops.

**Not everything Twitch exposes comes over IRC.** Hype Train state is only
available via EventSub, so `HypeTrainModule` runs its own EventSub WebSocket
client (`src/main/twitch/hypeTrainEventSub.ts`) rather than reusing the shared
chat connection — the first bot here to need a second transport. Check which
API a new bot's data actually lives behind before assuming the chat client can
carry it; subscriptions, channel points, and polls are all EventSub-only too.
EventSub also shapes what a bot can render: Twitch never hands over a full
contributor roster for a Hype Train, only the latest contributor per event,
which is why the overlay spawns archers one at a time as events arrive instead
of drawing a known set.

Two bots carry caveats worth knowing before you build on them:

- **AtMe** keeps its queue in memory only — it resets on restart, deliberately,
  since a queue of stale @-mentions from a previous stream is noise. Its
  "Highlight My Message" detection (`tags['msg-id'] === 'highlighted-message'`,
  verified against `tmi.js` source) has **never been exercised against a real
  redemption**; treat it as unproven if it misbehaves.
- **Celebration** matches a cheer's bits with an **exact** comparison, not a
  threshold. That preserves the old app's behavior and is what lets Celebration
  and Coinks hold distinct prices without one large cheer triggering both — so
  don't "fix" it into a `>=` without accounting for that interaction.

### Sound triggers (Command + Emote)

Command and Emote are the same mechanism with a different match strategy (`!command`
prefix vs. a bare word appearing in chat), so they share one data model and library:
`src/main/library/soundLibrary.ts` (persistence + CRUD), `ffmpeg.ts` (loudness
normalization via `ffmpeg-static` on add), `playbackQueue.ts` (single-flight lock +
20s per-trigger cooldown, shared across both so sounds never overlap). New sounds are
copied into `userData/sounds/`; the manager UI is one shared renderer
(`src/renderer/library/`) parameterized by the `kind` query param rather than two
near-identical windows. User Intros (a third `SoundTriggerKind`) reuses this same
data model too — its rows are just usernames instead of `!command`/emote text.

**Deciding whether a new bot should reuse this vs. get its own store:** the
determining question is whether its per-entry data is genuinely "trigger text → a
sound file" (reuse `SoundLibrary` — add a `SoundTriggerKind` value, get CRUD/
normalization/persistence for free) or needs a field this schema has no column for
(build a parallel store instead, following `soundLibrary.ts`'s shape, rather than
distorting the shared schema to fit). Reusing also forces a UI decision: a new tab in
an existing Library-backed window (cheap, but only reads as coherent if the new kind
is conceptually related to what's already in that window — this is why User Intros
became a tab on the Command window rather than Emote's) vs. its own top-level window
(more wiring, but no forced association). See `ADDBOT.md` for the concrete file
checklist either path requires.

### Overlay server (OBS browser sources)

`src/main/overlay/overlayServer.ts` runs a small `node:http` server bound to
**127.0.0.1 only**, and it is the app's one non-Electron delivery surface: the page it
serves at `/overlay/` is loaded by OBS as a **Browser Source**, not by a BrowserWindow.
Events are pushed to it over SSE (`/events`), and media files are served by id from
`/media/:id`. `/game/*` serves the coin game's sprites and sounds from
`resources/coinks/`.

This replaces the old .NET app's approach of window-capturing a transparent 1080p Unity
process fed raw JSON over per-message TCP connections. Browser sources are why the
positioning problem went away: OBS owns placement/scale of the whole layer, while
per-item anchors place things within it, so nothing has to assume a fixed 1920×1080
canvas. It also avoids Wayland's PipeWire window-capture entirely.

There is **one page per overlay feature** — `/overlay/` (media),
`/overlay-fireworks/`, `/overlay-coinks/` — each its own OBS Browser Source. That's the point: OBS controls
placement and scale per feature, so a full-screen fireworks show and an anchored gif
don't have to share a canvas. Both subscribe to the same `/events` stream with
`?feature=<name>`, which also scopes `clientCount(feature)` so each manager window
reports only its own source as connected. `serveStatic()` maps any `/<page>/` to that
renderer's `index.html`, so adding an overlay needs a vite entry and nothing else.

The stream is one-directional except for **`POST /coinks/result`**, the coin game's
way of reporting a finished game. It is deliberately a plain stateless POST rather than
a second live channel: a result is safe to retry and can't desync, unlike the stateful
bidirectional link the old WPF/Unity pair used. That POST is also what tells the main
process a turn is over, so it can start the next queued player. `/sprites/*` serves the
coin game's art from `resources/coinks/`.

Two things to keep in mind when extending it:

- `src/main/overlay/types.ts` defines the `OverlayEvent` union and is imported by
  **both** the main process and `src/renderer/overlay/`. That shared type is the point —
  the old app hand-maintained a DTO on each side of the wire and they silently drifted.
  Keep new event kinds namespaced (`media:play`) so future overlay bots
  (Celebration/Coniks) extend the union rather than inventing another transport.
- In `npm run dev` the overlay page lives on the Vite dev server, so the server proxies
  `/overlay/*` and `/assets/*` (plus the HMR websocket upgrade) to `ELECTRON_RENDERER_URL`;
  in production it serves from `out/renderer/`. This mirrors `loadRenderer()` in
  `windowManager.ts` and keeps the overlay single-origin, which is what lets it fetch
  `/media/:id` without CORS or `file://` problems.

**None of the original Unity visual assets can be reused.** They are Hovl Studio
Asset Store content, which cannot be redistributed in a public repo — that is why
Celebration's fireworks are procedural canvas particles and their audio is
synthesised, rather than either being ported over. Coinks and Hype Train are
unaffected: their art is bespoke (`resources/coinks/`, `resources/hype/`) and ships
in the repo. Assume any new overlay drawing on the old app's look has to be
recreated, not copied.

Overlay stylesheets deliberately do **not** import `theme.css` — the pages must stay
fully transparent for OBS to composite them.

That transparency constrains canvas animation in a non-obvious way. The standard way to
draw particle trails is to paint the whole canvas each frame with a low-alpha black
`fillRect`, letting older frames darken away. Over live video that just lays a grey haze
on the stream. `src/renderer/overlay-fireworks/main.ts` instead fades by *subtracting*
alpha — `globalCompositeOperation = 'destination-out'` with a low-alpha fill — then
switches to `'lighter'` for additive glow. Any future overlay wanting trails needs the
same treatment.

Overlay pages must also **stop their animation loop when idle**. A browser source is
open for the entire stream, so a `requestAnimationFrame` loop that keeps running between
events burns a core for hours. The fireworks page stops once the last particle dies and
restarts on the next event; both it and the coin game expose a `window.__fireworks` /
`window.__coinks` hook purely so automated tests can assert that.

One more trap these pages share: **map vertical layout to the canvas, not to the
horizontal scale.** Both the fireworks burst height and the coin game's belt were first
written as fixed world-space y values derived from the width scale, which assumes a
roughly 16:9 source. OBS lets a browser source be any shape, and on a wider one the
fireworks burst above the top edge and the coin belt slid off the bottom. Anchor
vertical positions to a fraction of `canvas.height`.

### Coinks: the coin is not a physics toss

Recovered from the original Unity project, which is the only place this was ever
written down — worth keeping because the behavior looks like a physics bug if you
don't know it's deliberate. The coin prefab has `m_GravityScale: 0`: the coin does
**not** arc onto the belt. It travels straight up at constant speed from just below
the belt, lands, and is then dragged off the right edge (the original's
`ConveyorBeltController` moved any rigidbody resting on it). Coinks is a timing
game, not an aiming game.

Two deliberate departures from the original, both anti-stopwatch measures: the lead
time between `!coin` and the coin appearing is randomised 0–1s rather than the
original's fixed 1.2s, and the coin decelerates under friction so it settles at a
varying height instead of stopping dead at a fixed one.

Tile width is derived as `beltSpeed × spawnInterval` and tile height from the art's
190×200 aspect, so the strip stays flush and undistorted at every speed tier and the
belt texture scrolls with it. The original's blank tiles were dropped: its tiles were
narrower than their spacing so bare belt showed between all of them anyway, but on a
flush strip a blank reads as a hole.

### Overlay audio

Overlay sound comes out of the **browser source**, not the Playback window the other
bots use — so OBS can treat it as its own mixer channel (the streamer must tick "Control
audio via OBS" on the source, otherwise it lands on desktop audio). Volume rides along
on the triggering event (`coinks:start`, `celebration:fireworks`) rather than needing a
config endpoint.

`src/renderer/assets/overlayAudio.ts` is shared by both overlays and uses Web Audio
rather than `<audio>` elements: several coins can land at once and fifteen shells burst
together, which needs many simultaneous voices of the same sound. It also synthesises —
the fireworks have no samples at all, because the originals were part of the licensed
Hovl pack, so launches are a rising bandpassed noise sweep and bursts are a lowpass boom
plus highpass crackle.

An `AudioContext` starts suspended until a user gesture in an ordinary browser tab; OBS
permits autoplay, so the helper resumes opportunistically and warns to the console when
it can't rather than failing silently.

Note also that the **hidden playback window cannot be used to test these pages** —
Chromium does not run `requestAnimationFrame` for a window that never composites, so an
animated overlay appears frozen there while working fine in OBS. Test overlays in a real
browser.

### Playback: data: URLs, not file://

`src/main/audio/playbackBridge.ts`'s `sendPlaySound()` reads the audio file and sends it to the
Playback window as a base64 `data:` URL, not a `file://` path. This is deliberate,
not incidental: in `npm run dev`, every renderer page is served from
`http://localhost:5173` (Vite's dev server), and Chromium blocks a `file://` resource
load from an `http://` page ("Media load rejected by URL safety check"). A `data:`
URL is embedded content rather than a filesystem reference, so it works identically
in dev and in a packaged build. Don't revert this to `pathToFileURL()` — it'll work
fine in a production build (matching origins there) and then fail silently in dev.

### Settings

`src/main/settings/settingsStore.ts` persists one JSON file in Electron's userData
dir (never in the repo). It is instantiated by `app/settingsState.ts` and reached
only through it — see **Settings live-binding** above for the rules that govern the
in-memory object. This section is about what's on disk.

`SettingsStore.load()` merges saved data over
`defaultSettings` field-by-field, so old/partial settings files upgrade gracefully
instead of crashing — extend that merge whenever the schema grows. `twitch` holds
OAuth state (`accessToken`/`login`/`userId`/`expiresAt`); `bots.order`/`bots.hidden`
drive HUD tile ordering/visibility and get reconciled against currently-registered
module ids on startup (`reconcileBotOrder()`) so a newly-added bot doesn't need a
migration.

### Shared renderer assets

`src/renderer/assets/`: `theme.css` (primary/secondary/accent color scale + semantic
tokens — style against the semantic tokens, not the raw scale), `titlebar.css`,
`fonts/space-mono.css` (self-hosted, not a Google Fonts CDN link — this is a desktop
app, it shouldn't need network access to render text), and `modal.ts`/`modal.css`
(themed in-page prompt/alert — `window.prompt()` throws `"prompt() is not supported"`
on at least some Linux/Electron builds, confirmed via direct testing; don't use native
`prompt()`/`alert()`/`confirm()` in this app).

`theme.css` also carries a blanket `[hidden] { display: none !important }` rule.
Without it, `el.hidden = true` silently does nothing on any element whose class also
sets `display` (e.g. `display: flex`) — a class rule and the browser's built-in
`[hidden]` rule have equal CSS specificity, and author styles win ties over the
user-agent stylesheet. This bit a real bug (a window's tabs stayed visually visible
despite `tabs.hidden === true` reading correctly), and it's easy to re-trigger: adding
a new class with an explicit `display` to an element that also gets toggled via
`.hidden` will silently stop hiding it unless this rule is in scope. Verify hidden
state by checking rendered layout (`getComputedStyle(el).display` or a bounding rect),
not just the `.hidden` property — the property can read `true` while the element is
still fully visible.
