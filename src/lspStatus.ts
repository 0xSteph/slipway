import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { findProject } from "./project/project";

export type LspState = "bsp" | "legacy" | "skipped" | "missing" | "invalid";

export function lspState(root: string, skipLSP: boolean | undefined): LspState {
  if (skipLSP) return "skipped";
  const bsp = path.join(root, ".bsp", "xtool.json");
  if (existsSync(bsp)) {
    try {
      const argv = JSON.parse(readFileSync(bsp, "utf8")).argv as unknown;
      return Array.isArray(argv) && argv.slice(-2).join(" ") === "dev build-server"
        ? "bsp"
        : "invalid";
    } catch {
      return "invalid";
    }
  }
  return existsSync(path.join(root, ".sourcekit-lsp", "config.json")) ? "legacy" : "missing";
}

/** Shows whether SourceKit-LSP has xtool's iOS SDK config; xtool writes it on build. */
export class LspStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    "slipway.lsp",
    vscode.StatusBarAlignment.Right,
    100,
  );
  private readonly watcher = vscode.workspace.createFileSystemWatcher(
    "**/{.bsp/xtool.json,.sourcekit-lsp/config.json,xtool.yml}",
  );

  constructor() {
    this.item.name = "Slipway Editor SDK";
    for (const event of [
      this.watcher.onDidCreate,
      this.watcher.onDidChange,
      this.watcher.onDidDelete,
    ])
      event(() => this.update());
    this.update();
  }

  update(): void {
    const project = findProject();
    if (!project) {
      this.item.hide();
      return;
    }
    const state = lspState(project.root, project.config.skipLSP);
    const ok = state === "bsp" || state === "legacy";
    this.item.text = ok ? "$(check) iOS SDK" : "$(warning) iOS SDK";
    this.item.tooltip = {
      bsp: "Swift editing uses the iOS SDK through xtool's build server (.bsp/xtool.json).",
      legacy: "Swift editing uses the iOS SDK through .sourcekit-lsp/config.json.",
      skipped: "skipLSP is set in xtool.yml, so xtool doesn't configure the editor.",
      missing:
        "The editor isn't set up for the iOS SDK yet. Build once and xtool writes the config.",
      invalid: ".bsp/xtool.json isn't xtool's build server config. Build to regenerate it.",
    }[state];
    this.item.command = ok || state === "skipped" ? undefined : "slipway.build";
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    this.watcher.dispose();
  }
}
