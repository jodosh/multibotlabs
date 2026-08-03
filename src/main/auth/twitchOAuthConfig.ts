// Client ID is not secret (unlike the old app's leaked Client Secret) — safe
// to commit. Register a "Public" application at dev.twitch.tv/console/apps
// with this exact redirect URL, then paste the Client ID below.
export const TWITCH_CLIENT_ID = '31giyjm5zzvh8oqqq1wa1gk84e84lc'
export const TWITCH_REDIRECT_URI = 'http://localhost:17563/callback'
export const TWITCH_SCOPES = ['chat:read', 'chat:edit']
