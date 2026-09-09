import type {
  AddSoundResultDto,
  LibraryApi,
  SoundTriggerDto,
  SoundTriggerKind,
  TextReplyDto
} from '../../preload/library'
import { promptModal, alertModal } from '../assets/modal'

declare global {
  interface Window {
    library: LibraryApi
  }
}

const params = new URLSearchParams(location.search)
const kind: SoundTriggerKind = params.get('kind') === 'emote' ? 'emote' : 'command'

const title = document.getElementById('title') as HTMLSpanElement
const closeButton = document.getElementById('close-button') as HTMLButtonElement
const allowUserListRow = document.getElementById('allow-user-list-row') as HTMLLabelElement
const tabs = document.getElementById('tabs') as HTMLDivElement
const tabSounds = document.getElementById('tab-sounds') as HTMLButtonElement
const tabText = document.getElementById('tab-text') as HTMLButtonElement
const tabIntros = document.getElementById('tab-intros') as HTMLButtonElement
const soundsPanel = document.getElementById('sounds-panel') as HTMLElement
const textPanel = document.getElementById('text-panel') as HTMLElement
const introsPanel = document.getElementById('intros-panel') as HTMLElement
const soundList = document.getElementById('sound-list') as HTMLUListElement
const textList = document.getElementById('text-list') as HTMLUListElement
const introList = document.getElementById('intro-list') as HTMLUListElement
const addSoundButton = document.getElementById('add-sound-button') as HTMLButtonElement
const addTextButton = document.getElementById('add-text-button') as HTMLButtonElement
const addIntroButton = document.getElementById('add-intro-button') as HTMLButtonElement
const allowUserListInput = document.getElementById('allow-user-list') as HTMLInputElement
const enableIntrosInput = document.getElementById('enable-intros') as HTMLInputElement
const soundSearchInput = document.getElementById('sound-search') as HTMLInputElement
const textSearchInput = document.getElementById('text-search') as HTMLInputElement
const introSearchInput = document.getElementById('intro-search') as HTMLInputElement

// Tracked so the Sounds tab can warn about a shadowed "!intro" command even
// when its list was rendered before the toggle changed on a different tab.
let userIntrosEnabledState = false

// Tracked so the Text Replies tab can warn about a shadowed "!commands" reply
// even when its list was rendered before the checkbox above the tabs changed.
let allowUserListState = false
let ttsCommandEnabledState = false

// Full lists from the main process, cached so the filter boxes can re-render
// instantly on every keystroke instead of round-tripping over IPC each time.
let cachedSounds: SoundTriggerDto[] = []
let cachedTextReplies: TextReplyDto[] = []
let cachedIntros: SoundTriggerDto[] = []

title.textContent = kind === 'command' ? 'Command Sounds' : 'Emote Sounds'

closeButton.addEventListener('click', () => {
  window.library.close()
})

if (kind === 'emote') {
  tabs.hidden = true
  textPanel.hidden = true
  introsPanel.hidden = true
  soundsPanel.hidden = false
}

type Tab = 'sounds' | 'text' | 'intros'

function selectTab(target: Tab): void {
  soundsPanel.hidden = target !== 'sounds'
  textPanel.hidden = target !== 'text'
  introsPanel.hidden = target !== 'intros'
  tabSounds.classList.toggle('active', target === 'sounds')
  tabText.classList.toggle('active', target === 'text')
  tabIntros.classList.toggle('active', target === 'intros')
}

tabSounds.addEventListener('click', () => selectTab('sounds'))
tabText.addEventListener('click', () => selectTab('text'))
tabIntros.addEventListener('click', () => selectTab('intros'))

function normalizeCommandText(text: string): string {
  return text.startsWith('!') ? text.slice(1) : text
}

