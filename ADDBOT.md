# Adding a new bot module

A followable checklist of exactly which files to add or edit when wiring a
new bot into the HUD. Purely procedural — for the architectural reasoning
behind any of these pieces, see `CLAUDE.md`.

Throughout, `<bot>` stands in for your bot's id in camelCase (e.g. `atMe`,
`jumpScare`) and `<Bot>` for its PascalCase form (`AtMe`, `JumpScare`).

There are three tiers of complexity, each additive — Tier 2 assumes Tier 1
is done, Tier 3 assumes Tier 2. Which tier you need depends on whether the
bot has configuration a streamer should be able to change, and whether it
needs a user-editable list of entries.

## Tier 1 — toggle-only bot, no settings window

A HUD tile that turns the bot on/off, with fixed behavior and nothing to
configure. This is the floor for every bot, regardless of tier.

**1 new file:**

- `src/main/modules/<bot>Module.ts` — implements `IBotModule`
  (`src/main/modules/types.ts`): `id`, `displayName`, `description`,
  `enabled`, `status`, `start()`, `stop()`. `start()`/`stop()` acquire/release
  the shared `TwitchChatClient` and subscribe/unsubscribe its `'message'`
  event; match logic goes in a private `handleMessage()`.

**3 edits:**

- `src/main/settings/settingsStore.ts` — add a `<bot>: { enabled: boolean }`
  entry to `AppSettings['modules']`, a matching entry in
  `defaultSettings.modules`, and a matching line in `load()`'s merge block
  (`<bot>: { ...defaultSettings.modules.<bot>, ...parsed.modules?.<bot> }`).
- `src/main/index.ts` — import the class; in `registerModules()`, construct
  it, call `moduleManager.register(...)`, and call
  `moduleManager.setEnabled(<bot>.id, currentSettings.modules.<bot>.enabled)`;
  in `syncSettingsFromModules()`, add the matching
  `currentSettings.modules.<bot>.enabled = <bot>.enabled` line.
- `defaultSettings.bots.order` in `settingsStore.ts` — optional. Not
  required for correctness: `reconcileBotOrder()` in `main/index.ts` already
  appends any registered module id missing from a saved `bots.order`, so an
  existing user's settings file picks it up automatically. Only add it here
  if you care where the tile lands on a *fresh* install.

**Nothing else needed.** The HUD tile, its click-to-toggle handler, and its
status styling are all generic over whatever `hud:get-modules` returns — no
preload, renderer, or `electron.vite.config.ts` change required.

**Verify:** `npm run typecheck`, `npm run build`, launch, confirm the tile
appears on the HUD, left-click toggles it, and `enabled` persists across a
restart.

## Tier 2 — add a settings/manager window

Needed if the bot has configuration beyond on/off (a threshold, a choice, a
cooldown — anything a streamer would want to change).

**3 new files:**

- `src/preload/<bot>Settings.ts` — `contextBridge.exposeInMainWorld('<bot>Settings', { get, set, close })`:
  an IPC-backed `get()`/`set(patch)` pair, plus the shared `close()` →
  `window:close` send.
- `src/renderer/<bot>-settings/index.html` — titlebar + close button + form
  fields.
- `src/renderer/<bot>-settings/main.ts` — load current settings via
  `window.<bot>Settings.get()`, wire form inputs to call `.set()` on change.

**4 edits:**

- `electron.vite.config.ts` — add `<bot>Settings` to
  `preload.build.rollupOptions.input`, and `'<bot>-settings'` to
  `renderer.build.rollupOptions.input`. Both — a window that opens blank or
  a preload that doesn't attach usually means one of these two was missed.
- `src/main/windowManager.ts` — add `create<Bot>SettingsWindow()`: frameless,
  positioned via `positionAboveHud()`, preload pointed at `<bot>Settings.js`,
  loads the `<bot>-settings` renderer.
- `src/main/index.ts` — a module-level window variable, a
  `toggle<Bot>SettingsWindow()` function, a branch in the `hud:open-library`
  handler routing `id === '<bot>'` to it, and a `<bot>-settings:get`/
  `<bot>-settings:set` IPC handler pair reading/writing
  `currentSettings.modules.<bot>`.
- `src/renderer/hud/main.ts` — add `'<bot>'` to `MODULES_WITH_MANAGER_WINDOW`
  so right-click on its tile opens the window.

**Verify:** `npm run typecheck`, `npm run build`, right-click the tile,
confirm the settings window opens positioned above the HUD, fields load
current values, and changes persist across a restart.

## Tier 3 — user-editable list of entries

Needed if the bot isn't "one behavior, some knobs" but "the streamer adds
their own rows" (a list of triggers, each with its own data).

**Edits/new files depend on where the data lives — see `CLAUDE.md` for how
to decide between the two paths below.**

**If reusing the existing sound-trigger library:**

- `src/main/library/types.ts` — add `'<bot>'` to `SoundTriggerKind`.
- `src/preload/library.ts` — mirror the same union.
- Every `library:*` CRUD IPC handler in `main/index.ts` is already generic
  over `kind` — no new handlers needed for the entries themselves.
- Decide where the UI lives: a new tab inside an existing Library-backed
  window (edit `src/renderer/library/index.html` + `main.ts` to add the tab,
  gated the same way existing kind-specific UI is gated), or a new
  top-level window (extend `LibraryWindowKind` in `windowManager.ts`, the
  `toggleLibraryWindow` routing in `main/index.ts`, and give
  `library/index.html`/`main.ts` a code path for the new `kind` — the Emote
  window's single-panel-no-tabs path is the template for "just a list, no
  extra tabs").

**If the data doesn't fit that shape:**

- `src/main/library/<bot>Store.ts` — its own persistence file under
  userData, its own CRUD methods, following `soundLibrary.ts`'s shape.
- New `<bot>:*` IPC handlers in `main/index.ts` for that CRUD.
- A renderer window built from scratch (same new-file list as Tier 2, plus
  list-rendering/add/edit/delete UI instead of a settings form).

**Either way:** `<bot>Module.ts`'s `handleMessage()` switches from a
hardcoded rule table to iterating the current list (`library.listSounds('<bot>')`
or the bespoke store's list) on every message — matching becomes
data-driven instead of code-driven.

**Verify:** same as Tier 2, plus exercise the CRUD (add/edit/delete a row,
restart, confirm it persisted) and confirm chat matching reads the live
list rather than a snapshot taken at `start()`.

## Quick reference: files touched per tier

| File | Tier 1 | Tier 2 | Tier 3 (reusing library) |
|---|---|---|---|
| `src/main/modules/<bot>Module.ts` | new | | edit (data-driven matching) |
| `src/main/settings/settingsStore.ts` | edit | edit (extra fields) | |
| `src/main/index.ts` | edit | edit | edit (routing) |
| `src/main/library/types.ts` | | | edit |
| `src/preload/library.ts` | | | edit |
| `src/preload/<bot>Settings.ts` | | new | |
| `src/renderer/<bot>-settings/*` | | new | |
| `src/main/windowManager.ts` | | edit | edit (if new top-level window) |
| `electron.vite.config.ts` | | edit (2 spots) | edit (if new renderer) |
| `src/renderer/hud/main.ts` | | edit | |
| `src/renderer/library/index.html` / `main.ts` | | | edit (if reusing Library window) |
