import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiagnostics } from "../../src/build/diagnostics";
import { stripAnsi } from "../../src/util/ansi";

const lines = (name: string) =>
  stripAnsi(readFileSync(`test/fixtures/xtool/${name}`, "utf8")).split("\n");
const FILE = "/home/dev/Canary/Sources/Canary/ContentView.swift";

describe("build diagnostics from real xtool output", () => {
  it("reports each error once and skips wrapper lines", () => {
    const diags = parseDiagnostics(lines("build-errors.txt"));
    expect(diags.map((d) => [d.file, d.line, d.column, d.severity, d.message])).toEqual([
      [FILE, 17, 18, "error", "cannot convert value of type 'String' to specified type 'Int'"],
      [FILE, 18, 26, "error", "value of type 'UIApplication' has no member 'doesNotExist'"],
    ]);
  });

  it("splits the diagnostic group into the code", () => {
    const [warning] = parseDiagnostics(lines("build-warning.txt"));
    expect(warning.severity).toBe("warning");
    expect(warning.code).toBe("NoUsage");
    expect(warning.message).toMatch(/^initialization of immutable value 'unused' was never used/);
    expect(warning.message).not.toContain("[#");
  });

  it("finds nothing in a clean build", () => {
    expect(parseDiagnostics(lines("build-ok.txt"))).toEqual([]);
  });

  it("attaches notes to the preceding diagnostic", () => {
    const diags = parseDiagnostics([
      "/a/B.swift:1:2: error: ambiguous use of 'f'",
      "/a/C.swift:3:4: note: found this candidate",
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].related[0]).toMatchObject({ file: "/a/C.swift", line: 3, severity: "note" });
  });
});
