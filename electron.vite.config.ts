import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          hud: resolve(__dirname, 'src/preload/hud.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
          playback: resolve(__dirname, 'src/preload/playback.ts'),
          library: resolve(__dirname, 'src/preload/library.ts'),
          ttsSettings: resolve(__dirname, 'src/preload/ttsSettings.ts'),
          atMeQueue: resolve(__dirname, 'src/preload/atMeQueue.ts'),
          mediaLibrary: resolve(__dirname, 'src/preload/mediaLibrary.ts'),
          celebration: resolve(__dirname, 'src/preload/celebration.ts'),
          coinks: resolve(__dirname, 'src/preload/coinks.ts'),
          hypeTrain: resolve(__dirname, 'src/preload/hypeTrain.ts'),
          updateDetails: resolve(__dirname, 'src/preload/updateDetails.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          hud: resolve(__dirname, 'src/renderer/hud/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          playback: resolve(__dirname, 'src/renderer/playback/index.html'),
          library: resolve(__dirname, 'src/renderer/library/index.html'),
          'tts-settings': resolve(__dirname, 'src/renderer/tts-settings/index.html'),
          'atme-queue': resolve(__dirname, 'src/renderer/atme-queue/index.html'),
          media: resolve(__dirname, 'src/renderer/media/index.html'),
          celebration: resolve(__dirname, 'src/renderer/celebration/index.html'),
          // Not Electron windows — served over HTTP by OverlayServer and loaded
          // by OBS as Browser Sources. One page per feature so OBS controls
          // each one's placement and scale independently.
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          'overlay-fireworks': resolve(__dirname, 'src/renderer/overlay-fireworks/index.html'),
          coinks: resolve(__dirname, 'src/renderer/coinks/index.html'),
          'overlay-coinks': resolve(__dirname, 'src/renderer/overlay-coinks/index.html'),
          hypetrain: resolve(__dirname, 'src/renderer/hypetrain/index.html'),
          'overlay-hypetrain': resolve(__dirname, 'src/renderer/overlay-hypetrain/index.html'),
          'update-details': resolve(__dirname, 'src/renderer/update-details/index.html')
        }
      }
    }
  }
})
