# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-platform (Windows + Linux) desktop Twitch bot toolkit — a small always-visible
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

There is no test suite or linter configured yet.

## Architecture

### Process/window layout

Standard Electron main/preload/renderer split via `electron-vite`. Every new
window needs three things wired together, or it silently won't build/load:
1. A `create*Window()` function in `src/main/windowManager.ts`.
2. A dedicated preload script in `src/preload/` exposing one namespaced API object
   via `contextBridge` (e.g. `window.library`, `window.hud`) — never expose raw
   `ipcRenderer`.
3. Entries for both the preload and the renderer HTML in `electron.vite.config.ts`'s
   `rollupOptions.input` (two separate lists — easy to add one and forget the other).

Windows, all created from `src/main/index.ts`:
- **HUD** — the only window visible during normal use. Frameless, transparent,
  always-on-top, draggable via `-webkit-app-region: drag`. Renders one tile per
  registered bot module; left-click toggles enabled/disabled, right-click opens that
  module's manager window if it has one (`MODULES_WITH_MANAGER_WINDOW` in
  `renderer/hud/main.ts`).
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
read their config via injected closures (`() => currentSettings.twitch.login`, etc.)
rather than owning settings directly, so `main/index.ts` stays the single place that
knows how settings map to module behavior.

All chat-driven modules share one `TwitchChatClient` (`src/main/modules/
twitchChatClient.ts`) instead of opening their own IRC connection — `acquire()`/
`release()` are ref-counted, so the connection stays open as long as at least one
module needs it and tears down when the last one stops.

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

`src/main/index.ts`'s `sendPlaySound()` reads the audio file and sends it to the
Playback window as a base64 `data:` URL, not a `file://` path. This is deliberate,
not incidental: in `npm run dev`, every renderer page is served from
`http://localhost:5173` (Vite's dev server), and Chromium blocks a `file://` resource
load from an `http://` page ("Media load rejected by URL safety check"). A `data:`
URL is embedded content rather than a filesystem reference, so it works identically
in dev and in a packaged build. Don't revert this to `pathToFileURL()` — it'll work
fine in a production build (matching origins there) and then fail silently in dev.

### Settings

`src/main/settings/settingsStore.ts` persists one JSON file in Electron's userData
dir (never in the repo). `SettingsStore.load()` merges saved data over
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
