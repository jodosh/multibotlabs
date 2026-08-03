import type { SettingsApi, AuthStatus, BotSummary } from '../../preload/settings'

declare global {
  interface Window {
    settingsApi: SettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const twitchStatus = document.getElementById('twitch-status') as HTMLSpanElement
const twitchActionButton = document.getElementById('twitch-action-button') as HTMLButtonElement
const botList = document.getElementById('bot-list') as HTMLUListElement

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

void loadAuthStatus()
void loadBots()
