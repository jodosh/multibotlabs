import type { TtsSettingsApi } from '../../preload/ttsSettings'

declare global {
  interface Window {
    ttsSettings: TtsSettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const minBitsInput = document.getElementById('min-bits') as HTMLInputElement
const voiceSelect = document.getElementById('voice') as HTMLSelectElement
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

let currentVoiceName = ''

function populateVoices(selected: string): void {
  const voices = window.speechSynthesis.getVoices()
  voiceSelect.innerHTML = ''
  for (const voice of voices) {
    const option = document.createElement('option')
    option.value = voice.name
    option.textContent = `${voice.name} (${voice.lang})`
    voiceSelect.appendChild(option)
  }
  if (selected) voiceSelect.value = selected
}

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
  populateVoices(currentVoiceName)
  await refreshConflictWarning()
}

window.speechSynthesis.onvoiceschanged = () => populateVoices(voiceSelect.value || currentVoiceName)

minBitsInput.addEventListener('change', () => {
  // `Number(value) || 100` treated 0 as falsy and silently substituted 100
  // — a real bug, not just an edge case, since 0 is a legitimate "trigger
  // on any message" setting people actually want for free local testing.
  const parsed = Number(minBitsInput.value)
  const minimumBits = Number.isFinite(parsed) && parsed >= 0 ? parsed : 100
  pendingSave = window.ttsSettings.set({ minimumBits })
})

voiceSelect.addEventListener('change', () => {
  pendingSave = window.ttsSettings.set({ voiceName: voiceSelect.value })
})

void load()
