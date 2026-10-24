import { deflateSync } from "node:zlib";

export type TemplateKind = "basic" | "notifications";

export const APP_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function defaultBundleId(user: string, appName: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "") || "app";
  return `dev.${clean(user)}.${clean(appName)}`;
}

/**
 * Mirrors what `xtool new` writes (xtool 1.23.0, NewCommand.swift), plus an icon wired
 * through `iconPath` because asset catalogs don't compile on Linux (xtool #310).
 */
export function templateFiles(
  appName: string,
  bundleId: string,
  kind: TemplateKind,
): Map<string, string | Buffer> {
  const moduleName = appName.replace(/-/g, "_");
  const files = new Map<string, string | Buffer>();

  files.set(
    "Package.swift",
    `// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "${appName}",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        // An xtool project should contain exactly one library product,
        // representing the main app.
        .library(
            name: "${moduleName}",
            targets: ["${moduleName}"]
        ),
    ],
    targets: [
        .target(
            name: "${moduleName}"
        ),
    ]
)
`,
  );

  files.set("xtool.yml", `version: 1\nbundleID: ${bundleId}\niconPath: Resources/AppIcon.png\n`);

  files.set(
    ".gitignore",
    `.DS_Store
/.build
/Packages
xcuserdata/
DerivedData/
.swiftpm/configuration/registries.json
.swiftpm/xcode/package.xcworkspace/contents.xcworkspacedata
.netrc

/xtool
`,
  );

  // The Swift extension would otherwise generate host (Linux) launch configs for this package.
  files.set(".vscode/settings.json", `{\n  "swift.autoGenerateLaunchConfigurations": false\n}\n`);

  files.set(
    `Sources/${moduleName}/${moduleName}App.swift`,
    `import SwiftUI

@main
struct ${moduleName}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`,
  );

  files.set(
    `Sources/${moduleName}/ContentView.swift`,
    kind === "notifications" ? notificationsView(appName) : basicView(),
  );
  files.set("Resources/AppIcon.png", placeholderIcon());
  return files;
}

function basicView(): string {
  return `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
        .onAppear { print("App launched") }
    }
}
`;
}

function notificationsView(appName: string): string {
  return `import SwiftUI
import UserNotifications

// Local notifications need no entitlement, so they work on a free Apple account.
// They exercise the same banner, sound, badge and tap handling a push would.
struct ContentView: View {
    @State private var status = "Tap the button to schedule a notification."

    var body: some View {
        VStack(spacing: 16) {
            Text("${appName}").font(.title)
            Text(status).font(.footnote).multilineTextAlignment(.center)
            Button("Notify me in 5 seconds") {
                Task { await scheduleTestNotification() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private func scheduleTestNotification() async {
        let center = UNUserNotificationCenter.current()
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else {
                status = "Notifications are turned off for this app in Settings."
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "${appName}"
            content.body = "This is a local test notification."
            content.sound = .default
            content.badge = 1
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)
            try await center.add(UNNotificationRequest(identifier: "test", content: content, trigger: trigger))
            status = "Scheduled. Lock your phone or switch apps to see the banner."
            print("Notification scheduled")
        } catch {
            status = "Couldn't schedule: \\(error.localizedDescription)"
        }
    }
}
`;
}

/** A 1024×1024 placeholder: a diagonal blue gradient. Slipway's own drawing, not an Apple asset. */
export function placeholderIcon(size = 1024): Buffer {
  const row = Buffer.alloc(1 + size * 3);
  const raw = Buffer.alloc(row.length * size);
  for (let y = 0; y < size; y++) {
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      row[1 + x * 3] = Math.round(20 + 30 * t);
      row[2 + x * 3] = Math.round(90 + 80 * t);
      row[3 + x * 3] = Math.round(200 + 40 * t);
    }
    row.copy(raw, y * row.length);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
