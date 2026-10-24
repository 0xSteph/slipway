import { createHash, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { readZipEntry } from "../util/zip";
import { GO_IOS_BINARIES, GO_IOS_ZIP_SHA256, GO_IOS_ZIP_URL } from "./parse";

const APPLE_ROOT_CA_URL = "https://www.apple.com/appleca/AppleIncRootCertificate.cer";
const APPLE_ROOT_CA_SHA256 = "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024";
const SYSTEM_BUNDLES = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"];

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal, redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: ${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Downloads the pinned go-ios release from GitHub into Slipway's storage and checks
 * both the archive's and the binary's SHA-256. go-ios is MIT; it isn't bundled in the VSIX.
 */
export async function installGoIos(
  storageDir: string,
  arch = process.arch,
  signal?: AbortSignal,
): Promise<string> {
  const binary = GO_IOS_BINARIES[arch];
  if (!binary) throw new Error(`go-ios has no Linux build for ${arch}.`);
  const zip = await download(GO_IOS_ZIP_URL, signal);
  if (sha256(zip) !== GO_IOS_ZIP_SHA256)
    throw new Error("The go-ios download didn't match its pinned checksum. Nothing was installed.");
  const exe = readZipEntry(zip, binary.entry);
  if (!exe || sha256(exe) !== binary.sha256)
    throw new Error("The go-ios binary didn't match its pinned checksum. Nothing was installed.");

  const binDir = path.join(storageDir, "bin");
  await mkdir(binDir, { recursive: true });
  const target = path.join(binDir, "ios");
  const temp = `${target}.download`;
  await writeFile(temp, exe);
  await chmod(temp, 0o755);
  await rename(temp, target);
  return target;
}

/** Writes the system CA bundle plus Apple Root CA, for go-ios's TLS check of gs.apple.com. */
export async function writeCaBundle(targetPath: string, signal?: AbortSignal): Promise<void> {
  const der = await download(APPLE_ROOT_CA_URL, signal);
  if (sha256(der) !== APPLE_ROOT_CA_SHA256)
    throw new Error("Apple Root CA didn't match its pinned fingerprint.");
  const pem = new X509Certificate(der).toString();
  const system = SYSTEM_BUNDLES.find((p) => existsSync(p));
  if (!system)
    throw new Error("No system CA bundle found (looked in /etc/ssl/certs and /etc/pki).");
  const bundle = `${(await readFile(system, "utf8")).trimEnd()}\n${pem}`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bundle);
}
