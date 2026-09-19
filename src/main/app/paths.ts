import { join } from 'node:path'
import { app } from 'electron'

// All of these must stay functions, never module-level consts: `app` isn't
// populated with its paths until the app is ready, and these modules are
// evaluated at import time, well before that.

export function resourcesRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

// Renderer output root, used by the overlay server to serve the OBS page in
// production. In dev it proxies to Vite instead and this is never read.
//
// `__dirname` resolves against the *bundle* (out/main), not this source file —
// electron-vite emits the whole main process as a single out/main/index.js — so
// moving this out of index.ts doesn't change what it points at.
export function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

export function gameAssetsRoot(): string {
  return join(resourcesRoot(), 'coinks')
}

export function hypeAssetsRoot(): string {
  return join(resourcesRoot(), 'hype')
}
