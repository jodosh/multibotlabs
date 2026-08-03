import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

// Same loudness-normalization filter the old app used when a streamer added a
// new sound command, so newly-added sounds match the loudness of migrated ones.
export function normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static did not resolve a binary path'))
      return
    }

    const ffmpeg = spawn(ffmpegPath, [
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

    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}
