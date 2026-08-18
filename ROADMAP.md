# Roadmap

Working status list, not auto-loaded context — see `CLAUDE.md` for stable
architecture. Expected to go stale; update it as part of cutting a release
(see `RELEASING.md`). Tracks the shape of the work; individual bugs and small
requests live in GitHub Issues.

## Done

- HUD, Settings (Twitch OAuth login/logout, Available Bots show/reorder), Library
  manager windows, TTS settings window
- Bot modules: Text-to-Speech, Live Studio Audience, Command, Emote, AtMe, Media (gif),
  Celebration (fireworks), Coinks, Hype Train
- Command/Emote legacy-data import from the old .NET app's `commands.json` /
  `commands_text.json` / `emotes.json`. The two files disagree on shape —
  commands are flat, emotes nest the sound under a `Sound` object — and the
  importer originally only knew the flat one, so emotes silently imported
  nothing until that was fixed. `emotes.json` also holds every channel emote
  the old app fetched from Twitch, not just the configured ones, so most
  entries legitimately have no sound and are counted rather than reported.
- Cross-platform audio playback (data: URL fix — see CLAUDE.md)
- AtMe: queues chat messages that @-mention the streamer or use Twitch's
  "Highlight My Message" redemption, into a dismissible list in its own Queue
  window (`src/main/modules/atMeModule.ts`) — in-memory only, resets on restart.
  Real Highlight My Message detection (`tags['msg-id'] === 'highlighted-message'`,
  verified against `tmi.js` source) still needs confirming against a real
  redemption on a live/test channel — not yet exercised end-to-end.

- Overlay server + first overlay bot (Media/gif): local HTTP + SSE, consumed by OBS as
  a Browser Source. Replaces the old Unity `MultiBotWidgets.exe` transport entirely —
  see CLAUDE.md. Accepts gif/png/apng/webp/jpg plus mp4/webm (the old app was gif-only),
  with per-item 9-point anchor, duration, and volume, and imports the old
  `gifMediaCommands.json`. No loop setting: GIFs self-loop and video is always
  looped, so duration alone decides time on screen.
- Celebration (fireworks): second overlay page at `/overlay-fireworks/`, its own OBS
  Browser Source. Bits matching is an **exact** comparison, preserving old behavior so
  Celebration and a future Coniks can hold distinct prices without one large cheer
  triggering both; `!fireworks` is independently toggleable (the old app only allowed
  the command when the price was 0). The visuals are procedural canvas particles
  **because the Unity originals can't be reused** — they're Hovl Studio Asset Store
  content, which can't be redistributed in a public repo. Variants (US/Canada flag,
  birthday cake) deferred; the St Patrick's clover was already dead code upstream.
- Coinks: third overlay page at `/overlay-coinks/`, plus the overlay server's first
  inbound route (`POST /coinks/result`). Main owns the turn queue and persistence, the
  overlay owns the simulation. Full tile set (25/50/100/−25, ×2, +2 coins, Coin Fever,
  speed tiers, mystery), 5-coin turns, 20s auto-throw, `!coin` restricted to the player
  whose turn it is, and a refusal (with a chat reply) when no overlay is connected.
  Scores go to `userData/coinks-scores.json` only — the old build also POSTed every
  result to `streambotty.com`, which is deliberately not carried over. Art is the
  original bespoke sprites and sounds, served from `resources/coinks/`. Audio plays from
  the browser source so OBS can mix it separately; fireworks audio is synthesised with
  Web Audio, since the original's sounds were part of the licensed Hovl pack.

  Key finding from the recovered source: the coin prefab has `m_GravityScale: 0`, so
  the coin does **not** arc onto the belt — it travels straight up at constant speed
  from just below it, lands, and is then dragged off the right edge by the belt
  (`ConveyorBeltController` moved any rigidbody resting on it). Coniks is a timing
  game, not a physics toss. The lead time between `!coin` and the coin appearing is
  randomised 0–1s rather than the original's fixed 1.2s, so it can't be reduced to a
  stopwatch, and the coin decelerates under friction so it settles onto the belt at a
  varying height rather than stopping dead at a fixed one. Tile width is derived as
  `beltSpeed × spawnInterval` and tile height from the art's 190×200 aspect, so the
  strip is flush and undistorted at every speed tier; the belt texture scrolls with it.
  Blank tiles were dropped — the original's tiles were narrower than their spacing so
  bare belt showed between all of them anyway, but on a flush strip a blank reads as a
  hole.
- Hype Train: fourth overlay page at `/overlay-hypetrain/`. Twitch only exposes Hype
  Train state via EventSub (not IRC, unlike every other bot here), so this is the
  first bot with its own EventSub WebSocket client (`src/main/twitch/
  hypeTrainEventSub.ts`) rather than reusing the shared chat connection — see
  CLAUDE.md. Archers spawn one at a time as `hypetrain:archer-join` events arrive
  (Twitch never hands over a full roster, only the latest contributor per event);
  troll HP tracks progress toward the current level's goal. A level-up defeats the
  troll and stands up a fresh, correctly-leveled one; the Hype Train ending has the
  troll fire a parting shot rather than a win/lose-specific animation. Sprites are
  hand-drawn (`resources/hype/`) rather than procedural, unlike Celebration/Coinks.
  Manager window has a Test Hype Train button that drives the same code path a real
  train does, for OBS setup without waiting on an actual one.
