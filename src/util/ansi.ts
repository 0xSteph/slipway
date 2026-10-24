// CSI and OSC sequences; xtool and SwiftPM colour output even when piped.
// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
