# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → Report a vulnerability** on this repository. Don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it.
You'll get a reply within a week. Once a fix ships, you'll be credited in the release
notes unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes while Slipway is in preview.

## What Slipway does with your data

- Slipway never asks for, sees or stores your Apple ID password. Sign-in runs
  `xtool auth login` in a terminal, and you type into xtool directly. xtool keeps its
  session under `~/.config/xtool`.
- Slipway downloads two things itself: the go-ios release from GitHub, checked against a
  pinned SHA-256 for both the archive and the binary, and Apple's root certificate from
  apple.com, checked against its pinned fingerprint. Apple's developer disk image is
  downloaded by go-ios only after you agree.
- Everything Slipway stores lives in VS Code's extension storage for Slipway.
- There is no telemetry.
- Diagnostics reports remove Apple IDs, team IDs, device IDs and your home folder
  unless you choose otherwise.

Issues in xtool or go-ios should go to those projects:
[xtool](https://github.com/xtool-org/xtool/security) and
[go-ios](https://github.com/danielpaulus/go-ios/security).
