import type { MediaLibraryApi, MediaTriggerDto, MediaAnchor, OverlayStatusDto } from '../../preload/mediaLibrary'
import { alertModal } from '../assets/modal'

declare global {
  interface Window {
    mediaLibrary: MediaLibraryApi
  }
}

const ANCHORS: MediaAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const addButton = document.getElementById('add-button') as HTMLButtonElement
const searchInput = document.getElementById('search') as HTMLInputElement
const emptyState = document.getElementById('empty-state') as HTMLParagraphElement
const mediaList = document.getElementById('media-list') as HTMLUListElement
const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement
const overlayPortInput = document.getElementById('overlay-port') as HTMLInputElement
const overlayIndicator = document.getElementById('overlay-indicator') as HTMLSpanElement
const overlayStatus = document.getElementById('overlay-status') as HTMLSpanElement
const copyUrlButton = document.getElementById('copy-url-button') as HTMLButtonElement

let cachedMedia: MediaTriggerDto[] = []

closeButton.addEventListener('click', () => {
  window.mediaLibrary.close()
})

function renderOverlayStatus(status: OverlayStatusDto): void {
  overlayUrlInput.value = status.url
  if (document.activeElement !== overlayPortInput) overlayPortInput.value = String(status.port)

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
  // The old app gave no signal at all when the overlay wasn't listening, which
  // is how broken setups went unnoticed mid-stream.
  overlayIndicator.className = 'indicator waiting'
  overlayStatus.textContent = 'No overlay connected — add this URL as a Browser Source in OBS.'
}

function renderMedia(entries: MediaTriggerDto[]): void {
  emptyState.hidden = cachedMedia.length > 0
  mediaList.innerHTML = ''

  for (const entry of entries) {
    const row = document.createElement('li')
    row.className = 'row'

    const commandInput = document.createElement('input')
    commandInput.type = 'text'
    commandInput.className = 'command'
    commandInput.value = entry.command
    commandInput.addEventListener('change', () => {
      void window.mediaLibrary.update(entry.id, { command: commandInput.value })
    })

    const fileLabel = document.createElement('span')
    fileLabel.className = 'filename'
    fileLabel.textContent = entry.fileName
    fileLabel.title = `${entry.fileName} (${entry.element})`

    const anchorGrid = document.createElement('div')
    anchorGrid.className = 'anchor-grid'
    anchorGrid.title = 'Where this appears inside the overlay'
    for (const anchor of ANCHORS) {
      const cell = document.createElement('button')
      cell.className = `anchor-cell${anchor === entry.anchor ? ' active' : ''}`
      cell.dataset.anchor = anchor
      cell.title = anchor
      cell.addEventListener('click', () => {
        entry.anchor = anchor
        void window.mediaLibrary.update(entry.id, { anchor })
        for (const other of anchorGrid.children) other.classList.remove('active')
        cell.classList.add('active')
      })
      anchorGrid.appendChild(cell)
    }

    const durationInput = document.createElement('input')
    durationInput.type = 'number'
    durationInput.className = 'duration'
    durationInput.min = '0.5'
    durationInput.step = '0.5'
    durationInput.value = String(entry.durationSeconds)
    durationInput.title = 'Seconds on screen'
    durationInput.addEventListener('change', () => {
      void window.mediaLibrary.update(entry.id, { durationSeconds: Number(durationInput.value) })
    })

    const volumeInput = document.createElement('input')
    volumeInput.type = 'range'
    volumeInput.min = '0'
    volumeInput.max = '1'
    volumeInput.step = '0.01'
    volumeInput.value = String(entry.volume)
    // Images have no audio track, so the control would be a lie for them.
    volumeInput.disabled = entry.element !== 'video'
    volumeInput.title = entry.element === 'video' ? 'Volume (drag to 0 to mute)' : 'No audio for images'
    volumeInput.addEventListener('change', () => {
      void window.mediaLibrary.update(entry.id, { volume: Number(volumeInput.value) })
    })

    const testButton = document.createElement('button')
    testButton.textContent = 'Test'
    testButton.addEventListener('click', () => {
      void window.mediaLibrary.test(entry.id)
    })

    const deleteButton = document.createElement('button')
    deleteButton.textContent = 'Delete'
    deleteButton.className = 'danger'
    deleteButton.addEventListener('click', () => {
      void window.mediaLibrary.remove(entry.id).then(load)
    })

    row.append(commandInput, fileLabel, anchorGrid, durationInput, volumeInput, testButton, deleteButton)
    mediaList.appendChild(row)
  }
}

function renderFiltered(): void {
  const query = searchInput.value.trim().toLowerCase()
  const entries = query
    ? cachedMedia.filter(
        (entry) => entry.command.toLowerCase().includes(query) || entry.fileName.toLowerCase().includes(query)
      )
    : cachedMedia
  renderMedia(entries)
}

async function load(): Promise<void> {
  cachedMedia = await window.mediaLibrary.list()
  renderFiltered()
}

searchInput.addEventListener('input', renderFiltered)

addButton.addEventListener('click', () => {
  void window.mediaLibrary
    .addFromDialog()
    .then((added) => {
      if (added.length > 0) return load()
      return undefined
    })
    .catch((error: unknown) => alertModal(`Could not add media: ${error instanceof Error ? error.message : String(error)}`))
})

copyUrlButton.addEventListener('click', () => {
  void navigator.clipboard.writeText(overlayUrlInput.value)
  copyUrlButton.textContent = 'Copied'
  window.setTimeout(() => (copyUrlButton.textContent = 'Copy'), 1200)
})

overlayPortInput.addEventListener('change', () => {
  void window.mediaLibrary.setPort(Number(overlayPortInput.value)).then(renderOverlayStatus)
})

window.mediaLibrary.onOverlayStatusChanged(renderOverlayStatus)
void window.mediaLibrary.getOverlayStatus().then(renderOverlayStatus)
void load()
