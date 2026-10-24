import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  APP_NAME,
  BUNDLE_ID,
  TemplateKind,
  defaultBundleId,
  templateFiles,
} from "./project/template";

export async function newApp(): Promise<void> {
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: "Create App Here",
    title: "Where should the new app's folder go?",
  });
  if (!parent?.[0]) return;

  const name = await vscode.window.showInputBox({
    title: "App name",
    placeHolder: "MyApp",
    validateInput: (v) => {
      if (!APP_NAME.test(v)) return "Start with a letter; use letters, numbers, - and _ only.";
      if (existsSync(path.join(parent[0].fsPath, v)))
        return "A folder with this name already exists.";
      return undefined;
    },
  });
  if (!name) return;

  const bundleId = await vscode.window.showInputBox({
    title: "Bundle ID",
    value: defaultBundleId(os.userInfo().username, name),
    prompt:
      "Reverse-DNS, unique to you. On a free Apple account each new bundle ID uses one of 10 App IDs per week, so reuse IDs when you can.",
    validateInput: (v) =>
      BUNDLE_ID.test(v) ? undefined : "Use reverse-DNS like dev.yourname.myapp.",
  });
  if (!bundleId) return;

  const picked = await vscode.window.showQuickPick(
    [
      { label: "Basic", description: "SwiftUI hello world", template: "basic" as TemplateKind },
      {
        label: "Local Notifications",
        description: "schedules a notification; works on free accounts",
        template: "notifications" as TemplateKind,
      },
    ],
    { placeHolder: "Template" },
  );
  if (!picked) return;

  const root = path.join(parent[0].fsPath, name);
  for (const [relative, contents] of templateFiles(name, bundleId, picked.template)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(root), {
    forceNewWindow: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
  });
}
