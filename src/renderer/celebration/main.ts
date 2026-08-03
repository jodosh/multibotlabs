import type { CelebrationApi, FireworksOverlayStatusDto } from '../../preload/celebration'

declare global {
  interface Window {
    celebration: CelebrationApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const bitsPriceInput = document.getElementById('bits-price') as HTMLInputElement
const commandEnabledInput = document.getElementById('command-enabled') as HTMLInputElement
const shellCountInput = document.getElementById('shell-count') as HTMLInputElement
const testButton = document.getElementById('test-button') as HTMLButtonElement
const volumeInput = document.getElementById('volume') as HTMLInputElement
const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement
const overlayIndicator = document.getElementById('overlay-indicator') as HTMLSpanElement
const overlayStatus = document.getElementById('overlay-status') as HTMLSpanElement
const copyUrlButton = document.getElementById('copy-url-button') as HTMLButtonElement

closeButton.addEventListener('click', () => {
  window.celebration.close()
})

function renderOverlayStatus(status: FireworksOverlayStatusDto): void {
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

bitsPriceInput.addEventListener('change', () => {
  void window.celebration.setSettings({ bitsPrice: Number(bitsPriceInput.value) })
})
commandEnabledInput.addEventListener('change', () => {
  void window.celebration.setSettings({ commandEnabled: commandEnabledInput.checked })
})
shellCountInput.addEventListener('change', () => {
  void window.celebration.setSettings({ shellCount: Number(shellCountInput.value) })
})

volumeInput.addEventListener('change', () => {
  void window.celebration.setSettings({ volume: Number(volumeInput.value) })
})

testButton.addEventListener('click', () => {
  void window.celebration.test()
})

copyUrlButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(overlayUrlInput.value)
  copyUrlButton.textContent = 'Copied'
  window.setTimeout(() => (copyUrlButton.textContent = 'Copy'), 1200)
})

void window.celebration.getSettings().then((settings) => {
  bitsPriceInput.value = String(settings.bitsPrice)
  commandEnabledInput.checked = settings.commandEnabled
  shellCountInput.value = String(settings.shellCount)
  volumeInput.value = String(settings.volume)
})

window.celebration.onOverlayStatusChanged(renderOverlayStatus)
void window.celebration.getOverlayStatus().then(renderOverlayStatus)
