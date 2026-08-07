import type { SettingsApi, AuthStatus, BotSummary, LegacyImportStatus } from '../../preload/settings'

declare global {
  interface Window {
    settingsApi: SettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const twitchStatus = document.getElementById('twitch-status') as HTMLSpanElement
const twitchActionButton = document.getElementById('twitch-action-button') as HTMLButtonElement
const botList = document.getElementById('bot-list') as HTMLUListElement
const legacyImportSection = document.getElementById('legacy-import-section') as HTMLElement
const legacySoundsRow = document.getElementById('legacy-sounds-row') as HTMLLIElement
const legacyMediaRow = document.getElementById('legacy-media-row') as HTMLLIElement
const importSoundsButton = document.getElementById('import-sounds-button') as HTMLButtonElement
const importMediaButton = document.getElementById('import-media-button') as HTMLButtonElement
const legacyImportSummary = document.getElementById('legacy-import-summary') as HTMLParagraphElement

closeButton.addEventListener('click', () => {
  window.settingsApi.close()
})

function renderAuthStatus(status: AuthStatus): void {
  twitchActionButton.disabled = false
  if (status.loggedIn) {
    twitchStatus.textContent = `Connected as ${status.login}`
    twitchActionButton.textContent = 'Log out'
  } else {
    twitchStatus.textContent = 'Not connected'
    twitchActionButton.textContent = 'Log in with Twitch'
  }
}

async function handleTwitchAction(): Promise<void> {
  twitchActionButton.disabled = true

  const status = await window.settingsApi.getAuthStatus()
  if (status.loggedIn) {
    twitchStatus.textContent = 'Logging out…'
    renderAuthStatus(await window.settingsApi.logout())
  } else {
    twitchStatus.textContent = 'Waiting for login…'
    renderAuthStatus(await window.settingsApi.login())
  }
}

twitchActionButton.addEventListener('click', () => {
  void handleTwitchAction()
})

let draggedId: string | undefined

function renderBots(bots: BotSummary[]): void {
  botList.innerHTML = ''
  for (const bot of bots) {
    const item = document.createElement('li')
    item.className = 'row'
    item.draggable = true
    item.dataset['id'] = bot.id

    const handle = document.createElement('span')
    handle.className = 'drag-handle'
    handle.textContent = '⠿'

    const name = document.createElement('span')
    name.className = 'bot-name'
    name.textContent = bot.displayName

    const showLabel = document.createElement('label')
    showLabel.className = 'checkbox'
    const showInput = document.createElement('input')
    showInput.type = 'checkbox'
    showInput.checked = !bot.hidden
    showInput.addEventListener('change', () => {
      void window.settingsApi.setBotHidden(bot.id, !showInput.checked)
    })
    showLabel.append(showInput, document.createTextNode('Show'))

    item.append(handle, name, showLabel)

    item.addEventListener('dragstart', () => {
      draggedId = bot.id
      item.classList.add('dragging')
    })
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging')
    })
    item.addEventListener('dragover', (event) => {
      event.preventDefault()
    })
    item.addEventListener('drop', (event) => {
      event.preventDefault()
      if (!draggedId || draggedId === bot.id) return
      void reorderAndPersist(draggedId, bot.id)
    })

    botList.appendChild(item)
  }
}

async function reorderAndPersist(draggedBotId: string, targetBotId: string): Promise<void> {
  const rows = [...botList.querySelectorAll<HTMLLIElement>('li')]
  const ids = rows.map((row) => row.dataset['id'] as string)

  const fromIndex = ids.indexOf(draggedBotId)
  const toIndex = ids.indexOf(targetBotId)
  if (fromIndex < 0 || toIndex < 0) return

  ids.splice(toIndex, 0, ...ids.splice(fromIndex, 1))
  await window.settingsApi.setBotOrder(ids)
  await loadBots()
}

async function loadBots(): Promise<void> {
  renderBots(await window.settingsApi.getBots())
}

async function loadAuthStatus(): Promise<void> {
  renderAuthStatus(await window.settingsApi.getAuthStatus())
}

function renderLegacyImportStatus(status: LegacyImportStatus): void {
  // No old-app data directory on this machine at all — nothing to offer.
  if (!status.dirExists) {
    legacyImportSection.hidden = true
    return
  }

  legacySoundsRow.hidden = status.soundsImported
  legacyMediaRow.hidden = status.mediaImported
  // Both already imported: nothing left to show, so drop the whole section
  // rather than leaving a header with two hidden rows under it.
  legacyImportSection.hidden = status.soundsImported && status.mediaImported
}

async function loadLegacyImportStatus(): Promise<void> {
  renderLegacyImportStatus(await window.settingsApi.getLegacyImportStatus())
}

importSoundsButton.addEventListener('click', () => {
  void (async () => {
    importSoundsButton.disabled = true
    const summary = await window.settingsApi.importLegacySounds()
    const skippedNote = summary.skipped.length > 0 ? ` Skipped ${summary.skipped.length}: ${summary.skipped.join('; ')}` : ''
    legacyImportSummary.textContent = `Imported ${summary.importedSounds} sound(s), ${summary.importedTextReplies} text repl${
      summary.importedTextReplies === 1 ? 'y' : 'ies'
    }.${skippedNote}`
    await loadLegacyImportStatus()
  })()
})

importMediaButton.addEventListener('click', () => {
  void (async () => {
    importMediaButton.disabled = true
    const summary = await window.settingsApi.importLegacyMedia()
    const skippedNote = summary.skipped.length > 0 ? ` Skipped ${summary.skipped.length}: ${summary.skipped.join('; ')}` : ''
    legacyImportSummary.textContent = `Imported ${summary.imported} media item(s).${skippedNote}`
    await loadLegacyImportStatus()
  })()
})

void loadAuthStatus()
void loadBots()
void loadLegacyImportStatus()
