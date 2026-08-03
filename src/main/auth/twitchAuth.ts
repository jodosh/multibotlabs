import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { createAuthWindow } from '../windowManager'
import { TWITCH_CLIENT_ID, TWITCH_REDIRECT_URI, TWITCH_SCOPES } from './twitchOAuthConfig'

export interface TwitchAuthResult {
  accessToken: string
  login: string
  userId: string
  expiresAt: number
}

function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: 'token',
    scope: TWITCH_SCOPES.join(' '),
    state
  })
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
}

async function validateToken(accessToken: string): Promise<Omit<TwitchAuthResult, 'accessToken'> | null> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` }
  })
  if (!response.ok) return null

  const data = (await response.json()) as { login: string; user_id: string; expires_in: number }
  return { login: data.login, userId: data.user_id, expiresAt: Date.now() + data.expires_in * 1000 }
}

// Implicit grant flow: the token comes back in the redirect URL's fragment,
// which is never sent to any server, so a real listener on the redirect URI
// isn't needed — we just intercept the navigation attempt and read the URL.
export function login(hudWindow?: BrowserWindow): Promise<TwitchAuthResult | null> {
  return new Promise((resolve) => {
    if (!TWITCH_CLIENT_ID) {
      resolve(null)
      return
    }

    const state = randomUUID()
    const authWindow = createAuthWindow(hudWindow)
    void authWindow.loadURL(buildAuthorizeUrl(state))

    let settled = false
    const finish = (result: TwitchAuthResult | null): void => {
      if (settled) return
      settled = true
      resolve(result)
      if (!authWindow.isDestroyed()) authWindow.close()
    }

    const tryHandleRedirect = async (url: string): Promise<void> => {
      if (!url.startsWith(TWITCH_REDIRECT_URI)) return

      const fragment = new URL(url).hash.slice(1)
      const params = new URLSearchParams(fragment)
      const accessToken = params.get('access_token')

      if (!accessToken || params.get('state') !== state) {
        finish(null)
        return
      }

      const validated = await validateToken(accessToken)
      finish(validated ? { accessToken, ...validated } : null)
    }

    authWindow.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith(TWITCH_REDIRECT_URI)) {
        event.preventDefault()
        void tryHandleRedirect(url)
      }
    })
    authWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(TWITCH_REDIRECT_URI)) {
        event.preventDefault()
        void tryHandleRedirect(url)
      }
    })
    authWindow.on('closed', () => finish(null))
  })
}

export async function logout(accessToken: string): Promise<void> {
  if (!accessToken) return
  try {
    const params = new URLSearchParams({ client_id: TWITCH_CLIENT_ID, token: accessToken })
    await fetch(`https://id.twitch.tv/oauth2/revoke?${params.toString()}`, { method: 'POST' })
  } catch {
    // Best-effort — we still clear the locally-stored token regardless.
  }
}
