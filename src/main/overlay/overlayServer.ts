import http from 'node:http'
import net from 'node:net'
import dns from 'node:dns'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { OverlayEvent, CoinksResult } from './types'

export type OverlayServerStatus = 'stopped' | 'running' | 'error'

export interface MediaSource {
  filePath: string
}

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const SSE_HEARTBEAT_MS = 20_000
const MAX_POST_BYTES = 64 * 1024

/**
 * Serves the OBS browser-source overlay page over local HTTP and pushes
 * events to it via SSE.
 *
 * Replaces the old app's WPF -> Unity transport (raw JSON over a fresh TCP
 * connection per message). SSE is deliberately one-directional: the browser's
 * EventSource owns framing and reconnection, so the two worst failure modes
 * of the old link — partial/concatenated messages and a dead overlay that
 * nobody noticed — can't recur here.
 *
 * Bound to 127.0.0.1 only. Nothing here should ever be reachable off-machine.
 */
export class OverlayServer {
  private server: http.Server | undefined
  private _status: OverlayServerStatus = 'stopped'
  private _port = 0
  private _lastError: string | undefined
  // Value is the ?feature= the page identified itself as, so a manager window
  // can report whether *its* overlay is connected rather than any overlay.
  private readonly clients = new Map<http.ServerResponse, string>()
  private heartbeat: NodeJS.Timeout | undefined
  private devHost: string | undefined

  constructor(
    private readonly rendererRoot: () => string,
    private readonly resolveMedia: (id: string) => MediaSource | undefined,
    private readonly onClientsChanged: (count: number) => void,
    private readonly onCoinksResult: (result: CoinksResult) => void = () => {},
    private readonly gameAssetsRoot: () => string = () => ''
  ) {}

  get status(): OverlayServerStatus {
    return this._status
  }

  get port(): number {
    return this._port
  }

  get lastError(): string | undefined {
    return this._lastError
  }

  clientCount(feature?: string): number {
    if (!feature) return this.clients.size
    let count = 0
    for (const value of this.clients.values()) if (value === feature) count += 1
    return count
  }

  overlayUrl(page = 'overlay'): string {
    return `http://127.0.0.1:${this._port}/${page}/`
  }

