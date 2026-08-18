# Releasing

How to cut a release: version numbering rules, then the exact commands.
`.github/workflows/release.yml` does the actual building — this doc is just
what a human runs before that workflow takes over.

## Versioning

Standard [semver](https://semver.org): `MAJOR.MINOR.PATCH`. `package.json`'s
`version` field is the source of truth.

- **PATCH** (`1.2.0` → `1.2.1`): bug fixes only. Nothing user-facing added,
  no new setting, no new bot. If a streamer would have to be *told* about it
  to know it's there, it isn't a patch.
- **MINOR** (`1.2.0` → `1.3.0`): a new bot, a new feature, a new setting, or
  anything from `ROADMAP.md`'s "Not started" moving to "Done" — while staying
  backward compatible. This covers most releases. A fix can also land here
  when it turns something that never worked at all into something that does.
- **MAJOR** (`1.2.0` → `2.0.0`): a breaking change — existing settings files,
  sound libraries, or OBS browser-source URLs stop working as they did, and
  the streamer has to do something about it. Reserved for genuine breakage,
  not for feeling like a release is significant.

Two things this project makes easy to get wrong:

- **Adding a settings field is not breaking.** `SettingsStore.load()` merges
  saved data over `defaultSettings` field by field, so an older settings file
  picks up new fields on its own. A new setting is MINOR, not MAJOR.
- **Changing what an existing setting *does*** — renaming it, repurposing it,
  changing a default that alters behavior for someone who never touched it —
  *is* breaking. So is moving or renaming an overlay page, since the streamer
  has that URL pasted into an OBS browser source.

## Tagging

Tags are `vX.Y.Z` (the `v` prefix matters — `release.yml` only triggers on
`push: tags: ['v*']`). Use `npm version`, not a hand-written `git tag`: it
bumps `package.json` *and* `package-lock.json`, commits with the version
number as the message, and creates the matching annotated tag, all in one
step — no risk of the tag and the committed version number drifting apart.

```bash
npm version patch   # or: minor / major
git push --follow-tags
```

`--follow-tags` pushes the version-bump commit and the new tag together —
plain `git push` does not push tags on its own.

## Cutting a release

1. **Start from a clean, up-to-date `main`.** Don't release from a feature
   branch or with uncommitted changes — `npm version` will refuse to run with
   a dirty working tree anyway. Merge the feature branch first, then release
   from `main`.
2. **Confirm CI is green on `main`** (the `CI` workflow's `typecheck` job) —
   don't rely on the release workflow to catch a typecheck failure for you,
   it'll just waste three platforms' worth of build time finding out.
3. **Update `ROADMAP.md`** if this release moves anything between sections.
   Easiest to do now, while you still remember what went in.
4. **Bump and tag**: `npm version patch|minor|major` then
   `git push --follow-tags`.
5. **Watch the `Release` workflow** in the Actions tab — it matrix-builds
   Windows (NSIS), Linux (AppImage + deb), and macOS/Apple Silicon (dmg) in
   parallel, all unsigned for now (see `ROADMAP.md`'s code-signing entry).
6. Once all three jobs finish, electron-builder has created a **draft**
   GitHub Release with all the installers attached (`publish: always` in
   the workflow, `provider: github` in `package.json`'s `build` config).
   Nothing is public yet at this point.
7. **Open the draft release on GitHub, write release notes, and publish it.**
   `git log v<previous>..v<new> --oneline` is the fastest way to see what's
   actually in it. This is also your last checkpoint to catch anything wrong
   with the attached binaries before anyone downloads them.
8. **Smoke-test at least one installer** if you can — ideally the platform
   you didn't build/test on day-to-day, since that's exactly where an
   untested path is most likely to break.

## Release notes

`git log` gives you the changes; the notes have to give a streamer the two
things a commit list won't:

- **Anything that behaves differently than it did before**, even when the
  change is a fix. Someone who has built habits around the old behavior needs
  to recognize it, and "fixed X" reads as "nothing to do here" when the actual
  output has changed.
- **Anything they must install or reconfigure** — a new system dependency, an
  OBS source to re-add, a setting to revisit. These belong at the top, not
  buried mid-list, and are worth calling out per platform when they only
  affect one.
