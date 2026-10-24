import * as vscode from "vscode";
import { GoIos } from "./bridge/goios";
import { DeviceInfo } from "./bridge/parse";
import { Tools } from "./tools";
import { XtoolDevice, parseDevices } from "./xtool/parse";

export interface Device extends XtoolDevice {
  info?: DeviceInfo;
}

const SELECTED_KEY = "slipway.selectedDevice";
const POLL_MS = 3000;

/** Polls `xtool devices --no-wait` while the window is focused and owns the status-bar picker. */
export class DeviceManager implements vscode.Disposable {
  private devices: Device[] = [];
  private readonly item = vscode.window.createStatusBarItem(
    "slipway.device",
    vscode.StatusBarAlignment.Left,
    50,
  );
  private readonly changed = new vscode.EventEmitter<void>();
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  readonly onDidChange = this.changed.event;
  expiryText: ((device: Device) => string | undefined) | undefined;

  constructor(
    private readonly tools: Tools,
    private readonly bridge: GoIos,
    private readonly state: vscode.Memento,
  ) {
    this.item.name = "Slipway Device";
    this.item.command = "slipway.selectDevice";
    this.render();
    this.item.show();
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh();
    }, POLL_MS);
  }

  get all(): readonly Device[] {
    return this.devices;
  }

  get selected(): Device | undefined {
    const udid = this.state.get<string>(SELECTED_KEY);
    return (
      this.devices.find((d) => d.udid === udid) ??
      (this.devices.length === 1 ? this.devices[0] : undefined)
    );
  }

  async refresh(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await this.tools.xtool(["devices", "--usb", "--no-wait"], {
        timeoutMs: 10000,
      });
      const found = result.code === 0 ? parseDevices(result.stdout) : [];
      const before = this.devices.map((d) => d.udid).join(",");
      this.devices = found.map((d) => ({
        ...d,
        info: this.devices.find((old) => old.udid === d.udid)?.info,
      }));
      for (const device of this.devices) {
        if (!device.info && this.bridge.installed) {
          device.info = await this.bridge.info(device.udid).catch(() => undefined);
        }
      }
      if (before !== this.devices.map((d) => d.udid).join(",")) this.changed.fire();
      this.render();
    } finally {
      this.polling = false;
    }
  }

  async pick(): Promise<Device | undefined> {
    await this.refresh();
    if (this.devices.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        "No iPhone found. Plug it in with a USB cable, unlock it and tap Trust.",
        "Open Doctor",
      );
      if (choice) await vscode.commands.executeCommand("slipway.doctor.focus");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      this.devices.map((d) => ({
        label: d.name,
        description: d.info?.iosVersion ? `iOS ${d.info.iosVersion}` : d.connection,
        detail: this.expiryText?.(d),
        device: d,
      })),
      { placeHolder: "Run on which device?" },
    );
    if (!picked) return undefined;
    await this.state.update(SELECTED_KEY, picked.device.udid);
    this.render();
    this.changed.fire();
    return picked.device;
  }

  render(): void {
    const device = this.selected;
    if (!device) {
      this.item.text = "$(device-mobile) No device";
      this.item.tooltip = "Slipway: no iPhone connected. Click to choose one.";
      return;
    }
    this.item.text = `$(device-mobile) ${device.name}`;
    const lines = [
      device.info?.iosVersion ? `iOS ${device.info.iosVersion}` : undefined,
      this.expiryText?.(device),
    ];
    this.item.tooltip = ["Slipway: run on this device", ...lines.filter(Boolean)].join("\n");
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
    this.changed.dispose();
  }
}
