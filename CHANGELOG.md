# Changelog

All notable changes to Slipway are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First preview. Setup, templates, building and code completion are tested on Ubuntu.
Running on an iPhone and the Windows setup are built but not yet tested on real hardware.

### Added

- Doctor panel that checks Swift, xtool, the iOS SDK, Apple sign-in, the iPhone,
  Developer Mode, go-ios and the developer disk image, with a fix for each.
- Windows setup guide: WSL, the VS Code WSL extension, Apple Devices, WSL mirrored
  networking, and Reopen in WSL. Inside WSL, the iPhone is found automatically through
  usbipd or Apple's Windows service.
- Build with compiler errors and warnings in the Problems panel.
- Run on iPhone: build, install (re-signed by xtool), launch through go-ios on iOS 17.4.1
  and later or through xtool on iOS 16 and earlier, live device log, Stop.
- Crash reports pulled from the phone and opened after a crash.
- Free Apple ID tools: 7-day expiry tracking, Refresh without rebuilding, App ID count,
  warnings for paid-only entitlements and asset catalogs, and an explanation when Apple
  refuses to sign for a free account.
- New iOS App command with Basic and Local Notifications templates.
- Apple sign-in and SDK installation in a terminal, so passwords go only to xtool.
- Collect Diagnostics, redacted by default.
- Status bar items for the device, Run and the editor's iOS SDK setup.
- Getting-started walkthrough.

[0.1.0]: https://github.com/0xSteph/slipway/releases/tag/v0.1.0
