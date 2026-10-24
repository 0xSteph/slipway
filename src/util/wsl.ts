import { readFileSync } from "node:fs";
import * as net from "node:net";

/** Apple Mobile Device Service (Apple Devices app or iTunes) listens here on Windows. */
export const APPLE_MUX_PORT = 27015;

export function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/**
 * wsl.exe writes UTF-16LE unless WSL_UTF8=1 is honoured. Read as UTF-8, that leaves NULs
 * between characters and turns the byte-order mark into U+FFFD pairs, so strip both.
 */
export function cleanWslOutput(text: string): string {
  return text.replaceAll("\u0000", "").replace(/^[\uFEFF\uFFFD]+/, "");
}

/** `wsl.exe -l -q` prints one distro name per line. */
export function parseWslDistros(stdout: string): string[] {
  return cleanWslOutput(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** True when `.wslconfig` has `networkingMode=mirrored` under `[wsl2]`. */
export function wslConfigIsMirrored(text: string): boolean {
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    const kv = /^networkingMode\s*=\s*(\S+)$/i.exec(line);
    if (section === "wsl2" && kv) return kv[1].toLowerCase() === "mirrored";
  }
  return false;
}

/** Adds or replaces `networkingMode=mirrored` in the `[wsl2]` section, keeping everything else. */
export function withMirroredNetworking(text: string): string {
  const lines = text.length ? text.split(/\r?\n/) : [];
  let inWsl2 = false;
  let sectionEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[(.+)\]\s*$/.exec(lines[i]);
    if (header) {
      if (inWsl2) break;
      inWsl2 = header[1].trim().toLowerCase() === "wsl2";
      if (inWsl2) sectionEnd = i + 1;
      continue;
    }
    if (!inWsl2) continue;
    if (/^\s*networkingMode\s*=/i.test(lines[i])) {
      lines[i] = "networkingMode=mirrored";
      return lines.join("\n");
    }
    if (lines[i].trim()) sectionEnd = i + 1;
  }
  if (sectionEnd >= 0) {
    lines.splice(sectionEnd, 0, "networkingMode=mirrored");
    return lines.join("\n");
  }
  const prefix = lines.length && lines.at(-1)?.trim() ? [...lines, ""] : lines;
  return [...prefix, "[wsl2]", "networkingMode=mirrored", ""].join("\n");
}

/** The default gateway from /proc/net/route, which is the Windows host under WSL's NAT mode. */
export function parseDefaultGateway(procNetRoute: string): string | undefined {
  for (const line of procNetRoute.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3 || cols[1] !== "00000000") continue;
    const hex = cols[2];
    if (!/^[0-9A-Fa-f]{8}$/.test(hex) || hex === "00000000") continue;
    const bytes = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return bytes.join(".");
  }
  return undefined;
}

export function canConnect(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export type PhoneRoute =
  | { kind: "configured"; address: string }
  | { kind: "usbmuxd" }
  | { kind: "appleRelay"; address: string }
  | { kind: "none" };

/**
 * How xtool and go-ios reach the phone from WSL: a usbmuxd socket (usbipd forwarding the
 * USB device in), or Apple's Windows service relayed over TCP. Both tools honour
 * USBMUXD_SOCKET_ADDRESS (xtool #19 workaround; go-ios usbmuxconnection.go).
 */
export async function findPhoneRoute(
  env: NodeJS.ProcessEnv,
  usbmuxdSocketExists: boolean,
  readRoute: () => string | undefined,
): Promise<PhoneRoute> {
  if (env.USBMUXD_SOCKET_ADDRESS)
    return { kind: "configured", address: env.USBMUXD_SOCKET_ADDRESS };
  if (usbmuxdSocketExists) return { kind: "usbmuxd" };
  // Mirrored networking (Windows 11 22H2+) lets WSL reach Windows on 127.0.0.1.
  if (await canConnect("127.0.0.1", APPLE_MUX_PORT))
    return { kind: "appleRelay", address: `127.0.0.1:${APPLE_MUX_PORT}` };
  const gateway = parseDefaultGateway(readRoute() ?? "");
  if (gateway && (await canConnect(gateway, APPLE_MUX_PORT)))
    return { kind: "appleRelay", address: `${gateway}:${APPLE_MUX_PORT}` };
  return { kind: "none" };
}
