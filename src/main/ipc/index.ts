import { registerCommonIpc } from './common'
import { registerAtMeIpc } from './atme'
import { registerCelebrationIpc } from './celebration'
import { registerCoinksIpc } from './coinks'
import { registerHypeTrainIpc } from './hypeTrain'
import { registerTtsIpc } from './tts'
import { registerMediaIpc } from './media'
import { registerLibraryIpc } from './library'
import { registerUpdatesIpc } from './updates'

// Registers every IPC handler, grouped one module per channel namespace.
//
// Order is irrelevant: ipcMain keys handlers by channel name, so nothing here
// depends on what ran before it. A duplicate channel throws loudly at startup
// rather than silently shadowing, which is what makes splitting these across
// files safe to do incrementally.
//
// This runs before modules are constructed and before any window exists, so
// handlers must reach both lazily — moduleRefs.<x>?. and the window registry's
// accessors — never by capturing a value at registration time.
export function registerIpcHandlers(): void {
  registerCommonIpc()
  registerAtMeIpc()
  registerCelebrationIpc()
  registerCoinksIpc()
  registerHypeTrainIpc()
  registerTtsIpc()
  registerMediaIpc()
  registerLibraryIpc()
  registerUpdatesIpc()
}
