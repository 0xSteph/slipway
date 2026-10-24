import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { GO_IOS_VERSION } from "./bridge/parse";
import { DeviceManager } from "./devices";
import { CheckResult } from "./doctor";
import { Tools } from "./tools";
import { redact } from "./util/redact";

/** Writes a Markdown report for bug reports. Redacted by default; never reads ~/.config/xtool. */
export async function collectDiagnostics(
  tools: Tools,
  devices: DeviceManager,
  checks: readonly CheckResult[],
  extensionVersion: string,
  buildLog: string,
): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Redacted (recommended)",
        description: "hides Apple ID, team ID, device IDs and your home folder",
        redacted: true,
      },
      { label: "Not redacted", description: "only for sharing privately", redacted: false },
    ],
    { placeHolder: "Collect diagnostics for a bug report" },
  );
  if (!choice) return;

  const version = async (run: Promise<{ stdout: string }>) =>
    (await run).stdout.trim().split("\n")[0] || "not found";
  const device = devices.selected;
  const lines = [
    "# Slipway diagnostics",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Slipway: ${extensionVersion}`,
    `- VS Code: ${vscode.version} (${vscode.env.appHost}, remote: ${vscode.env.remoteName ?? "none"})`,
    `- OS: ${os.type()} ${os.release()} ${os.arch()}`,
    `- Swift: ${await version(tools.swift(["--version"], { timeoutMs: 20000 }))}`,
    `- xtool: ${await version(tools.xtool(["--version"], { timeoutMs: 20000 }))}`,
    `- go-ios: ${tools.goIosPath() ? GO_IOS_VERSION : "not installed"}`,
    `- Device: ${device ? `${device.info?.productType ?? "?"}, iOS ${device.info?.iosVersion ?? "?"} (${device.udid})` : "none"}`,
    "",
    "## Doctor",
    "",
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.label} | ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Last build log (last 500 lines)",
    "",
    "```",
    buildLog.split("\n").slice(-500).join("\n"),
    "```",
    "",
  ];
  let report = lines.join("\n");
  if (choice.redacted) report = redact(report, { home: os.homedir() });

  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      path.join(os.homedir(), `slipway-diagnostics-${new Date().toISOString().slice(0, 10)}.md`),
    ),
    filters: { Markdown: ["md"] },
  });
  if (!target) return;
  await writeFile(target.fsPath, report);
  await vscode.window.showTextDocument(target);
}
