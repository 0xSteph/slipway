import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { BuiltApp, XtoolConfig, parseXtoolYml, readBuiltApp } from "./config";

export interface Project {
  root: string;
  config: XtoolConfig;
}

/** The first workspace folder with an xtool.yml, else the first with a Package.swift. */
export function findProject(): Project | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const pick =
    folders.find((f) => existsSync(path.join(f.uri.fsPath, "xtool.yml"))) ??
    folders.find((f) => existsSync(path.join(f.uri.fsPath, "Package.swift")));
  if (!pick) return undefined;
  const root = pick.uri.fsPath;
  const yml = path.join(root, "xtool.yml");
  return { root, config: existsSync(yml) ? parseXtoolYml(readFileSync(yml, "utf8")) : {} };
}

/** The app from the last build, if one exists: `xtool/<Product>.app`. */
export function findBuiltApp(project: Project): BuiltApp | undefined {
  const dir = path.join(project.root, "xtool");
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".app")) return readBuiltApp(path.join(dir, name));
  }
  return undefined;
}
