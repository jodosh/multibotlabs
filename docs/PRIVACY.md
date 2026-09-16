# Privacy Policy

**Last updated:** September 2026

## Overview

MultiBot is a desktop Twitch bot toolkit that runs locally on your computer. We believe privacy is fundamental, and this document explains exactly what data the app handles and what we (the MultiBot maintainers) can and cannot access.

**Most important:** We have **zero visibility** into your data, your settings, or your usage. The app runs on your machine, not ours. We cannot see, access, or receive any of the information described below.

**TL;DR:** MultiBot stores everything locally on your machine. We have no telemetry, no crash reporting, no analytics, no way to access your data. The only network traffic is the app connecting directly to Twitch's official servers for authentication and chat.

## What We (the Maintainers) Can and Cannot Access

- ✗ We **cannot** see your Twitch auth token or any credentials
- ✗ We **cannot** see your bot settings or configuration
- ✗ We **cannot** see your sound library or audio files
- ✗ We **cannot** see your chat history or gameplay data (Coinks scores, etc.)
- ✗ We **cannot** see when you use the app or which features you use
- ✗ We **cannot** see your system, IP address, or device information
- ✓ We **can** read the open-source code to understand how it works
- ✓ We **can** accept bug reports and feature requests you voluntarily send
- ✓ We **can** see GitHub issues and discussions you choose to post

## What the App Does (On Your Machine)

The app running on your computer handles the following information. **This data never leaves your machine and we cannot access it:**

### Local Storage (on your computer, never sent anywhere)

- **Twitch authentication:** OAuth access token, refresh token, login name, user ID, token expiration time
- **Bot configuration:** which bots are enabled, their individual settings (TTS voice, sound file paths, cooldowns, etc.)
- **Sound library:** trigger text and associated audio files you upload
- **Coinks scores:** player names and coin game scores
- **Chat history:** chat messages that trigger bots (stored in memory only, cleared on restart)

All of this lives in Electron's userData directory:
- **Windows:** `%APPDATA%\MultiBot\`
- **macOS:** `~/Library/Application Support/MultiBot/`
- **Linux:** `~/.config/MultiBot/`

## Network Requests Made by the App

The app running on your machine makes network requests **only to Twitch's official servers**. We (the maintainers) never receive this traffic — it goes directly from your app to Twitch:

1. **Twitch OAuth authentication** — when you click "Connect Twitch"
   - Your app opens Twitch's official login page
   - You authenticate directly with Twitch (not through us)
   - Twitch sends your app an access token
   - Your app stores the token locally; Twitch does not tell us anything about you

2. **Twitch IRC chat connection** — to listen for chat messages
   - Your app connects directly to Twitch's IRC server
   - The app reads incoming chat messages to detect triggers (commands, emotes, etc.)
   - Chat messages stay on your machine; they are not uploaded anywhere
   - We cannot see this traffic or these messages

3. **Local overlay server** (127.0.0.1 only)
   - The app runs a small HTTP server only on your local machine
   - OBS Browser Sources load overlay pages from this local server
   - No traffic leaves your machine; this is completely offline-capable

## Third-Party Services

The app does **not** send data to, or integrate with, any third-party services such as:
- Google Analytics or similar telemetry
- Sentry or similar crash reporters
- Marketing pixels or tracking
- Cloud sync or backup services
- Any analytics or data collection platform

## Legacy Import

When you choose to import data from the old .NET MultiBot app, your app reads files from your local disk only (`%APPDATA%\MultiBot\commands.json`, etc.). This data is imported directly into your local MultiBot storage. No data is sent anywhere during import.

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
