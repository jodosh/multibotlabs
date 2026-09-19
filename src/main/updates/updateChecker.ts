import { compare } from 'semver'

interface ReleaseInfo {
  version: string
  tagName: string
  releaseUrl: string
  publishedAt: string
  body: string
}

interface UpdateCheckResult {
  updateAvailable: boolean
  current: string
  latest: ReleaseInfo | null
}

interface GitHubRelease {
  tag_name: string
  name: string
  draft: boolean
  prerelease: boolean
  html_url: string
  published_at: string
  body: string
}

export class UpdateChecker {
  private readonly owner = 'jodosh'
  private readonly repo = 'multibotlabs'
  private readonly apiEndpoint = `https://api.github.com/repos/${this.owner}/${this.repo}/releases`

  constructor(private currentVersion: string) {}

  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const latest = await this.fetchLatestRelease()
      if (!latest) {
        return { updateAvailable: false, current: this.currentVersion, latest: null }
      }

      const isNewer = this.isNewerVersion(latest.version, this.currentVersion)
      return {
        updateAvailable: isNewer,
        current: this.currentVersion,
        latest: isNewer ? latest : null
      }
    } catch (error) {
      console.error('Failed to check for updates:', error instanceof Error ? error.message : error)
      return { updateAvailable: false, current: this.currentVersion, latest: null }
    }
  }

  private async fetchLatestRelease(): Promise<ReleaseInfo | null> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(`${this.apiEndpoint}?per_page=10`, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github.v3+json' }
      })

      if (!response.ok) {
        console.error(`GitHub API error: ${response.status}`)
        return null
      }

      const releases = (await response.json()) as GitHubRelease[]

      // GitHub returns releases ordered by creation time, not by version —
      // a hotfix tagged for an older line after a newer version already
      // shipped would otherwise be picked as "latest". Compare all stable
      // releases by semver and take the highest.
      const latestStable = releases
        .filter((r) => !r.draft && !r.prerelease)
        .reduce<GitHubRelease | null>((best, r) => {
          if (!best) return r
          try {
            return compare(this.parseVersion(r.tag_name), this.parseVersion(best.tag_name)) > 0 ? r : best
          } catch {
            return best
          }
        }, null)

      if (!latestStable) {
        console.warn('No stable releases found')
        return null
      }

      return {
        version: this.parseVersion(latestStable.tag_name),
        tagName: latestStable.tag_name,
        releaseUrl: latestStable.html_url,
        publishedAt: latestStable.published_at,
        body: latestStable.body || ''
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private parseVersion(tagName: string): string {
    // Convert "v1.2.3" to "1.2.3"
    return tagName.replace(/^v/, '')
  }

  private isNewerVersion(latest: string, current: string): boolean {
    try {
      return compare(latest, current) > 0
    } catch {
      console.warn(`Version comparison failed: ${latest} vs ${current}`)
      return false
    }
  }
}
