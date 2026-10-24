import { existsSync, readdirSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Tools } from "./tools";

const AUTH_NOTICE_KEY = "slipway.authNoticeShown";
export const XCODE_DOWNLOADS = "https://developer.apple.com/download/all/?q=xcode";

/** Runs a command as a terminal's own process so the user can type into it; resolves with its exit code. */
export function runInTerminal(
  tools: Tools,
  name: string,
  args: string[],
  cwd?: string,
): Promise<number | undefined> {
  const exe = tools.xtoolPath();
  if (!exe) {
    void vscode.window.showErrorMessage(
      "xtool wasn't found. Open the Slipway Doctor to install it.",
    );
    return Promise.resolve(undefined);
  }
  const terminal = vscode.window.createTerminal({
    name,
    shellPath: exe,
    shellArgs: args,
    cwd,
    env: tools.env(),
  });
  terminal.show();
  return new Promise((resolve) => {
    const sub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed !== terminal) return;
      sub.dispose();
      resolve(closed.exitStatus?.code);
    });
  });
}

export async function signIn(tools: Tools, state: vscode.Memento): Promise<number | undefined> {
  if (!state.get<boolean>(AUTH_NOTICE_KEY)) {
    const choice = await vscode.window.showInformationMessage(
      "Sign in to Apple with xtool",
      {
        modal: true,
        detail: [
          "A terminal opens and xtool asks for your Apple ID, password and two-factor code. You type them into xtool; Slipway never sees or stores your password.",
          "",
          "What to know before you sign in:",
          "• xtool talks to Apple as a virtual Mac. A third-party service (mac-ani.jkcoxson.com) supplies the device identity; it sees your IP address, not your password.",
          "• A new device appears in your Apple account.",
          "• xtool keeps the session under ~/.config/xtool. Sign Out removes it.",
          "• Use a secondary Apple ID if you can. Since September 2026 Apple has been blocking some free developer teams from signing apps; your Apple ID itself is not affected.",
          "• With a paid developer account you can choose an App Store Connect API key instead.",
        ].join("\n"),
      },
      "Open Sign-In Terminal",
    );
    if (choice !== "Open Sign-In Terminal") return undefined;
    await state.update(AUTH_NOTICE_KEY, true);
  }
  const code = await runInTerminal(tools, "Slipway: Apple sign-in", ["auth", "login"]);
  if (code !== undefined && code !== 0) {
    void vscode.window.showWarningMessage(
      "Sign-in didn't finish. If xtool showed error -80045 or -80046, update xtool to 1.23.0 or later and try again.",
    );
  }
  return code;
}

export async function signOut(tools: Tools): Promise<void> {
  const result = await tools.xtool(["auth", "logout"], { timeoutMs: 30000 });
  if (result.code === 0) {
    void vscode.window
      .showInformationMessage(
        "Signed out of Apple. You can also remove this computer from your Apple account's device list.",
        "Open Apple Account",
      )
      .then(
        (c) =>
          c &&
          vscode.env.openExternal(
            vscode.Uri.parse("https://account.apple.com/account/manage/section/devices"),
          ),
      );
  } else {
    void vscode.window.showErrorMessage(
      `Sign-out failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

function downloadDirs(): string[] {
  const dirs = [path.join(os.homedir(), "Downloads")];
  if (existsSync("/mnt/c/Users")) {
    for (const user of readdirSync("/mnt/c/Users"))
      dirs.push(path.join("/mnt/c/Users", user, "Downloads"));
  }
  return dirs.filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

export function findXips(): string[] {
  const found: string[] = [];
  for (const dir of downloadDirs()) {
    try {
      for (const name of readdirSync(dir)) {
        if (/^Xcode.*\.xip$/i.test(name)) found.push(path.join(dir, name));
      }
    } catch {
      // Unreadable Windows profile folders are common under /mnt/c.
    }
  }
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

export async function installSdk(tools: Tools): Promise<number | undefined> {
  const xips = findXips();
  const items: Array<
    vscode.QuickPickItem & { action: "file" | "browse" | "download"; file?: string }
  > = [
    ...xips.map((file) => ({
      label: path.basename(file),
      description: `${(statSync(file).size / 1e9).toFixed(1)} GB`,
      detail: file,
      action: "file" as const,
      file,
    })),
    { label: "$(folder-opened) Choose an Xcode .xip…", action: "browse" },
    {
      label: "$(link-external) Download Xcode from Apple",
      description: "opens your browser",
      action: "download",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: xips.length
      ? "Install the iOS SDK from which Xcode download?"
      : "No Xcode .xip found in Downloads",
  });
  if (!picked) return undefined;
  if (picked.action === "download") {
    await vscode.env.openExternal(vscode.Uri.parse(XCODE_DOWNLOADS));
    void vscode.window.showInformationMessage(
      'Sign in with your Apple ID, download Xcode (the .xip), then run "Slipway: Install iOS SDK from Xcode.xip" again.',
    );
    return undefined;
  }
  let file = picked.file;
  if (picked.action === "browse") {
    const chosen = await vscode.window.showOpenDialog({
      filters: { "Xcode archive": ["xip"] },
      openLabel: "Install SDK",
    });
    file = chosen?.[0]?.fsPath;
  }
  if (!file) return undefined;
  if (file.startsWith("/mnt/")) {
    void vscode.window.showWarningMessage(
      "This .xip is on the Windows drive. If extraction stalls (a known WSL issue, xtool #316), copy it into your Linux home folder first.",
    );
  }
  const code = await runInTerminal(tools, "Slipway: iOS SDK", ["sdk", "install", file]);
  if (code === 0) {
    void vscode.window.showInformationMessage(
      "iOS SDK installed. You can delete the .xip to free 2 GB.",
    );
  }
  return code;
}
