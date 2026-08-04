# Releasing

How to cut a release: version numbering rules, then the exact commands.
`.github/workflows/release.yml` does the actual building — this doc is just
what a human runs before that workflow takes over.

## Versioning

Standard [semver](https://semver.org): `MAJOR.MINOR.PATCH`. `package.json`'s
`version` field is the source of truth.

While we're pre-1.0 (currently `0.1.0`), semver's pre-1.0 rule applies:
anything can change in a `MINOR` bump, not just `PATCH` — 0.x is explicitly
"still moving." In practice for this repo:

- **PATCH** (`0.1.0` → `0.1.1`): bug fixes only, nothing user-facing added.
- **MINOR** (`0.1.0` → `0.2.0`): new bot, new feature, anything from
  `ROADMAP.md`'s "Not started" moving to "Done" — this covers most releases
  for a while.
- **MAJOR** stays `0` until we're comfortable calling this stable enough for
  people outside the two of us to depend on (real Windows/macOS testing done,
  code signing sorted, most of the roadmap's "Not started" cleared). That's
  when `1.0.0` happens — it's a deliberate milestone, not a version-math
  accident.

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
   a dirty working tree anyway.
2. **Confirm CI is green on `main`** (the `CI` workflow's `typecheck` job) —
   don't rely on the release workflow to catch a typecheck failure for you,
   it'll just waste three platforms' worth of build time finding out.
3. **Bump and tag**: `npm version patch|minor|major` then
   `git push --follow-tags`.
4. **Watch the `Release` workflow** in the Actions tab — it matrix-builds
   Windows (NSIS), Linux (AppImage + deb), and macOS/Apple Silicon (dmg) in
   parallel, all unsigned for now (see `ROADMAP.md`'s code-signing entry).
5. Once all three jobs finish, electron-builder has created a **draft**
   GitHub Release with all the installers attached (`publish: always` in
   the workflow, `provider: github` in `package.json`'s `build` config).
   Nothing is public yet at this point.
6. **Open the draft release on GitHub, write release notes, and publish it.**
   `git log v<previous>..v<new> --oneline` is the fastest way to see what's
   actually in it. This is also your last checkpoint to catch anything wrong
   with the attached binaries before anyone downloads them.
7. **Smoke-test at least one installer** if you can — ideally the platform
   you didn't build/test on day-to-day, since that's exactly where an
   untested path is most likely to break.

## First release

`package.json` is already at `0.1.0` and nothing has ever been tagged, so
there's no bump to make — skip the `npm version` step this one time and just
commit/push everything pending, then tag what's already there:

```bash
git add -A
git commit -m "..."
git push
git tag -a v0.1.0 -m "v0.1.0"
git push --follow-tags
```

Every release after this one follows the normal `npm version` flow above.
