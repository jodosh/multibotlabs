# Privacy Policy

**Last updated:** September 2026

## Overview

MultiBot is a desktop Twitch bot toolkit that runs locally on your computer. We believe privacy is fundamental, and this document explains exactly what data the app collects, stores, and sends.

**TL;DR:** MultiBot stores everything locally on your machine. We never collect telemetry, never send logs to servers, never sell data. The only network requests are to Twitch's official servers for authentication and chat.

## Data the App Collects

### Local Storage (on your computer, encrypted at rest by your OS)

- **Twitch authentication:** OAuth access token, refresh token, login name, user ID, token expiration time
- **Bot configuration:** which bots are enabled, their individual settings (TTS voice, sound file paths, cooldowns, etc.)
- **Sound library:** trigger text and associated audio files you upload
- **Coinks scores:** player names and coin game scores
- **Chat history:** chat messages that trigger bots (stored in memory only, cleared on restart)

All of this lives in Electron's userData directory:
- **Windows:** `%APPDATA%\MultiBot\`
- **macOS:** `~/Library/Application Support/MultiBot/`
- **Linux:** `~/.config/MultiBot/`

### What We Don't Collect

- **Telemetry:** no analytics, no crash reporting, no usage tracking
- **Passwords:** we use OAuth, so we never see or store your Twitch password
- **Personally identifiable information beyond Twitch:** your real name, email, IP address, or device identifiers are never collected
- **Stream data:** we don't record or upload your streams, VODs, or chat
- **Audio files:** sound files you upload stay on your machine; we don't copy them to any server

## Network Requests

The app makes network requests **only to Twitch's official servers** for:

1. **OAuth authentication** — redirects to Twitch's login page when you click "Connect Twitch"
   - You authenticate directly with Twitch (we never see your password)
   - Twitch redirects back with an access token
   - We store the token locally; Twitch never tells us anything about it beyond its validity

2. **Chat connection** — connects to Twitch's IRC chat server to listen for messages
   - We read chat in real-time to trigger bot responses
   - We don't upload, log, or analyze chat messages

3. **Overlay server** — local HTTP server (127.0.0.1 only)
   - Runs only on your machine, serves content to OBS Browser Sources
   - No traffic leaves your network; completely offline-capable

## Third-Party Services

MultiBot does **not** integrate with any third-party analytics, crash reporting, or data collection services. It does not use:
- Google Analytics
- Sentry or similar crash reporters
- Marketing pixels or tracking
- Cloud sync or backup services (unless you manually backup your userData directory)

## Legacy Import

When importing sound data from the old .NET MultiBot app, we read files from your local disk only (`%APPDATA%\MultiBot\commands.json`, etc.). No data is sent anywhere during import.

## Updates

The app may check for updates by connecting to GitHub Releases. This is metadata only (checking if a newer version exists); it does **not** send information about your system, configuration, or usage.

## Your Rights

- **Access:** All your data is in plaintext JSON in your userData directory. You can read/edit/delete it anytime.
- **Deletion:** Delete the userData directory to wipe all app data from your computer.
- **Export:** Your data is already portable (JSON files); copy the userData directory to back it up or move it to another machine.
- **No tracking:** You can block all network access via firewall and the app will still function (except Twitch chat features obviously need network).

## Changes to This Policy

We may update this policy if the app's functionality changes. Changes will be documented in release notes and reflected here with an updated "Last updated" date.

## Questions?

This is an open-source project. If you have privacy concerns, you can:
- Review the source code on [GitHub](https://github.com/jodosh/multibotlabs)
- Open an issue or discussion
- Contact the maintainer directly

---

**Security note:** MultiBot uses Twitch's implicit grant OAuth flow specifically so no client secret is ever needed. Your app can authenticate without storing server-side credentials. See [OAUTH_FLOW.md](./OAUTH_FLOW.md) for technical details.
