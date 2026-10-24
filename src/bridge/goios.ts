import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Tools } from "../tools";
import { ProcessResult, RunningProcess } from "../util/process";
import {
  AGENT_PORT,
  DeviceInfo,
  InstalledApp,
  RunningApp,
  parseApps,
  parseCrashList,
  parseDevMode,
  parseImageMounted,
  parseInfo,
  parseLaunchPid,
  parseLogError,
  parsePs,
} from "./parse";

export class BridgeError extends Error {}

function failure(action: string, result: ProcessResult): BridgeError {
  const detail =
    result.spawnError ??
    parseLogError(result.stderr) ??
    (result.stderr.trim().split("\n").at(-1) || `exit ${result.code}`);
  return new BridgeError(`${action}: ${detail}`);
}

const agentUrl = (route: string) => `http://127.0.0.1:${AGENT_PORT}${route}`;

async function agentGet(route: string): Promise<number | undefined> {
  try {
    const response = await fetch(agentUrl(route), { signal: AbortSignal.timeout(1500) });
    return response.status;
  } catch {
    return undefined;
  }
}

/**
 * Commands per `01_research/output/2026-10-24-bridge-research.md`. Launch, kill and ps
 * need the userspace tunnel agent and a mounted developer disk image; the rest go
 * through usbmuxd directly.
 */
export class GoIos {
  private agent: RunningProcess | undefined;

  constructor(private readonly tools: Tools) {}

  get installed(): boolean {
    return this.tools.goIosPath() !== undefined;
  }

  async info(udid: string): Promise<DeviceInfo> {
    const result = await this.tools.goIos(["info", `--udid=${udid}`], { timeoutMs: 15000 });
    if (result.code !== 0) throw failure("Couldn't read device info", result);
    return parseInfo(result.stdout);
  }

  async devMode(udid: string): Promise<boolean | undefined> {
    const result = await this.tools.goIos(["devmode", "get", `--udid=${udid}`], {
      timeoutMs: 15000,
    });
    return parseDevMode(result.stdout, result.stderr);
  }

  async revealDevMode(udid: string): Promise<void> {
    const result = await this.tools.goIos(["devmode", "reveal", `--udid=${udid}`], {
      timeoutMs: 15000,
    });
    if (result.code !== 0) throw failure("Couldn't show the Developer Mode setting", result);
  }

  async apps(udid: string): Promise<InstalledApp[]> {
    const result = await this.tools.goIos(["apps", `--udid=${udid}`], { timeoutMs: 30000 });
    if (result.code !== 0) throw failure("Couldn't list apps", result);
    return parseApps(result.stdout);
  }

  async imageMounted(udid: string): Promise<boolean> {
    const result = await this.tools.goIos(["image", "list", `--udid=${udid}`], {
      timeoutMs: 15000,
    });
    return parseImageMounted(result.stderr);
  }

  /** go-ios fetches Apple's image from its mirror; callers must have the user's consent. */
  async mountImageAuto(udid: string, signal?: AbortSignal): Promise<void> {
    const basedir = path.join(this.tools.storageDir, "devimages");
    await mkdir(basedir, { recursive: true });
    const result = await this.tools.goIos(
      ["image", "auto", `--basedir=${basedir}`, `--udid=${udid}`],
      { timeoutMs: 300000, signal },
    );
    // `image auto` exits 0 when the download fails, so confirm with `image list`.
    if (result.code !== 0 || !(await this.imageMounted(udid)))
      throw failure("Couldn't mount the developer disk image", result);
  }

  async mountImageFrom(udid: string, folder: string): Promise<void> {
    const result = await this.tools.goIos(
      ["image", "mount", `--path=${folder}`, `--udid=${udid}`],
      { timeoutMs: 120000 },
    );
    if (result.code !== 0 || !(await this.imageMounted(udid)))
      throw failure("Couldn't mount the developer disk image", result);
  }

  async ensureTunnel(udid: string): Promise<void> {
    if ((await agentGet(`/tunnel/${udid}`)) === 200) return;
    if ((await agentGet("/health")) !== 200) {
      const pairDir = path.join(this.tools.storageDir, "go-ios-pair");
      await mkdir(pairDir, { recursive: true });
      this.agent = this.tools.goIosStart(
        ["tunnel", "start", "--userspace", `--udid=${udid}`, `--pair-record-path=${pairDir}`],
        {
          onStderrLine: (line) => this.tools.log.trace(`[tunnel] ${line}`),
        },
      );
      if (!this.agent) throw new BridgeError("go-ios isn't installed.");
      void this.agent.done.then((r) => {
        this.tools.log.info(`go-ios tunnel agent exited (${r.code ?? r.signal})`);
        this.agent = undefined;
      });
    }
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if ((await agentGet(`/tunnel/${udid}`)) === 200) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new BridgeError(
      "The connection to the phone (go-ios tunnel) didn't come up within 20 seconds. Unlock the phone and try again.",
    );
  }

  async refreshTunnel(udid: string): Promise<void> {
    await this.tools.goIos(["tunnel", "refresh", `--udid=${udid}`], { timeoutMs: 20000 });
  }

  stopAgent(): void {
    this.agent?.kill();
    this.agent = undefined;
  }

  async launch(udid: string, bundleId: string): Promise<number | undefined> {
    const attempt = () =>
      this.tools.goIos(["launch", bundleId, "--kill-existing", `--udid=${udid}`], {
        timeoutMs: 60000,
      });
    let result = await attempt();
    if (result.code !== 0 && /tunnel|rsd|closed|reset|EOF/i.test(result.stderr)) {
      // Stale tunnels aren't rebuilt by go-ios v1.3.2 (go-ios #765).
      await this.refreshTunnel(udid);
      await this.ensureTunnel(udid);
      result = await attempt();
    }
    if (result.code !== 0) throw failure("Couldn't launch the app", result);
    return parseLaunchPid(result.stderr);
  }

  async kill(udid: string, target: { pid?: number; bundleId: string }): Promise<void> {
    const args =
      target.pid !== undefined ? ["kill", `--pid=${target.pid}`] : ["kill", target.bundleId];
    await this.tools.goIos([...args, `--udid=${udid}`], { timeoutMs: 20000 });
  }

  async ps(udid: string): Promise<RunningApp[] | undefined> {
    const result = await this.tools.goIos(["ps", "--apps", `--udid=${udid}`], { timeoutMs: 20000 });
    return result.code === 0 ? parsePs(result.stdout) : undefined;
  }

  async crashList(udid: string, pattern: string): Promise<string[]> {
    const result = await this.tools.goIos(["crash", "ls", pattern, `--udid=${udid}`], {
      timeoutMs: 30000,
    });
    if (result.code !== 0) throw failure("Couldn't list crash reports", result);
    return parseCrashList(result.stdout);
  }

  async crashCopy(udid: string, name: string, targetDir: string): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    const result = await this.tools.goIos(
      ["crash", "cp", path.basename(name), targetDir, `--udid=${udid}`],
      { timeoutMs: 60000 },
    );
    if (result.code !== 0) throw failure("Couldn't copy the crash report", result);
  }

  syslog(udid: string, onLine: (line: string) => void): RunningProcess | undefined {
    return this.tools.goIosStart(["syslog", "--parse", `--udid=${udid}`], { onStdoutLine: onLine });
  }
}
