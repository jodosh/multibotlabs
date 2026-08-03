import type { IBotModule } from './types'

export class ModuleManager {
  private readonly modules = new Map<string, IBotModule>()

  register(module: IBotModule): void {
    if (!this.modules.has(module.id)) {
      this.modules.set(module.id, module)
    }
  }

  list(): IBotModule[] {
    return [...this.modules.values()]
  }

  get(id: string): IBotModule | undefined {
    return this.modules.get(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const module = this.modules.get(id)
    if (!module) return

    module.enabled = enabled
    if (enabled) {
      await module.start()
    } else {
      await module.stop()
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.list().map((module) => module.stop()))
  }
}
