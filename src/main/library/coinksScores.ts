import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface CoinksScore {
  player: string
  score: number
  at: string
}

/**
 * Append-only local score log for the coin game.
 *
 * Replaces the old app's pair of sinks: a %APPDATA%\MultiBot\playersData.json
 * file *and* a POST of every result to streambotty.com. Only the local half is
 * carried over — a hardcoded endpoint for an unverifiable service has no place
 * in a public repo, and viewer names shouldn't leave the machine by default.
 */
export class CoinksScores {
  private readonly filePath: string
  private scores: CoinksScore[] = []
  private loaded = false

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'coinks-scores.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf-8'))
      this.scores = Array.isArray(parsed) ? (parsed as CoinksScore[]) : []
    } catch {
      this.scores = []
    }
    this.loaded = true
  }

  list(): CoinksScore[] {
    return [...this.scores]
  }

  /** Highest score first; ties keep the earlier entry, so a record stands. */
  leaderboard(limit = 10): CoinksScore[] {
    return [...this.scores].sort((a, b) => b.score - a.score).slice(0, limit)
  }

  async record(player: string, score: number): Promise<void> {
    this.scores.push({ player, score, at: new Date().toISOString() })
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(this.scores, null, 2), 'utf-8')
  }
}
