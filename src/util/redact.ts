export interface RedactOptions {
  home?: string;
}

const RULES: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/(Team ID: )[A-Z0-9]{10}\b/g, "$1<team-id>"],
  [/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}\b/g, "<udid>"],
  [/\b[0-9a-fA-F]{40}\b/g, "<udid>"],
  [/("UniqueChipID"\s*:\s*)\d+/g, "$1<ecid>"],
];

/** Removes Apple ID emails, team IDs, device IDs and the home path from text meant for a bug report. */
export function redact(text: string, options: RedactOptions = {}): string {
  let result = text;
  if (options.home && options.home.length > 1) result = result.split(options.home).join("~");
  for (const [pattern, replacement] of RULES) result = result.replace(pattern, replacement);
  return result;
}
