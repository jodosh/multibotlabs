import type { CoinksApi, CoinksOverlayStatusDto, CoinksStateDto, CoinksScoreDto } from '../../preload/coinks'

declare global {
  interface Window {
    coinks: CoinksApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const bitsPriceInput = document.getElementById('bits-price') as HTMLInputElement
const commandEnabledInput = document.getElementById('command-enabled') as HTMLInputElement
const coinsPerGameInput = document.getElementById('coins-per-game') as HTMLInputElement
const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement
const overlayIndicator = document.getElementById('overlay-indicator') as HTMLSpanElement
const overlayStatus = document.getElementById('overlay-status') as HTMLSpanElement
const copyUrlButton = document.getElementById('copy-url-button') as HTMLButtonElement
const queueCurrent = document.getElementById('queue-current') as HTMLParagraphElement
const queueList = document.getElementById('queue-list') as HTMLOListElement
const leaderboard = document.getElementById('leaderboard') as HTMLOListElement
const testPlayerInput = document.getElementById('test-player') as HTMLInputElement
const testButton = document.getElementById('test-button') as HTMLButtonElement
const volumeInput = document.getElementById('volume') as HTMLInputElement

closeButton.addEventListener('click', () => {
  window.coinks.close()
})

function renderOverlayStatus(status: CoinksOverlayStatusDto): void {
  overlayUrlInput.value = status.url

  if (status.status === 'error') {
    overlayIndicator.className = 'indicator error'
    overlayStatus.textContent = status.error ?? 'Overlay server failed to start.'
    return
  }
  if (status.clients > 0) {
    overlayIndicator.className = 'indicator connected'
    overlayStatus.textContent = `Overlay connected (${status.clients} source${status.clients === 1 ? '' : 's'}).`
    return
  }
  overlayIndicator.className = 'indicator waiting'
  overlayStatus.textContent = 'No overlay connected — chat cannot join until this is added in OBS.'
}

function renderState(state: CoinksStateDto): void {
  queueCurrent.textContent = state.currentPlayer ? `Playing: ${state.currentPlayer}` : 'Nobody is playing.'
  queueList.innerHTML = ''
  for (const name of state.queue) {
    const item = document.createElement('li')
    item.textContent = name
    queueList.appendChild(item)
  }
  void refreshLeaderboard()
}

async function refreshLeaderboard(): Promise<void> {
  const scores: CoinksScoreDto[] = await window.coinks.leaderboard()
  leaderboard.innerHTML = ''
  for (const entry of scores) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = entry.player
    const value = document.createElement('span')
    value.className = 'score'
    value.textContent = String(entry.score)
    item.append(name, value)
    leaderboard.appendChild(item)
  }
}

bitsPriceInput.addEventListener('change', () => {
  void window.coinks.setSettings({ bitsPrice: Number(bitsPriceInput.value) })
})
commandEnabledInput.addEventListener('change', () => {
  void window.coinks.setSettings({ commandEnabled: commandEnabledInput.checked })
})
coinsPerGameInput.addEventListener('change', () => {
  void window.coinks.setSettings({ coinsPerGame: Number(coinsPerGameInput.value) })
})

volumeInput.addEventListener('change', () => {
  void window.coinks.setSettings({ volume: Number(volumeInput.value) })
})

testButton.addEventListener('click', () => {
  const name = testPlayerInput.value.trim()
  if (!name) return
  void window.coinks.enqueue(name)
  testPlayerInput.value = ''
})

copyUrlButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(overlayUrlInput.value)
  copyUrlButton.textContent = 'Copied'
  window.setTimeout(() => (copyUrlButton.textContent = 'Copy'), 1200)
})

void window.coinks.getSettings().then((settings) => {
  bitsPriceInput.value = String(settings.bitsPrice)
  commandEnabledInput.checked = settings.commandEnabled
  coinsPerGameInput.value = String(settings.coinsPerGame)
  volumeInput.value = String(settings.volume)
})

window.coinks.onOverlayStatusChanged(renderOverlayStatus)
window.coinks.onStateChanged(renderState)
void window.coinks.getOverlayStatus().then(renderOverlayStatus)
void window.coinks.getState().then(renderState)
