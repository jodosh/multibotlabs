import { app } from 'electron'
import { release } from 'node:os'
import { getSettings } from '../app/settingsState'
import { moduleManager, soundLibrary, mediaLibrary, coinksScores, chatClient, hypeTrainEventSub } from '../app/services'
import { overlayServer } from '../overlay/overlayService'
import type { OverlayFeature } from '../overlay/types'

// Builds the state summary behind "Report a Problem".
//
// Two rules govern everything here, and they are not interchangeable:
//
//   1. Secrets are never COLLECTED, not collected-then-stripped. The access
//      token, the Twitch login and the user id are simply never read into the
//      report. There is nothing to leak if it was never put in.
//   2. Error strings are not ours. tmi.js and Twitch's API embed the channel
//      name in messages, so every lastError is scrubbed of it. That scrub is
//      applied ONLY to error text, never the whole report: a user whose login
//      happens to be an ordinary word ("celebration", "command") would
//      otherwise have every legitimate occurrence replaced and get back a
//      mangled, useless report. Everything outside error text is built here
//      field by field and provably never reads the login.
//   3. The token is scrubbed globally as a backstop, which is free of that
//      risk — an access token is high-entropy and cannot collide with real
//      content — and covers a future field added here carelessly.
//
// Also deliberately absent: any absolute file path. Sound and media paths and
// the userData directory all contain the OS username, so the report carries
// counts instead of contents.

export interface DiagnosticsReport {
  generatedAt: string
  app: { version: string; electron: string; chrome: string; node: string }
  platform: { os: NodeJS.Platform; arch: string; release: string }
  auth: { loggedIn: boolean; tokenExpired: boolean }
  modules: Array<{
    id: string
    displayName: string
    enabled: boolean
    status: string
    lastError?: string
  }>
  transports: {
    chat: { status: string; lastError?: string }
    eventSub: { status: string; lastError?: string }
  }
  overlay: {
    status: string
    port: number
    lastError?: string
    clients: Record<OverlayFeature, number>
  }
  library: {
    commandSounds: number
    emoteSounds: number
    userIntroSounds: number
    textReplies: number
    mediaTriggers: number
    coinksScores: number
  }
  config: {
    botOrder: string[]
    botHidden: string[]
    modules: unknown
    updates: { enabled: boolean; hasCheckedBefore: boolean; dismissedVersion?: string }
    legacyImport: { soundsImported: boolean; mediaImported: boolean }
  }
}

const OVERLAY_FEATURES: OverlayFeature[] = ['media', 'fireworks', 'coinks', 'hype-train']

export function collectDiagnostics(): DiagnosticsReport {
  const settings = getSettings()

  const report: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    platform: {
      os: process.platform,
      arch: process.arch,
      release: release()
    },
    auth: {
      // Whether, not who. The login name identifies a real person's channel and
      // has no diagnostic value a boolean doesn't carry.
      loggedIn: Boolean(settings.twitch.accessToken),
      tokenExpired: settings.twitch.expiresAt > 0 && settings.twitch.expiresAt < Date.now()
    },
    modules: moduleManager.list().map((module) => ({
      id: module.id,
      displayName: module.displayName,
      enabled: module.enabled,
      status: module.status,
      lastError: scrubErrorText(module.lastError, settings.twitch.login)
    })),
    transports: {
      chat: { status: chatClient.status, lastError: scrubErrorText(chatClient.lastError, settings.twitch.login) },
      eventSub: {
        status: hypeTrainEventSub.status,
        lastError: scrubErrorText(hypeTrainEventSub.lastError, settings.twitch.login)
      }
    },
    overlay: {
      status: overlayServer.status,
      // Same `||` as overlayStatus(): port is 0 when not listening, which should
      // report the configured port rather than zero.
      port: overlayServer.port || settings.modules.mediaGif.overlayPort,
      lastError: scrubErrorText(overlayServer.lastError, settings.twitch.login),
      clients: Object.fromEntries(
        OVERLAY_FEATURES.map((feature) => [feature, overlayServer.clientCount(feature)])
      ) as Record<OverlayFeature, number>
    },
    library: {
      // Counts only — trigger text is user content and channel-identifying.
      commandSounds: soundLibrary.listSounds('command').length,
      emoteSounds: soundLibrary.listSounds('emote').length,
      userIntroSounds: soundLibrary.listSounds('user-intro').length,
      textReplies: soundLibrary.listTextReplies().length,
      mediaTriggers: mediaLibrary.list().length,
      coinksScores: coinksScores.list().length
    },
    config: {
      botOrder: settings.bots.order,
      botHidden: settings.bots.hidden,
      // Every field under `modules` today is benign tuning — bits prices, shell
      // counts, volumes, a system voice name, the overlay port. If a secret is
      // ever added there, this must switch to picking fields explicitly. The
      // token backstop below would catch an access token specifically; the
      // smoke test is what catches anything else.
      modules: settings.modules,
      updates: {
        enabled: settings.updates.enabled,
        // The timestamp itself says when the user last ran the app; whether a
        // check has happened is the part that diagnoses anything.
        hasCheckedBefore: Boolean(settings.updates.lastCheckTime),
        dismissedVersion: settings.updates.dismissedVersion
      },
      legacyImport: {
        soundsImported: settings.legacyImport.soundsImported,
        mediaImported: settings.legacyImport.mediaImported
      }
    }
  }

  return scrubToken(report, settings.twitch.accessToken)
}

// Removes the channel name from text this app did not write. Applied only to
// error strings — see rule 2 above for why this is not done report-wide.
//
// Logins under three characters are left alone: a two-letter name matches
// inside ordinary words ("al" in "already") and would do more damage than the
// leak it prevents.
function scrubErrorText(text: string | undefined, login: string): string | undefined {
  if (!text || !login || login.length < 3) return text
  const pattern = new RegExp(login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return text.replace(pattern, '<channel>')
}

// Backstop against a field added above that reads more than it should. Safe to
// apply to the whole report: an access token is high-entropy and cannot collide
// with legitimate content the way a short login can.
function scrubToken<T>(report: T, accessToken: string): T {
  if (!accessToken) return report
  const json = JSON.stringify(report)
  if (!json.includes(accessToken)) return report
  return JSON.parse(json.split(accessToken).join('<redacted-token>')) as T
}
