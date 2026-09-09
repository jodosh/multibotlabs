import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'

// This rewrite is what makes "+ Add Sound" work in a packaged build at all.
//
// ffmpeg-static resolves its binary as `__dirname/ffmpeg[.exe]`, and __dirname
// in a packaged build is inside app.asar. electron-builder does write the real
// binary to app.asar.unpacked (its unpack detector special-cases ffmpeg-static
// by name), but nothing updates the path ffmpeg-static hands back — so the
// resolved path points into the archive, where no executable exists.
//
// The trap is that Electron patches the execFile family to redirect in-asar
// paths, but NOT spawn(), which is what this module uses. So an execFile call
// on the in-asar path succeeds and a spawn of the same path fails, which makes
// this very easy to "verify" wrongly. Measured in a packaged build: spawn on
// the in-asar path throws ENOTDIR on Linux/macOS and ENOENT on Windows (the
// archive is a file, so a path through it is neither a directory nor found);
// spawn on the rewritten path runs normally.
//
// No-op in dev, where no app.asar is in the path at all — which is why this
// never reproduces under `npm run dev`.
function unpackedBinaryPath(resolved: string): string {
  const packed = `${path.sep}app.asar${path.sep}`
  const unpacked = `${path.sep}app.asar.unpacked${path.sep}`
  return resolved.includes(packed) ? resolved.replace(packed, unpacked) : resolved
}

// Thrown when the bundled binary isn't on disk, as distinct from ffmpeg
// running and failing. Callers use it to decide whether falling back to the
// unprocessed file is reasonable — a missing binary is an environment problem
// the streamer can't do anything about mid-task, while a non-zero exit means
// ffmpeg looked at their file and refused it, which they should hear about.
export class FfmpegUnavailableError extends Error {
  constructor(public readonly binaryPath: string, message: string) {
    super(message)
    this.name = 'FfmpegUnavailableError'
  }
}

// Same loudness-normalization filter the old app used when a streamer added a
// new sound command, so newly-added sounds match the loudness of migrated ones.
export async function normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new FfmpegUnavailableError('', 'ffmpeg-static did not resolve a binary path for this platform')
  }

  const binary = unpackedBinaryPath(ffmpegPath)

  // The path above should now be correct, so reaching this branch means the
  // binary is genuinely absent — a damaged install, or something on the
  // machine removed it. Checked up front because a bare ENOENT out of spawn()
  // names no file and gives no reason, which is what made the original reports
  // so hard to act on.
  try {
    await access(binary)
  } catch {
    throw new FfmpegUnavailableError(
      binary,
      `ffmpeg is missing from this install (expected at ${binary}). ` +
        'Reinstalling MultiBot should restore it.'
    )
  }

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(binary, [
      '-y',
      '-i',
      inputPath,
      '-af',
      'loudnorm=I=-16:LRA=11:TP=-1.5',
      outputPath
    ])

    let stderr = ''
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    ffmpeg.on('error', (error: NodeJS.ErrnoException) => {
      // access() passed a moment ago, so this is the binary being removed or
      // blocked in between — still an unavailable ffmpeg, not a bad input file.
      if (error.code === 'ENOENT') {
        reject(new FfmpegUnavailableError(binary, `ffmpeg could not be started (${binary}): ${error.message}`))
        return
      }
      reject(error)
    })
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}
