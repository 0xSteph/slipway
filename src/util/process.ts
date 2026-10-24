import { spawn } from "node:child_process";
import { stripAnsi } from "./ansi";
import { LineSplitter } from "./lines";

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Raw stdout text as it arrives, including a prompt that has no newline yet. */
  onStdoutData?: (text: string, process: RunningProcess) => void;
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** Set when the executable could not be started at all, e.g. ENOENT. */
  spawnError?: string;
}

export interface RunningProcess {
  readonly pid: number | undefined;
  readonly done: Promise<ProcessResult>;
  write(text: string): void;
  kill(signal?: NodeJS.Signals): void;
}

export function start(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): RunningProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let cancelled = false;
  let spawnError: string | undefined;

  const handle: RunningProcess = {
    get pid() {
      return child.pid;
    },
    done: undefined as unknown as Promise<ProcessResult>,
    write(text: string) {
      if (child.stdin.writable) child.stdin.write(text);
    },
    kill(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    },
  };

  const outLines = new LineSplitter((line) => options.onStdoutLine?.(line));
  const errLines = new LineSplitter((line) => options.onStderrLine?.(line));

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const text = stripAnsi(chunk);
    stdout += text;
    outLines.push(text);
    options.onStdoutData?.(text, handle);
  });
  child.stderr.on("data", (chunk: string) => {
    const text = stripAnsi(chunk);
    stderr += text;
    errLines.push(text);
  });
  child.stdin.on("error", () => {
    // The child may exit before reading stdin; EPIPE here is expected.
  });

  const timer =
    options.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          handle.kill();
        }, options.timeoutMs)
      : undefined;

  const onAbort = () => {
    cancelled = true;
    handle.kill();
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  (handle as { done: Promise<ProcessResult> }).done = new Promise((resolve) => {
    child.on("error", (err) => {
      spawnError = err.message;
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      outLines.flush();
      errLines.flush();
      resolve({ code, signal, stdout, stderr, timedOut, cancelled, spawnError });
    });
  });

  return handle;
}

export function run(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return start(command, args, options).done;
}
