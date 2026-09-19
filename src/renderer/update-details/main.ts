import type { UpdateDetailsApi } from '../../preload/updateDetails'

declare global {
  interface Window {
    updateDetails: UpdateDetailsApi
  }
}

// The download page, not the GitHub release page — this is where a streamer
// actually gets the new installer, GitHub's release page is just where the
// version-check data comes from.
const DOWNLOAD_URL = 'https://labs.streambotty.com/#download'

const closeButton = document.getElementById('close-button') as HTMLButtonElement
const versionLine = document.getElementById('version-line') as HTMLParagraphElement
const releaseNotes = document.getElementById('release-notes') as HTMLPreElement
const dismissButton = document.getElementById('dismiss-button') as HTMLButtonElement
const okButton = document.getElementById('ok-button') as HTMLButtonElement
const downloadButton = document.getElementById('download-button') as HTMLButtonElement

closeButton.addEventListener('click', () => {
  window.updateDetails.close()
})

// Deliberately identical to the titlebar ✕: acknowledge and close, changing
// nothing. The badge stays on the HUD and this version will be offered again
// next launch — that's what separates it from the dismiss button below, which
// records the version as one never to mention again.
okButton.addEventListener('click', () => {
  window.updateDetails.close()
})

async function load(): Promise<void> {
  const update = await window.updateDetails.get()
  if (!update) {
    // Only reachable if the badge was clicked in the instant between the
    // user dismissing elsewhere and this window finishing its own load.
    window.updateDetails.close()
    return
  }

  versionLine.textContent = `Version ${update.latest} is available — you have ${update.current}.`
  releaseNotes.textContent = update.body || 'No release notes provided.'

  dismissButton.addEventListener('click', () => {
    window.updateDetails.dismiss(update.latest)
    window.updateDetails.close()
  })

  downloadButton.addEventListener('click', () => {
    window.updateDetails.openUrl(DOWNLOAD_URL)
  })
}

void load()
