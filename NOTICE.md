# Third-party notices

MultiBot's own source is MIT-licensed (see `LICENSE`). A few things it uses or bundles
carry their own licenses, noted here for clarity.

## ffmpeg (via `ffmpeg-static`)

MultiBot shells out to a statically-built `ffmpeg` binary (via the `ffmpeg-static` npm
package) to normalize the loudness of sound files you add. That binary is **not**
linked into MultiBot — it's invoked as a separate process — so MultiBot's own license
isn't affected. The binary itself, however, is distributed under the
[GNU General Public License v3](https://www.gnu.org/licenses/gpl-3.0.html). If you
redistribute a built copy of MultiBot, you're redistributing that binary too; ffmpeg's
source is publicly available at [ffmpeg.org](https://ffmpeg.org) and via
[ffmpeg-static's release builds](https://github.com/eugeneware/ffmpeg-static).

## Space Mono

The UI typeface (`src/renderer/assets/fonts/`) is
[Space Mono](https://github.com/googlefonts/spacemono), © The Space Mono Project
Authors, licensed under the [SIL Open Font License 1.1](src/renderer/assets/fonts/OFL.txt),
included alongside the font files.

## npm dependencies

Runtime dependencies (`electron`, `electron-vite`, `tmi.js`) are MIT-licensed. See
each package's own `LICENSE` under `node_modules/` for the full text.
