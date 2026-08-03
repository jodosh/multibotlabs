// window.prompt() throws "prompt() is not supported" on at least some
// Linux/Electron/GTK combinations (confirmed via CDP against this app),
// and window.alert()/confirm() block the entire renderer thread until
// dismissed. This is a themed in-page replacement for both, styled via
// modal.css.

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  document.body.appendChild(overlay)
  return overlay
}

export function promptModal(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = createOverlay()
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-title"></p>
        <input class="modal-input" type="text" />
        <div class="modal-actions">
          <button class="modal-cancel" type="button">Cancel</button>
          <button class="modal-ok" type="button">OK</button>
        </div>
      </div>
    `
    const titleEl = overlay.querySelector('.modal-title') as HTMLParagraphElement
    const input = overlay.querySelector('.modal-input') as HTMLInputElement
    const cancelButton = overlay.querySelector('.modal-cancel') as HTMLButtonElement
    const okButton = overlay.querySelector('.modal-ok') as HTMLButtonElement

    titleEl.textContent = title

    const close = (value: string | null): void => {
      overlay.remove()
      resolve(value)
    }

    okButton.addEventListener('click', () => close(input.value.trim() || null))
    cancelButton.addEventListener('click', () => close(null))
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(input.value.trim() || null)
      if (event.key === 'Escape') close(null)
    })

    input.focus()
  })
}

export function alertModal(message: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = createOverlay()
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-title"></p>
        <div class="modal-actions">
          <button class="modal-ok" type="button">OK</button>
        </div>
      </div>
    `
    const titleEl = overlay.querySelector('.modal-title') as HTMLParagraphElement
    const okButton = overlay.querySelector('.modal-ok') as HTMLButtonElement
    titleEl.textContent = message

    const close = (): void => {
      overlay.remove()
      resolve()
    }

    okButton.addEventListener('click', close)
    okButton.focus()
  })
}
