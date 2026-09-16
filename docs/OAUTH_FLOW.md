# Twitch OAuth Flow (Implicit Grant)

**Technical documentation of how MultiBot authenticates with Twitch**

## Why This Matters

This document explains why MultiBot uses the OAuth implicit grant flow and why it's secure for a desktop app. If you're concerned about credential security or AV flagging, this clarifies that the app does not attempt to steal credentials.

## The Problem We're Solving

A typical app that needs to access a user's Twitch account has two options:

1. **Authorization Code flow** — The app opens a redirect URI on its own server, Twitch redirects the user back to that server with an auth code, and the app exchanges the code for a token using a client secret. **Problem:** This requires the app to have a backend server and to store a client secret. For a desktop app with no backend, this is overkill and introduces a security liability (the secret gets baked into the binary or config).

2. **Implicit grant flow** — The app opens Twitch's login page, the user logs in and grants permission directly to Twitch (not the app), and Twitch redirects back to the app with a token. **No client secret needed.** The app never sees the password, and there's no backend server to compromise.

MultiBot uses **implicit grant** because it's the only secure choice for a desktop app with no backend.

## How It Works

### Step 1: User Clicks "Connect Twitch"

The app opens a hidden browser window and navigates to Twitch's OAuth authorize endpoint:

```
https://id.twitch.tv/oauth2/authorize
  ?client_id=<PUBLIC_CLIENT_ID>
  &redirect_uri=http://localhost:3000/auth
  &response_type=token
  &scope=chat:read chat:edit channel:manage:redemptions
```

**Important:** `response_type=token` (not `code`) signals that we want the implicit grant, not the authorization code flow.

### Step 2: User Authenticates with Twitch (Directly)

The user sees Twitch's real login page (twitch.tv domain, Twitch's SSL certificate). The app does **not** have access to what the user types. Twitch handles the password, 2FA, CAPTCHA — all of it.

**The app never sees or touches the password.**

### Step 3: User Grants Permissions

After logging in, Twitch shows a permission prompt: "MultiBot is requesting permission to read and send chat messages." The user sees Twitch's official domain and the official Twitch permission dialog.

### Step 4: Twitch Redirects with Access Token

If the user grants permission, Twitch redirects to:

```
http://localhost:3000/auth#access_token=<TOKEN>&token_type=bearer&expires_in=14400&scope=chat%3Aread+chat%3Aedit+...
```

**The token is in the URL fragment** (the `#` part), which means it's never sent to any server — it stays in the browser's JavaScript context.

### Step 5: App Extracts and Stores the Token

The app's main process intercepts this redirect using Electron's `webContents.on('will-navigate')` event. It extracts the token from the URL fragment and stores it locally in the userData directory.

**The token never leaves the user's computer.**

```typescript
// Simplified example from src/main/auth/index.ts
webContents.on('will-navigate', (event, url) => {
  const fragment = new URL(url).hash;
  const match = fragment.match(/access_token=([^&]+)/);
  if (match) {
    const accessToken = match[1];
    // Store locally, never send anywhere
    settingsStore.setTwitch({ accessToken, ... });
  }
});
```

### Step 6: Use the Token for Chat

With the token, the app connects to Twitch's IRC chat server using a library like `tmi.js`:

```typescript
const client = new tmi.Client({
  identity: { username: login, password: `oauth:${accessToken}` },
  channels: [channel],
});
```

This is how any Twitch bot works — the token proves you're authorized to send/read chat on behalf of the logged-in user.

## Why This Is Secure

1. **No password storage:** The app never sees the password. Twitch handles it.

2. **No client secret:** There's no server-side secret to compromise. Even if someone decompiles the app, they only find the `client_id`, which is public by design.

3. **User consent is explicit:** The user sees Twitch's official domain and confirms permissions directly with Twitch. There's no hidden credential exchange.

4. **Token scope is limited:** The app only requests `chat:read`, `chat:edit`, and `channel:manage:redemptions`. It can't access the user's password, email, payment info, or broadcast settings without explicit scope grants.

5. **Token is short-lived:** Access tokens expire in ~4 hours. The app stores a refresh token to get a new one, but neither token allows password reset or account recovery — Twitch's account team is the only entity that can do that.

6. **All traffic is to Twitch:** The app makes network requests only to Twitch's official servers (`id.twitch.tv`, `irc.chat.twitch.tv`). It doesn't proxy, intercept, or redirect auth traffic through any third party.

## Why Antivirus Shouldn't Flag This

Some AV software flags apps that perform OAuth flows because they *look* like credential theft if you don't understand the protocol:

- Opens a browser window → *might be trying to steal credentials*
- Reads URLs → *might be exfiltrating data*

**In reality:**
- Opening a browser window for OAuth is the standard, documented, recommended way to do it for desktop apps.
- Reading the redirect URL is how every OAuth app extracts the token.
- The token is NOT a password; it's a time-limited, scope-limited credential that Twitch issued.

If AV flagging persists, it's likely due to:
- The app being unsigned (see [CLAUDE.md](../CLAUDE.md) — code signing is on the roadmap)
- Heuristics being overly broad
- The AV team not being familiar with Electron/OAuth patterns

Submitting this document to your AV vendor shows you're using a well-known, documented, secure OAuth flow. It's not a red flag; it's standard practice.

## References

- [Twitch OAuth Documentation](https://dev.twitch.tv/docs/authentication) — Twitch's official OAuth guide
- [OAuth 2.0 for Native Apps (RFC 8252)](https://tools.ietf.org/html/rfc8252) — IETF standard for how native/desktop apps should handle OAuth. Section 4.3 discusses the implicit flow and its use in public clients (apps without a backend)
- [OAuth 2.0 Authorization Request (RFC 6749, Section 4.1.1)](https://tools.ietf.org/html/rfc6749#section-4.1.1) — The original OAuth 2.0 spec defining response_type and flow selection

## Implementation Details

See [src/main/auth/](../src/main/auth/) in the source code for the actual implementation.
