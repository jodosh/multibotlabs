import type {
  SettingsApi,
  AuthStatus,
  BotSummary,
  LegacyImportStatus,
  LegacySoundsImportSummary
} from '../../preload/settings'
import type { DiagnosticsReport } from '../../main/diagnostics/collectDiagnostics'

declare global {
  interface Window {
    settingsApi: SettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const updatesEnabledCheckbox = document.getElementById('updates-enabled-checkbox') as HTMLInputElement
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

updatesEnabledCheckbox.addEventListener('change', () => {
  void window.settingsApi.setUpdatesEnabled(updatesEnabledCheckbox.checked)
})

async function loadUpdatesEnabled(): Promise<void> {
  updatesEnabledCheckbox.checked = await window.settingsApi.getUpdatesEnabled()
}

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
void loadUpdatesEnabled()


// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabSettings = document.getElementById('tab-settings') as HTMLButtonElement
const tabHelp = document.getElementById('tab-help') as HTMLButtonElement
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement
const helpPanel = document.getElementById('help-panel') as HTMLDivElement

function selectTab(target: 'settings' | 'help'): void {
  settingsPanel.hidden = target !== 'settings'
  helpPanel.hidden = target !== 'help'
  tabSettings.classList.toggle('active', target === 'settings')
  tabHelp.classList.toggle('active', target === 'help')
}

tabSettings.addEventListener('click', () => selectTab('settings'))
tabHelp.addEventListener('click', () => {
  selectTab('help')
  // Collected on open rather than at startup so the snapshot reflects the state
  // the user is actually reporting on, not whatever was true when the window
  // was created.
  void refreshReport()
})

// ---------------------------------------------------------------------------
// Report a problem
// ---------------------------------------------------------------------------

const ISSUES_URL = 'https://github.com/jodosh/multibotlabs/issues/new'

const reportDoing = document.getElementById('report-doing') as HTMLTextAreaElement
const reportHappened = document.getElementById('report-happened') as HTMLTextAreaElement
const reportExpected = document.getElementById('report-expected') as HTMLTextAreaElement
const reportOutput = document.getElementById('report-output') as HTMLTextAreaElement
const copyReportButton = document.getElementById('copy-report-button') as HTMLButtonElement
const openIssuesButton = document.getElementById('open-issues-button') as HTMLButtonElement
const copyConfirmation = document.getElementById('copy-confirmation') as HTMLParagraphElement

let diagnostics: DiagnosticsReport | undefined

// Tracks whether the user has hand-edited the generated text. Once they have,
// typing in the fields above must not silently overwrite their edits — the
// whole point of the textarea is that they can remove things before sharing.
let reportEdited = false

reportOutput.addEventListener('input', () => {
  reportEdited = true
})

for (const field of [reportDoing, reportHappened, reportExpected]) {
  field.addEventListener('input', () => {
    if (!reportEdited) renderReport()
  })
}

async function refreshReport(): Promise<void> {
  diagnostics = await window.settingsApi.getDiagnostics()
  if (!reportEdited) renderReport()
}

function answer(field: HTMLTextAreaElement): string {
  const value = field.value.trim()
  return value.length > 0 ? value : '_(not provided)_'
}

function renderReport(): void {
  if (!diagnostics) return
  reportOutput.value = formatReport(diagnostics)
}

function formatReport(report: DiagnosticsReport): string {
  const lines: string[] = []

  lines.push('### What happened')
  lines.push('')
  lines.push(`**What I was doing:** ${answer(reportDoing)}`)
  lines.push(`**What happened:** ${answer(reportHappened)}`)
  lines.push(`**What I expected:** ${answer(reportExpected)}`)
  lines.push('')
  lines.push('### Environment')
  lines.push('')
  lines.push(`- MultiBot ${report.app.version} (Electron ${report.app.electron}, Chrome ${report.app.chrome}, Node ${report.app.node})`)
  lines.push(`- ${report.platform.os} ${report.platform.arch} (${report.platform.release})`)
  lines.push(`- Twitch: ${report.auth.loggedIn ? (report.auth.tokenExpired ? 'logged in, token expired' : 'logged in') : 'not logged in'}`)
  lines.push(`- Overlay server: ${report.overlay.status} on port ${report.overlay.port}${report.overlay.lastError ? ` — ${report.overlay.lastError}` : ''}`)
  lines.push('')
  lines.push('### Bots')
  lines.push('')
  lines.push('| Bot | Enabled | Status | Last error |')
  lines.push('| --- | --- | --- | --- |')
  for (const module of report.modules) {
    lines.push(`| ${module.displayName} | ${module.enabled ? 'yes' : 'no'} | ${module.status} | ${module.lastError ?? '—'} |`)
  }
  lines.push('')
  lines.push('### Connections')
  lines.push('')
  lines.push(`- Chat: ${report.transports.chat.status}${report.transports.chat.lastError ? ` — ${report.transports.chat.lastError}` : ''}`)
  lines.push(`- EventSub: ${report.transports.eventSub.status}${report.transports.eventSub.lastError ? ` — ${report.transports.eventSub.lastError}` : ''}`)
  lines.push(`- Overlay browser sources connected: ${Object.entries(report.overlay.clients).map(([f, n]) => `${f}=${n}`).join(', ')}`)
  lines.push('')
  lines.push('### Library')
  lines.push('')
  const lib = report.library
  lines.push(`- ${lib.commandSounds} command sounds, ${lib.emoteSounds} emote sounds, ${lib.userIntroSounds} user intros`)
  lines.push(`- ${lib.textReplies} text replies, ${lib.mediaTriggers} media triggers, ${lib.coinksScores} Coinks scores`)
  lines.push('')
  lines.push('<details><summary>Full configuration</summary>')
  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(report.config, null, 2))
  lines.push('```')
  lines.push('')
  lines.push('</details>')
  lines.push('')
  lines.push(`_Collected ${report.generatedAt} — no tokens, channel names or chat content are included._`)

  return lines.join('\n')
}

copyReportButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(reportOutput.value).then(() => {
    copyConfirmation.hidden = false
    setTimeout(() => {
      copyConfirmation.hidden = true
    }, 2500)
  })
})

openIssuesButton.addEventListener('click', () => {
  window.settingsApi.openUrl(ISSUES_URL)
})
