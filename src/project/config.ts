import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

export interface XtoolConfig {
  bundleID?: string;
  orgID?: string;
  product?: string;
  iconPath?: string;
  entitlementsPath?: string;
  skipLSP?: boolean;
}

/** Reads the flat top-level keys of xtool.yml that Slipway needs; nested `extensions` are ignored. */
export function parseXtoolYml(text: string): XtoolConfig {
  const config: XtoolConfig = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    if (!m || !m[2]) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    switch (m[1]) {
      case "bundleID":
      case "orgID":
      case "product":
      case "iconPath":
      case "entitlementsPath":
        config[m[1]] = value;
        break;
      case "skipLSP":
        config.skipLSP = value === "true";
        break;
    }
  }
  return config;
}

export function plistString(xml: string, key: string): string | undefined {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return m?.[1];
}

export interface BuiltApp {
  path: string;
  bundleId: string;
  executable: string;
}

/** Reads identity from the .app xtool wrote; its Info.plist is XML (Packer.swift). */
export function readBuiltApp(appPath: string): BuiltApp | undefined {
  const plist = path.join(appPath, "Info.plist");
  if (!existsSync(plist)) return undefined;
  const xml = readFileSync(plist, "utf8");
  const bundleId = plistString(xml, "CFBundleIdentifier");
  const executable = plistString(xml, "CFBundleExecutable");
  return bundleId && executable ? { path: appPath, bundleId, executable } : undefined;
}
