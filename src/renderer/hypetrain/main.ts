import type { HypeTrainApi, HypeTrainOverlayStatusDto, HypeTrainStateDto } from '../../preload/hypeTrain'

declare global {
  interface Window {
    hypeTrain: HypeTrainApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const volumeInput = document.getElementById('volume') as HTMLInputElement
const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement
const overlayIndicator = document.getElementById('overlay-indicator') as HTMLSpanElement
const overlayStatus = document.getElementById('overlay-status') as HTMLSpanElement
const copyUrlButton = document.getElementById('copy-url-button') as HTMLButtonElement
const battleStatus = document.getElementById('battle-status') as HTMLParagraphElement
const testButton = document.getElementById('test-button') as HTMLButtonElement

closeButton.addEventListener('click', () => {
  window.hypeTrain.close()
})

function renderOverlayStatus(status: HypeTrainOverlayStatusDto): void {
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
  overlayStatus.textContent = 'No overlay connected — add this URL as a Browser Source in OBS.'
}

function renderBattleState(state: HypeTrainStateDto): void {
  testButton.disabled = state.active
  if (!state.active) {
    battleStatus.textContent = 'Idle — waiting for a Hype Train.'
    return
  }
  battleStatus.textContent = `Battle in progress — level ${state.level}, ${state.archerCount} archer${state.archerCount === 1 ? '' : 's'}.`
}

volumeInput.addEventListener('change', () => {
  void window.hypeTrain.setSettings({ volume: Number(volumeInput.value) })
})

testButton.addEventListener('click', () => {
  void window.hypeTrain.test()
})

copyUrlButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(overlayUrlInput.value)
  copyUrlButton.textContent = 'Copied'
  window.setTimeout(() => (copyUrlButton.textContent = 'Copy'), 1200)
})

void window.hypeTrain.getSettings().then((settings) => {
  volumeInput.value = String(settings.volume)
})

window.hypeTrain.onOverlayStatusChanged(renderOverlayStatus)
void window.hypeTrain.getOverlayStatus().then(renderOverlayStatus)

window.hypeTrain.onStateChanged(renderBattleState)
void window.hypeTrain.getState().then(renderBattleState)
