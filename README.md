# MultiBot

[labs.streambotty.com](https://labs.streambotty.com)

A modular Twitch bot toolkit for streamers, built as a small cross-platform desktop
app. A single always-on-top HUD bar lets you turn individual bots on and off during a
stream; each bot is independent, so you only run what you actually use.

## What it does

MultiBot ships nine independent bots. Turn any subset on from the HUD — they don't
depend on each other:

- **Command** — plays a sound and/or sends a chat reply for a matching `!command`.
- **Emote** — plays a sound whenever a configured emote appears in chat.
- **Text-To-Speech** — reads chat messages aloud when a viewer cheers enough bits.
- **Live Studio Audience** — reaction sounds triggered by keywords or chat commands.
- **AtMe** — keeps a running, dismissible list of chat messages that @-mention you or
  use Twitch's "Highlight My Message," so you don't lose track of them during a busy
  chat.
- **Media** — shows a gif, image, or video on your stream overlay for a matching
  `!command`, positioned wherever you like.
- **Celebration** — a fireworks show on the overlay, triggered by a bits cheer or a
  chat command.
- **Coinks** — a coin-drop minigame on the overlay: viewers queue up, take turns
  dropping coins onto a scrolling belt of scoring tiles, and compete for score.
- **Hype Train** — puts on an archers-vs-troll battle on the overlay for the life of a
  Twitch Hype Train: archers named after each contributor fight a troll whose health
  tracks the train's progress, leveling up (and facing a fresh troll) each time the
  train does.

Command, Emote, and Coinks-style features share one underlying library and manager UI
rather than each reinventing sound/data storage — add a sound, assign it a trigger,
done.

### Stream overlays

Media, Celebration, Coinks, and Hype Train render on your stream via **OBS Browser
Sources**, not by capturing an application window. MultiBot runs a small local HTTP
server (`127.0.0.1` only — nothing it serves is ever reachable off your machine) and
each overlay is its own URL you add as a Browser Source. That means OBS — not the bot —
controls where each one sits, how big it is, and how it layers with the rest of your
scene, and it composites with real transparency.

## Guiding principles

- **Local-first.** Everything you configure — sound libraries, settings, coin-game
  scores — lives in a JSON file on your own machine. Nothing is synced to a server
  MultiBot controls, and there's no telemetry.
- **No embedded secrets.** MultiBot authenticates to Twitch using the OAuth **implicit
  grant** flow specifically so the app never needs a client secret at all — there is
  nothing sensitive to leak by shipping or open-sourcing the source code.
- **Independent, toggleable bots.** Every bot is a self-contained module with the same
  small interface (enabled/disabled, start, stop). Turning one on never starts another,
  and they share infrastructure (one Twitch chat connection, one sound library) without
  depending on each other's state.
- **The streamer's tools stay on the streamer's machine.** Overlay rendering, audio,
  and game logic all run locally; the only network traffic MultiBot generates on its
  own is talking to Twitch's API.

## Requirements

- Windows, macOS (Apple Silicon), or Linux
- [Node.js](https://nodejs.org/) 20+
- **Linux only, for the Text-To-Speech bot:** the speech-dispatcher daemon and
  at least one voice. Windows and macOS reach their system voices with no extra
  setup. Without it the app runs fine, but the TTS voice list comes up empty and
  the bot stays silent.

  ```bash
  # Arch
  sudo pacman -S speech-dispatcher espeak-ng
  # Debian/Ubuntu
  sudo apt install speech-dispatcher espeak-ng
  ```

  Check it works outside the app with `spd-say -L`, which should list voices.

## Getting started

```bash
npm install
npm run dev
```

This starts the app in development mode with hot reload.

Other commands:

```bash
npm run build      # production build, output to out/
npm start           # build and preview the production output
npm run typecheck   # type-check main/preload and renderer code
```

## Project structure

```
src/
  main/        # Electron main process: bot modules, settings, the overlay server
  preload/     # contextBridge scripts, one per window — the only place IPC is exposed
  renderer/    # UI: the HUD, each bot's manager window, and the OBS overlay pages
resources/     # bundled sounds, sprites, and audio used by the built-in bots
```

See `CLAUDE.md` for a detailed architectural walkthrough, and `ADDBOT.md` for a
step-by-step guide to adding a new bot.

## License

MIT — see [`LICENSE`](LICENSE). A couple of bundled/third-party items carry their own
licenses; see [`NOTICE.md`](NOTICE.md) for details (notably, the `ffmpeg` binary used
for sound normalization is GPL-3.0, invoked as a separate process rather than linked).
