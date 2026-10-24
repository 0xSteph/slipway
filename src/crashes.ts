import * as path from "node:path";
import * as vscode from "vscode";
import { GoIos } from "./bridge/goios";

/** Pulls crash reports for one app through go-ios and opens the newest. */
export class Crashes {
  private readonly seen = new Set<string>();

  constructor(
    private readonly bridge: GoIos,
    private readonly storageDir: string,
  ) {}

  /** Remembers what's already on the device so only crashes from this run are reported. */
  async baseline(udid: string, executable: string): Promise<void> {
    for (const name of await this.bridge.crashList(udid, `${executable}*`).catch(() => []))
      this.seen.add(`${udid}/${name}`);
  }

  async fetchNew(udid: string, executable: string, openNewest = true): Promise<string[]> {
    const names = await this.bridge.crashList(udid, `${executable}*`);
    const fresh = names.filter((n) => !this.seen.has(`${udid}/${n}`) && !n.startsWith("Retired/"));
    const dir = path.join(this.storageDir, "crashes", udid);
    const copied: string[] = [];
    for (const name of fresh) {
      await this.bridge.crashCopy(udid, name, dir);
      this.seen.add(`${udid}/${name}`);
      copied.push(path.join(dir, path.basename(name)));
    }
    const newest = copied.sort().at(-1);
    if (openNewest && newest) {
      await vscode.window.showTextDocument(vscode.Uri.file(newest), { preview: false });
    }
    return copied;
  }

  folder(udid: string): vscode.Uri {
    return vscode.Uri.file(path.join(this.storageDir, "crashes", udid));
  }
}
