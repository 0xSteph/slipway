import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  launchPath,
  parseApps,
  parseCrashList,
  parseDevMode,
  parseImageMounted,
  parseInfo,
  parseLaunchPid,
  parseLogError,
  parsePs,
  parseSyslogLine,
} from "../../src/bridge/parse";

const fixture = (name: string) => readFileSync(`test/fixtures/goios/${name}`, "utf8");

describe("go-ios output parsing", () => {
  it("routes iOS versions to the launch path go-ios supports", () => {
    expect(launchPath("16.7.10")).toBe("xtool");
    expect(launchPath("17.0")).toBe("unsupported");
    expect(launchPath("17.4")).toBe("unsupported");
    expect(launchPath("17.4.1")).toBe("tunnel");
    expect(launchPath("26.1")).toBe("tunnel");
  });

  it("reads device info", () => {
    expect(
      parseInfo(
        '{"DeviceName":"Sam\'s iPhone","ProductVersion":"26.1","ProductType":"iPhone16,1"}',
      ),
    ).toEqual({
      name: "Sam's iPhone",
      iosVersion: "26.1",
      productType: "iPhone16,1",
    });
    expect(parseInfo("")).toEqual({});
  });

  it("treats a failed devmode query as unknown", () => {
    expect(parseDevMode('{"DeveloperModeEnabled":true}\n', "")).toBe(true);
    expect(parseDevMode('{"DeveloperModeEnabled":false}\n', "")).toBe(false);
    expect(
      parseDevMode('{"DeveloperModeEnabled":false}\n', fixture("info-no-device.stderr")),
    ).toBeUndefined();
  });

  it("gets the launch PID from the stderr log", () => {
    expect(parseLaunchPid(fixture("launch.stderr"))).toBe(4242);
    expect(parseLaunchPid(fixture("info-no-device.stderr"))).toBeUndefined();
  });

  it("extracts the error from go-ios logs", () => {
    expect(parseLogError(fixture("info-no-device.stderr"))).toBe(
      "Device not found: 00008110-0000: dial unix /var/run/usbmuxd: connect: no such file or directory",
    );
  });

  it("parses syslog lines in --parse and raw form", () => {
    expect(
      parseSyslogLine(
        '{"timestamp":"2026-10-24T10:15:00","device":"iPhone","process":"Canary","pid":"1234","level":"Notice","message":"App launched"}',
      ),
    ).toEqual({
      timestamp: "2026-10-24T10:15:00",
      process: "Canary",
      pid: 1234,
      level: "Notice",
      message: "App launched",
    });
    expect(parseSyslogLine('{"msg":"raw line"}')).toEqual({ message: "raw line" });
    expect(parseSyslogLine("")).toBeUndefined();
  });

  it("parses crash lists, image state, processes and apps", () => {
    expect(
      parseCrashList('{"files":["Canary-2026-10-24-101500.ips","Retired/x.ips"],"length":2}'),
    ).toEqual(["Canary-2026-10-24-101500.ips", "Retired/x.ips"]);
    expect(parseImageMounted('{"level":"INFO","msg":"image signature","signature":"ab"}')).toBe(
      true,
    );
    expect(parseImageMounted('{"level":"INFO","msg":"none"}')).toBe(false);
    expect(parsePs('[{"IsApplication":true,"Name":"Canary","Pid":77,"RealAppName":"/x"}]')).toEqual(
      [{ name: "Canary", pid: 77 }],
    );
    expect(
      parseApps(
        '[{"CFBundleIdentifier":"dev.slipway.canary","CFBundleName":"Canary","CFBundleExecutable":"Canary","CFBundleShortVersionString":"1.0.0"}]',
      ),
    ).toEqual([
      { bundleId: "dev.slipway.canary", name: "Canary", executable: "Canary", version: "1.0.0" },
    ]);
  });
});
