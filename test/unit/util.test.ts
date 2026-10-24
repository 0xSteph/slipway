import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFreeTeamEntitlements, plistTopLevelKeys } from "../../src/project/entitlements";
import {
  BUNDLE_ID,
  defaultBundleId,
  placeholderIcon,
  templateFiles,
} from "../../src/project/template";
import { stripAnsi } from "../../src/util/ansi";
import { findOnPath, toolDirs, toolEnv } from "../../src/util/env";
import { LineSplitter } from "../../src/util/lines";
import { run, start } from "../../src/util/process";
import { redact } from "../../src/util/redact";
import { readZipEntry } from "../../src/util/zip";
import { deflateRawSync } from "node:zlib";

describe("ansi and lines", () => {
  it("strips colour codes", () => {
    expect(stripAnsi("\x1b[1;31merror: \x1b[1;39mbad\x1b[0;0m")).toBe("error: bad");
  });

  it("splits on \\n, \\r\\n and bare \\r progress redraws", () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push("a\r\nb\n[Pack]  1%\r[Pack] 50");
    s.push("%\nrest");
    expect(lines).toEqual(["a", "b", "[Pack]  1%", "[Pack] 50%"]);
    expect(s.partial).toBe("rest");
  });
});

describe("tool environment", () => {
  it("appends swiftly and ~/.local/bin only when they exist and are missing", () => {
    const exists = (p: string) => p === "/h/.local/bin" || p === "/h/.local/share/swiftly/bin";
    const dirs = toolDirs({}, "/h", exists);
    expect(dirs.extraDirs).toEqual(["/h/.local/bin", "/h/.local/share/swiftly/bin"]);
    const env = toolEnv({ PATH: "/usr/bin:/h/.local/bin" }, dirs);
    expect(env.PATH).toBe("/usr/bin:/h/.local/bin:/h/.local/share/swiftly/bin");
    expect(env.NO_COLOR).toBe("1");
  });

  it("honours SWIFTLY_BIN_DIR", () => {
    expect(toolDirs({ SWIFTLY_BIN_DIR: "/opt/s" }, "/h", (p) => p === "/opt/s").extraDirs).toEqual([
      "/opt/s",
    ]);
  });

  it("finds executables on PATH", () => {
    expect(findOnPath("xtool", "/a:/b", (p) => p === "/b/xtool")).toBe("/b/xtool");
    expect(findOnPath("xtool", "/a", () => false)).toBeUndefined();
  });
});

describe("process runner", () => {
  it("collects output, strips ANSI and reports the exit code", async () => {
    const lines: string[] = [];
    const result = await run(
      process.execPath,
      ["-e", "process.stdout.write('\\x1b[31mred\\x1b[0m\\nend'); process.exit(3)"],
      {
        onStdoutLine: (l) => lines.push(l),
      },
    );
    expect(result.code).toBe(3);
    expect(lines).toEqual(["red", "end"]);
  });

  it("answers a prompt that has no trailing newline", async () => {
    const script =
      "process.stdout.write('Continue? (yes/no): '); process.stdin.once('data', d => { console.log('got ' + d.toString().trim()); process.exit(0) })";
    const result = await start(process.execPath, ["-e", script], {
      onStdoutData: (text, p) => {
        if (text.endsWith("(yes/no): ")) p.write("no\n");
      },
    }).done;
    expect(result.stdout).toContain("got no");
  });

  it("cancels and times out", async () => {
    const controller = new AbortController();
    const pending = run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).cancelled).toBe(true);
    const timed = await run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 100,
    });
    expect(timed.timedOut).toBe(true);
  });

  it("reports a missing executable instead of throwing", async () => {
    const result = await run("/nonexistent/xtool", ["--version"]);
    expect(result.spawnError).toMatch(/ENOENT/);
  });
});

describe("zip reader", () => {
  it("reads a deflated entry", () => {
    const zip = makeZip("ios-amd64", Buffer.from("binary-content"));
    expect(readZipEntry(zip, "ios-amd64")?.toString()).toBe("binary-content");
    expect(readZipEntry(zip, "missing")).toBeUndefined();
  });
});

describe("redaction", () => {
  it("removes Apple IDs, team IDs, UDIDs and the home path", () => {
    const text =
      "- Apple ID: user@example.com\n- Team ID: ABCDE12345\nudid 00008110-001A2B3C4D5E6F70 and 0123456789abcdef0123456789abcdef01234567\n/home/user/.config/xtool";
    expect(redact(text, { home: "/home/user" })).toBe(
      "- Apple ID: <email>\n- Team ID: <team-id>\nudid <udid> and <udid>\n~/.config/xtool",
    );
  });
});

describe("entitlements", () => {
  it("lists capabilities a free team loses", () => {
    const xml = `<?xml version="1.0"?><plist><dict>
      <key>aps-environment</key><string>development</string>
      <key>com.apple.security.application-groups</key><array><string>group.x</string></array>
      <key>com.apple.developer.icloud-services</key><array/>
      <key>com.apple.developer.healthkit</key><true/>
    </dict></plist>`;
    const keys = plistTopLevelKeys(xml);
    expect(keys).toEqual([
      "aps-environment",
      "com.apple.security.application-groups",
      "com.apple.developer.icloud-services",
      "com.apple.developer.healthkit",
    ]);
    expect(checkFreeTeamEntitlements(keys)).toEqual({
      dropped: ["Push Notifications", "App Groups"],
      willFail: ["com.apple.developer.icloud-services"],
    });
  });
});

describe("template", () => {
  it("writes the xtool project layout with an icon", () => {
    const files = templateFiles("My-App", "dev.me.myapp", "basic");
    expect([...files.keys()].sort()).toEqual([
      ".gitignore",
      ".vscode/settings.json",
      "Package.swift",
      "Resources/AppIcon.png",
      "Sources/My_App/ContentView.swift",
      "Sources/My_App/My_AppApp.swift",
      "xtool.yml",
    ]);
    expect(files.get("xtool.yml")).toBe(
      "version: 1\nbundleID: dev.me.myapp\niconPath: Resources/AppIcon.png\n",
    );
    expect(files.get("Package.swift")).toContain('name: "My-App"');
    expect(
      templateFiles("A", "dev.me.a", "notifications").get("Sources/A/ContentView.swift"),
    ).toContain("UNUserNotificationCenter");
  });

  it("validates bundle IDs and builds a default", () => {
    expect(defaultBundleId("Sam", "My App!")).toBe("dev.sam.myapp");
    expect(BUNDLE_ID.test("dev.slipway.canary")).toBe(true);
    expect(BUNDLE_ID.test("canary")).toBe(false);
  });

  it("makes a valid PNG", () => {
    const png = placeholderIcon(8);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(8);
  });
});

function makeZip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

it("reads a real go-ios release zip when available", () => {
  const path = process.env.SLIPWAY_GOIOS_ZIP;
  if (!path) return;
  const entry = readZipEntry(readFileSync(path), "ios-amd64");
  expect(entry?.length).toBe(23331081);
});
