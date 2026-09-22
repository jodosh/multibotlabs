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

Command, Emote, and User Intros (a tab in the Command window that gives each viewer
their own sound for `!intro`) share one underlying sound library and manager UI
rather than each reinventing sound storage — add a sound, assign it a trigger, done.

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
  and game logic all run locally. The only network traffic MultiBot generates on its
  own is talking to Twitch's API, plus an update check against GitHub's releases
  that you can switch off in Settings — see the [Privacy Policy](./docs/PRIVACY.md).

## Installing

Download the installer for your platform from the
[Releases page](https://github.com/jodosh/multibotlabs/releases): `.exe` for
Windows, `.dmg` for macOS (Apple Silicon), and `.AppImage` or `.deb` for Linux.

The builds are not code-signed yet, so the first launch shows a warning: on
Windows, SmartScreen's "Windows protected your PC" (choose **More info → Run
anyway**); on macOS, Gatekeeper refuses to open it until you allow it under
**System Settings → Privacy & Security**.

### Coming from the old MultiBot

If the old Windows MultiBot app's data is on this machine, the Settings window (⚙ on
the HUD) shows an **Import from old MultiBot** section. It brings over your sound
commands, emotes, text replies, and media, so you don't have to rebuild them by hand.

### Reporting a problem

Open Settings and go to the **Help & Feedback** tab. It builds a problem report you
can review and edit, then copy and paste into a GitHub issue (the tab links there).
Nothing is sent automatically, and the report leaves out your login, token, and file
paths.

## Requirements

- Windows, macOS (Apple Silicon), or Linux
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

## Building from source

Needs [Node.js](https://nodejs.org/) 22.12 or newer — the version CI and releases
build with.

```bash
npm install
npm run dev
```

This starts the app in development mode with hot reload.

Other commands:

```bash
npm run build            # production build, output to out/
npm start                # build and preview the production output
npm run typecheck        # type-check main/preload and renderer code
node scripts/smoke.mjs   # drive the built app end to end (run a build first)
```

## Project structure

```text
src/
  main/        # Electron main process: bot modules, settings, the overlay server
  preload/     # contextBridge scripts, one per window — the only place IPC is exposed
  renderer/    # UI: the HUD, each bot's manager window, and the OBS overlay pages
resources/     # bundled sounds, sprites, and audio used by the built-in bots
```

See [`CLAUDE.md`](CLAUDE.md) for a detailed architectural walkthrough,
[`ADDBOT.md`](ADDBOT.md) for a step-by-step guide to adding a new bot, and
[`RELEASING.md`](RELEASING.md) for how releases are versioned and cut.

## Privacy & Security

- **[Privacy Policy](./docs/PRIVACY.md)** — What data MultiBot collects and how it's handled.
- **[OAuth Flow](./docs/OAUTH_FLOW.md)** — Technical details on why implicit grant auth is secure for desktop apps.

## License

MIT — see [`LICENSE`](LICENSE). A couple of bundled/third-party items carry their own
licenses; see [`NOTICE.md`](NOTICE.md) for details (notably, the `ffmpeg` binary used
for sound normalization is GPL-3.0, invoked as a separate process rather than linked).
