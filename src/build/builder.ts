import { statSync } from "node:fs";
import * as vscode from "vscode";
import { Project } from "../project/project";
import { Tools } from "../tools";
import { authErrorHint, parseErrorLine, parseWroteTo } from "../xtool/parse";
import { BuildDiagnostic, parseDiagnostics } from "./diagnostics";

export interface BuildResult {
  ok: boolean;
  appPath?: string;
  cancelled?: boolean;
  seconds: number;
}

const SEVERITY: Record<BuildDiagnostic["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  note: vscode.DiagnosticSeverity.Information,
  remark: vscode.DiagnosticSeverity.Hint,
};

function toVscode(d: BuildDiagnostic): vscode.Diagnostic {
  const position = new vscode.Position(Math.max(d.line - 1, 0), Math.max(d.column - 1, 0));
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(position, position),
    d.message,
    SEVERITY[d.severity],
  );
  diagnostic.source = "swiftc";
  if (d.code) diagnostic.code = d.code;
  diagnostic.relatedInformation = d.related.map(
    (r) =>
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(
          vscode.Uri.file(r.file),
          new vscode.Position(Math.max(r.line - 1, 0), Math.max(r.column - 1, 0)),
        ),
        r.message,
      ),
  );
  return diagnostic;
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Runs `xtool dev build` and keeps the Problems panel in sync with it. */
export class Builder implements vscode.Disposable {
  readonly diagnostics = vscode.languages.createDiagnosticCollection("slipway");
  private lastBuildStarted = 0;
  lastLog = "";
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly tools: Tools) {
    // SwiftPM doesn't replay warnings for files it skips, so a file's build
    // diagnostics are dropped only when that file changes, not on every build.
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) this.diagnostics.delete(e.document.uri);
      }),
    );
  }

  async build(
    project: Project,
    output: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<BuildResult> {
    const configuration = vscode.workspace
      .getConfiguration("slipway")
      .get<string>("buildConfiguration", "debug");
    const started = Date.now();
    const lines: string[] = [];
    const result = await this.tools.xtool(["dev", "build", "-c", configuration], {
      cwd: project.root,
      signal,
      onStdoutLine: (line) => {
        lines.push(line);
        output(line);
      },
      onStderrLine: (line) => {
        lines.push(line);
        output(line);
      },
    });
    const seconds = (Date.now() - started) / 1000;
    this.lastLog = lines.join("\n");
    if (result.spawnError) {
      output("xtool wasn't found. Open the Slipway Doctor to install it.");
      return { ok: false, seconds };
    }
    if (result.cancelled) return { ok: false, cancelled: true, seconds };

    this.publish(parseDiagnostics(lines), started, result.code === 0);
    if (result.code !== 0) {
      const hint =
        authErrorHint(result.stdout) ??
        (/Failed to obtain Swift version/.test(result.stdout)
          ? "xtool couldn't find Swift. Open the Slipway Doctor."
          : undefined);
      const error = parseErrorLine(result.stdout + result.stderr);
      if (hint) output(hint);
      else if (error) output(`xtool: ${error}`);
      return { ok: false, seconds };
    }
    return { ok: true, appPath: parseWroteTo(result.stdout), seconds };
  }

  /**
   * Files the build reported on get its diagnostics. Others keep theirs (no-op rebuilds
   * don't repeat warnings) unless the file changed or vanished since the last build.
   * A successful build has no errors anywhere, so leftover errors go.
   */
  private publish(found: BuildDiagnostic[], started: number, succeeded: boolean): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of found) {
      const list = byFile.get(d.file) ?? [];
      list.push(toVscode(d));
      byFile.set(d.file, list);
    }
    this.diagnostics.forEach((uri, existing) => {
      if (byFile.has(uri.fsPath)) return;
      const modified = mtime(uri.fsPath);
      if (modified === 0 || modified > this.lastBuildStarted) {
        this.diagnostics.delete(uri);
      } else if (succeeded) {
        const kept = existing.filter((d) => d.severity !== vscode.DiagnosticSeverity.Error);
        if (kept.length !== existing.length) this.diagnostics.set(uri, kept);
      }
    });
    for (const [file, list] of byFile) this.diagnostics.set(vscode.Uri.file(file), list);
    this.lastBuildStarted = started;
  }

  dispose(): void {
    this.diagnostics.dispose();
    for (const s of this.subscriptions) s.dispose();
  }
}
