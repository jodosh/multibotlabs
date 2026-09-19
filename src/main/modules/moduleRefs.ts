import type { AtMeModule } from './atMeModule'
import type { CoinksModule } from './coinksModule'
import type { HypeTrainModule } from './hypeTrainModule'

// Direct handles on the three bot modules that expose behavior beyond
// IBotModule's start/stop — queue inspection, game state, simulation — which
// IPC handlers and the overlay callbacks need to reach.
//
// Small as it is, this is what keeps the decomposition acyclic. The overlay
// service constructs OverlayServer, and one of its callbacks has to call
// coinksModule.finishGame() when a game result arrives; module registration in
// turn depends on the overlay service for its broadcast callbacks. Routing that
// one reference through a third module nobody else depends on breaks the cycle
// that would otherwise run through the entry point.
//
// Every field stays optional and every read stays optional-chained: handlers are
// registered before registerModules() runs, so these are genuinely undefined for
// part of startup. That is the existing behavior, preserved deliberately — not
// an oversight to tighten up later.
interface ModuleRefs {
  atMe?: AtMeModule
  coinks?: CoinksModule
  hypeTrain?: HypeTrainModule
}

export const moduleRefs: ModuleRefs = {}