// Shared by the Sounds tab and the User Intros tab — both are the same
// SoundTriggerDto shape, just a different `kind` and a different meaning
// for `trigger` (a !command/emote name vs. a Twitch username). `warningFor`
// lets a caller flag specific rows (e.g. a sound command shadowed by !intro)
// without the two tabs needing separate render functions.
function renderSoundList(
  container: HTMLUListElement,
  sounds: SoundTriggerDto[],
  onChanged: () => void,
  warningFor?: (sound: SoundTriggerDto) => string | null
): void {
  container.innerHTML = ''
  for (const sound of sounds) {
    const item = document.createElement('li')
    const warning = warningFor?.(sound) ?? null
    item.className = warning ? 'row warning' : 'row'
    if (warning) item.title = warning

    const triggerInput = document.createElement('input')
    triggerInput.type = 'text'
    triggerInput.value = sound.trigger
    triggerInput.addEventListener('change', () => {
      void window.library.updateSound(sound.id, { trigger: triggerInput.value })
    })

    const fileLabel = document.createElement('span')
    fileLabel.className = 'filename'
    fileLabel.textContent = sound.fileName
    fileLabel.title = sound.fileName

    const volumeInput = document.createElement('input')
    volumeInput.type = 'range'
    volumeInput.min = '0'
    volumeInput.max = '1'
    volumeInput.step = '0.01'
    volumeInput.value = String(sound.volume)
    volumeInput.addEventListener('change', () => {
      void window.library.updateSound(sound.id, { volume: Number(volumeInput.value) })
    })

    const playButton = document.createElement('button')
    playButton.textContent = 'Play'
    playButton.addEventListener('click', () => {
      window.library.previewSound(sound.filePath, Number(volumeInput.value))
    })

    const deleteButton = document.createElement('button')
    deleteButton.textContent = 'Delete'
    deleteButton.className = 'danger'
    deleteButton.addEventListener('click', () => {
      void window.library.removeSound(sound.id).then(onChanged)
    })

    item.append(triggerInput, fileLabel, volumeInput, playButton, deleteButton)
    if (warning) {
      const badge = document.createElement('span')
      badge.className = 'warning-badge'
      badge.textContent = '⚠ never triggers'
      badge.title = warning
      item.appendChild(badge)
    }
    container.appendChild(item)
  }
}

function renderTextReplies(replies: TextReplyDto[], warningFor?: (reply: TextReplyDto) => string | null): void {
  textList.innerHTML = ''
  for (const reply of replies) {
    const item = document.createElement('li')
    const warning = warningFor?.(reply) ?? null
    item.className = warning ? 'row warning' : 'row'
    if (warning) item.title = warning

    const commandInput = document.createElement('input')
    commandInput.type = 'text'
    commandInput.value = reply.command
    commandInput.addEventListener('change', () => {
      void window.library.updateTextReply(reply.id, { command: commandInput.value })
    })

    const replyInput = document.createElement('input')
    replyInput.type = 'text'
    replyInput.value = reply.reply
    replyInput.className = 'reply-text'
    replyInput.addEventListener('change', () => {
      void window.library.updateTextReply(reply.id, { reply: replyInput.value })
    })

    const deleteButton = document.createElement('button')
    deleteButton.textContent = 'Delete'
    deleteButton.className = 'danger'
    deleteButton.addEventListener('click', () => {
      void window.library.removeTextReply(reply.id).then(loadTextReplies)
    })

    item.append(commandInput, replyInput, deleteButton)
    if (warning) {
      const badge = document.createElement('span')
      badge.className = 'warning-badge'
      badge.textContent = '⚠ never triggers'
      badge.title = warning
      item.appendChild(badge)
    }
    textList.appendChild(item)
  }
}

function soundCommandWarning(sound: SoundTriggerDto): string | null {
  if (kind !== 'command') return null
  const trigger = normalizeCommandText(sound.trigger).toLowerCase()

  if (userIntrosEnabledState && trigger === 'intro') {
    return 'This command will never trigger — "!intro" is reserved by User Intros, which is enabled on the User Intros tab.'
  }

  if (ttsCommandEnabledState && trigger === 'tts') {
    return 'This command will never trigger — "!tts" is reserved by Text-To-Speech while free TTS is on (right-click the Text-To-Speech tile to change it).'
  }

  return null
}

// Unlike a sound command, a text reply named "!commands" IS shadowed — the
// built-in command list is sent from the same slot a text reply would use,
// and commandModule.ts skips the text-reply lookup entirely when it fires.
function textReplyWarning(reply: TextReplyDto): string | null {
  const command = normalizeCommandText(reply.command).toLowerCase()

  if (allowUserListState && command === 'commands') {
    return 'This text reply will never trigger — "!commands" is reserved for the built-in command list, enabled above the tabs.'
  }

  if (ttsCommandEnabledState && command === 'tts') {
    return 'This text reply will never trigger — "!tts" is reserved by Text-To-Speech while free TTS is on (right-click the Text-To-Speech tile to change it).'
  }

  return null
}

function matchesFilter(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase())
}

function renderFilteredSounds(): void {
  const query = soundSearchInput.value
  const sounds = query ? cachedSounds.filter((sound) => matchesFilter(sound.trigger, query)) : cachedSounds
  renderSoundList(soundList, sounds, loadSounds, soundCommandWarning)
}

