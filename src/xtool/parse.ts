import { parseSemver } from "../util/version";

/** xtool releases tested with this Slipway version. Breaking changes ship in minor releases (#279). */
export const XTOOL_MIN = [1, 23, 0] as const;
export const XTOOL_MAX_EXCLUSIVE = [2, 0, 0] as const;

export function parseXtoolVersion(stdout: string): [number, number, number] | undefined {
  const m = /^xtool (\S+)/m.exec(stdout);
  return m ? parseSemver(m[1]) : undefined;
}

export interface XtoolDevice {
  name: string;
  connection: string;
  udid: string;
}

/** `xtool devices --no-wait` prints `Name [usb]: UDID` per device, or an empty line. */
export function parseDevices(stdout: string): XtoolDevice[] {
  const devices: XtoolDevice[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^(.*) \[(\w+)\]: (\S+)\s*$/.exec(line);
    if (m) devices.push({ name: m[1], connection: m[2], udid: m[3] });
  }
  return devices;
}

export interface AuthStatus {
  loggedIn: boolean;
  mode?: "password" | "apiKey";
  appleId?: string;
  teamId?: string;
  tokenExpiry?: string;
}

export function parseAuthStatus(stdout: string): AuthStatus {
  if (!/^Logged in\./m.test(stdout)) return { loggedIn: false };
  const field = (label: string) => new RegExp(`^- ${label}: (.+)$`, "m").exec(stdout)?.[1].trim();
  if (field("ASC key ID")) return { loggedIn: true, mode: "apiKey" };
  return {
    loggedIn: true,
    mode: "password",
    appleId: field("Apple ID"),
    teamId: field("Team ID"),
    tokenExpiry: field("Token expiry"),
  };
}

export interface SdkStatus {
  installed: boolean;
  path?: string;
  version?: string;
}

export function parseSdkStatus(stdout: string): SdkStatus {
  if (!/Darwin SDK is installed/.test(stdout)) return { installed: false };
  return {
    installed: true,
    path: /^\s*Path: (.+)$/m.exec(stdout)?.[1].trim(),
    version: /^\s*Version: (.+)$/m.exec(stdout)?.[1].trim(),
  };
}

/** `xtool dev build` ends with `Wrote to <absolute path>`. */
export function parseWroteTo(stdout: string): string | undefined {
  const matches = [...stdout.matchAll(/^Wrote to (.+)$/gm)];
  return matches.at(-1)?.[1].trim();
}

export const REVOCATION_HEADER = "The following certificates must be revoked:";

export function parseRevocationPrompt(text: string): string[] | undefined {
  const start = text.lastIndexOf(REVOCATION_HEADER);
  if (start < 0) return undefined;
  const rest = text.slice(start + REVOCATION_HEADER.length);
  if (!/Continue\? \(yes\/no\): ?$/.test(rest)) return undefined;
  return rest
    .split("\n")
    .map((line) => /^- (.+)$/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Apple's free-team signing block seen since September 2026. */
export function isBannedProfileError(text: string): boolean {
  return /provisioning profile is banned|0xe8008024|0xe8008018/i.test(text);
}

export function authErrorHint(text: string): string | undefined {
  if (/-8004[56]\b/.test(text)) {
    return "Apple rejected the sign-in request. Update xtool to 1.23.0 or later, which uses the login method Apple accepts now.";
  }
  if (/requires logging in|not logged in|Logged out/i.test(text)) {
    return 'You\'re not signed in to Apple. Run "Slipway: Sign In to Apple".';
  }
  return undefined;
}

export interface InstallProgress {
  stage: string;
  percent?: number;
}

export function parseInstallProgress(line: string): InstallProgress | undefined {
  const m = /^\[([^\]]+)\]\s*(?:(\d+)%|\.\.\.)?\s*$/.exec(line.trim());
  if (!m) return undefined;
  return { stage: m[1], percent: m[2] === undefined ? undefined : Number(m[2]) };
}

/** The last `Error: …` line xtool printed, if any. */
export function parseErrorLine(text: string): string | undefined {
  const matches = [...text.matchAll(/^Error: (.+)$/gm)];
  return matches.at(-1)?.[1].trim();
}

export interface BundleIdentifier {
  id: string;
  name?: string;
  identifier?: string;
}

/** `xtool ds identifiers list` prints YAML-like `- id:` blocks. */
export function parseIdentifiers(stdout: string): BundleIdentifier[] {
  const result: BundleIdentifier[] = [];
  for (const line of stdout.split("\n")) {
    const id = /^- id: (.+)$/.exec(line);
    if (id) {
      result.push({ id: id[1].trim() });
      continue;
    }
    const current = result.at(-1);
    const field = /^\s+(name|identifier): (.+)$/.exec(line);
    if (current && field) current[field[1] as "name" | "identifier"] = field[2].trim();
  }
  return result;
}
