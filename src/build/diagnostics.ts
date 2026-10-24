export type Severity = "error" | "warning" | "note" | "remark";

export interface BuildDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  code?: string;
  related: BuildDiagnostic[];
}

const PRIMARY = /^(\/[^:]+):(\d+):(\d+): (error|warning|note|remark): (.*)$/;
const GROUP_SUFFIX = / \[#([A-Za-z0-9]+)\]$/;

/**
 * Parses swiftc diagnostics from `xtool dev build` output (ANSI already stripped).
 * Swift 6's snippet lines (`  |   `- error: …`) repeat each message and are skipped
 * because they don't start with a path.
 */
export function parseDiagnostics(lines: Iterable<string>): BuildDiagnostic[] {
  const result: BuildDiagnostic[] = [];
  const seen = new Set<string>();
  let lastPrimary: BuildDiagnostic | undefined;

  for (const line of lines) {
    const m = PRIMARY.exec(line);
    if (!m) continue;
    let message = m[5];
    let code: string | undefined;
    const group = GROUP_SUFFIX.exec(message);
    if (group) {
      code = group[1];
      message = message.slice(0, group.index);
    }
    const diagnostic: BuildDiagnostic = {
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] as Severity,
      message,
      code,
      related: [],
    };
    const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.severity}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (diagnostic.severity === "note" && lastPrimary) {
      lastPrimary.related.push(diagnostic);
      continue;
    }
    result.push(diagnostic);
    lastPrimary = diagnostic;
  }
  return result;
}
