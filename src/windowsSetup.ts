import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CheckResult } from "./doctor";
import { run } from "./util/process";
import {
  APPLE_MUX_PORT,
  canConnect,
  parseWslDistros,
  withMirroredNetworking,
  wslConfigIsMirrored,
} from "./util/wsl";

export const WSL_EXTENSION_ID = "ms-vscode-remote.remote-wsl";
const APPLE_DEVICES_STORE = "https://apps.microsoft.com/search?query=Apple%20Devices";

const wslConfigPath = () => path.join(os.homedir(), ".wslconfig");

/**
 * On Windows itself Slipway only sets things up: xtool and the Swift toolchain run
 * inside WSL, so the project is reopened there and the extension runs on that side.
 */
export async function windowsChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [
    {
      id: "host",
      label: "Windows",
      status: "info",
      detail:
        "Slipway's tools run in WSL (Linux inside Windows). Finish these steps once, then reopen the folder in WSL.",
    },
  ];

  const list = await run("wsl.exe", ["-l", "-q"], {
    env: { ...process.env, WSL_UTF8: "1" },
    timeoutMs: 15000,
  });
  const distros = list.code === 0 ? parseWslDistros(list.stdout) : [];
  results.push(
    distros.length > 0
      ? { id: "wsl", label: "WSL", status: "pass", detail: distros.join(", ") }
      : {
          id: "wsl",
          label: "WSL",
          status: "fail",
          detail:
            "Install WSL with Ubuntu: run `wsl --install -d Ubuntu-24.04` in an administrator PowerShell, then restart.",
          fix: {
            title: "Copy command",
            command: "slipway.copyToClipboard",
            args: [
              "wsl --install -d Ubuntu-24.04",
              "Copied. Paste it into an administrator PowerShell.",
            ],
          },
        },
  );

  results.push(
    vscode.extensions.getExtension(WSL_EXTENSION_ID)
      ? { id: "wslExt", label: "VS Code WSL extension", status: "pass", detail: "Installed" }
      : {
          id: "wslExt",
          label: "VS Code WSL extension",
          status: "fail",
          detail: "Lets VS Code open folders inside WSL.",
          fix: {
            title: "Install",
            command: "workbench.extensions.installExtension",
            args: [WSL_EXTENSION_ID],
          },
        },
  );

  const relay = await canConnect("127.0.0.1", APPLE_MUX_PORT);
  results.push(
    relay
      ? {
          id: "appleDevices",
          label: "Apple Devices service",
          status: "pass",
          detail: `Running on port ${APPLE_MUX_PORT}. Plug in the iPhone and tap Trust.`,
        }
      : {
          id: "appleDevices",
          label: "Apple Devices service",
          status: "warn",
          detail:
            "Install Apple's free Apple Devices app from the Microsoft Store; it provides the iPhone driver. (Alternative: forward USB with usbipd-win.)",
          fix: {
            title: "Open Microsoft Store",
            command: "vscode.open",
            args: [vscode.Uri.parse(APPLE_DEVICES_STORE)],
          },
        },
  );

  const config = existsSync(wslConfigPath()) ? readFileSync(wslConfigPath(), "utf8") : "";
  results.push(
    wslConfigIsMirrored(config)
      ? {
          id: "mirrored",
          label: "WSL mirrored networking",
          status: "pass",
          detail: "WSL can reach the Apple Devices service.",
        }
      : {
          id: "mirrored",
          label: "WSL mirrored networking",
          status: relay ? "warn" : "info",
          detail:
            "Lets WSL reach the iPhone through Apple's service (Windows 11 22H2 or later). Not needed if you use usbipd.",
          fix: { title: "Turn on", command: "slipway.enableMirroredNetworking" },
        },
  );

  results.push({
    id: "openInWsl",
    label: "Open this folder in WSL",
    status:
      distros.length > 0 && vscode.extensions.getExtension(WSL_EXTENSION_ID) ? "warn" : "info",
    detail:
      "Build and Run work from the WSL side. Keep projects in the Linux filesystem (for example ~/apps), not on C:.",
    fix: { title: "Reopen in WSL", command: "remote-wsl.reopenInWSL" },
  });
  return results;
}

export async function enableMirroredNetworking(): Promise<void> {
  const file = wslConfigPath();
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const choice = await vscode.window.showInformationMessage(
    "Turn on WSL mirrored networking?",
    {
      modal: true,
      detail: `Slipway adds networkingMode=mirrored under [wsl2] in ${file}. Everything else in the file stays as it is. WSL must restart afterwards (wsl --shutdown), which closes open WSL windows.`,
    },
    "Turn On",
  );
  if (choice !== "Turn On") return;
  await writeFile(file, withMirroredNetworking(before));
  const restart = await vscode.window.showInformationMessage(
    "Done. Restart WSL now?",
    "Restart WSL",
  );
  if (restart) await run("wsl.exe", ["--shutdown"], { timeoutMs: 30000 });
}
