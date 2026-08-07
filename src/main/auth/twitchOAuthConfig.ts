// Client ID is not secret (unlike the old app's leaked Client Secret) — safe
// to commit. Register a "Public" application at dev.twitch.tv/console/apps
// with this exact redirect URL, then paste the Client ID below.
export const TWITCH_CLIENT_ID = '31giyjm5zzvh8oqqq1wa1gk84e84lc'
export const TWITCH_REDIRECT_URI = 'http://localhost:17563/callback'
// channel:read:hype_train backs the Hype Train bot's EventSub subscriptions —
// adding it means existing logged-in users must log out/in once to pick it up.
export const TWITCH_SCOPES = ['chat:read', 'chat:edit', 'channel:read:hype_train']
