import type { HudApi, ModuleSummary } from '../../preload/hud'

declare global {
  interface Window {
    hud: HudApi
  }
}

const barElement = document.getElementById('bar') as HTMLDivElement
const tilesContainer = document.getElementById('tiles') as HTMLDivElement
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement
const closeButton = document.getElementById('close-button') as HTMLButtonElement
const updateButton = document.getElementById('update-button') as HTMLButtonElement

function render(modules: ModuleSummary[]): void {
  tilesContainer.innerHTML = ''
  for (const module of modules) {
    const tile = document.createElement('button')
    tile.className = `tile ${module.status}${module.enabled ? ' enabled' : ''}`
    tile.textContent = module.displayName
    // The failure reason goes on its own line so the tooltip stays readable
    // when it's long — a token-scope message runs to a full sentence.
    const hint = module.hasManagerWindow ? ' (right-click to manage)' : ''
    tile.title = module.lastError
      ? `${module.displayName} — ${module.status}${hint}\n${module.lastError}`
      : `${module.displayName} — ${module.status}${hint}`
    tile.addEventListener('click', () => {
      void window.hud.toggleModule(module.id)
    })
    if (module.hasManagerWindow) {
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

updateButton.addEventListener('click', () => {
  window.hud.openUpdateDetails()
})

window.hud.onUpdateAvailable(() => {
  updateButton.hidden = false
  window.hud.resizeWindow(Math.ceil(barElement.getBoundingClientRect().width))
})

window.hud.onUpdateDismissed(() => {
  updateButton.hidden = true
  window.hud.resizeWindow(Math.ceil(barElement.getBoundingClientRect().width))
})
