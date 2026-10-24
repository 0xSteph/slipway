import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { GoIos } from "./bridge/goios";
import { launchPath } from "./bridge/parse";
import { DeviceManager } from "./devices";
import { projectWarnings } from "./freeAccount";
import { findProject } from "./project/project";
import { Tools } from "./tools";
import { compareVersions, parseSemver } from "./util/version";
import {
  XTOOL_MAX_EXCLUSIVE,
  XTOOL_MIN,
  parseAuthStatus,
  parseSdkStatus,
  parseXtoolVersion,
} from "./xtool/parse";

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface Fix {
  title: string;
  command: string;
  args?: unknown[];
}

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: Fix;
}

export const SWIFT_EXTENSION_ID = "swiftlang.swift-vscode";
const XTOOL_INSTALL =
  'mkdir -p ~/.local/bin && curl -fL "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" -o ~/.local/bin/xtool && chmod +x ~/.local/bin/xtool';

function copyFix(title: string, text: string): Fix {
  return {
    title,
    command: "slipway.copyToClipboard",
    args: [text, `${title}: copied. Paste it into a terminal.`],
  };
}

function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/** Runs every setup check in dependency order. Commands that touch Apple's servers are never run here. */
export async function runChecks(
  tools: Tools,
  devices: DeviceManager,
  bridge: GoIos,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => results.push(r);

  if (process.platform === "win32") {
    add({
      id: "host",
      label: "Windows: use WSL",
      status: "fail",
      detail: "Slipway runs on the Linux side. Open this folder in WSL.",
      fix: { title: "Reopen in WSL", command: "remote-wsl.reopenInWSL" },
    });
    return results;
  }
  if (process.platform === "darwin") {
    add({
      id: "host",
      label: "macOS",
      status: "info",
      detail: "On a Mac, Xcode does all of this natively. Slipway targets Linux and WSL.",
    });
  } else {
    add({
      id: "host",
      label: isWsl() ? "Linux (WSL)" : "Linux",
      status: "pass",
      detail: `${process.arch}`,
    });
  }

  const swift = await tools.swift(["--version"], { timeoutMs: 20000 });
  const swiftVersion = parseSemver(/Swift version (\S+)/.exec(swift.stdout)?.[1] ?? "");
  if (!swiftVersion) {
    add({
      id: "swift",
      label: "Swift toolchain",
      status: "fail",
      detail: "Swift isn't installed. Install Swift 6.4 or later with swiftly.",
      fix: {
        title: "Open swift.org/install",
        command: "vscode.open",
        args: [vscode.Uri.parse("https://www.swift.org/install/linux/")],
      },
    });
  } else if (compareVersions(swiftVersion, [6, 4, 0]) < 0) {
    add({
      id: "swift",
      label: `Swift ${swiftVersion.join(".")}`,
      status: "warn",
      detail: "xtool's editor support (.bsp) needs Swift 6.4 or later.",
    });
  } else {
    add({
      id: "swift",
      label: `Swift ${swiftVersion.join(".")}`,
      status: "pass",
      detail: tools.swiftPath() ?? "",
    });
  }
  if (swiftVersion && tools.swiftOnlyViaFallback()) {
    add({
      id: "swiftPath",
      label: "Swift isn't on VS Code's PATH",
      status: "warn",
      detail:
        "Slipway finds it, but the Swift extension and xtool's editor server may not. swiftly only adds itself in ~/.zprofile; add it to ~/.profile and log out and back in.",
      fix: copyFix("Copy the fix", `echo '. "$HOME/.local/share/swiftly/env.sh"' >> ~/.profile`),
    });
  }

  const swiftExt = vscode.extensions.getExtension(SWIFT_EXTENSION_ID);
  add(
    swiftExt
      ? {
          id: "swiftExt",
          label: "Swift extension",
          status: "pass",
          detail: `v${swiftExt.packageJSON.version}`,
        }
      : {
          id: "swiftExt",
          label: "Swift extension",
          status: "warn",
          detail: "Recommended for completion and live errors.",
          fix: {
            title: "Install",
            command: "workbench.extensions.installExtension",
            args: [SWIFT_EXTENSION_ID],
          },
        },
  );

  const xtoolOut = await tools.xtool(["--version"], { timeoutMs: 20000 });
  const xtoolVersion = parseXtoolVersion(xtoolOut.stdout);
  if (!xtoolVersion) {
    add({
      id: "xtool",
      label: "xtool",
      status: "fail",
      detail: "xtool isn't installed.",
      fix: copyFix("Copy install command", XTOOL_INSTALL),
    });
    return results;
  }
  const tooOld = compareVersions(xtoolVersion, [...XTOOL_MIN]) < 0;
  const untested = compareVersions(xtoolVersion, [...XTOOL_MAX_EXCLUSIVE]) >= 0;
  add({
    id: "xtool",
    label: `xtool ${xtoolVersion.join(".")}`,
    status: tooOld ? "fail" : untested ? "warn" : "pass",
    detail: tooOld
      ? `Slipway needs xtool ${XTOOL_MIN.join(".")} or later (older versions can't sign in to Apple).`
      : untested
        ? "Newer than the versions Slipway was tested with."
        : (tools.xtoolPath() ?? ""),
    fix: tooOld ? copyFix("Copy update command", XTOOL_INSTALL) : undefined,
  });

  const sdk = parseSdkStatus((await tools.xtool(["sdk", "status"], { timeoutMs: 20000 })).stdout);
  add(
    sdk.installed
      ? {
          id: "sdk",
          label: "iOS SDK",
          status: isWsl() && sdk.path?.startsWith("/mnt/") ? "warn" : "pass",
          detail:
            isWsl() && sdk.path?.startsWith("/mnt/")
              ? "The SDK is on the Windows drive, which makes builds slow. Reinstall it inside Linux."
              : (sdk.path ?? ""),
        }
      : {
          id: "sdk",
          label: "iOS SDK",
          status: "fail",
          detail: "Download Xcode from Apple, then let xtool extract the iOS SDK from it.",
          fix: { title: "Set up", command: "slipway.installSdk" },
        },
  );

  const auth = parseAuthStatus(
    (await tools.xtool(["auth", "status"], { timeoutMs: 20000 })).stdout,
  );
  add(
    auth.loggedIn
      ? {
          id: "auth",
          label: "Signed in to Apple",
          status: "pass",
          detail: auth.mode === "apiKey" ? "App Store Connect API key" : (auth.appleId ?? ""),
          fix: { title: "Sign out", command: "slipway.signOut" },
        }
      : {
          id: "auth",
          label: "Apple sign-in",
          status: "fail",
          detail: "Needed to sign apps for your iPhone.",
          fix: { title: "Sign in", command: "slipway.signIn" },
        },
  );

  await devices.refresh();
  const device = devices.selected;
  if (!device) {
    const muxd = existsSync("/var/run/usbmuxd");
    add({
      id: "device",
      label: "iPhone",
      status: "warn",
      detail: muxd
        ? devices.all.length > 1
          ? "Several devices are connected. Choose one."
          : "No iPhone connected. Plug it in, unlock it and tap Trust."
        : isWsl()
          ? "No iPhone visible. Attach it to WSL with usbipd (usbipd attach --wsl --busid <id>)."
          : "No iPhone connected. Plug it in, unlock it and tap Trust. (usbmuxd starts when a phone is plugged in.)",
      fix:
        devices.all.length > 1 ? { title: "Choose", command: "slipway.selectDevice" } : undefined,
    });
  } else {
    add({
      id: "device",
      label: device.name,
      status: "pass",
      detail: device.info?.iosVersion
        ? `iOS ${device.info.iosVersion}`
        : device.udid.slice(0, 8) + "…",
    });
  }

  add(
    bridge.installed
      ? {
          id: "bridge",
          label: "Device bridge (go-ios)",
          status: "pass",
          detail: tools.goIosPath() ?? "",
        }
      : {
          id: "bridge",
          label: "Device bridge (go-ios)",
          status: "warn",
          detail: "Needed to launch apps, stream logs and fetch crashes on iOS 17+.",
          fix: { title: "Install", command: "slipway.installBridge" },
        },
  );

  if (device && bridge.installed) {
    const version = device.info?.iosVersion;
    const route = version ? launchPath(version) : undefined;
    if (route === "unsupported") {
      add({
        id: "ios",
        label: `iOS ${version}`,
        status: "warn",
        detail: "Apps install, but launching from Linux needs iOS 17.4.1 or later.",
      });
    }
    const devMode = await bridge.devMode(device.udid);
    add(
      devMode === true
        ? { id: "devMode", label: "Developer Mode", status: "pass", detail: "On" }
        : {
            id: "devMode",
            label: "Developer Mode",
            status: devMode === false ? "fail" : "warn",
            detail:
              devMode === false
                ? "Off. Settings → Privacy & Security → Developer Mode, then restart the phone."
                : "Couldn't check. Unlock the phone.",
            fix: { title: "Show the setting", command: "slipway.revealDevMode" },
          },
    );
    if (route === "tunnel") {
      const mounted = await bridge.imageMounted(device.udid);
      add(
        mounted
          ? { id: "ddi", label: "Developer disk image", status: "pass", detail: "Mounted" }
          : {
              id: "ddi",
              label: "Developer disk image",
              status: "warn",
              detail: "Needed to launch apps. Mounted automatically on first Run, or now.",
              fix: { title: "Prepare", command: "slipway.prepareDevice" },
            },
      );
    }
  }

  const project = findProject();
  if (project) {
    const bsp = path.join(project.root, ".bsp", "xtool.json");
    const legacy = path.join(project.root, ".sourcekit-lsp", "config.json");
    const lspOk = existsSync(bsp) || existsSync(legacy);
    add(
      project.config.skipLSP
        ? {
            id: "lsp",
            label: "Editor setup",
            status: "info",
            detail: "skipLSP is set in xtool.yml.",
          }
        : lspOk
          ? {
              id: "lsp",
              label: "Editor uses the iOS SDK",
              status: "pass",
              detail: existsSync(bsp) ? ".bsp/xtool.json" : ".sourcekit-lsp/config.json",
            }
          : {
              id: "lsp",
              label: "Editor setup",
              status: "warn",
              detail: "xtool writes it on the first build.",
              fix: { title: "Build", command: "slipway.build" },
            },
    );
    const w = projectWarnings(project);
    if (w.droppedCapabilities.length > 0 && auth.mode !== "apiKey") {
      add({
        id: "caps",
        label: "Paid-only capabilities",
        status: "warn",
        detail: `A free account removes: ${w.droppedCapabilities.join(", ")}.`,
      });
    }
    if (w.assetCatalogs.length > 0) {
      add({
        id: "assets",
        label: "Asset catalog",
        status: "warn",
        detail: ".xcassets can't be compiled on Linux yet (xtool #310).",
        fix: { title: "Convert AppIcon", command: "slipway.convertAppIcon" },
      });
    }
  }
  return results;
}

