import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/util/ansi";
import {
  authErrorHint,
  isBannedProfileError,
  parseAuthStatus,
  parseDevices,
  parseErrorLine,
  parseIdentifiers,
  parseInstallProgress,
  parseRevocationPrompt,
  parseSdkStatus,
  parseWroteTo,
  parseXtoolVersion,
} from "../../src/xtool/parse";

const fixture = (name: string) => stripAnsi(readFileSync(`test/fixtures/xtool/${name}`, "utf8"));

describe("xtool output parsing", () => {
  it("reads the version", () => {
    expect(parseXtoolVersion("xtool 1.23.0\n")).toEqual([1, 23, 0]);
    expect(parseXtoolVersion("bash: xtool: not found")).toBeUndefined();
  });

  it("parses devices and the empty no-device output", () => {
    expect(parseDevices("\n")).toEqual([]);
    expect(
      parseDevices("Sam's iPhone [usb]: 00008110-001A2B3C4D5E6F70\nOld iPad [network]: abcdef\n"),
    ).toEqual([
      { name: "Sam's iPhone", connection: "usb", udid: "00008110-001A2B3C4D5E6F70" },
      { name: "Old iPad", connection: "network", udid: "abcdef" },
    ]);
  });

  it("parses auth status", () => {
    expect(parseAuthStatus("Logged out\n")).toEqual({ loggedIn: false });
    expect(
      parseAuthStatus(
        "Logged in.\n- Apple ID: a@b.com\n- Team ID: ABCDE12345\n- Token expiry: Oct 31, 2026 at 4:00 PM\n",
      ),
    ).toEqual({
      loggedIn: true,
      mode: "password",
      appleId: "a@b.com",
      teamId: "ABCDE12345",
      tokenExpiry: "Oct 31, 2026 at 4:00 PM",
    });
    expect(parseAuthStatus("Logged in.\n- ASC key ID: K1\n- Issuer ID: I1\n").mode).toBe("apiKey");
  });

  it("parses sdk status from this machine's output", () => {
    const out =
      "Darwin SDK is installed\n  Path: /home/dev/.swiftpm/swift-sdks/darwin.artifactbundle\n  Flavor: normal\n  Version: epoch=4,darwinTools=1.1.0,oam=1.4.1\n";
    expect(parseSdkStatus(out)).toEqual({
      installed: true,
      path: "/home/dev/.swiftpm/swift-sdks/darwin.artifactbundle",
      version: "epoch=4,darwinTools=1.1.0,oam=1.4.1",
    });
    expect(parseSdkStatus("Darwin SDK is not installed\n").installed).toBe(false);
  });

  it("finds the built app path", () => {
    expect(parseWroteTo(fixture("build-ok.txt"))).toBe("/home/dev/Canary/xtool/Canary.app");
    expect(parseWroteTo(fixture("build-errors.txt"))).toBeUndefined();
  });

  it("detects the certificate revocation prompt only once it is waiting", () => {
    const text =
      "\n[Signing] ...\nThe following certificates must be revoked:\n- Apple Development: a@b.com (expires Oct 30, 2026)\nContinue? (yes/no): ";
    expect(parseRevocationPrompt(text)).toEqual([
      "Apple Development: a@b.com (expires Oct 30, 2026)",
    ]);
    expect(parseRevocationPrompt(text.replace(/Continue.*$/, ""))).toBeUndefined();
  });

  it("recognises Apple's free-team signing block", () => {
    expect(
      isBannedProfileError("Failed to verify code signature (the provisioning profile is banned)"),
    ).toBe(true);
    expect(isBannedProfileError("error 0xe8008024")).toBe(true);
    expect(isBannedProfileError("Successfully installed!")).toBe(false);
  });

  it("explains auth errors", () => {
    expect(authErrorHint("Error: This action cannot be completed at this time. (-80046)")).toMatch(
      /1\.23\.0/,
    );
    expect(authErrorHint("`build --sign` requires logging in with `xtool auth`")).toMatch(
      /Sign In/,
    );
  });

  it("parses install progress and errors", () => {
    expect(parseInstallProgress("[Packaging]  42%")).toEqual({ stage: "Packaging", percent: 42 });
    expect(parseInstallProgress("[Unpacking app] ...")).toEqual({
      stage: "Unpacking app",
      percent: undefined,
    });
    expect(parseInstallProgress("Installing to device: x")).toBeUndefined();
    expect(parseErrorLine("foo\nError: Could not find x\n")).toBe("Could not find x");
  });

  it("parses bundle identifiers", () => {
    const out =
      "- id: ABC\n  name: XTL Canary\n  identifier: XTL-1234.dev.slipway.canary\n  platform: IOS\n- id: DEF\n";
    expect(parseIdentifiers(out)).toEqual([
      { id: "ABC", name: "XTL Canary", identifier: "XTL-1234.dev.slipway.canary" },
      { id: "DEF" },
    ]);
  });
});
