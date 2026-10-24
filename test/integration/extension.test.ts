import * as assert from "node:assert";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "0xsteph.slipway";
const workspace = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const hasXtool = () =>
  ["/usr/local/bin", `${process.env.HOME}/.local/bin`].some((d) =>
    existsSync(path.join(d, "xtool")),
  );

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out");
}

suite("Slipway extension", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  });

  test("activates in an xtool project and registers its commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "slipway.run",
      "slipway.build",
      "slipway.doctor.refresh",
      "slipway.newApp",
      "slipway.collectDiagnostics",
    ]) {
      assert.ok(commands.includes(id), `${id} missing`);
    }
  });

  test("provides build and run tasks", async () => {
    const tasks = await vscode.tasks.fetchTasks({ type: "slipway" });
    assert.deepStrictEqual(tasks.map((t) => t.name).sort(), ["Build", "Run on Device"]);
  });

  test("Doctor runs without a phone attached", async () => {
    await vscode.commands.executeCommand("slipway.doctor.refresh");
    const api = vscode.extensions.getExtension<{
      checks: () => { id: string; status: string; label: string; detail: string }[];
    }>(EXTENSION_ID)!.exports;
    const checks = api.checks();
    console.log(
      checks.map((c) => `      [${c.status}] ${c.id}: ${c.label} — ${c.detail}`).join("\n"),
    );
    if (process.platform === "win32") {
      // On Windows itself Doctor is a WSL setup guide; the toolchain checks run inside WSL.
      assert.deepStrictEqual(
        checks.map((c) => c.id),
        ["host", "wsl", "wslExt", "appleDevices", "mirrored", "openInWsl"],
      );
      return;
    }
    const xtool = checks.find((c) => c.id === "xtool");
    assert.ok(xtool, "xtool row");
    // Without xtool Doctor stops there; with it, the phone row must say none is attached.
    if (xtool.status === "fail") return;
    assert.ok(
      checks.some((c) => c.id === "device" && c.status === "warn"),
      "no-device row",
    );
  });

  test("Build puts compiler errors in the Problems panel and clears them when fixed", async function () {
    if (!hasXtool()) this.skip();
    this.timeout(240000);
    const broken = path.join(workspace(), "Sources", "Fixture", "Broken.swift");
    writeFileSync(broken, 'func broken() {\n    let x: Int = "nope"\n}\n');
    try {
      await vscode.commands.executeCommand("slipway.build");
      const diags = await waitFor(() => {
        const found = vscode.languages.getDiagnostics(vscode.Uri.file(broken));
        return found.length > 0 ? found : undefined;
      }, 5000);
      assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(diags[0].range.start.line, 1);
      assert.match(diags[0].message, /cannot convert value of type 'String'/);
    } finally {
      rmSync(broken, { force: true });
    }
    await vscode.commands.executeCommand("slipway.build");
    assert.strictEqual(vscode.languages.getDiagnostics(vscode.Uri.file(broken)).length, 0);
    assert.ok(
      existsSync(path.join(workspace(), "xtool", "Fixture.app", "Info.plist")),
      "app bundle written",
    );
  });
});
