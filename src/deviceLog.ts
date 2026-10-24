import * as vscode from "vscode";
import { GoIos } from "./bridge/goios";
import { SyslogEntry, baseProcessName, parseSyslogLine } from "./bridge/parse";
import { RunningProcess } from "./util/process";

const MAX_KEPT_LINES = 5000;

/** Streams the device syslog into a log channel, filtered to the running app by default. */
export class DeviceLog implements vscode.Disposable {
  readonly channel = vscode.window.createOutputChannel("Slipway: Device Log", { log: true });
  private stream: RunningProcess | undefined;
  private process: string | undefined;
  private sinceLaunch: string[] = [];
  private stopped = false;
  private generation = 0;

  constructor(private readonly bridge: GoIos) {}

  get showAll(): boolean {
    return vscode.workspace
      .getConfiguration("slipway")
      .get<boolean>("deviceLog.showAllProcesses", false);
  }

  start(udid: string, processName: string): void {
    this.stop();
    this.stopped = false;
    this.process = processName;
    this.sinceLaunch = [];
    const generation = ++this.generation;
    const begin = (restarted: boolean) => {
      this.stream = this.bridge.syslog(udid, (line) => {
        const entry = parseSyslogLine(line);
        if (!entry) return;
        if (!this.showAll && baseProcessName(entry.process) !== this.process) return;
        this.write(entry);
      });
      void this.stream?.done.then(() => {
        // A stream from an earlier start() ending must not restart anything.
        if (this.stopped || generation !== this.generation) return;
        if (!restarted)
          setTimeout(() => !this.stopped && generation === this.generation && begin(true), 2000);
        else this.channel.warn("Device log stream ended. Run again to reconnect.");
      });
    };
    begin(false);
  }

  private write(entry: SyslogEntry): void {
    const prefix = this.showAll && entry.process ? `[${entry.process}] ` : "";
    const text = prefix + entry.message;
    this.sinceLaunch.push(text);
    if (this.sinceLaunch.length > MAX_KEPT_LINES) this.sinceLaunch.shift();
    switch (entry.level) {
      case "Error":
      case "Fault":
        this.channel.error(text);
        break;
      case "Debug":
        this.channel.debug(text);
        break;
      default:
        this.channel.info(text);
    }
  }

  textSinceLaunch(): string {
    return this.sinceLaunch.join("\n");
  }

  stop(): void {
    this.stopped = true;
    this.stream?.kill();
    this.stream = undefined;
  }

  dispose(): void {
    this.stop();
    this.channel.dispose();
  }
}
