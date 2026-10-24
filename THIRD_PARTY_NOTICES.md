# Third-party notices

The Slipway extension package contains only Slipway's own code. It has no runtime npm
dependencies. The software below is used by Slipway but is not included in the package.

## Downloaded or installed by the user

| Software | License | How it's used |
|:--|:--|:--|
| [xtool](https://github.com/xtool-org/xtool) | MIT | Installed by the user. Slipway runs it to build, sign and install apps. |
| [go-ios](https://github.com/danielpaulus/go-ios) v1.3.2 | MIT | Downloaded from its GitHub release on first use, checked against a pinned SHA-256, kept in Slipway's extension storage. |
| [Swift](https://www.swift.org) and SourceKit-LSP | Apache 2.0 with Runtime Library Exception | Installed by the user. |
| Xcode and its iOS SDK | Apple's license | Downloaded by the user from Apple. Slipway never redistributes it. |
| Apple's developer disk image | Apple's license | Downloaded by go-ios from a third-party mirror, only after the user agrees, or supplied by the user. Not hosted or bundled by Slipway. |

## In this repository

| Asset | License |
|:--|:--|
| [Inter](https://rsms.me/inter/) fonts in `docs/assets/src/fonts`, subset into the README artwork | SIL Open Font License 1.1 (`Inter-OFL.txt`) |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) in `docs/assets/src/fonts`, subset into the README artwork | SIL Open Font License 1.1 (`JetBrainsMono-OFL.txt`) |
