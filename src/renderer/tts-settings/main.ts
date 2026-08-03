import type { TtsSettingsApi } from '../../preload/ttsSettings'

declare global {
  interface Window {
    ttsSettings: TtsSettingsApi
  }
}

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const minBitsInput = document.getElementById('min-bits') as HTMLInputElement
const voiceSelect = document.getElementById('voice') as HTMLSelectElement

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

async function load(): Promise<void> {
  const settings = await window.ttsSettings.get()
  minBitsInput.value = String(settings.minimumBits)
  currentVoiceName = settings.voiceName
  populateVoices(currentVoiceName)
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
