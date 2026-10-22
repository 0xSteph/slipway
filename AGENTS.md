# AGENTS.md

Guide for contributors and coding agents working in this repository.

## What this is

A VS Code extension for iOS development on Linux and Windows. It drives
[xtool](https://github.com/xtool-org/xtool) locally and, for the Simulator, a
reachable Mac over SSH. The project is in design: there is no extension code yet.

## Layout

```
README.md              public overview; claims must match the roadmap
docs/assets/           README artwork (generated; don't edit by hand)
docs/assets/src/       build.py generator, vendored OFL fonts
```

`src/` (extension) and `agent/` (the Mac-side helper) arrive with Phase 1 and 2.

## README artwork

Every image is generated, in light and dark, by one script:

```sh
pip install fonttools brotli
python3 docs/assets/src/build.py
```

- Change the generator, never the SVG output.
- Fonts are subset and embedded so the images render the same on every OS.
- Check results in a browser at 1× and 2×, in both themes, before committing.
- Images of unbuilt features are captioned "Concept render." Replace them with real
  screenshots as features ship.

## Rules

- Never commit Apple software or anything extracted from it: Xcode, SDKs,
  simulator runtimes, frameworks. Users supply their own.
- Never use Apple's or Microsoft's logos or icons.
- A README claim describes shipped behavior, or is clearly marked as planned.
- Keep changes focused. A fix doesn't come with a refactor.
