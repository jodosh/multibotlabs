import type { AtMeQueueApi, AtMeQueueItemDto } from '../../preload/atMeQueue'

declare global {
  interface Window {
    atMeQueue: AtMeQueueApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const matchMentionsInput = document.getElementById('match-mentions') as HTMLInputElement
const matchHighlightsInput = document.getElementById('match-highlights') as HTMLInputElement
const emptyState = document.getElementById('empty-state') as HTMLParagraphElement
const queueList = document.getElementById('queue-list') as HTMLUListElement
const togglesSection = document.getElementById('toggles') as HTMLDivElement
const togglesCollapseButton = document.getElementById('toggles-collapse-button') as HTMLButtonElement
const togglesCollapseIcon = document.getElementById('toggles-collapse-icon') as HTMLSpanElement

closeButton.addEventListener('click', () => {
  window.atMeQueue.close()
})

const REASON_LABELS: Record<AtMeQueueItemDto['reasons'][number], string> = {
  mention: '@mention',
  highlight: 'highlighted'
}

function render(queue: AtMeQueueItemDto[]): void {
  emptyState.hidden = queue.length > 0
  queueList.innerHTML = ''

  for (const item of queue) {
    const row = document.createElement('li')
    row.className = 'row'

    const info = document.createElement('div')
    info.className = 'info'

    const header = document.createElement('div')
    header.className = 'header'

    const username = document.createElement('span')
    username.className = 'username'
    username.textContent = item.username

    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = new Date(item.timestamp).toLocaleTimeString()

    header.append(username, time)
    for (const reason of item.reasons) {
      const badge = document.createElement('span')
      badge.className = `badge ${reason}`
      badge.textContent = REASON_LABELS[reason]
      header.appendChild(badge)
    }

    const text = document.createElement('div')
    text.className = 'text'
    text.textContent = item.text

    info.append(header, text)

    const dismissButton = document.createElement('button')
    dismissButton.className = 'dismiss'
    dismissButton.textContent = '✕'
    dismissButton.title = 'Dismiss'
    dismissButton.addEventListener('click', () => {
      void window.atMeQueue.dismiss(item.id)
    })

    row.append(info, dismissButton)
    queueList.appendChild(row)
  }
}

matchMentionsInput.addEventListener('change', () => {
  void window.atMeQueue.setSettings({ matchMentions: matchMentionsInput.checked })
})
matchHighlightsInput.addEventListener('change', () => {
  void window.atMeQueue.setSettings({ matchHighlights: matchHighlightsInput.checked })
})

function setTogglesCollapsed(collapsed: boolean): void {
  togglesSection.hidden = collapsed
  togglesCollapseIcon.textContent = collapsed ? '▸' : '▾'
}

// Collapsed by default once set — these are "set once, forget about them"
// toggles, not something a streamer needs open every session, so the
// collapsed state persists the same way the toggles themselves do.
togglesCollapseButton.addEventListener('click', () => {
  const collapsed = !togglesSection.hidden
  setTogglesCollapsed(collapsed)
  void window.atMeQueue.setSettings({ togglesCollapsed: collapsed })
})

void window.atMeQueue.getSettings().then((settings) => {
  matchMentionsInput.checked = settings.matchMentions
  matchHighlightsInput.checked = settings.matchHighlights
  setTogglesCollapsed(settings.togglesCollapsed)
})

window.atMeQueue.onChanged(render)
void window.atMeQueue.list().then(render)
