# AGENTS.md

Guide for contributors and coding agents working in this repository.

## What this is

A VS Code extension that builds, installs and runs SwiftUI iPhone apps from Windows
(through WSL) and Linux. It drives [xtool](https://github.com/xtool-org/xtool) for
building and signing, and [go-ios](https://github.com/danielpaulus/go-ios) for launching
apps, device logs and crash reports on current iOS. Later phases add a Simulator on a Mac
reached over SSH.

## Commands

```sh
npm install
npm run compile            # esbuild → dist/extension.js
npm run lint               # ESLint + Prettier check
npm run typecheck
npm run test:unit          # Vitest; pure modules, no VS Code
npm run test:integration   # @vscode/test-cli in a downloaded VS Code; needs a display
npm run package            # VSIX, using README.marketplace.md as the listing
```

## Layout

```
src/                   extension source (see CONTRIBUTING.md for the module map)
test/unit/             Vitest tests; fixtures in test/fixtures/ are real recorded tool output
test/integration/      tests that run inside VS Code against test/fixtures/workspace
media/                 icon, activity bar icon, walkthrough pages
docs/assets/           README artwork (generated; don't edit by hand) and screenshots
docs/assets/src/       build.py generator, vendored OFL fonts
README.md              GitHub README (SVG artwork with light/dark variants)
README.marketplace.md  Marketplace and Open VSX listing (PNG only; vsce rejects SVG)
```

## How the code is organised

- Modules that parse tool output or build files (`src/xtool/parse.ts`,
  `src/bridge/parse.ts`, `src/build/diagnostics.ts`, `src/project/`, `src/util/`) don't
  import `vscode`, so they're unit-tested directly.
- Every child process goes through `src/util/process.ts`, which strips ANSI codes and
  supports cancellation, timeouts and answering prompts.
- `src/tools.ts` builds the environment for xtool and go-ios: it adds swiftly's and
  `~/.local/bin` to PATH (VS Code launched from a desktop often lacks them), sets
  `NO_COLOR=1`, and under WSL sets `USBMUXD_SOCKET_ADDRESS` when the phone is reached
  through Apple's Windows service.
- xtool installs apps under `XTL-<prefix>.<bundle ID>`; launch and kill use the ID looked
  up from the phone, never the one in the built app.

## README artwork

Generated, in light and dark, by one script:

```sh
pip install fonttools brotli
python3 docs/assets/src/build.py
```

- Change the generator, never the SVG output.
- Images of unbuilt features are captioned "Concept render." Real screenshots live in
  `docs/assets/screenshots/`.

## Rules

- Never commit Apple software or anything extracted from it: Xcode, SDKs, disk images,
  simulator runtimes, frameworks. Never bundle xtool or go-ios. Users supply them.
- Never handle Apple ID passwords. Sign-in runs xtool in a terminal.
- Never auto-answer xtool's certificate revocation prompt; ask the user.
- Never use Apple's or Microsoft's logos or icons.
- A README claim describes tested behaviour, or is clearly marked as untested or planned.
- Keep changes focused. A fix doesn't come with a refactor.
