# Roadmap

Working status list, not auto-loaded context — see `CLAUDE.md` for stable
architecture. Expected to go stale; update as things move, or migrate to GitHub
Issues once this lives in its own repo.

## Done

- HUD, Settings (Twitch OAuth login/logout, Available Bots show/reorder), Library
  manager windows, TTS settings window
- Bot modules: Text-to-Speech, Live Studio Audience, Command, Emote, AtMe, Media (gif),
  Celebration (fireworks), Coinks
- Command/Emote legacy-data import from the old .NET app's `commands.json` /
  `commands_text.json` / `emotes.json`
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

## Not started

- **Coinks follow-ups** — high-score boards (the old `!coinkshighscore_daily` /
  `_alltime` display modes) are the only piece not carried over.
- **Calculator, JumpScare** — the two remaining simplest bots from the original
  phase-2 plan; none built yet
- **AtMe: global hotkey to dismiss the top queued message** — deferred out of
  AtMe's first version (see `src/main/modules/atMeModule.ts`); would use
  Electron's `globalShortcut` API, needs a safe default key combo chosen
  carefully to avoid clashing with OBS/games
- **TTS voices (Linux)** — `speechSynthesis.getVoices()` returns empty and speaking
  throws `synthesis-failed`, even with `speech-dispatcher` + `espeak-ng` installed
  and confirmed working at the OS level (`spd-say -L` lists hundreds of voices,
  `spd-say "..."` succeeds). Verbose Chromium TTS/speech logging showed zero
  attempted connection when triggering speech, suggesting Electron's bundled
  open-source Chromium may not wire Linux `speechSynthesis` to speech-dispatcher at
  all (a known gap vs. Google Chrome). Deprioritized rather than chase further.
  Likely fix if revisited: bypass the Web Speech API on Linux and shell out to
  `spd-say` directly via `child_process` in the main process (proven to work);
  keep `window.speechSynthesis` on Windows, where it's well-supported via SAPI.
  This means a platform-specific code path, not a config fix.
- **Windows** — this app has only ever run on Linux so far. Original goal is
  Windows + Linux; Windows hasn't been tested once
- **Packaging/distribution** — no installer/binary build pipeline (electron-builder
  or similar) yet
- **ClipManager** — dropped from scope early on (Twitch's clip API changed since the
  old implementation); would need a real redesign if revisited

## Before the initial commit to a new repo

- Add a LICENSE
- Write a real README (current repo-root one is just "# MultiBot")
- Final pass over `app/` for leftover test/debug artifacts
