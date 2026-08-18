import type {
  SettingsApi,
  AuthStatus,
  BotSummary,
  LegacyImportStatus,
  LegacySoundsImportSummary
} from '../../preload/settings'

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
const legacyImportSkipped = document.getElementById('legacy-import-skipped') as HTMLPreElement

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

  // Both rows stay available after a successful run. Hiding them made a
  // partial or failed import unrecoverable — the emote importer read the
  // wrong shape for a long time and imported nothing, and there was no way
  // to retry once the flag was set short of hand-editing settings.json.
  // Re-running is safe: the importers skip triggers already in the library.
  legacySoundsRow.hidden = false
  legacyMediaRow.hidden = false
  legacyImportSection.hidden = false

  importSoundsButton.textContent = status.soundsImported ? 'Import again' : 'Import'
  importMediaButton.textContent = status.mediaImported ? 'Import again' : 'Import'
}

async function loadLegacyImportStatus(): Promise<void> {
  renderLegacyImportStatus(await window.settingsApi.getLegacyImportStatus())
}

// The old emotes.json lists every channel emote, so a run routinely reports
// thousands of entries that never had a sound — reported as a count, since
// they are normal rather than problems. Only genuine failures are listed.
function describeSoundsImport(summary: LegacySoundsImportSummary): string {
  const parts = [
    `Imported ${summary.importedSounds} sound(s), ${summary.importedTextReplies} text repl${
      summary.importedTextReplies === 1 ? 'y' : 'ies'
    }.`
  ]
  if (summary.alreadyPresent > 0) parts.push(`${summary.alreadyPresent} already in your library.`)
  if (summary.withoutSound > 0) parts.push(`${summary.withoutSound} had no sound assigned.`)
  if (summary.skipped.length > 0) parts.push(`Skipped ${summary.skipped.length}:`)
  return parts.join(' ')
}

// Failures go in their own scrollable block rather than joined into the
// summary line: a moved sounds folder means one entry per command, which as
// a single paragraph pushes the rest of the window off-screen.
function renderSkipped(skipped: string[]): void {
  legacyImportSkipped.textContent = skipped.join('\n')
  legacyImportSkipped.hidden = skipped.length === 0
}

// The Settings window is taller than its frame and scrolls, and the import
// result renders at the very bottom — without this the button appears to do
// nothing at all, since the report lands below the fold. Targets the failure
// list when there is one: it sits below the summary, so scrolling to the
// summary alone would leave the failures off-screen.
function revealImportResult(): void {
  const last = legacyImportSkipped.hidden ? legacyImportSummary : legacyImportSkipped
  last.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

importSoundsButton.addEventListener('click', () => {
  void (async () => {
    importSoundsButton.disabled = true
    try {
      const summary = await window.settingsApi.importLegacySounds()
      legacyImportSummary.textContent = describeSoundsImport(summary)
      renderSkipped(summary.skipped)
      revealImportResult()
    } finally {
      // Re-enabled so a run that failed part-way can be retried without
      // reopening the window.
      importSoundsButton.disabled = false
    }
    await loadLegacyImportStatus()
  })()
})

importMediaButton.addEventListener('click', () => {
  void (async () => {
    importMediaButton.disabled = true
    try {
      const summary = await window.settingsApi.importLegacyMedia()
      legacyImportSummary.textContent = `Imported ${summary.imported} media item(s).${
        summary.skipped.length > 0 ? ` Skipped ${summary.skipped.length}:` : ''
      }`
      renderSkipped(summary.skipped)
      revealImportResult()
    } finally {
      importMediaButton.disabled = false
    }
    await loadLegacyImportStatus()
  })()
})

void loadAuthStatus()
void loadBots()
void loadLegacyImportStatus()
