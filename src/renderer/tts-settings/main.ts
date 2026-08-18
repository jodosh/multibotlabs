import type { TtsSettingsApi } from '../../preload/ttsSettings'

declare global {
  interface Window {
    ttsSettings: TtsSettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const minBitsInput = document.getElementById('min-bits') as HTMLInputElement
const voiceSelect = document.getElementById('voice') as HTMLSelectElement
const voiceSearchInput = document.getElementById('voice-search') as HTMLInputElement
const voiceCountNote = document.getElementById('voice-count') as HTMLParagraphElement
const testVoiceButton = document.getElementById('test-voice-button') as HTMLButtonElement
const freeCommandInput = document.getElementById('free-command') as HTMLInputElement
const freeCommandConflict = document.getElementById('free-command-conflict') as HTMLParagraphElement

// Tracks the most recent save so the close button can wait for it — closing
// the window tears down its webContents, which can race an in-flight
// ipcRenderer.invoke() from a 'change' handler that fired moments earlier
// (e.g. clicking Close right after editing a field, before it's had a
// chance to actually reach main).
let pendingSave: Promise<void> = Promise.resolve()

closeButton.addEventListener('click', () => {
  void pendingSave.then(() => window.ttsSettings.close())
})

// The saved voice, kept as the source of truth independently of the <select>
// — a filter can hide the selected option, and the element's own value would
// be lost the moment that happens.
let currentVoiceName = ''

// Linux reports espeak-ng's full language x variant matrix — 14,805 voices on
// a stock Arch install, where Windows and macOS report a few dozen. The cap is
// mostly about the list being navigable at all; the render cost is secondary
// but real, since re-rendering on every keystroke means paying it repeatedly
// (measured on that install: ~44ms for all 14,805 options against ~6ms for
// 200). Filtering the array is cheap — building DOM nodes is what costs.
const MAX_RENDERED_VOICES = 200

let cachedVoices: SpeechSynthesisVoice[] = []

function matchesVoiceFilter(voice: SpeechSynthesisVoice, query: string): boolean {
  if (!query) return true
  const needle = query.trim().toLowerCase()
  return voice.name.toLowerCase().includes(needle) || voice.lang.toLowerCase().includes(needle)
}

function addVoiceOption(voice: SpeechSynthesisVoice): void {
  const option = document.createElement('option')
  option.value = voice.name
  option.textContent = `${voice.name} (${voice.lang})`
  voiceSelect.appendChild(option)
}

function renderVoices(): void {
  const query = voiceSearchInput.value
  const matches = cachedVoices.filter((voice) => matchesVoiceFilter(voice, query))
  const shown = matches.slice(0, MAX_RENDERED_VOICES)

  voiceSelect.innerHTML = ''

  // The selected voice is pinned into the list even when the filter excludes
  // it, so narrowing the search can never silently drop the setting: without
  // this the <select> falls back to its first option, and the next save would
  // quietly overwrite a voice the streamer had already chosen.
  const selected = cachedVoices.find((voice) => voice.name === currentVoiceName)
  if (selected && !shown.some((voice) => voice.name === selected.name)) {
    addVoiceOption(selected)
  }

  for (const voice of shown) addVoiceOption(voice)

  if (currentVoiceName) voiceSelect.value = currentVoiceName

  if (cachedVoices.length === 0) {
    // Expected on Linux without speech-dispatcher installed — see README.
    voiceCountNote.textContent = 'No voices available on this system.'
  } else if (matches.length === 0) {
    voiceCountNote.textContent = `No voices match "${query.trim()}".`
  } else if (matches.length > shown.length) {
    voiceCountNote.textContent = `Showing ${shown.length} of ${matches.length} matches — keep typing to narrow.`
  } else {
    voiceCountNote.textContent = `${matches.length} voice${matches.length === 1 ? '' : 's'}.`
  }
}

function populateVoices(): void {
  cachedVoices = window.speechSynthesis.getVoices()
  renderVoices()
}

voiceSearchInput.addEventListener('input', renderVoices)

// Spoken by the Test button. Deliberately mentions the bot rather than being
// lorem filler, so it's obvious which app produced the audio when several
// voices are auditioned back to back.
const TEST_PHRASE = 'MultiBot text to speech is working.'

testVoiceButton.addEventListener('click', () => {
  // Reads the live <select> value rather than saved settings, so a voice can
  // be auditioned before it's committed — and so the test is unaffected by
  // whether the save from the 'change' handler has reached main yet.
  const selectedName = voiceSelect.value
  const utterance = new SpeechSynthesisUtterance(TEST_PHRASE)
  const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.name === selectedName)
  if (voice) utterance.voice = voice

  // Without this, clicking Test repeatedly queues the samples up to play one
  // after another instead of replacing the previous one.
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
})

async function refreshConflictWarning(): Promise<void> {
  if (!freeCommandInput.checked) {
    freeCommandConflict.hidden = true
    return
  }

  const { sounds, textReplies } = await window.ttsSettings.getCommandConflicts()
  const parts: string[] = []
  if (sounds > 0) parts.push(`${sounds} sound command${sounds === 1 ? '' : 's'}`)
  if (textReplies > 0) parts.push(`${textReplies} text repl${textReplies === 1 ? 'y' : 'ies'}`)

  if (parts.length === 0) {
    freeCommandConflict.hidden = true
    return
  }

  freeCommandConflict.textContent =
    `Command bot has ${parts.join(' and ')} named "!tts". ` +
    'While free TTS is on it answers !tts instead, and those entries will never trigger.'
  freeCommandConflict.hidden = false
}

freeCommandInput.addEventListener('change', () => {
  pendingSave = window.ttsSettings.set({ freeCommandEnabled: freeCommandInput.checked })
  void refreshConflictWarning()
})

async function load(): Promise<void> {
  const settings = await window.ttsSettings.get()
  minBitsInput.value = String(settings.minimumBits)
  freeCommandInput.checked = settings.freeCommandEnabled
  currentVoiceName = settings.voiceName
  populateVoices()
  await refreshConflictWarning()
}

window.speechSynthesis.onvoiceschanged = () => populateVoices()

minBitsInput.addEventListener('change', () => {
  // `Number(value) || 100` treated 0 as falsy and silently substituted 100
  // — a real bug, not just an edge case, since 0 is a legitimate "trigger
  // on any message" setting people actually want for free local testing.
  const parsed = Number(minBitsInput.value)
  const minimumBits = Number.isFinite(parsed) && parsed >= 0 ? parsed : 100
  pendingSave = window.ttsSettings.set({ minimumBits })
})

voiceSelect.addEventListener('change', () => {
  currentVoiceName = voiceSelect.value
  pendingSave = window.ttsSettings.set({ voiceName: currentVoiceName })
})

void load()
