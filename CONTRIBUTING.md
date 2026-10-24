# Contributing to Slipway

Thanks for helping. The most useful contribution right now is a test report from a real
iPhone or a Windows PC, because neither path has been tested on hardware yet.

## Reporting a test run

Open an issue with the **Test report** template and attach the output of
**Slipway: Collect Diagnostics** (redacted by default). Say what you tried, what happened
and your iOS version. Failures are as useful as successes.

## Development setup

You need Node.js 22 and, to build iOS apps in the tests, Swift 6.4 and xtool on Linux.

```sh
git clone https://github.com/0xSteph/slipway.git
cd slipway
npm install
npm run compile      # bundles src/ into dist/extension.js
```

Press <kbd>F5</kbd> in VS Code to start an Extension Development Host with your changes.

## Tests

```sh
npm run lint              # ESLint and Prettier
npm run typecheck
npm run test:unit         # Vitest, no VS Code needed
npm run test:integration  # runs inside VS Code; needs a display (xvfb-run -a on CI)
```

The integration tests download VS Code into `.vscode-test/`. If xtool is installed, one
test builds a small iOS app for real; without xtool it's skipped.

Output parsers have unit tests against recorded tool output in `test/fixtures/`. When you
change how Slipway reads xtool or go-ios output, add the real output as a fixture.

## Code layout

```
src/extension.ts      activation and commands
src/doctor.ts         setup checks (Linux and WSL); src/windowsSetup.ts on Windows
src/run.ts            build → install → launch → logs → crash reports
src/build/            xtool dev build and the Problems panel
src/bridge/           go-ios: install, launch, logs, crash reports, tunnel
src/xtool/            parsing xtool output
src/project/          xtool.yml, templates, entitlements
src/util/             process runner, PATH and WSL helpers, redaction, zip
```

## Ground rules

- Never commit Apple software or anything extracted from it, and never bundle xtool or
  go-ios. Users install or download them.
- A README claim describes tested behaviour or is clearly marked as untested or planned.
- Keep pull requests focused: a fix doesn't come with a refactor.
- Write commit messages for a reader who wasn't there: what changed and why.
