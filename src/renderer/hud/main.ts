import type { HudApi, ModuleSummary } from '../../preload/hud'

declare global {
  interface Window {
    hud: HudApi
  }
}

// Modules with a dedicated management window, opened via right-click. The
// window kind isn't needed here — main process resolves it from the id — but
// having this map keeps the "does this tile have one" check in one place.
const MODULES_WITH_MANAGER_WINDOW = new Set([
  'command',
  'emote',
  'text-to-speech',
  'at-me',
  'media-gif',
  'celebration',
  'coinks',
  'hype-train'
])

const barElement = document.getElementById('bar') as HTMLDivElement
const tilesContainer = document.getElementById('tiles') as HTMLDivElement
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement
const closeButton = document.getElementById('close-button') as HTMLButtonElement

function render(modules: ModuleSummary[]): void {
  tilesContainer.innerHTML = ''
  for (const module of modules) {
    const tile = document.createElement('button')
    tile.className = `tile ${module.status}${module.enabled ? ' enabled' : ''}`
    tile.textContent = module.displayName
    const hasManagerWindow = MODULES_WITH_MANAGER_WINDOW.has(module.id)
    tile.title = hasManagerWindow
      ? `${module.displayName} — ${module.status} (right-click to manage)`
      : `${module.displayName} — ${module.status}`
    tile.addEventListener('click', () => {
      void window.hud.toggleModule(module.id)
    })
    if (hasManagerWindow) {
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        window.hud.openLibrary(module.id)
      })
    }
    tilesContainer.appendChild(tile)
  }

  // #tiles is no longer flex:1-stretched (see style.css), so the bar's
  // rendered width now reflects its actual content — reading it here forces
  // the layout the DOM mutations above just queued, so this is accurate.
  window.hud.resizeWindow(Math.ceil(barElement.getBoundingClientRect().width))
}

settingsButton.addEventListener('click', () => {
  window.hud.openSettings()
})

settingsButton.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.hud.toggleSettings()
})

closeButton.addEventListener('click', () => {
  window.hud.quit()
})

window.hud.onModulesChanged(render)
void window.hud.getModules().then(render)
