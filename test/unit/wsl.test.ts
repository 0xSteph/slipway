import { describe, expect, it } from "vitest";
import {
  cleanWslOutput,
  findPhoneRoute,
  parseDefaultGateway,
  parseWslDistros,
  withMirroredNetworking,
  wslConfigIsMirrored,
} from "../../src/util/wsl";

describe("WSL helpers", () => {
  it("reads distro names from wsl.exe's UTF-16 output", () => {
    const utf16 = Buffer.from("\uFEFFUbuntu-24.04\r\ndocker-desktop\r\n", "utf16le").toString(
      "utf8",
    );
    expect(parseWslDistros(utf16)).toEqual(["Ubuntu-24.04", "docker-desktop"]);
    expect(parseWslDistros("Ubuntu\n")).toEqual(["Ubuntu"]);
    expect(cleanWslOutput("a\u0000b")).toBe("ab");
  });

  it("detects mirrored networking only in the [wsl2] section", () => {
    expect(wslConfigIsMirrored("[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\n")).toBe(true);
    expect(wslConfigIsMirrored("[wsl2]\nnetworkingMode = Mirrored # yes\n")).toBe(true);
    expect(wslConfigIsMirrored("[experimental]\nnetworkingMode=mirrored\n")).toBe(false);
    expect(wslConfigIsMirrored("[wsl2]\nnetworkingMode=nat\n")).toBe(false);
    expect(wslConfigIsMirrored("")).toBe(false);
  });

  it("turns on mirrored networking without touching other settings", () => {
    expect(withMirroredNetworking("")).toBe("[wsl2]\nnetworkingMode=mirrored\n");
    expect(withMirroredNetworking("[wsl2]\nmemory=8GB\n\n[experimental]\nsparseVhd=true")).toBe(
      "[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\n\n[experimental]\nsparseVhd=true",
    );
    expect(withMirroredNetworking("[wsl2]\nnetworkingMode=nat\nmemory=4GB")).toBe(
      "[wsl2]\nnetworkingMode=mirrored\nmemory=4GB",
    );
    expect(withMirroredNetworking("[boot]\nsystemd=true")).toBe(
      "[boot]\nsystemd=true\n\n[wsl2]\nnetworkingMode=mirrored\n",
    );
    for (const input of ["", "[wsl2]\nmemory=8GB", "[boot]\nsystemd=true"]) {
      expect(wslConfigIsMirrored(withMirroredNetworking(input))).toBe(true);
    }
  });

  it("finds the Windows host in /proc/net/route", () => {
    const route =
      "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n" +
      "eth0\t00000000\t0160A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n" +
      "eth0\t0060A8C0\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0\n";
    expect(parseDefaultGateway(route)).toBe("192.168.96.1");
    expect(parseDefaultGateway("Iface\tDestination\tGateway\n")).toBeUndefined();
  });

  it("prefers an explicit address, then a usbmuxd socket", async () => {
    expect(
      await findPhoneRoute({ USBMUXD_SOCKET_ADDRESS: "10.0.0.1:27015" }, false, () => undefined),
    ).toEqual({
      kind: "configured",
      address: "10.0.0.1:27015",
    });
    expect(await findPhoneRoute({}, true, () => undefined)).toEqual({ kind: "usbmuxd" });
  });
});
