import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { BridgeError, GoIos } from "./bridge/goios";
import { installGoIos, writeCaBundle } from "./bridge/installer";
import { launchPath } from "./bridge/parse";
import { Builder } from "./build/builder";
import { Crashes } from "./crashes";
import { Device, DeviceManager } from "./devices";
import { DeviceLog } from "./deviceLog";
import { FreeAccount, projectWarnings } from "./freeAccount";
import { BuiltApp, readBuiltApp } from "./project/config";
import { Project, findBuiltApp, findProject } from "./project/project";
import { Tools } from "./tools";
import {
  authErrorHint,
  isBannedProfileError,
  parseErrorLine,
  parseInstallProgress,
  parseRevocationPrompt,
} from "./xtool/parse";

const DDI_CONSENT_KEY = "slipway.ddiConsent";

interface Session {
  udid: string;
  app: BuiltApp;
  /** The `XTL-…` bundle ID xtool installed the app under. */
  installedId: string;
  pid?: number;
}

export class RunController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    "slipway.run",
    vscode.StatusBarAlignment.Left,
    49,
  );
  private abort: AbortController | undefined;
  private session: Session | undefined;
  private watcher: NodeJS.Timeout | undefined;
  private warnedProjects = new Set<string>();

  constructor(
    private readonly tools: Tools,
    private readonly builder: Builder,
    private readonly devices: DeviceManager,
    private readonly bridge: GoIos,
    private readonly deviceLog: DeviceLog,
    private readonly crashes: Crashes,
    private readonly freeAccount: FreeAccount,
    private readonly state: vscode.Memento,
  ) {
    this.item.name = "Slipway Run";
    this.idle();
    this.item.show();
  }

  private get log(): vscode.LogOutputChannel {
    return this.tools.log;
  }

  private status(text: string, command = "slipway.stop", tooltip = "Slipway: click to stop"): void {
    this.item.text = text;
    this.item.command = command;
    this.item.tooltip = tooltip;
  }

  private idle(text = "$(play) Run"): void {
    this.status(text, "slipway.run", "Slipway: build and run on the selected device");
  }

  async build(): Promise<BuiltApp | undefined> {
    const project = this.requireProject();
    if (!project) return undefined;
    this.abort?.abort();
    this.abort = new AbortController();
    return this.buildProject(project, this.abort.signal);
  }

  async run(): Promise<void> {
    const project = this.requireProject();
    if (!project) return;
    const device = this.devices.selected ?? (await this.devices.pick());
    if (!device) return;
    if (this.session || this.abort) await this.stop();
    this.abort = new AbortController();
    const signal = this.abort.signal;

    try {
      this.warnAboutProject(project);
      const app = await this.buildProject(project, signal);
      if (!app || signal.aborted) return;
      if (!(await this.install(device, app, signal))) return;
      await this.launch(device, app, signal);
    } catch (error) {
      if (signal.aborted) return;
      this.deviceLog.stop();
      this.idle("$(error) Run failed");
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(message);
      void vscode.window.showErrorMessage(message, "Show Log").then((c) => c && this.log.show());
    } finally {
      if (this.abort?.signal === signal) this.abort = undefined;
    }
  }

  /** Reinstalls a previous build without rebuilding; xtool re-signs it with a fresh 7-day profile. */
  async refreshApp(target?: { appPath: string; udid: string }): Promise<void> {
    let app: BuiltApp | undefined;
    if (target) {
      app = existsSync(target.appPath) ? readBuiltApp(target.appPath) : undefined;
    } else {
      const project = this.requireProject();
      if (!project) return;
      app = findBuiltApp(project);
    }
    if (!app) {
      void vscode.window.showWarningMessage(
        "There's no build to reinstall yet. Run the app once first.",
      );
      return;
    }
    const device = target
      ? this.devices.all.find((d) => d.udid === target.udid)
      : (this.devices.selected ?? (await this.devices.pick()));
    if (!device) return;
    if (this.session || this.abort) await this.stop();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      if (await this.install(device, app, signal)) {
        this.idle();
        void vscode.window.showInformationMessage(
          `Reinstalled ${app.executable}. It's good for another 7 days.`,
        );
      }
    } catch (error) {
      if (!signal.aborted)
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      this.idle();
    } finally {
      if (this.abort?.signal === signal) this.abort = undefined;
    }
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = undefined;
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
    const session = this.session;
    this.session = undefined;
    if (session && this.bridge.installed) {
      await this.bridge
        .kill(session.udid, { pid: session.pid, bundleId: session.installedId })
        .catch(() => undefined);
    }
    this.deviceLog.stop();
    this.idle();
  }

  private requireProject(): Project | undefined {
    const project = findProject();
    if (!project) {
      void vscode.window
        .showWarningMessage(
          "Open a folder with an xtool.yml (an xtool project) to build it.",
          "New iOS App",
        )
        .then((c) => c && vscode.commands.executeCommand("slipway.newApp"));
    }
    return project;
  }

  private warnAboutProject(project: Project): void {
    if (this.warnedProjects.has(project.root)) return;
    this.warnedProjects.add(project.root);
    const w = projectWarnings(project);
    if (w.droppedCapabilities.length > 0) {
      void vscode.window.showWarningMessage(
        `On a free Apple account these will be removed from the app: ${w.droppedCapabilities.join(", ")}. Apple only grants them to paid developer accounts.`,
      );
    }
    if (w.failingEntitlements.length > 0) {
      void vscode.window.showWarningMessage(
        `These entitlements need a paid account and will likely make the install fail: ${w.failingEntitlements.join(", ")}.`,
      );
    }
    if (w.assetCatalogs.length > 0) {
      void vscode.window
        .showWarningMessage(
          "Asset catalogs (.xcassets) can't be compiled on Linux yet (xtool #310).",
          "Convert AppIcon",
        )
        .then((c) => c && vscode.commands.executeCommand("slipway.convertAppIcon"));
    }
  }

  private async buildProject(project: Project, signal: AbortSignal): Promise<BuiltApp | undefined> {
    this.status("$(sync~spin) Building…");
    this.log.info(`Building ${project.root}`);
    const result = await this.builder.build(project, (line) => this.log.info(line), signal);
    if (result.cancelled) return undefined;
    if (!result.ok) {
      this.idle("$(error) Build failed");
      void vscode.window
        .showErrorMessage("Build failed. See the Problems panel and the Slipway log.", "Show Log")
        .then((c) => c && this.log.show());
      return undefined;
    }
    this.idle(`$(check) Built in ${result.seconds.toFixed(1)} s`);
    const app = result.appPath ? readBuiltApp(result.appPath) : findBuiltApp(project);
    if (!app)
      this.log.error("Build finished but Slipway couldn't read the built app's Info.plist.");
    return app;
  }

  private async install(device: Device, app: BuiltApp, signal: AbortSignal): Promise<boolean> {
    this.status(`$(cloud-upload) Installing on ${device.name}…`);
    let transcript = "";
    let asked = false;
    let connected = false;
    const proc = this.tools.xtoolStart(["install", "-u", device.udid, app.path], {
      signal,
      onStdoutLine: (line) => {
        if (line.startsWith("Installing to device:")) connected = true;
        const progress = parseInstallProgress(line);
        if (progress)
          this.status(
            `$(cloud-upload) ${progress.stage}${progress.percent !== undefined ? ` ${progress.percent}%` : ""}`,
          );
        if (line.trim()) this.log.info(line);
      },
      onStderrLine: (line) => line.trim() && this.log.info(line),
      onStdoutData: (text, running) => {
        transcript += text;
        const certificates = asked ? undefined : parseRevocationPrompt(transcript);
        if (!certificates) return;
        asked = true;
        void this.confirmRevocation(certificates).then((ok) =>
          running.write(ok ? "yes\n" : "no\n"),
        );
      },
    });
    if (!proc) throw new Error("xtool wasn't found. Open the Slipway Doctor to install it.");
    // Without a matching device xtool waits forever ("Waiting for device to be connected...").
    let gaveUpWaiting = false;
    const noDevice = setTimeout(() => {
      if (connected) return;
      gaveUpWaiting = true;
      proc.kill();
    }, 20000);
    const result = await proc.done;
    clearTimeout(noDevice);
    if (result.cancelled) return false;
    if (gaveUpWaiting)
      throw new Error(
        `${device.name} isn't reachable. Unlock it, check the cable, and tap Trust if asked.`,
      );
    if (result.code !== 0) {
      const all = result.stdout + result.stderr;
      const hint = authErrorHint(all);
      if (hint) throw new Error(hint);
      if (isBannedProfileError(all)) {
        await this.explainBannedProfile();
        this.idle("$(error) Install blocked");
        return false;
      }
      throw new Error(
        `Install failed: ${parseErrorLine(all) ?? `xtool exited with ${result.code}`}`,
      );
    }
    await this.freeAccount.recordInstall({
      udid: device.udid,
      bundleId: app.bundleId,
      appPath: app.path,
      installedAt: Date.now(),
    });
    this.devices.render();
    return true;
  }

  private async confirmRevocation(certificates: string[]): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      "xtool needs to revoke a signing certificate to continue.",
      {
        modal: true,
        detail: `Free accounts can hold only a few development certificates. Revoking one stops apps signed with it (for example by another computer or tool) from opening until they're re-signed.\n\n${certificates.join("\n")}`,
      },
      "Revoke and Continue",
    );
    return choice === "Revoke and Continue";
  }

  private async explainBannedProfile(): Promise<void> {
    await vscode.window.showErrorMessage("Apple refused to sign this app for your free account.", {
      modal: true,
      detail:
        "The error says the provisioning profile is banned. Since September 2026 Apple has been blocking some free developer teams from signing apps. It isn't caused by Slipway or your code, and your Apple ID itself (iCloud, App Store) is not affected.\n\nWhat works: a paid Apple Developer Program membership, or signing in with a different Apple ID.",
    });
  }

  private async launch(device: Device, app: BuiltApp, signal: AbortSignal): Promise<void> {
    const iosVersion =
      device.info?.iosVersion ??
      (this.bridge.installed
        ? (await this.bridge.info(device.udid).catch(() => undefined))?.iosVersion
        : undefined);
    const route = iosVersion ? launchPath(iosVersion) : "tunnel";
    if (route === "unsupported") {
      this.idle(`$(check) Installed on ${device.name}`);
      void vscode.window.showInformationMessage(
        `Installed. Open ${app.executable} on your phone. Launching from Linux needs iOS 17.4.1 or later (this phone has iOS ${iosVersion}).`,
      );
      return;
    }
    // The app is on the phone under xtool's XTL- prefixed ID, which go-ios can look up.
    if (!(await this.ensureBridge())) {
      this.idle(`$(check) Installed on ${device.name}`);
      return;
    }
    const installedId = await this.bridge.installedBundleId(
      device.udid,
      app.bundleId,
      app.executable,
    );
    if (!installedId)
      throw new Error(`Installed, but ${app.bundleId} wasn't found in the phone's app list.`);

    if (route === "xtool") {
      this.status("$(rocket) Launching…");
      const result = await this.tools.xtool(["launch", "-u", device.udid, installedId], {
        signal,
        timeoutMs: 60000,
      });
      if (result.code !== 0)
        throw new Error(
          `Launch failed: ${parseErrorLine(result.stdout + result.stderr) ?? "xtool launch failed"}`,
        );
      this.idle(`$(check) Launched on ${device.name}`);
      return;
    }

    if (!(await this.prepareDevice(device, signal))) {
      this.idle(`$(check) Installed on ${device.name}`);
      return;
    }
    await this.crashes.baseline(device.udid, app.executable);
    this.deviceLog.start(device.udid, app.executable);
    this.status("$(rocket) Launching…");
    await this.bridge.ensureTunnel(device.udid);
    if (signal.aborted) return;
    const pid = await this.bridge.launch(device.udid, installedId, signal);
    if (signal.aborted) {
      // Stop arrived while the launch was in flight.
      await this.bridge.kill(device.udid, { pid, bundleId: installedId }).catch(() => undefined);
      return;
    }
    this.session = { udid: device.udid, app, installedId, pid };
    this.status(`$(debug-stop) Running on ${device.name}`);
    this.log.info(`Launched ${installedId}${pid !== undefined ? ` (pid ${pid})` : ""}`);
    this.deviceLog.channel.show(true);
    this.watchForExit(this.session);
  }

  /** go-ios, the CA bundle and the developer disk image; asks before each download. */
  async prepareDevice(device: Device, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.ensureBridge())) return false;
    if (!existsSync(this.tools.caBundlePath)) await writeCaBundle(this.tools.caBundlePath, signal);

    // go-ios reports false both for "off" and for a failed query, so only warn here;
    // a launch failure later says whether it really was off.
    if ((await this.bridge.devMode(device.udid)) === false) {
      void vscode.window
        .showWarningMessage(
          "Developer Mode may be off on your iPhone. If launching fails, turn it on in Settings → Privacy & Security → Developer Mode and restart the phone.",
          "Show the Setting",
        )
        .then((c) => c && this.bridge.revealDevMode(device.udid).catch(() => undefined));
    }

    if (await this.bridge.imageMounted(device.udid)) return true;
    const consent = this.state.get<boolean>(DDI_CONSENT_KEY);
    const choice = consent
      ? "Download"
      : await vscode.window.showInformationMessage(
          "Launching apps needs Apple's developer disk image on the phone.",
          {
            modal: true,
            detail:
              "go-ios (the open-source device tool Slipway uses) will download Apple's developer disk image from a third-party mirror, deviceboxhq.com, and mount it on your phone. Apple signs it for your device first. Slipway doesn't host or bundle this file.\n\nIf you have the image already (for example from a Mac with Xcode), choose \"Use My Own Folder\".",
          },
          "Download",
          "Use My Own Folder",
        );
    if (choice === "Download") {
      await this.state.update(DDI_CONSENT_KEY, true);
      this.status("$(sync~spin) Preparing phone…");
      await this.bridge.mountImageAuto(device.udid, signal);
      return true;
    }
    if (choice === "Use My Own Folder") {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: "Use This Image Folder",
      });
      if (!folder?.[0]) return false;
      await this.bridge.mountImageFrom(device.udid, folder[0].fsPath);
      return true;
    }
    return false;
  }

  async ensureBridge(): Promise<boolean> {
    if (this.bridge.installed) return true;
    const choice = await vscode.window.showInformationMessage(
      "Launching apps, device logs and crash reports use go-ios, an open-source (MIT) device tool. Download it now?",
      {
        modal: true,
        detail:
          "Slipway downloads the pinned go-ios release from GitHub (about 16 MB), checks its SHA-256, and keeps it in the extension's storage.",
      },
      "Download go-ios",
    );
    if (choice !== "Download go-ios") return false;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Downloading go-ios…" },
      () => installGoIos(this.tools.storageDir),
    );
    return true;
  }

  private watchForExit(session: Session): void {
    let misses = 0;
    let busy = false;
    const watcher = setInterval(async () => {
      // Each `ps` is a fresh RSD handshake and can outlast the interval.
      if (busy || this.session !== session) return;
      busy = true;
      try {
        const running = await this.bridge.ps(session.udid);
        if (this.session !== session || !running) return;
        if (running.some((p) => p.name === session.app.executable)) {
          misses = 0;
          return;
        }
        if (++misses < 2) return;
        clearInterval(watcher);
        if (this.watcher === watcher) this.watcher = undefined;
        this.session = undefined;
        if (!this.abort) this.idle();
        this.log.info(`${session.app.executable} is no longer running.`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (!this.session && !this.abort) this.deviceLog.stop();
        const crashes = await this.crashes
          .fetchNew(session.udid, session.app.executable)
          .catch((e: BridgeError) => {
            this.log.warn(e.message);
            return [];
          });
        if (crashes.length > 0) {
          void vscode.window
            .showWarningMessage(
              `${session.app.executable} crashed. The crash report is open.`,
              "Show All Reports",
            )
            .then(
              (c) =>
                c &&
                vscode.commands.executeCommand("revealFileInOS", this.crashes.folder(session.udid)),
            );
        }
      } finally {
        busy = false;
      }
    }, 2000);
    this.watcher = watcher;
  }

  dispose(): void {
    void this.stop();
    this.bridge.stopAgent();
    this.item.dispose();
  }
}