  async start(port: number): Promise<void> {
    if (this.server) await this.stop()

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    // Vite's HMR runs over a WebSocket; without forwarding the upgrade the
    // dev overlay page loads but sits in a reconnect loop.
    server.on('upgrade', (req, socket, head) => this.proxyUpgrade(req, socket as net.Socket, head))

    return new Promise((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        this._status = 'error'
        this._lastError =
          error.code === 'EADDRINUSE'
            ? `Port ${port} is already in use — change it in the Media window.`
            : error.message
        console.error('[overlay] server failed to start:', this._lastError)
        this.server = undefined
        resolve()
      })

      server.listen(port, '127.0.0.1', () => {
        this.server = server
        this._port = port
        this._status = 'running'
        this._lastError = undefined
        this.heartbeat = setInterval(() => {
          this.pruneDeadClients()
          for (const client of this.clients.keys()) client.write(': ping\n\n')
        }, SSE_HEARTBEAT_MS)
        console.log(`[overlay] listening on ${this.overlayUrl()}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
    for (const client of this.clients.keys()) client.end()
    this.clients.clear()

    const server = this.server
    this.server = undefined
    this._status = 'stopped'
    if (!server) return

    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  broadcast(event: OverlayEvent): void {
    this.pruneDeadClients()
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of this.clients.keys()) client.write(payload)
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this._port}`)

    if (url.pathname === '/events') return this.handleEvents(req, res, url.searchParams.get('feature') ?? '')
    if (url.pathname === '/coinks/result' && req.method === 'POST') return this.handleCoinksResult(req, res)
    if (url.pathname.startsWith('/media/')) return this.handleMedia(url.pathname.slice('/media/'.length), req, res)
    if (url.pathname.startsWith('/game/')) return this.serveGameAsset(url.pathname.slice('/game/'.length), res)

    // Everything else is the overlay page and its bundled assets. In dev that
    // lives on Vite's server, so proxy rather than reading from out/renderer
    // (which `npm run dev` never writes).
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (devServerUrl) return this.proxyToDevServer(req, res, devServerUrl)
    return this.serveStatic(url.pathname, res)
  }

  private handleEvents(req: http.IncomingMessage, res: http.ServerResponse, feature: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('retry: 2000\n\n')

    this.clients.set(res, feature)
    this.onClientsChanged(this.clients.size)

    // Listen on all three: `req.on('close')` alone misses cases where the
    // browser drops an SSE connection without a clean teardown (observed when
    // a browser source reloads), which otherwise leaks a client per refresh
    // and leaves broadcast() writing to dead sockets for the rest of the stream.
    const cleanup = (): void => {
      if (!this.clients.delete(res)) return
      this.onClientsChanged(this.clients.size)
    }
    res.on('close', cleanup)
    res.on('error', cleanup)
    req.on('close', cleanup)
  }

  // The overlay's only way to talk back. Deliberately a plain stateless POST
  // rather than a second live channel: a game result is safe to retry and
  // can't desync, unlike the stateful bidirectional link the old WPF/Unity
  // pair used.
  private async handleCoinksResult(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_POST_BYTES) {
        res.writeHead(413).end('Payload too large')
        req.destroy()
        return
      }
      chunks.push(chunk as Buffer)
    }

    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Partial<CoinksResult>
      if (typeof body.player !== 'string' || typeof body.score !== 'number' || !Number.isFinite(body.score)) {
        res.writeHead(400).end('Expected { player: string, score: number }')
        return
      }
      this.onCoinksResult({ player: body.player, score: Math.round(body.score) })
      res.writeHead(204).end()
    } catch {
      res.writeHead(400).end('Invalid JSON')
    }
  }

  // The coin game's sprites and sounds, served from resources/ rather than
  // bundled into the page so the overlay stays a plain static build.
  private async serveGameAsset(name: string, res: http.ServerResponse): Promise<void> {
    const root = path.resolve(this.gameAssetsRoot())
    const resolved = path.resolve(root, decodeURIComponent(name))
    if (!resolved.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    try {
      const body = await fs.readFile(resolved)
      const contentType = MEDIA_MIME_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream'
      res
        .writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
        .end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  }

  /** Drops clients whose socket has gone away without notifying us. */
  private pruneDeadClients(): void {
    let dropped = false
    for (const client of [...this.clients.keys()]) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client)
        dropped = true
      }
    }
    if (dropped) this.onClientsChanged(this.clients.size)
  }

  // Serves byte ranges, not just whole files. A <video> element expects
  // Accept-Ranges/Content-Length and will issue Range requests; answering
  // every one with a chunked 200 leaves the media pipeline unable to seek and,
  // in stricter clients than Electron's, able to decode the first frame but
  // not start playback.
  private async handleMedia(id: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const media = this.resolveMedia(decodeURIComponent(id))
    if (!media) {
      res.writeHead(404).end('Not found')
      return
    }

    let size: number
    try {
      size = (await fs.stat(media.filePath)).size
    } catch {
      res.writeHead(404).end('Media file missing')
      return
    }

    const contentType = MEDIA_MIME_TYPES[path.extname(media.filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')

    let start = 0
    let end = size - 1
    if (range) {
      const [, rawStart, rawEnd] = range
      if (rawStart === '' && rawEnd !== '') {
        start = Math.max(0, size - Number(rawEnd)) // suffix range: last N bytes
      } else {
        start = rawStart === '' ? 0 : Number(rawStart)
        if (rawEnd !== '') end = Math.min(Number(rawEnd), size - 1)
      }

      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
    }

    res.writeHead(range ? 206 : 200, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(media.filePath, { start, end })
      .on('error', () => res.destroy())
      .pipe(res)
  }

  private async serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
    const root = this.rendererRoot()
    // Any `/<page>/` maps to that renderer's index.html, so adding an overlay
    // page needs no routing change here — only a vite entry.
    const directory = /^\/[^/.]+\/?$/.test(pathname)
    const relative = directory ? `${pathname.replace(/^\/|\/$/g, '')}/index.html` : pathname.replace(/^\//, '')
    const resolved = path.resolve(root, relative)

    // Defense in depth: the only paths that reach here are derived from the
    // request URL, so keep them provably inside the renderer output.
    if (!resolved.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    try {
      const body = await fs.readFile(resolved)
      const contentType = STATIC_MIME_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' }).end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  }

  // Vite binds to a single loopback address, and which one is not predictable:
  // on this machine it listens on [::1] while Node resolves "localhost" to
  // 127.0.0.1 and gets ECONNREFUSED (autoSelectFamily does not rescue it).
  // So resolve every candidate address and keep the first that actually
  // accepts a connection, rather than trusting name resolution order.
  private async resolveDevHost(devServerUrl: string): Promise<string> {
    if (this.devHost) return this.devHost

    const target = new URL(devServerUrl)
    const port = Number(target.port)
    const hostname = target.hostname.replace(/^\[|\]$/g, '')

    const candidates = net.isIP(hostname)
      ? [hostname]
      : await dns.promises
          .lookup(hostname, { all: true })
          .then((addresses) => addresses.map((entry) => entry.address))
          .catch(() => [hostname])

    for (const address of candidates) {
      const reachable = await new Promise<boolean>((resolve) => {
        const probe = net.connect({ host: address, port })
        const done = (ok: boolean): void => {
          probe.destroy()
          resolve(ok)
        }
        probe.setTimeout(1000, () => done(false))
        probe.once('connect', () => done(true))
        probe.once('error', () => done(false))
      })
      if (reachable) {
        this.devHost = address
        return address
      }
    }

    return hostname
  }

  private async proxyToDevServer(req: http.IncomingMessage, res: http.ServerResponse, devServerUrl: string): Promise<void> {
    const requestUrl = req.url ?? '/'
    // `req.url` is expected to be origin-relative. Reject absolute-form
    // request targets (`GET http://evil:9999/x HTTP/1.1`) outright — parsing
    // one with `devServerUrl` as base would let it override the host/port we
    // proxy to, turning this loopback proxy into an open port-forwarder.
    if (!requestUrl.startsWith('/')) {
      res.writeHead(400).end('Bad Request')
      return
    }

    const devPort = new URL(devServerUrl).port
    const target = new URL(requestUrl, devServerUrl)
    // Vite serves `/overlay/` but 404s on `/overlay` — normalize so a browser
    // source URL typed without the trailing slash still works, for any page.
    const pathname = /^\/[^/.]+$/.test(target.pathname) ? `${target.pathname}/` : target.pathname
    const host = await this.resolveDevHost(devServerUrl)

    const proxied = http.request(
      // Host and port always come from the trusted `devServerUrl`, never from
      // `target` — only the path/query are taken from the (already-validated
      // origin-relative) request.
      { host, port: devPort, path: pathname + target.search, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      }
    )
    proxied.on('error', () => res.writeHead(502).end('Dev server unreachable'))
    req.pipe(proxied)
  }

  private proxyUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (!devServerUrl) {
      socket.destroy()
      return
    }

    const target = new URL(devServerUrl)
    void this.resolveDevHost(devServerUrl).then((host) => this.pipeUpgrade(req, socket, head, host, Number(target.port)))
  }

  private pipeUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer, host: string, port: number): void {
    const upstream = net.connect(port, host, () => {
      const headers = Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n')
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  }
}
