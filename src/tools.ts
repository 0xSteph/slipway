import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findOnPath, toolDirs, toolEnv } from "./util/env";
import { ProcessOptions, ProcessResult, RunningProcess, run, start } from "./util/process";

/** Resolves and spawns xtool, swift and go-ios with an environment that has them on PATH. */
export class Tools {
  constructor(
    private readonly storage: vscode.Uri,
    readonly log: vscode.LogOutputChannel,
  ) {}

  env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const dirs = toolDirs(process.env, os.homedir(), existsSync);
    return { ...toolEnv(process.env, dirs), ...extra };
  }

  xtoolPath(): string | undefined {
    const configured = vscode.workspace.getConfiguration("slipway").get<string>("xtoolPath");
    if (configured) return existsSync(configured) ? configured : undefined;
    return findOnPath("xtool", this.env().PATH ?? "", existsSync);
  }

  swiftPath(): string | undefined {
    return findOnPath("swift", this.env().PATH ?? "", existsSync);
  }

  /** True when swift is only reachable through the directories Slipway adds. */
  swiftOnlyViaFallback(): boolean {
    return (
      !findOnPath("swift", process.env.PATH ?? "", existsSync) && this.swiftPath() !== undefined
    );
  }

  get storageDir(): string {
    return this.storage.fsPath;
  }

  goIosPath(): string | undefined {
    const configured = vscode.workspace.getConfiguration("slipway").get<string>("goIosPath");
    const candidate = configured || path.join(this.storageDir, "bin", "ios");
    return existsSync(candidate) ? candidate : undefined;
  }

  /** CA bundle with Apple Root CA, which go-ios needs for Apple's signing server (go-ios #875). */
  get caBundlePath(): string {
    return path.join(this.storageDir, "ca-bundle-with-apple-root.pem");
  }

  async xtool(args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    return this.runTool("xtool", this.xtoolPath(), args, options);
  }

  xtoolStart(args: string[], options: ProcessOptions = {}): RunningProcess | undefined {
    const exe = this.xtoolPath();
    if (!exe) return undefined;
    this.log.info(`$ xtool ${args.join(" ")}`);
    return start(exe, args, { env: this.env(), ...options });
  }

  async swift(args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    return this.runTool("swift", this.swiftPath(), args, options);
  }

  goIosEnv(): NodeJS.ProcessEnv {
    return this.env(existsSync(this.caBundlePath) ? { SSL_CERT_FILE: this.caBundlePath } : {});
  }

  async goIos(args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    return this.runTool("ios", this.goIosPath(), args, { env: this.goIosEnv(), ...options });
  }

  goIosStart(args: string[], options: ProcessOptions = {}): RunningProcess | undefined {
    const exe = this.goIosPath();
    if (!exe) return undefined;
    this.log.info(`$ ios ${args.join(" ")}`);
    return start(exe, args, { env: this.goIosEnv(), cwd: this.storageDir, ...options });
  }

  private async runTool(
    name: string,
    exe: string | undefined,
    args: string[],
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    if (!exe) {
      return {
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        spawnError: `${name} not found`,
      };
    }
    this.log.debug(`$ ${name} ${args.join(" ")}`);
    const result = await run(exe, args, { env: this.env(), ...options });
    if (result.code !== 0) {
      this.log.debug(
        `${name} exited ${result.code ?? result.signal}: ${result.stderr.trim().slice(-500)}`,
      );
    }
    return result;
  }
}
