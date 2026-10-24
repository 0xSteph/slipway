import { compareVersions, parseSemver } from "../util/version";

/** go-ios release Slipway is tested against; launch PID parsing relies on its log format. */
export const GO_IOS_VERSION = "v1.3.2";
export const GO_IOS_ZIP_URL = `https://github.com/danielpaulus/go-ios/releases/download/${GO_IOS_VERSION}/go-ios-linux.zip`;
export const GO_IOS_ZIP_SHA256 = "a55fdb4c507391c0548252e01d1deb6ae3c7fd99cfbce842c6f80569cc125604";
export const GO_IOS_BINARIES: Record<string, { entry: string; sha256: string }> = {
  x64: {
    entry: "ios-amd64",
    sha256: "24d6149a9d9ab65e17e55313312bcc59c98a7d51d692f9c37b0a0ba26f57623e",
  },
  arm64: {
    entry: "ios-arm64",
    sha256: "ae0553a2c74e1271b55ca90f317030df14eb6a141208002b6905ca4b2d6afe1b",
  },
};
/** go-ios agent default; its own help text wrongly says 28100. */
export const AGENT_PORT = 60105;

export type LaunchPath = "xtool" | "unsupported" | "tunnel";

/**
 * iOS < 17 launches through the classic debugserver (`xtool launch`). go-ios routes
 * 17.0 through 17.4.0 inclusive to a root-only tunnel, so those can install but not launch.
 */
export function launchPath(iosVersion: string): LaunchPath {
  const v = parseSemver(iosVersion);
  if (!v) return "tunnel";
  if (v[0] < 17) return "xtool";
  return compareVersions(v, [17, 4, 0]) > 0 ? "tunnel" : "unsupported";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function* jsonLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    const value = parseJson(line.trim());
    if (value && typeof value === "object") yield value as Record<string, unknown>;
  }
}

export interface DeviceInfo {
  name?: string;
  iosVersion?: string;
  productType?: string;
}

export function parseInfo(stdout: string): DeviceInfo {
  const value = parseJson(stdout) as Record<string, unknown> | undefined;
  if (!value) return {};
  const str = (key: string) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  return {
    name: str("DeviceName"),
    iosVersion: str("ProductVersion"),
    productType: str("ProductType"),
  };
}

/** `devmode get` prints false when the query itself failed, so stderr decides "unknown". */
export function parseDevMode(stdout: string, stderr: string): boolean | undefined {
  const value = parseJson(stdout.trim()) as { DeveloperModeEnabled?: unknown } | undefined;
  if (value?.DeveloperModeEnabled === true) return true;
  for (const log of jsonLines(stderr)) {
    if (log.level === "ERROR" || log.level === "FATAL" || "err" in log || "error" in log)
      return undefined;
  }
  return value?.DeveloperModeEnabled === false ? false : undefined;
}

/** `ios launch` prints nothing on stdout; the PID is in a stderr log line. */
export function parseLaunchPid(stderr: string): number | undefined {
  for (const log of jsonLines(stderr)) {
    if (log.msg === "Process launched" && typeof log.pid === "number") return log.pid;
  }
  return undefined;
}

export interface SyslogEntry {
  timestamp?: string;
  process?: string;
  pid?: number;
  level?: string;
  message: string;
}

export function parseSyslogLine(line: string): SyslogEntry | undefined {
  const value = parseJson(line) as Record<string, unknown> | undefined;
  if (!value) return line.trim() ? { message: line } : undefined;
  if (typeof value.message === "string") {
    return {
      timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
      process: typeof value.process === "string" ? value.process : undefined,
      pid: typeof value.pid === "string" ? Number(value.pid) : undefined,
      level: typeof value.level === "string" ? value.level : undefined,
      message: value.message,
    };
  }
  return typeof value.msg === "string" ? { message: value.msg } : undefined;
}

export function parseCrashList(stdout: string): string[] {
  const value = parseJson(stdout.trim()) as { files?: unknown } | undefined;
  return Array.isArray(value?.files)
    ? value.files.filter((f): f is string => typeof f === "string")
    : [];
}

/** `ios image list` logs `{"msg":"image signature",…}` to stderr when an image is mounted. */
export function parseImageMounted(stderr: string): boolean {
  for (const log of jsonLines(stderr)) {
    if (log.msg === "image signature") return true;
  }
  return false;
}

export interface RunningApp {
  name: string;
  pid: number;
}

export function parsePs(stdout: string): RunningApp[] {
  const value = parseJson(stdout.trim());
  if (!Array.isArray(value)) return [];
  return value
    .filter((p) => p && typeof p.Name === "string" && typeof p.Pid === "number")
    .map((p) => ({ name: p.Name as string, pid: p.Pid as number }));
}

export interface InstalledApp {
  bundleId: string;
  name?: string;
  executable?: string;
  version?: string;
}

export function parseApps(stdout: string): InstalledApp[] {
  const value = parseJson(stdout.trim());
  if (!Array.isArray(value)) return [];
  return value
    .filter((a) => a && typeof a.CFBundleIdentifier === "string")
    .map((a) => ({
      bundleId: a.CFBundleIdentifier as string,
      name: (a.CFBundleDisplayName ?? a.CFBundleName) as string | undefined,
      executable: a.CFBundleExecutable as string | undefined,
      version: a.CFBundleShortVersionString as string | undefined,
    }));
}

/** First error message in go-ios's JSON stderr log, for user-facing errors. */
export function parseLogError(stderr: string): string | undefined {
  for (const log of jsonLines(stderr)) {
    if (log.level === "ERROR" || log.level === "FATAL") {
      const detail =
        typeof log.err === "string" ? log.err : typeof log.error === "string" ? log.error : "";
      return [log.msg, detail].filter(Boolean).join(": ");
    }
  }
  return undefined;
}