const ICONS: Record<CheckStatus, vscode.ThemeIcon> = {
  pass: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  warn: new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
  fail: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
  info: new vscode.ThemeIcon("info"),
};

export class DoctorView implements vscode.TreeDataProvider<CheckResult>, vscode.Disposable {
  private results: CheckResult[] = [];
  private running: Promise<void> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly check: () => Promise<CheckResult[]>) {}

  refresh(): Promise<void> {
    this.running ??= this.check()
      .then((r) => {
        this.results = r;
      })
      .finally(() => {
        this.running = undefined;
        this.changed.fire();
      });
    return this.running;
  }

  get current(): readonly CheckResult[] {
    return this.results;
  }

  getTreeItem(r: CheckResult): vscode.TreeItem {
    const item = new vscode.TreeItem(r.label);
    item.description = r.detail;
    item.tooltip = new vscode.MarkdownString(
      `**${r.label}**\n\n${r.detail}${r.fix ? `\n\nFix: ${r.fix.title}` : ""}`,
    );
    item.iconPath = ICONS[r.status];
    item.contextValue = r.fix ? "fixable" : undefined;
    if (r.fix) item.command = { title: r.fix.title, command: r.fix.command, arguments: r.fix.args };
    return item;
  }

  getChildren(element?: CheckResult): CheckResult[] {
    if (element) return [];
    return this.results.length > 0 || this.running
      ? this.results
      : [{ id: "loading", label: "Checking…", status: "info", detail: "" }];
  }

  dispose(): void {
    this.changed.dispose();
  }
}
