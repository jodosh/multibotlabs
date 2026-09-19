import { ipcMain } from 'electron'
import { collectDiagnostics } from '../diagnostics/collectDiagnostics'

export function registerDiagnosticsIpc(): void {
  // Collected on demand, never on a timer and never sent anywhere. The renderer
  // formats it into markdown for the user to read, edit and copy — see
  // docs/PRIVACY.md.
  ipcMain.handle('diagnostics:get', () => collectDiagnostics())
}
