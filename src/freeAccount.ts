import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { checkFreeTeamEntitlements, plistTopLevelKeys } from "./project/entitlements";
import { Project } from "./project/project";
import { Tools } from "./tools";
import { parseIdentifiers } from "./xtool/parse";

const INSTALLS_KEY = "slipway.installs";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Free-team profiles last 7 days from issue; `xtool install` issues a new one each time. */
export const FREE_PROFILE_DAYS = 7;

export interface InstallRecord {
  udid: string;
  bundleId: string;
  appPath: string;
  installedAt: number;
}

export function expiresAt(record: InstallRecord): number {
  return record.installedAt + FREE_PROFILE_DAYS * DAY_MS;
}

export function describeExpiry(record: InstallRecord, now = Date.now()): string {
  const left = expiresAt(record) - now;
  if (left <= 0) return "Expired: refresh to keep using it";
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  return `Expires in ${Math.max(1, Math.round(left / (60 * 60 * 1000)))} h`;
}

/** Tracks free-account install expiry locally, so Slipway never polls Apple for it. */
export class FreeAccount {
  constructor(
    private readonly state: vscode.Memento,
    private readonly tools: Tools,
  ) {}

  records(): InstallRecord[] {
    return this.state.get<InstallRecord[]>(INSTALLS_KEY, []);
  }

  recordsFor(udid: string): InstallRecord[] {
    return this.records().filter((r) => r.udid === udid);
  }

  async recordInstall(record: InstallRecord): Promise<void> {
    const others = this.records().filter(
      (r) => !(r.udid === record.udid && r.bundleId === record.bundleId),
    );
    await this.state.update(INSTALLS_KEY, [...others, record]);
  }

  expiryText(udid: string): string | undefined {
    const records = this.recordsFor(udid);
    if (records.length === 0) return undefined;
    return records.map((r) => `${r.bundleId}: ${describeExpiry(r)}`).join("\n");
  }

  /** Apps on this device with under 48 hours left. */
  expiringSoon(udid: string, now = Date.now()): InstallRecord[] {
    return this.recordsFor(udid).filter(
      (r) => expiresAt(r) - now < 2 * DAY_MS && existsSync(r.appPath),
    );
  }

  /** One call to Apple, on demand only: counts the App IDs xtool registered for this account. */
  async appIdCount(): Promise<{ count: number; identifiers: string[] } | undefined> {
    const result = await this.tools.xtool(["ds", "identifiers", "list"], { timeoutMs: 60000 });
    if (result.code !== 0) return undefined;
    const identifiers = parseIdentifiers(result.stdout)
      .map((i) => i.identifier)
      .filter((i): i is string => i !== undefined);
    return { count: identifiers.length, identifiers };
  }
}

export interface ProjectWarnings {
  droppedCapabilities: string[];
  failingEntitlements: string[];
  assetCatalogs: string[];
}

function findAssetCatalogs(dir: string, depth = 0, found: string[] = []): string[] {
  if (depth > 4 || !existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "xtool") continue;
    const full = path.join(dir, entry.name);
    if (entry.name.endsWith(".xcassets")) found.push(full);
    else findAssetCatalogs(full, depth + 1, found);
  }
  return found;
}

export function projectWarnings(project: Project): ProjectWarnings {
  const warnings: ProjectWarnings = {
    droppedCapabilities: [],
    failingEntitlements: [],
    assetCatalogs: [],
  };
  const entitlements =
    project.config.entitlementsPath && path.join(project.root, project.config.entitlementsPath);
  if (entitlements && existsSync(entitlements)) {
    const report = checkFreeTeamEntitlements(plistTopLevelKeys(readFileSync(entitlements, "utf8")));
    warnings.droppedCapabilities = report.dropped;
    warnings.failingEntitlements = report.willFail;
  }
  warnings.assetCatalogs = findAssetCatalogs(path.join(project.root, "Sources")).concat(
    findAssetCatalogs(path.join(project.root, "Resources")),
  );
  return warnings;
}

/** Picks the largest PNG in an AppIcon.appiconset, the best stand-in for the 1024 px icon. */
export function largestAppIcon(catalog: string): string | undefined {
  const set = path.join(catalog, "AppIcon.appiconset");
  if (!existsSync(set)) return undefined;
  const pngs = readdirSync(set)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => path.join(set, f));
  const width = (file: string) => {
    const data = readFileSync(file);
    return data.length > 24 ? data.readUInt32BE(16) : 0;
  };
  return pngs.sort((a, b) => width(b) - width(a))[0];
}
