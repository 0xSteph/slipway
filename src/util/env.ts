import * as path from "node:path";

export interface ToolPaths {
  /** Directories appended to PATH for every tool Slipway spawns. */
  extraDirs: string[];
}

/**
 * VS Code started from a desktop launcher doesn't read ~/.zprofile, which is where
 * swiftly installs itself, so swift and xtool can be missing from the inherited PATH.
 */
export function toolDirs(
  env: NodeJS.ProcessEnv,
  home: string,
  exists: (p: string) => boolean,
): ToolPaths {
  const candidates = [
    path.join(home, ".local", "bin"),
    env.SWIFTLY_BIN_DIR ?? path.join(home, ".local", "share", "swiftly", "bin"),
  ];
  return { extraDirs: candidates.filter((dir) => exists(dir)) };
}

export function toolEnv(env: NodeJS.ProcessEnv, dirs: ToolPaths): NodeJS.ProcessEnv {
  const current = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const added = dirs.extraDirs.filter((dir) => !current.includes(dir));
  return {
    ...env,
    PATH: [...current, ...added].join(path.delimiter),
    NO_COLOR: "1",
  };
}

export function findOnPath(
  name: string,
  pathValue: string,
  exists: (p: string) => boolean,
): string | undefined {
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}
