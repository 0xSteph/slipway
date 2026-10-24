import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { GoIos } from "./bridge/goios";
import { installGoIos } from "./bridge/installer";
import { Builder } from "./build/builder";
import { Crashes } from "./crashes";
import { DeviceManager } from "./devices";
import { DeviceLog } from "./deviceLog";
import { collectDiagnostics } from "./diagnosticsBundle";
import { CheckResult, DoctorView, runChecks } from "./doctor";
import { FreeAccount, describeExpiry, largestAppIcon, projectWarnings } from "./freeAccount";
import { LspStatus } from "./lspStatus";
import { newApp } from "./newApp";
import { findBuiltApp, findProject } from "./project/project";
import { RunController } from "./run";
import { XCODE_DOWNLOADS, installSdk, signIn, signOut } from "./setup";
import { SlipwayTaskProvider } from "./tasks";
import { Tools } from "./tools";

/** The returned object is for Slipway's own integration tests, not a public API. */
export function activate(context: vscode.ExtensionContext): {
  checks: () => readonly CheckResult[];
} {
  const log = vscode.window.createOutputChannel("Slipway", { log: true });
  const tools = new Tools(context.globalStorageUri, log);
  void mkdir(tools.storageDir, { recursive: true });

  const bridge = new GoIos(tools);
  const freeAccount = new FreeAccount(context.globalState, tools);
  const devices = new DeviceManager(tools, bridge, context.workspaceState);
  devices.expiryText = (device) => freeAccount.expiryText(device.udid);
  const builder = new Builder(tools);
  const deviceLog = new DeviceLog(bridge);
  const crashes = new Crashes(bridge, tools.storageDir);
  const runner = new RunController(
    tools,
    builder,
    devices,
    bridge,
    deviceLog,
    crashes,
    freeAccount,
    context.globalState,
  );
  const doctor = new DoctorView(() => runChecks(tools, devices, bridge));
  const lsp = new LspStatus();

  const isProject = () =>
    void vscode.commands.executeCommand(
      "setContext",
      "slipway.isProject",
      findProject() !== undefined,
    );
  isProject();

  const offeredRefresh = new Set<string>();
  const offerRefresh = async () => {
    const device = devices.selected;
    if (!device) return;
    for (const record of freeAccount.expiringSoon(device.udid)) {
      const key = `${record.udid}/${record.bundleId}`;
      if (offeredRefresh.has(key)) continue;
      offeredRefresh.add(key);
      const choice = await vscode.window.showInformationMessage(
        `${record.bundleId} on ${device.name}: ${describeExpiry(record)}. Reinstall it now to reset the 7-day limit?`,
        "Refresh",
      );
      if (choice) await runner.refreshApp();
    }
  };

  const command = (id: string, handler: (...args: never[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: never[]) => {
        try {
          await handler(...args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`${id}: ${message}`);
          void vscode.window.showErrorMessage(message);
        }
      }),
    );

  command("slipway.doctor.refresh", () => doctor.refresh());
  command("slipway.doctor.fix", (item: { fix?: { command: string; args?: unknown[] } }) =>
    item.fix
      ? vscode.commands.executeCommand(item.fix.command, ...(item.fix.args ?? []))
      : undefined,
  );
  command("slipway.copyToClipboard", async (text: string, message: string) => {
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(message);
  });
  command("slipway.getXcode", () => vscode.env.openExternal(vscode.Uri.parse(XCODE_DOWNLOADS)));
  command("slipway.installSdk", async () => {
    await installSdk(tools);
    await doctor.refresh();
  });
  command("slipway.signIn", async () => {
    await signIn(tools, context.globalState);
    await doctor.refresh();
  });
  command("slipway.signOut", async () => {
    await signOut(tools);
    await doctor.refresh();
  });
  command("slipway.newApp", () => newApp());
  command("slipway.build", () => runner.build());
  command("slipway.run", () => runner.run());
  command("slipway.stop", () => runner.stop());
  command("slipway.selectDevice", () => devices.pick());
  command("slipway.showDeviceLog", () => deviceLog.channel.show());
  command("slipway.clearDeviceLog", () => deviceLog.channel.clear());
  command("slipway.toggleAllDeviceLogs", async () => {
    const config = vscode.workspace.getConfiguration("slipway");
    const next = !config.get<boolean>("deviceLog.showAllProcesses", false);
    await config.update("deviceLog.showAllProcesses", next, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      next ? "Device log: showing all processes." : "Device log: showing only your app.",
    );
  });
  command("slipway.fetchCrashReports", async () => {
    const project = findProject();
    const app = project && findBuiltApp(project);
    const device = devices.selected ?? (await devices.pick());
    if (!app || !device) {
      void vscode.window.showWarningMessage("Build the app and connect the device first.");
      return;
    }
    if (!(await runner.ensureBridge())) return;
    const copied = await crashes.fetchNew(device.udid, app.executable);
    if (copied.length === 0)
      void vscode.window.showInformationMessage(`No new crash reports for ${app.executable}.`);
  });
  command("slipway.refreshApp", () => runner.refreshApp());
  command("slipway.checkAppIds", async () => {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Asking Apple for your App IDs…" },
      () => freeAccount.appIdCount(),
    );
    if (!result) {
      void vscode.window.showErrorMessage("Couldn't list App IDs. Are you signed in?");
      return;
    }
    const project = findProject();
    const bundleId = project?.config.bundleID;
    const known = bundleId ? result.identifiers.some((i) => i.endsWith(`.${bundleId}`)) : true;
    void vscode.window.showInformationMessage(
      `${result.count} of 10 App IDs in use this week on a free account.` +
        (bundleId && !known ? ` Building ${bundleId} will register a new one.` : ""),
      { detail: result.identifiers.join("\n"), modal: true },
    );
  });
  command("slipway.installBridge", async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Downloading go-ios…" },
      () => installGoIos(tools.storageDir),
    );
    void vscode.window.showInformationMessage("go-ios installed.");
    await doctor.refresh();
  });
  command("slipway.prepareDevice", async () => {
    const device = devices.selected ?? (await devices.pick());
    if (!device) return;
    if (await runner.prepareDevice(device))
      void vscode.window.showInformationMessage(`${device.name} is ready to launch apps.`);
    await doctor.refresh();
  });
  command("slipway.revealDevMode", async () => {
    const device = devices.selected ?? (await devices.pick());
    if (!device || !(await runner.ensureBridge())) return;
    await bridge.revealDevMode(device.udid);
    void vscode.window.showInformationMessage(
      "On the phone: Settings → Privacy & Security → Developer Mode, then restart it.",
    );
  });
  command("slipway.convertAppIcon", async () => {
    const project = findProject();
    if (!project) return;
    const catalog = projectWarnings(project).assetCatalogs[0];
    const icon = catalog && largestAppIcon(catalog);
    if (!icon) {
      void vscode.window.showWarningMessage("No AppIcon.appiconset with PNGs found.");
      return;
    }
    const target = path.join(project.root, "Resources", "AppIcon.png");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(icon, target);
    const yml = path.join(project.root, "xtool.yml");
    const text = await readFile(yml, "utf8");
    const updated = /^iconPath:/m.test(text)
      ? text.replace(/^iconPath:.*$/m, "iconPath: Resources/AppIcon.png")
      : `${text.trimEnd()}\niconPath: Resources/AppIcon.png\n`;
    await writeFile(yml, updated);
    void vscode.window.showInformationMessage(
      `Copied ${path.basename(icon)} to Resources/AppIcon.png and set iconPath. Remove the .xcassets folder from your sources so the build doesn't try to compile it.`,
    );
  });
  command("slipway.collectDiagnostics", () =>
    collectDiagnostics(
      tools,
      devices,
      doctor.current,
      context.extension.packageJSON.version,
      builder.lastLog,
    ),
  );

  context.subscriptions.push(
    log,
    devices,
    builder,
    deviceLog,
    runner,
    doctor,
    lsp,
    vscode.window.registerTreeDataProvider("slipway.doctor", doctor),
    vscode.tasks.registerTaskProvider("slipway", new SlipwayTaskProvider(runner)),
    devices.onDidChange(() => {
      void offerRefresh();
      if (doctor.current.length > 0) void doctor.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      isProject();
      lsp.update();
    }),
  );

  void doctor.refresh();
  return { checks: () => doctor.current };
}

export function deactivate(): void {}