function renderFilteredTextReplies(): void {
  const query = textSearchInput.value
  const replies = query
    ? cachedTextReplies.filter((reply) => matchesFilter(reply.command, query) || matchesFilter(reply.reply, query))
    : cachedTextReplies
  renderTextReplies(replies, textReplyWarning)
}

function renderFilteredIntros(): void {
  const query = introSearchInput.value
  const intros = query ? cachedIntros.filter((sound) => matchesFilter(sound.trigger, query)) : cachedIntros
  renderSoundList(introList, intros, loadIntros)
}

async function loadSounds(): Promise<void> {
  cachedSounds = await window.library.listSounds(kind)
  renderFilteredSounds()
}

async function loadTextReplies(): Promise<void> {
  cachedTextReplies = await window.library.listTextReplies()
  renderFilteredTextReplies()
}

async function loadIntros(): Promise<void> {
  cachedIntros = await window.library.listSounds('user-intro')
  renderFilteredIntros()
}

soundSearchInput.addEventListener('input', renderFilteredSounds)
textSearchInput.addEventListener('input', renderFilteredTextReplies)
introSearchInput.addEventListener('input', renderFilteredIntros)

// The sound is already added at this point — this is a heads-up, not a
// failure. Said plainly because the effect is audible: an un-normalized sound
// can be noticeably louder or quieter than the rest of the library, and the
// row's volume slider is the fix.
async function warnIfNotNormalized(result: AddSoundResultDto): Promise<void> {
  if (result.normalized) return
  await alertModal(
    `"${result.sound.trigger}" was added, but its volume could not be matched to your other sounds ` +
      '— ffmpeg is missing from this install, so the file was added as-is. ' +
      "It may play louder or quieter than the rest; use the row's volume slider to adjust it, " +
      'and reinstalling MultiBot should restore the matching.'
  )
}

async function addSound(): Promise<void> {
  const promptLabel = kind === 'command' ? 'Command name (e.g. !hello):' : 'Emote name (e.g. PogChamp):'
  const trigger = await promptModal(promptLabel)
  if (!trigger) return

  try {
    const result = await window.library.addSoundFromDialog(kind, trigger, 0.5)
    if (!result) return
    await loadSounds()
    await warnIfNotNormalized(result)
  } catch (error) {
    await alertModal(`Could not add sound: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function addTextReply(): Promise<void> {
  const command = await promptModal('Command (e.g. !discord):')
  if (!command) return
  const reply = await promptModal('Reply text:')
  if (!reply) return

  try {
    await window.library.addTextReply(command, reply)
    await loadTextReplies()
  } catch (error) {
    await alertModal(`Could not add text reply: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function addIntro(): Promise<void> {
  const username = await promptModal('Twitch username:')
  if (!username) return

  try {
    const result = await window.library.addSoundFromDialog('user-intro', username, 0.5)
    if (!result) return
    await loadIntros()
    await warnIfNotNormalized(result)
  } catch (error) {
    await alertModal(`Could not add intro: ${error instanceof Error ? error.message : String(error)}`)
  }
}

addSoundButton.addEventListener('click', () => void addSound())
addTextButton.addEventListener('click', () => void addTextReply())
addIntroButton.addEventListener('click', () => void addIntro())

if (kind === 'command') {
  allowUserListRow.hidden = false

  void window.library.getAllowUserList().then((value) => {
    allowUserListInput.checked = value
    allowUserListState = value
    // loadTextReplies() below may resolve before or after this — whichever
    // finishes last renders with the correct final state either way.
    renderFilteredTextReplies()
  })
  allowUserListInput.addEventListener('change', () => {
    allowUserListState = allowUserListInput.checked
    void window.library.setAllowUserList(allowUserListState)
    renderFilteredTextReplies()
  })
  void loadTextReplies()

  // Read once on open. The TTS window can flip this while the Library is
  // already up, so it's a snapshot — same as the free-TTS window's own
  // conflict warning, which likewise re-checks only when it opens.
  void window.library.getTtsCommandEnabled().then((value) => {
    ttsCommandEnabledState = value
    renderFilteredSounds()
    renderFilteredTextReplies()
  })

  void window.library.getUserIntrosEnabled().then((value) => {
    enableIntrosInput.checked = value
    userIntrosEnabledState = value
    renderFilteredSounds()
  })
  enableIntrosInput.addEventListener('change', () => {
    userIntrosEnabledState = enableIntrosInput.checked
    void window.library.setUserIntrosEnabled(userIntrosEnabledState)
    // The Sounds tab may already be rendered (and hidden) with stale
    // warning state — refresh it so switching back shows the right thing.
    renderFilteredSounds()
  })
  void loadIntros()
}

void loadSounds()