- Packaging/distribution: `electron-builder` builds Windows (NSIS), Linux (AppImage +
  deb), and macOS/Apple Silicon (dmg) installers, all reading the app icon from
  `resources/icon.png`/`.ico`. `.github/workflows/release.yml` builds all three on a
  `windows-latest`/`ubuntu-latest`/`macos-latest` matrix and publishes a draft GitHub
  Release whenever a `v*` tag is pushed; `.github/workflows/ci.yml` runs `typecheck` on
  every push/PR to `main`. Binaries are **unsigned** on both Windows and macOS — see
  the "Not started" code-signing entry below.
- Windows/macOS/Arch Linux runtime testing: the app has now actually been run
  end-to-end on real hardware for all three, not just built by CI — closes out what
  was previously the last big open item before a 1.0 release.
- TTS voices on Linux: Chromium ships its speech-dispatcher integration **disabled
  by default**, which is why `speechSynthesis` reported zero voices — not, as
  previously assumed here, a missing integration in Electron's open-source build.
  `app.commandLine.appendSwitch('enable-speech-dispatcher')` before app-ready turns
  it on; measured 0 voices without it and 14,805 with, on an Arch install with
  `speech-dispatcher` + `espeak-ng`. No platform-specific speech path and no
  shelling out to `spd-say` was needed. It only exposes voices the machine already
  has, so those packages are a documented Linux requirement (see README).
- TTS improvements: a free `!tts` command with its own toggle (bits still gate plain
  chat messages), reserved against the Command bot the same way `!intro` is, with
  conflict warnings in both the TTS and Library windows; a Test button that
  auditions the selected voice; and a filter over the voice list, which Linux's
  ~15,000 espeak-ng variants made unusable as a plain dropdown. Also fixed a bug
  carried over from the .NET port: the first word was stripped from every message
  on the assumption a cheermote always leads it, so non-cheer messages lost a real
  word — cheermotes are now removed by shape, wherever they appear.

## Not started

- **Coinks follow-ups** — high-score boards (the old `!coinkshighscore_daily` /
  `_alltime` display modes) are the only piece not carried over.
- **Calculator, JumpScare** — the two remaining simplest bots from the original
  phase-2 plan; none built yet
- **AtMe: global hotkey to dismiss the top queued message** — deferred out of
  AtMe's first version (see `src/main/modules/atMeModule.ts`); would use
  Electron's `globalShortcut` API, needs a safe default key combo chosen
  carefully to avoid clashing with OBS/games
- **Code signing (Windows + macOS)** — both platforms' installers are unsigned, so
  Windows SmartScreen and macOS Gatekeeper both warn on first launch ("Unknown
  publisher" / "can't be opened"); workaround for now is manual bypass (SmartScreen's
  "More info → Run anyway", macOS's right-click → Open or `xattr -cr`). Real fix:
  apply to **SignPath Foundation** (signpath.io) — free OV-level code signing for
  qualifying open source projects (public repo + OSI-approved license, which this
  project already satisfies), key held in their HSM, wired into CI signing steps.
  Review takes days to weeks. Azure Trusted Signing (~$9.99/mo) is a paid fallback if
  that doesn't pan out. Doesn't cover macOS notarization, which is a separate,
  Apple-specific step still needed even once Windows is signed via SignPath.
- **ClipManager** — dropped from scope early on (Twitch's clip API changed since the
  old implementation); would need a real redesign if revisited
- **Open devDependency vulnerabilities (3, per Snyk SCA)** — all dev-tooling only
  (`electron-vite`/`vite`/`electron-builder`'s own transitive deps), never shipped in
  the packaged app; all currently blocked from a clean fix, per CLAUDE.md's "no npm
  overrides" norm:
  - `esbuild@0.25.12` (critical, SNYK-JS-ESBUILD-17750822) — bundled by
    `electron-vite@5.0.0` itself, capped by its own `^0.25.11` dependency range even
    on the latest `6.0.0-beta.1`; the fix (`0.28.1`) isn't reachable by bumping
    `electron-vite`, only by an override we've ruled out. Re-check next time
    `electron-vite` cuts a release.
  - `unzipper@0.12.5` (medium, SNYK-JS-UNZIPPER-18365659) and `inflight@1.0.6`
    (medium, SNYK-JS-INFLIGHT-6095116) — both via `electron-builder`'s own
    dependency tree; no fixed version published upstream for either yet.
  Re-run `snyk_sca_scan` (with `dev: true` — these are all devDependencies, invisible
  otherwise) periodically to check if any of these gained a real fix upstream. This
  pays off: two `nanoid` advisories sat on this list for a long time because the
  only fix was the ESM-only `5.x`, which would have broken `postcss`'s CJS
  `require()` — then upstream backported it to `3.3.17`, inside the `^3.3.16`
  range `postcss` already declares, and `npm update nanoid` cleared both with no
  override and no build change.
